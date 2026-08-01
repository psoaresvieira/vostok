import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'
import { SupabaseCrmStore } from '@/lib/data/supabase'
import { clienteDoUsuario } from './helpers/cliente'
import { criarFonteMeta, registrarEntrega, SEGREDO } from './helpers/ingestao'

// Janela ampla o bastante para nao interferir nos testes que nao sao sobre a
// borda [de, ate) em si -- so o teste de semiabertura usa uma janela propria.
const DE = new Date('2000-01-01T00:00:00Z')
const ATE = new Date('2100-01-01T00:00:00Z')

type LinhaCoorte = {
  lead_id: string
  criado_em: Date
  origem: string
  status: string
  responsavel_id: string | null
  campanha_id: string | null
  campanha_nome: string | null
  conjunto_id: string | null
  conjunto_nome: string | null
  anuncio_id: string | null
  anuncio_nome: string | null
  ordem_max: number
}

type LinhaEtiqueta = {
  lead_id: string
  tag_id: string
  tag_nome: string
  stage_id_no_momento: string
  ordem_no_momento: number
}

describe('0014 — RPCs de metricas: metricas_coorte e metricas_etiquetas', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('ordem_max e a maior etapa ABERTA ja ocupada, e lead perdido nao herda a ordem de Perdido', async () => {
    // Perdido tem ordem 7, maior que toda etapa aberta. Sem o filtro por
    // tipo, todo lead perdido apareceria no fundo do funil.
    const novo = etapa(c, 'Novo lead')
    const contato = etapa(c, 'Contato feito')
    const perdido = etapa(c, 'Perdido')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, contato]),
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [leadId, perdido, c.motivoId]),
    )

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const linha = r.rows.find((x) => x.lead_id === leadId)
    expect(linha).toBeDefined()
    expect(linha!.ordem_max).toBe(2)
  })

  it('lead que pulou etapa reporta a ordem do destino', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, proposta]),
    )

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const linha = r.rows.find((x) => x.lead_id === leadId)
    expect(linha!.ordem_max).toBe(4)
  })

  it('lead que voltou etapa mantem a ordem maxima ja alcancada', async () => {
    // Prova a metade `stage_origem` da uniao: o lead NASCE direto em
    // 'Proposta' (ordem 4) -- logo nenhum movimento jamais grava Proposta
    // como stage_destino -- e so entao volta para 'Contato feito' (ordem 2).
    // O historico fica com uma unica linha, (origem: Proposta, destino:
    // Contato feito). Depois de voltar, nem o stage_id atual nem nenhum
    // stage_destino do historico valem 4; so a stage_origem do movimento de
    // volta carrega essa profundidade.
    const proposta = etapa(c, 'Proposta')
    const contato = etapa(c, 'Contato feito')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, proposta)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, contato]),
    )

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const linha = r.rows.find((x) => x.lead_id === leadId)
    expect(linha!.ordem_max).toBe(4)
  })

  it('lead sem movimento nenhum reporta a ordem da etapa em que nasceu', async () => {
    // Lead manual nao gera stage_history: a uniao tem que incluir o stage_id
    // atual, senao todo lead recem-criado sairia com ordem_max 0.
    const novo = etapa(c, 'Novo lead')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const linha = r.rows.find((x) => x.lead_id === leadId)
    expect(linha!.ordem_max).toBe(1)
  })

  it('lead que nasceu direto numa etapa nao-aberta reporta ordem_max 0', async () => {
    // move_lead_stage e o unico caminho suportado de troca de etapa, e tanto a
    // criacao manual (funil/acoes.ts) quanto ingerir_lead (0011) sempre colocam
    // o lead na primeira etapa de tipo 'aberta' do pipeline -- nenhum caminho
    // da aplicacao cria um lead direto em Ganho/Perdido. O insert abaixo (via
    // criarLead, o mesmo helper ja usado no resto do arquivo) escreve a linha
    // de leads direto na tabela, sem passar por move_lead_stage, entao nao ha
    // stage_history nenhum e o stage_id atual e de uma etapa nao-aberta. E o
    // unico jeito de alcancar o caso que o coalesce(..., 0) da 0014 existe
    // para cobrir: NAO e um estado que a aplicacao real produz.
    const perdido = etapa(c, 'Perdido')
    const leadId = await criarLead(c, 'Lead direto em Perdido', c.vendedorAId, perdido)

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const linha = r.rows.find((x) => x.lead_id === leadId)
    expect(linha).toBeDefined()
    expect(linha!.ordem_max).toBe(0)
  })

  it('a coorte e semiaberta em criado_em: [de, ate)', async () => {
    // Dois periodos adjacentes nunca podem contar o mesmo lead duas vezes.
    const de = new Date('2026-03-01T00:00:00Z')
    const ate = new Date('2026-03-08T00:00:00Z')
    const novo = etapa(c, 'Novo lead')

    const leadEmDe = await criarLead(c, 'Lead em De', c.vendedorAId, novo)
    await comoServico((cli) =>
      cli.query('update public.leads set criado_em = $1 where id = $2', [de, leadEmDe]),
    )
    const leadEmAte = await criarLead(c, 'Lead em Ate', c.vendedorAId, novo)
    await comoServico((cli) =>
      cli.query('update public.leads set criado_em = $1 where id = $2', [ate, leadEmAte]),
    )

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, de, ate, null],
      ),
    )
    const ids = r.rows.map((x) => x.lead_id)
    expect(ids).toContain(leadEmDe)
    expect(ids).not.toContain(leadEmAte)
  })

  it('vendedor so recebe a coorte dele, e o admin recebe a conta inteira', async () => {
    // O teste que nao se abre mao: este projeto ja corrigiu duas falhas de
    // isolamento entre contas. As duas chamadas usam os MESMOS argumentos —
    // a unica diferenca e quem chama. Sem a RLS, os dois numeros seriam iguais.
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const args = [c.pipelineId, DE, ATE, null]

    const comoVendedor = await comoUsuario(c.vendedorAId, (cli) =>
      cli.query<LinhaCoorte>('select * from public.metricas_coorte($1, $2, $3, $4)', args),
    )
    const comoAdmin = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>('select * from public.metricas_coorte($1, $2, $3, $4)', args),
    )

    expect(comoVendedor.rows).toHaveLength(1)
    expect(comoAdmin.rows).toHaveLength(2)
  })

  it('p_responsavel_id filtra a coorte mesmo quando quem chama e admin', async () => {
    // Chamando sempre como admin: a RLS ja deixa passar a conta inteira, entao
    // se o argumento nao filtrasse nada os dois numeros sairiam iguais. A
    // narrowing tem que vir do parametro, nao da RLS.
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A 1', c.vendedorAId, novo)
    await criarLead(c, 'Lead do A 2', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const comFiltro = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, c.vendedorAId],
      ),
    )
    const semFiltro = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaCoorte>(
        'select * from public.metricas_coorte($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )

    expect(comFiltro.rows).toHaveLength(2)
    expect(comFiltro.rows.every((x) => x.responsavel_id === c.vendedorAId)).toBe(true)
    expect(semFiltro.rows).toHaveLength(3)
  })

  it('metricas_etiquetas devolve a etapa congelada e a ordem dela', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, proposta]),
    )

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
        [leadId, tagId, proposta, c.vendedorAId],
      ),
    )

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaEtiqueta>(
        'select * from public.metricas_etiquetas($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const linha = r.rows.find((x) => x.lead_id === leadId)
    expect(linha).toMatchObject({ tag_nome: 'Preço alto', ordem_no_momento: 4 })
  })

  it('metricas_etiquetas respeita a mesma janela e o mesmo recorte de RLS', async () => {
    // etiqueta num lead fora da janela nao aparece; etiqueta em lead de
    // outro vendedor nao aparece para o vendedor.
    const novo = etapa(c, 'Novo lead')

    const leadDentro = await criarLead(c, 'Lead dentro da janela', c.vendedorAId, novo)
    const leadFora = await criarLead(c, 'Lead fora da janela', c.vendedorAId, novo)
    await comoServico((cli) =>
      cli.query('update public.leads set criado_em = $1 where id = $2', [
        new Date('1999-01-01T00:00:00Z'),
        leadFora,
      ]),
    )
    const leadDoB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const tagId = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'Preço alto', $2) returning id`,
          [c.accountId, c.vendedorAId],
        )
      ).rows[0].id,
    )
    for (const [leadId, dono] of [
      [leadDentro, c.vendedorAId],
      [leadFora, c.vendedorAId],
      [leadDoB, c.vendedorBId],
    ] as const) {
      await comoUsuario(dono, (cli) =>
        cli.query(
          `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
           values ($1, $2, $3, $4)`,
          [leadId, tagId, novo, dono],
        ),
      )
    }

    const r = await comoUsuario(c.vendedorAId, (cli) =>
      cli.query<LinhaEtiqueta>(
        'select * from public.metricas_etiquetas($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, null],
      ),
    )
    const ids = r.rows.map((x) => x.lead_id)
    expect(ids).toContain(leadDentro)
    expect(ids).not.toContain(leadFora)
    expect(ids).not.toContain(leadDoB)
  })

  it('p_responsavel_id filtra metricas_etiquetas mesmo quando quem chama e admin', async () => {
    // Mesma logica do teste analogo em metricas_coorte: chamando como admin, a
    // etiqueta do lead de outro vendedor so pode sumir por causa do argumento.
    const novo = etapa(c, 'Novo lead')
    const leadDoA = await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    const leadDoB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const tagId = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'Preço alto', $2) returning id`,
          [c.accountId, c.vendedorAId],
        )
      ).rows[0].id,
    )
    for (const [leadId, dono] of [
      [leadDoA, c.vendedorAId],
      [leadDoB, c.vendedorBId],
    ] as const) {
      await comoUsuario(dono, (cli) =>
        cli.query(
          `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
           values ($1, $2, $3, $4)`,
          [leadId, tagId, novo, dono],
        ),
      )
    }

    const r = await comoUsuario(c.adminId, (cli) =>
      cli.query<LinhaEtiqueta>(
        'select * from public.metricas_etiquetas($1, $2, $3, $4)',
        [c.pipelineId, DE, ATE, c.vendedorAId],
      ),
    )
    const ids = r.rows.map((x) => x.lead_id)
    expect(ids).toContain(leadDoA)
    expect(ids).not.toContain(leadDoB)
  })

  it('as duas funcoes sao security invoker', async () => {
    // security definer aqui desligaria a RLS e devolveria a conta inteira
    // para qualquer chamador. E uma letra de diferenca no DDL.
    const r = await comoServico((cli) =>
      cli.query<{ proname: string; prosecdef: boolean }>(
        `select proname, prosecdef from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('metricas_coorte', 'metricas_etiquetas')`,
      ),
    )
    expect(r.rows).toHaveLength(2)
    expect(r.rows.every((x) => x.prosecdef === false)).toBe(true)
  })

  it('SupabaseCrmStore.metricasDaCoorte mapeia todos os doze campos', async () => {
    // Ingere via ingerir_lead (0011/0013), unico caminho que grava os oito
    // campos de rastreamento, e chama pelo store — prova que o snake_case do
    // RPC vira camelCase sem perder nem trocar nenhum dos doze campos.
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)

    const ingestao = await comoServico((cli) =>
      cli.query<{ resultado: { lead_id: string } }>(
        `select public.ingerir_lead($1, $2, $3) as resultado`,
        [
          SEGREDO,
          entrega.log_id,
          JSON.stringify({
            nome: 'Rastreado',
            email: 'rastreado@example.com',
            campanha_id: 'camp-1',
            campanha_nome: 'Campanha de Verao',
            conjunto_id: 'adset-1',
            conjunto_nome: 'Conjunto Interesse',
            anuncio_id: 'ad-1',
            anuncio_nome: 'Video 15s',
            formulario_id: 'form-1',
            click_id: 'click-1',
            extras: {},
          }),
        ],
      ),
    )
    const leadId = ingestao.rows[0].resultado.lead_id

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const r = await store.metricasDaCoorte({ pipelineId: c.pipelineId, de: DE, ate: ATE })
    if (!r.ok) throw new Error(r.erro)
    const linha = r.valor.find((l) => l.leadId === leadId)
    expect(linha).toBeDefined()
    expect(Object.keys(linha!).sort()).toEqual([
      'anuncioId', 'anuncioNome', 'campanhaId', 'campanhaNome', 'conjuntoId',
      'conjuntoNome', 'criadoEm', 'leadId', 'ordemMax', 'origem',
      'responsavelId', 'status',
    ])
    expect(linha!.criadoEm).toBeInstanceOf(Date)
  })

  it('authenticated tem execute nas duas', async () => {
    // O default ACL do schema public nesta imagem nao concede execute: sem
    // grant explicito a chamada morre em permission denied.
    const r = await comoServico((cli) =>
      cli.query<{ proname: string; pode: boolean }>(
        `select proname, has_function_privilege('authenticated', oid, 'execute') as pode
           from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('metricas_coorte', 'metricas_etiquetas')`,
      ),
    )
    expect(r.rows.every((x) => x.pode)).toBe(true)
  })
})
