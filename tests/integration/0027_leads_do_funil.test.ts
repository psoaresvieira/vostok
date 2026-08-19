import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

/**
 * `leads_do_funil` (migration 0027): a paginacao por etapa do quadro.
 *
 * O que precisa ficar trancado aqui, e que a versao anterior (um `select *`
 * da pipeline inteira recortado em JS) nao tinha como quebrar:
 *
 *  - o limite e' POR ETAPA, nao por consulta: 50 na coluna A nao roubam
 *    espaco da coluna B;
 *  - `total` e `soma` contam a etapa INTEIRA, nao a pagina — e' o que o
 *    cabecalho da coluna mostra;
 *  - `soma` e' NULL quando ninguem preencheu valor, e nao zero;
 *  - a ordem e' estavel entre paginas (criado_em desc, id desc), senao o
 *    "carregar mais" repete ou pula cartao;
 *  - `security invoker`: o vendedor conta e soma SO' o que ele ve.
 */

type Linha = {
  id: string
  nome: string
  stage_id: string
  responsavel_id: string | null
  valor_cents: number | null
  etiquetas: { id: string; nome: string }[]
  total_na_etapa: string
  soma_cents_na_etapa: string | null
}

async function funil(
  userId: string,
  args: {
    pipelineId: string
    limite?: number
    offset?: number
    stageId?: string | null
    responsavelId?: string | null
    origem?: string | null
    desde?: string | null
    busca?: string | null
  },
): Promise<Linha[]> {
  return comoUsuario(userId, async (c) => {
    const r = await c.query<Linha>(
      `select * from public.leads_do_funil($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        args.pipelineId,
        args.limite ?? 50,
        args.offset ?? 0,
        args.stageId ?? null,
        args.responsavelId ?? null,
        args.origem ?? null,
        args.desde ?? null,
        args.busca ?? null,
      ],
    )
    return r.rows
  })
}

/** Leads com criado_em controlado, para a ordem ser deterministica. */
async function semearLeads(
  c: Cenario,
  etapaId: string,
  quantos: number,
  extras: { responsavelId?: string | null; valorCents?: number | null; prefixo?: string } = {},
): Promise<void> {
  await comoServico(async (cli) => {
    for (let i = 0; i < quantos; i++) {
      await cli.query(
        `insert into public.leads
           (account_id, nome, pipeline_id, stage_id, responsavel_id, valor_cents, criado_em)
         values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' minutes')::interval)`,
        [
          c.accountId,
          `${extras.prefixo ?? 'Lead'} ${String(i).padStart(3, '0')}`,
          c.pipelineId,
          etapaId,
          extras.responsavelId ?? null,
          extras.valorCents ?? null,
          i,
        ],
      )
    }
  })
}

describe('0027 — leads_do_funil', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('Caso 1: o limite e por ETAPA — cada coluna recebe a propria pagina', async () => {
    const novo = etapa(c, 'Novo lead')
    const contato = etapa(c, 'Contato feito')
    await semearLeads(c, novo, 5, { prefixo: 'N' })
    await semearLeads(c, contato, 4, { prefixo: 'C' })

    const linhas = await funil(c.adminId, { pipelineId: c.pipelineId, limite: 2 })

    expect(linhas.filter((l) => l.stage_id === novo)).toHaveLength(2)
    expect(linhas.filter((l) => l.stage_id === contato)).toHaveLength(2)
  })

  it('Caso 2: total e soma contam a etapa inteira, nao a pagina', async () => {
    const novo = etapa(c, 'Novo lead')
    await semearLeads(c, novo, 6, { valorCents: 1000 })

    const linhas = await funil(c.adminId, { pipelineId: c.pipelineId, limite: 2 })

    expect(linhas).toHaveLength(2)
    expect(Number(linhas[0].total_na_etapa)).toBe(6)
    expect(Number(linhas[0].soma_cents_na_etapa)).toBe(6000)
  })

  it('Caso 3: soma e NULL quando nenhum lead da etapa tem valor', async () => {
    const novo = etapa(c, 'Novo lead')
    await semearLeads(c, novo, 3, { valorCents: null })

    const linhas = await funil(c.adminId, { pipelineId: c.pipelineId })

    expect(linhas[0].soma_cents_na_etapa).toBeNull()
    // Um unico lead com valor 0 ja e' "preenchido": a soma vira 0, nao NULL.
    await semearLeads(c, novo, 1, { valorCents: 0, prefixo: 'Zero' })
    const comZero = await funil(c.adminId, { pipelineId: c.pipelineId })
    expect(Number(comZero[0].soma_cents_na_etapa)).toBe(0)
  })

  it('Caso 4: paginacao nao repete nem pula — offset continua de onde parou', async () => {
    const novo = etapa(c, 'Novo lead')
    await semearLeads(c, novo, 7)

    const pagina1 = await funil(c.adminId, { pipelineId: c.pipelineId, limite: 3, stageId: novo })
    const pagina2 = await funil(c.adminId, {
      pipelineId: c.pipelineId,
      limite: 3,
      offset: 3,
      stageId: novo,
    })
    const pagina3 = await funil(c.adminId, {
      pipelineId: c.pipelineId,
      limite: 3,
      offset: 6,
      stageId: novo,
    })

    const ids = [...pagina1, ...pagina2, ...pagina3].map((l) => l.id)
    expect(ids).toHaveLength(7)
    expect(new Set(ids).size).toBe(7)
    // criado_em desc: o semeado com i=0 (mais recente) vem primeiro.
    expect(pagina1[0].nome).toBe('Lead 000')
  })

  it('Caso 5: stage_id recorta a UMA etapa — o "carregar mais" nao repagina as outras', async () => {
    const novo = etapa(c, 'Novo lead')
    const contato = etapa(c, 'Contato feito')
    await semearLeads(c, novo, 3, { prefixo: 'N' })
    await semearLeads(c, contato, 3, { prefixo: 'C' })

    const linhas = await funil(c.adminId, { pipelineId: c.pipelineId, stageId: contato })

    expect(linhas.every((l) => l.stage_id === contato)).toBe(true)
    expect(linhas).toHaveLength(3)
  })

  it('Caso 6: vendedor conta e soma so os leads dele — a RLS vale dentro da funcao', async () => {
    const novo = etapa(c, 'Novo lead')
    await semearLeads(c, novo, 4, { responsavelId: c.vendedorAId, valorCents: 100, prefixo: 'A' })
    await semearLeads(c, novo, 6, { responsavelId: c.vendedorBId, valorCents: 100, prefixo: 'B' })

    const doVendedor = await funil(c.vendedorAId, { pipelineId: c.pipelineId })
    expect(Number(doVendedor[0].total_na_etapa)).toBe(4)
    expect(Number(doVendedor[0].soma_cents_na_etapa)).toBe(400)
    expect(doVendedor.every((l) => l.responsavel_id === c.vendedorAId)).toBe(true)

    // O admin ve os dez, mesmo cenario e mesma funcao.
    const doAdmin = await funil(c.adminId, { pipelineId: c.pipelineId })
    expect(Number(doAdmin[0].total_na_etapa)).toBe(10)
  })

  it('Caso 7: busca com % e _ e literal, nao curinga', async () => {
    const novo = etapa(c, 'Novo lead')
    await comoServico((cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id) values
           ($1, '100% garantido', $2, $3),
           ($1, '1000 leads', $2, $3)`,
        [c.accountId, c.pipelineId, novo],
      ),
    )

    const r = await funil(c.adminId, { pipelineId: c.pipelineId, busca: '100%' })

    expect(r.map((l) => l.nome)).toEqual(['100% garantido'])
  })

  it('Caso 8: etiquetas vem embutidas, e [] quando o lead nao tem nenhuma', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadId = await comoServico(async (cli) => {
      const l = await cli.query<{ id: string }>(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id)
         values ($1, 'Com etiqueta', $2, $3) returning id`,
        [c.accountId, c.pipelineId, novo],
      )
      const t = await cli.query<{ id: string }>(
        `insert into public.tags (account_id, nome) values ($1, 'quente') returning id`,
        [c.accountId],
      )
      await cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento)
         values ($1, $2, $3)`,
        [l.rows[0].id, t.rows[0].id, novo],
      )
      return l.rows[0].id
    })
    await semearLeads(c, novo, 1, { prefixo: 'Sem etiqueta' })

    const linhas = await funil(c.adminId, { pipelineId: c.pipelineId })
    const comTag = linhas.find((l) => l.id === leadId)!
    const semTag = linhas.find((l) => l.id !== leadId)!

    expect(comTag.etiquetas).toEqual([{ id: expect.any(String), nome: 'quente' }])
    expect(semTag.etiquetas).toEqual([])
  })

  it('Caso 9: lead SEM responsavel some para o vendedor e aparece para o gestor', async () => {
    // A 0027 reescreveu pode_ver_lead de duas buscas em memberships para uma
    // so. O caso que a reescrita podia ter mudado sem ninguem notar e' este:
    // com responsavel_id NULL, a condicao do vendedor e' `NULL = uid`, que da
    // NULL — e NULL tem que valer como "nao ve", igual a versao anterior.
    const novo = etapa(c, 'Novo lead')
    await semearLeads(c, novo, 1, { responsavelId: null, prefixo: 'Orfao' })
    await semearLeads(c, novo, 1, { responsavelId: c.vendedorAId, prefixo: 'Meu' })

    const doVendedor = await funil(c.vendedorAId, { pipelineId: c.pipelineId })
    expect(doVendedor.map((l) => l.nome)).toEqual(['Meu 000'])
    expect(Number(doVendedor[0].total_na_etapa)).toBe(1)

    const doGestor = await funil(c.gestorId, { pipelineId: c.pipelineId })
    expect(Number(doGestor[0].total_na_etapa)).toBe(2)
  })

  it('Caso 10: pipeline de outra conta devolve zero linhas, nunca erro', async () => {
    const outra = await comoServico(async (cli) => {
      const a = await cli.query<{ id: string }>(
        `insert into public.accounts (nome) values ('Outra') returning id`,
      )
      const p = await cli.query<{ id: string }>(
        `insert into public.pipelines (account_id, nome, is_default)
         values ($1, 'Funil', true) returning id`,
        [a.rows[0].id],
      )
      const s = await cli.query<{ id: string }>(
        `insert into public.stages (pipeline_id, nome, ordem, tipo)
         values ($1, 'Novo', 1, 'aberta') returning id`,
        [p.rows[0].id],
      )
      await cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id)
         values ($1, 'Alheio', $2, $3)`,
        [a.rows[0].id, p.rows[0].id, s.rows[0].id],
      )
      return p.rows[0].id
    })

    const r = await funil(c.adminId, { pipelineId: outra })
    expect(r).toEqual([])
  })
})
