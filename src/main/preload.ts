// Ponte segura entre renderer e main.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  statusBanco: (): Promise<{ ok: boolean; erro: string | null }> => ipcRenderer.invoke('db:status'),
});
