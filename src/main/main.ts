// Processo principal: carrega o .env, testa o MySQL e abre a janela segura.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

import { Database } from './database';

async function iniciar() {
  const db = new Database();
  let erroBanco: string | null = null;
  try {
    await db.testarConexao();
  } catch (e) {
    erroBanco = (e as Error).message;
    dialog.showErrorBox('Erro de conexão com o banco', `Verifique o arquivo .env.\n\n${erroBanco}`);
  }

  ipcMain.handle('db:status', () => ({ ok: erroBanco === null, erro: erroBanco }));

  const janela = new BrowserWindow({
    width: 1000, height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.loadFile(path.join(__dirname, '../../src/renderer/index.html'));
}

app.whenReady().then(iniciar);
app.on('window-all-closed', () => app.quit());
