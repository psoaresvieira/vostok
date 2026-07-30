import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Cookie do state anti-CSRF, vivo so entre o iniciar e o retorno. */
export const COOKIE_ESTADO = 'meta_oauth_state'

/**
 * Cookie com o token de USUARIO de longa duracao, entre o retorno e a escolha
 * da Page. Nunca guarda token de pagina: esse e buscado no servidor no momento
 * de conectar e vai direto para o banco.
 */
export const COOKIE_TOKEN = 'meta_oauth_token'

export function gerarEstado(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Comparacao em tempo constante. O state e um segredo de curta duracao, e
 * comparar com === vaza o prefixo correto pelo tempo de resposta.
 *
 * Vazio recusa de proposito: `conferirEstado('', '')` seria "igual" e abriria a
 * porta para o caso em que o cookie foi perdido e a URL veio com state vazio.
 */
export function conferirEstado(doCookie: string | undefined, daUrl: string | null): boolean {
  if (!doCookie || !daUrl) return false
  const a = Buffer.from(doCookie)
  const b = Buffer.from(daUrl)
  // timingSafeEqual exige mesmo tamanho; comparar antes nao vaza nada util,
  // porque o tamanho do state e publico e fixo.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
