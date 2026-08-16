import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, criarLead, type Cenario } from './helpers/cenario'

/**
 * Plano 14: qualquer membro (nao so admin) cria, renomeia e exclui
 * pipelines/stages da propria conta. A regra de negocio que impede excluir a
 * pipeline padrao ou uma pipeline com leads mora na policy de delete (ver
 * comentario da migration 0025_pipelines_por_membro.sql).
 */

async function segundaConta(nome: string, email: string): Promise<{ userId: string; accountId: string }> {
  return comoServico(async (cli) => {
    const u = await cli.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id`,
      [email],
    )
    await cli.query(
      `insert into public.profiles (id, nome, email) values ($1, 'Admin', $2)
       on conflict (id) do nothing`,
      [u.rows[0].id, email],
    )
    const a = await cli.query<{ id: string }>(
      `insert into public.accounts (nome) values ($1) returning id`,
      [nome],
    )
    await cli.query(
      `insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'admin')`,
      [a.rows[0].id, u.rows[0].id],
    )
    return { userId: u.rows[0].id, accountId: a.rows[0].id }
  })
}

async function pipelineExiste(pipelineId: string): Promise<boolean> {
  return comoServico(async (cli) => {
    const r = await cli.query('select 1 from public.pipelines where id = $1', [pipelineId])
    return (r.rowCount ?? 0) > 0
  })
}

describe('0025 — escrita de pipelines/stages por membro + guarda de delete', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('Caso 1: vendedor cria pipeline na propria conta', async () => {
    const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline B') returning id`,
        [c.accountId],
      )
      return r.rows[0].id
    })
    expect(pipelineId).toBeTruthy()
  })

  it('Caso 2: vendedor cria stages nessa pipeline', async () => {
    const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline B') returning id`,
        [c.accountId],
      )
      return r.rows[0].id
    })

    const stageIds = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.stages (pipeline_id, nome, ordem, tipo) values
           ($1, 'Aberta 1', 1, 'aberta'),
           ($1, 'Ganho', 2, 'ganho'),
           ($1, 'Perdido', 3, 'perdido')
         returning id`,
        [pipelineId],
      )
      return r.rows.map((row) => row.id)
    })
    expect(stageIds).toHaveLength(3)
  })

  it('Caso 3: membro nao cria pipeline em conta alheia', async () => {
    const outra = await segundaConta('Conta B', 'admin-b-3@b.com')

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(`insert into public.pipelines (account_id, nome) values ($1, 'Invasora')`, [
          outra.accountId,
        ]),
      ),
    ).rejects.toThrow(/new row violates row-level security policy|permission denied/)
  })

  it('Caso 4: membro nao escreve stage em pipeline de conta alheia', async () => {
    const outra = await segundaConta('Conta B', 'admin-b-4@b.com')
    const pipelineAlheia = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline B') returning id`,
        [outra.accountId],
      )
      return r.rows[0].id
    })

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.stages (pipeline_id, nome, ordem, tipo) values ($1, 'Invasora', 1, 'aberta')`,
          [pipelineAlheia],
        ),
      ),
    ).rejects.toThrow(/new row violates row-level security policy|permission denied/)
  })

  it('Caso 5: delete da pipeline padrao afeta 0 linhas', async () => {
    const rowCount = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query('delete from public.pipelines where id = $1', [c.pipelineId])
      return r.rowCount
    })
    expect(rowCount).toBe(0)
    expect(await pipelineExiste(c.pipelineId)).toBe(true)
  })

  it('Caso 6: delete de pipeline com leads afeta 0 linhas mesmo quando o chamador nao enxerga os leads', async () => {
    // Pipeline nova criada pelo vendedor A; lead nela pertence ao vendedor B
    // (via comoServico, ignorando RLS). Se pipeline_tem_leads fosse invoker,
    // a RLS de leads esconderia o lead do colega do vendedor A e o delete
    // passaria batido — este e' o caso que discrimina o security definer.
    const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline com lead') returning id`,
        [c.accountId],
      )
      return r.rows[0].id
    })
    const stageId = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.stages (pipeline_id, nome, ordem, tipo) values ($1, 'Aberta 1', 1, 'aberta') returning id`,
        [pipelineId],
      )
      return r.rows[0].id
    })
    await comoServico((cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Lead do vendedor B', $2, $3, $4)`,
        [c.accountId, pipelineId, stageId, c.vendedorBId],
      ),
    )

    const rowCount = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query('delete from public.pipelines where id = $1', [pipelineId])
      return r.rowCount
    })
    expect(rowCount).toBe(0)
    expect(await pipelineExiste(pipelineId)).toBe(true)
  })

  it('Caso 7: delete de pipeline vazia e nao-padrao passa (stages somem junto)', async () => {
    const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline descartavel') returning id`,
        [c.accountId],
      )
      return r.rows[0].id
    })
    const stageId = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.stages (pipeline_id, nome, ordem, tipo) values ($1, 'Aberta 1', 1, 'aberta') returning id`,
        [pipelineId],
      )
      return r.rows[0].id
    })

    const rowCount = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query('delete from public.pipelines where id = $1', [pipelineId])
      return r.rowCount
    })
    expect(rowCount).toBe(1)
    expect(await pipelineExiste(pipelineId)).toBe(false)

    const stageExiste = await comoServico(async (cli) => {
      const r = await cli.query('select 1 from public.stages where id = $1', [stageId])
      return (r.rowCount ?? 0) > 0
    })
    expect(stageExiste).toBe(false)
  })

  it('Caso 8: renomear por membro da propria conta passa; de conta alheia afeta 0 linhas', async () => {
    const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome) values ($1, 'Nome original') returning id`,
        [c.accountId],
      )
      return r.rows[0].id
    })

    const rowCountPropria = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query(`update public.pipelines set nome = 'Nome novo' where id = $1`, [
        pipelineId,
      ])
      return r.rowCount
    })
    expect(rowCountPropria).toBe(1)

    const outra = await segundaConta('Conta B', 'admin-b-8@b.com')
    const rowCountAlheia = await comoUsuario(outra.userId, async (cli) => {
      const r = await cli.query(`update public.pipelines set nome = 'Roubada' where id = $1`, [
        pipelineId,
      ])
      return r.rowCount
    })
    expect(rowCountAlheia).toBe(0)
  })
})
