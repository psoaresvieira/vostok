import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseCrmStore } from '@/lib/data/supabase'
import { leadSchema } from '@/lib/domain/lead'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Cliente supabase-js falando pelo usuario. Assinamos um JWT local com o
 * segredo padrao do Supabase CLI, que e o mesmo em toda instalacao local.
 */
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

describe('SupabaseCrmStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('lista o pipeline padrao com as 7 etapas', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const r = await store.pipelinePadrao()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.etapas).toHaveLength(7)
    expect(r.valor.etapas[0].nome).toBe('Novo lead')
  })

  it('cria lead e o encontra na listagem', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana', telefone: '(83) 99999-1234' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const lista = await store.listarLeads({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor.map((l) => l.nome)).toEqual(['Ana'])
    expect(lista.valor[0].telefoneE164).toBe('+5583999991234')
  })

  it('vendedor nao ve lead de outro vendedor pela RLS', async () => {
    await comoServico((cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Lead do B', $2, $3, $4)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorBId],
      ),
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const lista = await store.listarLeads({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor).toHaveLength(0)
  })

  it('moverEtapa devolve erro tipado quando falta motivo de perda', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)
    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.moverEtapa(criado.valor, etapa(c, 'Perdido'))
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('buscarLead devolve null (nao erro) para lead de outra pessoa', async () => {
    const idAlheio = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
           values ($1, 'Lead do B', $2, $3, $4) returning id`,
          [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorBId],
        )
      ).rows[0].id,
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const r = await store.buscarLead(idAlheio)
    expect(r).toEqual({ ok: true, valor: null })
  })

  it('aplicarEtiquetas reusa a etiqueta existente ignorando caixa', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const a = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    const b = await store.criarLead({
      ...leadSchema.parse({ nome: 'Bruno' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    if (!a.ok || !b.ok) throw new Error('falha ao criar')

    await store.aplicarEtiquetas(a.valor, ['Preço alto'])
    await store.aplicarEtiquetas(b.valor, ['preço ALTO'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor).toHaveLength(1)

    const snapshot = await comoServico(async (cli) =>
      (
        await cli.query('select stage_id_no_momento from public.lead_tags where lead_id = $1', [
          b.valor,
        ])
      ).rows[0].stage_id_no_momento,
    )
    expect(snapshot).toBe(etapa(c, 'Qualificação'))
  })
})
