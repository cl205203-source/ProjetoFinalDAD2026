// Repository de clientes: único lugar com SQL da tabela clientes (sempre prepared statements).
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ErroMysql } from '../compartilhado/mysql-erros';
import { Cliente } from './cliente.model';

interface ClienteRow extends RowDataPacket {
  id: number;
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  distancia_km: number | null;
  ativo: number;
  criado_em: Date;
}

export interface FiltroCliente {
  busca?: string;
  status: 'ATIVOS' | 'INATIVOS' | 'TODOS';
}

export interface DadosCliente {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
}

export class ClienteRepository {
  private static readonly COLUNAS =
    'id, nome, cpf, telefone, email, cep, logradouro, numero, complemento, bairro, cidade, uf, distancia_km, ativo, criado_em';

  constructor(private readonly pool: Pool) {}

  private static mapear(r: ClienteRow): Cliente {
    return new Cliente(
      r.id, r.nome, r.cpf, r.telefone, r.email, r.cep, r.logradouro, r.numero, r.complemento,
      r.bairro, r.cidade, r.uf, r.distancia_km === null ? null : Number(r.distancia_km),
      Boolean(r.ativo), new Date(r.criado_em),
    );
  }

  async listar(f: FiltroCliente): Promise<Cliente[]> {
    const where: string[] = [];
    const params: string[] = [];

    if (f.busca) {
      const termo = `%${f.busca.replace(/[\\%_]/g, '\\$&')}%`;
      const digitos = f.busca.replace(/\D/g, '');
      where.push(digitos ? '(nome LIKE ? OR email LIKE ? OR cpf LIKE ? OR telefone LIKE ?)' : '(nome LIKE ? OR email LIKE ?)');
      params.push(termo, termo);
      if (digitos) params.push(`%${digitos}%`, `%${digitos}%`);
    }
    if (f.status === 'ATIVOS') where.push('ativo = 1');
    if (f.status === 'INATIVOS') where.push('ativo = 0');

    const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<ClienteRow[]>(
      `SELECT ${ClienteRepository.COLUNAS} FROM clientes ${clausula} ORDER BY ativo DESC, nome ASC`,
      params,
    );
    return rows.map(ClienteRepository.mapear);
  }

  async buscarPorId(id: number): Promise<Cliente | null> {
    const [rows] = await this.pool.execute<ClienteRow[]>(
      `SELECT ${ClienteRepository.COLUNAS} FROM clientes WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows.length ? ClienteRepository.mapear(rows[0]) : null;
  }

  async cpfEmUso(cpf: string, ignorarId: number | null = null): Promise<boolean> {
    const [rows] = await this.pool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM clientes WHERE cpf = ? AND id <> ?',
      [cpf, ignorarId ?? 0],
    );
    return Number(rows[0].total) > 0;
  }

  async criar(d: DadosCliente, distanciaKm: number | null): Promise<number> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO clientes
         (nome, cpf, telefone, email, cep, logradouro, numero, complemento, bairro, cidade, uf, distancia_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.nome, d.cpf, d.telefone, d.email, d.cep, d.logradouro, d.numero, d.complemento, d.bairro, d.cidade, d.uf, distanciaKm],
    );
    return res.insertId;
  }

  async atualizar(id: number, d: DadosCliente, distanciaKm: number | null): Promise<void> {
    await this.pool.execute(
      `UPDATE clientes
          SET nome = ?, cpf = ?, telefone = ?, email = ?, cep = ?, logradouro = ?, numero = ?,
              complemento = ?, bairro = ?, cidade = ?, uf = ?, distancia_km = ?
        WHERE id = ?`,
      [d.nome, d.cpf, d.telefone, d.email, d.cep, d.logradouro, d.numero, d.complemento, d.bairro, d.cidade, d.uf, distanciaKm, id],
    );
  }

  /** Soft delete (RN04). */
  async definirAtivo(id: number, ativo: boolean): Promise<void> {
    await this.pool.execute('UPDATE clientes SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  }

  /** O cliente já fez pedidos? Se a tabela/coluna de pedidos ainda não existir, não há vínculo. */
  async possuiVinculos(id: number): Promise<boolean> {
    try {
      const [rows] = await this.pool.execute<(RowDataPacket & { total: number })[]>(
        'SELECT COUNT(*) AS total FROM pedidos WHERE cliente_id = ?',
        [id],
      );
      return Number(rows[0].total) > 0;
    } catch (e) {
      if (ErroMysql.ehCodigo(e, ErroMysql.TABELA_INEXISTENTE, ErroMysql.COLUNA_INEXISTENTE)) return false;
      throw e;
    }
  }

  async excluir(id: number): Promise<void> {
    await this.pool.execute('DELETE FROM clientes WHERE id = ?', [id]);
  }
}
