// Conexão MySQL (pool). Credenciais vêm do .env.
import mysql, { Pool } from 'mysql2/promise';

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
}
