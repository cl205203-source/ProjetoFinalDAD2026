// Schemas Zod de produto (RF02).
import { z } from 'zod';
import { obrigatorio, textoOpcional } from '../compartilhado/validacao';
import { CATEGORIAS } from './produto.model';

const dinheiroSchema = (campo: string) =>
  z
    .number(obrigatorio(campo))
    .finite(`${campo} inválido.`)
    .min(0, `${campo} não pode ser negativo.`)
    .max(99_999_999.99, `${campo} excede o valor máximo permitido.`)
    .transform((v) => Math.round(v * 100) / 100);

const inteiroSchema = (campo: string, max = 1_000_000) =>
  z
    .number(obrigatorio(campo))
    .int(`${campo} deve ser um número inteiro.`)
    .min(0, `${campo} não pode ser negativo.`)
    .max(max, `${campo} excede o valor máximo permitido.`);

export class EsquemasProduto {
  static readonly criar = z.object({
    nome: z
      .string(obrigatorio('Nome'))
      .trim()
      .min(2, 'O nome deve ter no mínimo 2 caracteres.')
      .max(150, 'O nome deve ter no máximo 150 caracteres.'),
    descricao: textoOpcional(2000, 'Descrição'),
    categoria: z.enum(CATEGORIAS, { errorMap: () => ({ message: 'Categoria inválida.' }) }),
    marca: z
      .string(obrigatorio('Marca'))
      .trim()
      .min(1, 'Informe a marca.')
      .max(80, 'A marca deve ter no máximo 80 caracteres.'),
    precoCusto: dinheiroSchema('Preço de custo'),
    precoVenda: dinheiroSchema('Preço de venda'),
    isImportado: z.boolean({ required_error: 'Informe a origem.', invalid_type_error: 'Origem inválida.' }),
    estoqueAtual: inteiroSchema('Estoque inicial'),
    estoqueMinimo: inteiroSchema('Estoque mínimo'),
  });

  /** Na edição o saldo NÃO é alterado: só por movimentação de estoque. */
  static readonly atualizar = EsquemasProduto.criar.omit({ estoqueAtual: true });

  static readonly filtro = z
    .object({
      busca: z.string().trim().max(100).optional(),
      categoria: z.enum(CATEGORIAS).optional(),
      status: z.enum(['ATIVOS', 'INATIVOS', 'TODOS']).default('TODOS'),
      somenteEstoqueBaixo: z.boolean().default(false),
    })
    .default({});
}
