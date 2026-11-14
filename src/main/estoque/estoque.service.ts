// Motor de estoque (RF03/RF04, RN01): movimentações manuais, histórico e baixa/estorno de pedidos.
import { PoolConnection } from 'mysql2/promise';
import { Database } from '../compartilhado/database';
import { AppError } from '../compartilhado/erros';
import { Validador } from '../compartilhado/validacao';
import { ProdutoPublico } from '../produtos/produto.model';
import { ProdutoRepository } from '../produtos/produto.repository';
import { SessaoService } from '../usuarios/sessao.service';
import { EsquemasEstoque } from './estoque.schemas';
import { ItemEstoque, MovimentacaoPublica } from './movimentacao.model';
import { MovimentacaoRepository } from './movimentacao.repository';

export class EstoqueService {
  constructor(
    private readonly produtos: ProdutoRepository,
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly sessao: SessaoService,
    private readonly db: Database,
  ) {}

  /** RF04: entrada (Admin/Atendente) ou ajuste manual (só Admin), sempre com histórico. */
  async registrarMovimentacao(entrada: unknown): Promise<ProdutoPublico> {
    const usuario = this.sessao.exigirLogado();
    const dados = Validador.parse(EsquemasEstoque.movimentacao, entrada);

    if (dados.tipo !== 'ENTRADA' && !usuario.ehAdmin()) {
      throw new AppError('Somente o Administrador pode fazer ajustes manuais de estoque.', 'SEM_PERMISSAO');
    }

    await this.db.transacao(async (conn) => {
      const produto = await this.produtos.buscarPorId(dados.produtoId, conn);
      if (!produto) throw new AppError('Produto não encontrado.', 'NAO_ENCONTRADO');
      if (!produto.ativo) throw new AppError('Produto inativo. Reative-o antes de movimentar o estoque.');

      const delta = dados.tipo === 'AJUSTE_NEGATIVO' ? -dados.quantidade : dados.quantidade;
      if (!(await this.produtos.ajustarEstoque(dados.produtoId, delta, conn))) {
        throw new AppError(
          `Saldo insuficiente: "${produto.nome}" tem ${produto.estoqueAtual} unidade(s) e a baixa é de ${dados.quantidade}.`,
        );
      }
      await this.movimentacoes.registrar(
        {
          produtoId: dados.produtoId,
          pedidoId: null,
          usuarioId: usuario.id,
          tipo: dados.tipo,
          quantidade: dados.quantidade,
          observacao: dados.observacao,
        },
        conn,
      );
    });

    const atualizado = await this.produtos.buscarPorId(dados.produtoId);
    return atualizado!.paraPublico();
  }

  async listarHistorico(entrada: unknown): Promise<MovimentacaoPublica[]> {
    this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasEstoque.historico, entrada);
    return (await this.movimentacoes.listar(filtro.produtoId ?? null, filtro.limite)).map((m) => m.paraPublico());
  }

  /**
   * RF03/RN01: valida se há saldo para os itens (só leitura, para dar feedback na tela).
   * Ao editar um pedido, informe o pedidoId: o que já foi baixado para ele conta como disponível.
   */
  async validarDisponibilidade(entrada: unknown): Promise<void> {
    this.sessao.exigirLogado();
    const { itens, pedidoId } = Validador.parse(EsquemasEstoque.disponibilidade, entrada);
    const jaBaixado = pedidoId
      ? await this.movimentacoes.saldoBaixadoPorPedido(pedidoId)
      : new Map<number, number>();

    const problemas: string[] = [];
    for (const [produtoId, qtd] of EstoqueService.consolidar(itens)) {
      const p = await this.produtos.buscarPorId(produtoId);
      if (!p) {
        problemas.push(`Produto #${produtoId} não encontrado.`);
        continue;
      }
      if (!p.ativo) {
        problemas.push(`"${p.nome}" está inativo.`);
        continue;
      }
      const disponivel = p.estoqueAtual + (jaBaixado.get(produtoId) ?? 0);
      if (qtd > disponivel) {
        problemas.push(`Estoque insuficiente para "${p.nome}": disponível ${disponivel}, solicitado ${qtd}.`);
      }
    }
    if (problemas.length) throw new AppError(problemas.join(' '));
  }

  /**
   * RF03: alinha o estoque baixado ao que o pedido precisa AGORA.
   * - Confirmar pedido:  sincronizarPedido(conn, id, itens)  -> baixa (SAIDA)
   * - Editar pedido:     sincronizarPedido(conn, id, novosItens) -> baixa/estorna só a diferença
   * - Cancelar pedido:   estornarPedido(conn, id)             -> devolve tudo (ESTORNO)
   * Deve ser chamado DENTRO da transação do pedido (por isso recebe a conexão).
   * Repetir a chamada com os mesmos dados não gera movimentações duplicadas.
   */
  async sincronizarPedido(conn: PoolConnection, pedidoId: number, itensEntrada: ItemEstoque[]): Promise<void> {
    const usuario = this.sessao.exigirLogado();
    const desejado = EstoqueService.consolidar(Validador.parse(EsquemasEstoque.itens, itensEntrada));
    const baixado = await this.movimentacoes.saldoBaixadoPorPedido(pedidoId, conn);

    // Ordem fixa de ids evita deadlock entre transações concorrentes.
    const ids = [...new Set([...desejado.keys(), ...baixado.keys()])].sort((a, b) => a - b);

    for (const produtoId of ids) {
      const delta = (desejado.get(produtoId) ?? 0) - (baixado.get(produtoId) ?? 0);
      if (delta === 0) continue;

      const produto = await this.produtos.buscarPorId(produtoId, conn);
      if (!produto) throw new AppError(`Produto #${produtoId} não encontrado.`, 'NAO_ENCONTRADO');

      if (delta > 0) {
        if (!produto.ativo) throw new AppError(`"${produto.nome}" está inativo e não pode ser vendido.`);
        if (!(await this.produtos.ajustarEstoque(produtoId, -delta, conn))) {
          throw new AppError(
            `Estoque insuficiente para "${produto.nome}": disponível ${produto.estoqueAtual}, necessário ${delta}.`,
          );
        }
        await this.movimentacoes.registrar(
          { produtoId, pedidoId, usuarioId: usuario.id, tipo: 'SAIDA', quantidade: delta, observacao: `Baixa automática - pedido #${pedidoId}` },
          conn,
        );
      } else {
        await this.produtos.ajustarEstoque(produtoId, -delta, conn);
        await this.movimentacoes.registrar(
          { produtoId, pedidoId, usuarioId: usuario.id, tipo: 'ESTORNO', quantidade: -delta, observacao: `Estorno - pedido #${pedidoId}` },
          conn,
        );
      }
    }
  }

  /** Cancelamento: devolve ao estoque tudo que foi baixado para o pedido. */
  estornarPedido(conn: PoolConnection, pedidoId: number): Promise<void> {
    return this.sincronizarPedido(conn, pedidoId, []);
  }

  /** Soma quantidades de linhas repetidas do mesmo produto. */
  private static consolidar(itens: ItemEstoque[]): Map<number, number> {
    const mapa = new Map<number, number>();
    for (const i of itens) mapa.set(i.produtoId, (mapa.get(i.produtoId) ?? 0) + i.quantidade);
    return mapa;
  }
}
