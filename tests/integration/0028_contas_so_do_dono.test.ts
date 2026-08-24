import { beforeEach, describe, expect, it } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

async function tornarDono(userId: string): Promise<void> {
  await comoServico((c) =>
    c.query('insert into public.platform_owners (user_id) values ($1) on conflict do nothing', [userId]),
  )
}

beforeEach(limparBanco)

describe('0028 — contas so pelo dono da plataforma', () => {
  it('criar_conta falha para usuario comum com sem_permissao', async () => {
    const uid = await criarUsuario('comum@a.com')
    await expect(
      comoUsuario(uid, (c) => c.query(`select public.criar_conta('Empresa X')`)),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('criar_conta do dono mantem o seed completo da conta', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    const contaId = await comoUsuario(uid, async (c) =>
      (await c.query<{ id: string }>(`select public.criar_conta('Empresa X') as id`)).rows[0].id,
    )
    const n = await comoServico(async (c) =>
      (
        await c.query<{ etapas: number; motivos: number; membros: number }>(
          `select
             (select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.account_id = $1) as etapas,
             (select count(*)::int from public.loss_reasons where account_id = $1) as motivos,
             (select count(*)::int from public.memberships where account_id = $1) as membros`,
          [contaId],
        )
      ).rows[0],
    )
    expect(n).toEqual({ etapas: 7, motivos: 5, membros: 1 })
  })

  it('criar_conta_cliente cria conta com convite admin e SEM membership do dono', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    const token = await comoUsuario(uid, async (c) =>
      (
        await c.query<{ t: string }>(
          `select public.criar_conta_cliente('Cliente X', '  Cliente@Ex.com ') as t`,
        )
      ).rows[0].t,
    )
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    const convite = await comoServico(async (c) =>
      (
        await c.query<{ account_id: string; email: string; papel: string; aceito_em: string | null }>(
          'select account_id, email, papel, aceito_em from public.invites where token = $1',
          [token],
        )
      ).rows[0],
    )
    expect(convite.email).toBe('cliente@ex.com')
    expect(convite.papel).toBe('admin')
    expect(convite.aceito_em).toBeNull()
    const membros = await comoServico(async (c) =>
      (
        await c.query<{ n: number }>(
          'select count(*)::int as n from public.memberships where account_id = $1',
          [convite.account_id],
        )
      ).rows[0].n,
    )
    expect(membros).toBe(0)
  })

  it('criar_conta_cliente falha para usuario comum', async () => {
    const uid = await criarUsuario('comum@a.com')
    await expect(
      comoUsuario(uid, (c) => c.query(`select public.criar_conta_cliente('X', 'x@x.com')`)),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('reemitir_convite troca o token e estende a validade; convite aceito e recusado', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    const token = await comoUsuario(uid, async (c) =>
      (await c.query<{ t: string }>(`select public.criar_conta_cliente('X', 'x@x.com') as t`)).rows[0].t,
    )
    const conviteId = await comoServico(async (c) =>
      (await c.query<{ id: string }>('select id from public.invites where token = $1', [token])).rows[0].id,
    )
    const novo = await comoUsuario(uid, async (c) =>
      (await c.query<{ t: string }>('select public.reemitir_convite($1) as t', [conviteId])).rows[0].t,
    )
    expect(novo).toMatch(/^[0-9a-f]{32}$/)
    expect(novo).not.toBe(token)

    await comoServico((c) => c.query('update public.invites set aceito_em = now() where id = $1', [conviteId]))
    await expect(
      comoUsuario(uid, (c) => c.query('select public.reemitir_convite($1)', [conviteId])),
    ).rejects.toThrow(/convite_ja_aceito/)
  })

  it('reemitir_convite falha para usuario comum com sem_permissao', async () => {
    const dono = await criarUsuario('dono@a.com')
    const comum = await criarUsuario('comum@a.com')
    await tornarDono(dono)
    const token = await comoUsuario(dono, async (c) =>
      (await c.query<{ t: string }>(`select public.criar_conta_cliente('X', 'x@x.com') as t`)).rows[0].t,
    )
    const conviteId = await comoServico(async (c) =>
      (await c.query<{ id: string }>('select id from public.invites where token = $1', [token])).rows[0].id,
    )
    await expect(
      comoUsuario(comum, (c) => c.query('select public.reemitir_convite($1)', [conviteId])),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('reemitir_convite com uuid inexistente falha com convite_invalido', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    await expect(
      comoUsuario(uid, (c) => c.query('select public.reemitir_convite(gen_random_uuid())')),
    ).rejects.toThrow(/convite_invalido/)
  })

  it('contas_da_plataforma lista tudo para o dono e vem VAZIA para usuario comum', async () => {
    const dono = await criarUsuario('dono@a.com')
    const comum = await criarUsuario('comum@a.com')
    await tornarDono(dono)
    await comoUsuario(dono, (c) => c.query(`select public.criar_conta_cliente('Cliente A', 'a@a.com')`))

    const doDono = await comoUsuario(dono, async (c) =>
      (await c.query('select * from public.contas_da_plataforma()')).rows,
    )
    expect(doDono).toHaveLength(1)
    expect(doDono[0]).toMatchObject({ nome: 'Cliente A', convite_email: 'a@a.com', convite_aceito_em: null })

    const doComum = await comoUsuario(comum, async (c) =>
      (await c.query('select * from public.contas_da_plataforma()')).rows,
    )
    expect(doComum).toHaveLength(0)
  })

  it('sou_dono_da_plataforma distingue dono de usuario comum', async () => {
    const dono = await criarUsuario('dono@a.com')
    const comum = await criarUsuario('comum@a.com')
    await tornarDono(dono)
    const rDono = await comoUsuario(dono, async (c) =>
      (await c.query<{ e: boolean }>('select public.sou_dono_da_plataforma() as e')).rows[0].e,
    )
    const rComum = await comoUsuario(comum, async (c) =>
      (await c.query<{ e: boolean }>('select public.sou_dono_da_plataforma() as e')).rows[0].e,
    )
    expect(rDono).toBe(true)
    expect(rComum).toBe(false)
  })

  it('platform_owners e invisivel e imutavel para authenticated', async () => {
    const uid = await criarUsuario('comum@a.com')
    await expect(
      comoUsuario(uid, (c) => c.query('select * from public.platform_owners')),
    ).rejects.toThrow(/permission denied/)
    await expect(
      comoUsuario(uid, (c) => c.query('insert into public.platform_owners (user_id) values ($1)', [uid])),
    ).rejects.toThrow(/permission denied/)
  })
})
