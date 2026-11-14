// Tipos e métodos da ponte do módulo de estoque (scripts globais: sem import/export).

type TipoMov = 'ENTRADA' | 'SAIDA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO' | 'ESTORNO';

interface MovimentacaoDTO {
  id: number;
  produtoId: number;
  produtoNome: string;
  pedidoId: number | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  tipo: TipoMov;
  quantidade: number;
  dataMovimentacao: string;
  observacao: string | null;
}

interface PontePreload {
  registrarMovimentacao(d: { produtoId: number; tipo: TipoMov; quantidade: number; observacao: string }): Promise<RespostaIpc<ProdutoDTO>>;
  listarMovimentacoes(f: { produtoId?: number; limite?: number }): Promise<RespostaIpc<MovimentacaoDTO[]>>;
}
