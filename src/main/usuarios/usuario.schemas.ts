// Schemas Zod do usuário (RF01). Toda entrada vinda do renderer passa por aqui.
import { z } from 'zod';
import { idSchema, obrigatorio } from '../compartilhado/validacao';
import { PERFIS } from './usuario.model';

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

const perfilSchema = z.enum(PERFIS, { error: 'Perfil inválido.' });

export class EsquemasUsuario {
  static readonly id = idSchema;

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
