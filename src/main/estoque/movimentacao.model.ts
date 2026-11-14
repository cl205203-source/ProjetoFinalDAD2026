// Model de movimentação de estoque (RF04) e item usado nas baixas de pedido (RF03).

export const TIPOS_MOVIMENTACAO = ['ENTRADA', 'SAIDA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'ESTORNO'] as const;
export type TipoMovimentacao = (typeof TIPOS_MOVIMENTACAO)[number];

/** Tipos que o usuário pode registrar manualmente. SAIDA e ESTORNO só nascem de pedidos. */
export const TIPOS_MANUAIS = ['ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'] as const;

export interface MovimentacaoPublica {
  id: number;
  produtoId: number;
  produtoNome: string;
  pedidoId: number | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  dataMovimentacao: string;
  observacao: string | null;
}

export interface DadosMovimentacao {
  id: number;
  produtoId: number;
  produtoNome: string;
  pedidoId: number | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  dataMovimentacao: Date;
  observacao: string | null;
}

export class Movimentacao {
  constructor(private readonly d: DadosMovimentacao) {}

  paraPublico(): MovimentacaoPublica {
    return { ...this.d, dataMovimentacao: this.d.dataMovimentacao.toISOString() };
  }
}

/** Item usado nas validações/baixas de estoque (será enviado pelo módulo de pedidos). */
export interface ItemEstoque {
  produtoId: number;
  quantidade: number;
}
