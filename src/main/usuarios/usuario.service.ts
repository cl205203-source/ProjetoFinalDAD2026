// Regras de negócio de usuários (RF01, RN04). Permissões checadas aqui, no processo main.
import { AppError } from '../compartilhado/erros';
import { Validador } from '../compartilhado/validacao';
import { HashService } from './hash.service';
import { SessaoService } from './sessao.service';
import { Usuario, UsuarioPublico } from './usuario.model';
import { UsuarioRepository } from './usuario.repository';
import { EsquemasUsuario } from './usuario.schemas';

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
