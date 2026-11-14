// Repository de movimentações de estoque: único lugar com SQL da tabela movimentacoes_estoque.
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { Executor } from '../compartilhado/database';
import { Movimentacao, TipoMovimentacao } from './movimentacao.model';

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
