/** Limita tentativas de login por e-mail (proteção básica contra força bruta). */
export class LimitadorTentativas {
  private static readonly MAX_FALHAS = 5;
  private static readonly BLOQUEIO_MS = 5 * 60 * 1000;
  private readonly registros = new Map<string, { falhas: number; bloqueadoAte: number }>();

  segundosBloqueado(chave: string): number {
    const r = this.registros.get(chave);
    if (!r || r.bloqueadoAte <= Date.now()) return 0;
    return Math.ceil((r.bloqueadoAte - Date.now()) / 1000);
  }

  registrarFalha(chave: string): void {
    const r = this.registros.get(chave) ?? { falhas: 0, bloqueadoAte: 0 };
    r.falhas += 1;
    if (r.falhas >= LimitadorTentativas.MAX_FALHAS) {
      r.bloqueadoAte = Date.now() + LimitadorTentativas.BLOQUEIO_MS;
      r.falhas = 0;
    }
    this.registros.set(chave, r);
  }

  limpar(chave: string): void {
    this.registros.delete(chave);
  }
}
