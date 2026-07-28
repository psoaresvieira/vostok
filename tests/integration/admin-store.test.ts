import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseAdminStore } from '@/lib/data/admin'
import { comoServico, limparBanco } from './helpers/db'
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

  it('admin cria etapa no fim do funil', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const r = await admin.criarEtapa('Negociação', 'aberta')
    expect(r.ok).toBe(true)

    const total = await comoServico(async (cli) =>
      (
        await cli.query('select count(*)::int as n from public.stages where pipeline_id = $1', [
          c.pipelineId,
        ])
      ).rows[0].n,
    )
    expect(total).toBe(8)
  })

  it('reordenar etapas nao viola o indice unico de ordem', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const invertida = [...c.etapas].reverse().map((e) => e.id)

    const r = await admin.reordenarEtapas(invertida)
    expect(r.ok).toBe(true)

    const nomes = await comoServico(async (cli) =>
      (
        await cli.query(
          'select nome from public.stages where pipeline_id = $1 order by ordem',
          [c.pipelineId],
        )
      ).rows.map((x) => x.nome),
    )
    expect(nomes[0]).toBe('Perdido')
    expect(nomes[6]).toBe('Novo lead')
  })

  it('vendedor nao cria etapa', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.vendedorAId),
      c.accountId,
      c.vendedorAId,
      c.pipelineId,
    )
    const r = await admin.criarEtapa('Hackeada', 'aberta')
    expect(r.ok).toBe(false)
  })

  it('convite pendente aparece na listagem e some ao revogar', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const criado = await admin.convidar('novo@se7e.com', 'vendedor')
    if (!criado.ok) throw new Error(criado.erro)

    const pendentes = await admin.convitesPendentes()
    if (!pendentes.ok) throw new Error(pendentes.erro)
    expect(pendentes.valor.map((p) => p.email)).toEqual(['novo@se7e.com'])

    const revogado = await admin.revogarConvite(pendentes.valor[0].id)
    expect(revogado.ok).toBe(true)

    const depois = await admin.convitesPendentes()
    if (!depois.ok) throw new Error(depois.erro)
    expect(depois.valor).toHaveLength(0)
  })

  it('desativar motivo o remove das opcoes de perda', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
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
      c.pipelineId,
    )
    await admin.alternarMotivo(c.motivoId, false)

    const r = await admin.todosMotivos()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(5)
    expect(r.valor.find((m) => m.id === c.motivoId)?.ativo).toBe(false)
  })
})
