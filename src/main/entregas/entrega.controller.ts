// RF09/RF10: canais IPC da central de entregas (entregas:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { EntregaService } from './entrega.service';

export class EntregaController extends ControllerBase {
  constructor(private readonly entregas: EntregaService) {
    super();
  }

  registrar(): void {
    this.rota('entregas:painel', () => this.entregas.painel());
    this.rota('entregas:calcularTaxa', (dados) => this.entregas.calcularTaxa(dados));
    this.rota('entregas:vincular', (dados) => this.entregas.vincular(dados));
    this.rota('entregas:alterarStatus', (dados) => this.entregas.alterarStatus(dados));
  }
}
