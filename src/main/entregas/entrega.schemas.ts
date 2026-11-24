// RF09/RF10: schemas Zod das entradas da central de entregas.
import { z } from 'zod';
import { idSchema, obrigatorio } from '../compartilhado/validacao';
import { STATUS_PEDIDO } from '../pedidos/pedido.model';

const valorItensSchema = z
  .number(obrigatorio('Valor dos itens'))
  .finite('Valor dos itens inválido.')
  .nonnegative('O valor dos itens não pode ser negativo.')
  .max(1_000_000, 'O valor dos itens excede o limite permitido.')
  .optional();

export class EsquemasEntrega {
  /** RF09: cálculo da taxa de entrega para um cliente. */
  static readonly calcular = z.object({
    clienteId: idSchema,
    valorItens: valorItensSchema,
  });

  /** RF10: vínculo de um entregador a um pedido. */
  static readonly vincular = z.object({
    pedidoId: idSchema,
    entregadorId: idSchema,
  });

  /** RF10: mudança de status pelo ciclo de vida da entrega. */
  static readonly alterarStatus = z.object({
    pedidoId: idSchema,
    statusPedido: z.enum(STATUS_PEDIDO, { errorMap: () => ({ message: 'Status de pedido inválido.' }) }),
  });
}
