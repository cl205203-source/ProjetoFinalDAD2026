// Campos brasileiros reutilizáveis (CPF, telefone, CEP, UF). Usado por clientes e entregadores.
import { z } from 'zod';
import { obrigatorio } from './validacao';

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export type UF = (typeof UFS)[number];

export class CamposBr {
  static somenteDigitos(valor: string): string {
    return valor.replace(/\D/g, '');
  }

  /** Valida CPF pelos dígitos verificadores (recebe só números). */
  static cpfValido(cpf: string): boolean {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    const digito = (base: string, pesoInicial: number): number => {
      let soma = 0;
      for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    return digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
  }

  /** DDD + número: 10 dígitos (fixo) ou 11 (celular, começando com 9). */
  static telefoneValido(tel: string): boolean {
    if (!/^[1-9]\d{9,10}$/.test(tel)) return false;
    return tel.length === 10 || tel[2] === '9';
  }
}

/** CPF: aceita com ou sem máscara e devolve só os 11 dígitos. */
export const cpfSchema = z
  .string(obrigatorio('CPF'))
  .transform(CamposBr.somenteDigitos)
  .refine(CamposBr.cpfValido, 'CPF inválido.');

export const telefoneSchema = z
  .string(obrigatorio('Telefone'))
  .transform(CamposBr.somenteDigitos)
  .refine(CamposBr.telefoneValido, 'Telefone inválido. Informe DDD + número.');

export const cepSchema = z
  .string(obrigatorio('CEP'))
  .transform(CamposBr.somenteDigitos)
  .refine((v) => v.length === 8, 'CEP inválido. Informe 8 dígitos.');

export const ufSchema = z.enum(UFS, { error: 'UF inválida.' });
