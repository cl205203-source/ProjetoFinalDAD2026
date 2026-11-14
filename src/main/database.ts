// Conexão MySQL (pool). Credenciais vêm do .env.
import mysql, { Pool, PoolConnection } from 'mysql2/promise';

export class Database {
  readonly pool: Pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    decimalNumbers: true,
    connectionLimit: 5,
  });

  async testarConexao(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /** Executa o trabalho numa transação: commit se terminar bem, rollback se lançar erro. */
  async transacao<T>(trabalho: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const resultado = await trabalho(conn);
      await conn.commit();
      return resultado;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}