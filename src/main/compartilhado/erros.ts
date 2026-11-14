// Erros de negócio compartilhados por todos os módulos.

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
