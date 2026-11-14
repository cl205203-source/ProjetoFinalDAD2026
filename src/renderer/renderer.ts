// Interface: só conversa com o main via window.api (preload).
const bridge = (window as unknown as { api: { statusBanco(): Promise<{ ok: boolean; erro: string | null }> } }).api;

bridge.statusBanco().then((s) => {
  const el = document.querySelector('#status')!;
  el.textContent = s.ok ? 'Conectado ao MySQL com sucesso!' : `Falha na conexão: ${s.erro}`;
  el.className = s.ok ? 'text-success' : 'text-danger';
});
