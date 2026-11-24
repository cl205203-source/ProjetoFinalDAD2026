// Processo principal: carrega o .env, testa o MySQL, monta as camadas e abre a janela segura.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

import { Database } from './compartilhado/database';
import { AutenticacaoController } from './usuarios/autenticacao.controller';
import { AutenticacaoService } from './usuarios/autenticacao.service';
import { HashService } from './usuarios/hash.service';
import { SessaoService } from './usuarios/sessao.service';
import { UsuarioController } from './usuarios/usuario.controller';
import { UsuarioRepository } from './usuarios/usuario.repository';
import { UsuarioService } from './usuarios/usuario.service';
import { ProdutoController } from './produtos/produto.controller';
import { ProdutoRepository } from './produtos/produto.repository';
import { ProdutoService } from './produtos/produto.service';
import { EstoqueController } from './estoque/estoque.controller';
import { EstoqueService } from './estoque/estoque.service';
import { MovimentacaoRepository } from './estoque/movimentacao.repository';
import { ClienteController } from './clientes/cliente.controller';
import { ClienteRepository } from './clientes/cliente.repository';
import { ClienteService } from './clientes/cliente.service';
import { EntregadorController } from './entregadores/entregador.controller';
import { EntregadorRepository } from './entregadores/entregador.repository';
import { EntregadorService } from './entregadores/entregador.service';
import { PedidoController } from './pedidos/pedido.controller';
import { PedidoRepository } from './pedidos/pedido.repository';
import { PedidoService } from './pedidos/pedido.service';
import { CotacaoController } from './cotacao/cotacao.controller';
import { CepApi, CotacaoApi, DistanciaApi, EmailApi } from './integrations';
import { ConfirmacaoPedidoEmailService } from './entregas/confirmacao-email.service';
import { EntregaController } from './entregas/entrega.controller';
import { EntregaRepository } from './entregas/entrega.repository';
import { EntregaService } from './entregas/entrega.service';
import { TaxaEntregaService } from './entregas/taxa-entrega.service';

async function iniciar() {
  const db = new Database();
  let erroBanco: string | null = null;
  try {
    await db.testarConexao();
  } catch (e) {
    erroBanco = (e as Error).message;
    dialog.showErrorBox('Erro de conexão com o banco', `Verifique o arquivo .env.\n\n${erroBanco}`);
  }

  // Composição das camadas (injeção de dependências manual)
  const hash = new HashService();
  const sessao = new SessaoService();

  const usuarioRepo = new UsuarioRepository(db.pool);
  const produtoRepo = new ProdutoRepository(db.pool);
  const movimentacaoRepo = new MovimentacaoRepository(db.pool);
  const clienteRepo = new ClienteRepository(db.pool);
  const entregadorRepo = new EntregadorRepository(db.pool);
  const pedidoRepo = new PedidoRepository(db.pool);
  const entregaRepo = new EntregaRepository(db.pool);
  const cepApi = new CepApi();
  const distanciaApi = new DistanciaApi(cepApi);
  const cotacaoApi = new CotacaoApi();
  const emailApi = new EmailApi();
  // RF09: taxa calculada no main; RF11: confirmação por e-mail após o commit do pedido.
  const taxaEntrega = new TaxaEntregaService(clienteRepo, distanciaApi);
  const confirmacaoEmail = new ConfirmacaoPedidoEmailService(clienteRepo, emailApi);

  const autenticacao = new AutenticacaoService(usuarioRepo, sessao, hash);
  const usuarios = new UsuarioService(usuarioRepo, sessao, hash);
  const produtos = new ProdutoService(produtoRepo, movimentacaoRepo, sessao, db);
  const estoque = new EstoqueService(produtoRepo, movimentacaoRepo, sessao, db);
  const clientes = new ClienteService(clienteRepo, sessao, cepApi, distanciaApi);
  const entregadores = new EntregadorService(entregadorRepo, sessao);
  const pedidos = new PedidoService(pedidoRepo, estoque, db, sessao, taxaEntrega, confirmacaoEmail, entregadorRepo);
  // RF10: central de entregas (painel, vínculo e ciclo de vida).
  const entregas = new EntregaService(entregaRepo, pedidoRepo, entregadorRepo, pedidos, taxaEntrega, sessao, db);

  if (erroBanco === null) {
    try {
      const criou = await autenticacao.garantirAdminInicial();
      if (criou) console.log('Administrador inicial criado a partir do .env.');
    } catch (e) {
      dialog.showErrorBox('Administrador inicial', (e as Error).message);
    }
  }

  new AutenticacaoController(autenticacao, sessao).registrar();
  new UsuarioController(usuarios).registrar();
  new ProdutoController(produtos).registrar();
  new EstoqueController(estoque).registrar();
  new ClienteController(clientes).registrar();
  new EntregadorController(entregadores).registrar();
  new PedidoController(pedidos).registrar();
  new EntregaController(entregas).registrar();
  new CotacaoController(cotacaoApi).registrar();
  ipcMain.handle('db:status', () => ({ ok: erroBanco === null, erro: erroBanco }));

  const janela = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.loadFile(path.join(__dirname, '../../src/renderer/index.html'));
}

app.whenReady().then(iniciar);
app.on('window-all-closed', () => app.quit());
