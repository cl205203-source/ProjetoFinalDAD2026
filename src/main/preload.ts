// Ponte segura entre renderer e main.
import { contextBridge, ipcRenderer } from 'electron';
import type { Resultado } from './compartilhado/resultado';
import type { MovimentacaoPublica, TipoMovimentacao } from './estoque/movimentacao.model';
import type { ClientePublico } from './clientes/cliente.model';
import type { EnderecoConsultado } from './clientes/cliente.service';
import type { EntregadorPublico, StatusEntregador } from './entregadores/entregador.model';
import type { CategoriaProduto, ProdutoPublico } from './produtos/produto.model';
import type { PedidoPublico, StatusPedido } from './pedidos/pedido.model';
import type { PainelEntregasPublico, TaxaEntregaPublica } from './entregas/entrega.model';
import type { CotacaoDolar } from './integrations';
import type { PerfilUsuario, UsuarioPublico } from './usuarios/usuario.model';

const chamar = <T>(canal: string, ...args: unknown[]): Promise<Resultado<T>> => ipcRenderer.invoke(canal, ...args);

interface DadosProduto {
  nome: string;
  descricao: string;
  categoria: CategoriaProduto;
  marca: string;
  precoCusto: number;
  precoVenda: number;
  isImportado: boolean;
  estoqueMinimo: number;
}

interface DadosCliente {
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

interface DadosEntregador {
  nome: string;
  cpf: string;
  telefone: string;
  veiculo: string;
  placa: string;
  status: StatusEntregador;
}

contextBridge.exposeInMainWorld('api', {
  statusBanco: (): Promise<{ ok: boolean; erro: string | null }> => ipcRenderer.invoke('db:status'),

  // Autenticação
  login: (d: { email: string; senha: string }) => chamar<UsuarioPublico>('auth:login', d),
  logout: () => chamar<void>('auth:logout'),
  sessao: () => chamar<UsuarioPublico | null>('auth:sessao'),

  // Usuários
  listarUsuarios: () => chamar<UsuarioPublico[]>('usuarios:listar'),
  criarUsuario: (d: { nome: string; email: string; senha: string; perfil: PerfilUsuario }) =>
    chamar<UsuarioPublico>('usuarios:criar', d),
  atualizarUsuario: (id: number, d: { nome: string; email: string; perfil: PerfilUsuario }) =>
    chamar<UsuarioPublico>('usuarios:atualizar', id, d),
  redefinirSenha: (id: number, d: { novaSenha: string }) => chamar<void>('usuarios:redefinirSenha', id, d),
  alterarMinhaSenha: (d: { senhaAtual: string; novaSenha: string }) => chamar<void>('usuarios:alterarMinhaSenha', d),
  inativarUsuario: (id: number) => chamar<void>('usuarios:inativar', id),
  reativarUsuario: (id: number) => chamar<void>('usuarios:reativar', id),
  excluirUsuario: (id: number) => chamar<void>('usuarios:excluir', id),

  // Produtos
  listarProdutos: (f: { busca?: string; categoria?: CategoriaProduto; status: 'ATIVOS' | 'INATIVOS' | 'TODOS'; somenteEstoqueBaixo: boolean }) =>
    chamar<ProdutoPublico[]>('produtos:listar', f),
  criarProduto: (d: DadosProduto & { estoqueAtual: number }) => chamar<ProdutoPublico>('produtos:criar', d),
  atualizarProduto: (id: number, d: DadosProduto) => chamar<ProdutoPublico>('produtos:atualizar', id, d),
  inativarProduto: (id: number) => chamar<void>('produtos:inativar', id),
  reativarProduto: (id: number) => chamar<void>('produtos:reativar', id),
  excluirProduto: (id: number) => chamar<void>('produtos:excluir', id),

  // Estoque
  registrarMovimentacao: (d: { produtoId: number; tipo: TipoMovimentacao; quantidade: number; observacao: string }) =>
    chamar<ProdutoPublico>('estoque:registrar', d),
  listarMovimentacoes: (f: { produtoId?: number; limite?: number }) =>
    chamar<MovimentacaoPublica[]>('estoque:historico', f),
  validarDisponibilidade: (d: { itens: { produtoId: number; quantidade: number }[]; pedidoId?: number }) =>
    chamar<void>('estoque:validarDisponibilidade', d),

  // Clientes
  listarClientes: (f: { busca?: string; status: 'ATIVOS' | 'INATIVOS' | 'TODOS' }) => chamar<ClientePublico[]>('clientes:listar', f),
  consultarCep: (cep: string) => chamar<EnderecoConsultado>('clientes:consultarCep', cep),
  criarCliente: (d: DadosCliente) => chamar<ClientePublico>('clientes:criar', d),
  atualizarCliente: (id: number, d: DadosCliente) => chamar<ClientePublico>('clientes:atualizar', id, d),
  inativarCliente: (id: number) => chamar<void>('clientes:inativar', id),
  reativarCliente: (id: number) => chamar<void>('clientes:reativar', id),
  excluirCliente: (id: number) => chamar<void>('clientes:excluir', id),

  // Entregadores
  listarEntregadores: (f: { busca?: string; disponibilidade?: StatusEntregador; status: 'ATIVOS' | 'INATIVOS' | 'TODOS' }) =>
    chamar<EntregadorPublico[]>('entregadores:listar', f),
  criarEntregador: (d: DadosEntregador) => chamar<EntregadorPublico>('entregadores:criar', d),
  atualizarEntregador: (id: number, d: DadosEntregador) => chamar<EntregadorPublico>('entregadores:atualizar', id, d),
  alterarStatusEntregador: (id: number, d: { status: StatusEntregador }) =>
    chamar<EntregadorPublico>('entregadores:alterarStatus', id, d),
  inativarEntregador: (id: number) => chamar<void>('entregadores:inativar', id),
  reativarEntregador: (id: number) => chamar<void>('entregadores:reativar', id),
  excluirEntregador: (id: number) => chamar<void>('entregadores:excluir', id),

  // Pedidos
  listarPedidos: (f: { busca?: string; status?: StatusPedido; clienteId?: number; entregadorId?: number }) =>
    chamar<PedidoPublico[]>('pedidos:listar', f),
  obterPedido: (id: number) => chamar<PedidoPublico>('pedidos:obter', id),
  criarPedido: (d: {
    clienteId: number;
    entregadorId: number | null;
    distanciaKm: number | null;
    valorFrete: number;
    statusPedido: StatusPedido;
    itens: { produtoId: number; quantidade: number }[];
  }) => chamar<PedidoPublico>('pedidos:criar', d),
  atualizarPedido: (
    id: number,
    d: {
      clienteId: number;
      entregadorId: number | null;
      distanciaKm: number | null;
      valorFrete: number;
      statusPedido: StatusPedido;
      itens: { produtoId: number; quantidade: number }[];
    },
  ) => chamar<PedidoPublico>('pedidos:atualizar', id, d),
  alterarStatusPedido: (id: number, d: { statusPedido: StatusPedido; entregadorId: number | null }) =>
    chamar<PedidoPublico>('pedidos:alterarStatus', id, d),
  cancelarPedido: (id: number, d: { observacao?: string | null }) => chamar<PedidoPublico>('pedidos:cancelar', id, d),
  excluirPedido: (id: number) => chamar<void>('pedidos:excluir', id),

  // Entregas (RF09/RF10): taxa calculada no main e central de entregas
  calcularTaxaEntrega: (d: { clienteId: number; valorItens?: number }) =>
    chamar<TaxaEntregaPublica>('entregas:calcularTaxa', d),
  painelEntregas: () => chamar<PainelEntregasPublico>('entregas:painel'),
  vincularEntregador: (d: { pedidoId: number; entregadorId: number }) =>
    chamar<PedidoPublico>('entregas:vincular', d),
  alterarStatusEntrega: (d: { pedidoId: number; statusPedido: StatusPedido }) =>
    chamar<PedidoPublico>('entregas:alterarStatus', d),

  // Cotação do dólar (RF12)
  consultarCotacaoDolar: () => chamar<CotacaoDolar>('cotacao:dolar'),
});
