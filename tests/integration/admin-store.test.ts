import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseAdminStore } from '@/lib/data/admin'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function clienteDoUsuario(userId: string) {
  const { SignJWT } = await import('jose')
  const segredo = new TextEncoder().encode(
    'super-secret-jwt-token-with-at-least-32-characters-long',
  )
  const token = await new SignJWT({ sub: userId, role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(segredo)
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('SupabaseAdminStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('convite pendente aparece na listagem e some ao revogar', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
    )
    const criado = await admin.convidar('novo@exemplo.com', 'vendedor')
    if (!criado.ok) throw new Error(criado.erro)

    const pendentes = await admin.convitesPendentes()
    if (!pendentes.ok) throw new Error(pendentes.erro)
    expect(pendentes.valor.map((p) => p.email)).toEqual(['novo@exemplo.com'])
    // a listagem vai inteira para um componente client: o token nao pode estar
    // nela, so `convidar` o devolve.
    expect(Object.keys(pendentes.valor[0]).sort()).toEqual(['email', 'expiraEm', 'id', 'papel'])

    const revogado = await admin.revogarConvite(pendentes.valor[0].id)
    expect(revogado.ok).toBe(true)

    const depois = await admin.convitesPendentes()
    if (!depois.ok) throw new Error(depois.erro)
    expect(depois.valor).toHaveLength(0)
  })

  it('mutacao em id de outra conta responde nao_encontrado, nao sucesso', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
    )
    // Conta vizinha, com admin proprio. Sob RLS os ids abaixo nao casam com
    // nenhuma linha visivel, e "zero linhas" nao e error no PostgREST.
    const outroAdmin = await criarUsuario('admin@outra.com')
    const outraConta = await comoUsuario(outroAdmin, async (cli) =>
      (await cli.query<{ id: string }>('select public.criar_conta($1) as id', ['Outra'])).rows[0].id,
    )
    // Os casos de etapa deste teste (renomearEtapa em id de outra conta)
    // MUDARAM para etapas-store.test.ts na Task 2 do Plano 15 — mesmo
    // racional, agora contra SupabaseEtapaStore.
    const { motivoDeFora, conviteDeFora } = await comoServico(async (cli) => {
      const m = await cli.query<{ id: string }>(
        'select id from public.loss_reasons where account_id = $1 limit 1',
        [outraConta],
      )
      const i = await cli.query<{ id: string }>(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values ($1, 'x@outra.com', 'vendedor', 'tok-outra', now() + interval '7 days', $2)
         returning id`,
        [outraConta, outroAdmin],
      )
      return { motivoDeFora: m.rows[0].id, conviteDeFora: i.rows[0].id }
    })

    const alternado = await admin.alternarMotivo(motivoDeFora, false)
    expect(alternado.ok).toBe(false)
    if (!alternado.ok) expect(alternado.erro).toBe('nao_encontrado')

    const revogado = await admin.revogarConvite(conviteDeFora)
    expect(revogado.ok).toBe(false)
    if (!revogado.ok) expect(revogado.erro).toBe('nao_encontrado')

    // e nada da conta vizinha foi tocado
    const intacto = await comoServico(async (cli) => ({
      motivo: (await cli.query('select ativo from public.loss_reasons where id = $1', [motivoDeFora]))
        .rows[0].ativo,
      convites: (
        await cli.query('select count(*)::int as n from public.invites where id = $1', [
          conviteDeFora,
        ])
      ).rows[0].n,
    }))
    expect(intacto.motivo).toBe(true)
    expect(intacto.convites).toBe(1)
  })

  it('desativar motivo o remove das opcoes de perda', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
    )
    const r = await admin.alternarMotivo(c.motivoId, false)
    expect(r.ok).toBe(true)

    const ativos = await comoServico(async (cli) =>
      (
        await cli.query(
          'select count(*)::int as n from public.loss_reasons where account_id = $1 and ativo',
          [c.accountId],
        )
      ).rows[0].n,
    )
    expect(ativos).toBe(4)
  })

  it('todosMotivos continua listando o motivo desativado', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
    )
    await admin.alternarMotivo(c.motivoId, false)

    const r = await admin.todosMotivos()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(5)
    expect(r.valor.find((m) => m.id === c.motivoId)?.ativo).toBe(false)
  })
})
