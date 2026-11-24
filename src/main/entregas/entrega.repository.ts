// [RF10] Repositório SQL da central de entregas (consultas e prepared statements).
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { Executor } from '../compartilhado/database';
import { StatusEntregador } from '../entregadores/entregador.model';
import { StatusPedido } from '../pedidos/pedido.model';
import { EntregaPublica, EntregadorDisponivelPublico, ItemResumoEntrega } from './entrega.model';

interface EntregaRow extends RowDataPacket {
  pedido_id: number;
  cliente_id: number;
  cliente_nome: string;
  cliente_email: string;
  cliente_telefone: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  status_pedido: StatusPedido;
  data_pedido: Date;
  distancia_km: number | null;
  valor_frete: number;
  valor_total: number;
  previsao_entrega: Date | null;
  entregador_id: number | null;
  entregador_nome: string | null;
  entregador_status: StatusEntregador | null;
}

interface ItemEntregaRow extends RowDataPacket {
  pedido_id: number;
  produto_id: number;
  produto_nome: string;
  quantidade: number;
  subtotal: number;
}

interface EntregadorDisponivelRow extends RowDataPacket {
  id: number;
  nome: string;
  telefone: string;
  veiculo: string;
}

/** [RF10] Status de pedido que ainda fazem parte da operação de entrega. */
const STATUS_ATIVOS_SQL = "('PENDENTE', 'EM_SEPARACAO', 'SAIU_PARA_ENTREGA')";

export class EntregaRepository {
  constructor(private readonly pool: Pool) {}

  /** [RF10] Pedidos ativos com dados do cliente, do entregador responsável e resumo de itens. */
  async listarAtivas(): Promise<EntregaPublica[]> {
    const [rows] = await this.pool.execute<EntregaRow[]>(
      `SELECT p.id AS pedido_id, p.cliente_id,
              c.nome AS cliente_nome, c.email AS cliente_email, c.telefone AS cliente_telefone,
              c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
              p.status_pedido, p.data_pedido, p.distancia_km, p.valor_frete, p.valor_total,
              p.previsao_entrega, p.entregador_id,
              e.nome AS entregador_nome, e.status AS entregador_status
         FROM pedidos p
         JOIN clientes c ON c.id = p.cliente_id
         LEFT JOIN entregadores e ON e.id = p.entregador_id
        WHERE p.status_pedido IN ${STATUS_ATIVOS_SQL}
        ORDER BY p.data_pedido ASC, p.id ASC`,
    );
    if (rows.length === 0) return [];

    const itensPorPedido = await this.listarItens(rows.map((r) => r.pedido_id));
    return rows.map((r) => {
      const itens = itensPorPedido.get(r.pedido_id) ?? [];
      return {
        pedidoId: r.pedido_id,
        clienteId: r.cliente_id,
        clienteNome: r.cliente_nome,
        clienteEmail: r.cliente_email,
        clienteTelefone: r.cliente_telefone,
        endereco: EntregaRepository.formatarEndereco(r),
        status: r.status_pedido,
        dataPedido: new Date(r.data_pedido).toISOString(),
        distanciaKm: r.distancia_km === null ? null : Number(r.distancia_km),
        valorFrete: Number(r.valor_frete),
        valorTotal: Number(r.valor_total),
        previsaoEntrega: r.previsao_entrega ? new Date(r.previsao_entrega).toISOString() : null,
        entregadorId: r.entregador_id,
        entregadorNome: r.entregador_nome,
        entregadorStatus: r.entregador_status,
        itens,
        itensResumo: EntregaRepository.resumirItens(itens),
      };
    });
  }

  /** [RF10] Entregadores ativos e livres para receber uma entrega (status DISPONIVEL). */
  async listarDisponiveis(): Promise<EntregadorDisponivelPublico[]> {
    const [rows] = await this.pool.execute<EntregadorDisponivelRow[]>(
      `SELECT id, nome, telefone, veiculo
         FROM entregadores
        WHERE ativo = 1 AND status = 'DISPONIVEL'
        ORDER BY nome ASC`,
    );
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      telefone: r.telefone,
      veiculo: r.veiculo,
    }));
  }

  /** [RF10] Vincula ou remaneja o entregador se o pedido ainda estiver ativo. */
  async atribuirEntregador(pedidoId: number, entregadorId: number, exec: Executor): Promise<boolean> {
    const [res] = await exec.execute<ResultSetHeader>(
      `UPDATE pedidos
          SET entregador_id = ?
        WHERE id = ? AND status_pedido IN ${STATUS_ATIVOS_SQL}`,
      [entregadorId, pedidoId],
    );
    return res.affectedRows > 0;
  }

  private async listarItens(pedidoIds: number[]): Promise<Map<number, ItemResumoEntrega[]>> {
    if (pedidoIds.length === 0) return new Map();
    const marcadores = pedidoIds.map(() => '?').join(', ');
    const [rows] = await this.pool.execute<ItemEntregaRow[]>(
      `SELECT i.pedido_id, i.produto_id, pr.nome AS produto_nome, i.quantidade, i.subtotal
         FROM itens_pedido i
         JOIN produtos pr ON pr.id = i.produto_id
        WHERE i.pedido_id IN (${marcadores})
        ORDER BY i.id ASC`,
      pedidoIds,
    );

    const mapa = new Map<number, ItemResumoEntrega[]>();
    for (const r of rows) {
      const lista = mapa.get(r.pedido_id) ?? [];
      lista.push({
        produtoId: r.produto_id,
        produtoNome: r.produto_nome,
        quantidade: r.quantidade,
        subtotal: Number(r.subtotal),
      });
      mapa.set(r.pedido_id, lista);
    }
    return mapa;
  }

  private static formatarEndereco(r: EntregaRow): string {
    const complemento = r.complemento ? ` - ${r.complemento}` : '';
    return `${r.logradouro}, ${r.numero}${complemento} - ${r.bairro}, ${r.cidade}/${r.uf}`;
  }

  private static resumirItens(itens: ItemResumoEntrega[]): string {
    if (itens.length === 0) return 'Sem itens';
    return itens.map((i) => `${i.quantidade}x ${i.produtoNome}`).join(', ');
  }
}
