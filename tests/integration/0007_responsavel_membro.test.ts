import { describe, it, expect, beforeEach } from 'vitest'
import { comoUsuario, comoServico, limparBanco, criarUsuario } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

/** O forasteiro precisa de profiles, senao a FK barra antes da policy. */
async function criarForasteiro(email: string): Promise<string> {
  const id = await criarUsuario(email)
  await comoServico((cli) =>
    cli.query(
      `insert into public.profiles (id, nome, email) values ($1, 'Fora', $2)
       on conflict (id) do nothing`,
      [id, email],
    ),
  )
  return id
}

describe('0007 — responsavel_id tem que ser membro da conta', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('aceita responsavel que e membro', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Valido', $2, $3, $4)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorAId],
      ),
    )
    const total = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>('select count(*) as n from public.leads')
      return r.rows[0].n
    })
    expect(total).toBe('1')
  })

  it('aceita responsavel nulo — lead sem dono e estado legitimo', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Sem dono', $2, $3, null)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead')],
      ),
    )
    const total = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>('select count(*) as n from public.leads')
      return r.rows[0].n
    })
    expect(total).toBe('1')
  })

  it('recusa responsavel de fora da conta no insert', async () => {
    const forasteiro = await criarForasteiro('fora@z.com')
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(
          `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
           values ($1, 'Invasor', $2, $3, $4)`,
          [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), forasteiro],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('aceita trocar o responsavel para outro membro valido da conta', async () => {
    const leadId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Repassado', $2, $3, $4) returning id`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorAId],
      )
      return r.rows[0].id
    })

    await comoUsuario(c.adminId, (cli) =>
      cli.query('update public.leads set responsavel_id = $1 where id = $2', [
        c.vendedorBId,
        leadId,
      ]),
    )

    const responsavel = await comoServico(async (cli) => {
      const r = await cli.query<{ responsavel_id: string }>(
        'select responsavel_id from public.leads where id = $1',
        [leadId],
      )
      return r.rows[0].responsavel_id
    })
    expect(responsavel).toBe(c.vendedorBId)
  })

  it('recusa trocar o responsavel para alguem de fora da conta', async () => {
    const forasteiro = await criarForasteiro('fora2@z.com')
    const leadId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Alvo', $2, $3, $4) returning id`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorAId],
      )
      return r.rows[0].id
    })

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('update public.leads set responsavel_id = $1 where id = $2', [
          forasteiro,
          leadId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
