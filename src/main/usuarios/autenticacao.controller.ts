// Canais IPC de autenticação (auth:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { AutenticacaoService } from './autenticacao.service';
import { SessaoService } from './sessao.service';

export class AutenticacaoController extends ControllerBase {
  constructor(
    private readonly autenticacao: AutenticacaoService,
    private readonly sessao: SessaoService,
  ) {
    super();
  }

  registrar(): void {
    this.rota('auth:login', (dados) => this.autenticacao.login(dados));
    this.rota('auth:logout', () => this.autenticacao.logout());
    this.rota('auth:sessao', () => this.sessao.obter()?.paraPublico() ?? null);
  }
}
