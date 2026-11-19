// Tela de clientes (RF05/RF06). Admin e Atendente: cadastrar, consultar e editar.
// Inativar, reativar e excluir: só Admin. O CEP preenche o endereço e mostra a distância até a loja.

class ClientesTela implements Tela {
  private static readonly UFS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  ];

  private usuarioAtual: UsuarioDTO | null = null;
  private idEmEdicao: number | null = null;
  private cepConsultado = '';
  private sequenciaCep = 0;

  constructor() {
    const uf = Dom.pegar<HTMLSelectElement>('c-uf');
    uf.appendChild(Dom.criar('option', '', 'UF')).setAttribute('value', '');
    for (const sigla of ClientesTela.UFS) {
      const o = Dom.criar('option', '', sigla);
      o.value = sigla;
      uf.appendChild(o);
    }

    Mascara.aplicar(Dom.pegar<HTMLInputElement>('c-cpf'), Mascara.cpf);
    Mascara.aplicar(Dom.pegar<HTMLInputElement>('c-telefone'), Mascara.telefone);

    const cep = Dom.pegar<HTMLInputElement>('c-cep');
    Mascara.aplicar(cep, Mascara.cep);
    cep.addEventListener('input', () => {
      if (Mascara.digitos(cep.value).length === 8) void this.consultarCep();
    });
    cep.addEventListener('blur', () => void this.consultarCep());
    Dom.pegar('btn-buscar-cep').addEventListener('click', () => void this.consultarCep(true));

    Dom.pegar<HTMLFormElement>('form-filtro-clientes').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.carregar();
    });
    Dom.pegar('btn-limpar-filtro-clientes').addEventListener('click', () => {
      Dom.pegar<HTMLInputElement>('filtro-clientes-busca').value = '';
      Dom.pegar<HTMLSelectElement>('filtro-clientes-status').value = 'ATIVOS';
      void this.carregar();
    });
    Dom.pegar('btn-novo-cliente').addEventListener('click', () => this.abrirForm());
    Dom.pegar('btn-cancelar-cliente').addEventListener('click', () => this.fecharForm());
    Dom.pegar<HTMLFormElement>('form-cliente').addEventListener('submit', (e) => void this.aoSalvar(e));
  }

  private get ehAdmin(): boolean {
    return this.usuarioAtual?.perfil === 'ADMIN';
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    Dom.pegar('grupo-filtro-clientes-status').classList.toggle('d-none', !this.ehAdmin);
    await this.carregar();
  }

  limpar(): void {
    this.usuarioAtual = null;
    this.fecharForm();
    Dom.pegar('tabela-clientes').replaceChildren();
  }

  fecharForm(): void {
    this.idEmEdicao = null;
    Dom.pegar('painel-cliente').classList.add('d-none');
  }

  // ---------- Listagem ----------
  private filtro(): FiltroClienteDTO {
    const busca = Dom.pegar<HTMLInputElement>('filtro-clientes-busca').value.trim();
    const status = Dom.pegar<HTMLSelectElement>('filtro-clientes-status').value as FiltroClienteDTO['status'];
    return { busca: busca || undefined, status: this.ehAdmin ? status : 'ATIVOS' };
  }

  private async carregar(): Promise<void> {
    const r = await bridge.listarClientes(this.filtro());
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    const corpo = Dom.pegar('tabela-clientes');
    corpo.replaceChildren();

    if (r.dados.length === 0) {
      const tr = Dom.criar('tr');
      const td = Dom.criar('td', 'text-center text-muted py-4', 'Nenhum cliente encontrado.');
      td.colSpan = 7;
      tr.appendChild(td);
      corpo.appendChild(tr);
      return;
    }

    for (const c of r.dados) {
      const tr = Dom.criar('tr', c.ativo ? '' : 'table-secondary');
      const celula = (texto = '', classe = ''): HTMLTableCellElement => {
        const td = Dom.criar('td', classe, texto);
        tr.appendChild(td);
        return td;
      };

      const tdNome = celula();
      tdNome.appendChild(Dom.criar('div', 'fw-semibold', c.nome));
      tdNome.appendChild(Dom.criar('div', 'small text-muted', c.email));
      celula(Mascara.cpf(c.cpf));
      celula(Mascara.telefone(c.telefone));

      const tdEnd = celula();
      const compl = c.complemento ? `, ${c.complemento}` : '';
      tdEnd.appendChild(Dom.criar('div', '', `${c.logradouro}, ${c.numero}${compl}`));
      tdEnd.appendChild(Dom.criar('div', 'small text-muted', `${c.bairro} - ${c.cidade}/${c.uf} - CEP ${Mascara.cep(c.cep)}`));

      celula(c.distanciaKm === null ? '—' : `${c.distanciaKm.toLocaleString('pt-BR')} km`, 'text-end');
      celula().appendChild(
        Dom.criar('span', c.ativo ? 'badge bg-success' : 'badge bg-secondary', c.ativo ? 'Ativo' : 'Inativo'),
      );

      const acoes = Dom.criar('div', 'd-flex gap-1 justify-content-end flex-wrap');
      acoes.appendChild(Dom.botao('Editar', 'btn btn-sm btn-outline-primary', () => this.abrirForm(c)));
      if (this.ehAdmin) {
        if (c.ativo) {
          acoes.appendChild(Dom.botao('Inativar', 'btn btn-sm btn-outline-warning', () => void this.inativar(c)));
        } else {
          acoes.appendChild(Dom.botao('Reativar', 'btn btn-sm btn-outline-success', () => void this.reativar(c)));
        }
        acoes.appendChild(Dom.botao('Excluir', 'btn btn-sm btn-outline-danger', () => void this.excluir(c)));
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

  private async inativar(c: ClienteDTO): Promise<void> {
    if (!confirm(`Inativar "${c.nome}"? Ele deixará de aparecer para novos pedidos.`)) return;
    await this.executar(bridge.inativarCliente(c.id), 'Cliente inativado.');
  }

  private async reativar(c: ClienteDTO): Promise<void> {
    await this.executar(bridge.reativarCliente(c.id), 'Cliente reativado.');
  }

  private async excluir(c: ClienteDTO): Promise<void> {
    if (!confirm(`Excluir definitivamente "${c.nome}"? Esta ação não pode ser desfeita.`)) return;
    await this.executar(bridge.excluirCliente(c.id), 'Cliente excluído.');
  }

  // ---------- Consulta de CEP (RF06) ----------
  private mostrarDistancia(texto: string, classe = 'text-muted'): void {
    const el = Dom.pegar('c-cep-status');
    el.textContent = texto;
    el.className = `form-text ${classe}`;
  }

  private async consultarCep(forcar = false): Promise<void> {
    const cep = Mascara.digitos(Dom.pegar<HTMLInputElement>('c-cep').value);
    if (cep.length !== 8) {
      if (forcar) this.mostrarDistancia('Informe um CEP com 8 dígitos.', 'text-danger');
      return;
    }
    if (cep === this.cepConsultado && !forcar) return;
    this.cepConsultado = cep;

    const minha = ++this.sequenciaCep; // descarta respostas antigas se o CEP mudou no meio do caminho
    this.mostrarDistancia('Consultando CEP...');
    const r = await bridge.consultarCep(cep);
    if (minha !== this.sequenciaCep) return;

    if (!r.ok) {
      this.cepConsultado = '';
      this.mostrarDistancia(r.erro, 'text-danger');
      return;
    }
    Dom.pegar<HTMLInputElement>('c-logradouro').value = r.dados.logradouro;
    Dom.pegar<HTMLInputElement>('c-bairro').value = r.dados.bairro;
    Dom.pegar<HTMLInputElement>('c-cidade').value = r.dados.cidade;
    Dom.pegar<HTMLSelectElement>('c-uf').value = r.dados.uf;
    Dom.pegar<HTMLInputElement>('c-numero').focus();

    this.mostrarDistancia(
      r.dados.distanciaKm === null
        ? 'Endereço preenchido. Não foi possível calcular a distância agora.'
        : `Endereço preenchido. Distância aproximada até a loja: ${r.dados.distanciaKm.toLocaleString('pt-BR')} km.`,
      r.dados.distanciaKm === null ? 'text-warning' : 'text-success',
    );
  }

  // ---------- Formulário ----------
  private abrirForm(c?: ClienteDTO): void {
    Aviso.limpar();
    this.idEmEdicao = c?.id ?? null;
    this.cepConsultado = c?.cep ?? ''; // editar não refaz a consulta, só se o CEP mudar
    this.sequenciaCep++;
    Dom.pegar('cliente-titulo').textContent = c ? `Editar cliente: ${c.nome}` : 'Novo cliente';

    Dom.pegar<HTMLInputElement>('c-nome').value = c?.nome ?? '';
    Dom.pegar<HTMLInputElement>('c-cpf').value = c ? Mascara.cpf(c.cpf) : '';
    Dom.pegar<HTMLInputElement>('c-telefone').value = c ? Mascara.telefone(c.telefone) : '';
    Dom.pegar<HTMLInputElement>('c-email').value = c?.email ?? '';
    Dom.pegar<HTMLInputElement>('c-cep').value = c ? Mascara.cep(c.cep) : '';
    Dom.pegar<HTMLInputElement>('c-logradouro').value = c?.logradouro ?? '';
    Dom.pegar<HTMLInputElement>('c-numero').value = c?.numero ?? '';
    Dom.pegar<HTMLInputElement>('c-complemento').value = c?.complemento ?? '';
    Dom.pegar<HTMLInputElement>('c-bairro').value = c?.bairro ?? '';
    Dom.pegar<HTMLInputElement>('c-cidade').value = c?.cidade ?? '';
    Dom.pegar<HTMLSelectElement>('c-uf').value = c?.uf ?? '';

    if (c && c.distanciaKm !== null) {
      this.mostrarDistancia(`Distância aproximada até a loja: ${c.distanciaKm.toLocaleString('pt-BR')} km.`);
    } else {
      this.mostrarDistancia(c ? 'Distância ainda não calculada (será tentada ao salvar).' : 'Digite o CEP para preencher o endereço.');
    }
    Dom.pegar('painel-cliente').classList.remove('d-none');
  }

  private async aoSalvar(ev: Event): Promise<void> {
    ev.preventDefault();
    const dados: DadosClienteDTO = {
      nome: Dom.pegar<HTMLInputElement>('c-nome').value,
      cpf: Dom.pegar<HTMLInputElement>('c-cpf').value,
      telefone: Dom.pegar<HTMLInputElement>('c-telefone').value,
      email: Dom.pegar<HTMLInputElement>('c-email').value,
      cep: Dom.pegar<HTMLInputElement>('c-cep').value,
      logradouro: Dom.pegar<HTMLInputElement>('c-logradouro').value,
      numero: Dom.pegar<HTMLInputElement>('c-numero').value,
      complemento: Dom.pegar<HTMLInputElement>('c-complemento').value,
      bairro: Dom.pegar<HTMLInputElement>('c-bairro').value,
      cidade: Dom.pegar<HTMLInputElement>('c-cidade').value,
      uf: Dom.pegar<HTMLSelectElement>('c-uf').value,
    };

    const editando = this.idEmEdicao !== null;
    const r = editando ? await bridge.atualizarCliente(this.idEmEdicao as number, dados) : await bridge.criarCliente(dados);
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    this.fecharForm();
    Aviso.mostrar(editando ? 'Cliente atualizado.' : 'Cliente cadastrado.', 'success');
    await this.carregar();
  }
}
