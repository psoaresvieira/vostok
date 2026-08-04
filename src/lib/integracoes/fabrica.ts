import type { MetaGraph } from './meta'
import { MetaGraphFalso } from './meta-falso'
import { MetaGraphReal } from './meta-real'
import type { WhatsAppGraph } from './whatsapp'
import { WhatsAppGraphFalso } from './whatsapp-falso'
import { WhatsAppGraphReal } from './whatsapp-real'

/**
 * Os duplos vivem em `globalThis`, e nao em variavel de modulo.
 *
 * Achado do E2E do disparo (Plano 11): `next dev` compila POR ROTA, e o mesmo
 * modulo pode ser avaliado mais de uma vez — uma instancia por bundle. Com
 * `let` de modulo, /scripts/[id] registrava o template numa instancia da falsa
 * e /leads/[id] enviava contra OUTRA, recem-criada e vazia; o Graph falso
 * recusava com `envio_recusado`, e o vermelho nao dizia nada sobre o produto.
 * `globalThis` e' o unico escopo que os bundles compartilham de verdade.
 *
 * O registro fica atras de `usarFalso()` como antes: em producao ninguem chama
 * estas funcoes.
 */
const registroGlobal = globalThis as typeof globalThis & {
  __crmDuplosDeIntegracao?: { meta?: MetaGraphFalso; whatsapp?: WhatsAppGraphFalso }
}

function registro(): { meta?: MetaGraphFalso; whatsapp?: WhatsAppGraphFalso } {
  return (registroGlobal.__crmDuplosDeIntegracao ??= {})
}

/**
 * Instancia unica do falso no processo. O E2E precisa que a Page "inscrita" num
 * request continue inscrita no request seguinte — com uma instancia nova por
 * chamada, `assinadas` nasceria vazia toda vez.
 */
export function metaFalso(): MetaGraphFalso {
  const r = registro()
  return (r.meta ??= new MetaGraphFalso())
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

/**
 * Mesmo padrao de metaFalso(): instancia unica do falso no processo, porque
 * o E2E precisa que um numero cadastrado num request continue cadastrado no
 * seguinte.
 */
export function whatsappFalso(): WhatsAppGraphFalso {
  const r = registro()
  return (r.whatsapp ??= new WhatsAppGraphFalso())
}

/**
 * Mesmo usarFalso() de metaGraph() — a invariante de que a falsa nunca sobe
 * em producao vale para este canal tambem.
 */
export function whatsappGraph(): WhatsAppGraph {
  if (usarFalso()) return whatsappFalso()
  return new WhatsAppGraphReal()
}
