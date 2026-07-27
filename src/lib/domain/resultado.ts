export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; erro: string }

export function ok<T>(valor: T): Resultado<T> {
  return { ok: true, valor }
}

export function falha<T>(erro: string): Resultado<T> {
  return { ok: false, erro }
}
