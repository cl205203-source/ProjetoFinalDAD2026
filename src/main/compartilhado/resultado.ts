// Formato padrão das respostas IPC (main -> renderer).
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };
