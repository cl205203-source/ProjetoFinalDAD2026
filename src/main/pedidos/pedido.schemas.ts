// Schemas Zod de pedidos (RF08). Toda entrada do renderer passa por aqui.
import { z } from 'zod';
import { idSchema, obrigatorio, textoOpcional } from '../compartilhado/validacao';
import { STATUS_PEDIDO } from './pedido.model';

const quantidadeSchema = z
  .number(obrigatorio('Quantidade'))
  .int('A quantidade deve ser um número inteiro.')
  .min(1, 'A quantidade deve ser maior que zero.')
  .max(1_000_000, 'A quantidade excede o valor máximo permitido.');

/** Valor monetário: aceita no máximo 2 casas decimais e não pode ser negativo. */
const dinheiroSchema = z
  .number(obrigatorio('Valor'))
  .finite('Valor inválido.')
  .nonnegative('O valor não pode ser negativo.')
  .multipleOf(0.01, 'Use no máximo 2 casas decimais.')
  .max(1_000_000, 'O valor excede o limite permitido.');

const distanciaSchema = z
  .number(obrigatorio('Distância'))
  .finite('Distância inválida.')
  .nonnegative('A distância não pode ser negativa.')
  .max(100_000, 'Distância inválida.');

const statusSchema = z.enum(STATUS_PEDIDO, { error: 'Status de pedido inválido.' });

/** Item enviado pela tela: quantidade por produto (o preço é buscado no banco, nunca confiado no renderer). */
export const itemPedidoSchema = z.object({
  produtoId: idSchema,
  quantidade: quantidadeSchema,
});

export class EsquemasPedido {
  static readonly criar = z.object({
    clienteId: idSchema,
    entregadorId: idSchema.nullish().transform((v) => v ?? null),
    distanciaKm: distanciaSchema.nullish().transform((v) => v ?? null),
    valorFrete: dinheiroSchema.default(0),
    statusPedido: statusSchema
      .refine((s) => s !== 'CANCELADO' && s !== 'ENTREGUE', 'Status inicial inválido. Use Pendente, Em Separação ou Saiu para Entrega.')
      .default('PENDENTE'),
    itens: z.array(itemPedidoSchema).min(1, 'Informe ao menos um item.'),
  });

  static readonly atualizar = EsquemasPedido.criar;

  static readonly alterarStatus = z.object({
    statusPedido: statusSchema,
    entregadorId: idSchema.nullish().transform((v) => v ?? null),
  });

  static readonly cancelar = z.object({
    observacao: textoOpcional(255, 'Observação'),
  });

  static readonly filtro = z
    .object({
      busca: z.string().trim().max(100).optional(),
      status: statusSchema.optional(),
      clienteId: idSchema.optional(),
      entregadorId: idSchema.optional(),
    })
    .default({});
}
