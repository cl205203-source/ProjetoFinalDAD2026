// Regras de negócio de entregadores (RF07, RN04). Permissões checadas aqui, no processo main.
import { AppError } from '../compartilhado/erros';
import { ErroMysql } from '../compartilhado/mysql-erros';
import { idSchema, Validador } from '../compartilhado/validacao';
import { SessaoService } from '../usuarios/sessao.service';
import { Entregador, EntregadorPublico } from './entregador.model';
import { EntregadorRepository } from './entregador.repository';
import { EsquemasEntregador } from './entregador.schemas';

export class EntregadorService {
  constructor(
    private readonly entregadores: EntregadorRepository,
    private readonly sessao: SessaoService,
  ) {}

  /** Admin e Atendente consultam (o Atendente precisa ver quem está livre); o Atendente só vê ativos. */
  async listar(entrada: unknown): Promise<EntregadorPublico[]> {
    const usuario = this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasEntregador.filtro, entrada);
    if (!usuario.ehAdmin()) filtro.status = 'ATIVOS';
    return (await this.entregadores.listar(filtro)).map((e) => e.paraPublico());
  }

  async criar(entrada: unknown): Promise<EntregadorPublico> {
    this.sessao.exigirPerfil('ADMIN');
    const dados = Validador.parse(EsquemasEntregador.criar, entrada);
    await this.garantirCpfLivre(dados.cpf, null);
    try {
      const id = await this.entregadores.criar(dados);
      return (await this.obterOuFalhar(id)).paraPublico();
    } catch (e) {
      throw this.traduzirDuplicidade(e);
    }
  }

  async atualizar(idEntrada: unknown, entrada: unknown): Promise<EntregadorPublico> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    const dados = Validador.parse(EsquemasEntregador.atualizar, entrada);
    await this.obterOuFalhar(id);
    await this.garantirCpfLivre(dados.cpf, id);
    try {
      await this.entregadores.atualizar(id, dados);
    } catch (e) {
      throw this.traduzirDuplicidade(e);
    }
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** Troca rápida de disponibilidade (Admin e Atendente). Só entregador ativo. */
  async alterarStatus(idEntrada: unknown, entrada: unknown): Promise<EntregadorPublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    const { status } = Validador.parse(EsquemasEntregador.alterarStatus, entrada);
    const entregador = await this.obterOuFalhar(id);
    if (!entregador.ativo) throw new AppError('Entregador inativo: reative-o antes de alterar a disponibilidade.');
    await this.entregadores.definirStatus(id, status);
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** Soft delete. Entregador em rota não pode ser inativado. */
  async inativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    const entregador = await this.obterOuFalhar(id);
    if (entregador.estaEmRota()) throw new AppError('Este entregador está em rota. Finalize a entrega antes de inativá-lo.');
    await this.entregadores.definirAtivo(id, false);
  }

  async reativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    await this.entregadores.definirAtivo(id, true);
  }

  /** Exclusão física só para entregador sem entregas registradas (RN04). */
  async excluir(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    const entregador = await this.obterOuFalhar(id);
    if (entregador.estaEmRota()) throw new AppError('Este entregador está em rota e não pode ser excluído.');
    const mensagem = 'Este entregador possui entregas registradas e não pode ser excluído. Use "Inativar".';
    if (await this.entregadores.possuiVinculos(id)) throw new AppError(mensagem);
    try {
      await this.entregadores.excluir(id);
    } catch (e) {
      if (ErroMysql.ehCodigo(e, ErroMysql.REFERENCIADO_POR_FK)) throw new AppError(mensagem);
      throw e;
    }
  }

  private async obterOuFalhar(id: number): Promise<Entregador> {
    const e = await this.entregadores.buscarPorId(id);
    if (!e) throw new AppError('Entregador não encontrado.', 'NAO_ENCONTRADO');
    return e;
  }

  private async garantirCpfLivre(cpf: string, ignorarId: number | null): Promise<void> {
    if (await this.entregadores.cpfEmUso(cpf, ignorarId)) {
      throw new AppError('Já existe um entregador com este CPF.', 'CONFLITO');
    }
  }

  private traduzirDuplicidade(e: unknown): unknown {
    return ErroMysql.ehCodigo(e, ErroMysql.DUPLICADO) ? new AppError('Já existe um entregador com este CPF.', 'CONFLITO') : e;
  }
}
