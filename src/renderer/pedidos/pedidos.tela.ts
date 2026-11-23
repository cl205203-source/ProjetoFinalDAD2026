// Tela de pedidos (RF08). Admin e Atendente criam/consultam/alteram; Admin cancela e exclui.

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
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    await Promise.all([this.carregarAuxiliares(), this.carregar()]);
  }

  limpar(): void {
    this.usuarioAtual = null;
    this.fecharForm();
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
      celula(p.distanciaKm === null ? '—' : `${p.distanciaKm} km`, 'text-end');

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
    const obs = prompt('Motivo do cancelamento (opcional):', '') ?? '';
    const r = await bridge.cancelarPedido(p.id, { observacao: obs || null });
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
    colProduto.appendChild(sel);

    const colQtd = Dom.criar('div', 'col-md-2');
    const qtd = Dom.criar('input', 'form-control item-quantidade');
    qtd.type = 'text';
    qtd.inputMode = 'numeric';
    qtd.value = String(quantidade ?? 1);
    colQtd.appendChild(qtd);

    const colBtn = Dom.criar('div', 'col-md-2');
    colBtn.appendChild(Dom.botao('Remover', 'btn btn-sm btn-outline-danger', () => linha.remove()));

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
    Aviso.mostrar(editando ? `Pedido #${r.dados.id} atualizado.` : `Pedido #${r.dados.id} criado.`, 'success');
    await this.carregarAuxiliares();
    await this.carregar();
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
