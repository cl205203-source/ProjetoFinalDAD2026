// [RF10] Central de entregas com exibição em tempo real (polling de 5s sem sobreposição).
// [RF10] Gestão do ciclo de vida da entrega, vínculo e troca de entregador responsável.
// [RF09] Distância, frete e previsão calculados e validados no main.

class EntregasTela implements Tela {
  // [RF10] Intervalo de atualização em tempo real de 5 segundos
  private static readonly INTERVALO_MS = 5000;

  private static readonly PEDIDO: Record<StatusPedidoDTO, { rotulo: string; classe: string }> = {
    PENDENTE: { rotulo: 'Pendente', classe: 'bg-warning text-dark' },
    EM_SEPARACAO: { rotulo: 'Em Separação', classe: 'bg-info text-dark' },
    SAIU_PARA_ENTREGA: { rotulo: 'Saiu para Entrega', classe: 'bg-primary' },
    ENTREGUE: { rotulo: 'Entregue', classe: 'bg-success' },
    CANCELADO: { rotulo: 'Cancelado', classe: 'bg-secondary' },
  };

  private static readonly ENTREGADOR: Record<StatusEntregadorDTO, { rotulo: string; classe: string }> = {
    DISPONIVEL: { rotulo: 'Disponível', classe: 'bg-success' },
    EM_ROTA: { rotulo: 'Em Rota', classe: 'bg-primary' },
    INDISPONIVEL: { rotulo: 'Indisponível', classe: 'bg-secondary' },
  };

  private usuarioAtual: UsuarioDTO | null = null;
  private intervalo: number | null = null;
  private carregando = false;
  private ativo = false;

  constructor() {
    EntregasTela.el('btn-atualizar-entregas')?.addEventListener('click', () => void this.carregar());
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    this.ativo = true;
    await this.carregar();
    this.iniciarPolling();
  }

  limpar(): void {
    this.parar();
    this.usuarioAtual = null;
    const painel = EntregasTela.el('painel-entregas');
    if (painel) painel.replaceChildren();
    EntregasTela.texto('entrega-resumo-ativas', '—');
    EntregasTela.texto('entrega-resumo-em-rota', '—');
    EntregasTela.texto('entrega-resumo-entregadores', '—');
    EntregasTela.texto('entrega-atualizado-em', '');
    this.mostrarErro(null);
    EntregasTela.mostrar('entregas-vazio', false);
  }

  /** [RF10] Interrompe o polling de atualização ao trocar de aba ou deslogar. */
  parar(): void {
    this.ativo = false;
    if (this.intervalo !== null) {
      window.clearInterval(this.intervalo);
      this.intervalo = null;
    }
  }

  /** [RF10] Inicia polling periódico a cada 5 segundos. */
  private iniciarPolling(): void {
    if (this.intervalo !== null) return;
    this.intervalo = window.setInterval(() => {
      if (this.ativo) void this.carregar();
    }, EntregasTela.INTERVALO_MS);
  }

  private async carregar(): Promise<void> {
    // [RF10] Sem sobreposição de requisições: se uma chamada estiver em andamento, descarta a nova tentativa até terminar.
    if (this.carregando || !this.usuarioAtual) return;
    this.carregando = true;
    try {
      const r = await bridge.painelEntregas();
      if (!r.ok) {
        this.mostrarErro(r.erro);
        return;
      }
      this.mostrarErro(null);
      this.render(r.dados);
    } catch {
      this.mostrarErro('Não foi possível atualizar a central de entregas.');
    } finally {
      this.carregando = false;
    }
  }

  // ---------- Renderização ----------

  private render(p: PainelEntregasDTO): void {
    EntregasTela.texto('entrega-resumo-ativas', String(p.resumo.ativas));
    EntregasTela.texto('entrega-resumo-em-rota', String(p.resumo.emRota));
    EntregasTela.texto('entrega-resumo-entregadores', String(p.resumo.entregadoresEmRota));
    EntregasTela.texto('entrega-atualizado-em', `Atualizado em ${Formato.dataHora(p.atualizadoEm)}`);

    const vazio = p.entregadores.length === 0 && p.semEntregador.length === 0;
    EntregasTela.mostrar('entregas-vazio', vazio);

    const painel = EntregasTela.el('painel-entregas');
    if (!painel) return;

    // Preserva a seleção do usuário se o polling rodar enquanto ele escolhia um entregador
    const selecionados = this.coletarSelecoes();
    painel.replaceChildren();
    // [RF10] Exibe em tempo real qual pedido está sob responsabilidade de qual entregador
    for (const grupo of p.entregadores) painel.appendChild(this.cardEntregador(grupo, p.disponiveis));
    // [RF10] Pedidos ativos ainda sem entregador vinculado
    if (p.semEntregador.length > 0) painel.appendChild(this.cardSemEntregador(p));
    this.restaurarSelecoes(selecionados);
  }

  private cardEntregador(grupo: EntregadorComEntregasDTO, disponiveis: EntregadorDisponivelDTO[] = []): HTMLElement {
    const col = Dom.criar('div', 'col-12 col-xl-6');
    const card = Dom.criar('div', 'card h-100');

    const header = Dom.criar('div', 'card-header d-flex justify-content-between align-items-start gap-2');
    const info = Dom.criar('div');
    info.appendChild(Dom.criar('div', 'fw-semibold', grupo.nome));
    const veiculo = grupo.placa ? `${grupo.veiculo} • ${grupo.placa}` : grupo.veiculo;
    const detalhes = [veiculo, grupo.telefone ? Mascara.telefone(grupo.telefone) : '']
      .filter((parte) => Boolean(parte))
      .join(' • ');
    if (detalhes) info.appendChild(Dom.criar('div', 'small text-muted', detalhes));
    header.appendChild(info);

    const status = EntregasTela.ENTREGADOR[grupo.status] ?? { rotulo: grupo.status, classe: 'bg-secondary' };
    header.appendChild(Dom.criar('span', `badge ${status.classe}`, status.rotulo));
    card.appendChild(header);

    const corpo = Dom.criar('div', 'card-body d-flex flex-column gap-2');
    if (grupo.entregas.length === 0) {
      corpo.appendChild(Dom.criar('div', 'small text-muted', 'Nenhuma entrega ativa no momento.'));
    }
    // [RF10] Pedidos vinculados a este entregador
    for (const entrega of grupo.entregas) corpo.appendChild(this.itemEntrega(entrega, true, disponiveis));
    card.appendChild(corpo);

    col.appendChild(card);
    return col;
  }

  private cardSemEntregador(p: PainelEntregasDTO): HTMLElement {
    const col = Dom.criar('div', 'col-12');
    const card = Dom.criar('div', 'card border-warning');
    card.appendChild(
      Dom.criar('div', 'card-header fw-semibold', `Sem entregador (${p.semEntregador.length})`),
    );

    const corpo = Dom.criar('div', 'card-body d-flex flex-column gap-3');
    for (const entrega of p.semEntregador) {
      corpo.appendChild(this.itemEntrega(entrega, false, p.disponiveis));
    }
    card.appendChild(corpo);
    col.appendChild(card);
    return col;
  }

  /**
   * [RF10] Card de um pedido com dados do cliente, rota e ações do ciclo de vida.
   * Quando sem entregador, exibe o seletor de vínculo inicial.
   * Quando já com entregador, se ainda estiver pendente ou em separação, permite trocar/remanejar o responsável.
   */
  private itemEntrega(
    entrega: EntregaDTO,
    comEntregador: boolean,
    disponiveis: EntregadorDisponivelDTO[] = [],
  ): HTMLElement {
    const bloco = Dom.criar('div', 'border rounded p-2 d-flex flex-column gap-1');

    const topo = Dom.criar('div', 'd-flex justify-content-between align-items-start gap-2');
    const titulo = Dom.criar('div');
    titulo.appendChild(Dom.criar('div', 'fw-semibold', `Pedido #${entrega.pedidoId} — ${entrega.clienteNome}`));
    titulo.appendChild(Dom.criar('div', 'small text-muted', `Recebido em ${Formato.dataHora(entrega.dataPedido)}`));
    topo.appendChild(titulo);
    const status = EntregasTela.PEDIDO[entrega.status] ?? { rotulo: entrega.status, classe: 'bg-secondary' };
    topo.appendChild(Dom.criar('span', `badge ${status.classe}`, status.rotulo));
    bloco.appendChild(topo);

    bloco.appendChild(Dom.criar('div', 'small', entrega.endereco));
    bloco.appendChild(
      Dom.criar(
        'div',
        'small text-muted',
        `${entrega.distanciaKm === null ? 'Distância indisponível' : `Distância: ${entrega.distanciaKm} km`} • ` +
          `Frete: ${entrega.valorFrete > 0 ? Formato.moeda(entrega.valorFrete) : 'Grátis'} • ` +
          `Total: ${Formato.moeda(entrega.valorTotal)}`,
      ),
    );
    bloco.appendChild(
      Dom.criar(
        'div',
        'small text-muted',
        `Previsão de entrega: ${entrega.previsaoEntrega ? Formato.dataHora(entrega.previsaoEntrega) : 'a confirmar'}`,
      ),
    );
    bloco.appendChild(Dom.criar('div', 'small', `Itens: ${entrega.itensResumo || '—'}`));
    if (entrega.clienteTelefone) {
      bloco.appendChild(Dom.criar('div', 'small text-muted', `Contato: ${Mascara.telefone(entrega.clienteTelefone)}`));
    }

    const acoes = Dom.criar('div', 'd-flex flex-wrap gap-2 align-items-center mt-1');

    // [RF10] Ciclo de vida da entrega (pendente -> em separação -> saiu para entrega -> entregue / cancelado)
    if (entrega.status === 'PENDENTE') {
      acoes.appendChild(Dom.botao('Iniciar separação', 'btn btn-sm btn-outline-info', () =>
        void this.mudarStatus(entrega, 'EM_SEPARACAO'),
      ));
    }
    if (entrega.status === 'EM_SEPARACAO' && (comEntregador || entrega.entregadorId !== null)) {
      acoes.appendChild(Dom.botao('Saiu para entrega', 'btn btn-sm btn-outline-primary', () =>
        void this.mudarStatus(entrega, 'SAIU_PARA_ENTREGA'),
      ));
    }
    if (entrega.status === 'SAIU_PARA_ENTREGA') {
      acoes.appendChild(Dom.botao('Entregue', 'btn btn-sm btn-outline-success', () =>
        void this.mudarStatus(entrega, 'ENTREGUE'),
      ));
    }
    if (entrega.status !== 'CANCELADO' && entrega.status !== 'ENTREGUE') {
      acoes.appendChild(Dom.botao('Cancelar', 'btn btn-sm btn-outline-warning', () => void this.cancelar(entrega)));
    }

    // [RF10] Vinculação de entregador
    if (!comEntregador) {
      // Pedido sem responsável: permite vincular um entregador disponível
      acoes.appendChild(this.controlesVinculo(entrega, disponiveis));
    } else if (entrega.status === 'PENDENTE' || entrega.status === 'EM_SEPARACAO') {
      // Pedido com entregador: permite trocar/remanejar responsável enquanto estiver pendente ou em separação
      acoes.appendChild(this.controlesTrocarResponsavel(entrega, disponiveis));
    }

    bloco.appendChild(acoes);
    return bloco;
  }

  /** [RF10] Controles para vincular entregador inicial em pedidos sem entregador */
  private controlesVinculo(entrega: EntregaDTO, disponiveis: EntregadorDisponivelDTO[]): HTMLElement {
    const wrapper = Dom.criar('div', 'd-flex gap-2 align-items-center ms-auto');

    const sel = Dom.criar('select', 'form-select form-select-sm w-auto');
    sel.dataset.vincular = '1';
    sel.dataset.pedido = String(entrega.pedidoId);

    if (disponiveis.length === 0) {
      const vazio = Dom.criar('option', '', 'Nenhum entregador disponível');
      vazio.value = '';
      sel.appendChild(vazio);
      sel.disabled = true;
    } else {
      const padrao = Dom.criar('option', '', 'Selecione o entregador');
      padrao.value = '';
      sel.appendChild(padrao);
      for (const d of disponiveis) {
        const op = Dom.criar('option', '', `${d.nome} — ${d.veiculo}`);
        op.value = String(d.id);
        sel.appendChild(op);
      }
    }

    const botao = Dom.botao('Vincular', 'btn btn-sm btn-success', () => void this.vincular(entrega, sel, false));
    botao.disabled = !sel.value;
    sel.addEventListener('change', () => {
      botao.disabled = !sel.value;
    });

    wrapper.appendChild(sel);
    wrapper.appendChild(botao);
    return wrapper;
  }

  /** [RF10] Controles para trocar/remanejar entregador em pedidos pendentes ou em separação */
  private controlesTrocarResponsavel(entrega: EntregaDTO, disponiveis: EntregadorDisponivelDTO[]): HTMLElement {
    const wrapper = Dom.criar('div', 'd-flex gap-2 align-items-center ms-auto flex-wrap');

    const sel = Dom.criar('select', 'form-select form-select-sm w-auto');
    sel.dataset.vincular = '1';
    sel.dataset.pedido = String(entrega.pedidoId);

    // Filtra para exibir apenas outros entregadores disponíveis (exclui o atual)
    const outrosDisponiveis = disponiveis.filter((d) => d.id !== entrega.entregadorId);

    if (outrosDisponiveis.length === 0) {
      const vazio = Dom.criar('option', '', 'Sem outro entregador disponível');
      vazio.value = '';
      sel.appendChild(vazio);
      sel.disabled = true;
    } else {
      const padrao = Dom.criar('option', '', 'Trocar responsável...');
      padrao.value = '';
      sel.appendChild(padrao);
      for (const d of outrosDisponiveis) {
        const op = Dom.criar('option', '', `${d.nome} — ${d.veiculo}`);
        op.value = String(d.id);
        sel.appendChild(op);
      }
    }

    const botao = Dom.botao('Trocar', 'btn btn-sm btn-outline-secondary', () => void this.vincular(entrega, sel, true));
    botao.disabled = !sel.value;
    sel.addEventListener('change', () => {
      botao.disabled = !sel.value;
    });

    wrapper.appendChild(sel);
    wrapper.appendChild(botao);
    return wrapper;
  }

  // ---------- Ações ----------

  /** [RF10] Vincula ou troca o entregador responsável pelo pedido */
  private async vincular(entrega: EntregaDTO, sel: HTMLSelectElement, ehTroca = false): Promise<void> {
    const entregadorId = Number(sel.value);
    if (!Number.isFinite(entregadorId) || entregadorId <= 0) {
      Aviso.mostrar('Selecione um entregador disponível.', 'danger');
      return;
    }
    const r = await bridge.vincularEntregador({ pedidoId: entrega.pedidoId, entregadorId });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      await this.carregar();
      return;
    }
    const mensagem = ehTroca
      ? `Responsável pelo pedido #${entrega.pedidoId} alterado com sucesso.`
      : `Entregador vinculado ao pedido #${entrega.pedidoId}.`;
    Aviso.mostrar(mensagem, 'success');
    await this.carregar();
  }

  /** [RF10] Altera status do pedido avançando no ciclo de vida */
  private async mudarStatus(entrega: EntregaDTO, status: StatusPedidoDTO): Promise<void> {
    const r = await bridge.alterarStatusEntrega({ pedidoId: entrega.pedidoId, statusPedido: status });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      await this.carregar();
      return;
    }
    // [RF11] Informa o resultado do e-mail disparado pela mudança de status
    const email = r.dados.emailConfirmacao;
    const base = `Pedido #${entrega.pedidoId}: ${EntregasTela.PEDIDO[status].rotulo}.`;
    Aviso.mostrar(
      email ? `${base} E-mail: ${email.mensagem}` : base,
      email && !email.enviado ? 'danger' : 'success',
    );
    await this.carregar();
  }

  /** [RF10] Cancelamento do pedido com confirmação e estorno de estoque */
  private async cancelar(entrega: EntregaDTO): Promise<void> {
    if (!confirm(`Cancelar o pedido #${entrega.pedidoId}? O estoque será estornado.`)) return;
    await this.mudarStatus(entrega, 'CANCELADO');
  }

  // ---------- Utilidades ----------

  /** [RF10] Coleta seleções ativas nos dropdowns para preservar o estado durante o polling */
  private coletarSelecoes(): Map<number, string> {
    const mapa = new Map<number, string>();
    document.querySelectorAll<HTMLSelectElement>('select[data-vincular]').forEach((sel) => {
      const pedidoId = Number(sel.dataset.pedido);
      if (Number.isFinite(pedidoId) && sel.value) mapa.set(pedidoId, sel.value);
    });
    return mapa;
  }

  /** [RF10] Restaura seleções dos dropdowns após o HTML ser reconstruído pelo polling */
  private restaurarSelecoes(selecionados: Map<number, string>): void {
    if (selecionados.size === 0) return;
    document.querySelectorAll<HTMLSelectElement>('select[data-vincular]').forEach((sel) => {
      const pedidoId = Number(sel.dataset.pedido);
      const valor = selecionados.get(pedidoId);
      if (valor) {
        sel.value = valor;
        // Reabilita o botão "Vincular"/"Trocar" que nasceu desabilitado com o select vazio
        sel.dispatchEvent(new Event('change'));
      }
    });
  }

  private mostrarErro(mensagem: string | null): void {
    const erro = EntregasTela.el('entrega-erro');
    if (!erro) return;
    if (mensagem) {
      erro.textContent = mensagem;
      erro.classList.remove('d-none');
    } else {
      erro.textContent = '';
      erro.classList.add('d-none');
    }
  }

  private static el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  private static texto(id: string, valor: string): void {
    const el = EntregasTela.el(id);
    if (el) el.textContent = valor;
  }

  private static mostrar(id: string, visivel: boolean): void {
    EntregasTela.el(id)?.classList.toggle('d-none', !visivel);
  }
}
