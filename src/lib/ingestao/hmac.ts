import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Confere a assinatura HMAC-SHA256 que o Meta manda no cabecalho
 * `X-Hub-Signature-256` (formato `sha256=<hex>`) contra o HMAC calculado
 * sobre `corpoCru`.
 *
 * CONTRATO COM A ROTA: `corpoCru` tem que ser exatamente o que
 * `await req.text()` devolve, a string crua da requisicao — nunca o
 * resultado de `req.json()` reserializado. Reserializar muda a ordem de
 * chave, o espacamento e os escapes de acentuacao; os bytes deixam de bater
 * com os que o Meta assinou, e a assinatura nunca mais valida. E a falha
 * classica desta integracao, e o sintoma e 401 em 100% dos webhooks
 * legitimos — nao um caso raro, o caso normal.
 */
export function assinaturaValida(
  corpoCru: string,
  cabecalho: string | null,
  appSecret: string
): boolean {
  // Falha fechado antes de qualquer calculo: uma env var nao configurada
  // (string vazia) nao pode virar webhook aberto so porque um atacante
  // manda cabecalho vazio ou um HMAC de segredo vazio.
  if (appSecret.length === 0) return false

  const PREFIXO = 'sha256='
  if (!cabecalho || !cabecalho.startsWith(PREFIXO)) return false

  const hex = cabecalho.slice(PREFIXO.length)
  // Buffer.from(hex, 'hex') NAO lanca em entrada invalida: para na primeira
  // dupla que nao e hex e devolve um buffer truncado, as vezes vazio. Um
  // cabecalho tipo 'sha256=zz...' produziria um buffer vazio aqui — e sem a
  // checagem de tamanho abaixo, esse buffer vazio poderia ser comparado (e,
  // em tese, "bater") com um digest tambem vazio por erro de logica em outro
  // lugar. O tamanho e a unica garantia real de que o hex era valido.
  const recebido = Buffer.from(hex, 'hex')
  const esperado = createHmac('sha256', appSecret).update(corpoCru, 'utf8').digest()

  // timingSafeEqual lanca se os buffers tiverem tamanhos diferentes, entao a
  // checagem de tamanho vem antes dela, nao depois.
  if (recebido.length !== esperado.length) return false

  // Nunca ===: comparacao de string/buffer por igualdade curto-circuita no
  // primeiro byte diferente, e o tempo de resposta vaza quantos bytes do
  // segredo um atacante acertou. timingSafeEqual compara em tempo constante.
  return timingSafeEqual(recebido, esperado)
}
