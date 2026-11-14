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