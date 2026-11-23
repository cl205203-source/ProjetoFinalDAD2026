// Canal IPC da cotação do dólar (RF12).
import { ControllerBase } from '../compartilhado/controller-base';
import { AppError } from '../compartilhado/erros';
import { CotacaoApi } from '../integrations';

export class CotacaoController extends ControllerBase {
  constructor(private readonly cotacao: CotacaoApi) {
    super();
  }

  registrar(): void {
    this.rota('cotacao:dolar', async () => {
      const valor = await this.cotacao.consultarDolar();
      if (!valor) throw new AppError('Cotação indisponível no momento. Verifique sua conexão.');
      return valor;
    });
  }
}
