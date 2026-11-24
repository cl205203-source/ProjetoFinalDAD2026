// Model de cliente (RF05).

export interface ClientePublico {
  id: number;
  nome: string;
  cpf: string; // 11 dígitos
  telefone: string; // DDD + número, só dígitos
  email: string;
  cep: string; // 8 dígitos
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  distanciaKm: number | null; // distância aproximada até a loja (RF06); null se não calculada
  ativo: boolean;
  criadoEm: string;
}

export class Cliente {
  constructor(
    readonly id: number,
    readonly nome: string,
    readonly cpf: string,
    readonly telefone: string,
    readonly email: string,
    readonly cep: string,
    readonly logradouro: string,
    readonly numero: string,
    readonly complemento: string | null,
    readonly bairro: string,
    readonly cidade: string,
    readonly uf: string,
    readonly distanciaKm: number | null,
    readonly ativo: boolean,
    readonly criadoEm: Date,
  ) {}

  /** [RF09] O endereço mudou em relação ao informado? (se mudou, a distância precisa ser recalculada) */
  mudouEndereco(e: { cep: string; logradouro: string; cidade: string; uf: string; numero?: string; bairro?: string }): boolean {
    return (
      this.cep !== e.cep ||
      this.logradouro !== e.logradouro ||
      this.cidade !== e.cidade ||
      this.uf !== e.uf ||
      (e.numero !== undefined && this.numero !== e.numero) ||
      (e.bairro !== undefined && this.bairro !== e.bairro)
    );
  }

  paraPublico(): ClientePublico {
    return {
      id: this.id,
      nome: this.nome,
      cpf: this.cpf,
      telefone: this.telefone,
      email: this.email,
      cep: this.cep,
      logradouro: this.logradouro,
      numero: this.numero,
      complemento: this.complemento,
      bairro: this.bairro,
      cidade: this.cidade,
      uf: this.uf,
      distanciaKm: this.distanciaKm,
      ativo: this.ativo,
      criadoEm: this.criadoEm.toISOString(),
    };
  }
}
