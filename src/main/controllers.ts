// Controllers: registram os canais IPC e delegam para os services.
import { ipcMain } from 'electron';
import { AppError } from './models';
import { AutenticacaoService, SessaoService, UsuarioService } from './services';

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

export class UsuarioController {
  constructor(
    private readonly autenticacao: AutenticacaoService,
    private readonly usuarios: UsuarioService,
    private readonly sessao: SessaoService,
  ) {}

  registrar(): void {
    this.rota('auth:login', (dados) => this.autenticacao.login(dados));
    this.rota('auth:logout', () => this.autenticacao.logout());
    this.rota('auth:sessao', () => this.sessao.obter()?.paraPublico() ?? null);

    this.rota('usuarios:listar', () => this.usuarios.listar());
    this.rota('usuarios:criar', (dados) => this.usuarios.criar(dados));
    this.rota('usuarios:atualizar', (id, dados) => this.usuarios.atualizar(id, dados));
    this.rota('usuarios:redefinirSenha', (id, dados) => this.usuarios.redefinirSenha(id, dados));
    this.rota('usuarios:alterarMinhaSenha', (dados) => this.usuarios.alterarPropriaSenha(dados));
    this.rota('usuarios:inativar', (id) => this.usuarios.inativar(id));
    this.rota('usuarios:reativar', (id) => this.usuarios.reativar(id));
    this.rota('usuarios:excluir', (id) => this.usuarios.excluir(id));
  }

  /** Padroniza a resposta: erros de negócio viram mensagem; erros inesperados não vazam detalhes. */
  private rota(canal: string, tratador: (...args: unknown[]) => unknown): void {
    ipcMain.handle(canal, async (_evento, ...args: unknown[]): Promise<Resultado<unknown>> => {
      try {
        return { ok: true, dados: await tratador(...args) };
      } catch (e) {
        if (e instanceof AppError) return { ok: false, erro: e.message };
        console.error(`[${canal}]`, e);
        return { ok: false, erro: 'Erro interno. Tente novamente.' };
      }
    });
  }
}