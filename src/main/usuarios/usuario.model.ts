// Model do usuário (RF01): entidade, tipos públicos e perfis.

export const PERFIS = ['ADMIN', 'ATENDENTE'] as const;
export type PerfilUsuario = (typeof PERFIS)[number];

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
