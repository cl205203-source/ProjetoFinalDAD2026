// Canais IPC de entregadores (entregadores:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { EntregadorService } from './entregador.service';

export class EntregadorController extends ControllerBase {
  constructor(private readonly entregadores: EntregadorService) {
    super();
  }

  registrar(): void {
    this.rota('entregadores:listar', (filtro) => this.entregadores.listar(filtro));
    this.rota('entregadores:criar', (dados) => this.entregadores.criar(dados));
    this.rota('entregadores:atualizar', (id, dados) => this.entregadores.atualizar(id, dados));
    this.rota('entregadores:alterarStatus', (id, dados) => this.entregadores.alterarStatus(id, dados));
    this.rota('entregadores:inativar', (id) => this.entregadores.inativar(id));
    this.rota('entregadores:reativar', (id) => this.entregadores.reativar(id));
    this.rota('entregadores:excluir', (id) => this.entregadores.excluir(id));
  }
}
