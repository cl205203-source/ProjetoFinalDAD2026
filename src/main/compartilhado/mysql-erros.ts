// Códigos de erro do MySQL que os módulos tratam de forma específica.
export class ErroMysql {
  static readonly DUPLICADO = 1062;
  static readonly COLUNA_INEXISTENTE = 1054;
  static readonly TABELA_INEXISTENTE = 1146;
  static readonly REFERENCIADO_POR_FK = 1451;

  static codigo(e: unknown): number | undefined {
    return (e as { errno?: number } | null)?.errno;
  }

  static ehCodigo(e: unknown, ...codigos: number[]): boolean {
    const c = ErroMysql.codigo(e);
    return c !== undefined && codigos.includes(c);
  }
}
