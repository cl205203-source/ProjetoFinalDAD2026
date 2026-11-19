// Model de entregador (RF07).

export const STATUS_ENTREGADOR = ['DISPONIVEL', 'EM_ROTA', 'INDISPONIVEL'] as const;
export type StatusEntregador = (typeof STATUS_ENTREGADOR)[number];

export interface EntregadorPublico {
  id: number;
  nome: string;
  cpf: string; // 11 dígitos
  telefone: string; // DDD + número, só dígitos
  veiculo: string;
  placa: string | null; // null para bicicleta e similares
  status: StatusEntregador;
  ativo: boolean;
  criadoEm: string;
}

export class Entregador {
  constructor(
    readonly id: number,
    readonly nome: string,
    readonly cpf: string,
    readonly telefone: string,
    readonly veiculo: string,
    readonly placa: string | null,
    readonly status: StatusEntregador,
    readonly ativo: boolean,
    readonly criadoEm: Date,
  ) {}

  estaEmRota(): boolean {
    return this.status === 'EM_ROTA';
  }

  paraPublico(): EntregadorPublico {
    return {
      id: this.id,
      nome: this.nome,
      cpf: this.cpf,
      telefone: this.telefone,
      veiculo: this.veiculo,
      placa: this.placa,
      status: this.status,
      ativo: this.ativo,
      criadoEm: this.criadoEm.toISOString(),
    };
  }
}
