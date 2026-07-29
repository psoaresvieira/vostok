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

  it('admin cria etapa no fim do funil', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const r = await admin.criarEtapa('Negociação', 'aberta')
    if (!r.ok) throw new Error(r.erro)

    const { total, criada, maiorOrdem } = await comoServico(async (cli) => {
      const t = await cli.query(
        'select count(*)::int as n, max(ordem)::int as maior from public.stages where pipeline_id = $1',
        [c.pipelineId],
      )
      const e = await cli.query(
        'select nome, tipo, ordem from public.stages where id = $1',
        [r.valor],
      )
      return { total: t.rows[0].n, maiorOrdem: t.rows[0].maior, criada: e.rows[0] }
    })
    expect(total).toBe(8)
    expect(criada.nome).toBe('Negociação')
    expect(criada.tipo).toBe('aberta')
    // "no fim do funil": nenhuma etapa fica depois dela
    expect(criada.ordem).toBe(maiorOrdem)
    expect(criada.ordem).toBe(8)
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

    const linhas = await comoServico(async (cli) =>
      (
        await cli.query(
          'select nome, ordem from public.stages where pipeline_id = $1 order by ordem',
          [c.pipelineId],
        )
      ).rows,
    )
    const nomes = linhas.map((x) => x.nome)
    expect(nomes[0]).toBe('Perdido')
    expect(nomes[6]).toBe('Novo lead')
    expect(nomes).toEqual([...c.etapas].reverse().map((e) => e.nome))
    // a ordem tem que voltar compacta: linha parada na faixa de estacionamento
    // (1000+) passaria despercebida se so olhassemos os nomes.
    expect(linhas.map((x) => x.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('reordenar com lista que nao e permutacao exata e recusado sem mexer na ordem', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const ids = c.etapas.map((e) => e.id)
    const ordemOriginal = async () =>
      comoServico(async (cli) =>
        (
          await cli.query(
            'select nome, ordem from public.stages where pipeline_id = $1 order by ordem',
            [c.pipelineId],
          )
        ).rows,
      )
    const antes = await ordemOriginal()

    const parcial = await admin.reordenarEtapas([ids[6], ids[5]])
    expect(parcial.ok).toBe(false)
    if (!parcial.ok) expect(parcial.erro).toBe('ordem_invalida')

    const repetida = await admin.reordenarEtapas([ids[0], ids[0], ...ids.slice(1, 6)])
    expect(repetida.ok).toBe(false)
    if (!repetida.ok) expect(repetida.erro).toBe('ordem_invalida')

    const deOutroFunil = await admin.reordenarEtapas([
      ...ids.slice(1),
      '00000000-0000-0000-0000-000000000001',
    ])
    expect(deOutroFunil.ok).toBe(false)
    if (!deOutroFunil.ok) expect(deOutroFunil.erro).toBe('ordem_invalida')

    // nada escrito: nem posicao trocada, nem linha estacionada em 1000+
    expect(await ordemOriginal()).toEqual(antes)

    // e a reordenacao legitima seguinte continua funcionando
    const valida = await admin.reordenarEtapas([...ids].reverse())
    expect(valida.ok).toBe(true)
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
      c.pipelineId,
    )
    // Conta vizinha, com admin proprio. Sob RLS os ids abaixo nao casam com
    // nenhuma linha visivel, e "zero linhas" nao e error no PostgREST.
    const outroAdmin = await criarUsuario('admin@outra.com')
    const outraConta = await comoUsuario(outroAdmin, async (cli) =>
      (await cli.query<{ id: string }>('select public.criar_conta($1) as id', ['Outra'])).rows[0].id,
    )
    const { etapaDeFora, motivoDeFora, conviteDeFora } = await comoServico(async (cli) => {
      const e = await cli.query<{ id: string }>(
        `select s.id from public.stages s
         join public.pipelines p on p.id = s.pipeline_id
         where p.account_id = $1 order by s.ordem limit 1`,
        [outraConta],
      )
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
      return { etapaDeFora: e.rows[0].id, motivoDeFora: m.rows[0].id, conviteDeFora: i.rows[0].id }
    })

    const renomeada = await admin.renomearEtapa(etapaDeFora, 'Invadida')
    expect(renomeada.ok).toBe(false)
    if (!renomeada.ok) expect(renomeada.erro).toBe('nao_encontrado')

    const alternado = await admin.alternarMotivo(motivoDeFora, false)
    expect(alternado.ok).toBe(false)
    if (!alternado.ok) expect(alternado.erro).toBe('nao_encontrado')

    const revogado = await admin.revogarConvite(conviteDeFora)
    expect(revogado.ok).toBe(false)
    if (!revogado.ok) expect(revogado.erro).toBe('nao_encontrado')

    // e nada da conta vizinha foi tocado
    const intacto = await comoServico(async (cli) => ({
      etapa: (await cli.query('select nome from public.stages where id = $1', [etapaDeFora]))
        .rows[0].nome,
      motivo: (await cli.query('select ativo from public.loss_reasons where id = $1', [motivoDeFora]))
        .rows[0].ativo,
      convites: (
        await cli.query('select count(*)::int as n from public.invites where id = $1', [
          conviteDeFora,
        ])
      ).rows[0].n,
    }))
    expect(intacto.etapa).toBe('Novo lead')
    expect(intacto.motivo).toBe(true)
    expect(intacto.convites).toBe(1)
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
