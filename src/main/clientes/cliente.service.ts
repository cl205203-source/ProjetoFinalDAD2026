// Regras de negócio de clientes (RF05, RF06, RN04). Permissões checadas aqui, no processo main.
import { AppError } from '../compartilhado/erros';
import { ErroMysql } from '../compartilhado/mysql-erros';
import { idSchema, Validador } from '../compartilhado/validacao';
import { CepApi, DistanciaApi, EnderecoCep } from '../integrations';
import { SessaoService } from '../usuarios/sessao.service';
import { Cliente, ClientePublico } from './cliente.model';
import { ClienteRepository, DadosCliente } from './cliente.repository';
import { EsquemasCliente } from './cliente.schemas';

/** Resultado da consulta de CEP: endereço + distância aproximada até a loja. */
export interface EnderecoConsultado extends EnderecoCep {
  distanciaKm: number | null;
}

export class ClienteService {
  constructor(
    private readonly clientes: ClienteRepository,
    private readonly sessao: SessaoService,
    private readonly cepApi: CepApi,
    private readonly distanciaApi: DistanciaApi,
  ) {}

  /** Admin e Atendente consultam; o Atendente só enxerga clientes ativos. */
  async listar(entrada: unknown): Promise<ClientePublico[]> {
    const usuario = this.sessao.exigirLogado();
    const filtro = Validador.parse(EsquemasCliente.filtro, entrada);
    if (!usuario.ehAdmin()) filtro.status = 'ATIVOS';
    return (await this.clientes.listar(filtro)).map((c) => c.paraPublico());
  }

  /** [RF06] / [RF09]: preenche o endereço pelo CEP e calcula a distância aproximada até a loja. */
  async consultarCep(entrada: unknown): Promise<EnderecoConsultado> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const cep = Validador.parse(EsquemasCliente.cep, entrada);
    const endereco = await this.cepApi.consultar(cep);
    // [RF09] Calcula distância com os campos completos retornados pela consulta de CEP
    const distanciaKm = await this.distanciaApi.calcularKm({
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      uf: endereco.uf,
      cep: endereco.cep,
    });
    return { ...endereco, distanciaKm };
  }

  async criar(entrada: unknown): Promise<ClientePublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const dados = Validador.parse(EsquemasCliente.criar, entrada);
    await this.garantirCpfLivre(dados.cpf, null);

    // [RF09] A distância é sempre recalculada aqui com os dados completos de endereço
    const distanciaKm = await this.distanciaApi.calcularKm({
      logradouro: dados.logradouro,
      numero: dados.numero,
      bairro: dados.bairro,
      cidade: dados.cidade,
      uf: dados.uf,
      cep: dados.cep,
    });
    try {
      const id = await this.clientes.criar(dados, distanciaKm);
      return (await this.obterOuFalhar(id)).paraPublico();
    } catch (e) {
      throw this.traduzirDuplicidade(e);
    }
  }

  async atualizar(idEntrada: unknown, entrada: unknown): Promise<ClientePublico> {
    this.sessao.exigirPerfil('ADMIN', 'ATENDENTE');
    const id = Validador.parse(idSchema, idEntrada);
    const dados = Validador.parse(EsquemasCliente.atualizar, entrada);
    const atual = await this.obterOuFalhar(id);
    await this.garantirCpfLivre(dados.cpf, id);

    // [RF09] Só consulta a API de novo se o endereço mudou ou se a distância nunca foi calculada.
    const distanciaKm =
      atual.mudouEndereco(dados) || atual.distanciaKm === null
        ? await this.distanciaApi.calcularKm({
            logradouro: dados.logradouro,
            numero: dados.numero,
            bairro: dados.bairro,
            cidade: dados.cidade,
            uf: dados.uf,
            cep: dados.cep,
          })
        : atual.distanciaKm;

    try {
      await this.clientes.atualizar(id, dados as DadosCliente, distanciaKm);
    } catch (e) {
      throw this.traduzirDuplicidade(e);
    }
    return (await this.obterOuFalhar(id)).paraPublico();
  }

  /** Soft delete. */
  async inativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    await this.clientes.definirAtivo(id, false);
  }

  async reativar(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    await this.clientes.definirAtivo(id, true);
  }

  /** Exclusão física só para cliente sem pedidos (RN04). */
  async excluir(idEntrada: unknown): Promise<void> {
    this.sessao.exigirPerfil('ADMIN');
    const id = Validador.parse(idSchema, idEntrada);
    await this.obterOuFalhar(id);
    const mensagem = 'Este cliente possui pedidos e não pode ser excluído. Use "Inativar".';
    if (await this.clientes.possuiVinculos(id)) throw new AppError(mensagem);
    try {
      await this.clientes.excluir(id);
    } catch (e) {
      if (ErroMysql.ehCodigo(e, ErroMysql.REFERENCIADO_POR_FK)) throw new AppError(mensagem);
      throw e;
    }
  }

  private async obterOuFalhar(id: number): Promise<Cliente> {
    const c = await this.clientes.buscarPorId(id);
    if (!c) throw new AppError('Cliente não encontrado.', 'NAO_ENCONTRADO');
    return c;
  }

  private async garantirCpfLivre(cpf: string, ignorarId: number | null): Promise<void> {
    if (await this.clientes.cpfEmUso(cpf, ignorarId)) {
      throw new AppError('Já existe um cliente com este CPF.', 'CONFLITO');
    }
  }

  /** Backstop da chave única (duas gravações simultâneas com o mesmo CPF). */
  private traduzirDuplicidade(e: unknown): unknown {
    return ErroMysql.ehCodigo(e, ErroMysql.DUPLICADO) ? new AppError('Já existe um cliente com este CPF.', 'CONFLITO') : e;
  }
}
