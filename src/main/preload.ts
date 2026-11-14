// Ponte segura entre renderer e main.
import { contextBridge, ipcRenderer } from 'electron';
import type { Resultado } from './compartilhado/resultado';
import type { MovimentacaoPublica, TipoMovimentacao } from './estoque/movimentacao.model';
import type { CategoriaProduto, ProdutoPublico } from './produtos/produto.model';
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
});
