// Repository de usuários: único lugar com SQL da tabela usuarios. Sempre com prepared statements (?).
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { CredencialUsuario, PerfilUsuario, Usuario } from './usuario.model';

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
