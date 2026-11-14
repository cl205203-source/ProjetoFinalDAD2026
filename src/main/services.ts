// Services: regras de negócio (RN01-RN04), autenticação e validação
import bcrypt from 'bcryptjs';
import { PoolConnection } from 'mysql2/promise';
import { Database } from './database';
import { MovimentacaoRepository, ProdutoRepository, UsuarioRepository } from './repositories';
import {
  AppError, EsquemasEstoque, EsquemasProduto, EsquemasUsuario, ItemEstoque, MovimentacaoPublica,
  PerfilUsuario, Produto, ProdutoPublico, Usuario, UsuarioPublico, Validador,
} from './models';

/** Hash de senha (bcrypt com sal aleatório embutido). */
export class HashService {
  private static readonly CUSTO = 12;

  gerar(senha: string): Promise<string> {
    return bcrypt.hash(senha, HashService.CUSTO);
  }

  comparar(senha: string, hash: string): Promise<boolean> {
    return bcrypt.compare(senha, hash);
  }
}

/** Guarda quem está logado (processo main) e centraliza a checagem de permissões. */
export class SessaoService {
  private atual: Usuario | null = null;

  iniciar(usuario: Usuario): void {
    this.atual = usuario;
  }

  encerrar(): void {
    this.atual = null;
  }

  obter(): Usuario | null {
    return this.atual;
  }

  exigirLogado(): Usuario {
    if (!this.atual) throw new AppError('Faça login para continuar.', 'NAO_AUTENTICADO');
    return this.atual;
  }

  exigirPerfil(...perfis: PerfilUsuario[]): Usuario {
    const u = this.exigirLogado();
    if (!perfis.includes(u.perfil)) {
      throw new AppError('Você não tem permissão para realizar esta ação.', 'SEM_PERMISSAO');
    }
    return u;
  }
}

/** Limita tentativas de login por e-mail (proteção básica contra força bruta). */
class LimitadorTentativas {
  private static readonly MAX_FALHAS = 5;
  private static readonly BLOQUEIO_MS = 5 * 60 * 1000;
  private readonly registros = new Map<string, { falhas: number; bloqueadoAte: number }>();

  segundosBloqueado(chave: string): number {
    const r = this.registros.get(chave);
    if (!r || r.bloqueadoAte <= Date.now()) return 0;
    return Math.ceil((r.bloqueadoAte - Date.now()) / 1000);
  }

  registrarFalha(chave: string): void {
    const r = this.registros.get(chave) ?? { falhas: 0, bloqueadoAte: 0 };
    r.falhas += 1;
    if (r.falhas >= LimitadorTentativas.MAX_FALHAS) {
      r.bloqueadoAte = Date.now() + LimitadorTentativas.BLOQUEIO_MS;
      r.falhas = 0;
    }
    this.registros.set(chave, r);
  }

  limpar(chave: string): void {
    this.registros.delete(chave);
  }
}

export class AutenticacaoService {
  private readonly limitador = new LimitadorTentativas();
  // Hash falso: faz o login de e-mail inexistente gastar o mesmo tempo que um e-mail válido.
  private hashFalso: Promise<string> | null = null;

  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly sessao: SessaoService,
    private readonly hash: HashService,
  ) {}

  async login(entrada: unknown): Promise<UsuarioPublico> {
    const { email, senha } = Validador.parse(EsquemasUsuario.login, entrada);

    const espera = this.limitador.segundosBloqueado(email);
    if (espera > 0) {
      throw new AppError(`Muitas tentativas. Tente novamente em ${Math.ceil(espera / 60)} minuto(s).`);
    }

    const cred = await this.usuarios.buscarCredencialPorEmail(email);
    this.hashFalso ??= this.hash.gerar('senha-inexistente');
    const hash = cred?.senhaHash ?? (await this.hashFalso);
    const senhaOk = await this.hash.comparar(senha, hash);

    // Mensagem única: não revela se o e-mail existe, se a senha errou ou se o usuário está inativo.
    if (!cred || !senhaOk || !cred.usuario.ativo) {
      this.limitador.registrarFalha(email);
      throw new AppError('E-mail ou senha inválidos.', 'NAO_AUTENTICADO');
    }

    this.limitador.limpar(email);
    this.sessao.iniciar(cred.usuario);
    return cred.usuario.paraPublico();
  }

  logout(): void {
    this.sessao.encerrar();
  }

  /** Primeiro uso: se não existe nenhum usuário, cria o ADMIN a partir do .env. */
  async garantirAdminInicial(): Promise<boolean> {
    if ((await this.usuarios.contar()) > 0) return false;

    const email = process.env.ADMIN_EMAIL;
    const senha = process.env.ADMIN_SENHA;
    if (!email || !senha) {
      throw new AppError('Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA no arquivo .env.');
    }

    const dados = Validador.parse(EsquemasUsuario.criar, { nome: 'Administrador', email, senha, perfil: 'ADMIN' });
    await this.usuarios.criar({
      nome: dados.nome,
      email: dados.email,
      senhaHash: await this.hash.gerar(dados.senha),
      perfil: 'ADMIN',
    });
    return true;
  }
}

export class UsuarioService {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly sessao: SessaoService,
    private readonly hash: HashService,
  ) {}

  async listar(): Promise<UsuarioPublico[]> {
    this.sessao.exigirPerfil('ADMIN');
    return (await this.usuarios.listar()).map((u) => u.paraPublico());
  }

  async criar(entrada: unknown): Promise<UsuarioPublico> {
    this.sessao.exigirPerfil('ADMIN');
    const dados = Validador.parse(EsquemasUsuario.criar, entrada);

    if (await this.usuarios.emailEmUso(dados.email)) {
      throw new AppError('Já existe um usuário com este e-mail.', 'CONFLITO');
    }

    const id = await this.usuarios.criar({
      nome: dados.nome,
      email: dados.email,
      senhaHash: await this.hash.gerar(dados.senha),
      perfil: dados.perfil,
    });
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  async atualizar(idEntrada: unknown, entrada: unknown): Promise<UsuarioPublico> {
    const logado = this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    const dados = Validador.parse(EsquemasUsuario.atualizar, entrada);
    const alvo = await this.obterOuFalhar(id);

    if (await this.usuarios.emailEmUso(dados.email, id)) {
      throw new AppError('Já existe um usuário com este e-mail.', 'CONFLITO');
    }

    if (alvo.perfil === 'ADMIN' && dados.perfil !== 'ADMIN') {
      if (id === logado.id) throw new AppError('Você não pode rebaixar o seu próprio perfil.');
      await this.garantirOutroAdminAtivo(alvo);
    }

    await this.usuarios.atualizar(id, dados);

    const atualizado = await this.obterOuFalhar(id);
    if (id === logado.id) this.sessao.iniciar(atualizado);
    return atualizado.paraPublico();
  }

  /** Admin define uma nova senha para outro usuário. */
  async redefinirSenha(idEntrada: unknown, entrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    const { novaSenha } = Validador.parse(EsquemasUsuario.redefinirSenha, entrada);
    await this.obterOuFalhar(id);
    await this.usuarios.atualizarSenha(id, await this.hash.gerar(novaSenha));
  }

  /** Qualquer usuário logado troca a própria senha (precisa da senha atual). */
  async alterarPropriaSenha(entrada: unknown): Promise<void> {
    const logado = this.sessao.exigirLogado();
    const { senhaAtual, novaSenha } = Validador.parse(EsquemasUsuario.alterarPropriaSenha, entrada);

    const hashAtual = await this.usuarios.buscarSenhaHashPorId(logado.id);
    if (!hashAtual || !(await this.hash.comparar(senhaAtual, hashAtual))) {
      throw new AppError('A senha atual está incorreta.', 'VALIDACAO');
    }
    await this.usuarios.atualizarSenha(logado.id, await this.hash.gerar(novaSenha));
  }

  /** Soft delete. */
  async inativar(idEntrada: unknown): Promise<void> {
    const logado = this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    if (id === logado.id) throw new AppError('Você não pode inativar o seu próprio usuário.');

    const alvo = await this.obterOuFalhar(id);
    await this.garantirOutroAdminAtivo(alvo);
    await this.usuarios.definirAtivo(id, false);
  }

  async reativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    await this.obterOuFalhar(id);
    await this.usuarios.definirAtivo(id, true);
  }

  /** Exclusão física só é permitida se o usuário não tiver histórico (RN04). */
  async excluir(idEntrada: unknown): Promise<void> {
    const logado = this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    if (id === logado.id) throw new AppError('Você não pode excluir o seu próprio usuário.');

    const alvo = await this.obterOuFalhar(id);
    await this.garantirOutroAdminAtivo(alvo);

    if (await this.usuarios.possuiVinculos(id)) {
      throw new AppError('Este usuário possui pedidos/movimentações registrados e não pode ser excluído. Use "Inativar".');
    }
    await this.usuarios.excluir(id);
  }

  private async obterOuFalhar(id: number): Promise<Usuario> {
    const u = await this.usuarios.buscarPorId(id);
    if (!u) throw new AppError('Usuário não encontrado.', 'NAO_ENCONTRADO');
    return u;
  }

  /** Impede ficar sem nenhum administrador ativo no sistema. */
  private async garantirOutroAdminAtivo(alvo: Usuario): Promise<void> {
    if (alvo.ehAdmin() && alvo.ativo && (await this.usuarios.contarAdminsAtivos()) <= 1) {
      throw new AppError('O sistema precisa de ao menos um administrador ativo.');
    }
  }
}


// ===================== RF02-RF04: Produtos e Estoque =====================
export class ProdutoService {
  constructor(
    private readonly produtos: ProdutoRepository,
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly sessao: SessaoService,
    private readonly db: Database,
  ) {}

  /** Admin e Atendente consultam; o Atendente só enxerga produtos ativos. */
  async listar(entrada: unknown): Promise<ProdutoPublico[]> {
    const usuario = this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasProduto.filtro, entrada);
    if (!usuario.ehAdmin()) filtro.status = 'ATIVOS';
    return (await this.produtos.listar(filtro)).map((p) => p.paraPublico());
  }

  async criar(entrada: unknown): Promise<ProdutoPublico> {
    const usuario = this.sessao.exigirPerfil('ADMIN');
    const dados = Validador.parse(EsquemasProduto.criar, entrada);

    const id = await this.db.transacao(async (conn) => {
      const novoId = await this.produtos.criar(dados, dados.estoqueAtual, conn);
      if (dados.estoqueAtual > 0) {
        await this.movimentacoes.registrar(
          {
            produtoId: novoId,
            pedidoId: null,
            usuarioId: usuario.id,
            tipo: 'ENTRADA',
            quantidade: dados.estoqueAtual,
            observacao: 'Estoque inicial (cadastro do produto)',
          },
          conn,
        );
      }
      return novoId;
    });
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  async atualizar(idEntrada: unknown, entrada: unknown): Promise<ProdutoPublico> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    const dados = Validador.parse(EsquemasProduto.atualizar, entrada);
    await this.obterOuFalhar(id);
    await this.produtos.atualizar(id, dados);
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** Soft delete. */
  async inativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    await this.obterOuFalhar(id);
    await this.produtos.definirAtivo(id, false);
  }

  async reativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    await this.obterOuFalhar(id);
    await this.produtos.definirAtivo(id, true);
  }

  /** Exclusão física só para produto sem histórico (RN04). */
  async excluir(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(EsquemasUsuario.id, idEntrada);
    await this.obterOuFalhar(id);
    if (await this.produtos.possuiVinculos(id)) {
      throw new AppError('Este produto possui pedidos ou movimentações de estoque e não pode ser excluído. Use "Inativar".');
    }
    await this.produtos.excluir(id);
  }

  private async obterOuFalhar(id: number): Promise<Produto> {
    const p = await this.produtos.buscarPorId(id);
    if (!p) throw new AppError('Produto não encontrado.', 'NAO_ENCONTRADO');
    return p;
  }
}

export class EstoqueService {
  constructor(
    private readonly produtos: ProdutoRepository,
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly sessao: SessaoService,
    private readonly db: Database,
  ) {}

  /** RF04: entrada (Admin/Atendente) ou ajuste manual (só Admin), sempre com histórico. */
  async registrarMovimentacao(entrada: unknown): Promise<ProdutoPublico> {
    const usuario = this.sessao.exigirLogado();
    const dados = Validador.parse(EsquemasEstoque.movimentacao, entrada);

    if (dados.tipo !== 'ENTRADA' && !usuario.ehAdmin()) {
      throw new AppError('Somente o Administrador pode fazer ajustes manuais de estoque.', 'SEM_PERMISSAO');
    }

    await this.db.transacao(async (conn) => {
      const produto = await this.produtos.buscarPorId(dados.produtoId, conn);
      if (!produto) throw new AppError('Produto não encontrado.', 'NAO_ENCONTRADO');
      if (!produto.ativo) throw new AppError('Produto inativo. Reative-o antes de movimentar o estoque.');

      const delta = dados.tipo === 'AJUSTE_NEGATIVO' ? -dados.quantidade : dados.quantidade;
      if (!(await this.produtos.ajustarEstoque(dados.produtoId, delta, conn))) {
        throw new AppError(
          `Saldo insuficiente: "${produto.nome}" tem ${produto.estoqueAtual} unidade(s) e a baixa é de ${dados.quantidade}.`,
        );
      }
      await this.movimentacoes.registrar(
        {
          produtoId: dados.produtoId,
          pedidoId: null,
          usuarioId: usuario.id,
          tipo: dados.tipo,
          quantidade: dados.quantidade,
          observacao: dados.observacao,
        },
        conn,
      );
    });

    const atualizado = await this.produtos.buscarPorId(dados.produtoId);
    return atualizado!.paraPublico();
  }

  async listarHistorico(entrada: unknown): Promise<MovimentacaoPublica[]> {
    this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasEstoque.historico, entrada);
    return (await this.movimentacoes.listar(filtro.produtoId ?? null, filtro.limite)).map((m) => m.paraPublico());
  }

  /**
   * RF03/RN01: valida se há saldo para os itens (só leitura, para dar feedback na tela).
   * Ao editar um pedido, informe o pedidoId: o que já foi baixado para ele conta como disponível.
   */
  async validarDisponibilidade(entrada: unknown): Promise<void> {
    this.sessao.exigirLogado();
    const { itens, pedidoId } = Validador.parse(EsquemasEstoque.disponibilidade, entrada);
    const jaBaixado = pedidoId
      ? await this.movimentacoes.saldoBaixadoPorPedido(pedidoId)
      : new Map<number, number>();

    const problemas: string[] = [];
    for (const [produtoId, qtd] of EstoqueService.consolidar(itens)) {
      const p = await this.produtos.buscarPorId(produtoId);
      if (!p) {
        problemas.push(`Produto #${produtoId} não encontrado.`);
        continue;
      }
      if (!p.ativo) {
        problemas.push(`"${p.nome}" está inativo.`);
        continue;
      }
      const disponivel = p.estoqueAtual + (jaBaixado.get(produtoId) ?? 0);
      if (qtd > disponivel) {
        problemas.push(`Estoque insuficiente para "${p.nome}": disponível ${disponivel}, solicitado ${qtd}.`);
      }
    }
    if (problemas.length) throw new AppError(problemas.join(' '));
  }

  /**
   * RF03: alinha o estoque baixado ao que o pedido precisa AGORA.
   * - Confirmar pedido:  sincronizarPedido(conn, id, itens)  -> baixa (SAIDA)
   * - Editar pedido:     sincronizarPedido(conn, id, novosItens) -> baixa/estorna só a diferença
   * - Cancelar pedido:   estornarPedido(conn, id)             -> devolve tudo (ESTORNO)
   * Deve ser chamado DENTRO da transação do pedido (por isso recebe a conexão).
   * Repetir a chamada com os mesmos dados não gera movimentações duplicadas.
   */
  async sincronizarPedido(conn: PoolConnection, pedidoId: number, itensEntrada: ItemEstoque[]): Promise<void> {
    const usuario = this.sessao.exigirLogado();
    const desejado = EstoqueService.consolidar(Validador.parse(EsquemasEstoque.itens, itensEntrada));
    const baixado = await this.movimentacoes.saldoBaixadoPorPedido(pedidoId, conn);

    // Ordem fixa de ids evita deadlock entre transações concorrentes.
    const ids = [...new Set([...desejado.keys(), ...baixado.keys()])].sort((a, b) => a - b);

    for (const produtoId of ids) {
      const delta = (desejado.get(produtoId) ?? 0) - (baixado.get(produtoId) ?? 0);
      if (delta === 0) continue;

      const produto = await this.produtos.buscarPorId(produtoId, conn);
      if (!produto) throw new AppError(`Produto #${produtoId} não encontrado.`, 'NAO_ENCONTRADO');

      if (delta > 0) {
        if (!produto.ativo) throw new AppError(`"${produto.nome}" está inativo e não pode ser vendido.`);
        if (!(await this.produtos.ajustarEstoque(produtoId, -delta, conn))) {
          throw new AppError(
            `Estoque insuficiente para "${produto.nome}": disponível ${produto.estoqueAtual}, necessário ${delta}.`,
          );
        }
        await this.movimentacoes.registrar(
          { produtoId, pedidoId, usuarioId: usuario.id, tipo: 'SAIDA', quantidade: delta, observacao: `Baixa automática - pedido #${pedidoId}` },
          conn,
        );
      } else {
        await this.produtos.ajustarEstoque(produtoId, -delta, conn);
        await this.movimentacoes.registrar(
          { produtoId, pedidoId, usuarioId: usuario.id, tipo: 'ESTORNO', quantidade: -delta, observacao: `Estorno - pedido #${pedidoId}` },
          conn,
        );
      }
    }
  }

  /** Cancelamento: devolve ao estoque tudo que foi baixado para o pedido. */
  estornarPedido(conn: PoolConnection, pedidoId: number): Promise<void> {
    return this.sincronizarPedido(conn, pedidoId, []);
  }

  /** Soma quantidades de linhas repetidas do mesmo produto. */
  private static consolidar(itens: ItemEstoque[]): Map<number, number> {
    const mapa = new Map<number, number>();
    for (const i of itens) mapa.set(i.produtoId, (mapa.get(i.produtoId) ?? 0) + i.quantidade);
    return mapa;
  }
}