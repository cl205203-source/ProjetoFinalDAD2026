// [RF09][RF10] Model da central de entregas e tipos públicos compartilhados com o renderer.
import type { StatusEntregador } from '../entregadores/entregador.model';
import type { StatusPedido } from '../pedidos/pedido.model';

/** [RF09] Origem da distância usada no cálculo da taxa e previsão de entrega. */
export type OrigemDistancia = 'OSRM' | 'HAVERSINE' | 'DISTANCIA_CADASTRADA' | 'INDISPONIVEL';

/** Item resumido exibido nos cards de entrega. */
export interface ItemResumoEntrega {
  produtoId: number;
  produtoNome: string;
  quantidade: number;
  subtotal: number;
}

/** [RF09] Resultado do cálculo de distância, duração, taxa e previsão para um cliente. */
export interface TaxaEntregaPublica {
  clienteId: number;
  distanciaKm: number | null;
  duracaoMin: number | null;
  taxaEntrega: number | null;
  previsaoEntrega: string; // ISO
  origem: OrigemDistancia;
  freteGratis: boolean;
  aviso: string | null;
}

/** [RF10] Pedido ativo visto pela central de entregas com dados de entrega e entregador. */
export interface EntregaPublica {
  pedidoId: number;
  clienteId: number;
  clienteNome: string;
  clienteEmail: string;
  clienteTelefone: string;
  endereco: string;
  status: StatusPedido;
  dataPedido: string;
  distanciaKm: number | null;
  valorFrete: number;
  valorTotal: number;
  previsaoEntrega: string | null;
  entregadorId: number | null;
  entregadorNome: string | null;
  entregadorStatus: StatusEntregador | null;
  itens: ItemResumoEntrega[];
  itensResumo: string;
}

/** [RF10] Entregador com as entregas atualmente sob sua responsabilidade. */
export interface EntregadorComEntregasPublico {
  id: number;
  nome: string;
  telefone: string;
  veiculo: string;
  placa: string | null;
  status: StatusEntregador;
  entregas: EntregaPublica[];
}

/** [RF10] Entregador apto e livre a receber uma nova entrega (status DISPONIVEL). */
export interface EntregadorDisponivelPublico {
  id: number;
  nome: string;
  telefone: string;
  veiculo: string;
}

/** [RF10] Payload completo do painel de entregas (polling de 5s no renderer). */
export interface PainelEntregasPublico {
  atualizadoEm: string;
  resumo: {
    ativas: number;
    emRota: number;
    entregadoresEmRota: number;
    semEntregador: number;
  };
  entregadores: EntregadorComEntregasPublico[];
  semEntregador: EntregaPublica[];
  disponiveis: EntregadorDisponivelPublico[];
}
