import { describe, it, expect, beforeAll } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

/** Uma segunda conta completa, com admin proprio e pipeline padrao ja semeado
 * (via criar_conta, como montarCenario faz) — precisamos de uma etapa real
 * de outra conta para o caso de isolamento. */
async function segundaConta(email: string): Promise<{ accountId: string; adminId: string; stageId: string }> {
  const adminId = await criarUsuario(email)
  const accountId = await comoUsuario(
    adminId,
    async (cli) =>
      (await cli.query<{ id: string }>('select public.criar_conta($1) as id', ['Conta B'])).rows[0]
        .id,
  )
  const stageId = await comoServico(
    async (cli) =>
      (
        await cli.query<{ id: string }>(
          `select s.id from public.stages s
             join public.pipelines p on p.id = s.pipeline_id
            where p.account_id = $1 and s.nome = 'Novo lead'`,
          [accountId],
        )
      ).rows[0].id,
  )
  return { accountId, adminId, stageId }
}

describe('0016 — snapshot de etapa em stage_history/lead_tags, por trigger, com backfill e FKs set null', () => {
  let c: Cenario
  let novo: string
  let contato: string

  beforeAll(async () => {
    await limparBanco()
    c = await montarCenario()
    novo = etapa(c, 'Novo lead')
    contato = etapa(c, 'Contato feito')
  })

  it('trigger preenche o snapshot num insert direto em stage_history, sobrescrevendo o valor do cliente', async () => {
    const leadId = await criarLead(c, 'Lead mentira', c.vendedorAId, novo)

    const rowId = await comoUsuario(
      c.vendedorAId,
      async (cli) =>
        (
          await cli.query<{ id: string }>(
            `insert into public.stage_history
               (lead_id, stage_origem, stage_destino, movido_por,
                stage_destino_nome, stage_destino_ordem, stage_destino_tipo)
             values ($1, $2, $3, $4, 'MENTIRA', 999, 'perdido')
             returning id`,
            [leadId, novo, contato, c.vendedorAId],
          )
        ).rows[0].id,
    )

    const linha = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_destino_nome, stage_destino_ordem, stage_destino_tipo
               from public.stage_history where id = $1`,
            [rowId],
          )
        ).rows[0],
    )

    const contatoEtapa = c.etapas.find((e) => e.nome === 'Contato feito')!
    expect(linha.stage_destino_nome).toBe(contatoEtapa.nome)
    expect(linha.stage_destino_ordem).toBe(contatoEtapa.ordem)
    expect(linha.stage_destino_tipo).toBe(contatoEtapa.tipo)
  })

  it('stage_origem nulo deixa o snapshot de origem nulo (forma que ingerir_lead grava o nascimento)', async () => {
    const leadId = await criarLead(c, 'Lead nascimento', c.vendedorAId, novo)

    const rowId = await comoServico(
      async (cli) =>
        (
          await cli.query<{ id: string }>(
            `insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
             values ($1, null, $2, null)
             returning id`,
            [leadId, novo],
          )
        ).rows[0].id,
    )

    const linha = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_origem_nome, stage_origem_ordem, stage_origem_tipo,
                    stage_destino_nome, stage_destino_ordem, stage_destino_tipo
               from public.stage_history where id = $1`,
            [rowId],
          )
        ).rows[0],
    )

    expect(linha.stage_origem_nome).toBeNull()
    expect(linha.stage_origem_ordem).toBeNull()
    expect(linha.stage_origem_tipo).toBeNull()

    const novaEtapa = c.etapas.find((e) => e.nome === 'Novo lead')!
    expect(linha.stage_destino_nome).toBe(novaEtapa.nome)
    expect(linha.stage_destino_ordem).toBe(novaEtapa.ordem)
    expect(linha.stage_destino_tipo).toBe(novaEtapa.tipo)
  })

  it('trigger preenche lead_tags num insert direto', async () => {
    const leadId = await criarLead(c, 'Lead com etiqueta', c.vendedorAId, novo)
    const tagId = await comoServico(
      async (cli) =>
        (
          await cli.query<{ id: string }>(
            `insert into public.tags (account_id, nome, criado_por) values ($1, 'Etiqueta 0016', $2) returning id`,
            [c.accountId, c.vendedorAId],
          )
        ).rows[0].id,
    )

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
         values ($1, $2, $3, $4)`,
        [leadId, tagId, novo, c.vendedorAId],
      ),
    )

    const linha = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_nome_no_momento, stage_ordem_no_momento, stage_tipo_no_momento
               from public.lead_tags where lead_id = $1 and tag_id = $2`,
            [leadId, tagId],
          )
        ).rows[0],
    )

    const novaEtapa = c.etapas.find((e) => e.nome === 'Novo lead')!
    expect(linha.stage_nome_no_momento).toBe(novaEtapa.nome)
    expect(linha.stage_ordem_no_momento).toBe(novaEtapa.ordem)
    expect(linha.stage_tipo_no_momento).toBe(novaEtapa.tipo)
  })

  it('stage_destino nulo no insert e recusado com etapa_invalida', async () => {
    const leadId = await criarLead(c, 'Lead sem destino', c.vendedorAId, novo)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
           values ($1, $2, null, $3)`,
          [leadId, novo, c.vendedorAId],
        ),
      ),
    ).rejects.toThrow(/etapa_invalida/)
  })

  it('etapa de outra conta e recusada (RLS de stages dentro do trigger security invoker)', async () => {
    const outra = await segundaConta('admin-b@0016.com')
    const leadId = await criarLead(c, 'Lead isolamento', c.vendedorAId, novo)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
           values ($1, $2, $3, $4)`,
          [leadId, novo, outra.stageId, c.vendedorAId],
        ),
      ),
    ).rejects.toThrow(/etapa_invalida/)
  })

  it('backfill_snapshot_etapas reconstroi snapshot corrompido', async () => {
    const leadId = await criarLead(c, 'Lead backfill', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [leadId, contato, null]),
    )
    const tagId = await comoServico(
      async (cli) =>
        (
          await cli.query<{ id: string }>(
            `insert into public.tags (account_id, nome, criado_por) values ($1, 'Etiqueta backfill', $2) returning id`,
            [c.accountId, c.vendedorAId],
          )
        ).rows[0].id,
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
         values ($1, $2, $3, $4)`,
        [leadId, tagId, contato, c.vendedorAId],
      ),
    )

    await comoServico((cli) =>
      cli.query(`update public.stage_history set stage_destino_nome = 'CORROMPIDO' where lead_id = $1`, [
        leadId,
      ]),
    )
    await comoServico((cli) =>
      cli.query(`update public.lead_tags set stage_nome_no_momento = 'CORROMPIDO' where lead_id = $1`, [
        leadId,
      ]),
    )

    await comoServico((cli) => cli.query('select public.backfill_snapshot_etapas()'))

    const contatoEtapa = c.etapas.find((e) => e.nome === 'Contato feito')!
    const historico = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_destino_nome, stage_destino_ordem, stage_destino_tipo
               from public.stage_history where lead_id = $1`,
            [leadId],
          )
        ).rows[0],
    )
    expect(historico.stage_destino_nome).toBe(contatoEtapa.nome)
    expect(historico.stage_destino_ordem).toBe(contatoEtapa.ordem)
    expect(historico.stage_destino_tipo).toBe(contatoEtapa.tipo)

    const tag = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_nome_no_momento, stage_ordem_no_momento, stage_tipo_no_momento
               from public.lead_tags where lead_id = $1 and tag_id = $2`,
            [leadId, tagId],
          )
        ).rows[0],
    )
    expect(tag.stage_nome_no_momento).toBe(contatoEtapa.nome)
    expect(tag.stage_ordem_no_momento).toBe(contatoEtapa.ordem)
    expect(tag.stage_tipo_no_momento).toBe(contatoEtapa.tipo)
  })

  it('backfill_snapshot_etapas nao e executavel por authenticated', async () => {
    await expect(
      comoUsuario(c.vendedorAId, (cli) => cli.query('select public.backfill_snapshot_etapas()')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('apagar a etapa preserva o snapshot e anula a FK', async () => {
    const descartavelId = await comoServico(
      async (cli) =>
        (
          await cli.query<{ id: string }>(
            `insert into public.stages (pipeline_id, nome, ordem, tipo)
             values ($1, 'Etapa descartavel', 100, 'aberta')
             returning id`,
            [c.pipelineId],
          )
        ).rows[0].id,
    )

    const leadId = await criarLead(c, 'Lead etapa descartavel', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [leadId, descartavelId, null]),
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [leadId, contato, null]),
    )

    const tagId = await comoServico(
      async (cli) =>
        (
          await cli.query<{ id: string }>(
            `insert into public.tags (account_id, nome, criado_por) values ($1, 'Etiqueta descartavel', $2) returning id`,
            [c.accountId, c.vendedorAId],
          )
        ).rows[0].id,
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
         values ($1, $2, $3, $4)`,
        [leadId, tagId, descartavelId, c.vendedorAId],
      ),
    )

    await comoServico((cli) => cli.query('delete from public.stages where id = $1', [descartavelId]))

    const linhas = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_origem, stage_origem_nome, stage_origem_ordem, stage_origem_tipo,
                    stage_destino, stage_destino_nome, stage_destino_ordem, stage_destino_tipo
               from public.stage_history where lead_id = $1 order by criado_em`,
            [leadId],
          )
        ).rows,
    )

    // Segunda linha da lista completa do lead (a primeira e a entrada em
    // 'novo' vinda de criarLead nao existe — criarLead so grava leads.stage_id,
    // quem grava stage_history e move_lead_stage): [0] moveu para a
    // descartavel (destino), [1] moveu dela para 'Contato feito' (origem).
    const paraDescartavel = linhas.find((l) => l.stage_destino_nome === 'Etapa descartavel')
    const daDescartavel = linhas.find((l) => l.stage_origem_nome === 'Etapa descartavel')

    expect(paraDescartavel).toBeTruthy()
    expect(paraDescartavel.stage_destino).toBeNull()
    expect(paraDescartavel.stage_destino_ordem).toBe(100)
    expect(paraDescartavel.stage_destino_tipo).toBe('aberta')

    expect(daDescartavel).toBeTruthy()
    expect(daDescartavel.stage_origem).toBeNull()
    expect(daDescartavel.stage_origem_ordem).toBe(100)
    expect(daDescartavel.stage_origem_tipo).toBe('aberta')

    const tag = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select stage_id_no_momento, stage_nome_no_momento, stage_ordem_no_momento, stage_tipo_no_momento
               from public.lead_tags where lead_id = $1 and tag_id = $2`,
            [leadId, tagId],
          )
        ).rows[0],
    )
    expect(tag.stage_id_no_momento).toBeNull()
    expect(tag.stage_nome_no_momento).toBe('Etapa descartavel')
    expect(tag.stage_ordem_no_momento).toBe(100)
    expect(tag.stage_tipo_no_momento).toBe('aberta')
  })
})
