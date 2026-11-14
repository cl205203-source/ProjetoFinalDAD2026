// Repository de produtos: único lugar com SQL da tabela produtos.
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { Executor } from '../compartilhado/database';
import { CategoriaProduto, Produto } from './produto.model';

interface ProdutoRow extends RowDataPacket {
  id: number;
  nome: string;
  descricao: string | null;
  categoria: CategoriaProduto;
  marca: string;
  preco_custo: number;
  preco_venda: number;
  is_importado: number;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: number;
  criado_em: Date;
}

export interface FiltroProduto {
  busca?: string;
  categoria?: CategoriaProduto;
  status: 'ATIVOS' | 'INATIVOS' | 'TODOS';
  somenteEstoqueBaixo: boolean;
}

export interface DadosProduto {
  nome: string;
  descricao: string | null;
  categoria: CategoriaProduto;
  marca: string;
  precoCusto: number;
  precoVenda: number;
  isImportado: boolean;
  estoqueMinimo: number;
}

export class ProdutoRepository {
  private static readonly COLUNAS =
    'id, nome, descricao, categoria, marca, preco_custo, preco_venda, is_importado, estoque_atual, estoque_minimo, ativo, criado_em';

  constructor(private readonly pool: Pool) {}

  private static mapear(r: ProdutoRow): Produto {
    return new Produto(
      r.id, r.nome, r.descricao, r.categoria, r.marca,
      Number(r.preco_custo), Number(r.preco_venda), Boolean(r.is_importado),
      r.estoque_atual, r.estoque_minimo, Boolean(r.ativo), new Date(r.criado_em),
    );
  }

  async listar(f: FiltroProduto): Promise<Produto[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (f.busca) {
      const termo = `%${f.busca.replace(/[\\%_]/g, '\\$&')}%`;
      where.push('(nome LIKE ? OR marca LIKE ?)');
      params.push(termo, termo);
    }
    if (f.categoria) {
      where.push('categoria = ?');
      params.push(f.categoria);
    }
    if (f.status === 'ATIVOS') where.push('ativo = 1');
    if (f.status === 'INATIVOS') where.push('ativo = 0');
    if (f.somenteEstoqueBaixo) where.push('estoque_atual <= estoque_minimo');

    const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<ProdutoRow[]>(
      `SELECT ${ProdutoRepository.COLUNAS} FROM produtos ${clausula} ORDER BY ativo DESC, nome ASC`,
      params,
    );
    return rows.map(ProdutoRepository.mapear);
  }

  async buscarPorId(id: number, exec: Executor = this.pool): Promise<Produto | null> {
    const [rows] = await exec.execute<ProdutoRow[]>(
      `SELECT ${ProdutoRepository.COLUNAS} FROM produtos WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows.length ? ProdutoRepository.mapear(rows[0]) : null;
  }

  async criar(d: DadosProduto, estoqueAtual: number, exec: Executor = this.pool): Promise<number> {
    const [res] = await exec.execute<ResultSetHeader>(
      `INSERT INTO produtos
         (nome, descricao, categoria, marca, preco_custo, preco_venda, is_importado, estoque_atual, estoque_minimo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.nome, d.descricao, d.categoria, d.marca, d.precoCusto, d.precoVenda, d.isImportado ? 1 : 0, estoqueAtual, d.estoqueMinimo],
    );
    return res.insertId;
  }

  /** Não altera estoque_atual: o saldo só muda via ajustarEstoque (movimentação). */
  async atualizar(id: number, d: DadosProduto): Promise<void> {
    await this.pool.execute(
      `UPDATE produtos
          SET nome = ?, descricao = ?, categoria = ?, marca = ?, preco_custo = ?,
              preco_venda = ?, is_importado = ?, estoque_minimo = ?
        WHERE id = ?`,
      [d.nome, d.descricao, d.categoria, d.marca, d.precoCusto, d.precoVenda, d.isImportado ? 1 : 0, d.estoqueMinimo, id],
    );
  }

  async definirAtivo(id: number, ativo: boolean): Promise<void> {
    await this.pool.execute('UPDATE produtos SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  }

  /** O produto já aparece em pedidos ou movimentações? (RN04) */
  async possuiVinculos(id: number): Promise<boolean> {
    const [rows] = await this.pool.execute<(RowDataPacket & { total: number })[]>(
      `SELECT (SELECT COUNT(*) FROM itens_pedido WHERE produto_id = ?)
            + (SELECT COUNT(*) FROM movimentacoes_estoque WHERE produto_id = ?) AS total`,
      [id, id],
    );
    return Number(rows[0].total) > 0;
  }

  async excluir(id: number): Promise<void> {
    await this.pool.execute('DELETE FROM produtos WHERE id = ?', [id]);
  }

  /**
   * Soma `delta` (positivo ou negativo) ao saldo de forma atômica.
   * Retorna false se o saldo ficaria negativo (nada é alterado).
   */
  async ajustarEstoque(id: number, delta: number, exec: Executor = this.pool): Promise<boolean> {
    const [res] = await exec.execute<ResultSetHeader>(
      'UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ? AND estoque_atual + ? >= 0',
      [delta, id, delta],
    );
    return res.affectedRows === 1;
  }
}
