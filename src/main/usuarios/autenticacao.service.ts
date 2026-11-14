// Autenticação: login, logout e criação do administrador inicial.
import { AppError } from '../compartilhado/erros';
import { Validador } from '../compartilhado/validacao';
import { HashService } from './hash.service';
import { LimitadorTentativas } from './limitador-tentativas';
import { SessaoService } from './sessao.service';
import { UsuarioPublico } from './usuario.model';
import { UsuarioRepository } from './usuario.repository';
import { EsquemasUsuario } from './usuario.schemas';

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
