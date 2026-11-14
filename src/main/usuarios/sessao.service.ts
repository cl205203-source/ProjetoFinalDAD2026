import { AppError } from '../compartilhado/erros';
import { PerfilUsuario, Usuario } from './usuario.model';

/** Guarda quem está logado (processo main) e centraliza a checagem de permissões. */
export class SessaoService {
  private atual: Usuario | null = null;

  iniciar(usuario: Usuario): void {
    this.atual = usuario;
  }

  encerrar(): void {
    this.atual = null;
  }

  obter(): Usuario | null {
    return this.atual;
  }

  exigirLogado(): Usuario {
    if (!this.atual) throw new AppError('Faça login para continuar.', 'NAO_AUTENTICADO');
    return this.atual;
  }

  exigirPerfil(...perfis: PerfilUsuario[]): Usuario {
    const u = this.exigirLogado();
    if (!perfis.includes(u.perfil)) {
      throw new AppError('Você não tem permissão para realizar esta ação.', 'SEM_PERMISSAO');
    }
    return u;
  }
}
