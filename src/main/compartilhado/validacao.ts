// Utilitários de validação (Zod) compartilhados entre os módulos.
import { z } from 'zod';
import { AppError } from './erros';

export const obrigatorio = (campo: string) => ({
  error: (iss: { input?: unknown }) =>
    iss.input === undefined ? `${campo} é obrigatório.` : `${campo} inválido.`,
});

/** Identificador numérico (chave primária) vindo da interface. */
export const idSchema = z
  .number(obrigatorio('Identificador'))
  .int('Identificador inválido.')
  .positive('Identificador inválido.');

export const textoOpcional = (max: number, campo: string) =>
  z
    .string({ error: `${campo} inválido.` })
    .trim()
    .max(max, `${campo} deve ter no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

export class Validador {
  /** Valida/sanitiza qualquer entrada vinda do renderer. Lança AppError com a 1ª mensagem. */
  static parse<S extends z.ZodTypeAny>(schema: S, dados: unknown): z.infer<S> {
    const r = schema.safeParse(dados);
    if (!r.success) {
      throw new AppError(r.error.issues[0]?.message ?? 'Dados inválidos.', 'VALIDACAO');
    }
    return r.data;
  }
}
