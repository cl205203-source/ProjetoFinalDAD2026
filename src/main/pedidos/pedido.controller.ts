// Canais IPC de pedidos (pedidos:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { PedidoService } from './pedido.service';

export class PedidoController extends ControllerBase {
  constructor(private readonly pedidos: PedidoService) {
    super();
  }

  registrar(): void {
    this.rota('pedidos:listar', (filtro) => this.pedidos.listar(filtro));
    this.rota('pedidos:obter', (id) => this.pedidos.obter(id));
    this.rota('pedidos:criar', (dados) => this.pedidos.criar(dados));
    this.rota('pedidos:atualizar', (id, dados) => this.pedidos.atualizar(id, dados));
    this.rota('pedidos:alterarStatus', (id, dados) => this.pedidos.alterarStatus(id, dados));
    this.rota('pedidos:cancelar', (id, dados) => this.pedidos.cancelar(id, dados));
    this.rota('pedidos:excluir', (id) => this.pedidos.excluir(id));
  }
}
