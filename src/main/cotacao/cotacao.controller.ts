// Canal IPC da cotação do dólar (RF12).
import { ControllerBase } from '../compartilhado/controller-base';
import { CotacaoApi } from '../integrations';

export class CotacaoController extends ControllerBase {
  constructor(private readonly cotacao: CotacaoApi) {
    super();
  }

  registrar(): void {
    this.rota('cotacao:dolar', async () => {
      const valor = await this.cotacao.consultarDolar();
      if (!valor) throw new Error('Cotação indisponível no momento.');
      return valor;
    });
  }
}
