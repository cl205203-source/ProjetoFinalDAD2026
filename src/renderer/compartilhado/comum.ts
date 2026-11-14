// Código compartilhado pelas telas.
// ATENÇÃO: arquivos do renderer rodam como scripts no navegador: NÃO podem ter import/export.
// Os tipos (DTOs) e os métodos da ponte de cada módulo ficam em <modulo>/<modulo>.dto.ts.

type RespostaIpc<T> = { ok: true; dados: T } | { ok: false; erro: string };

/** Ponte exposta pelo preload (window.api). Cada módulo acrescenta seus métodos no próprio .dto.ts. */
interface PontePreload {
  statusBanco(): Promise<{ ok: boolean; erro: string | null }>;
}

const bridge = (window as unknown as { api: PontePreload }).api;

/** Contrato das telas: o App só chama estes métodos. */
interface Tela {
  ativar(usuario: UsuarioDTO): Promise<void>;
  limpar(): void;
}

class Dom {
  static criar<K extends keyof HTMLElementTagNameMap>(tag: K, classe = '', texto = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto) e.textContent = texto;
    return e;
  }

  static botao(texto: string, classe: string, aoClicar: () => void): HTMLButtonElement {
    const b = Dom.criar('button', classe, texto);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    return b;
  }

  static pegar<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }
}

/** Mensagem de sucesso/erro exibida no topo da área logada. */
class Aviso {
  static mostrar(texto: string, tipo: 'success' | 'danger'): void {
    const a = Dom.pegar<HTMLElement>('alerta');
    a.textContent = texto;
    a.className = `alert alert-${tipo}`;
  }

  static limpar(): void {
    Dom.pegar('alerta').className = 'alert d-none';
  }
}

class Formato {
  static moeda(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  static dataHora(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR');
  }

  /** Aceita "12,50", "1.234,56" ou "12.5". Vazio vira NaN (o main rejeita). */
  static decimal(texto: string): number {
    const t = texto.trim();
    if (!t) return NaN;
    return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  }

  static inteiro(texto: string): number {
    const t = texto.trim();
    return t ? Number(t) : NaN;
  }
}

class Rotulos {
  static readonly CATEGORIA: Record<Categoria, string> = {
    RACAO: 'Ração',
    BRINQUEDO: 'Brinquedo',
    ACESSORIO: 'Acessório',
    HIGIENE: 'Higiene',
    SAUDE: 'Saúde',
    OUTROS: 'Outros',
  };

  static readonly MOVIMENTACAO: Record<TipoMov, { rotulo: string; sinal: '+' | '-'; classe: string }> = {
    ENTRADA: { rotulo: 'Entrada', sinal: '+', classe: 'bg-success' },
    SAIDA: { rotulo: 'Saída (pedido)', sinal: '-', classe: 'bg-danger' },
    AJUSTE_POSITIVO: { rotulo: 'Ajuste (+)', sinal: '+', classe: 'bg-info text-dark' },
    AJUSTE_NEGATIVO: { rotulo: 'Ajuste (−)', sinal: '-', classe: 'bg-warning text-dark' },
    ESTORNO: { rotulo: 'Estorno', sinal: '+', classe: 'bg-secondary' },
  };
}
