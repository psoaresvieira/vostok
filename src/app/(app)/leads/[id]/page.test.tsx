import { describe, it, expect, vi } from 'vitest'

// `redirect` do Next LANCA para interromper o render — quem chama nunca ve o
// retorno. O mock preserva esse contrato e carrega o destino na mensagem.
class Redirecionou extends Error {
  constructor(readonly destino: string) {
    super(`redirect:${destino}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionou(destino)
  },
}))

import LeadPage from './page'

describe('/leads/[id] — a ficha virou o drawer do funil', () => {
  it('redireciona para /funil?lead=<id> sem tocar em store nenhum: o funil resolve pipeline, sessao e lead inexistente', async () => {
    await expect(LeadPage({ params: Promise.resolve({ id: 'lead-1' }) })).rejects.toThrow(
      'redirect:/funil?lead=lead-1',
    )
  })

  it('o id vai pela query codificado — um id malformado nao quebra a URL', async () => {
    await expect(LeadPage({ params: Promise.resolve({ id: 'a b&c' }) })).rejects.toThrow(
      'redirect:/funil?lead=a+b%26c',
    )
  })
})
