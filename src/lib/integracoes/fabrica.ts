import type { MetaGraph } from './meta'
import { MetaGraphFalso } from './meta-falso'
import { MetaGraphReal } from './meta-real'

let falsoCompartilhado: MetaGraphFalso | null = null

/**
 * Instancia unica do falso no processo. O E2E precisa que a Page "inscrita" num
 * request continue inscrita no request seguinte — com uma instancia nova por
 * chamada, `assinadas` nasceria vazia toda vez.
 */
export function metaFalso(): MetaGraphFalso {
  if (!falsoCompartilhado) falsoCompartilhado = new MetaGraphFalso()
  return falsoCompartilhado
}

/**
 * META_FAKE=1 vale em teste e so em teste, e quem garante isso e o codigo, nao
 * um humano conferindo painel. A falsa aceita qualquer credencial em silencio:
 * se ela subisse em producao por variavel mal configurada, o CRM nao daria erro
 * nenhum — so passaria a confiar em token que nunca foi validado pelo Meta.
 * Trocar um check humano por invariante custa uma linha.
 *
 * `NODE_ENV !== 'production'` nao atrapalha nada que precisamos: o E2E sobe o
 * app por `npm run dev`, e em preview a gente quer o Graph real de proposito,
 * porque preview e onde a verificacao manual contra o provedor acontece.
 */
export function usarFalso(): boolean {
  return process.env.META_FAKE === '1' && process.env.NODE_ENV !== 'production'
}

export function metaGraph(): MetaGraph {
  if (usarFalso()) return metaFalso()
  return new MetaGraphReal(process.env.META_APP_ID ?? '', process.env.META_APP_SECRET ?? '')
}
