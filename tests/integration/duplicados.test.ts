import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

describe('possiveis duplicados', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('o indice de telefone nao e unico: a mesma pessoa pode virar lead de novo', async () => {
    const novo = etapa(c, 'Novo lead')
    const inserir = () =>
      comoServico((cli) =>
        cli.query(
          `insert into public.leads (account_id, nome, telefone_e164, pipeline_id, stage_id)
           values ($1, 'Ana', '+5583999991234', $2, $3)`,
          [c.accountId, c.pipelineId, novo],
        ),
      )

    await inserir()
    await expect(inserir()).resolves.toBeDefined()

    const n = await comoServico(async (cli) =>
      (
        await cli.query(
          `select count(*)::int as n from public.leads where telefone_e164 = '+5583999991234'`,
        )
      ).rows[0].n,
    )
    expect(n).toBe(2)
  })
})
