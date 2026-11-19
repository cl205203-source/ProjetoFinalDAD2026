// Tipos e métodos da ponte do módulo de entregadores (scripts globais: sem import/export).

type StatusEntregadorDTO = 'DISPONIVEL' | 'EM_ROTA' | 'INDISPONIVEL';

interface EntregadorDTO {
  id: number;
  nome: string;
  cpf: string;
  telefone: string;
  veiculo: string;
  placa: string | null;
  status: StatusEntregadorDTO;
  ativo: boolean;
  criadoEm: string;
}

interface DadosEntregadorDTO {
  nome: string;
  cpf: string;
  telefone: string;
  veiculo: string;
  placa: string;
  status: StatusEntregadorDTO;
}

interface FiltroEntregadorDTO {
  busca?: string;
  disponibilidade?: StatusEntregadorDTO;
  status: 'ATIVOS' | 'INATIVOS' | 'TODOS';
}

interface PontePreload {
  listarEntregadores(f: FiltroEntregadorDTO): Promise<RespostaIpc<EntregadorDTO[]>>;
  criarEntregador(d: DadosEntregadorDTO): Promise<RespostaIpc<EntregadorDTO>>;
  atualizarEntregador(id: number, d: DadosEntregadorDTO): Promise<RespostaIpc<EntregadorDTO>>;
  alterarStatusEntregador(id: number, d: { status: StatusEntregadorDTO }): Promise<RespostaIpc<EntregadorDTO>>;
  inativarEntregador(id: number): Promise<RespostaIpc<void>>;
  reativarEntregador(id: number): Promise<RespostaIpc<void>>;
  excluirEntregador(id: number): Promise<RespostaIpc<void>>;
}
