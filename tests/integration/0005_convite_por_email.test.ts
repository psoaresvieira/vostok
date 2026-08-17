import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseAdminStore } from '@/lib/data/admin'
import { comoServico, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'
import type { Papel } from '@/lib/domain/tipos'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Diferente do helper `comoUsuario`, aqui o convite e resgatado via PostgREST
 * com um JWT de verdade — que e de onde `auth.jwt() ->> 'email'` le em
 * producao. O claim `email` e explicito porque e justamente ele que esta sob
 * teste.
 */
async function clienteDoUsuario(userId: string, email: string) {
  const { SignJWT } = await import('jose')
  const segredo = new TextEncoder().encode(
    'super-secret-jwt-token-with-at-least-32-characters-long',
  )
  const token = await new SignJWT({
    sub: userId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(segredo)
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('0005 — convite vinculado ao email', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  async function convidar(email: string, papel: Papel): Promise<string> {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId, 'admin@a.com'),
      c.accountId,
      c.adminId,
    )
    const r = await admin.convidar(email, papel)
    if (!r.ok) throw new Error(r.erro)
    return r.valor
  }

  async function conviteAceitoEm(token: string): Promise<Date | null> {
    return comoServico(
      async (cli) =>
        (await cli.query('select aceito_em from public.invites where token = $1', [token]))
          .rows[0].aceito_em,
    )
  }

  async function papelNaConta(userId: string): Promise<string | undefined> {
    return comoServico(
      async (cli) =>
        (
          await cli.query(
            'select papel from public.memberships where account_id = $1 and user_id = $2',
            [c.accountId, userId],
          )
        ).rows[0]?.papel,
    )
  }

  it('quem tem o token mas outro email nao entra na conta', async () => {
    // 'admin' de proposito: e o papel que a tela de configuracao oferece e o
    // que torna o vazamento do token uma escalada de privilegio.
    const token = await convidar('convidado@exemplo.com', 'admin')
    const intruso = await criarUsuario('intruso@fora.com')
    const cliente = await clienteDoUsuario(intruso, 'intruso@fora.com')

    const { error } = await cliente.rpc('accept_invite', { p_token: token })
    expect(error?.message).toContain('convite_de_outro_email')

    expect(await papelNaConta(intruso)).toBeUndefined()
    // o convite tem que continuar utilizavel pelo convidado de verdade
    expect(await conviteAceitoEm(token)).toBeNull()
  })

  it('o convidado entra na conta do convite com o papel do convite', async () => {
    const token = await convidar('convidado@exemplo.com', 'admin')
    const convidado = await criarUsuario('convidado@exemplo.com')
    // maiusculas de proposito: a comparacao e case-insensitive dos dois lados
    const cliente = await clienteDoUsuario(convidado, 'Convidado@Exemplo.com')

    const { data, error } = await cliente.rpc('accept_invite', { p_token: token })
    expect(error).toBeNull()
    expect(data).toBe(c.accountId)

    expect(await papelNaConta(convidado)).toBe('admin')
    expect(await conviteAceitoEm(token)).not.toBeNull()
  })
})
