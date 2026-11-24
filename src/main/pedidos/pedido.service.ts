// Regras de negócio de pedidos ([RF08], [RF09], [RF10], [RF11], RN01/RN02/RN04).
// Permissões e cálculo de frete são checados e validados aqui, no processo main.
import { AppError } from '../compartilhado/erros';
import { ErroMysql } from '../compartilhado/mysql-erros';
import { Database, Executor } from '../compartilhado/database';
import { idSchema, Validador } from '../compartilhado/validacao';
import { ConfirmacaoPedidoEmailService } from '../entregas/confirmacao-email.service';
import { TaxaEntregaService } from '../entregas/taxa-entrega.service';
import { EntregadorRepository } from '../entregadores/entregador.repository';
import { EstoqueService } from '../estoque/estoque.service';
import { SessaoService } from '../usuarios/sessao.service';
import { Pedido, PedidoPublico, ResultadoEmailConfirmacao, StatusPedido } from './pedido.model';
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
    // [RF09] Cálculo de distância, rota e taxa de entrega centralizado no main.
    private readonly taxaEntrega: TaxaEntregaService,
    // [RF11] Disparo automático de e-mail de confirmação após a transação (falha nunca derruba o pedido).
    private readonly emailConfirmacao: ConfirmacaoPedidoEmailService,
    // [RF10] Sincronização do status e disponibilidade do entregador (DISPONIVEL / EM_ROTA).
    private readonly entregadores: EntregadorRepository,
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
   * [RF08][RF09][RF10][RF11] Cria o pedido com itens, preços validados do banco, taxa e previsão calculadas pelo main,
   * vinculação do entregador (com transição para EM_ROTA se saiu para entrega)
   * e disparo de e-mail de confirmação ao cliente após o commit da transação.
   */
  async criar(entrada: unknown): Promise<PedidoPublico> {
    const usuario = this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const dados = Validador.parse(EsquemasPedido.criar, entrada);

    // [RF09] Itens preparados antes da transação para obter o valor real (regra de frete grátis).
    await this.garantirCliente(dados.clienteId);
    if (dados.entregadorId !== null) await this.garantirEntregadorDisponivel(dados.entregadorId);
    await this.garantirStatusInicial(dados.statusPedido, dados.entregadorId);

    const itens = await this.prepararItens(dados.itens);
    const valorItens = PedidoService.somarItens(itens);
    const calculo = await this.taxaEntrega.calcular(dados.clienteId, valorItens);

    // [RF09] O frete/distância do renderer só é usado como fallback quando o cálculo externo retorna null.
    const distanciaKm = calculo.distanciaKm ?? dados.distanciaKm;
    const valorFrete = calculo.taxaEntrega ?? dados.valorFrete;
    const previsaoEntrega = new Date(calculo.previsaoEntrega);

    const id = await this.db.transacao(async (conn) => {
      await this.garantirCliente(dados.clienteId, conn);
      if (dados.entregadorId !== null) await this.garantirEntregadorDisponivel(dados.entregadorId, conn);

      const cabecalho: DadosCabecalhoPedido = {
        clienteId: dados.clienteId,
        entregadorId: dados.entregadorId,
        usuarioId: usuario.id,
        distanciaKm,
        valorFrete,
        valorTotal: PedidoService.arredondar(valorItens + valorFrete),
        statusPedido: dados.statusPedido,
        previsaoEntrega,
      };

      const pedidoId = await this.pedidos.criar(cabecalho, itens, conn);
      await this.estoque.sincronizarPedido(conn, pedidoId, dados.itens);

      // [RF10] Pedido que já nasce em rota ocupa o entregador imediatamente (status EM_ROTA).
      if (dados.entregadorId !== null && dados.statusPedido === 'SAIU_PARA_ENTREGA') {
        await this.entregadores.definirStatus(dados.entregadorId, 'EM_ROTA', conn);
      }
      return pedidoId;
    });

    const publico = (await this.obterOuFalhar(id)).paraPublico();
    // [RF11] O e-mail é enviado após o commit da transação sem travar ou cancelar a criação do pedido.
    const emailConfirmacao = await this.enviarEmailComSeguranca(publico);
    return { ...publico, emailConfirmacao };
  }

  /** [RF08][RF09][RF10] Edita cabeçalho e itens; recalcula distância, taxa e previsão no backend. */
  async atualizar(idEntrada: unknown, entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    const dados = Validador.parse(EsquemasPedido.atualizar, entrada);

    await this.garantirCliente(dados.clienteId);
    const atualFora = await this.obterOuFalhar(id);
    if (dados.entregadorId !== null && dados.entregadorId !== atualFora.entregadorId) {
      await this.garantirEntregadorDisponivel(dados.entregadorId);
    }

    const itens = await this.prepararItens(dados.itens);
    const valorItens = PedidoService.somarItens(itens);
    const calculo = await this.taxaEntrega.calcular(dados.clienteId, valorItens);
    const distanciaKm = calculo.distanciaKm ?? dados.distanciaKm;
    const valorFrete = calculo.taxaEntrega ?? dados.valorFrete;
    const previsaoEntrega = new Date(calculo.previsaoEntrega);

    await this.db.transacao(async (conn) => {
      const atual = await this.obterOuFalhar(id, conn);
      this.garantirEditavel(atual);

      await this.garantirCliente(dados.clienteId, conn);
      if (dados.entregadorId !== null && dados.entregadorId !== atual.entregadorId) {
        await this.garantirEntregadorDisponivel(dados.entregadorId, conn);
      }
      await this.garantirStatusInicial(dados.statusPedido, dados.entregadorId);

      const cabecalho: DadosCabecalhoPedido = {
        clienteId: dados.clienteId,
        entregadorId: dados.entregadorId,
        usuarioId: atual.usuarioId, // quem criou o pedido nunca muda
        distanciaKm,
        valorFrete,
        valorTotal: PedidoService.arredondar(valorItens + valorFrete),
        statusPedido: dados.statusPedido,
        previsaoEntrega,
      };

      await this.pedidos.atualizar(id, cabecalho, itens, conn);
      await this.estoque.sincronizarPedido(conn, id, dados.itens);

      // [RF10] Ao trocar o entregador, libera o anterior caso não tenha outras entregas ativas.
      const anteriorId = atual.entregadorId;
      if (anteriorId !== null && anteriorId !== dados.entregadorId) {
        await this.liberarEntregadorSeLivre(anteriorId, id, conn);
      }
      if (dados.entregadorId !== null && dados.statusPedido === 'SAIU_PARA_ENTREGA') {
        await this.entregadores.definirStatus(dados.entregadorId, 'EM_ROTA', conn);
      }
    });

    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** [RF08][RF10] Muda o status do pedido no ciclo de vida (RN02: "Saiu para Entrega" exige entregador). */
  async alterarStatus(idEntrada: unknown, entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    const { statusPedido, entregadorId } = Validador.parse(EsquemasPedido.alterarStatus, entrada);

    if (statusPedido === 'CANCELADO') {
      // Cancelamento precisa do estorno de estoque (RF03), garantido por cancelar().
      return this.cancelar(id, { observacao: null });
    }

    await this.db.transacao(async (conn) => {
      const atual = await this.obterOuFalhar(id, conn);
      this.garantirEditavel(atual);

      const entregadorFinal = entregadorId ?? atual.entregadorId;
      if (statusPedido === 'SAIU_PARA_ENTREGA' && entregadorFinal === null) {
        throw new AppError('Vincule um entregador antes de marcar "Saiu para Entrega".', 'REGRA_NEGOCIO');
      }
      if (entregadorFinal !== null && entregadorFinal !== atual.entregadorId) {
        await this.garantirEntregadorDisponivel(entregadorFinal, conn);
      }
      if (statusPedido === 'ENTREGUE' && entregadorFinal === null) {
        throw new AppError('Não é possível entregar um pedido sem entregador vinculado.', 'REGRA_NEGOCIO');
      }

      await this.pedidos.definirStatus(id, statusPedido, entregadorFinal, conn);

      // [RF10] Gerenciamento do status do entregador: ao sair para entrega fica EM_ROTA; ao entregar, libera se não houver outras.
      if (entregadorFinal !== null && statusPedido === 'SAIU_PARA_ENTREGA') {
        await this.entregadores.definirStatus(entregadorFinal, 'EM_ROTA', conn);
      }
      if (atual.entregadorId !== null && atual.entregadorId !== entregadorFinal) {
        await this.liberarEntregadorSeLivre(atual.entregadorId, id, conn);
      }
      if (entregadorFinal !== null && statusPedido === 'ENTREGUE') {
        await this.liberarEntregadorSeLivre(entregadorFinal, id, conn);
      }
    });

    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** [RF08][RF03][RF10] Cancela o pedido, devolve ao estoque e libera o entregador para DISPONIVEL. */
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

      // [RF10] Se não houver outra entrega em rota, o entregador volta a ficar DISPONIVEL.
      if (atual.entregadorId !== null) {
        await this.liberarEntregadorSeLivre(atual.entregadorId, id, conn);
      }
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

  private async garantirEntregadorDisponivel(entregadorId: number, exec: Executor = this.db.pool): Promise<void> {
    if (!(await this.pedidos.entregadorDisponivel(entregadorId, exec))) {
      throw new AppError('Entregador indisponível. Escolha um entregador ativo e disponível.');
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

  /**
   * [RF10] Só devolve o entregador para DISPONIVEL quando ele está EM_ROTA e não há outra
   * entrega em rota (ignorando o pedido que acabou de sair da operação/ser entregue/cancelado).
   */
  private async liberarEntregadorSeLivre(
    entregadorId: number,
    ignorarPedidoId: number,
    exec: Executor,
  ): Promise<void> {
    const entregador = await this.entregadores.buscarPorId(entregadorId, exec);
    if (!entregador || !entregador.estaEmRota()) return;
    const emRota = await this.pedidos.contarEntregasEmRotaDoEntregador(entregadorId, ignorarPedidoId, exec);
    if (emRota === 0) await this.entregadores.definirStatus(entregadorId, 'DISPONIVEL', exec);
  }

  /** [RF11] O envio do e-mail de confirmação é pós-commit e nunca cancela a criação do pedido se o SMTP falhar. */
  private async enviarEmailComSeguranca(pedido: PedidoPublico): Promise<ResultadoEmailConfirmacao> {
    try {
      return await this.emailConfirmacao.enviar(pedido);
    } catch (erro) {
      console.error('[PedidoService] [RF11] falha no e-mail de confirmação:', (erro as Error).message);
      return { enviado: false, mensagem: 'Não foi possível enviar o e-mail de confirmação.' };
    }
  }

  private static somarItens(itens: ItemParaGravar[]): number {
    return PedidoService.arredondar(itens.reduce((soma, item) => soma + item.subtotal, 0));
  }

  private static arredondar(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }
}
