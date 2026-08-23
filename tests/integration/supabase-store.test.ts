import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseCrmStore } from '@/lib/data/supabase'
import { leadSchema } from '@/lib/domain/lead'
import { comoServico, limparBanco, criarUsuario } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
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

describe('SupabaseCrmStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('lista o pipeline padrao com as 7 etapas', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const r = await store.pipelinePadrao()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.etapas).toHaveLength(7)
    expect(r.valor.etapas[0].nome).toBe('Novo lead')
  })

  it('cria lead e o encontra na listagem', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana', telefone: '(83) 99999-1234' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const lista = await store.listarLeads({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor.map((l) => l.nome)).toEqual(['Ana'])
    expect(lista.valor[0].telefoneE164).toBe('+5583999991234')
  })

  it('vendedor nao ve lead de outro vendedor pela RLS', async () => {
    await comoServico((cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Lead do B', $2, $3, $4)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorBId],
      ),
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const lista = await store.listarLeads({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor).toHaveLength(0)
  })

  it('moverEtapa devolve erro tipado quando falta motivo de perda', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)
    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.moverEtapa(criado.valor, etapa(c, 'Perdido'))
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('buscarLead devolve null (nao erro) para lead de outra pessoa', async () => {
    const idAlheio = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
           values ($1, 'Lead do B', $2, $3, $4) returning id`,
          [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorBId],
        )
      ).rows[0].id,
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const r = await store.buscarLead(idAlheio)
    expect(r).toEqual({ ok: true, valor: null })
  })

  it('aplicarEtiquetas reusa a etiqueta existente ignorando caixa', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const a = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    const b = await store.criarLead({
      ...leadSchema.parse({ nome: 'Bruno' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    if (!a.ok || !b.ok) throw new Error('falha ao criar')

    await store.aplicarEtiquetas(a.valor, ['Preço alto'])
    await store.aplicarEtiquetas(b.valor, ['preço ALTO'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor).toHaveLength(1)

    const snapshot = await comoServico(async (cli) =>
      (
        await cli.query('select stage_id_no_momento from public.lead_tags where lead_id = $1', [
          b.valor,
        ])
      ).rows[0].stage_id_no_momento,
    )
    expect(snapshot).toBe(etapa(c, 'Qualificação'))
  })

  it('removerEtiqueta apaga a aplicacao, preserva o catalogo e grava etiqueta_removida', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    if (!criado.ok) throw new Error(criado.erro)
    await store.aplicarEtiquetas(criado.valor, ['Preço alto'])
    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    const tagId = etiquetas.valor[0].id

    const r = await store.removerEtiqueta(criado.valor, tagId)
    expect(r).toEqual({ ok: true, valor: undefined })

    const linhas = await comoServico(async (cli) =>
      (await cli.query('select 1 from public.lead_tags where lead_id = $1', [criado.valor])).rows,
    )
    expect(linhas).toHaveLength(0)
    // O catalogo da conta nao encolhe junto.
    const catalogo = await comoServico(async (cli) =>
      (await cli.query('select 1 from public.tags where account_id = $1', [c.accountId])).rows,
    )
    expect(catalogo).toHaveLength(1)
    // A timeline guarda o desfazer, com o nome da etiqueta como snapshot.
    const eventos = await comoServico(async (cli) =>
      (
        await cli.query(
          `select payload->>'tag' as tag from public.lead_events
           where lead_id = $1 and tipo = 'etiqueta_removida'`,
          [criado.valor],
        )
      ).rows,
    )
    expect(eventos).toEqual([{ tag: 'Preço alto' }])

    // Idempotente: remover de novo e ok e NAO grava segundo evento.
    const denovo = await store.removerEtiqueta(criado.valor, tagId)
    expect(denovo).toEqual({ ok: true, valor: undefined })
    const contagem = await comoServico(async (cli) =>
      (
        await cli.query(
          `select count(*)::int as n from public.lead_events
           where lead_id = $1 and tipo = 'etiqueta_removida'`,
          [criado.valor],
        )
      ).rows[0].n,
    )
    expect(contagem).toBe(1)
  })

  it('vendedor nao remove etiqueta de lead que a RLS esconde dele', async () => {
    const admin = new SupabaseCrmStore(await clienteDoUsuario(c.adminId), c.accountId, c.adminId)
    const criado = await admin.criarLead({
      ...leadSchema.parse({ nome: 'Lead do B' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorBId,
    })
    if (!criado.ok) throw new Error(criado.erro)
    await admin.aplicarEtiquetas(criado.valor, ['Preço alto'])
    const etiquetas = await admin.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)

    const storeA = new SupabaseCrmStore(
      await clienteDoUsuario(c.vendedorAId),
      c.accountId,
      c.vendedorAId,
    )
    const r = await storeA.removerEtiqueta(criado.valor, etiquetas.valor[0].id)

    expect(r).toEqual({ ok: false, erro: 'lead_nao_encontrado' })
    const linhas = await comoServico(async (cli) =>
      (await cli.query('select 1 from public.lead_tags where lead_id = $1', [criado.valor])).rows,
    )
    expect(linhas).toHaveLength(1)
  })

  // Par do teste unitario em memory.test.ts, aqui contra o Postgres de verdade:
  // a busca da etiqueta usava .ilike('nome', nome), mandando o texto digitado
  // como PADRAO. Com uma unica linha casando, o lead recebia o id da etiqueta
  // errada em silencio; com duas ou mais, o maybeSingle estourava PGRST116 e a
  // mensagem crua do PostgREST aparecia na ficha do lead.
  it('casa etiqueta por igualdade, tratando % como texto', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const criar = async (nome: string) => {
      const r = await store.criarLead({
        ...leadSchema.parse({ nome }),
        pipelineId: c.pipelineId,
        stageId: etapa(c, 'Qualificação'),
      })
      if (!r.ok) throw new Error(r.erro)
      return r.valor
    }
    const a = await criar('Ana')
    const b = await criar('Bruno')
    const d = await criar('Carla')

    expect(await store.aplicarEtiquetas(a, ['100 leads'])).toEqual({ ok: true, valor: undefined })
    // Com o ilike, este '10%' casava com '100 leads' e reusava o id dela.
    expect(await store.aplicarEtiquetas(b, ['10%'])).toEqual({ ok: true, valor: undefined })
    // E este, com duas linhas comecando em '10', caia no PGRST116.
    expect(await store.aplicarEtiquetas(d, ['10%'])).toEqual({ ok: true, valor: undefined })

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor.map((e) => e.nome)).toEqual(['10%', '100 leads'])

    const idDe = (nome: string) => etiquetas.valor.find((e) => e.nome === nome)!.id
    const etiquetasDoLead = async (id: string) => {
      const r = await store.buscarLead(id)
      if (!r.ok || !r.valor) throw new Error('lead sumiu')
      return r.valor.etiquetas.map((e) => e.id)
    }

    expect(await etiquetasDoLead(b)).toEqual([idDe('10%')])
    expect(await etiquetasDoLead(a)).toEqual([idDe('100 leads')])
    expect(await etiquetasDoLead(d)).toEqual([idDe('10%')])
  })

  it('casa etiqueta ignorando caixa sem criar duplicata, com _ no nome', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const r = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
    })
    if (!r.ok) throw new Error(r.erro)

    await store.aplicarEtiquetas(r.valor, ['leadXfrio'])
    // '_' tambem e curinga no like: o padrao 'lead_frio' casa com 'leadXfrio'.
    await store.aplicarEtiquetas(r.valor, ['lead_frio'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor.map((e) => e.nome).sort()).toEqual(['leadXfrio', 'lead_frio'])
  })

  // Par do teste de RLS crua em 0007_responsavel_membro.test.ts: aqui e o
  // codigo de aplicacao (Steps 5 e 6 da Task 4) que deve traduzir a negacao
  // da policy em 'responsavel_invalido', nunca deixar a mensagem crua do
  // PostgREST (42501) vazar para quem chama o store.
  it('criarLead devolve responsavel_invalido quando o responsavel e de fora da conta', async () => {
    const forasteiro = await criarForasteiro('fora-store@z.com')
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const r = await store.criarLead({
      ...leadSchema.parse({ nome: 'Invasor' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: forasteiro,
    })
    expect(r).toEqual({ ok: false, erro: 'responsavel_invalido' })
  })

  it('atribuirResponsavel devolve responsavel_invalido quando o novo responsavel e de fora da conta', async () => {
    const forasteiro = await criarForasteiro('fora-store2@z.com')
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Alvo' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.atribuirResponsavel(criado.valor, forasteiro)
    expect(r).toEqual({ ok: false, erro: 'responsavel_invalido' })
  })

  // Caso positivo (Minor do review): a policy nova nao pode barrar a troca de
  // responsavel legitima, so a que aponta para fora da conta.
  it('atribuirResponsavel troca o responsavel para outro membro valido da conta', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Repassado' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.atribuirResponsavel(criado.valor, c.vendedorBId)
    expect(r).toEqual({ ok: true, valor: undefined })

    const lido = await store.buscarLead(criado.valor)
    if (!lido.ok || !lido.valor) throw new Error('lead sumiu')
    expect(lido.valor.responsavelId).toBe(c.vendedorBId)
  })
})
