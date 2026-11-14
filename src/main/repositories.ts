// Repositories: único lugar com SQL (um por tabela). Sempre com prepared statements (?).
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  CategoriaProduto, CredencialUsuario, Movimentacao, PerfilUsuario, Produto, TipoMovimentacao, Usuario,
} from './models';

interface UsuarioRow extends RowDataPacket {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  ativo: number;
  criado_em: Date;
}

interface CredencialRow extends UsuarioRow {
  senha_hash: string;
}

interface TotalRow extends RowDataPacket {
  total: number;
}

export class UsuarioRepository {
  private static readonly COLUNAS = 'id, nome, email, perfil, ativo, criado_em';

  constructor(private readonly pool: Pool) {}

  private static mapear(r: UsuarioRow): Usuario {
    return new Usuario(r.id, r.nome, r.email, r.perfil, Boolean(r.ativo), new Date(r.criado_em));
  }

  async contar(): Promise<number> {
    const [rows] = await this.pool.execute<TotalRow[]>('SELECT COUNT(*) AS total FROM usuarios');
    return Number(rows[0].total);
  }

  async listar(): Promise<Usuario[]> {
    const [rows] = await this.pool.execute<UsuarioRow[]>(
      `SELECT ${UsuarioRepository.COLUNAS} FROM usuarios ORDER BY ativo DESC, nome ASC`,
    );
    return rows.map(UsuarioRepository.mapear);
  }

  async buscarPorId(id: number): Promise<Usuario | null> {
    const [rows] = await this.pool.execute<UsuarioRow[]>(
      `SELECT ${UsuarioRepository.COLUNAS} FROM usuarios WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows.length ? UsuarioRepository.mapear(rows[0]) : null;
  }

  /** Única consulta que devolve o hash da senha. Só o serviço de autenticação usa. */
  async buscarCredencialPorEmail(email: string): Promise<CredencialUsuario | null> {
    const [rows] = await this.pool.execute<CredencialRow[]>(
      `SELECT ${UsuarioRepository.COLUNAS}, senha_hash FROM usuarios WHERE email = ? LIMIT 1`,
      [email],
    );
    if (!rows.length) return null;
    return { usuario: UsuarioRepository.mapear(rows[0]), senhaHash: rows[0].senha_hash };
  }

  async buscarSenhaHashPorId(id: number): Promise<string | null> {
    const [rows] = await this.pool.execute<(RowDataPacket & { senha_hash: string })[]>(
      'SELECT senha_hash FROM usuarios WHERE id = ? LIMIT 1',
      [id],
    );
    return rows.length ? rows[0].senha_hash : null;
  }

  async emailEmUso(email: string, ignorarId: number | null = null): Promise<boolean> {
    const [rows] = await this.pool.execute<TotalRow[]>(
      'SELECT COUNT(*) AS total FROM usuarios WHERE email = ? AND id <> ?',
      [email, ignorarId ?? 0],
    );
    return Number(rows[0].total) > 0;
  }

  async criar(d: { nome: string; email: string; senhaHash: string; perfil: PerfilUsuario }): Promise<number> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, ?)',
      [d.nome, d.email, d.senhaHash, d.perfil],
    );
    return res.insertId;
  }

  async atualizar(id: number, d: { nome: string; email: string; perfil: PerfilUsuario }): Promise<void> {
    await this.pool.execute('UPDATE usuarios SET nome = ?, email = ?, perfil = ? WHERE id = ?', [
      d.nome,
      d.email,
      d.perfil,
      id,
    ]);
  }

  async atualizarSenha(id: number, senhaHash: string): Promise<void> {
    await this.pool.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, id]);
  }

  /** Soft delete (RN04 / RNF04). */
  async definirAtivo(id: number, ativo: boolean): Promise<void> {
    await this.pool.execute('UPDATE usuarios SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  }

  async contarAdminsAtivos(): Promise<number> {
    const [rows] = await this.pool.execute<TotalRow[]>(
      "SELECT COUNT(*) AS total FROM usuarios WHERE perfil = 'ADMIN' AND ativo = 1",
    );
    return Number(rows[0].total);
  }

  /** O usuário já registrou pedidos ou movimentações de estoque? */
  async possuiVinculos(id: number): Promise<boolean> {
    const [rows] = await this.pool.execute<TotalRow[]>(
      `SELECT (SELECT COUNT(*) FROM pedidos WHERE usuario_id = ?)
            + (SELECT COUNT(*) FROM movimentacoes_estoque WHERE usuario_id = ?) AS total`,
      [id, id],
    );
    return Number(rows[0].total) > 0;
  }

  async excluir(id: number): Promise<void> {
    await this.pool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
  }
}



// ===================== RF02-RF04: Produtos e Estoque =====================
/** Permite rodar a mesma query fora ou dentro de uma transação. */
type Executor = Pool | PoolConnection;

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

interface MovimentacaoRow extends RowDataPacket {
  id: number;
  produto_id: number;
  produto_nome: string;
  pedido_id: number | null;
  usuario_id: number | null;
  usuario_nome: string | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  data_movimentacao: Date;
  observacao: string | null;
}

export interface NovaMovimentacao {
  produtoId: number;
  pedidoId: number | null;
  usuarioId: number | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  observacao: string | null;
}

export class MovimentacaoRepository {
  constructor(private readonly pool: Pool) {}

  async registrar(m: NovaMovimentacao, exec: Executor = this.pool): Promise<number> {
    const [res] = await exec.execute<ResultSetHeader>(
      `INSERT INTO movimentacoes_estoque (produto_id, pedido_id, usuario_id, tipo, quantidade, observacao)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [m.produtoId, m.pedidoId, m.usuarioId, m.tipo, m.quantidade, m.observacao],
    );
    return res.insertId;
  }

  async listar(produtoId: number | null, limite: number): Promise<Movimentacao[]> {
    const lim = Math.min(Math.max(Math.trunc(limite), 1), 500); // inteiro validado: seguro para LIMIT
    const filtro = produtoId ? 'WHERE m.produto_id = ?' : '';
    const [rows] = await this.pool.execute<MovimentacaoRow[]>(
      `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.pedido_id, m.usuario_id,
              u.nome AS usuario_nome, m.tipo, m.quantidade, m.data_movimentacao, m.observacao
         FROM movimentacoes_estoque m
         JOIN produtos p ON p.id = m.produto_id
         LEFT JOIN usuarios u ON u.id = m.usuario_id
         ${filtro}
        ORDER BY m.data_movimentacao DESC, m.id DESC
        LIMIT ${lim}`,
      produtoId ? [produtoId] : [],
    );
    return rows.map(
      (r) =>
        new Movimentacao({
          id: r.id,
          produtoId: r.produto_id,
          produtoNome: r.produto_nome,
          pedidoId: r.pedido_id,
          usuarioId: r.usuario_id,
          usuarioNome: r.usuario_nome,
          tipo: r.tipo,
          quantidade: r.quantidade,
          dataMovimentacao: new Date(r.data_movimentacao),
          observacao: r.observacao,
        }),
    );
  }

  /** Quanto de cada produto está efetivamente baixado para o pedido (SAIDA - ESTORNO). */
  async saldoBaixadoPorPedido(pedidoId: number, exec: Executor = this.pool): Promise<Map<number, number>> {
    const [rows] = await exec.execute<(RowDataPacket & { produto_id: number; saldo: number })[]>(
      `SELECT produto_id,
              SUM(CASE WHEN tipo = 'SAIDA' THEN quantidade WHEN tipo = 'ESTORNO' THEN -quantidade ELSE 0 END) AS saldo
         FROM movimentacoes_estoque
        WHERE pedido_id = ?
        GROUP BY produto_id
       HAVING saldo > 0`,
      [pedidoId],
    );
    return new Map(rows.map((r) => [r.produto_id, Number(r.saldo)]));
  }
}