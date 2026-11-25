// Schemas Zod de cliente (RF05/RF06). Toda entrada do renderer passa por aqui.
import { z } from 'zod';
import { cepSchema, cpfSchema, telefoneSchema, ufSchema } from '../compartilhado/campos-br';
import { obrigatorio, textoOpcional } from '../compartilhado/validacao';

const textoObrigatorio = (campo: string, min: number, max: number) =>
  z
    .string(obrigatorio(campo))
    .trim()
    .min(min, min === 1 ? `Informe ${campo.toLowerCase()}.` : `${campo} deve ter no mínimo ${min} caracteres.`)
    .max(max, `${campo} deve ter no máximo ${max} caracteres.`);

export class EsquemasCliente {
  static readonly criar = z.object({
    nome: textoObrigatorio('Nome', 2, 120).refine((v) => /\S+\s+\S+/.test(v), 'Informe o nome completo.'),
    cpf: cpfSchema,
    telefone: telefoneSchema,
    email: z
      .string(obrigatorio('E-mail'))
      .trim()
      .toLowerCase()
      .email('E-mail inválido.')
      .max(150, 'O e-mail deve ter no máximo 150 caracteres.'),
    cep: cepSchema,
    logradouro: textoObrigatorio('Logradouro', 2, 150),
    numero: textoObrigatorio('Número', 1, 10),
    complemento: textoOpcional(100, 'Complemento'),
    bairro: textoObrigatorio('Bairro', 2, 100),
    cidade: textoObrigatorio('Cidade', 2, 100),
    uf: ufSchema,
  });

  static readonly atualizar = EsquemasCliente.criar;

  static readonly filtro = z
    .object({
      busca: z.string().trim().max(100).optional(),
      status: z.enum(['ATIVOS', 'INATIVOS', 'TODOS']).default('TODOS'),
    })
    .prefault({});

  /** Entrada de clientes:consultarCep. */
  static readonly cep = cepSchema;
}
