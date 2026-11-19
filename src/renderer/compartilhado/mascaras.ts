// Máscaras de campos brasileiros (scripts globais: sem import/export).

class Mascara {
  static digitos(v: string): string {
    return v.replace(/\D/g, '');
  }

  static cpf(v: string): string {
    const d = Mascara.digitos(v).slice(0, 11);
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }

  static telefone(v: string): string {
    const d = Mascara.digitos(v).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  static cep(v: string): string {
    const d = Mascara.digitos(v).slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }

  static placa(v: string): string {
    return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  }

  /** Aplica a máscara enquanto a pessoa digita. */
  static aplicar(campo: HTMLInputElement, formatar: (v: string) => string): void {
    campo.addEventListener('input', () => {
      campo.value = formatar(campo.value);
    });
  }
}
