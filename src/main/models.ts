// Models + schemas Zod (Usuario, Cliente, Entregador, Produto, Pedido, ItemPedido, Movimentacao)
// Nesta etapa: Usuario (RF01).
import { z } from 'zod';

export const PERFIS = ['ADMIN', 'ATENDENTE'] as const;
export type PerfilUsuario = (typeof PERFIS)[number];

export type CodigoErro =
  | 'VALIDACAO'
  | 'NAO_AUTENTICADO'
  | 'SEM_PERMISSAO'
  | 'NAO_ENCONTRADO'
  | 'CONFLITO'
  | 'REGRA_NEGOCIO';

/** Erro "esperado" (regra de negócio): a mensagem pode ser mostrada ao usuário. */
export class AppError extends Error {
  constructor(message: string, readonly codigo: CodigoErro = 'REGRA_NEGOCIO') {
    super(message);
    this.name = 'AppError';
  }
}

/** O que pode atravessar o IPC para a interface. NUNCA contém senha_hash. */
export interface UsuarioPublico {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  ativo: boolean;
  criadoEm: string;
}

export class Usuario {
  constructor(
    readonly id: number,
    readonly nome: string,
    readonly email: string,
    readonly perfil: PerfilUsuario,
    readonly ativo: boolean,
    readonly criadoEm: Date,
  ) {}

  ehAdmin(): boolean {
    return this.perfil === 'ADMIN';
  }

  paraPublico(): UsuarioPublico {
    return {
      id: this.id,
      nome: this.nome,
      email: this.email,
      perfil: this.perfil,
      ativo: this.ativo,
      criadoEm: this.criadoEm.toISOString(),
    };
  }
}

/** Usado só dentro do processo main, na autenticação. */
export interface CredencialUsuario {
  usuario: Usuario;
  senhaHash: string;
}

// ---------- Schemas Zod ----------
const obrigatorio = (campo: string) => ({
  required_error: `${campo} é obrigatório.`,
  invalid_type_error: `${campo} inválido.`,
});

const nomeSchema = z
  .string(obrigatorio('Nome'))
  .trim()
  .min(2, 'O nome deve ter no mínimo 2 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

const emailSchema = z
  .string(obrigatorio('E-mail'))
  .trim()
  .toLowerCase()
  .email('E-mail inválido.')
  .max(150, 'O e-mail deve ter no máximo 150 caracteres.');

// bcrypt só considera os primeiros 72 bytes, por isso o limite.
const senhaSchema = z
  .string(obrigatorio('Senha'))
  .min(8, 'A senha deve ter no mínimo 8 caracteres.')
  .max(72, 'A senha deve ter no máximo 72 caracteres.')
  .regex(/[A-Za-z]/, 'A senha deve conter ao menos uma letra.')
  .regex(/\d/, 'A senha deve conter ao menos um número.');

const perfilSchema = z.enum(PERFIS, { errorMap: () => ({ message: 'Perfil inválido.' }) });

export class EsquemasUsuario {
  static readonly id = z
    .number(obrigatorio('Identificador'))
    .int('Identificador inválido.')
    .positive('Identificador inválido.');

  static readonly login = z.object({
    email: z.string(obrigatorio('E-mail')).trim().toLowerCase().min(1, 'E-mail é obrigatório.').max(150),
    senha: z.string(obrigatorio('Senha')).min(1, 'Senha é obrigatória.').max(72, 'Senha inválida.'),
  });

  static readonly criar = z.object({
    nome: nomeSchema,
    email: emailSchema,
    senha: senhaSchema,
    perfil: perfilSchema,
  });

  static readonly atualizar = EsquemasUsuario.criar.omit({ senha: true });

  static readonly redefinirSenha = z.object({ novaSenha: senhaSchema });

  static readonly alterarPropriaSenha = z.object({
    senhaAtual: z.string(obrigatorio('Senha atual')).min(1, 'Informe a senha atual.').max(72, 'Senha atual inválida.'),
    novaSenha: senhaSchema,
  });
}

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


// ===================== RF02-RF04: Produtos e Estoque =====================
export const CATEGORIAS = ['RACAO', 'BRINQUEDO', 'ACESSORIO', 'HIGIENE', 'SAUDE', 'OUTROS'] as const;
export type CategoriaProduto = (typeof CATEGORIAS)[number];

export const TIPOS_MOVIMENTACAO = ['ENTRADA', 'SAIDA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'ESTORNO'] as const;
export type TipoMovimentacao = (typeof TIPOS_MOVIMENTACAO)[number];

/** Tipos que o usuário pode registrar manualmente. SAIDA e ESTORNO só nascem de pedidos. */
export const TIPOS_MANUAIS = ['ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'] as const;

export interface ProdutoPublico {
  id: number;
  nome: string;
  descricao: string | null;
  categoria: CategoriaProduto;
  marca: string;
  precoCusto: number;
  precoVenda: number;
  isImportado: boolean;
  estoqueAtual: number;
  estoqueMinimo: number;
  estoqueBaixo: boolean;
  ativo: boolean;
  criadoEm: string;
}

export class Produto {
  constructor(
    readonly id: number,
    readonly nome: string,
    readonly descricao: string | null,
    readonly categoria: CategoriaProduto,
    readonly marca: string,
    readonly precoCusto: number,
    readonly precoVenda: number,
    readonly isImportado: boolean,
    readonly estoqueAtual: number,
    readonly estoqueMinimo: number,
    readonly ativo: boolean,
    readonly criadoEm: Date,
  ) {}

  estoqueBaixo(): boolean {
    return this.estoqueAtual <= this.estoqueMinimo;
  }

  paraPublico(): ProdutoPublico {
    return {
      id: this.id,
      nome: this.nome,
      descricao: this.descricao,
      categoria: this.categoria,
      marca: this.marca,
      precoCusto: this.precoCusto,
      precoVenda: this.precoVenda,
      isImportado: this.isImportado,
      estoqueAtual: this.estoqueAtual,
      estoqueMinimo: this.estoqueMinimo,
      estoqueBaixo: this.estoqueBaixo(),
      ativo: this.ativo,
      criadoEm: this.criadoEm.toISOString(),
    };
  }
}

export interface MovimentacaoPublica {
  id: number;
  produtoId: number;
  produtoNome: string;
  pedidoId: number | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  dataMovimentacao: string;
  observacao: string | null;
}

export interface DadosMovimentacao {
  id: number;
  produtoId: number;
  produtoNome: string;
  pedidoId: number | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  dataMovimentacao: Date;
  observacao: string | null;
}

export class Movimentacao {
  constructor(private readonly d: DadosMovimentacao) {}

  paraPublico(): MovimentacaoPublica {
    return { ...this.d, dataMovimentacao: this.d.dataMovimentacao.toISOString() };
  }
}

/** Item usado nas validações/baixas de estoque (será enviado pelo módulo de pedidos). */
export interface ItemEstoque {
  produtoId: number;
  quantidade: number;
}

// ---------- Schemas Zod ----------
const idSchema = EsquemasUsuario.id;

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

const quantidadeSchema = z
  .number(obrigatorio('Quantidade'))
  .int('A quantidade deve ser um número inteiro.')
  .min(1, 'A quantidade deve ser maior que zero.')
  .max(1_000_000, 'A quantidade excede o valor máximo permitido.');

const textoOpcional = (max: number, campo: string) =>
  z
    .string({ invalid_type_error: `${campo} inválido.` })
    .trim()
    .max(max, `${campo} deve ter no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

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