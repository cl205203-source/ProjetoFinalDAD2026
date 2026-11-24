// Integrações com APIs externas: CepApi, DistanciaApi, CotacaoApi, EmailApi
// Todas rodam no processo main (o renderer não tem acesso à rede por causa da CSP).
import axios from 'axios';
import nodemailer, { Transporter } from 'nodemailer';
import { AppError } from './compartilhado/erros';

/** Endereço devolvido pela consulta de CEP. */
export interface EnderecoCep {
  cep: string; // 8 dígitos
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

interface Coordenada {
  latitude: number;
  longitude: number;
}

/** Evita crescer sem limite: guardamos poucas consultas recentes em memória. */
class CacheSimples<V> {
  private readonly mapa = new Map<string, V>();
  constructor(private readonly limite = 300) {}

  obter(chave: string): V | undefined {
    return this.mapa.get(chave);
  }

  guardar(chave: string, valor: V): void {
    if (this.mapa.size >= this.limite) this.mapa.clear();
    this.mapa.set(chave, valor);
  }
}

// ---------------------------------------------------------------------------
// API 1: consulta de CEP (ViaCEP, com BrasilAPI como reserva)
// ---------------------------------------------------------------------------
interface ViaCepResposta {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

interface BrasilApiCepResposta {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export class CepApi {
  private readonly cache = new CacheSimples<EnderecoCep>();

  /** Recebe o CEP só com 8 dígitos (já validado pelo serviço). */
  async consultar(cep: string): Promise<EnderecoCep> {
    if (!/^\d{8}$/.test(cep)) throw new AppError('CEP inválido. Informe 8 dígitos.', 'VALIDACAO');

    const emCache = this.cache.obter(cep);
    if (emCache) return emCache;

    let endereco: EnderecoCep | null;
    try {
      endereco = await this.viaCep(cep);
    } catch {
      // ViaCEP fora do ar: tenta a API reserva antes de desistir.
      try {
        endereco = await this.brasilApi(cep);
      } catch {
        throw new AppError('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
      }
    }

    if (!endereco) throw new AppError('CEP não encontrado.', 'NAO_ENCONTRADO');
    this.cache.guardar(cep, endereco);
    return endereco;
  }

  private async viaCep(cep: string): Promise<EnderecoCep | null> {
    const r = await axios.get<ViaCepResposta>(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 6000 });
    const d = r.data;
    if (!d || d.erro || !d.localidade || !d.uf) return null;
    return {
      cep,
      logradouro: CepApi.limpar(d.logradouro),
      bairro: CepApi.limpar(d.bairro),
      cidade: CepApi.limpar(d.localidade),
      uf: CepApi.limpar(d.uf).toUpperCase(),
    };
  }

  private async brasilApi(cep: string): Promise<EnderecoCep | null> {
    try {
      const r = await axios.get<BrasilApiCepResposta>(`https://brasilapi.com.br/api/cep/v1/${cep}`, { timeout: 6000 });
      const d = r.data;
      if (!d || !d.city || !d.state) return null;
      return {
        cep,
        logradouro: CepApi.limpar(d.street),
        bairro: CepApi.limpar(d.neighborhood),
        cidade: CepApi.limpar(d.city),
        uf: CepApi.limpar(d.state).toUpperCase(),
      };
    } catch (e) {
      // 404 = CEP inexistente (não é falha de rede).
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  }

  /** Dado vindo de fora: só texto simples e com tamanho limitado. */
  private static limpar(valor: string | undefined): string {
    return (valor ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 150);
  }
}

// ---------------------------------------------------------------------------
// [RF09] API 2: distância até a loja (geocodificação Nominatim/OpenStreetMap + roteamento OSRM + Haversine)
// ---------------------------------------------------------------------------
interface NominatimItem {
  lat: string;
  lon: string;
}

/** [RF09] Dados do endereço de destino para geocodificação e cálculo de rota. */
export interface DestinoEndereco {
  logradouro: string;
  numero?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
}

/** [RF09] Rota calculada entre a loja e o endereço de entrega via OSRM ou fallback Haversine. */
export interface RotaCalculada {
  distanciaKm: number;
  duracaoMin: number;
  origem: 'OSRM' | 'HAVERSINE';
}

interface OsrmResposta {
  code?: string;
  routes?: { distance?: number; duration?: number }[];
}

export class DistanciaApi {
  private static readonly INTERVALO_MS = 1100; // Nominatim permite no máximo 1 requisição/segundo
  // [RF09] Coordenadas padrão da matriz do pet shop (Campinas/SP - Centro) caso o .env não informe ou falhe
  private static readonly ORIGEM_PADRAO: Coordenada = {
    latitude: -22.9056,
    longitude: -47.0583,
  };

  private readonly cache = new CacheSimples<Coordenada | null>();
  private readonly cacheRotas = new CacheSimples<RotaCalculada>();
  private origem: Coordenada | null = null;
  private ultimaChamada = 0;
  private fila: Promise<void> = Promise.resolve();

  constructor(private readonly cepApi: CepApi) {}

  /**
   * [RF09] Distância aproximada, em km e em linha reta, entre a loja e o endereço.
   * Nunca lança erro: se a API estiver fora do ar ou o endereço não for encontrado, devolve null.
   */
  async calcularKm(e: DestinoEndereco): Promise<number | null> {
    try {
      const origem = await this.obterOrigem();
      const destino = await this.geocodificar(e);
      if (!destino) return null;
      return Math.round(DistanciaApi.haversineKm(origem, destino) * 10) / 10;
    } catch (erro) {
      console.warn('[DistanciaApi] [RF09] não foi possível calcular a distância:', (erro as Error).message);
      return null;
    }
  }

  /**
   * [RF09] Distância e duração reais de carro entre a loja e o endereço, usando o OSRM público.
   * Geocodifica origem e destino com o Nominatim e guarda o resultado em memória por par de coordenadas.
   * Nunca lança erro de rede: devolve null se não conseguir geocodificar; se o OSRM falhar,
   * devolve o fallback Haversine com duração estimada por ENTREGA_VELOCIDADE_KMH.
   */
  async calcularRota(destino: DestinoEndereco): Promise<RotaCalculada | null> {
    try {
      const origem = await this.obterOrigem();
      const alvo = await this.geocodificar(destino);
      if (!alvo) return null;
      return await this.rotaEntre(origem, alvo);
    } catch (erro) {
      console.warn('[DistanciaApi] [RF09] não foi possível calcular a rota:', (erro as Error).message);
      return null;
    }
  }

  private async rotaEntre(origem: Coordenada, destino: Coordenada): Promise<RotaCalculada> {
    const chave =
      `${origem.latitude.toFixed(5)},${origem.longitude.toFixed(5)};` +
      `${destino.latitude.toFixed(5)},${destino.longitude.toFixed(5)}`;
    const emCache = this.cacheRotas.obter(chave);
    if (emCache) return emCache;

    let resultado: RotaCalculada;
    try {
      // OSRM espera longitude,latitude (nessa ordem).
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${origem.longitude},${origem.latitude};${destino.longitude},${destino.latitude}`;
      const r = await axios.get<OsrmResposta>(url, {
        params: { overview: 'false', alternatives: 'false', steps: 'false' },
        headers: { 'User-Agent': 'PetShopDelivery/1.0 (projeto academico)' },
        timeout: 8000,
      });
      const rota = r.data?.routes?.[0];
      const metros = Number(rota?.distance);
      const segundos = Number(rota?.duration);
      if (!Number.isFinite(metros) || metros <= 0) throw new Error('OSRM não retornou distância.');
      const km = metros / 1000;
      resultado = {
        distanciaKm: Math.round(km * 10) / 10,
        duracaoMin:
          Number.isFinite(segundos) && segundos > 0
            ? Math.max(1, Math.round(segundos / 60))
            : DistanciaApi.duracaoEstimadaMin(km),
        origem: 'OSRM',
      };
    } catch (erro) {
      // [RF09] OSRM fora do ar não pode impedir a venda; estimamos pela linha reta (Haversine).
      console.warn('[DistanciaApi] [RF09] OSRM indisponível, usando estimativa em linha reta:', (erro as Error).message);
      const km = DistanciaApi.haversineKm(origem, destino);
      resultado = {
        distanciaKm: Math.round(km * 10) / 10,
        duracaoMin: DistanciaApi.duracaoEstimadaMin(km),
        origem: 'HAVERSINE',
      };
    }

    this.cacheRotas.guardar(chave, resultado);
    return resultado;
  }

  /** Duração aproximada considerando a velocidade média configurada (ENTREGA_VELOCIDADE_KMH). */
  private static duracaoEstimadaMin(km: number): number {
    const configurada = Number(process.env.ENTREGA_VELOCIDADE_KMH);
    const velocidade = Number.isFinite(configurada) && configurada > 0 ? configurada : 22;
    return Math.max(1, Math.round((km / velocidade) * 60));
  }

  /**
   * [RF09] Origem: LOJA_LATITUDE/LOJA_LONGITUDE do .env; se ausentes, geocodifica o LOJA_CEP;
   * se ainda ausentes ou inválidos, usa coordenadas padrão da matriz da loja (Campinas/SP).
   */
  private async obterOrigem(): Promise<Coordenada> {
    if (this.origem) return this.origem;

    const lat = process.env.LOJA_LATITUDE?.trim();
    const lon = process.env.LOJA_LONGITUDE?.trim();
    if (lat && lon) {
      const c = { latitude: Number(lat), longitude: Number(lon) };
      if (DistanciaApi.coordenadaValida(c)) {
        this.origem = c;
        return c;
      }
      console.warn('[DistanciaApi] [RF09] LOJA_LATITUDE/LOJA_LONGITUDE inválidos no .env.');
    }

    const cepLoja = process.env.LOJA_CEP?.replace(/\D/g, '');
    if (cepLoja && cepLoja.length === 8) {
      try {
        const end = await this.cepApi.consultar(cepLoja);
        const c = await this.geocodificar({
          logradouro: end.logradouro,
          bairro: end.bairro,
          cidade: end.cidade,
          uf: end.uf,
          cep: end.cep,
        });
        if (c) {
          this.origem = c;
          return c;
        }
      } catch (erro) {
        console.warn('[DistanciaApi] [RF09] falha ao consultar CEP da loja:', (erro as Error).message);
      }
    }

    // [RF09] Fallback padrão para garantir funcionamento mesmo sem .env configurado
    console.info('[DistanciaApi] [RF09] Utilizando coordenadas padrão da matriz da loja (Campinas/SP).');
    this.origem = DistanciaApi.ORIGEM_PADRAO;
    return this.origem;
  }

  /**
   * [RF09] Geocodificação em 4 etapas para maximizar a taxa de sucesso no Nominatim:
   * 1. Busca estruturada limpa (removendo número de casa e abreviações do logradouro se houver)
   * 2. Busca livre (q: "${logradouro}${numero ? ' ' + numero : ''}, ${cidade} - ${uf}, Brasil")
   * 3. Busca por CEP se informado (postalcode: cep.replace(/\D/g, ''))
   * 4. Fallback centro da cidade (city: cidade, state: uf)
   */
  private async geocodificar(destino: DestinoEndereco): Promise<Coordenada | null> {
    const chave = `${destino.logradouro}|${destino.numero ?? ''}|${destino.bairro ?? ''}|${destino.cidade}|${destino.uf}|${destino.cep ?? ''}`.toLowerCase();
    const emCache = this.cache.obter(chave);
    if (emCache !== undefined) return emCache;

    let achou: Coordenada | null = null;

    // [RF09] 1. Busca estruturada limpa (removendo número de casa do logradouro se houver)
    const logradouroLimpo = (destino.logradouro ?? '')
      .replace(/[,\-–]?\s*(?:n[º°.]?\s*)?\d+.*$/i, '')
      .trim();

    if (logradouroLimpo) {
      achou = await this.buscar({
        street: logradouroLimpo,
        city: destino.cidade,
        state: destino.uf,
      });
    }

    // [RF09] 2. Busca livre ("${logradouro}${numero ? ' ' + numero : ''}, ${cidade} - ${uf}, Brasil")
    if (!achou && destino.logradouro) {
      const numTexto = destino.numero && destino.numero.trim() ? ` ${destino.numero.trim()}` : '';
      const consultaLivre = `${destino.logradouro}${numTexto}, ${destino.cidade} - ${destino.uf}, Brasil`;
      achou = await this.buscar({ q: consultaLivre });
    }

    // [RF09] 3. Busca por CEP se informado (postalcode)
    if (!achou && destino.cep) {
      const cepLimpo = destino.cep.replace(/\D/g, '');
      if (cepLimpo.length === 8) {
        achou = await this.buscar({ postalcode: cepLimpo });
      }
    }

    // [RF09] 4. Fallback centro da cidade
    if (!achou && destino.cidade) {
      achou = await this.buscar({ city: destino.cidade, state: destino.uf });
    }

    this.cache.guardar(chave, achou);
    return achou;
  }

  private async buscar(consulta: Record<string, string | undefined>): Promise<Coordenada | null> {
    try {
      await this.respeitarLimite();
      const params: Record<string, string> = {
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'br',
      };
      for (const [k, v] of Object.entries(consulta)) {
        if (v && v.trim()) params[k] = v.trim();
      }
      const r = await axios.get<NominatimItem[]>('https://nominatim.openstreetmap.org/search', {
        params,
        headers: { 'User-Agent': 'PetShopDelivery/1.0 (projeto academico)', 'Accept-Language': 'pt-BR' },
        timeout: 8000,
      });
      const item = Array.isArray(r.data) ? r.data[0] : undefined;
      if (!item) return null;
      const c = { latitude: Number(item.lat), longitude: Number(item.lon) };
      return DistanciaApi.coordenadaValida(c) ? c : null;
    } catch (erro) {
      console.warn('[DistanciaApi] [RF09] falha na requisição Nominatim:', (erro as Error).message);
      return null;
    }
  }

  private respeitarLimite(): Promise<void> {
    const vez = this.fila.then(async () => {
      const espera = this.ultimaChamada + DistanciaApi.INTERVALO_MS - Date.now();
      if (espera > 0) await new Promise<void>((ok) => setTimeout(ok, espera));
      this.ultimaChamada = Date.now();
    });
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  private static coordenadaValida(c: Coordenada): boolean {
    return (
      Number.isFinite(c.latitude) && Number.isFinite(c.longitude) &&
      Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180
    );
  }

  /** Distância em linha reta sobre a esfera terrestre. */
  private static haversineKm(a: Coordenada, b: Coordenada): number {
    const rad = (g: number): number => (g * Math.PI) / 180;
    const dLat = rad(b.latitude - a.latitude);
    const dLon = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
}

// ---------------------------------------------------------------------------
// API 3: cotação comercial do dólar (AwesomeAPI, com PTAX do Banco Central como reserva)
// ---------------------------------------------------------------------------

/** Cotação de USD/BRL obtida em tempo real. */
export interface CotacaoDolar {
  valor: number; // preço de 1 USD em BRL
  fonte: string;
  consultadaEm: string; // ISO
}

interface AwesomeApiResposta {
  USDBRL?: {
    bid?: string; // preço de compra (comercial)
    ask?: string; // preço de venda (comercial)
    timestamp?: string;
  };
}

interface BancoCentralResposta {
  value?: { cotacaoVenda?: number }[]; // PTAX: coleção OData com cotacaoVenda
}

export class CotacaoApi {
  private readonly cache = new CacheSimples<CotacaoDolar>();
  private static readonly CHAVE_CACHE = 'USD-BRL';
  private static readonly VALIDADE_MS = 10 * 60 * 1000; // 10 minutos

  /** Nunca lança erro de rede: devolve null para a tela seguir sem a cotação. */
  async consultarDolar(): Promise<CotacaoDolar | null> {
    const emCache = this.cache.obter(CotacaoApi.CHAVE_CACHE);
    if (emCache && Date.now() - new Date(emCache.consultadaEm).getTime() < CotacaoApi.VALIDADE_MS) {
      return emCache;
    }

    let cotacao: CotacaoDolar | null = null;
    try {
      cotacao = await this.awesomeApi();
    } catch {
      try {
        cotacao = await this.bancoCentral();
      } catch (erro) {
        console.warn('[CotacaoApi] não foi possível consultar o dólar:', (erro as Error).message);
      }
    }

    if (cotacao) this.cache.guardar(CotacaoApi.CHAVE_CACHE, cotacao);
    return cotacao;
  }

  private async awesomeApi(): Promise<CotacaoDolar | null> {
    const r = await axios.get<AwesomeApiResposta>('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      timeout: 6000,
    });
    const d = r.data?.USDBRL;
    // "ask" é a cotação de venda (comercial); se ausente, usa "bid".
    const texto = d?.ask ?? d?.bid;
    const valor = Number(texto);
    if (!Number.isFinite(valor) || valor <= 0) return null;
    return {
      valor: Math.round(valor * 10000) / 10000,
      fonte: 'AwesomeAPI (USD/BRL comercial)',
      consultadaEm: new Date().toISOString(),
    };
  }

  private async bancoCentral(): Promise<CotacaoDolar | null> {
    // PTAX do dia atual (formato padrão do BC: 2 casas decimais, quando fechada).
    const hoje = new Date();
    const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const r = await axios.get<BancoCentralResposta>(
      `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)`,
      {
        params: { '@dataCotacao': `'${data}'`, '$format': 'json', '$select': 'cotacaoVenda' },
        timeout: 6000,
      },
    );
    const valor = Number(r.data?.value?.[0]?.cotacaoVenda);
    if (!Number.isFinite(valor) || valor <= 0) return null;
    return {
      valor: Math.round(valor * 10000) / 10000,
      fonte: 'Banco Central (PTAX)',
      consultadaEm: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// [RF11] API 4: envio de e-mails transacionais via SMTP (nodemailer)
// ---------------------------------------------------------------------------
export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

export interface ResultadoEnvioEmail {
  enviado: boolean;
  mensagem: string;
}

export class EmailApi {
  private readonly transporte: Transporter;
  private readonly configurado: boolean;
  private readonly remetente: string;

  constructor() {
    const host = process.env.SMTP_HOST?.trim();
    const portaEnv = Number(process.env.SMTP_PORT);
    const seguro = (process.env.SMTP_SEGURANCA ?? '').trim().toLowerCase() === 'true';
    const porta = Number.isFinite(portaEnv) && portaEnv > 0 ? portaEnv : seguro ? 465 : 587;
    const usuario = process.env.SMTP_USER?.trim();
    const senha = process.env.SMTP_PASS?.trim() ?? '';
    const email = process.env.EMAIL_REMETENTE?.trim() || 'no-reply@petshop.local';
    const nome = process.env.EMAIL_REMETENTE_NOME?.trim() || 'Pet Shop Delivery';
    this.remetente = `${nome} <${email}>`;
    this.configurado = Boolean(host);

    // [RF11] Sem SMTP_HOST o envio é simulado no log sem bloquear operações e sem falsos alertas
    if (!host) {
      this.transporte = nodemailer.createTransport({ jsonTransport: true });
      return;
    }

    // [RF11] Com SMTP_HOST configurado, aplica portas padrão (465 SSL / 587 STARTTLS) e autenticação segura
    this.transporte = nodemailer.createTransport({
      host,
      port: porta,
      secure: porta === 465 || seguro,
      auth: usuario ? { user: usuario, pass: senha } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
  }

  /** [RF11] Nunca lança para fora — falha de e-mail jamais derruba a criação do pedido. */
  async enviar(mensagem: MensagemEmail): Promise<ResultadoEnvioEmail> {
    try {
      const info = await this.transporte.sendMail({
        from: this.remetente,
        to: mensagem.para,
        subject: mensagem.assunto,
        text: mensagem.texto,
        html: mensagem.html,
      });

      // [RF11] Em modo simulação (sem SMTP), registra no log e retorna enviado: true com mensagem clara
      if (!this.configurado) {
        console.log(
          `[EmailApi] [RF11] SMTP não configurado. E-mail registrado no log (modo simulação):\n` +
            `Para: ${mensagem.para}\nAssunto: ${mensagem.assunto}\n${mensagem.texto}`,
        );
        return {
          enviado: true,
          mensagem: 'E-mail de confirmação gerado e registrado no log (modo simulação).',
        };
      }

      const rejeitados = info.rejected;
      if (Array.isArray(rejeitados) && rejeitados.length > 0) {
        console.warn('[EmailApi] [RF11] destinatário rejeitado pelo servidor:', rejeitados.join(', '));
        return { enviado: false, mensagem: 'O servidor de e-mail recusou o destinatário.' };
      }
      return { enviado: true, mensagem: 'E-mail de confirmação enviado ao cliente.' };
    } catch (erro) {
      console.error('[EmailApi] [RF11] falha ao enviar e-mail:', (erro as Error).message);
      return { enviado: false, mensagem: 'Não foi possível enviar o e-mail de confirmação.' };
    }
  }
}
