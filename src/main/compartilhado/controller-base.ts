// Base dos controllers: registra canais IPC com tratamento de erro padronizado.
import { ipcMain } from 'electron';
import { AppError } from './erros';
import { Resultado } from './resultado';

export abstract class ControllerBase {
  /** Padroniza a resposta: erros de negócio viram mensagem; erros inesperados não vazam detalhes. */
  protected rota(canal: string, tratador: (...args: unknown[]) => unknown): void {
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
