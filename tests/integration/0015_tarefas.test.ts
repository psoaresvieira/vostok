import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

describe('0015 — tabela tasks e a RLS herdada de pode_ver_lead_id', () => {
  let c: Cenario
  let leadA: string
  let leadB: string

  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
    const novo = etapa(c, 'Novo lead')
    leadA = await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    leadB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)
  })

  it('vendedor A insere tarefa no proprio lead e le de volta', async () => {
    const id = await comoUsuario(c.vendedorAId, async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tasks (lead_id, titulo, vence_em, criado_por)
           values ($1, 'Ligar amanha', now() + interval '1 day', $2) returning id`,
          [leadA, c.vendedorAId],
        )
      ).rows[0].id,
    )

    const vistas = await comoUsuario(c.vendedorAId, async (cli) =>
      (await cli.query('select titulo from public.tasks where id = $1', [id])).rows.map(
        (r) => r.titulo,
      ),
    )
    expect(vistas).toEqual(['Ligar amanha'])
  })

  it('vendedor A nao enxerga tarefa do lead do vendedor B', async () => {
    await comoServico((cli) =>
      cli.query(
        `insert into public.tasks (lead_id, titulo, vence_em, criado_por)
         values ($1, 'Tarefa do B', now() + interval '1 day', $2)`,
        [leadB, c.vendedorBId],
      ),
    )

    const n = await comoUsuario(c.vendedorAId, async (cli) =>
      (await cli.query('select count(*)::int as n from public.tasks')).rows[0].n,
    )
    expect(n).toBe(0)
  })

  it('vendedor A nao consegue inserir tarefa no lead do vendedor B', async () => {
    try {
      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.tasks (lead_id, titulo, vence_em, criado_por)
           values ($1, 'Tarefa indevida', now() + interval '1 day', $2)`,
          [leadB, c.vendedorAId],
        ),
      )
    } catch {
      // Erro aceitavel: o que importa e a linha nao existir depois.
    }

    const n = await comoServico(
      async (cli) =>
        (
          await cli.query('select count(*)::int as n from public.tasks where lead_id = $1', [
            leadB,
          ])
        ).rows[0].n,
    )
    expect(n).toBe(0)
  })

  it('discriminacao por papel: admin ve estritamente mais tarefas que o vendedor', async () => {
    await comoServico((cli) =>
      cli.query(
        `insert into public.tasks (lead_id, titulo, vence_em, criado_por) values
           ($1, 'Tarefa do A', now() + interval '1 day', $3),
           ($2, 'Tarefa do B', now() + interval '1 day', $4)`,
        [leadA, leadB, c.vendedorAId, c.vendedorBId],
      ),
    )

    const consulta = 'select count(*)::int as n from public.tasks'
    const nAdmin = await comoUsuario(
      c.adminId,
      async (cli) => (await cli.query(consulta)).rows[0].n,
    )
    const nVendedorA = await comoUsuario(
      c.vendedorAId,
      async (cli) => (await cli.query(consulta)).rows[0].n,
    )

    expect(nAdmin).toBeGreaterThan(nVendedorA)
  })

  it('titulo em branco e recusado', async () => {
    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.tasks (lead_id, titulo, vence_em, criado_por)
           values ($1, '   ', now() + interval '1 day', $2)`,
          [leadA, c.vendedorAId],
        ),
      ),
    ).rejects.toThrow()
  })

  it('vendedor A exclui a propria tarefa e a linha some', async () => {
    const id = await comoUsuario(c.vendedorAId, async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tasks (lead_id, titulo, vence_em, criado_por)
           values ($1, 'Ligar amanha', now() + interval '1 day', $2) returning id`,
          [leadA, c.vendedorAId],
        )
      ).rows[0].id,
    )

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('delete from public.tasks where id = $1', [id]),
    )

    const n = await comoServico(
      async (cli) =>
        (await cli.query('select count(*)::int as n from public.tasks where id = $1', [id]))
          .rows[0].n,
    )
    expect(n).toBe(0)
  })
})
