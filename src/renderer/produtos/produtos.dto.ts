// Tipos e métodos da ponte do módulo de produtos (scripts globais: sem import/export).

type Categoria = 'RACAO' | 'BRINQUEDO' | 'ACESSORIO' | 'HIGIENE' | 'SAUDE' | 'OUTROS';

interface ProdutoDTO {
  id: number;
  nome: string;
  descricao: string | null;
  categoria: Categoria;
  marca: string;
  precoCusto: number;
  precoVenda: number;
  isImportado: boolean;
  estoqueAtual: number;
  estoqueMinimo: number;
  estoqueBaixo: boolean;
  ativo: boolean;
  criadoEm: string;
}

interface DadosProdutoDTO {
  nome: string;
  descricao: string;
  categoria: Categoria;
  marca: string;
  precoCusto: number;
  precoVenda: number;
  isImportado: boolean;
  estoqueMinimo: number;
}

interface FiltroProdutoDTO {
  busca?: string;
  categoria?: Categoria;
  status: 'ATIVOS' | 'INATIVOS' | 'TODOS';
  somenteEstoqueBaixo: boolean;
}

interface PontePreload {
  listarProdutos(f: FiltroProdutoDTO): Promise<RespostaIpc<ProdutoDTO[]>>;
  criarProduto(d: DadosProdutoDTO & { estoqueAtual: number }): Promise<RespostaIpc<ProdutoDTO>>;
  atualizarProduto(id: number, d: DadosProdutoDTO): Promise<RespostaIpc<ProdutoDTO>>;
  inativarProduto(id: number): Promise<RespostaIpc<void>>;
  reativarProduto(id: number): Promise<RespostaIpc<void>>;
  excluirProduto(id: number): Promise<RespostaIpc<void>>;
}
