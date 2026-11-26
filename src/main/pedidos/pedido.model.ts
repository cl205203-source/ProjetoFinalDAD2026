// Model de pedidos e itens (RF08/RF11).

export const STATUS_PEDIDO = [
  'PENDENTE',
  'EM_SEPARACAO',
  'SAIU_PARA_ENTREGA',
  'ENTREGUE',
  'CANCELADO',
] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

/** Item persistedo em itens_pedido (preço_unitario é o valor aplicado no momento da venda). */
export interface ItemPedidoPublico {
  id: number;
  produtoId: number;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

/** RF11: resultado do envio do e-mail de confirmação (nunca impede a criação do pedido). */
export interface ResultadoEmailConfirmacao {
  enviado: boolean;
  mensagem: string;
}

/** Pedido devolvido ao renderer ( somente leitura, sem dados sensíveis). */
export interface PedidoPublico {
  id: number;
  clienteId: number;
  clienteNome: string;
  entregadorId: number | null;
  entregadorNome: string | null;
  usuarioId: number;
  usuarioNome: string;
  dataPedido: string;
  statusPedido: StatusPedido;
  distanciaKm: number | null;
  valorFrete: number;
  valorTotal: number;
  /** RF09: previsão calculada no main (ISO); null quando não foi possível calcular. */
  previsaoEntrega: string | null;
  itens: ItemPedidoPublico[];
  /** RF11: presente quando um e-mail de confirmação/atualização é disparado (criação ou mudança de status). */
  emailConfirmacao?: ResultadoEmailConfirmacao;
}

export interface DadosItemPedido {
  id: number;
  produtoId: number;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

export interface DadosPedido {
  id: number;
  clienteId: number;
  clienteNome: string;
  entregadorId: number | null;
  entregadorNome: string | null;
  usuarioId: number;
  usuarioNome: string;
  dataPedido: Date;
  statusPedido: StatusPedido;
  distanciaKm: number | null;
  valorFrete: number;
  valorTotal: number;
  previsaoEntrega: Date | null;
  itens: DadosItemPedido[];
}

export class Pedido {
  constructor(private readonly d: DadosPedido) {}

  get id(): number {
    return this.d.id;
  }

  get status(): StatusPedido {
    return this.d.statusPedido;
  }

  get entregadorId(): number | null {
    return this.d.entregadorId;
  }

  get usuarioId(): number {
    return this.d.usuarioId;
  }

  get itens(): DadosItemPedido[] {
    return this.d.itens;
  }

  get previsaoEntrega(): Date | null {
    return this.d.previsaoEntrega;
  }

  estaCancelado(): boolean {
    return this.d.statusPedido === 'CANCELADO';
  }

  paraPublico(): PedidoPublico {
    return {
      ...this.d,
      dataPedido: this.d.dataPedido.toISOString(),
      // RF09: a previsão trafega como ISO (ou null).
      previsaoEntrega: this.d.previsaoEntrega ? this.d.previsaoEntrega.toISOString() : null,
      itens: this.d.itens.map((i) => ({ ...i })),
    };
  }
}
