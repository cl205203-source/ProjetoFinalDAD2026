// Canais IPC de clientes (clientes:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { ClienteService } from './cliente.service';

export class ClienteController extends ControllerBase {
  constructor(private readonly clientes: ClienteService) {
    super();
  }

  registrar(): void {
    this.rota('clientes:listar', (filtro) => this.clientes.listar(filtro));
    this.rota('clientes:consultarCep', (cep) => this.clientes.consultarCep(cep));
    this.rota('clientes:criar', (dados) => this.clientes.criar(dados));
    this.rota('clientes:atualizar', (id, dados) => this.clientes.atualizar(id, dados));
    this.rota('clientes:inativar', (id) => this.clientes.inativar(id));
    this.rota('clientes:reativar', (id) => this.clientes.reativar(id));
    this.rota('clientes:excluir', (id) => this.clientes.excluir(id));
  }
}
