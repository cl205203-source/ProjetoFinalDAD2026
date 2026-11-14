// Schemas Zod de estoque (RF03/RF04).
import { z } from 'zod';
import { idSchema, obrigatorio, textoOpcional } from '../compartilhado/validacao';
import { TIPOS_MANUAIS } from './movimentacao.model';

const quantidadeSchema = z
  .number(obrigatorio('Quantidade'))
  .int('A quantidade deve ser um número inteiro.')
  .min(1, 'A quantidade deve ser maior que zero.')
  .max(1_000_000, 'A quantidade excede o valor máximo permitido.');

export class EsquemasEstoque {
  static readonly movimentacao = z
    .object({
      produtoId: idSchema,
      tipo: z.enum(TIPOS_MANUAIS, { errorMap: () => ({ message: 'Tipo de movimentação inválido.' }) }),
      quantidade: quantidadeSchema,
      observacao: textoOpcional(255, 'Observação'),
    })
    .superRefine((d, ctx) => {
      if (d.tipo !== 'ENTRADA' && (d.observacao ?? '').length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe o motivo do ajuste (mínimo 3 caracteres).',
          path: ['observacao'],
        });
      }
    });

  static readonly historico = z
    .object({
      produtoId: idSchema.optional(),
      limite: z.number().int().min(1).max(500).default(100),
    })
    .default({});

  static readonly itens = z.array(z.object({ produtoId: idSchema, quantidade: quantidadeSchema }));

  static readonly disponibilidade = z.object({
    itens: EsquemasEstoque.itens.min(1, 'Informe ao menos um item.'),
    pedidoId: idSchema.optional(),
  });
}
