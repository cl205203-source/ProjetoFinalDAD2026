// Repository de entregadores: único lugar com SQL da tabela entregadores (sempre prepared statements).
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { Executor } from '../compartilhado/database';
import { ErroMysql } from '../compartilhado/mysql-erros';
import { Entregador, StatusEntregador } from './entregador.model';

interface EntregadorRow extends RowDataPacket {
  id: number;
  nome: string;
  cpf: string;
  telefone: string;
  veiculo: string;
  placa: string | null;
  status: StatusEntregador;
  ativo: number;
  criado_em: Date;
}

export interface FiltroEntregador {
  busca?: string;
  disponibilidade?: StatusEntregador;
  status: 'ATIVOS' | 'INATIVOS' | 'TODOS';
}

export interface DadosEntregador {
  nome: string;
  cpf: string;
  telefone: string;
  veiculo: string;
  placa: string | null;
  status: StatusEntregador;
}

export class EntregadorRepository {
  private static readonly COLUNAS = 'id, nome, cpf, telefone, veiculo, placa, status, ativo, criado_em';

  constructor(private readonly pool: Pool) {}

  private static mapear(r: EntregadorRow): Entregador {
    return new Entregador(r.id, r.nome, r.cpf, r.telefone, r.veiculo, r.placa, r.status, Boolean(r.ativo), new Date(r.criado_em));
  }

  async listar(f: FiltroEntregador): Promise<Entregador[]> {
    const where: string[] = [];
    const params: string[] = [];

    if (f.busca) {
      const termo = `%${f.busca.replace(/[\\%_]/g, '\\$&')}%`;
      const digitos = f.busca.replace(/\D/g, '');
      where.push(digitos ? '(nome LIKE ? OR veiculo LIKE ? OR placa LIKE ? OR cpf LIKE ?)' : '(nome LIKE ? OR veiculo LIKE ? OR placa LIKE ?)');
      params.push(termo, termo, termo);
      if (digitos) params.push(`%${digitos}%`);
    }
    if (f.disponibilidade) {
      where.push('status = ?');
      params.push(f.disponibilidade);
    }
    if (f.status === 'ATIVOS') where.push('ativo = 1');
    if (f.status === 'INATIVOS') where.push('ativo = 0');

    const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<EntregadorRow[]>(
      `SELECT ${EntregadorRepository.COLUNAS} FROM entregadores ${clausula} ORDER BY ativo DESC, nome ASC`,
      params,
    );
    return rows.map(EntregadorRepository.mapear);
  }

  /** RF10: aceita Executor para ler o entregador dentro da mesma transação do vínculo. */
  async buscarPorId(id: number, exec: Executor = this.pool): Promise<Entregador | null> {
    const [rows] = await exec.execute<EntregadorRow[]>(
      `SELECT ${EntregadorRepository.COLUNAS} FROM entregadores WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows.length ? EntregadorRepository.mapear(rows[0]) : null;
  }

  async cpfEmUso(cpf: string, ignorarId: number | null = null): Promise<boolean> {
    const [rows] = await this.pool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM entregadores WHERE cpf = ? AND id <> ?',
      [cpf, ignorarId ?? 0],
    );
    return Number(rows[0].total) > 0;
  }

  async criar(d: DadosEntregador): Promise<number> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO entregadores (nome, cpf, telefone, veiculo, placa, status) VALUES (?, ?, ?, ?, ?, ?)',
      [d.nome, d.cpf, d.telefone, d.veiculo, d.placa, d.status],
    );
    return res.insertId;
  }

  async atualizar(id: number, d: DadosEntregador): Promise<void> {
    await this.pool.execute(
      'UPDATE entregadores SET nome = ?, cpf = ?, telefone = ?, veiculo = ?, placa = ?, status = ? WHERE id = ?',
      [d.nome, d.cpf, d.telefone, d.veiculo, d.placa, d.status, id],
    );
  }

  /** RF10: sincroniza EM_ROTA/DISPONIVEL dentro da transação que mudou o pedido. */
  async definirStatus(id: number, status: StatusEntregador, exec: Executor = this.pool): Promise<void> {
    await exec.execute('UPDATE entregadores SET status = ? WHERE id = ?', [status, id]);
  }

  /** Soft delete (RN04). */
  async definirAtivo(id: number, ativo: boolean): Promise<void> {
    await this.pool.execute('UPDATE entregadores SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  }

  /** O entregador já fez entregas? Se a tabela/coluna de pedidos ainda não existir, não há vínculo. */
  async possuiVinculos(id: number): Promise<boolean> {
    try {
      const [rows] = await this.pool.execute<(RowDataPacket & { total: number })[]>(
        'SELECT COUNT(*) AS total FROM pedidos WHERE entregador_id = ?',
        [id],
      );
      return Number(rows[0].total) > 0;
    } catch (e) {
      if (ErroMysql.ehCodigo(e, ErroMysql.TABELA_INEXISTENTE, ErroMysql.COLUNA_INEXISTENTE)) return false;
      throw e;
    }
  }

  async excluir(id: number): Promise<void> {
    await this.pool.execute('DELETE FROM entregadores WHERE id = ?', [id]);
  }
}
