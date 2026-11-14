// Processo principal: carrega o .env, testa o MySQL, monta as camadas e abre a janela segura.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

import { Database } from './database';
import { UsuarioRepository } from './repositories';
import { AutenticacaoService, HashService, SessaoService, UsuarioService } from './services';
import { UsuarioController } from './controllers';

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
  const autenticacao = new AutenticacaoService(usuarioRepo, sessao, hash);
  const usuarios = new UsuarioService(usuarioRepo, sessao, hash);

  if (erroBanco === null) {
    try {
      const criou = await autenticacao.garantirAdminInicial();
      if (criou) console.log('Administrador inicial criado a partir do .env.');
    } catch (e) {
      dialog.showErrorBox('Administrador inicial', (e as Error).message);
    }
  }

  new UsuarioController(autenticacao, usuarios, sessao).registrar();
  ipcMain.handle('db:status', () => ({ ok: erroBanco === null, erro: erroBanco }));

  const janela = new BrowserWindow({
    width: 1100, height: 750,
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