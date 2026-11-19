// Tela de entregadores (RF07). Admin: CRUD completo. Atendente: consulta e troca a disponibilidade.

class EntregadoresTela implements Tela {
  private static readonly STATUS: { valor: StatusEntregadorDTO; rotulo: string }[] = [
    { valor: 'DISPONIVEL', rotulo: 'Disponível' },
    { valor: 'EM_ROTA', rotulo: 'Em Rota' },
    { valor: 'INDISPONIVEL', rotulo: 'Indisponível' },
  ];

  private usuarioAtual: UsuarioDTO | null = null;
  private idEmEdicao: number | null = null;

  constructor() {
    for (const id of ['ent-status', 'filtro-ent-disponibilidade']) {
      const sel = Dom.pegar<HTMLSelectElement>(id);
      for (const s of EntregadoresTela.STATUS) {
        const o = Dom.criar('option', '', s.rotulo);
        o.value = s.valor;
        sel.appendChild(o);
      }
    }

    Mascara.aplicar(Dom.pegar<HTMLInputElement>('ent-cpf'), Mascara.cpf);
    Mascara.aplicar(Dom.pegar<HTMLInputElement>('ent-telefone'), Mascara.telefone);
    Mascara.aplicar(Dom.pegar<HTMLInputElement>('ent-placa'), Mascara.placa);

    Dom.pegar<HTMLFormElement>('form-filtro-entregadores').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.carregar();
    });
    Dom.pegar('btn-limpar-filtro-entregadores').addEventListener('click', () => {
      Dom.pegar<HTMLInputElement>('filtro-ent-busca').value = '';
      Dom.pegar<HTMLSelectElement>('filtro-ent-disponibilidade').value = '';
      Dom.pegar<HTMLSelectElement>('filtro-ent-status').value = 'ATIVOS';
      void this.carregar();
    });
    Dom.pegar('btn-novo-entregador').addEventListener('click', () => this.abrirForm());
    Dom.pegar('btn-cancelar-entregador').addEventListener('click', () => this.fecharForm());
    Dom.pegar<HTMLFormElement>('form-entregador').addEventListener('submit', (e) => void this.aoSalvar(e));
  }

  private get ehAdmin(): boolean {
    return this.usuarioAtual?.perfil === 'ADMIN';
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    Dom.pegar('btn-novo-entregador').classList.toggle('d-none', !this.ehAdmin);
    Dom.pegar('grupo-filtro-ent-status').classList.toggle('d-none', !this.ehAdmin);
    await this.carregar();
  }

  limpar(): void {
    this.usuarioAtual = null;
    this.fecharForm();
    Dom.pegar('tabela-entregadores').replaceChildren();
  }

  fecharForm(): void {
    this.idEmEdicao = null;
    Dom.pegar('painel-entregador').classList.add('d-none');
  }

  // ---------- Listagem ----------
  private filtro(): FiltroEntregadorDTO {
    const busca = Dom.pegar<HTMLInputElement>('filtro-ent-busca').value.trim();
    const disp = Dom.pegar<HTMLSelectElement>('filtro-ent-disponibilidade').value;
    const status = Dom.pegar<HTMLSelectElement>('filtro-ent-status').value as FiltroEntregadorDTO['status'];
    return {
      busca: busca || undefined,
      disponibilidade: (disp || undefined) as StatusEntregadorDTO | undefined,
      status: this.ehAdmin ? status : 'ATIVOS',
    };
  }

  private async carregar(): Promise<void> {
    const r = await bridge.listarEntregadores(this.filtro());
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    const corpo = Dom.pegar('tabela-entregadores');
    corpo.replaceChildren();

    if (r.dados.length === 0) {
      const tr = Dom.criar('tr');
      const td = Dom.criar('td', 'text-center text-muted py-4', 'Nenhum entregador encontrado.');
      td.colSpan = 7;
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }

    for (const e of r.dados) {
      const tr = Dom.criar('tr', e.ativo ? '' : 'table-secondary');
      const celula = (texto = '', classe = ''): HTMLTableCellElement => {
        const td = Dom.criar('td', classe, texto);
        tr.appendChild(td);
        return td;
      };

      celula(String(e.id));
      celula(e.nome, 'fw-semibold');
      celula(Mascara.cpf(e.cpf));
      celula(Mascara.telefone(e.telefone));
      const tdVeiculo = celula();
      tdVeiculo.appendChild(Dom.criar('div', '', e.veiculo));
      tdVeiculo.appendChild(Dom.criar('div', 'small text-muted', e.placa ?? 'Sem placa'));

      const tdStatus = celula();
      if (e.ativo) {
        // Troca rápida de disponibilidade (Admin e Atendente).
        const sel = Dom.criar('select', 'form-select form-select-sm');
        for (const s of EntregadoresTela.STATUS) {
          const o = Dom.criar('option', '', s.rotulo);
          o.value = s.valor;
          sel.appendChild(o);
        }
        sel.value = e.status;
        sel.addEventListener('change', () => void this.mudarStatus(e, sel.value as StatusEntregadorDTO));
        tdStatus.appendChild(sel);
      } else {
        tdStatus.appendChild(Dom.criar('span', 'badge bg-secondary', 'Inativo'));
      }

      const acoes = Dom.criar('div', 'd-flex gap-1 justify-content-end flex-wrap');
      if (this.ehAdmin) {
        acoes.appendChild(Dom.botao('Editar', 'btn btn-sm btn-outline-primary', () => this.abrirForm(e)));
        if (e.ativo) {
          acoes.appendChild(Dom.botao('Inativar', 'btn btn-sm btn-outline-warning', () => void this.inativar(e)));
        } else {
          acoes.appendChild(Dom.botao('Reativar', 'btn btn-sm btn-outline-success', () => void this.reativar(e)));
        }
        acoes.appendChild(Dom.botao('Excluir', 'btn btn-sm btn-outline-danger', () => void this.excluir(e)));
      }
      celula('', 'text-end').appendChild(acoes);
      corpo.appendChild(tr);
    }
  }

  // ---------- Ações ----------
  private async executar(acao: Promise<RespostaIpc<unknown>>, sucesso: string): Promise<void> {
    const r = await acao;
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      await this.carregar(); // desfaz a troca visual do select em caso de erro
      return;
    }
    Aviso.mostrar(sucesso, 'success');
    await this.carregar();
  }

  private async mudarStatus(e: EntregadorDTO, status: StatusEntregadorDTO): Promise<void> {
    await this.executar(bridge.alterarStatusEntregador(e.id, { status }), 'Disponibilidade atualizada.');
  }

  private async inativar(e: EntregadorDTO): Promise<void> {
    if (!confirm(`Inativar "${e.nome}"? Ele deixará de aparecer para novas entregas.`)) return;
    await this.executar(bridge.inativarEntregador(e.id), 'Entregador inativado.');
  }

  private async reativar(e: EntregadorDTO): Promise<void> {
    await this.executar(bridge.reativarEntregador(e.id), 'Entregador reativado.');
  }

  private async excluir(e: EntregadorDTO): Promise<void> {
    if (!confirm(`Excluir definitivamente "${e.nome}"? Esta ação não pode ser desfeita.`)) return;
    await this.executar(bridge.excluirEntregador(e.id), 'Entregador excluído.');
  }

  // ---------- Formulário ----------
  private abrirForm(e?: EntregadorDTO): void {
    Aviso.limpar();
    this.idEmEdicao = e?.id ?? null;
    Dom.pegar('entregador-titulo').textContent = e ? `Editar entregador: ${e.nome}` : 'Novo entregador';

    Dom.pegar<HTMLInputElement>('ent-nome').value = e?.nome ?? '';
    Dom.pegar<HTMLInputElement>('ent-cpf').value = e ? Mascara.cpf(e.cpf) : '';
    Dom.pegar<HTMLInputElement>('ent-telefone').value = e ? Mascara.telefone(e.telefone) : '';
    Dom.pegar<HTMLInputElement>('ent-veiculo').value = e?.veiculo ?? '';
    Dom.pegar<HTMLInputElement>('ent-placa').value = e?.placa ?? '';
    Dom.pegar<HTMLSelectElement>('ent-status').value = e?.status ?? 'DISPONIVEL';
    Dom.pegar('painel-entregador').classList.remove('d-none');
  }

  private async aoSalvar(ev: Event): Promise<void> {
    ev.preventDefault();
    const dados: DadosEntregadorDTO = {
      nome: Dom.pegar<HTMLInputElement>('ent-nome').value,
      cpf: Dom.pegar<HTMLInputElement>('ent-cpf').value,
      telefone: Dom.pegar<HTMLInputElement>('ent-telefone').value,
      veiculo: Dom.pegar<HTMLInputElement>('ent-veiculo').value,
      placa: Dom.pegar<HTMLInputElement>('ent-placa').value,
      status: Dom.pegar<HTMLSelectElement>('ent-status').value as StatusEntregadorDTO,
    };

    const editando = this.idEmEdicao !== null;
    const r = editando ? await bridge.atualizarEntregador(this.idEmEdicao as number, dados) : await bridge.criarEntregador(dados);
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    this.fecharForm();
    Aviso.mostrar(editando ? 'Entregador atualizado.' : 'Entregador cadastrado.', 'success');
    await this.carregar();
  }
}
