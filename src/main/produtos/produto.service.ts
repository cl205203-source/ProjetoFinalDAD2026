// Regras de negócio de produtos (RF02, RN04).
import { Database } from '../compartilhado/database';
import { AppError } from '../compartilhado/erros';
import { idSchema, Validador } from '../compartilhado/validacao';
import { MovimentacaoRepository } from '../estoque/movimentacao.repository';
import { SessaoService } from '../usuarios/sessao.service';
import { Produto, ProdutoPublico } from './produto.model';
import { ProdutoRepository } from './produto.repository';
import { EsquemasProduto } from './produto.schemas';

export class ProdutoService {
  constructor(
    private readonly produtos: ProdutoRepository,
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly sessao: SessaoService,
    private readonly db: Database,
  ) {}

  /** Admin e Atendente consultam; o Atendente só enxerga produtos ativos. */
  async listar(entrada: unknown): Promise<ProdutoPublico[]> {
    const usuario = this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasProduto.filtro, entrada);
    if (!usuario.ehAdmin()) filtro.status = 'ATIVOS';
    return (await this.produtos.listar(filtro)).map((p) => p.paraPublico());
  }

  async criar(entrada: unknown): Promise<ProdutoPublico> {
    const usuario = this.sessao.exigirPerfil('ADMIN');
    const dados = Validador.parse(EsquemasProduto.criar, entrada);

    const id = await this.db.transacao(async (conn) => {
      const novoId = await this.produtos.criar(dados, dados.estoqueAtual, conn);
      if (dados.estoqueAtual > 0) {
        await this.movimentacoes.registrar(
          {
            produtoId: novoId,
            pedidoId: null,
            usuarioId: usuario.id,
            tipo: 'ENTRADA',
            quantidade: dados.estoqueAtual,
            observacao: 'Estoque inicial (cadastro do produto)',
          },
          conn,
        );
      }
      return novoId;
    });
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  async atualizar(idEntrada: unknown, entrada: unknown): Promise<ProdutoPublico> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    const dados = Validador.parse(EsquemasProduto.atualizar, entrada);
    await this.obterOuFalhar(id);
    await this.produtos.atualizar(id, dados);
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** Soft delete. */
  async inativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    await this.produtos.definirAtivo(id, false);
  }

  async reativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    await this.produtos.definirAtivo(id, true);
  }

  /** Exclusão física só para produto sem histórico (RN04). */
  async excluir(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    if (await this.produtos.possuiVinculos(id)) {
      throw new AppError('Este produto possui pedidos ou movimentações de estoque e não pode ser excluído. Use "Inativar".');
    }
    await this.produtos.excluir(id);
  }

  private async obterOuFalhar(id: number): Promise<Produto> {
    const p = await this.produtos.buscarPorId(id);
    if (!p) throw new AppError('Produto não encontrado.', 'NAO_ENCONTRADO');
    return p;
  }
}
