// Tipos e métodos da ponte do módulo de pedidos (scripts globais: sem import/export).

type StatusPedidoDTO = 'PENDENTE' | 'EM_SEPARACAO' | 'SAIU_PARA_ENTREGA' | 'ENTREGUE' | 'CANCELADO';

interface ItemPedidoDTO {
  id: number;
  produtoId: number;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

interface PedidoDTO {
  id: number;
  clienteId: number;
  clienteNome: string;
  entregadorId: number | null;
  entregadorNome: string | null;
  usuarioId: number;
  usuarioNome: string;
  dataPedido: string;
  statusPedido: StatusPedidoDTO;
  distanciaKm: number | null;
  valorFrete: number;
  valorTotal: number;
  // RF09: previsão calculada no main (ISO) e, na criação, o resultado do e-mail (RF11).
  previsaoEntrega: string | null;
  emailConfirmacao?: { enviado: boolean; mensagem: string };
  itens: ItemPedidoDTO[];
}

interface ItemPedidoFormDTO {
  produtoId: number;
  quantidade: number;
}

interface DadosPedidoDTO {
  clienteId: number;
  entregadorId: number | null;
  distanciaKm: number | null;
  valorFrete: number;
  statusPedido: StatusPedidoDTO;
  itens: ItemPedidoFormDTO[];
}

interface FiltroPedidoDTO {
  busca?: string;
  status?: StatusPedidoDTO;
  clienteId?: number;
  entregadorId?: number;
}

interface CotacaoDolarDTO {
  valor: number;
  fonte: string;
  consultadaEm: string;
}

interface PontePreload {
  listarPedidos(f: FiltroPedidoDTO): Promise<RespostaIpc<PedidoDTO[]>>;
  obterPedido(id: number): Promise<RespostaIpc<PedidoDTO>>;
  criarPedido(d: DadosPedidoDTO): Promise<RespostaIpc<PedidoDTO>>;
  atualizarPedido(id: number, d: DadosPedidoDTO): Promise<RespostaIpc<PedidoDTO>>;
  alterarStatusPedido(id: number, d: { statusPedido: StatusPedidoDTO; entregadorId: number | null }): Promise<RespostaIpc<PedidoDTO>>;
  cancelarPedido(id: number, d: { observacao?: string | null }): Promise<RespostaIpc<PedidoDTO>>;
  excluirPedido(id: number): Promise<RespostaIpc<void>>;
  consultarCotacaoDolar(): Promise<RespostaIpc<CotacaoDolarDTO>>;
}
