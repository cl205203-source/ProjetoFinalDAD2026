// Ponte segura entre renderer e main.
import { contextBridge, ipcRenderer } from 'electron';
import type { Resultado } from './controllers';
import type { PerfilUsuario, UsuarioPublico } from './models';

const chamar = <T>(canal: string, ...args: unknown[]): Promise<Resultado<T>> => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld('api', {
  statusBanco: (): Promise<{ ok: boolean; erro: string | null }> => ipcRenderer.invoke('db:status'),

  // Autenticação
  login: (d: { email: string; senha: string }) => chamar<UsuarioPublico>('auth:login', d),
  logout: () => chamar<void>('auth:logout'),
  sessao: () => chamar<UsuarioPublico | null>('auth:sessao'),

  // Usuários
  listarUsuarios: () => chamar<UsuarioPublico[]>('usuarios:listar'),
  criarUsuario: (d: { nome: string; email: string; senha: string; perfil: PerfilUsuario }) =>
    chamar<UsuarioPublico>('usuarios:criar', d),
  atualizarUsuario: (id: number, d: { nome: string; email: string; perfil: PerfilUsuario }) =>
    chamar<UsuarioPublico>('usuarios:atualizar', id, d),
  redefinirSenha: (id: number, d: { novaSenha: string }) => chamar<void>('usuarios:redefinirSenha', id, d),
  alterarMinhaSenha: (d: { senhaAtual: string; novaSenha: string }) => chamar<void>('usuarios:alterarMinhaSenha', d),
  inativarUsuario: (id: number) => chamar<void>('usuarios:inativar', id),
  reativarUsuario: (id: number) => chamar<void>('usuarios:reativar', id),
  excluirUsuario: (id: number) => chamar<void>('usuarios:excluir', id),
});