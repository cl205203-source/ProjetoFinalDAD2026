// [RF09] Cálculo de distância (API de rotas OSRM/Nominatim com fallbacks) e taxa de entrega.
// O frete é sempre validado e calculado no backend (processo main).
import { AppError } from '../compartilhado/erros';
import { ClienteRepository } from '../clientes/cliente.repository';
import { DistanciaApi } from '../integrations';
import { TaxaEntregaPublica } from './entrega.model';

/** Parâmetros de cobrança da entrega configurados via variáveis de ambiente (.env). */
export interface ConfiguracaoEntrega {
  taxaBase: number;
  taxaPorKm: number;
  freteGratisAcima: number;
  tempoPreparoMin: number;
  velocidadeKmh: number;
}

function numeroEnv(nome: string, padrao: number, minimo = 0): number {
  const n = Number(process.env[nome]);
  return Number.isFinite(n) && n >= minimo ? n : padrao;
}

/** [RF09] Carrega parâmetros de frete (.env): taxa base, taxa por km e teto para frete grátis. */
function configuracaoDoAmbiente(): ConfiguracaoEntrega {
  return {
    taxaBase: numeroEnv('ENTREGA_TAXA_BASE', 6),
    taxaPorKm: numeroEnv('ENTREGA_TAXA_POR_KM', 1.8),
    freteGratisAcima: numeroEnv('ENTREGA_FRETE_GRATIS_ACIMA', 0),
    tempoPreparoMin: numeroEnv('ENTREGA_TEMPO_PREPARO_MIN', 35),
    velocidadeKmh: numeroEnv('ENTREGA_VELOCIDADE_KMH', 22, 1),
  };
}

export class TaxaEntregaService {
  private readonly config: ConfiguracaoEntrega;

  constructor(
    private readonly clientes: ClienteRepository,
    private readonly distanciaApi: DistanciaApi,
    config: ConfiguracaoEntrega = configuracaoDoAmbiente(),
  ) {
    this.config = config;
  }

  /**
   * [RF09] Calcula distância, duração, taxa e previsão de entrega para o cliente.
   * Tenta a API de rotas (OSRM); se indisponível, usa fallback Haversine ou a distância cadastrada do cliente.
   * Aplica taxaBase + taxaPorKm * distância, com regra de frete grátis caso o valor dos itens atinja o limite.
   */
  async calcular(clienteId: number, valorItens = 0): Promise<TaxaEntregaPublica> {
    const cliente = await this.clientes.buscarPorId(clienteId);
    if (!cliente) throw new AppError('Cliente não encontrado.', 'NAO_ENCONTRADO');

    // [RF09] Geocodificação Nominatim + Roteamento OSRM (com fallback Haversine)
    const rota = await this.distanciaApi.calcularRota({
      logradouro: cliente.logradouro,
      numero: cliente.numero,
      bairro: cliente.bairro,
      cidade: cliente.cidade,
      uf: cliente.uf,
      cep: cliente.cep,
    });

    const distanciaKm = rota?.distanciaKm ?? cliente.distanciaKm;
    const duracaoMin = rota
      ? rota.duracaoMin
      : distanciaKm === null
        ? null
        : Math.max(1, Math.round((distanciaKm / this.config.velocidadeKmh) * 60));

    // [RF09] Frete grátis vale para o valor dos itens (conforme ENTREGA_FRETE_GRATIS_ACIMA).
    const valor = Number.isFinite(valorItens) && valorItens > 0 ? valorItens : 0;
    const freteGratis =
      this.config.freteGratisAcima > 0 && valor >= this.config.freteGratisAcima;

    let taxaEntrega: number | null = null;
    if (freteGratis) {
      taxaEntrega = 0;
    } else if (distanciaKm !== null) {
      taxaEntrega = TaxaEntregaService.arredondar(this.config.taxaBase + this.config.taxaPorKm * distanciaKm);
    }

    let origem: TaxaEntregaPublica['origem'];
    let aviso: string | null = null;
    if (rota) {
      origem = rota.origem;
      if (rota.origem === 'HAVERSINE') {
        aviso = 'API de rotas indisponível: distância estimada em linha reta.';
      }
    } else if (cliente.distanciaKm !== null) {
      origem = 'DISTANCIA_CADASTRADA';
      aviso = 'API de rotas indisponível: usando a distância cadastrada do cliente.';
    } else {
      origem = 'INDISPONIVEL';
      aviso =
        'Não foi possível calcular a distância deste cliente. Recalcule o cadastro do cliente ou informe a taxa manualmente.';
    }

    if (freteGratis) {
      const nota = 'Frete grátis aplicado pelo valor dos itens.';
      aviso = aviso ? `${aviso} ${nota}` : nota;
    }

    // [RF09] Previsão de entrega somando tempo de preparo + duração do trajeto
    const minutosTotais = this.config.tempoPreparoMin + (duracaoMin ?? 30);
    const previsaoEntrega = new Date(Date.now() + minutosTotais * 60 * 1000).toISOString();

    return {
      clienteId,
      distanciaKm,
      duracaoMin,
      taxaEntrega,
      previsaoEntrega,
      origem,
      freteGratis,
      aviso,
    };
  }

  private static arredondar(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }
}
