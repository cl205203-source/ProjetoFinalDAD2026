// Canais IPC de usuários (usuarios:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { UsuarioService } from './usuario.service';

export class UsuarioController extends ControllerBase {
  constructor(private readonly usuarios: UsuarioService) {
    super();
  }

  registrar(): void {
    this.rota('usuarios:listar', () => this.usuarios.listar());
    this.rota('usuarios:criar', (dados) => this.usuarios.criar(dados));
    this.rota('usuarios:atualizar', (id, dados) => this.usuarios.atualizar(id, dados));
    this.rota('usuarios:redefinirSenha', (id, dados) => this.usuarios.redefinirSenha(id, dados));
    this.rota('usuarios:alterarMinhaSenha', (dados) => this.usuarios.alterarPropriaSenha(dados));
    this.rota('usuarios:inativar', (id) => this.usuarios.inativar(id));
    this.rota('usuarios:reativar', (id) => this.usuarios.reativar(id));
    this.rota('usuarios:excluir', (id) => this.usuarios.excluir(id));
  }
}
