// [RF09][RF10] Tipos e métodos da ponte da central de entregas (scripts globais do renderer).
// [RF09] Taxa de entrega calculada no main via geolocalização e rotas.
// [RF10] Painel de entregas em tempo real (polling 5s), vínculo de entregador e ciclo de vida.

interface TaxaEntregaDTO {
  clienteId: number;
  distanciaKm: number | null;
  duracaoMin: number | null;
  taxaEntrega: number | null;
  previsaoEntrega: string;
  origem: string;
  freteGratis: boolean;
  aviso: string | null;
}

interface ItemResumoEntregaDTO {
  produtoId: number;
  produtoNome: string;
  quantidade: number;
  subtotal: number;
}

interface EntregaDTO {
  pedidoId: number;
  clienteId: number;
  clienteNome: string;
  clienteEmail: string;
  clienteTelefone: string;
  endereco: string;
  status: StatusPedidoDTO;
  dataPedido: string;
  distanciaKm: number | null;
  valorFrete: number;
  valorTotal: number;
  previsaoEntrega: string | null;
  entregadorId: number | null;
  entregadorNome: string | null;
  entregadorStatus: StatusEntregadorDTO | null;
  itens: ItemResumoEntregaDTO[];
  itensResumo: string;
}

interface EntregadorComEntregasDTO {
  id: number;
  nome: string;
  telefone: string;
  veiculo: string;
  placa: string | null;
  status: StatusEntregadorDTO;
  entregas: EntregaDTO[];
}

interface EntregadorDisponivelDTO {
  id: number;
  nome: string;
  telefone: string;
  veiculo: string;
}

interface PainelEntregasDTO {
  atualizadoEm: string;
  resumo: {
    ativas: number;
    emRota: number;
    entregadoresEmRota: number;
    semEntregador: number;
  };
  entregadores: EntregadorComEntregasDTO[];
  semEntregador: EntregaDTO[];
  disponiveis: EntregadorDisponivelDTO[];
}

interface PontePreload {
  // [RF09] Cálculo da taxa de entrega e previsão sob demanda
  calcularTaxaEntrega(d: { clienteId: number; valorItens?: number }): Promise<RespostaIpc<TaxaEntregaDTO>>;
  // [RF10] Painel em tempo real e ações de entrega
  painelEntregas(): Promise<RespostaIpc<PainelEntregasDTO>>;
  vincularEntregador(d: { pedidoId: number; entregadorId: number }): Promise<RespostaIpc<PedidoDTO>>;
  alterarStatusEntrega(d: { pedidoId: number; statusPedido: StatusPedidoDTO }): Promise<RespostaIpc<PedidoDTO>>;
}
