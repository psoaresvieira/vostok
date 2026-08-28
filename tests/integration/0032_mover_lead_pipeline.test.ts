import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, criarContaAvulsa, criarLead, etapa, type Cenario } from './helpers/cenario'

/**
 * Segunda pipeline da conta, montada como a UI monta: insert em `pipelines`
 * e em `stages` sob RLS (nao existe RPC `criar_pipeline` — quem cria e'
 * `SupabaseCrmStore.criarPipeline`, em src/lib/data/supabase.ts). As linhas
 * espelham as daquele metodo: abertas em ordem 1..n, depois 'Ganho' e
 * 'Perdido'. `comoUsuario` e nao `comoServico` de proposito: assim a criacao
 * passa pelas policies `pipelines_membro_insert`/`stages_membro_insert`, e um
 * dia em que elas fecharem demais este helper quebra junto com o produto.
 */
async function segundaPipeline(c: Cenario, abertas: string[] = ['Onboarding', 'Ativo']) {
  const pipelineId = await comoUsuario(c.adminId, async (cli) => {
    const p = await cli.query<{ id: string }>(
      `insert into public.pipelines (account_id, nome, is_default)
       values ($1, $2, false) returning id`,
      [c.accountId, 'Pós-venda'],
    )
    const id = p.rows[0].id
    const linhas = [
      ...abertas.map((nome, i) => ({ nome, ordem: i + 1, tipo: 'aberta' })),
      { nome: 'Ganho', ordem: abertas.length + 1, tipo: 'ganho' },
      { nome: 'Perdido', ordem: abertas.length + 2, tipo: 'perdido' },
    ]
    for (const l of linhas) {
      await cli.query(
        'insert into public.stages (pipeline_id, nome, ordem, tipo) values ($1, $2, $3, $4)',
        [id, l.nome, l.ordem, l.tipo],
      )
    }
    return id
  })

  const etapas = await comoServico(
    async (cli) =>
      (
        await cli.query<{ id: string; nome: string; tipo: string }>(
          'select id, nome, tipo from public.stages where pipeline_id = $1 order by ordem',
          [pipelineId],
        )
      ).rows,
  )
  return { pipelineId, etapas }
}

/** Etapa aberta da pipeline padrao de uma conta VIZINHA — o forasteiro dos
 * testes de isolamento. */
async function etapaDeOutraConta(): Promise<string> {
  const forasteiro = await criarUsuario('forasteiro@vizinha.com')
  const contaId = await criarContaAvulsa(forasteiro, 'Conta Vizinha')
  return comoServico(
    async (cli) =>
      (
        await cli.query<{ id: string }>(
          `select s.id from public.stages s
             join public.pipelines p on p.id = s.pipeline_id
            where p.account_id = $1 and s.tipo = 'aberta'
            order by s.ordem
            limit 1`,
          [contaId],
        )
      ).rows[0].id,
  )
}

describe('0032 mover_lead_pipeline', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('troca pipeline_id e stage_id juntos, zera o relogio da etapa, grava stage_history e evento pipeline_alterada', async () => {
    const { pipelineId, etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapas[0].id]),
    )

    const lead = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select pipeline_id, stage_id, status,
                    entrou_na_etapa_em > now() - interval '5 seconds' as recente
               from public.leads where id = $1`,
            [leadId],
          )
        ).rows[0],
    )
    expect(lead).toMatchObject({
      pipeline_id: pipelineId,
      stage_id: etapas[0].id,
      status: 'aberto',
      recente: true,
    })

    const hist = await comoServico(
      async (cli) =>
        (
          await cli.query(
            'select stage_origem, stage_destino from public.stage_history where lead_id = $1',
            [leadId],
          )
        ).rows,
    )
    expect(hist).toEqual([{ stage_origem: etapa(c, 'Novo lead'), stage_destino: etapas[0].id }])

    const ev = await comoServico(
      async (cli) =>
        (
          await cli.query(
            `select payload from public.lead_events where lead_id = $1 and tipo = 'pipeline_alterada'`,
            [leadId],
          )
        ).rows[0].payload,
    )
    expect(ev).toMatchObject({
      de_pipeline: c.pipelineId,
      para_pipeline: pipelineId,
      de: etapa(c, 'Novo lead'),
      para: etapas[0].id,
      loss_reason_id: null,
    })
  })

  it('etapa da mesma pipeline: mesma_pipeline', async () => {
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapa(c, 'Qualificação')]),
      ),
    ).rejects.toThrow('mesma_pipeline')
  })

  it('etapa de outra conta: etapa_invalida', async () => {
    const alheia = await etapaDeOutraConta()
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, alheia]),
      ),
    ).rejects.toThrow('etapa_invalida')

    // A recusa e' total: nada foi escrito no lead.
    const lead = await comoServico(
      async (cli) =>
        (await cli.query('select pipeline_id, stage_id from public.leads where id = $1', [leadId]))
          .rows[0],
    )
    expect(lead).toEqual({ pipeline_id: c.pipelineId, stage_id: etapa(c, 'Novo lead') })
  })

  it('etapa perdido sem motivo: motivo_perda_obrigatorio', async () => {
    const { etapas } = await segundaPipeline(c)
    const perdido = etapas.find((e) => e.tipo === 'perdido')!
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, perdido.id]),
      ),
    ).rejects.toThrow('motivo_perda_obrigatorio')

    // Com o motivo da conta, o mesmo movimento passa e leva o lead para
    // 'perdido' na pipeline nova.
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.mover_lead_pipeline($1, $2, $3)', [leadId, perdido.id, c.motivoId]),
    )
    const lead = await comoServico(
      async (cli) =>
        (
          await cli.query(
            'select stage_id, status, loss_reason_id from public.leads where id = $1',
            [leadId],
          )
        ).rows[0],
    )
    expect(lead).toEqual({
      stage_id: perdido.id,
      status: 'perdido',
      loss_reason_id: c.motivoId,
    })
  })

  it('vendedor move o PROPRIO lead entre pipelines: a RLS de leads deixa passar', async () => {
    // O caso feliz acima roda como admin. Este prova o papel que de fato
    // arrasta cartao no dia a dia: o `with check` de leads_update (0007) nao
    // fala de pipeline, mas quem le a policy nao sabe disso sem uma
    // assercao — e uma guarda futura ali quebraria a funcionalidade inteira
    // para vendedor sem quebrar nenhum outro teste.
    const { pipelineId, etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapas[0].id]),
    )

    const lead = await comoServico(
      async (cli) =>
        (await cli.query('select pipeline_id, stage_id from public.leads where id = $1', [leadId]))
          .rows[0],
    )
    expect(lead).toEqual({ pipeline_id: pipelineId, stage_id: etapas[0].id })
  })

  it('vendedor nao move lead que nao ve: lead_nao_encontrado', async () => {
    const { etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await expect(
      comoUsuario(c.vendedorBId, (cli) =>
        cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapas[0].id]),
      ),
    ).rejects.toThrow('lead_nao_encontrado')
  })

  it('move_lead_stage recusa etapa de OUTRA pipeline (o buraco da 0004)', async () => {
    const { etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadId, etapas[0].id]),
      ),
    ).rejects.toThrow('etapa_invalida')

    const lead = await comoServico(
      async (cli) =>
        (await cli.query('select pipeline_id, stage_id from public.leads where id = $1', [leadId]))
          .rows[0],
    )
    expect(lead).toEqual({ pipeline_id: c.pipelineId, stage_id: etapa(c, 'Novo lead') })
  })
})
