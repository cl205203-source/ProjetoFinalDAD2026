// Integrações com APIs externas: CepApi, DistanciaApi, CotacaoApi, EmailApi
// Todas rodam no processo main (o renderer não tem acesso à rede por causa da CSP).
import axios from 'axios';
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
// API 2: distância até a loja (geocodificação Nominatim/OpenStreetMap + Haversine)
// ---------------------------------------------------------------------------
interface NominatimItem {
  lat: string;
  lon: string;
}

export class DistanciaApi {
  private static readonly INTERVALO_MS = 1100; // Nominatim permite no máximo 1 requisição/segundo
  private readonly cache = new CacheSimples<Coordenada | null>();
  private origem: Coordenada | null = null;
  private ultimaChamada = 0;
  private fila: Promise<void> = Promise.resolve();

  constructor(private readonly cepApi: CepApi) {}

  /**
   * Distância aproximada, em km e em linha reta, entre a loja e o endereço.
   * Nunca lança erro: se a API estiver fora do ar ou o endereço não for encontrado, devolve null
   * (o cadastro do cliente continua funcionando e a distância pode ser recalculada depois).
   */
  async calcularKm(e: { logradouro: string; cidade: string; uf: string }): Promise<number | null> {
    try {
      const origem = await this.obterOrigem();
      if (!origem) return null;
      const destino = await this.geocodificar(e.logradouro, e.cidade, e.uf);
      if (!destino) return null;
      return Math.round(DistanciaApi.haversineKm(origem, destino) * 10) / 10;
    } catch (erro) {
      console.warn('[DistanciaApi] não foi possível calcular a distância:', (erro as Error).message);
      return null;
    }
  }

  /** Origem: LOJA_LATITUDE/LOJA_LONGITUDE do .env; se ausentes, geocodifica o LOJA_CEP. */
  private async obterOrigem(): Promise<Coordenada | null> {
    if (this.origem) return this.origem;

    const lat = process.env.LOJA_LATITUDE?.trim();
    const lon = process.env.LOJA_LONGITUDE?.trim();
    if (lat && lon) {
      const c = { latitude: Number(lat), longitude: Number(lon) };
      if (DistanciaApi.coordenadaValida(c)) return (this.origem = c);
      console.warn('[DistanciaApi] LOJA_LATITUDE/LOJA_LONGITUDE inválidos no .env.');
    }

    const cepLoja = process.env.LOJA_CEP?.replace(/\D/g, '');
    if (!cepLoja) {
      console.warn('[DistanciaApi] defina LOJA_CEP (ou LOJA_LATITUDE e LOJA_LONGITUDE) no .env.');
      return null;
    }
    const end = await this.cepApi.consultar(cepLoja);
    const c = await this.geocodificar(end.logradouro, end.cidade, end.uf);
    if (c) this.origem = c;
    return c;
  }

  /** Tenta rua + cidade; se não achar, cai para o centro da cidade (resultado mais aproximado). */
  private async geocodificar(logradouro: string, cidade: string, uf: string): Promise<Coordenada | null> {
    const chave = `${logradouro}|${cidade}|${uf}`.toLowerCase();
    const emCache = this.cache.obter(chave);
    if (emCache !== undefined) return emCache;

    let achou: Coordenada | null = null;
    if (logradouro) achou = await this.buscar({ street: logradouro, city: cidade, state: uf });
    if (!achou) achou = await this.buscar({ city: cidade, state: uf });

    this.cache.guardar(chave, achou);
    return achou;
  }

  private async buscar(consulta: { street?: string; city: string; state: string }): Promise<Coordenada | null> {
    await this.respeitarLimite();
    const r = await axios.get<NominatimItem[]>('https://nominatim.openstreetmap.org/search', {
      params: { ...consulta, country: 'Brazil', format: 'jsonv2', limit: 1 },
      headers: { 'User-Agent': 'PetShopDelivery/1.0 (projeto academico)', 'Accept-Language': 'pt-BR' },
      timeout: 8000,
    });
    const item = Array.isArray(r.data) ? r.data[0] : undefined;
    if (!item) return null;
    const c = { latitude: Number(item.lat), longitude: Number(item.lon) };
    return DistanciaApi.coordenadaValida(c) ? c : null;
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
