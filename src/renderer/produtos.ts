// Tela de produtos (RF02). Admin: CRUD completo. Atendente: só consulta e movimentar (entrada).

class ProdutosTela implements Tela {
  private usuarioAtual: UsuarioDTO | null = null;
  private idEmEdicao: number | null = null;

  constructor(private readonly aoMovimentar: (p: ProdutoDTO) => void) {
    Dom.pegar<HTMLFormElement>('form-filtro-produtos').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.carregar();
    });
    Dom.pegar('btn-limpar-filtro').addEventListener('click', () => {
      Dom.pegar<HTMLInputElement>('filtro-busca').value = '';
      Dom.pegar<HTMLSelectElement>('filtro-categoria').value = '';
      Dom.pegar<HTMLSelectElement>('filtro-status').value = 'ATIVOS';
      Dom.pegar<HTMLInputElement>('filtro-baixo').checked = false;
      void this.carregar();
    });
    Dom.pegar('btn-novo-produto').addEventListener('click', () => this.abrirForm());
    Dom.pegar('btn-cancelar-produto').addEventListener('click', () => this.fecharForm());
    Dom.pegar<HTMLFormElement>('form-produto').addEventListener('submit', (e) => void this.aoSalvar(e));
  }

  private get ehAdmin(): boolean {
    return this.usuarioAtual?.perfil === 'ADMIN';
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    Dom.pegar('btn-novo-produto').classList.toggle('d-none', !this.ehAdmin);
    Dom.pegar('grupo-filtro-status').classList.toggle('d-none', !this.ehAdmin);
    await this.carregar();
  }

  limpar(): void {
    this.usuarioAtual = null;
    this.fecharForm();
    Dom.pegar('tabela-produtos').replaceChildren();
  }

  fecharForm(): void {
    this.idEmEdicao = null;
    Dom.pegar('painel-produto').classList.add('d-none');
  }

  // ---------- Listagem ----------
  private filtro(): FiltroProdutoDTO {
    const busca = Dom.pegar<HTMLInputElement>('filtro-busca').value.trim();
    const categoria = Dom.pegar<HTMLSelectElement>('filtro-categoria').value;
    const status = Dom.pegar<HTMLSelectElement>('filtro-status').value as FiltroProdutoDTO['status'];
    return {
      busca: busca || undefined,
      categoria: (categoria || undefined) as Categoria | undefined,
      status: this.ehAdmin ? status : 'ATIVOS',
      somenteEstoqueBaixo: Dom.pegar<HTMLInputElement>('filtro-baixo').checked,
    };
  }

  private async carregar(): Promise<void> {
    const r = await bridge.listarProdutos(this.filtro());
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    const corpo = Dom.pegar('tabela-produtos');
    corpo.replaceChildren();

    if (r.dados.length === 0) {
      const tr = Dom.criar('tr');
      const td = Dom.criar('td', 'text-center text-muted py-4', 'Nenhum produto encontrado.');
      td.colSpan = 9;
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }

    for (const p of r.dados) {
      const tr = Dom.criar('tr', p.ativo ? '' : 'table-secondary');
      const celula = (texto = '', classe = ''): HTMLTableCellElement => {
        const td = Dom.criar('td', classe, texto);
        tr.appendChild(td);
        return td;
      };

      celula(String(p.id));
      const tdNome = celula();
      tdNome.appendChild(Dom.criar('div', 'fw-semibold', p.nome));
      tdNome.appendChild(Dom.criar('div', 'small text-muted', p.marca));
      celula(Rotulos.CATEGORIA[p.categoria]);
      celula().appendChild(
        Dom.criar('span', p.isImportado ? 'badge bg-warning text-dark' : 'badge bg-light text-dark border',
          p.isImportado ? 'Importado' : 'Nacional'),
      );
      celula(Formato.moeda(p.precoCusto), 'text-end');
      celula(Formato.moeda(p.precoVenda), 'text-end');

      const tdEstoque = celula('', 'text-center');
      tdEstoque.appendChild(Dom.criar('span', p.estoqueBaixo ? 'badge bg-danger' : 'badge bg-success', String(p.estoqueAtual)));
      tdEstoque.appendChild(Dom.criar('div', 'small text-muted', `mín. ${p.estoqueMinimo}`));

      celula().appendChild(
        Dom.criar('span', p.ativo ? 'badge bg-success' : 'badge bg-secondary', p.ativo ? 'Ativo' : 'Inativo'),
      );

      const acoes = Dom.criar('div', 'd-flex gap-1 justify-content-end flex-wrap');
      if (p.ativo) {
        acoes.appendChild(Dom.botao('Movimentar', 'btn btn-sm btn-outline-success', () => this.aoMovimentar(p)));
      }
      if (this.ehAdmin) {
        acoes.appendChild(Dom.botao('Editar', 'btn btn-sm btn-outline-primary', () => this.abrirForm(p)));
        if (p.ativo) {
          acoes.appendChild(Dom.botao('Inativar', 'btn btn-sm btn-outline-warning', () => void this.inativar(p)));
        } else {
          acoes.appendChild(Dom.botao('Reativar', 'btn btn-sm btn-outline-success', () => void this.reativar(p)));
        }
        acoes.appendChild(Dom.botao('Excluir', 'btn btn-sm btn-outline-danger', () => void this.excluir(p)));
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
      return;
    }
    Aviso.mostrar(sucesso, 'success');
    await this.carregar();
  }

  private async inativar(p: ProdutoDTO): Promise<void> {
    if (!confirm(`Inativar "${p.nome}"? Ele deixará de aparecer para venda e movimentação.`)) return;
    await this.executar(bridge.inativarProduto(p.id), 'Produto inativado.');
  }

  private async reativar(p: ProdutoDTO): Promise<void> {
    await this.executar(bridge.reativarProduto(p.id), 'Produto reativado.');
  }

  private async excluir(p: ProdutoDTO): Promise<void> {
    if (!confirm(`Excluir definitivamente "${p.nome}"? Esta ação não pode ser desfeita.`)) return;
    await this.executar(bridge.excluirProduto(p.id), 'Produto excluído.');
  }

  // ---------- Formulário ----------
  private abrirForm(p?: ProdutoDTO): void {
    Aviso.limpar();
    this.idEmEdicao = p?.id ?? null;
    Dom.pegar('produto-titulo').textContent = p ? `Editar produto: ${p.nome}` : 'Novo produto';

    Dom.pegar<HTMLInputElement>('p-nome').value = p?.nome ?? '';
    Dom.pegar<HTMLInputElement>('p-marca').value = p?.marca ?? '';
    Dom.pegar<HTMLSelectElement>('p-categoria').value = p?.categoria ?? 'RACAO';
    Dom.pegar<HTMLTextAreaElement>('p-descricao').value = p?.descricao ?? '';
    Dom.pegar<HTMLInputElement>('p-custo').value = p ? String(p.precoCusto).replace('.', ',') : '';
    Dom.pegar<HTMLInputElement>('p-venda').value = p ? String(p.precoVenda).replace('.', ',') : '';
    Dom.pegar<HTMLSelectElement>('p-origem').value = p?.isImportado ? 'IMPORTADO' : 'NACIONAL';
    Dom.pegar<HTMLInputElement>('p-estoque').value = '0';
    Dom.pegar<HTMLInputElement>('p-minimo').value = String(p?.estoqueMinimo ?? 0);

    // O saldo só é definido no cadastro; depois, apenas pela aba Estoque.
    Dom.pegar('grupo-estoque-inicial').classList.toggle('d-none', p !== undefined);
    Dom.pegar('dica-estoque').classList.toggle('d-none', p === undefined);
    Dom.pegar('painel-produto').classList.remove('d-none');
  }

  private async aoSalvar(ev: Event): Promise<void> {
    ev.preventDefault();
    const dados: DadosProdutoDTO = {
      nome: Dom.pegar<HTMLInputElement>('p-nome').value,
      marca: Dom.pegar<HTMLInputElement>('p-marca').value,
      categoria: Dom.pegar<HTMLSelectElement>('p-categoria').value as Categoria,
      descricao: Dom.pegar<HTMLTextAreaElement>('p-descricao').value,
      precoCusto: Formato.decimal(Dom.pegar<HTMLInputElement>('p-custo').value),
      precoVenda: Formato.decimal(Dom.pegar<HTMLInputElement>('p-venda').value),
      isImportado: Dom.pegar<HTMLSelectElement>('p-origem').value === 'IMPORTADO',
      estoqueMinimo: Formato.inteiro(Dom.pegar<HTMLInputElement>('p-minimo').value),
    };

    const editando = this.idEmEdicao !== null;
    const r = editando
      ? await bridge.atualizarProduto(this.idEmEdicao as number, dados)
      : await bridge.criarProduto({ ...dados, estoqueAtual: Formato.inteiro(Dom.pegar<HTMLInputElement>('p-estoque').value) });

    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    this.fecharForm();
    Aviso.mostrar(editando ? 'Produto atualizado.' : 'Produto cadastrado.', 'success');
    await this.carregar();
  }
}