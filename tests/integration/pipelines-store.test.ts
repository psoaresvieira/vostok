import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseCrmStore } from '@/lib/data/supabase'
import { leadSchema } from '@/lib/domain/lead'
import { comoServico, comoUsuario, limparBanco, criarUsuario } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { criarContaAvulsa, montarCenario, etapa, type Cenario } from './helpers/cenario'

/** Uma segunda conta, so para provar o isolamento — mesmo padrao usado em
 * admin-store.test.ts e 0004_move_lead_stage.test.ts: criar_conta ja semeia
 * a pipeline padrao dessa conta nova, que e o dado que o caso 2 precisa. */
async function outraConta(email: string): Promise<{ accountId: string; pipelineId: string }> {
  const userId = await criarUsuario(email)
  const accountId = await criarContaAvulsa(userId, 'Outra')
  const pipelineId = await comoServico(
    async (c) =>
      (await c.query<{ id: string }>('select id from public.pipelines where account_id = $1', [accountId]))
        .rows[0].id,
  )
  return { accountId, pipelineId }
}

describe('SupabaseCrmStore — multiplas pipelines', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('criar e reler: vendedor cria, pipelinePorId devolve etapas na ordem com Ganho/Perdido no fim', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const criado = await store.criarPipeline('Outbound', ['Prospecção', 'Contato'])
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.pipelinePorId(criado.valor)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.pipeline.nome).toBe('Outbound')
    expect(r.valor.pipeline.isDefault).toBe(false)
    expect(r.valor.etapas.map((e) => [e.nome, e.ordem, e.tipo])).toEqual([
      ['Prospecção', 1, 'aberta'],
      ['Contato', 2, 'aberta'],
      ['Ganho', 3, 'ganho'],
      ['Perdido', 4, 'perdido'],
    ])
  })

  it('isolamento entre contas: pipelinePorId de pipeline de outra conta falha com pipeline_nao_encontrado', async () => {
    const outra = await outraConta('fora-pipeline@z.com')
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const r = await store.pipelinePorId(outra.pipelineId)
    expect(r).toEqual({ ok: false, erro: 'pipeline_nao_encontrado' })
  })

  describe('excluirPipeline', () => {
    it('recusa a padrao com pipeline_padrao_nao_exclui', async () => {
      const cliente = await clienteDoUsuario(c.adminId)
      const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

      const r = await store.excluirPipeline(c.pipelineId)
      expect(r).toEqual({ ok: false, erro: 'pipeline_padrao_nao_exclui' })
    })

    it('recusa pipeline com leads com pipeline_com_leads', async () => {
      const cliente = await clienteDoUsuario(c.vendedorAId)
      const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)
      const nova = await store.pipelinePorId(criado.valor)
      if (!nova.ok) throw new Error(nova.erro)

      // responsavelId aponta pro proprio criador: vendedor so' le' de volta
      // (o insert usa .select().single()) lead que pode ver, e leads_select
      // restringe vendedor a responsavel_id = auth.uid(). Lead sem
      // responsavel e' visivel so' a gestor/admin — mesmo padrao de
      // supabase-store.test.ts, nao e' o que este caso quer exercitar.
      const lead = await store.criarLead({
        ...leadSchema.parse({ nome: 'Ana' }),
        pipelineId: nova.valor.pipeline.id,
        stageId: nova.valor.etapas[0].id,
        responsavelId: c.vendedorAId,
      })
      if (!lead.ok) throw new Error(lead.erro)

      const r = await store.excluirPipeline(criado.valor)
      expect(r).toEqual({ ok: false, erro: 'pipeline_com_leads' })
    })

    // Achado 2 do review final do Plano 14: a pre-checagem de excluirPipeline
    // contava leads com um SELECT comum, que roda sob a RLS do CHAMADOR — um
    // vendedor nao enxerga leads de colegas, entao a contagem dava 0, a
    // policy (helper security definer) barrava o delete do mesmo jeito, e o
    // store devolvia pipeline_nao_encontrado (mentira: a pipeline continua
    // la). Mesmo padrao de fixture do caso 6 de 0025_pipelines_por_membro:
    // lead plantado via comoServico, ignorando RLS, pertencendo a outro
    // vendedor.
    it('recusa com pipeline_com_leads mesmo quando o lead pertence so a um colega (RLS do chamador nao pode mascarar a contagem)', async () => {
      const cliente = await clienteDoUsuario(c.vendedorAId)
      const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)
      const nova = await store.pipelinePorId(criado.valor)
      if (!nova.ok) throw new Error(nova.erro)

      await comoServico((cli) =>
        cli.query(
          `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
           values ($1, 'Lead do vendedor B', $2, $3, $4)`,
          [c.accountId, nova.valor.pipeline.id, nova.valor.etapas[0].id, c.vendedorBId],
        ),
      )

      const r = await store.excluirPipeline(criado.valor)
      expect(r).toEqual({ ok: false, erro: 'pipeline_com_leads' })
    })

    it('exclui pipeline vazia com sucesso e ela some da listagem', async () => {
      const cliente = await clienteDoUsuario(c.vendedorAId)
      const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)

      const r = await store.excluirPipeline(criado.valor)
      expect(r).toEqual({ ok: true, valor: undefined })

      const lista = await store.listarPipelines()
      if (!lista.ok) throw new Error(lista.erro)
      expect(lista.valor.map((p) => p.id)).not.toContain(criado.valor)

      const buscada = await store.pipelinePorId(criado.valor)
      expect(buscada).toEqual({ ok: false, erro: 'pipeline_nao_encontrado' })
    })
  })

  it('listarLeads com pipelineId separa leads de pipelines diferentes', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const criado = await store.criarPipeline('Outbound', ['Prospecção'])
    if (!criado.ok) throw new Error(criado.erro)
    const nova = await store.pipelinePorId(criado.valor)
    if (!nova.ok) throw new Error(nova.erro)

    // responsavelId = proprio vendedor pelo mesmo motivo do teste de
    // 'pipeline_com_leads': o insert le' a linha de volta (.select().single()),
    // e leads_select restringe vendedor a responsavel_id = auth.uid().
    const naPadrao = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    const naNova = await store.criarLead({
      ...leadSchema.parse({ nome: 'Bruno' }),
      pipelineId: nova.valor.pipeline.id,
      stageId: nova.valor.etapas[0].id,
      responsavelId: c.vendedorAId,
    })
    if (!naPadrao.ok || !naNova.ok) throw new Error('falha ao criar')

    const daPadrao = await store.listarLeads({ pipelineId: c.pipelineId })
    if (!daPadrao.ok) throw new Error(daPadrao.erro)
    expect(daPadrao.valor.map((l) => l.nome)).toEqual(['Ana'])

    const daNova = await store.listarLeads({ pipelineId: nova.valor.pipeline.id })
    if (!daNova.ok) throw new Error(daNova.erro)
    expect(daNova.valor.map((l) => l.nome)).toEqual(['Bruno'])
  })

  // Compensacao da criacao: o insert de stages precisa falhar de verdade no
  // Postgres para provar que criarPipeline apaga a pipeline recem-criada. A
  // unica coluna sem default nem valor derivavel pelo store e' `stages.nome`
  // (not null, sem default) — nenhuma escolha razoavel de calculo de `ordem`
  // (posicional pelo indice do array) colide sozinha so' de repetir nomes, e
  // TypeScript ja recusaria um `null` de verdade em `etapasAbertas: string[]`.
  // O `as unknown as string[]` empurra o dado invalido — um `null` no lugar
  // de nome de etapa aberta — para alem do type-check, ate' o INSERT real:
  // e' o "dado invalido construido no teste" que o brief pede, so' que
  // independente de qual formula de `ordem` a implementacao escolher.
  it('compensacao: insert de stages falhando apaga a pipeline recem-criada', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const antes = await store.listarPipelines()
    if (!antes.ok) throw new Error(antes.erro)
    const idsAntes = new Set(antes.valor.map((p) => p.id))

    const etapasInvalidas = ['Prospecção', null] as unknown as string[]
    const r = await store.criarPipeline('Deve falhar', etapasInvalidas)
    expect(r.ok).toBe(false)

    const depois = await store.listarPipelines()
    if (!depois.ok) throw new Error(depois.erro)
    // Nenhuma pipeline orfa nova: a lista de ids e' EXATAMENTE a de antes, nao
    // so' "sem uma chamada 'Deve falhar'" — cobre tambem um id novo com outro
    // nome que a compensacao tenha deixado passar.
    expect(new Set(depois.valor.map((p) => p.id))).toEqual(idsAntes)

    // Confirmacao direta no banco, sem depender do proprio store: zero
    // pipelines com esse nome sobraram, inclusive por baixo da RLS.
    const orfas = await comoServico(
      async (cli) =>
        (
          await cli.query<{ count: string }>(
            `select count(*) as count from public.pipelines where account_id = $1 and nome = $2`,
            [c.accountId, 'Deve falhar'],
          )
        ).rows[0].count,
    )
    expect(orfas).toBe('0')
  })
})
