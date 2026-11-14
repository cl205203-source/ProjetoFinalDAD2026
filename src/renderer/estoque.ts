// Tela de movimentação de estoque (RF04): entradas, ajustes manuais e histórico.

class EstoqueTela implements Tela {
  private usuarioAtual: UsuarioDTO | null = null;

  constructor() {
    Dom.pegar<HTMLFormElement>('form-estoque').addEventListener('submit', (e) => void this.aoRegistrar(e));
    Dom.pegar('e-filtro-produto').addEventListener('change', () => void this.carregarHistorico());
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;

    // Atendente só pode registrar entradas; ajustes manuais são do Admin.
    const admin = usuario.perfil === 'ADMIN';
    Dom.pegar<HTMLSelectElement>('e-tipo').querySelectorAll('option').forEach((o) => {
      const ehAjuste = o.value.startsWith('AJUSTE');
      o.hidden = ehAjuste && !admin;
      o.disabled = ehAjuste && !admin;
    });
    if (!admin) Dom.pegar<HTMLSelectElement>('e-tipo').value = 'ENTRADA';

    await this.carregarProdutos();
    await this.carregarHistorico();
  }

  limpar(): void {
    this.usuarioAtual = null;
    Dom.pegar('tabela-movimentacoes').replaceChildren();
    Dom.pegar('e-produto').replaceChildren();
    Dom.pegar('e-filtro-produto').replaceChildren();
  }

  /** Chamado pelo botão "Movimentar" da tela de produtos. */
  selecionar(produtoId: number): void {
    Dom.pegar<HTMLSelectElement>('e-produto').value = String(produtoId);
    Dom.pegar<HTMLInputElement>('e-qtd').focus();
  }

  private async carregarProdutos(): Promise<void> {
    const r = await bridge.listarProdutos({ status: 'ATIVOS', somenteEstoqueBaixo: false });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    const selecaoForm = Dom.pegar<HTMLSelectElement>('e-produto').value;
    const selecaoFiltro = Dom.pegar<HTMLSelectElement>('e-filtro-produto').value;

    const preencher = (sel: HTMLSelectElement, primeiro: string, comSaldo: boolean, valorAnterior: string): void => {
      sel.replaceChildren();
      const op0 = Dom.criar('option', '', primeiro);
      op0.value = '';
      sel.appendChild(op0);
      for (const p of r.dados) {
        const op = Dom.criar('option', '', comSaldo ? `${p.nome} — ${p.marca} (saldo: ${p.estoqueAtual})` : `${p.nome} — ${p.marca}`);
        op.value = String(p.id);
        sel.appendChild(op);
      }
      sel.value = valorAnterior;
    };

    preencher(Dom.pegar<HTMLSelectElement>('e-produto'), 'Selecione um produto...', true, selecaoForm);
    preencher(Dom.pegar<HTMLSelectElement>('e-filtro-produto'), 'Todos os produtos', false, selecaoFiltro);
  }

  private async carregarHistorico(): Promise<void> {
    const filtro = Dom.pegar<HTMLSelectElement>('e-filtro-produto').value;
    const r = await bridge.listarMovimentacoes({ produtoId: filtro ? Number(filtro) : undefined, limite: 100 });
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    const corpo = Dom.pegar('tabela-movimentacoes');
    corpo.replaceChildren();

    if (r.dados.length === 0) {
      const tr = Dom.criar('tr');
      const td = Dom.criar('td', 'text-center text-muted py-4', 'Nenhuma movimentação registrada.');
      td.colSpan = 7;
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }

    for (const m of r.dados) {
      const info = Rotulos.MOVIMENTACAO[m.tipo];
      const tr = Dom.criar('tr');
      const celula = (texto = '', classe = ''): HTMLTableCellElement => {
        const td = Dom.criar('td', classe, texto);
        tr.appendChild(td);
        return td;
      };

      celula(Formato.dataHora(m.dataMovimentacao), 'text-nowrap');
      celula(m.produtoNome);
      celula().appendChild(Dom.criar('span', `badge ${info.classe}`, info.rotulo));
      celula(`${info.sinal}${m.quantidade}`, `text-end fw-semibold ${info.sinal === '+' ? 'text-success' : 'text-danger'}`);
      celula(m.pedidoId ? `#${m.pedidoId}` : '—');
      celula(m.usuarioNome ?? '—');
      celula(m.observacao ?? '');
      corpo.appendChild(tr);
    }
  }

  private async aoRegistrar(ev: Event): Promise<void> {
    ev.preventDefault();
    const produtoId = Number(Dom.pegar<HTMLSelectElement>('e-produto').value);
    if (!produtoId) {
      Aviso.mostrar('Selecione um produto.', 'danger');
      return;
    }

    const r = await bridge.registrarMovimentacao({
      produtoId,
      tipo: Dom.pegar<HTMLSelectElement>('e-tipo').value as TipoMov,
      quantidade: Formato.inteiro(Dom.pegar<HTMLInputElement>('e-qtd').value),
      observacao: Dom.pegar<HTMLInputElement>('e-obs').value,
    });

    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    Aviso.mostrar(`Movimentação registrada. Novo saldo de "${r.dados.nome}": ${r.dados.estoqueAtual}.`, 'success');
    Dom.pegar<HTMLInputElement>('e-qtd').value = '';
    Dom.pegar<HTMLInputElement>('e-obs').value = '';
    await this.carregarProdutos();
    await this.carregarHistorico();
  }
}