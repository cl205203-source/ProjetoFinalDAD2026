// Canais IPC de estoque (estoque:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { EstoqueService } from './estoque.service';

export class EstoqueController extends ControllerBase {
  constructor(private readonly estoque: EstoqueService) {
    super();
  }

  registrar(): void {
    this.rota('estoque:registrar', (dados) => this.estoque.registrarMovimentacao(dados));
    this.rota('estoque:historico', (filtro) => this.estoque.listarHistorico(filtro));
    this.rota('estoque:validarDisponibilidade', (dados) => this.estoque.validarDisponibilidade(dados));
  }
}
