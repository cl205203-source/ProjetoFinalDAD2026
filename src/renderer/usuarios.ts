// Tela de usuários (RF01). Visível apenas para ADMIN, exceto "alterar minha senha".

type ModoUsuario = 'criar' | 'editar' | 'senha' | 'minhaSenha';

class UsuariosTela implements Tela {
  private static readonly CAMPOS: Record<ModoUsuario, string[]> = {
    criar: ['nome', 'email', 'perfil', 'senha'],
    editar: ['nome', 'email', 'perfil'],
    senha: ['senha'],
    minhaSenha: ['senhaAtual', 'senha'],
  };

  private usuarioAtual: UsuarioDTO | null = null;
  private modo: ModoUsuario = 'criar';
  private idEmEdicao: number | null = null;

  constructor(private readonly aoAtualizarSessao: (u: UsuarioDTO) => void) {
    Dom.pegar('btn-novo').addEventListener('click', () => this.abrirForm('criar'));
    Dom.pegar('btn-cancelar').addEventListener('click', () => this.fecharForm());
    Dom.pegar<HTMLFormElement>('form-usuario').addEventListener('submit', (e) => void this.aoSalvar(e));
  }

  async ativar(usuario: UsuarioDTO): Promise<void> {
    this.usuarioAtual = usuario;
    await this.carregar();
  }

  limpar(): void {
    this.usuarioAtual = null;
    this.fecharForm();
    Dom.pegar('tabela-usuarios').replaceChildren();
  }

  abrirMinhaSenha(usuario: UsuarioDTO): void {
    this.usuarioAtual = usuario;
    this.abrirForm('minhaSenha');
  }

  fecharForm(): void {
    this.limparSenhas();
    Dom.pegar('painel-form').classList.add('d-none');
  }

  // ---------- Tabela ----------
  private async carregar(): Promise<void> {
    const r = await bridge.listarUsuarios();
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    const corpo = Dom.pegar('tabela-usuarios');
    corpo.replaceChildren();

    for (const u of r.dados) {
      const tr = Dom.criar('tr', u.ativo ? '' : 'table-secondary');
      const celula = (texto = '', classe = ''): HTMLTableCellElement => {
        const td = Dom.criar('td', classe, texto);
        tr.appendChild(td);
        return td;
      };

      celula(String(u.id));
      celula(u.nome);
      celula(u.email);
      celula().appendChild(
        Dom.criar('span', u.perfil === 'ADMIN' ? 'badge bg-danger' : 'badge bg-primary',
          u.perfil === 'ADMIN' ? 'Administrador' : 'Atendente'),
      );
      celula().appendChild(
        Dom.criar('span', u.ativo ? 'badge bg-success' : 'badge bg-secondary', u.ativo ? 'Ativo' : 'Inativo'),
      );

      const acoes = Dom.criar('div', 'd-flex gap-1 justify-content-end flex-wrap');
      acoes.appendChild(Dom.botao('Editar', 'btn btn-sm btn-outline-primary', () => this.abrirForm('editar', u)));
      acoes.appendChild(Dom.botao('Redefinir senha', 'btn btn-sm btn-outline-secondary', () => this.abrirForm('senha', u)));

      if (u.id !== this.usuarioAtual?.id) {
        if (u.ativo) {
          acoes.appendChild(Dom.botao('Inativar', 'btn btn-sm btn-outline-warning', () => void this.inativar(u)));
        } else {
          acoes.appendChild(Dom.botao('Reativar', 'btn btn-sm btn-outline-success', () => void this.reativar(u)));
        }
        acoes.appendChild(Dom.botao('Excluir', 'btn btn-sm btn-outline-danger', () => void this.excluir(u)));
      }
      celula('', 'text-end').appendChild(acoes);
      corpo.appendChild(tr);
    }
  }

  private async executar(acao: Promise<RespostaIpc<unknown>>, sucesso: string): Promise<void> {
    const r = await acao;
    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }
    Aviso.mostrar(sucesso, 'success');
    await this.carregar();
  }

  private async inativar(u: UsuarioDTO): Promise<void> {
    if (!confirm(`Inativar o usuário "${u.nome}"? Ele não poderá mais entrar no sistema.`)) return;
    await this.executar(bridge.inativarUsuario(u.id), 'Usuário inativado.');
  }

  private async reativar(u: UsuarioDTO): Promise<void> {
    await this.executar(bridge.reativarUsuario(u.id), 'Usuário reativado.');
  }

  private async excluir(u: UsuarioDTO): Promise<void> {
    if (!confirm(`Excluir definitivamente "${u.nome}"? Esta ação não pode ser desfeita.`)) return;
    await this.executar(bridge.excluirUsuario(u.id), 'Usuário excluído.');
  }

  // ---------- Formulário ----------
  private abrirForm(modo: ModoUsuario, u?: UsuarioDTO): void {
    Aviso.limpar();
    this.modo = modo;
    this.idEmEdicao = u?.id ?? null;

    const titulos: Record<ModoUsuario, string> = {
      criar: 'Novo usuário',
      editar: `Editar usuário: ${u?.nome ?? ''}`,
      senha: `Redefinir senha de: ${u?.nome ?? ''}`,
      minhaSenha: 'Alterar minha senha',
    };
    Dom.pegar('form-titulo').textContent = titulos[modo];
    Dom.pegar('f-senha-label').textContent = modo === 'criar' ? 'Senha' : 'Nova senha';

    document.querySelectorAll<HTMLElement>('#form-usuario [data-campo]').forEach((div) => {
      div.classList.toggle('d-none', !UsuariosTela.CAMPOS[modo].includes(div.dataset.campo ?? ''));
    });

    Dom.pegar<HTMLInputElement>('f-nome').value = u?.nome ?? '';
    Dom.pegar<HTMLInputElement>('f-email').value = u?.email ?? '';
    Dom.pegar<HTMLSelectElement>('f-perfil').value = u?.perfil ?? 'ATENDENTE';
    this.limparSenhas();
    Dom.pegar('painel-form').classList.remove('d-none');
  }

  private limparSenhas(): void {
    Dom.pegar<HTMLInputElement>('f-senha').value = '';
    Dom.pegar<HTMLInputElement>('f-senha-atual').value = '';
  }

  private async aoSalvar(ev: Event): Promise<void> {
    ev.preventDefault();
    const nome = Dom.pegar<HTMLInputElement>('f-nome').value;
    const email = Dom.pegar<HTMLInputElement>('f-email').value;
    const perfil = Dom.pegar<HTMLSelectElement>('f-perfil').value as Perfil;
    const senha = Dom.pegar<HTMLInputElement>('f-senha').value;
    const senhaAtual = Dom.pegar<HTMLInputElement>('f-senha-atual').value;
    const id = this.idEmEdicao ?? 0;

    let r: RespostaIpc<unknown>;
    let sucesso: string;
    switch (this.modo) {
      case 'criar':
        r = await bridge.criarUsuario({ nome, email, senha, perfil });
        sucesso = 'Usuário criado.';
        break;
      case 'editar':
        r = await bridge.atualizarUsuario(id, { nome, email, perfil });
        sucesso = 'Usuário atualizado.';
        break;
      case 'senha':
        r = await bridge.redefinirSenha(id, { novaSenha: senha });
        sucesso = 'Senha redefinida.';
        break;
      case 'minhaSenha':
        r = await bridge.alterarMinhaSenha({ senhaAtual, novaSenha: senha });
        sucesso = 'Sua senha foi alterada.';
        break;
    }

    if (!r.ok) {
      Aviso.mostrar(r.erro, 'danger');
      return;
    }

    this.fecharForm();
    Aviso.mostrar(sucesso, 'success');

    // Se o admin editou a si mesmo, atualiza o nome mostrado na barra.
    const s = await bridge.sessao();
    if (s.ok && s.dados) {
      this.usuarioAtual = s.dados;
      this.aoAtualizarSessao(s.dados);
    }
    if (this.usuarioAtual?.perfil === 'ADMIN') await this.carregar();
  }
}