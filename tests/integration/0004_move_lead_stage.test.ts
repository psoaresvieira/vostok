import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { criarContaAvulsa, montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

describe('0004 — move_lead_stage', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('move o lead e escreve historico e evento na mesma transacao', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, proposta]),
    )

    const estado = await comoServico(async (cli) => ({
      lead: (
        await cli.query('select stage_id, status from public.leads where id = $1', [leadId])
      ).rows[0],
      historico: (
        await cli.query(
          'select stage_origem, stage_destino from public.stage_history where lead_id = $1',
          [leadId],
        )
      ).rows,
      eventos: (
        await cli.query('select tipo, payload from public.lead_events where lead_id = $1', [leadId])
      ).rows,
    }))

    expect(estado.lead.stage_id).toBe(proposta)
    expect(estado.lead.status).toBe('aberto')
    expect(estado.historico).toEqual([{ stage_origem: novo, stage_destino: proposta }])
    expect(estado.eventos).toHaveLength(1)
    expect(estado.eventos[0].tipo).toBe('etapa_alterada')
    expect(estado.eventos[0].payload.para).toBe(proposta)
  })

  it('deriva status de stages.tipo em ganho e em perdido', async () => {
    const novo = etapa(c, 'Novo lead')
    const ganho = etapa(c, 'Ganho')
    const perdido = etapa(c, 'Perdido')

    const leadGanho = await criarLead(c, 'Ganho', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadGanho, ganho]),
    )

    const leadPerdido = await criarLead(c, 'Perdido', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [leadPerdido, perdido, c.motivoId]),
    )

    const linhas = await comoServico(async (cli) =>
      (
        await cli.query(
          'select nome, status, loss_reason_id from public.leads order by nome',
          [],
        )
      ).rows,
    )
    expect(linhas).toEqual([
      { nome: 'Ganho', status: 'ganho', loss_reason_id: null },
      { nome: 'Perdido', status: 'perdido', loss_reason_id: c.motivoId },
    ])
  })

  it('rejeita perda sem motivo e nao deixa rastro', async () => {
    const novo = etapa(c, 'Novo lead')
    const perdido = etapa(c, 'Perdido')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadId, perdido]),
      ),
    ).rejects.toThrow(/motivo_perda_obrigatorio/)

    const estado = await comoServico(async (cli) => ({
      stage: (await cli.query('select stage_id from public.leads where id = $1', [leadId])).rows[0]
        .stage_id,
      historico: (
        await cli.query('select count(*)::int as n from public.stage_history where lead_id = $1', [
          leadId,
        ])
      ).rows[0].n,
      eventos: (
        await cli.query('select count(*)::int as n from public.lead_events where lead_id = $1', [
          leadId,
        ])
      ).rows[0].n,
    }))
    expect(estado.stage).toBe(novo)
    expect(estado.historico).toBe(0)
    expect(estado.eventos).toBe(0)
  })

  it('rejeita motivo de perda de outra conta', async () => {
    const novo = etapa(c, 'Novo lead')
    const perdido = etapa(c, 'Perdido')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    const forasteiro = await criarUsuario('fora@b.com')
    const outraConta = await criarContaAvulsa(forasteiro, 'Outra')
    const motivoAlheio = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          'select id from public.loss_reasons where account_id = $1 limit 1',
          [outraConta],
        )
      ).rows[0].id,
    )

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2, $3)', [leadId, perdido, motivoAlheio]),
      ),
    ).rejects.toThrow(/motivo_perda_invalido/)
  })

  it('rejeita etapa de outra conta', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    const forasteiro = await criarUsuario('fora@b.com')
    const outraConta = await criarContaAvulsa(forasteiro, 'Outra')
    const etapaAlheia = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `select s.id from public.stages s
           join public.pipelines p on p.id = s.pipeline_id
           where p.account_id = $1 limit 1`,
          [outraConta],
        )
      ).rows[0].id,
    )

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadId, etapaAlheia]),
      ),
    ).rejects.toThrow(/etapa_invalida/)
  })

  it('vendedor nao move lead de outro vendedor', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadDoB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadDoB, proposta]),
      ),
    ).rejects.toThrow(/lead_nao_encontrado/)
  })

  it('atualiza entrou_na_etapa_em a cada movimento', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoServico((cli) =>
      cli.query(
        `update public.leads set entrou_na_etapa_em = now() - interval '5 days' where id = $1`,
        [leadId],
      ),
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, proposta]),
    )

    const horas = await comoServico(async (cli) =>
      (
        await cli.query(
          `select extract(epoch from (now() - entrou_na_etapa_em)) / 3600 as h
           from public.leads where id = $1`,
          [leadId],
        )
      ).rows[0].h,
    )
    expect(Number(horas)).toBeLessThan(1)
  })
})
