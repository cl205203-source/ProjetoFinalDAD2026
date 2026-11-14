// Interface: só conversa com o main via window.api (preload).
// ATENÇÃO: este arquivo não pode ter import/export (roda como script no navegador).

type Perfil = 'ADMIN' | 'ATENDENTE';

interface UsuarioDTO {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  criadoEm: string;
}

type RespostaIpc<T> = { ok: true; dados: T } | { ok: false; erro: string };

interface PontePreload {
  statusBanco(): Promise<{ ok: boolean; erro: string | null }>;
  login(d: { email: string; senha: string }): Promise<RespostaIpc<UsuarioDTO>>;
  logout(): Promise<RespostaIpc<void>>;
  sessao(): Promise<RespostaIpc<UsuarioDTO | null>>;
  listarUsuarios(): Promise<RespostaIpc<UsuarioDTO[]>>;
  criarUsuario(d: { nome: string; email: string; senha: string; perfil: Perfil }): Promise<RespostaIpc<UsuarioDTO>>;
  atualizarUsuario(id: number, d: { nome: string; email: string; perfil: Perfil }): Promise<RespostaIpc<UsuarioDTO>>;
  redefinirSenha(id: number, d: { novaSenha: string }): Promise<RespostaIpc<void>>;
  alterarMinhaSenha(d: { senhaAtual: string; novaSenha: string }): Promise<RespostaIpc<void>>;
  inativarUsuario(id: number): Promise<RespostaIpc<void>>;
  reativarUsuario(id: number): Promise<RespostaIpc<void>>;
  excluirUsuario(id: number): Promise<RespostaIpc<void>>;
}

const bridge = (window as unknown as { api: PontePreload }).api;

type Modo = 'criar' | 'editar' | 'senha' | 'minhaSenha';

class Dom {
  static criar<K extends keyof HTMLElementTagNameMap>(tag: K, classe = '', texto = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto) e.textContent = texto;
    return e;
  }

  static botao(texto: string, classe: string, aoClicar: () => void): HTMLButtonElement {
    const b = Dom.criar('button', classe, texto);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    return b;
  }

  static pegar<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }
}

class App {
  private static readonly CAMPOS: Record<Modo, string[]> = {
    criar: ['nome', 'email', 'perfil', 'senha'],
    editar: ['nome', 'email', 'perfil'],
    senha: ['senha'],
    minhaSenha: ['senhaAtual', 'senha'],
  };

  private usuarioAtual: UsuarioDTO | null = null;
  private modo: Modo = 'criar';
  private idEmEdicao: number | null = null;

  constructor() {
    this.ligarEventos();
    void this.iniciar();
  }

  // ---------- Inicialização ----------
  private async iniciar(): Promise<void> {
    const status = await bridge.statusBanco();
    const el = Dom.pegar<HTMLElement>('status');
    el.textContent = status.ok ? 'Conectado ao MySQL.' : `Falha na conexão: ${status.erro}`;
    el.className = `text-center small mb-4 ${status.ok ? 'text-success' : 'text-danger'}`;

    const s = await bridge.sessao();
    if (s.ok && s.dados) {
      this.usuarioAtual = s.dados;
      await this.mostrarApp();
    }
  }

  private ligarEventos(): void {
    Dom.pegar<HTMLFormElement>('form-login').addEventListener('submit', (e) => void this.aoLogar(e));
    Dom.pegar('btn-sair').addEventListener('click', () => void this.aoSair());
    Dom.pegar('btn-novo').addEventListener('click', () => this.abrirForm('criar'));
    Dom.pegar('btn-minha-senha').addEventListener('click', () => this.abrirForm('minhaSenha'));
    Dom.pegar('btn-cancelar').addEventListener('click', () => this.fecharForm());
    Dom.pegar<HTMLFormElement>('form-usuario').addEventListener('submit', (e) => void this.aoSalvar(e));
  }

  // ---------- Login / logout ----------
  private async aoLogar(ev: Event): Promise<void> {
    ev.preventDefault();
    const erro = Dom.pegar<HTMLElement>('login-erro');
    erro.classList.add('d-none');

    const r = await bridge.login({
      email: Dom.pegar<HTMLInputElement>('login-email').value,
      senha: Dom.pegar<HTMLInputElement>('login-senha').value,
    });
    Dom.pegar<HTMLInputElement>('login-senha').value = '';

    if (!r.ok) {
      erro.textContent = r.erro;
      erro.classList.remove('d-none');
      return;
    }
    this.usuarioAtual = r.dados;
    await this.mostrarApp();
  }

  private async aoSair(): Promise<void> {
    await bridge.logout();
    this.usuarioAtual = null;
    this.fecharForm();
    Dom.pegar('tabela-usuarios').replaceChildren();
    Dom.pegar('tela-app').classList.add('d-none');
    Dom.pegar('tela-login').classList.remove('d-none');
    Dom.pegar<HTMLInputElement>('login-email').value = '';
  }

  // ---------- Telas ----------
  private async mostrarApp(): Promise<void> {
    Dom.pegar('tela-login').classList.add('d-none');
    Dom.pegar('tela-app').classList.remove('d-none');
    this.atualizarNav();

    const ehAdmin = this.usuarioAtual?.perfil === 'ADMIN';
    Dom.pegar('secao-usuarios').classList.toggle('d-none', !ehAdmin);
    Dom.pegar('secao-atendente').classList.toggle('d-none', ehAdmin);
    if (ehAdmin) await this.carregarUsuarios();
  }

  private atualizarNav(): void {
    const u = this.usuarioAtual;
    if (!u) return;
    Dom.pegar('nav-usuario').textContent = `${u.nome} (${u.perfil === 'ADMIN' ? 'Administrador' : 'Atendente'})`;
  }

  private mostrarAlerta(texto: string, tipo: 'success' | 'danger'): void {
    const a = Dom.pegar<HTMLElement>('alerta');
    a.textContent = texto;
    a.className = `alert alert-${tipo}`;
  }

  private limparAlerta(): void {
    Dom.pegar('alerta').className = 'alert d-none';
  }

  // ---------- Tabela ----------
  private async carregarUsuarios(): Promise<void> {
    const r = await bridge.listarUsuarios();
    if (!r.ok) {
      this.mostrarAlerta(r.erro, 'danger');
      return;
    }
    const corpo = Dom.pegar('tabela-usuarios');
    corpo.replaceChildren();

    for (const u of r.dados) {
      const tr = Dom.criar('tr', u.ativo ? '' : 'table-secondary');
      const celula = (texto: string): HTMLTableCellElement => {
        const td = Dom.criar('td', '', texto);
        tr.appendChild(td);
        return td;
      };

      celula(String(u.id));
      celula(u.nome);
      celula(u.email);
      celula('').appendChild(
        Dom.criar('span', u.perfil === 'ADMIN' ? 'badge bg-danger' : 'badge bg-primary',
          u.perfil === 'ADMIN' ? 'Administrador' : 'Atendente'),
      );
      celula('').appendChild(
        Dom.criar('span', u.ativo ? 'badge bg-success' : 'badge bg-secondary', u.ativo ? 'Ativo' : 'Inativo'),
      );

      const acoes = Dom.criar('div', 'd-flex gap-1 justify-content-end flex-wrap');
      acoes.appendChild(Dom.botao('Editar', 'btn btn-sm btn-outline-primary', () => this.abrirForm('editar', u)));
      acoes.appendChild(Dom.botao('Redefinir senha', 'btn btn-sm btn-outline-secondary', () => this.abrirForm('senha', u)));

      const ehEuMesmo = u.id === this.usuarioAtual?.id;
      if (!ehEuMesmo) {
        if (u.ativo) {
          acoes.appendChild(Dom.botao('Inativar', 'btn btn-sm btn-outline-warning', () => void this.inativar(u)));
        } else {
          acoes.appendChild(Dom.botao('Reativar', 'btn btn-sm btn-outline-success', () => void this.reativar(u)));
        }
        acoes.appendChild(Dom.botao('Excluir', 'btn btn-sm btn-outline-danger', () => void this.excluir(u)));
      }
      celula('').className = 'text-end';
      tr.lastElementChild!.appendChild(acoes);
      corpo.appendChild(tr);
    }
  }

  // ---------- Ações da tabela ----------
  private async executar(acao: Promise<RespostaIpc<unknown>>, sucesso: string): Promise<boolean> {
    const r = await acao;
    if (!r.ok) {
      this.mostrarAlerta(r.erro, 'danger');
      return false;
    }
    this.mostrarAlerta(sucesso, 'success');
    await this.carregarUsuarios();
    return true;
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
  private abrirForm(modo: Modo, u?: UsuarioDTO): void {
    this.limparAlerta();
    this.modo = modo;
    this.idEmEdicao = u?.id ?? null;

    const titulos: Record<Modo, string> = {
      criar: 'Novo usuário',
      editar: `Editar usuário: ${u?.nome ?? ''}`,
      senha: `Redefinir senha de: ${u?.nome ?? ''}`,
      minhaSenha: 'Alterar minha senha',
    };
    Dom.pegar('form-titulo').textContent = titulos[modo];
    Dom.pegar('f-senha-label').textContent = modo === 'criar' ? 'Senha' : 'Nova senha';

    document.querySelectorAll<HTMLElement>('[data-campo]').forEach((div) => {
      div.classList.toggle('d-none', !App.CAMPOS[modo].includes(div.dataset.campo ?? ''));
    });

    Dom.pegar<HTMLInputElement>('f-nome').value = u?.nome ?? '';
    Dom.pegar<HTMLInputElement>('f-email').value = u?.email ?? '';
    Dom.pegar<HTMLSelectElement>('f-perfil').value = u?.perfil ?? 'ATENDENTE';
    this.limparSenhas();

    Dom.pegar('painel-form').classList.remove('d-none');
  }

  private fecharForm(): void {
    this.limparSenhas();
    Dom.pegar('painel-form').classList.add('d-none');
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
      this.mostrarAlerta(r.erro, 'danger');
      return;
    }

    this.fecharForm();
    this.mostrarAlerta(sucesso, 'success');

    // Se o admin editou a si mesmo, atualiza o nome mostrado na barra.
    const s = await bridge.sessao();
    if (s.ok && s.dados) {
      this.usuarioAtual = s.dados;
      this.atualizarNav();
    }
    if (this.usuarioAtual?.perfil === 'ADMIN') await this.carregarUsuarios();
  }
}

new App();