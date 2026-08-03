import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

// Janela ampla o bastante para nao interferir nos testes: p_de antes da
// criacao de qualquer lead, p_ate depois.
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
  stage_id_no_momento: string | null
  ordem_no_momento: number
}

async function buscarCoorte(c: Cenario, comoQuem: string) {
  return comoUsuario(comoQuem, (cli) =>
    cli.query<LinhaCoorte>(
      'select * from public.metricas_coorte($1, $2, $3, $4)',
      [c.pipelineId, DE, ATE, null],
    ),
  )
}

async function buscarEtiquetas(c: Cenario, comoQuem: string) {
  return comoUsuario(comoQuem, (cli) =>
    cli.query<LinhaEtiqueta>(
      'select * from public.metricas_etiquetas($1, $2, $3, $4)',
      [c.pipelineId, DE, ATE, null],
    ),
  )
}

describe('0017 — metricas leem o snapshot: excluir etapa nao reescreve o passado', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  /**
   * Cenario base, comum aos casos 1-3: dois leads nascem em "Novo lead". O
   * lead 1 sobe ate "Qualificacao" (ordem 3), recebe uma etiqueta congelada
   * la, e volta para "Contato feito" (ordem 2) — ninguem fica dentro de
   * "Qualificacao" no fim, entao ela pode ser apagada pelo servico. O lead 2
   * vai direto de "Novo lead" para "Perdido".
   */
  async function montarCenarioBase() {
    const novo = etapa(c, 'Novo lead')
    const qualificacao = etapa(c, 'Qualificação')
    const contato = etapa(c, 'Contato feito')
    const perdido = etapa(c, 'Perdido')

    const lead1 = await criarLead(c, 'Lead 1', c.vendedorAId, novo)
    const lead2 = await criarLead(c, 'Lead 2', c.vendedorAId, novo)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [lead1, qualificacao]),
    )

    const tagId = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'Quente', $2) returning id`,
          [c.accountId, c.vendedorAId],
        )
      ).rows[0].id,
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
         values ($1, $2, $3, $4)`,
        [lead1, tagId, qualificacao, c.vendedorAId],
      ),
    )

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [lead1, contato]),
    )

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [lead2, perdido, c.motivoId]),
    )

    return { lead1, lead2, tagId, qualificacao }
  }

  it('Caso 1: excluir a etapa nao muda ordem_max de ninguem', async () => {
    // Sem o snapshot, apagar "Qualificacao" faria o max() de metricas_coorte
    // colapsar de 3 para 2 em silencio para o lead 1 -- este e o caso que da
    // razao de ser ao plano inteiro.
    const { lead1, qualificacao } = await montarCenarioBase()

    const antes = await buscarCoorte(c, c.adminId)
    const mapaAntes = new Map(antes.rows.map((r) => [r.lead_id, r.ordem_max]))
    expect(mapaAntes.get(lead1)).toBe(3)

    await comoServico((cli) => cli.query('delete from public.stages where id = $1', [qualificacao]))

    const depois = await buscarCoorte(c, c.adminId)
    const mapaDepois = new Map(depois.rows.map((r) => [r.lead_id, r.ordem_max]))

    expect(mapaDepois).toEqual(mapaAntes)
  })

  it('Caso 2: excluir a etapa nao muda o ranking de etiquetas', async () => {
    // Antes, o inner join em stages fazia a linha inteira desaparecer quando
    // a etapa era apagada. Agora ela sobrevive, com stage_id_no_momento nulo.
    const { lead1, qualificacao } = await montarCenarioBase()

    const antes = await buscarEtiquetas(c, c.adminId)
    const linhaAntes = antes.rows.find((r) => r.lead_id === lead1)
    expect(linhaAntes).toMatchObject({ ordem_no_momento: 3, stage_id_no_momento: qualificacao })

    await comoServico((cli) => cli.query('delete from public.stages where id = $1', [qualificacao]))

    const depois = await buscarEtiquetas(c, c.adminId)
    const linhaDepois = depois.rows.find((r) => r.lead_id === lead1)
    expect(linhaDepois).toBeDefined()
    expect(linhaDepois).toMatchObject({ ordem_no_momento: 3, stage_id_no_momento: null })
  })

  it('Caso 3: lead perdido continua sem profundidade maxima', async () => {
    // O lead 2 foi de "Novo lead" (ordem 1, aberta) direto para "Perdido"
    // (ordem 7). Perdido nao e aberta, entao a profundidade maxima dele e a
    // maior etapa ABERTA que ele ocupou -- 1, nao 7. O filtro tipo = 'aberta'
    // agora vem do snapshot; este caso fica vermelho se ele cair na reescrita.
    const { lead2 } = await montarCenarioBase()

    const r = await buscarCoorte(c, c.adminId)
    const linha = r.rows.find((x) => x.lead_id === lead2)
    expect(linha).toBeDefined()
    expect(linha!.ordem_max).toBe(1)
    expect(linha!.ordem_max).not.toBe(7)
  })

  it('Caso 4: a uniao ainda inclui a etapa atual', async () => {
    // Lead que NASCE fundo (sem nenhuma movimentacao, logo sem linha de
    // stage_history) so pode ser contado pelo braco leads.stage_id -> stages.
    // Prova que esse braco sobreviveu a reescrita para snapshot.
    const proposta = etapa(c, 'Proposta')
    const lead3 = await criarLead(c, 'Lead 3', c.vendedorAId, proposta)

    const r = await buscarCoorte(c, c.adminId)
    const linha = r.rows.find((x) => x.lead_id === lead3)
    expect(linha).toBeDefined()
    expect(linha!.ordem_max).toBe(4)
  })

  it('Caso 5: o recorte por papel nao mudou', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const comoVendedor = await buscarCoorte(c, c.vendedorAId)
    const comoAdmin = await buscarCoorte(c, c.adminId)

    expect(comoVendedor.rows).toHaveLength(1)
    expect(comoAdmin.rows).toHaveLength(2)
  })
})
