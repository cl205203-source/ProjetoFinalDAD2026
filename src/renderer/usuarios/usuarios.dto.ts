// Tipos e métodos da ponte do módulo de usuários/autenticação (scripts globais: sem import/export).

type Perfil = 'ADMIN' | 'ATENDENTE';

interface UsuarioDTO {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  criadoEm: string;
}

interface PontePreload {
  login(d: { email: string; senha: string }): Promise<RespostaIpc<UsuarioDTO>>;
  logout(): Promise<RespostaIpc<void>>;
  sessao(): Promise<RespostaIpc<UsuarioDTO | null>>;

  listarUsuarios(): Promise<RespostaIpc<UsuarioDTO[]>>;
  criarUsuario(d: { nome: string; email: string; senha: string; perfil: Perfil }): Promise<RespostaIpc<UsuarioDTO>>;
  atualizarUsuario(id: number, d: { nome: string; email: string; perfil: Perfil }): Promise<RespostaIpc<UsuarioDTO>>;
  redefinirSenha(id: number, d: { novaSenha: string }): Promise<RespostaIpc<void>>;
  alterarMinhaSenha(d: { senhaAtual: string; novaSenha: string }): Promise<RespostaIpc<void>>;
  inativarUsuario(id: number): Promise<RespostaIpc<void>>;
  reativarUsuario(id: number): Promise<RespostaIpc<void>>;
  excluirUsuario(id: number): Promise<RespostaIpc<void>>;
}
