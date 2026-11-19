// Tipos e métodos da ponte do módulo de clientes (scripts globais: sem import/export).

interface ClienteDTO {
  id: number;
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  distanciaKm: number | null;
  ativo: boolean;
  criadoEm: string;
}

interface DadosClienteDTO {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

interface EnderecoCepDTO {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  distanciaKm: number | null;
}

interface FiltroClienteDTO {
  busca?: string;
  status: 'ATIVOS' | 'INATIVOS' | 'TODOS';
}

interface PontePreload {
  listarClientes(f: FiltroClienteDTO): Promise<RespostaIpc<ClienteDTO[]>>;
  consultarCep(cep: string): Promise<RespostaIpc<EnderecoCepDTO>>;
  criarCliente(d: DadosClienteDTO): Promise<RespostaIpc<ClienteDTO>>;
  atualizarCliente(id: number, d: DadosClienteDTO): Promise<RespostaIpc<ClienteDTO>>;
  inativarCliente(id: number): Promise<RespostaIpc<void>>;
  reativarCliente(id: number): Promise<RespostaIpc<void>>;
  excluirCliente(id: number): Promise<RespostaIpc<void>>;
}
