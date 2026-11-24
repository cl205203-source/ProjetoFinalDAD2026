// [RF09][RF10] Regras da central de entregas (painel em tempo real, cálculo de taxa, vínculo e ciclo de vida).
import { AppError } from '../compartilhado/erros';
import { Database, Executor } from '../compartilhado/database';
import { Validador } from '../compartilhado/validacao';
import { Entregador } from '../entregadores/entregador.model';
import { EntregadorRepository } from '../entregadores/entregador.repository';
import { PedidoPublico, StatusPedido } from '../pedidos/pedido.model';
import { PedidoRepository } from '../pedidos/pedido.repository';
import { PedidoService } from '../pedidos/pedido.service';
import { SessaoService } from '../usuarios/sessao.service';
import { EntregadorComEntregasPublico, PainelEntregasPublico, TaxaEntregaPublica } from './entrega.model';
import { EntregaRepository } from './entrega.repository';
import { EsquemasEntrega } from './entrega.schemas';
import { TaxaEntregaService } from './taxa-entrega.service';

const STATUS_FINAIS: StatusPedido[] = ['ENTREGUE', 'CANCELADO'];

/** [RF10] Transições válidas do ciclo de vida da entrega. */
const TRANSICOES: Record<StatusPedido, StatusPedido[]> = {
  PENDENTE: ['EM_SEPARACAO', 'CANCELADO'],
  EM_SEPARACAO: ['SAIU_PARA_ENTREGA', 'CANCELADO'],
  SAIU_PARA_ENTREGA: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE: [],
  CANCELADO: [],
};

export class EntregaService {
  constructor(
    private readonly entregas: EntregaRepository,
    private readonly pedidos: PedidoRepository,
    private readonly entregadores: EntregadorRepository,
    private readonly pedidoService: PedidoService,
    private readonly taxaEntrega: TaxaEntregaService,
    private readonly sessao: SessaoService,
    private readonly db: Database,
  ) {}

  /** [RF09] Cálculo sob demanda da taxa de entrega e previsão (validado e processado no main). */
  async calcularTaxa(entrada: unknown): Promise<TaxaEntregaPublica> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const dados = Validador.parse(EsquemasEntrega.calcular, entrada);
    return this.taxaEntrega.calcular(dados.clienteId, dados.valorItens ?? 0);
  }

  /**
   * [RF10] Painel de entregas em tempo real:
   * Agrupa pedidos ativos sob responsabilidade de cada entregador, pedidos sem entregador e entregadores disponíveis.
   */
  async painel(): Promise<PainelEntregasPublico> {
    this.sessao.exigirLogado();

    const [ativas, disponiveis] = await Promise.all([
      this.entregas.listarAtivas(),
      this.entregas.listarDisponiveis(),
    ]);

    const semEntregador = ativas.filter((e) => e.entregadorId === null);
    const idsEntregadores = [
      ...new Set(
        ativas
          .map((e) => e.entregadorId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const carregados = await Promise.all(idsEntregadores.map((id) => this.entregadores.buscarPorId(id)));
    const porId = new Map<number, Entregador>();
    for (const carregado of carregados) if (carregado) porId.set(carregado.id, carregado);

    const grupos = new Map<number, EntregadorComEntregasPublico>();
    for (const entrega of ativas) {
      if (entrega.entregadorId === null) continue;
      let grupo = grupos.get(entrega.entregadorId);
      if (!grupo) {
        const entregador = porId.get(entrega.entregadorId);
        grupo = {
          id: entrega.entregadorId,
          nome: entregador?.nome ?? entrega.entregadorNome ?? `Entregador #${entrega.entregadorId}`,
          telefone: entregador?.telefone ?? '',
          veiculo: entregador?.veiculo ?? '—',
          placa: entregador?.placa ?? null,
          status: entregador?.status ?? entrega.entregadorStatus ?? 'INDISPONIVEL',
          entregas: [],
        };
        grupos.set(entrega.entregadorId, grupo);
      }
      grupo.entregas.push(entrega);
    }

    const entregadores = [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return {
      atualizadoEm: new Date().toISOString(),
      resumo: {
        ativas: ativas.length,
        emRota: ativas.filter((e) => e.status === 'SAIU_PARA_ENTREGA').length,
        entregadoresEmRota: entregadores.filter(
          (e) => e.status === 'EM_ROTA' || e.entregas.some((entrega) => entrega.status === 'SAIU_PARA_ENTREGA'),
        ).length,
        semEntregador: semEntregador.length,
      },
      entregadores,
      semEntregador,
      disponiveis,
    };
  }

  /**
   * [RF10] Vincula ou remaneja um entregador disponível a um pedido ativo.
   * Se o pedido estiver em rota, coloca o entregador como EM_ROTA.
   * Libera o entregador anterior caso ele não tenha mais entregas em rota.
   */
  async vincular(entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const { pedidoId, entregadorId } = Validador.parse(EsquemasEntrega.vincular, entrada);

    await this.db.transacao(async (conn) => {
      const pedido = await this.pedidos.buscarPorId(pedidoId, conn);
      if (!pedido) throw new AppError('Pedido não encontrado.', 'NAO_ENCONTRADO');
      if (STATUS_FINAIS.includes(pedido.status)) {
        throw new AppError('Este pedido já foi finalizado e não pode receber um entregador.');
      }

      const novo = await this.entregadores.buscarPorId(entregadorId, conn);
      if (!novo) throw new AppError('Entregador não encontrado.', 'NAO_ENCONTRADO');
      if (!novo.ativo) throw new AppError('Entregador inativo: reative-o antes de vincular entregas.');
      if (novo.status !== 'DISPONIVEL') {
        throw new AppError('Entregador não está disponível. Escolha outro entregador.');
      }

      const anteriorId = pedido.entregadorId;
      const vinculou = await this.entregas.atribuirEntregador(pedidoId, entregadorId, conn);
      if (!vinculou) {
        throw new AppError('Não foi possível vincular: o pedido não está mais ativo. Atualize o painel.');
      }

      // [RF10] Pedido já em rota: o novo responsável passa a EM_ROTA imediatamente.
      if (pedido.status === 'SAIU_PARA_ENTREGA') {
        await this.entregadores.definirStatus(entregadorId, 'EM_ROTA', conn);
      }

      if (anteriorId !== null && anteriorId !== entregadorId) {
        await this.liberarEntregadorSeLivre(anteriorId, pedidoId, conn);
      }
    });

    return this.pedidoService.obter(pedidoId);
  }

  /** [RF10] Ciclo de vida da entrega, delegando ao PedidoService para manter o estorno de estoque em cancelamentos. */
  async alterarStatus(entrada: unknown): Promise<PedidoPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const { pedidoId, statusPedido } = Validador.parse(EsquemasEntrega.alterarStatus, entrada);

    // Cancelar precisa do estorno de estoque (RF03), tratado pelo PedidoService.
    if (statusPedido === 'CANCELADO') {
      return this.pedidoService.cancelar(pedidoId, { observacao: null });
    }

    const pedido = await this.pedidos.buscarPorId(pedidoId);
    if (!pedido) throw new AppError('Pedido não encontrado.', 'NAO_ENCONTRADO');
    if (!TRANSICOES[pedido.status].includes(statusPedido)) {
      throw new AppError(
        `Não é possível mudar o pedido de "${pedido.status}" para "${statusPedido}". Atualize o painel.`,
      );
    }
    if (statusPedido === 'SAIU_PARA_ENTREGA' && pedido.entregadorId === null) {
      throw new AppError('Vincule um entregador antes de marcar "Saiu para entrega".');
    }
    if (statusPedido === 'ENTREGUE' && pedido.entregadorId === null) {
      throw new AppError('Não é possível entregar um pedido sem entregador vinculado.');
    }

    return this.pedidoService.alterarStatus(pedidoId, {
      statusPedido,
      entregadorId: pedido.entregadorId,
    });
  }

  /** [RF10] Devolve o entregador a DISPONIVEL se ele estava EM_ROTA e não possui mais entregas em rota. */
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
}
