// Canais IPC de produtos (produtos:*).
import { ControllerBase } from '../compartilhado/controller-base';
import { ProdutoService } from './produto.service';

export class ProdutoController extends ControllerBase {
  constructor(private readonly produtos: ProdutoService) {
    super();
  }

  registrar(): void {
    this.rota('produtos:listar', (filtro) => this.produtos.listar(filtro));
    this.rota('produtos:criar', (dados) => this.produtos.criar(dados));
    this.rota('produtos:atualizar', (id, dados) => this.produtos.atualizar(id, dados));
    this.rota('produtos:inativar', (id) => this.produtos.inativar(id));
    this.rota('produtos:reativar', (id) => this.produtos.reativar(id));
    this.rota('produtos:excluir', (id) => this.produtos.excluir(id));
  }
}
