// Regras de negócio de pedidos (RF08, RN01/RN02/RN04). Permissões checadas aqui, no processo main.
import { AppError } from '../compartilhado/erros';
import { ErroMysql } from '../compartilhado/mysql-erros';
import { Database, Executor } from '../compartilhado/database';
import { idSchema, Validador } from '../compartilhado/validacao';
import { EstoqueService } from '../estoque/estoque.service';
import { SessaoService } from '../usuarios/sessao.service';
import { Pedido, PedidoPublico, StatusPedido } from './pedido.model';
import { DadosCabecalhoPedido, ItemParaGravar, PedidoRepository } from './pedido.repository';
import { EsquemasPedido, itemPedidoSchema } from './pedido.schemas';

/** Status que não podem ser alterados nem excluídos (histórico operacional). */
const STATUS_FINAIS: StatusPedido[] = ['ENTREGUE', 'CANCELADO'];

export class PedidoService {
  constructor(
    private readonly pedidos: PedidoRepository,
    private readonly estoque: EstoqueService,
    private readonly db: Database,
    private readonly sessao: SessaoService,
  ) {}

  /** Admin e Atendente consultam. */
  async listar(entrada: unknown): Promise<PedidoPublico[]> {
    this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasPedido.filtro, entrada);
    return (await this.pedidos.listar(filtro)).map((p) => p.paraPublico());
  }

  async obter(idEntrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirLogado();
    return (await this.obterOuFalhar(Validador.parse(idSchema, idEntrada))).paraPublico();
  }

  /**
   * RF08: cria o pedido com itens, buscando os preços no banco (nunca confia no renderer).
   * Tudo numa transação: cabeçalho + itens + baixa de estoque (RF03).
   */
  async criar(entrada: unknown): Promise<PedidoPublico> {
    const usuario = this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const dados = Validador.parse(EsquemasPedido.criar, entrada);

    const id = await this.db.transacao(async (conn) => {
      await this.garantirCliente(dados.clienteId, conn);
      if (dados.entregadorId !== null) {
        if (!(await this.pedidos.entregadorDisponivel(dados.entregadorId, conn))) {
          throw new AppError('Entregador indisponível. Escolha um entregador ativo e disponível.');
        }
      }
      await this.garantirStatusInicial(dados.statusPedido, dados.entregadorId);

      const itens = await this.prepararItens(dados.itens, conn);
      const valorItens = itens.reduce((s, i) => s + i.subtotal, 0);
      const cabecalho: DadosCabecalhoPedido = {
        clienteId: dados.clienteId,
        entregadorId: dados.entregadorId,
        usuarioId: usuario.id,
        distanciaKm: dados.distanciaKm,
        valorFrete: dados.valorFrete,
        valorTotal: PedidoService.arredondar(valorItens + dados.valorFrete),
        statusPedido: dados.statusPedido,
      };

      const pedidoId = await this.pedidos.criar(cabecalho, itens, conn);
      await this.estoque.sincronizarPedido(conn, pedidoId, dados.itens);
      return pedidoId;
    });

    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** RF08: edita cabeçalho e itens; o estoque é ajustado só pela diferença (RF03). */
  async atualizar(idEntrada: unknown, entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    const dados = Validador.parse(EsquemasPedido.atualizar, entrada);

    await this.db.transacao(async (conn) => {
      const atual = await this.obterOuFalhar(id, conn);
      this.garantirEditavel(atual);

      await this.garantirCliente(dados.clienteId, conn);
      if (dados.entregadorId !== null && dados.entregadorId !== atual.entregadorId) {
        if (!(await this.pedidos.entregadorDisponivel(dados.entregadorId, conn))) {
          throw new AppError('Entregador indisponível. Escolha um entregador ativo e disponível.');
        }
      }
      await this.garantirStatusInicial(dados.statusPedido, dados.entregadorId);

      const itens = await this.prepararItens(dados.itens, conn);
      const valorItens = itens.reduce((s, i) => s + i.subtotal, 0);
      const cabecalho: DadosCabecalhoPedido = {
        clienteId: dados.clienteId,
        entregadorId: dados.entregadorId,
        usuarioId: atual.usuarioId, // quem criou o pedido nunca muda
        distanciaKm: dados.distanciaKm,
        valorFrete: dados.valorFrete,
        valorTotal: PedidoService.arredondar(valorItens + dados.valorFrete),
        statusPedido: dados.statusPedido,
      };

      await this.pedidos.atualizar(id, cabecalho, itens, conn);
      await this.estoque.sincronizarPedido(conn, id, dados.itens);
    });

    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** RF08/RF10: muda o status do pedido (RN02: "Saiu para Entrega" exige entregador). */
  async alterarStatus(idEntrada: unknown, entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    const { statusPedido, entregadorId } = Validador.parse(EsquemasPedido.alterarStatus, entrada);

    await this.db.transacao(async (conn) => {
      const atual = await this.obterOuFalhar(id, conn);
      this.garantirEditavel(atual);

      const entregadorFinal = entregadorId ?? atual.entregadorId;
      if (statusPedido === 'SAIU_PARA_ENTREGA' && entregadorFinal === null) {
        throw new AppError('Vincule um entregador antes de marcar "Saiu para Entrega".', 'REGRA_NEGOCIO');
      }
      if (entregadorFinal !== null && entregadorFinal !== atual.entregadorId) {
        if (!(await this.pedidos.entregadorDisponivel(entregadorFinal, conn))) {
          throw new AppError('Entregador indisponível. Escolha um entregador ativo e disponível.');
        }
      }
      await this.pedidos.definirStatus(id, statusPedido, entregadorFinal, conn);
    });

    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** RF08/RF03: cancela e devolve ao estoque tudo que foi baixado. */
  async cancelar(idEntrada: unknown, entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    Validador.parse(EsquemasPedido.cancelar, entrada);

    await this.db.transacao(async (conn) => {
      const atual = await this.obterOuFalhar(id, conn);
      if (atual.estaCancelado()) return;
      if (atual.status === 'ENTREGUE') throw new AppError('Não é possível cancelar um pedido já entregue.');

      await this.estoque.estornarPedido(conn, id);
      await this.pedidos.definirStatus(id, 'CANCELADO', atual.entregadorId, conn);
    });

    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** RN04: exclusão física permitida somente para pedidos cancelados (histórico preservado). */
  async excluir(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);

    try {
      await this.db.transacao(async (conn) => {
        const atual = await this.obterOuFalhar(id, conn);
        if (!atual.estaCancelado()) {
          throw new AppError('Cancele o pedido antes de excluí-lo. Pedidos ativos fazem parte do histórico.');
        }
        await this.pedidos.excluir(id, conn);
      });
    } catch (e) {
      if (ErroMysql.ehCodigo(e, ErroMysql.REFERENCIADO_POR_FK)) {
        throw new AppError('Este pedido possui vínculos (movimentações de estoque) e não pode ser excluído.');
      }
      throw e;
    }
  }

  // ---------- Auxiliares ----------

  private async obterOuFalhar(id: number, exec: Executor = this.db.pool): Promise<Pedido> {
    const p = await this.pedidos.buscarPorId(id, exec);
    if (!p) throw new AppError('Pedido não encontrado.', 'NAO_ENCONTRADO');
    return p;
  }

  private async garantirCliente(clienteId: number, exec: Executor = this.db.pool): Promise<void> {
    if (!(await this.pedidos.clienteExiste(clienteId, exec))) {
      throw new AppError('Cliente não encontrado ou inativo. Selecione um cliente ativo.', 'NAO_ENCONTRADO');
    }
  }

  /** Busca nome/preço no banco, consolida itens repetidos e calcula os subtotais. */
  private async prepararItens(itens: { produtoId: number; quantidade: number }[], exec: Executor = this.db.pool): Promise<ItemParaGravar[]> {
    const validados = itens.map((i) => Validador.parse(itemPedidoSchema, i));
    const ids = [...new Set(validados.map((i) => i.produtoId))];
    const produtos = await this.pedidos.buscarProdutos(ids, exec);

    const consolidado = new Map<number, number>();
    for (const i of validados) consolidado.set(i.produtoId, (consolidado.get(i.produtoId) ?? 0) + i.quantidade);

    return [...consolidado.entries()].map(([produtoId, quantidade]) => {
      const produto = produtos.get(produtoId);
      if (!produto) throw new AppError(`Produto #${produtoId} não encontrado.`, 'NAO_ENCONTRADO');
      if (!produto.ativo) throw new AppError(`"${produto.nome}" está inativo e não pode ser vendido.`);
      return {
        produtoId,
        quantidade,
        precoUnitario: produto.precoVenda,
        subtotal: PedidoService.arredondar(produto.precoVenda * quantidade),
      };
    });
  }

  private async garantirStatusInicial(status: StatusPedido, entregadorId: number | null): Promise<void> {
    if (status === 'SAIU_PARA_ENTREGA' && entregadorId === null) {
      throw new AppError('Vincule um entregador antes de marcar "Saiu para Entrega".');
    }
  }

  private garantirEditavel(pedido: Pedido): void {
    if (pedido.estaCancelado()) throw new AppError('Este pedido está cancelado e não pode ser alterado.');
    if (STATUS_FINAIS.includes(pedido.status)) throw new AppError('Este pedido já foi entregue e não pode ser alterado.');
  }

  private static arredondar(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }
}
