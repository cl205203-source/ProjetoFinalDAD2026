// Casca da interface: login, navegação por abas e ligação entre as telas.
// Só conversa com o main via window.api (preload).

type Aba = 'produtos' | 'estoque' | 'clientes' | 'entregadores' | 'usuarios';

class App {
  private static readonly ABAS: Aba[] = ['produtos', 'estoque', 'clientes', 'entregadores', 'usuarios'];

  private usuarioAtual: UsuarioDTO | null = null;

  private readonly usuarios = new UsuariosTela((u) => this.definirUsuario(u));
  private readonly produtos = new ProdutosTela((p) => void this.movimentar(p));
  private readonly estoque = new EstoqueTela();
  private readonly clientes = new ClientesTela();
  private readonly entregadores = new EntregadoresTela();

  constructor() {
    Dom.pegar<HTMLFormElement>('form-login').addEventListener('submit', (e) => void this.aoLogar(e));
    Dom.pegar('btn-sair').addEventListener('click', () => void this.aoSair());
    Dom.pegar('btn-minha-senha').addEventListener('click', () => {
      if (this.usuarioAtual) this.usuarios.abrirMinhaSenha(this.usuarioAtual);
    });
    document.querySelectorAll<HTMLElement>('[data-aba]').forEach((b) => {
      b.addEventListener('click', () => void this.abrirAba(b.dataset.aba as Aba));
    });
    void this.iniciar();
  }

  // ---------- Inicialização / login ----------
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
    this.usuarios.limpar();
    this.produtos.limpar();
    this.estoque.limpar();
    this.clientes.limpar();
    this.entregadores.limpar();
    Aviso.limpar();
    Dom.pegar('tela-app').classList.add('d-none');
    Dom.pegar('tela-login').classList.remove('d-none');
    Dom.pegar<HTMLInputElement>('login-email').value = '';
  }

  // ---------- Telas ----------
  private definirUsuario(u: UsuarioDTO): void {
    this.usuarioAtual = u;
    this.atualizarNav();
  }

  private atualizarNav(): void {
    const u = this.usuarioAtual;
    if (!u) return;
    Dom.pegar('nav-usuario').textContent = `${u.nome} (${u.perfil === 'ADMIN' ? 'Administrador' : 'Atendente'})`;
  }

  private async mostrarApp(): Promise<void> {
    Dom.pegar('tela-login').classList.add('d-none');
    Dom.pegar('tela-app').classList.remove('d-none');
    this.atualizarNav();

    // Aba de usuários: exclusiva do Administrador.
    Dom.pegar('item-aba-usuarios').classList.toggle('d-none', this.usuarioAtual?.perfil !== 'ADMIN');
    await this.abrirAba('produtos');
  }

  private async abrirAba(aba: Aba): Promise<void> {
    const u = this.usuarioAtual;
    if (!u) return;
    Aviso.limpar();
    this.usuarios.fecharForm();
    this.produtos.fecharForm();
    this.clientes.fecharForm();
    this.entregadores.fecharForm();

    document.querySelectorAll<HTMLElement>('[data-aba]').forEach((b) => {
      b.classList.toggle('active', b.dataset.aba === aba);
    });
    for (const a of App.ABAS) {
      Dom.pegar(`secao-${a}`).classList.toggle('d-none', a !== aba);
    }

    if (aba === 'produtos') await this.produtos.ativar(u);
    if (aba === 'estoque') await this.estoque.ativar(u);
    if (aba === 'clientes') await this.clientes.ativar(u);
    if (aba === 'entregadores') await this.entregadores.ativar(u);
    if (aba === 'usuarios' && u.perfil === 'ADMIN') await this.usuarios.ativar(u);
  }

  private async movimentar(p: ProdutoDTO): Promise<void> {
    await this.abrirAba('estoque');
    this.estoque.selecionar(p.id);
  }
}

new App();
