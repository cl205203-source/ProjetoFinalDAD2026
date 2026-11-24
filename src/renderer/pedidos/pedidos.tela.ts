// [RF08][RF09][RF10][RF11] Tela de pedidos: criação, edição, cálculo sob demanda de entrega e disparo de e-mail.

class PedidosTela implements Tela {
  private static readonly STATUS: { valor: StatusPedidoDTO; rotulo: string }[] = [
    { valor: 'PENDENTE', rotulo: 'Pendente' },
    { valor: 'EM_SEPARACAO', rotulo: 'Em Separação' },
    { valor: 'SAIU_PARA_ENTREGA', rotulo: 'Saiu para Entrega' },
    { valor: 'ENTREGUE', rotulo: 'Entregue' },
    { valor: 'CANCELADO', rotulo: 'Cancelado' },
  ];

  private usuarioAtual: UsuarioDTO | null = null;
  private idEmEdicao: number | null = null;
  private clientes: ClienteDTO[] = [];
  private entregadores: EntregadorDTO[] = [];
  private produtos: ProdutoDTO[] = [];
  private linhas: number = 0;
  private entregaCalculando = false;

  constructor() {
    for (const id of ['ped-status', 'filtro-ped-status']) {
      const sel = Dom.pegar<HTMLSelectElement>(id);
      for (const s of PedidosTela.STATUS) {
        const o = Dom.criar('option', '', s.rotulo);
        o.value = s.valor;
        sel.appendChild(o);
      }
    }
    Dom.pegar<HTMLSelectElement>('ped-status').value = 'PENDENTE';

    Dom.pegar<HTMLFormElement>('form-filtro-pedidos').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.carregar();
    });
    Dom.pegar('btn-limpar-filtro-pedidos').addEventListener('click', () => {
      Dom.pegar<HTMLInputElement>('filtro-ped-busca').value = '';
      Dom.pegar<HTMLSelectElement>('filtro-ped-status').value = '';
      void this.carregar();
    });
    Dom.pegar('btn-novo-pedido').addEventListener('click', () => this.abrirForm());
    Dom.pegar('btn-cancelar-pedido-form').addEventListener('click', () => this.fecharForm());
    Dom.pegar<HTMLFormElement>('form-pedido').addEventListener('submit', (e) => void this.aoSalvar(e));
    Dom.pegar('btn-add-item-pedido').addEventListener('click', () => this.adicionarLinhaItem());

    // [RF09] Recalcula a taxa e previsão sob demanda ao trocar o cliente ou clicar no botão dedicado
    Dom.pegar<HTMLSelectElement>('ped-cliente').addEventListener('change', () => void this.calcularEntrega());
    PedidosTela.el('btn-calcular-entrega')?.addEventListener('click', () => void this.calcularEntrega());
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    // Admin e Atendente podem criar/editar pedidos (RF08).
    const podeGerenciar = usuario.perfil === 'ADMIN' || usuario.perfil === 'ATENDENTE';
    Dom.pegar('btn-novo-pedido').classList.toggle('d-none', !podeGerenciar);
    await Promise.all([this.carregarAuxiliares(), this.carregar()]);
  }

  limpar(): void {
    this.usuarioAtual = null;
    this.fecharForm();
    this.limparEntrega();
    Dom.pegar('tabela-pedidos').replaceChildren();
  }

  fecharForm(): void {
    this.idEmEdicao = null;
    Dom.pegar('painel-pedido').classList.add('d-none');
  }

  // ---------- Carregamento ----------
  private async carregarAuxiliares(): Promise<void> {
    const [clientes, entregadores, produtos] = await Promise.all([
      bridge.listarClientes({ status: 'ATIVOS' }),
      bridge.listarEntregadores({ status: 'ATIVOS', disponibilidade: 'DISPONIVEL' }),
      bridge.listarProdutos({ status: 'ATIVOS', somenteEstoqueBaixo: false }),
    ]);
    if (clientes.ok) this.clientes = clientes.dados;
    if (entregadores.ok) this.entregadores = entregadores.dados;
    if (produtos.ok) this.produtos = produtos.dados;

    this.preencherSelect('ped-cliente', this.clientes.map((c) => ({ valor: c.id, rotulo: `${c.nome} (${Mascara.cpf(c.cpf)})` })));
    this.preencherSelect(
      'ped-entregador',
      this.entregadores.map((e) => ({ valor: e.id, rotulo: `${e.nome} — ${e.veiculo}` })),
      'Nenhum (retirada/balanceamento depois)',
    );
  }

  private preencherSelect(id: string, opcoes: { valor: number; rotulo: string }[], rotuloVazio?: string): void {
    const sel = Dom.pegar<HTMLSelectElement>(id);
    const atual = sel.value;
    sel.replaceChildren();
    if (rotuloVazio) {
      const o = Dom.criar('option', '', rotuloVazio);
      o.value = '';
      sel.appendChild(o);
    }
    for (const op of opcoes) {
      const o = Dom.criar('option', '', op.rotulo);
      o.value = String(op.valor);
      sel.appendChild(o);
    }
    if (atual) sel.value = atual;
  }

  private async carregar(): Promise<void> {
    const busca = Dom.pegar<HTMLInputElement>('filtro-ped-busca').value.trim();
    const status = Dom.pegar<HTMLSelectElement>('filtro-ped-status').value as StatusPedidoDTO | '';
    const r = await bridge.listarPedidos({ busca: busca || undefined, status: status || undefined });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }

    const corpo = Dom.pegar('tabela-pedidos');
    corpo.replaceChildren();
    if (r.dados.length === 0) {
      const td = Dom.criar('td', 'text-center text-muted py-4', 'Nenhum pedido encontrado.');
      td.colSpan = 8;
      const tr = Dom.criar('tr');
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }

    for (const p of r.dados) {
      const tr = Dom.criar('tr', p.statusPedido === 'CANCELADO' ? 'table-secondary' : '');
      const celula = (texto = '', classe = ''): HTMLTableCellElement => {
        const td = Dom.criar('td', classe, texto);
        tr.appendChild(td);
        return td;
      };

      celula(`#${p.id}`, 'fw-semibold');
      celula(`${p.clienteNome}\n${Formato.dataHora(p.dataPedido)}`);
      celula(p.entregadorNome ?? '—');
      celula(Formato.moeda(p.valorTotal), 'text-end fw-semibold');

      // RF09: distância e previsão calculadas no main.
      const tdDistancia = celula(p.distanciaKm === null ? '—' : `${p.distanciaKm} km`, 'text-end');
      if (p.previsaoEntrega) {
        tdDistancia.appendChild(
          Dom.criar('div', 'small text-muted', `Prev.: ${Formato.dataHora(p.previsaoEntrega)}`),
        );
      }

      const tdStatus = celula();
      const badge = Dom.criar(
        'span',
        `badge ${PedidosTela.classeStatus(p.statusPedido)}`,
        PedidosTela.rotuloStatus(p.statusPedido),
      );
      tdStatus.appendChild(badge);

      const tdItens = celula();
      for (const i of p.itens) {
        tdItens.appendChild(
          Dom.criar('div', 'small', `${i.quantidade}x ${i.produtoNome} — ${Formato.moeda(i.subtotal)}`),
        );
      }

      const acoes = Dom.criar('div', 'd-flex gap-1 justify-content-end flex-wrap');
      if (p.statusPedido !== 'CANCELADO' && p.statusPedido !== 'ENTREGUE') {
        acoes.appendChild(Dom.botao('Editar', 'btn btn-sm btn-outline-primary', () => this.abrirForm(p)));
        const sel = Dom.criar('select', 'form-select form-select-sm w-auto');
        for (const s of PedidosTela.STATUS) {
          if (s.valor === 'CANCELADO' || s.valor === 'ENTREGUE') continue;
          const o = Dom.criar('option', '', s.rotulo);
          o.value = s.valor;
          sel.appendChild(o);
        }
        sel.value = p.statusPedido;
        sel.addEventListener('change', () => {
          void this.alterarStatus(p, sel.value as StatusPedidoDTO);
        });
        acoes.appendChild(sel);
        acoes.appendChild(Dom.botao('Cancelar', 'btn btn-sm btn-outline-warning', () => void this.cancelar(p)));
        acoes.appendChild(Dom.botao('Entregue', 'btn btn-sm btn-outline-success', () => void this.alterarStatus(p, 'ENTREGUE')));
      }
      if (p.statusPedido === 'CANCELADO' && this.usuarioAtual?.perfil === 'ADMIN') {
        acoes.appendChild(Dom.botao('Excluir', 'btn btn-sm btn-outline-danger', () => void this.excluir(p)));
      }
      celula('', 'text-end').appendChild(acoes);
      corpo.appendChild(tr);
    }
  }

  // ---------- Ações ----------
  private async alterarStatus(p: PedidoDTO, status: StatusPedidoDTO): Promise<void> {
    const r = await bridge.alterarStatusPedido(p.id, { statusPedido: status, entregadorId: p.entregadorId });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      await this.carregar();
      return;
    }
    Aviso.mostrar('Status do pedido atualizado.', 'success');
    await this.carregar();
  }

  private async cancelar(p: PedidoDTO): Promise<void> {
    if (!confirm(`Cancelar o pedido #${p.id}? O estoque será estornado.`)) return;
    const r = await bridge.cancelarPedido(p.id, { observacao: null });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    Aviso.mostrar('Pedido cancelado e estoque estornado.', 'success');
    await this.carregar();
  }

  private async excluir(p: PedidoDTO): Promise<void> {
    if (!confirm(`Excluir definitivamente o pedido #${p.id}?`)) return;
    const r = await bridge.excluirPedido(p.id);
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    Aviso.mostrar('Pedido excluído.', 'success');
    await this.carregar();
  }

  // ---------- Formulário ----------
  private adicionarLinhaItem(produtoId?: number, quantidade?: number): void {
    const container = Dom.pegar('lista-itens-pedido');
    const linha = Dom.criar('div', 'row g-2 mb-2 align-items-end item-pedido-linha');
    linha.dataset.indice = String(this.linhas++);

    const colProduto = Dom.criar('div', 'col-md-8');
    const sel = Dom.criar('select', 'form-select item-produto');
    for (const p of this.produtos) {
      const o = Dom.criar('option', '', `${p.nome} — ${Formato.moeda(p.precoVenda)} (estoque: ${p.estoqueAtual})`);
      o.value = String(p.id);
      sel.appendChild(o);
    }
    if (produtoId !== undefined) sel.value = String(produtoId);
    // [RF09] Recalcula a taxa de entrega quando o produto muda (alteração do valor total dos itens)
    sel.addEventListener('change', () => void this.calcularEntrega());
    colProduto.appendChild(sel);

    const colQtd = Dom.criar('div', 'col-md-2');
    const qtd = Dom.criar('input', 'form-control item-quantidade');
    qtd.type = 'text';
    qtd.inputMode = 'numeric';
    qtd.value = String(quantidade ?? 1);
    // [RF09] Recalcula a taxa de entrega quando a quantidade é alterada
    qtd.addEventListener('input', () => void this.calcularEntrega());
    colQtd.appendChild(qtd);

    const colBtn = Dom.criar('div', 'col-md-2');
    colBtn.appendChild(
      Dom.botao('Remover', 'btn btn-sm btn-outline-danger', () => {
        linha.remove();
        // [RF09] Recalcula a taxa de entrega ao remover um item do carrinho
        void this.calcularEntrega();
      }),
    );

    linha.append(colProduto, colQtd, colBtn);
    container.appendChild(linha);
  }

  private abrirForm(p?: PedidoDTO): void {
    Aviso.limpar();
    this.idEmEdicao = p?.id ?? null;
    Dom.pegar('pedido-titulo').textContent = p ? `Editar pedido #${p.id}` : 'Novo pedido';

    Dom.pegar<HTMLSelectElement>('ped-cliente').value = p ? String(p.clienteId) : (this.clientes[0] ? String(this.clientes[0].id) : '');
    Dom.pegar<HTMLSelectElement>('ped-entregador').value = p?.entregadorId !== null && p?.entregadorId !== undefined ? String(p.entregadorId) : '';
    Dom.pegar<HTMLInputElement>('ped-distancia').value = p?.distanciaKm !== null && p?.distanciaKm !== undefined ? String(p.distanciaKm) : '';
    Dom.pegar<HTMLInputElement>('ped-frete').value = p ? p.valorFrete.toFixed(2).replace('.', ',') : '0,00';
    Dom.pegar<HTMLSelectElement>('ped-status').value = p && p.statusPedido !== 'CANCELADO' && p.statusPedido !== 'ENTREGUE' ? p.statusPedido : 'PENDENTE';

    const container = Dom.pegar('lista-itens-pedido');
    container.replaceChildren();
    this.linhas = 0;
    if (p && p.itens.length > 0) {
      for (const i of p.itens) this.adicionarLinhaItem(i.produtoId, i.quantidade);
    } else {
      this.adicionarLinhaItem();
    }
    Dom.pegar('painel-pedido').classList.remove('d-none');

    // [RF09] Ao abrir o formulário já busca distância, taxa e previsão do cliente selecionado via API
    void this.calcularEntrega();
  }

  private async aoSalvar(ev: Event): Promise<void> {
    ev.preventDefault();
    const linhas = document.querySelectorAll<HTMLElement>('.item-pedido-linha');
    const itens: ItemPedidoFormDTO[] = [];
    for (const linha of Array.from(linhas)) {
      const produtoId = Number((linha.querySelector('.item-produto') as HTMLSelectElement).value);
      const quantidade = Formato.inteiro((linha.querySelector('.item-quantidade') as HTMLInputElement).value);
      if (!Number.isFinite(produtoId) || produtoId <= 0) {
        Aviso.mostrar('Selecione um produto em todas as linhas.', 'danger');
        return;
      }
      if (!Number.isFinite(quantidade) || quantidade < 1) {
        Aviso.mostrar('Informe uma quantidade válida em todas as linhas.', 'danger');
        return;
      }
      itens.push({ produtoId, quantidade });
    }
    if (itens.length === 0) {
      Aviso.mostrar('Adicione ao menos um item ao pedido.', 'danger');
      return;
    }

    const distanciaTexto = Dom.pegar<HTMLInputElement>('ped-distancia').value.trim();
    const dados: DadosPedidoDTO = {
      clienteId: Number(Dom.pegar<HTMLSelectElement>('ped-cliente').value),
      entregadorId: Number(Dom.pegar<HTMLSelectElement>('ped-entregador').value) || null,
      distanciaKm: distanciaTexto ? Formato.decimal(distanciaTexto) : null,
      valorFrete: Formato.decimal(Dom.pegar<HTMLInputElement>('ped-frete').value),
      statusPedido: Dom.pegar<HTMLSelectElement>('ped-status').value as StatusPedidoDTO,
      itens,
    };

    const editando = this.idEmEdicao !== null;
    const r = editando
      ? await bridge.atualizarPedido(this.idEmEdicao as number, dados)
      : await bridge.criarPedido(dados);
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    this.fecharForm();

    // [RF11] Informa o resultado do disparo do e-mail de confirmação sem mascarar o sucesso da gravação do pedido
    const base = editando ? `Pedido #${r.dados.id} atualizado.` : `Pedido #${r.dados.id} criado.`;
    const email = r.dados.emailConfirmacao;
    if (email) {
      Aviso.mostrar(`${base} E-mail: ${email.mensagem}`, email.enviado ? 'success' : 'danger');
      this.mostrarAvisoEntrega(email.mensagem, email.enviado ? 'success' : 'warning');
    } else {
      Aviso.mostrar(base, 'success');
    }
    await this.carregarAuxiliares();
    await this.carregar();
  }

  // ---------- [RF09] Distância, taxa de entrega e previsão ----------

  /** [RF09] Soma os itens do formulário pelo preço de venda atual (usado para verificar a regra de frete grátis). */
  private calcularValorItens(): number {
    let total = 0;
    const linhas = document.querySelectorAll<HTMLElement>('.item-pedido-linha');
    for (const linha of Array.from(linhas)) {
      const produtoId = Number((linha.querySelector('.item-produto') as HTMLSelectElement | null)?.value);
      const quantidade = Formato.inteiro((linha.querySelector('.item-quantidade') as HTMLInputElement | null)?.value ?? '');
      const produto = this.produtos.find((p) => p.id === produtoId);
      if (!produto || !Number.isFinite(quantidade) || quantidade <= 0) continue;
      total += produto.precoVenda * quantidade;
    }
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  /** [RF09] Cálculo sob demanda: solicita ao processo main o cálculo de rota, taxa e previsão. */
  private async calcularEntrega(): Promise<void> {
    if (this.entregaCalculando) return;
    const clienteId = Number(Dom.pegar<HTMLSelectElement>('ped-cliente').value);
    if (!Number.isFinite(clienteId) || clienteId <= 0) {
      this.limparEntrega();
      this.mostrarResumoEntrega('Selecione um cliente para calcular a distância e a taxa de entrega.');
      return;
    }

    this.entregaCalculando = true;
    this.mostrarResumoEntrega('Calculando distância e taxa de entrega...');
    try {
      const r = await bridge.calcularTaxaEntrega({ clienteId, valorItens: this.calcularValorItens() });
      if (!r.ok) {
        this.limparEntrega();
        this.mostrarAvisoEntrega(r.erro, 'danger');
        this.mostrarResumoEntrega('Não foi possível calcular a entrega.');
        return;
      }
      this.aplicarTaxaEntrega(r.dados);
    } catch {
      this.limparEntrega();
      this.mostrarAvisoEntrega('Não foi possível calcular a entrega agora.', 'danger');
      this.mostrarResumoEntrega('Não foi possível calcular a entrega.');
    } finally {
      this.entregaCalculando = false;
    }
  }

  /** [RF09] Aplica os valores retornados pelo backend nos campos e no painel informativo da entrega */
  private aplicarTaxaEntrega(t: TaxaEntregaDTO): void {
    // Os campos são readonly no HTML: quem define os valores oficiais é o main
    const distancia = Dom.pegar<HTMLInputElement>('ped-distancia');
    distancia.value = t.distanciaKm === null ? '' : t.distanciaKm.toFixed(1).replace('.', ',');
    const frete = Dom.pegar<HTMLInputElement>('ped-frete');
    frete.value = t.taxaEntrega === null ? '0,00' : t.taxaEntrega.toFixed(2).replace('.', ',');

    PedidosTela.texto(
      'ped-entrega-distancia',
      t.distanciaKm === null ? 'Indisponível' : `${t.distanciaKm.toFixed(1)} km`,
    );
    PedidosTela.texto('ped-entrega-duracao', t.duracaoMin === null ? '—' : `${t.duracaoMin} min`);
    PedidosTela.texto(
      'ped-entrega-taxa',
      t.taxaEntrega === null ? '—' : t.freteGratis ? 'Grátis' : Formato.moeda(t.taxaEntrega),
    );
    PedidosTela.texto('ped-entrega-previsao', Formato.dataHora(t.previsaoEntrega));
    PedidosTela.texto('ped-entrega-fonte', PedidosTela.fonteDistancia(t.origem));
    PedidosTela.mostrar('ped-entrega-resultado', true);

    this.mostrarResumoEntrega(
      `${t.distanciaKm === null ? 'Distância indisponível' : `${t.distanciaKm.toFixed(1)} km`} • ` +
        `${t.duracaoMin === null ? 'duração —' : `${t.duracaoMin} min`} • ` +
        `taxa ${t.taxaEntrega === null ? '—' : t.freteGratis ? 'grátis' : Formato.moeda(t.taxaEntrega)} • ` +
        `previsão ${Formato.dataHora(t.previsaoEntrega)}`,
    );

    if (t.aviso) {
      this.mostrarAvisoEntrega(t.aviso, t.origem === 'INDISPONIVEL' ? 'danger' : 'warning');
    } else {
      PedidosTela.mostrar('ped-entrega-aviso', false);
    }
  }

  /** [RF09] Legenda amigável para a origem do cálculo (OSRM, Haversine, Distância Cadastrada) */
  private static fonteDistancia(origem: string): string {
    if (origem === 'OSRM') return 'API de rotas (OSRM)';
    if (origem === 'HAVERSINE') return 'Estimativa em linha reta (API de rotas indisponível)';
    if (origem === 'DISTANCIA_CADASTRADA') return 'Distância cadastrada do cliente';
    return 'Indisponível';
  }

  private mostrarResumoEntrega(texto: string): void {
    PedidosTela.texto('ped-entrega-resumo', texto);
  }

  private mostrarAvisoEntrega(texto: string, tipo: 'success' | 'warning' | 'danger'): void {
    const aviso = PedidosTela.el('ped-entrega-aviso');
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.className = `small mt-1 text-${tipo}`;
    aviso.classList.remove('d-none');
  }

  private limparEntrega(): void {
    const distancia = PedidosTela.el<HTMLInputElement>('ped-distancia');
    if (distancia) distancia.value = '';
    const frete = PedidosTela.el<HTMLInputElement>('ped-frete');
    if (frete) frete.value = '0,00';
    PedidosTela.texto('ped-entrega-distancia', '—');
    PedidosTela.texto('ped-entrega-duracao', '—');
    PedidosTela.texto('ped-entrega-taxa', '—');
    PedidosTela.texto('ped-entrega-previsao', '—');
    PedidosTela.texto('ped-entrega-fonte', '—');
    PedidosTela.mostrar('ped-entrega-resultado', false);
    PedidosTela.mostrar('ped-entrega-aviso', false);
  }

  private static el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  private static texto(id: string, valor: string): void {
    const el = PedidosTela.el(id);
    if (el) el.textContent = valor;
  }

  private static mostrar(id: string, visivel: boolean): void {
    PedidosTela.el(id)?.classList.toggle('d-none', !visivel);
  }

  private static rotuloStatus(s: StatusPedidoDTO): string {
    return PedidosTela.STATUS.find((x) => x.valor === s)?.rotulo ?? s;
  }

  private static classeStatus(s: StatusPedidoDTO): string {
    const mapa: Record<StatusPedidoDTO, string> = {
      PENDENTE: 'bg-warning text-dark',
      EM_SEPARACAO: 'bg-info text-dark',
      SAIU_PARA_ENTREGA: 'bg-primary',
      ENTREGUE: 'bg-success',
      CANCELADO: 'bg-secondary',
    };
    return mapa[s] ?? 'bg-secondary';
  }
}
