// Schemas Zod de entregador (RF07). Toda entrada do renderer passa por aqui.
import { z } from 'zod';
import { cpfSchema, telefoneSchema } from '../compartilhado/campos-br';
import { obrigatorio } from '../compartilhado/validacao';
import { STATUS_ENTREGADOR } from './entregador.model';

const statusSchema = z.enum(STATUS_ENTREGADOR, { errorMap: () => ({ message: 'Status de disponibilidade inválido.' }) });

/** Placa opcional (bicicleta não tem). Aceita ABC1D23 (Mercosul) e ABC-1234 (antiga). */
const placaSchema = z
  .string({ invalid_type_error: 'Placa inválida.' })
  .nullish()
  .transform((v) => (v ? v.trim().toUpperCase().replace(/[-\s]/g, '') : null))
  .refine((v) => v === null || /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(v), 'Placa inválida. Use o formato ABC1D23 ou ABC-1234.');

export class EsquemasEntregador {
  static readonly criar = z.object({
    nome: z
      .string(obrigatorio('Nome'))
      .trim()
      .min(2, 'O nome deve ter no mínimo 2 caracteres.')
      .max(120, 'O nome deve ter no máximo 120 caracteres.'),
    cpf: cpfSchema,
    telefone: telefoneSchema,
    veiculo: z
      .string(obrigatorio('Veículo'))
      .trim()
      .min(2, 'Informe o veículo.')
      .max(60, 'O veículo deve ter no máximo 60 caracteres.'),
    placa: placaSchema,
    status: statusSchema,
  });

  static readonly atualizar = EsquemasEntregador.criar;

  static readonly alterarStatus = z.object({ status: statusSchema });

  static readonly filtro = z
    .object({
      busca: z.string().trim().max(100).optional(),
      disponibilidade: statusSchema.optional(),
      status: z.enum(['ATIVOS', 'INATIVOS', 'TODOS']).default('TODOS'),
    })
    .default({});
}
