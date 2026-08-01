import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Achado que bloqueou a Task 7 (Plano 4): o matcher deste middleware casa
 * TODAS as rotas, e ROTAS_PUBLICAS so tinha /login, /signup e /convite. Sem
 * sessao, um POST do Meta era redirecionado para /login antes de chegar no
 * route handler -- o Meta trata o redirect como falha de entrega e, apos
 * reprovacoes repetidas, desinscreve o app da Page. Nenhum teste existente
 * cobria isso porque nenhuma rota sem sessao existia antes do Plano 4.
 *
 * @supabase/ssr e mockado para devolver sempre "sem usuario": o que importa
 * aqui e so o roteamento (publica vs. protegida), nunca a validade real de
 * uma sessao -- isso ja e responsabilidade do supabase-js, nao deste
 * middleware.
 */
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}))

import { middleware } from './middleware'

describe('middleware', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-teste')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('nao redireciona um POST sem sessao no webhook do Meta para /login', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/meta', { method: 'POST' })

    const res = await middleware(req)

    // NextResponse.redirect() sempre vem com Location; ausencia dele e a
    // prova de que a rota passou direto, sem o portao de sessao.
    expect(res.headers.get('location')).toBeNull()
  })

  it('continua redirecionando pra /login uma rota comum sem sessao', async () => {
    const req = new NextRequest('http://localhost/leads')

    const res = await middleware(req)

    expect(res.headers.get('location')).toContain('/login')
  })
})
