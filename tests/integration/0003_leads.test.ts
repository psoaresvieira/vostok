import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { criarContaAvulsa, montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

describe('0003 — leads, etiquetas, historico', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('vendedor le so os proprios leads', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const vistos = await comoUsuario(c.vendedorAId, async (cli) =>
      (await cli.query('select nome from public.leads')).rows.map((r) => r.nome),
    )
    expect(vistos).toEqual(['Lead do A'])
  })

  it('gestor e admin leem a conta inteira', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    for (const usuario of [c.gestorId, c.adminId]) {
      const n = await comoUsuario(usuario, async (cli) =>
        (await cli.query('select count(*)::int as n from public.leads')).rows[0].n,
      )
      expect(n).toBe(2)
    }
  })

  it('usuario de outra conta nao le lead nenhum', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    const forasteiro = await criarUsuario('fora@b.com')
    await criarContaAvulsa(forasteiro, 'Outra')

    const n = await comoUsuario(forasteiro, async (cli) =>
      (await cli.query('select count(*)::int as n from public.leads')).rows[0].n,
    )
    expect(n).toBe(0)
  })

  it('etiqueta e unica por conta ignorando maiusculas', async () => {
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(`insert into public.tags (account_id, nome, criado_por) values ($1, 'Preço alto', $2)`, [
        c.accountId,
        c.vendedorAId,
      ]),
    )

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'preço ALTO', $2)`,
          [c.accountId, c.vendedorAId],
        ),
      ),
    ).rejects.toThrow(/duplicate key|tags_account_nome_idx/)
  })

  it('lead_tags guarda a etapa do momento e nao acompanha o lead depois', async () => {
    const qualificacao = etapa(c, 'Qualificação')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, qualificacao)

    const tagId = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'Preço alto', $2) returning id`,
          [c.accountId, c.vendedorAId],
        )
      ).rows[0].id,
    )

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
         values ($1, $2, $3, $4)`,
        [leadId, tagId, qualificacao, c.vendedorAId],
      ),
    )

    await comoServico((cli) =>
      cli.query('update public.leads set stage_id = $1 where id = $2', [proposta, leadId]),
    )

    const snapshot = await comoServico(async (cli) =>
      (
        await cli.query('select stage_id_no_momento from public.lead_tags where lead_id = $1', [
          leadId,
        ])
      ).rows[0].stage_id_no_momento,
    )
    expect(snapshot).toBe(qualificacao)
  })

  it('stage_history e lead_events nao aceitam update nem delete', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)
    await comoServico((cli) =>
      cli.query(
        `insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
         values ($1, null, $2, $3)`,
        [leadId, novo, c.vendedorAId],
      ),
    )
    await comoServico((cli) =>
      cli.query(
        `insert into public.lead_events (lead_id, tipo, payload, ator_id)
         values ($1, 'nota', '{"texto":"oi"}'::jsonb, $2)`,
        [leadId, c.vendedorAId],
      ),
    )

    const historicoAlterado = await comoUsuario(c.adminId, async (cli) =>
      (await cli.query('update public.stage_history set movido_por = null')).rowCount,
    )
    expect(historicoAlterado).toBe(0)

    const eventosApagados = await comoUsuario(c.adminId, async (cli) =>
      (await cli.query('delete from public.lead_events')).rowCount,
    )
    expect(eventosApagados).toBe(0)
  })

  it('vendedor nao le eventos de lead alheio', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadDoB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)
    await comoServico((cli) =>
      cli.query(
        `insert into public.lead_events (lead_id, tipo, payload, ator_id)
         values ($1, 'nota', '{"texto":"segredo"}'::jsonb, $2)`,
        [leadDoB, c.vendedorBId],
      ),
    )

    const n = await comoUsuario(c.vendedorAId, async (cli) =>
      (await cli.query('select count(*)::int as n from public.lead_events')).rows[0].n,
    )
    expect(n).toBe(0)
  })
})
