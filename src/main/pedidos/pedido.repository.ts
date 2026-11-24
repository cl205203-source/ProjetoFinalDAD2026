// Repository de pedidos e itens: único lugar com SQL das tabelas pedidos / itens_pedido.
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { Executor } from '../compartilhado/database';
import { DadosItemPedido, DadosPedido, Pedido, StatusPedido } from './pedido.model';

interface PedidoRow extends RowDataPacket {
  id: number;
  cliente_id: number;
  cliente_nome: string;
  entregador_id: number | null;
  entregador_nome: string | null;
  usuario_id: number;
  usuario_nome: string;
  data_pedido: Date;
  status_pedido: StatusPedido;
  distancia_km: number | null;
  valor_frete: number;
  valor_total: number;
  previsao_entrega: Date | null;
}

interface ItemRow extends RowDataPacket {
  id: number;
  produto_id: number;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
}

export interface FiltroPedido {
  busca?: string;
  status?: StatusPedido;
  clienteId?: number;
  entregadorId?: number;
}

export interface DadosCabecalhoPedido {
  clienteId: number;
  entregadorId: number | null;
  usuarioId: number;
  distanciaKm: number | null;
  valorFrete: number;
  valorTotal: number;
  /** RF09: previsão calculada pelo main (coluna pedidos.previsao_entrega já existente). */
  previsaoEntrega: Date | null;
  statusPedido: StatusPedido;
}

/** Item pronto para gravação: o preço unitário já foi definido pelo service. */
export interface ItemParaGravar {
  produtoId: number;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

const JOIN =
  `FROM pedidos p
     JOIN clientes c ON c.id = p.cliente_id
     JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN entregadores e ON e.id = p.entregador_id`;

const COLUNAS =
  `p.id, p.cliente_id, c.nome AS cliente_nome, p.entregador_id, e.nome AS entregador_nome,
   p.usuario_id, u.nome AS usuario_nome, p.data_pedido, p.status_pedido,
   p.distancia_km, p.valor_frete, p.valor_total, p.previsao_entrega`;

export class PedidoRepository {
  constructor(private readonly pool: Pool) {}

  async listar(f: FiltroPedido): Promise<Pedido[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (f.busca) {
      const termo = `%${f.busca.replace(/[\\%_]/g, '\\$&')}%`;
      where.push('(CAST(p.id AS CHAR) LIKE ? OR c.nome LIKE ? OR e.nome LIKE ?)');
      params.push(termo, termo, termo);
    }
    if (f.status) {
      where.push('p.status_pedido = ?');
      params.push(f.status);
    }
    if (f.clienteId) {
      where.push('p.cliente_id = ?');
      params.push(f.clienteId);
    }
    if (f.entregadorId) {
      where.push('p.entregador_id = ?');
      params.push(f.entregadorId);
    }

    const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<PedidoRow[]>(
      `SELECT ${COLUNAS} ${JOIN} ${clausula} ORDER BY p.data_pedido DESC, p.id DESC`,
      params,
    );
    return Promise.all(rows.map((r) => this.mapear(r)));
  }

  async buscarPorId(id: number, exec: Executor = this.pool): Promise<Pedido | null> {
    const [rows] = await exec.execute<PedidoRow[]>(
      `SELECT ${COLUNAS} ${JOIN} WHERE p.id = ? LIMIT 1`,
      [id],
    );
    return rows.length ? this.mapear(rows[0]) : null;
  }

  /** Preços e nomes são lidos no banco na hora de montar o pedido (não vêm da tela). */
  async buscarProdutos(ids: number[], exec: Executor = this.pool): Promise<Map<number, { nome: string; precoVenda: number; ativo: boolean }>> {
    if (ids.length === 0) return new Map();
    const marcadores = ids.map(() => '?').join(', ');
    const [rows] = await exec.execute<(RowDataPacket & { id: number; nome: string; preco_venda: number; ativo: number })[]>(
      `SELECT id, nome, preco_venda, ativo FROM produtos WHERE id IN (${marcadores})`,
      ids,
    );
    return new Map(
      rows.map((r) => [r.id, { nome: r.nome, precoVenda: Number(r.preco_venda), ativo: Boolean(r.ativo) }]),
    );
  }

  async clienteExiste(id: number, exec: Executor = this.pool): Promise<boolean> {
    const [rows] = await exec.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM clientes WHERE id = ? AND ativo = 1',
      [id],
    );
    return Number(rows[0].total) > 0;
  }

  async entregadorDisponivel(id: number, exec: Executor = this.pool): Promise<boolean> {
    const [rows] = await exec.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM entregadores WHERE id = ? AND ativo = 1 AND status = 'DISPONIVEL'",
      [id],
    );
    return Number(rows[0].total) > 0;
  }

  async criar(d: DadosCabecalhoPedido, itens: ItemParaGravar[], exec: Executor): Promise<number> {
    const [res] = await exec.execute<ResultSetHeader>(
      `INSERT INTO pedidos
         (cliente_id, entregador_id, usuario_id, data_pedido, status_pedido, distancia_km, valor_frete, valor_total, previsao_entrega)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [
        d.clienteId, d.entregadorId, d.usuarioId, d.statusPedido, d.distanciaKm,
        d.valorFrete, d.valorTotal, d.previsaoEntrega,
      ],
    );
    const pedidoId = res.insertId;
    await this.inserirItens(pedidoId, itens, exec);
    return pedidoId;
  }

  async atualizar(id: number, d: DadosCabecalhoPedido, itens: ItemParaGravar[], exec: Executor): Promise<void> {
    await exec.execute(
      `UPDATE pedidos
          SET cliente_id = ?, entregador_id = ?, distancia_km = ?, valor_frete = ?, valor_total = ?,
              status_pedido = ?, previsao_entrega = ?
        WHERE id = ?`,
      [
        d.clienteId, d.entregadorId, d.distanciaKm, d.valorFrete, d.valorTotal,
        d.statusPedido, d.previsaoEntrega, id,
      ],
    );
    await exec.execute('DELETE FROM itens_pedido WHERE pedido_id = ?', [id]);
    await this.inserirItens(id, itens, exec);
  }

  async definirStatus(id: number, status: StatusPedido, entregadorId: number | null, exec: Executor = this.pool): Promise<void> {
    await exec.execute(
      'UPDATE pedidos SET status_pedido = ?, entregador_id = ? WHERE id = ?',
      [status, entregadorId, id],
    );
  }

  async excluir(id: number, exec: Executor = this.pool): Promise<void> {
    // Itens primeiro: a FK itens_pedido.pedido_id não tem ON DELETE CASCADE garantido.
    await exec.execute('DELETE FROM itens_pedido WHERE pedido_id = ?', [id]);
    await exec.execute('DELETE FROM pedidos WHERE id = ?', [id]);
  }

  private async inserirItens(pedidoId: number, itens: ItemParaGravar[], exec: Executor): Promise<void> {
    for (const i of itens) {
      await exec.execute(
        `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [pedidoId, i.produtoId, i.quantidade, i.precoUnitario, i.subtotal],
      );
    }
  }

  private async listarItens(pedidoId: number, exec: Executor = this.pool): Promise<DadosItemPedido[]> {
    const [rows] = await exec.execute<ItemRow[]>(
      `SELECT i.id, i.produto_id, p.nome AS produto_nome, i.quantidade, i.preco_unitario, i.subtotal
         FROM itens_pedido i
         JOIN produtos p ON p.id = i.produto_id
        WHERE i.pedido_id = ?
        ORDER BY i.id ASC`,
      [pedidoId],
    );
    return rows.map((r) => ({
      id: r.id,
      produtoId: r.produto_id,
      produtoNome: r.produto_nome,
      quantidade: r.quantidade,
      precoUnitario: Number(r.preco_unitario),
      subtotal: Number(r.subtotal),
    }));
  }

  private async mapear(r: PedidoRow): Promise<Pedido> {
    return new Pedido({
      id: r.id,
      clienteId: r.cliente_id,
      clienteNome: r.cliente_nome,
      entregadorId: r.entregador_id,
      entregadorNome: r.entregador_nome,
      usuarioId: r.usuario_id,
      usuarioNome: r.usuario_nome,
      dataPedido: new Date(r.data_pedido),
      statusPedido: r.status_pedido,
      distanciaKm: r.distancia_km === null ? null : Number(r.distancia_km),
      valorFrete: Number(r.valor_frete),
      valorTotal: Number(r.valor_total),
      previsaoEntrega: r.previsao_entrega ? new Date(r.previsao_entrega) : null,
      itens: await this.listarItens(r.id),
    });
  }

  /** [RF11] E-mail do cliente para a confirmação do pedido (nunca confia em dado do renderer). */
  async emailCliente(clienteId: number, exec: Executor = this.pool): Promise<string | null> {
    const [rows] = await exec.execute<(RowDataPacket & { email: string | null })[]>(
      'SELECT email FROM clientes WHERE id = ? LIMIT 1',
      [clienteId],
    );
    const email = rows[0]?.email?.trim();
    return email ? email : null;
  }

  /**
   * [RF10] Quantas entregas ativas o entregador ainda tem (ignorando, opcionalmente, o pedido atual).
   * Usado para verificar vínculos ativos de entrega.
   */
  async contarEntregasAtivasDoEntregador(
    entregadorId: number,
    ignorarPedidoId?: number,
    exec: Executor = this.pool,
  ): Promise<number> {
    const [rows] = await exec.execute<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total
         FROM pedidos
        WHERE entregador_id = ?
          AND status_pedido IN ('PENDENTE', 'EM_SEPARACAO', 'SAIU_PARA_ENTREGA')
          AND id <> ?`,
      [entregadorId, ignorarPedidoId ?? 0],
    );
    return Number(rows[0].total);
  }

  /**
   * [RF10] Quantas entregas em rota ('SAIU_PARA_ENTREGA') o entregador ainda tem
   * (ignorando, opcionalmente, o pedido atual). Usado para devolvê-lo a DISPONIVEL
   * assim que finalizar ou cancelar a última entrega em rota.
   */
  async contarEntregasEmRotaDoEntregador(
    entregadorId: number,
    ignorarPedidoId?: number,
    exec: Executor = this.pool,
  ): Promise<number> {
    const [rows] = await exec.execute<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total
         FROM pedidos
        WHERE entregador_id = ?
          AND status_pedido = 'SAIU_PARA_ENTREGA'
          AND id <> ?`,
      [entregadorId, ignorarPedidoId ?? 0],
    );
    return Number(rows[0].total);
  }
}
