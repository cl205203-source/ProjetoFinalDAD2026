// Services: regras de negócio (RN01-RN04), autenticação e validação
import bcrypt from 'bcryptjs';
import { UsuarioRepository } from './repositories';
import { AppError, EsquemasUsuario, PerfilUsuario, Usuario, UsuarioPublico, Validador } from './models';

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