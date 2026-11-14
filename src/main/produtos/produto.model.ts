// Model de produto (RF02).

export const CATEGORIAS = ['RACAO', 'BRINQUEDO', 'ACESSORIO', 'HIGIENE', 'SAUDE', 'OUTROS'] as const;
export type CategoriaProduto = (typeof CATEGORIAS)[number];

export interface ProdutoPublico {
  id: number;
  nome: string;
  descricao: string | null;
  categoria: CategoriaProduto;
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

export class Produto {
  constructor(
    readonly id: number,
    readonly nome: string,
    readonly descricao: string | null,
    readonly categoria: CategoriaProduto,
    readonly marca: string,
    readonly precoCusto: number,
    readonly precoVenda: number,
    readonly isImportado: boolean,
    readonly estoqueAtual: number,
    readonly estoqueMinimo: number,
    readonly ativo: boolean,
    readonly criadoEm: Date,
  ) {}

  estoqueBaixo(): boolean {
    return this.estoqueAtual <= this.estoqueMinimo;
  }

  paraPublico(): ProdutoPublico {
    return {
      id: this.id,
      nome: this.nome,
      descricao: this.descricao,
      categoria: this.categoria,
      marca: this.marca,
      precoCusto: this.precoCusto,
      precoVenda: this.precoVenda,
      isImportado: this.isImportado,
      estoqueAtual: this.estoqueAtual,
      estoqueMinimo: this.estoqueMinimo,
      estoqueBaixo: this.estoqueBaixo(),
      ativo: this.ativo,
      criadoEm: this.criadoEm.toISOString(),
    };
  }
}
