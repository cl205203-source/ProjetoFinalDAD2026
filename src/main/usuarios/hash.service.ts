import bcrypt from 'bcryptjs';

/** Hash de senha (bcrypt com sal aleatório embutido). */
export class HashService {
  private static readonly CUSTO = 12;

  gerar(senha: string): Promise<string> {
    return bcrypt.hash(senha, HashService.CUSTO);
  }

  comparar(senha: string, hash: string): Promise<boolean> {
    return bcrypt.compare(senha, hash);
  }
}
