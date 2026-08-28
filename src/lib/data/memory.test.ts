import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryCrmStore } from './memory'
import { leadSchema } from '@/lib/domain/lead'

function novoLead(nome: string, extras: Record<string, unknown> = {}) {
  return leadSchema.parse({ nome, ...extras })
}

describe('InMemoryCrmStore', () => {
  let store: InMemoryCrmStore

  beforeEach(() => {
    store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')
  })

  it('semeia conta com pipeline padrao de 7 etapas', async () => {
    const r = await store.pipelinePadrao()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.etapas).toHaveLength(7)
    expect(r.valor.etapas[0].nome).toBe('Novo lead')
    expect(r.valor.etapas[6].tipo).toBe('perdido')
  })

  it('cria lead na etapa informada', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const r = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    expect(r.ok).toBe(true)

    const leads = await store.listarLeads({})
    if (!leads.ok) throw new Error(leads.erro)
    expect(leads.valor).toHaveLength(1)
    expect(leads.valor[0].nome).toBe('Ana')
    expect(leads.valor[0].status).toBe('aberto')
  })

  it('recusa mover para perdido sem motivo', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    const perdido = p.valor.etapas.find((e) => e.tipo === 'perdido')!

    const r = await store.moverEtapa(criado.valor, perdido.id)
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('deriva status ao mover para ganho e registra evento', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    const ganho = p.valor.etapas.find((e) => e.tipo === 'ganho')!

    const r = await store.moverEtapa(criado.valor, ganho.id)
    expect(r.ok).toBe(true)

    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.status).toBe('ganho')

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    expect(eventos.valor.map((e) => e.tipo)).toContain('etapa_alterada')
  })

  it('moverParaPipeline troca pipelineId e stageId juntos e grava pipeline_alterada', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const origem = p.valor.etapas[0]
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: origem.id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const nova = await store.criarPipeline('Pós-venda', ['Onboarding', 'Ativo'])
    if (!nova.ok) throw new Error(nova.erro)
    const destino = await store.pipelinePorId(nova.valor)
    if (!destino.ok) throw new Error(destino.erro)
    const onboarding = destino.valor.etapas[0]

    const r = await store.moverParaPipeline(criado.valor, onboarding.id)
    expect(r.ok).toBe(true)

    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.pipelineId).toBe(nova.valor)
    expect(lead.valor.stageId).toBe(onboarding.id)
    expect(lead.valor.status).toBe('aberto')

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    const evento = eventos.valor.find((e) => e.tipo === 'pipeline_alterada')
    expect(evento?.payload).toEqual({
      de_pipeline: p.valor.pipeline.id,
      para_pipeline: nova.valor,
      de: origem.id,
      para: onboarding.id,
      loss_reason_id: null,
    })
  })

  it('moverParaPipeline recusa etapa da MESMA pipeline: mesma_pipeline', async () => {
    // A troca dentro do funil e' trabalho de moverEtapa. Deixar passar aqui
    // criaria um segundo caminho para o mesmo movimento, com evento e
    // mensagem de erro diferentes para o mesmo ato do usuario.
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.moverParaPipeline(criado.valor, p.valor.etapas[2].id)

    expect(r).toEqual({ ok: false, erro: 'mesma_pipeline' })
    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.stageId).toBe(p.valor.etapas[0].id)
  })

  it('moverEtapa recusa etapa de OUTRA pipeline: etapa_invalida', async () => {
    // Espelha a 0032: move_lead_stage passou a exigir etapa da mesma
    // pipeline do lead. Trocar de funil e' trabalho de moverParaPipeline.
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const nova = await store.criarPipeline('Pós-venda', ['Onboarding', 'Ativo'])
    if (!nova.ok) throw new Error(nova.erro)
    const destino = await store.pipelinePorId(nova.valor)
    if (!destino.ok) throw new Error(destino.erro)
    const onboarding = destino.valor.etapas[0]

    const r = await store.moverEtapa(criado.valor, onboarding.id)

    expect(r).toEqual({ ok: false, erro: 'etapa_invalida' })
    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.stageId).toBe(p.valor.etapas[0].id)
    expect(lead.valor.pipelineId).toBe(p.valor.pipeline.id)

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    expect(eventos.valor.map((e) => e.tipo)).not.toContain('etapa_alterada')
  })

  it('aplica etiqueta guardando a etapa do momento', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const qualificacao = p.valor.etapas[2]
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: qualificacao.id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    await store.aplicarEtiquetas(criado.valor, ['Preço alto'])
    await store.moverEtapa(criado.valor, p.valor.etapas[3].id)

    expect(store.etapaDaEtiqueta(criado.valor, 'Preço alto')).toBe(qualificacao.id)
  })

  it('removerEtiqueta tira a aplicacao, preserva o catalogo e grava na timeline', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    await store.aplicarEtiquetas(criado.valor, ['Preço alto'])
    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    const tagId = etiquetas.valor[0].id

    const r = await store.removerEtiqueta(criado.valor, tagId)

    expect(r.ok).toBe(true)
    // A aplicacao some (inclusive da metrica, que le lead_tags)...
    expect(store.etapaDaEtiqueta(criado.valor, 'Preço alto')).toBeNull()
    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.etiquetas).toHaveLength(0)
    // ...mas o catalogo da conta nao encolhe: o nome segue como sugestao.
    const depois = await store.etiquetasDaConta()
    if (!depois.ok) throw new Error(depois.erro)
    expect(depois.valor).toHaveLength(1)
    // E a historia fica: quem tirou e qual etiqueta.
    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    expect(eventos.valor[0].tipo).toBe('etiqueta_removida')
    expect(eventos.valor[0].payload.tag).toBe('Preço alto')
  })

  it('remover etiqueta nao aplicada e ok silencioso, sem evento fantasma', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    await store.aplicarEtiquetas(criado.valor, ['Preço alto'])
    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    const tagId = etiquetas.valor[0].id
    await store.removerEtiqueta(criado.valor, tagId)
    const antes = await store.eventosDoLead(criado.valor)
    if (!antes.ok) throw new Error(antes.erro)

    const r = await store.removerEtiqueta(criado.valor, tagId)

    expect(r.ok).toBe(true)
    const depois = await store.eventosDoLead(criado.valor)
    if (!depois.ok) throw new Error(depois.erro)
    expect(depois.valor).toHaveLength(antes.valor.length)
  })

  it('removerEtiqueta de lead inexistente falha com lead_nao_encontrado', async () => {
    const r = await store.removerEtiqueta('lead-fantasma', 'tag-qualquer')

    expect(r).toEqual({ ok: false, erro: 'lead_nao_encontrado' })
  })

  it('reusa etiqueta existente ignorando caixa', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const a = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    const b = await store.criarLead({
      ...novoLead('Bruno'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!a.ok || !b.ok) throw new Error('falha ao criar')

    await store.aplicarEtiquetas(a.valor, ['Preço alto'])
    await store.aplicarEtiquetas(b.valor, ['preço ALTO'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor).toHaveLength(1)
  })

  // Contrato de casamento de etiqueta: igualdade exata sem caixa, NUNCA padrao.
  // O SupabaseCrmStore casava com .ilike('nome', nome), mandando o texto do
  // usuario como PADRAO: '10%' casava com '100 leads' e o lead terminava com uma
  // etiqueta que ninguem escreveu — inclusive no snapshot de stage_id_no_momento,
  // que e a metrica que a ordem "etiqueta antes de mover" existe para proteger.
  // Este teste e o par em memoria do teste de integracao contra o Postgres.
  it('trata % e _ como texto, nao como curinga', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criar = async (nome: string) => {
      const r = await store.criarLead({
        ...novoLead(nome),
        pipelineId: p.valor.pipeline.id,
        stageId: p.valor.etapas[0].id,
      })
      if (!r.ok) throw new Error(r.erro)
      return r.valor
    }
    const a = await criar('Ana')
    const b = await criar('Bruno')
    const c = await criar('Carla')

    await store.aplicarEtiquetas(a, ['100 leads'])
    await store.aplicarEtiquetas(b, ['10%'])
    await store.aplicarEtiquetas(c, ['10%'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor.map((e) => e.nome).sort()).toEqual(['10%', '100 leads'])

    const idDe = (nome: string) => etiquetas.valor.find((e) => e.nome === nome)!.id
    const lead = async (id: string) => {
      const r = await store.buscarLead(id)
      if (!r.ok || !r.valor) throw new Error('lead sumiu')
      return r.valor
    }

    // '10%' nao pegou o id de '100 leads'...
    expect((await lead(b)).etiquetas.map((e) => e.id)).toEqual([idDe('10%')])
    // ...e '100 leads' nao pegou o id de '10%'.
    expect((await lead(a)).etiquetas.map((e) => e.id)).toEqual([idDe('100 leads')])
    // Reaplicar '10%' com duas etiquetas comecando em '10' reusa a certa.
    expect((await lead(c)).etiquetas.map((e) => e.id)).toEqual([idDe('10%')])
  })

  it('encontra possiveis duplicados por telefone', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    await store.criarLead({
      ...novoLead('Ana', { telefone: '(83) 99999-1234' }),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })

    const r = await store.possiveisDuplicados('+5583999991234', null)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.nome)).toEqual(['Ana'])
  })

  it('filtra leads por responsavel e por busca', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const etapa = p.valor.etapas[0].id
    await store.criarLead({
      ...novoLead('Ana Silva', { responsavelId: '11111111-1111-4111-a111-111111111111' }),
      pipelineId: p.valor.pipeline.id,
      stageId: etapa,
    })
    await store.criarLead({
      ...novoLead('Bruno Souza'),
      pipelineId: p.valor.pipeline.id,
      stageId: etapa,
    })

    const porResponsavel = await store.listarLeads({
      responsavelId: '11111111-1111-4111-a111-111111111111',
    })
    if (!porResponsavel.ok) throw new Error(porResponsavel.erro)
    expect(porResponsavel.valor.map((l) => l.nome)).toEqual(['Ana Silva'])

    const porBusca = await store.listarLeads({ busca: 'souza' })
    if (!porBusca.ok) throw new Error(porBusca.erro)
    expect(porBusca.valor.map((l) => l.nome)).toEqual(['Bruno Souza'])
  })

  it('atribui responsavel e registra evento', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.atribuirResponsavel(criado.valor, 'user-2')
    expect(r.ok).toBe(true)

    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.responsavelId).toBe('user-2')

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    expect(eventos.valor[0].tipo).toBe('responsavel_alterado')
    expect(eventos.valor[0].payload.para).toBe('user-2')
  })

  it('metricasDaCoorte devolve uma linha por lead da janela, com a profundidade', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    // Uma etapa aberta a frente: 'Novo lead' (ordem 1) -> 'Contato feito' (ordem 2).
    await store.moverEtapa(criado.valor, p.valor.etapas[1].id)

    const r = await store.metricasDaCoorte({
      pipelineId: p.valor.pipeline.id,
      de: new Date('2000-01-01T00:00:00Z'),
      ate: new Date('2100-01-01T00:00:00Z'),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0]?.ordemMax).toBe(2)
  })

  it('metricasDaCoorte recorta pela janela semiaberta', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criar = async (nome: string) => {
      const r = await store.criarLead({
        ...novoLead(nome),
        pipelineId: p.valor.pipeline.id,
        stageId: p.valor.etapas[0].id,
      })
      if (!r.ok) throw new Error(r.erro)
      const lead = await store.buscarLead(r.valor)
      if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
      return lead.valor
    }
    const dentro = await criar('Dentro')
    // Pequeno atraso: garante criadoEm distinto, ja que new Date() so tem 1ms
    // de resolucao e as duas criacoes acontecem sem await real entre elas.
    await new Promise((resolve) => setTimeout(resolve, 2))
    const fora = await criar('Fora')

    // Janela [dentro.criadoEm, fora.criadoEm): o proprio limite `ate` prova a
    // exclusividade, sem depender de datas fixas no calendario.
    const r = await store.metricasDaCoorte({
      pipelineId: p.valor.pipeline.id,
      de: dentro.criadoEm,
      ate: fora.criadoEm,
    })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.leadId)).toEqual([dentro.id])
  })

  it('etiquetasDaCoorte devolve a etapa congelada de cada aplicacao', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const qualificacao = p.valor.etapas[2]
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: qualificacao.id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    await store.aplicarEtiquetas(criado.valor, ['Preço alto'])
    // Move depois de etiquetar: a etapa congelada tem que continuar sendo a
    // de quando a etiqueta foi aplicada, nao a atual.
    await store.moverEtapa(criado.valor, p.valor.etapas[3].id)

    const r = await store.etiquetasDaCoorte({
      pipelineId: p.valor.pipeline.id,
      de: new Date('2000-01-01T00:00:00Z'),
      ate: new Date('2100-01-01T00:00:00Z'),
    })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0]?.stageIdNoMomento).toBe(qualificacao.id)
    expect(r.valor[0]?.ordemNoMomento).toBe(qualificacao.ordem)
  })

  it('registra nota na timeline', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const resultado = await store.registrarNota(criado.valor, 'ligou, pediu proposta')
    expect(resultado.ok).toBe(true)

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    const nota = eventos.valor.find((e) => e.tipo === 'nota')
    expect(nota?.payload.texto).toBe('ligou, pediu proposta')
  })

  // Par em memoria do teste de integracao "ordem_max e a maior etapa ABERTA
  // ja ocupada, e lead perdido nao herda a ordem de Perdido"
  // (tests/integration/0014_metricas.test.ts). Perdido tem ordem 7, maior
  // que toda etapa aberta: sem o filtro por tipo === 'aberta', todo lead
  // perdido reportaria profundidade maxima do funil.
  it('lead perdido nao herda a ordem de Perdido em ordemMax', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    // 'Novo lead' (ordem 1) -> 'Contato feito' (ordem 2, aberta).
    await store.moverEtapa(criado.valor, p.valor.etapas[1].id)

    const motivos = await store.motivosPerda()
    if (!motivos.ok) throw new Error(motivos.erro)
    const perdido = p.valor.etapas.find((e) => e.tipo === 'perdido')!
    const r1 = await store.moverEtapa(criado.valor, perdido.id, motivos.valor[0].id)
    expect(r1.ok).toBe(true)

    const r = await store.metricasDaCoorte({
      pipelineId: p.valor.pipeline.id,
      de: new Date('2000-01-01T00:00:00Z'),
      ate: new Date('2100-01-01T00:00:00Z'),
    })
    if (!r.ok) throw new Error(r.erro)
    const linha = r.valor.find((l) => l.leadId === criado.valor)
    expect(linha?.ordemMax).toBe(2)
  })

  // Par em memoria do teste de integracao "lead que voltou etapa mantem a
  // ordem maxima ja alcancada". Prova a metade `origem` da uniao: o lead
  // NASCE direto em 'Proposta' (ordem 4) — logo nenhum movimento jamais
  // grava Proposta como `destino` — e so entao volta para 'Contato feito'
  // (ordem 2). Depois de voltar, nem o stageId atual nem qualquer `destino`
  // do historico valem 4; so a `origem` do movimento de volta carrega essa
  // profundidade. (Se o lead tivesse ido para Proposta via moverEtapa, o
  // proprio `destino` daquele movimento ja provaria 4 sozinho, e o teste nao
  // discriminaria a metade `origem` da uniao.)
  it('mover para tras nao apaga a profundidade ja alcancada', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[3].id, // nasce direto em 'Proposta' (ordem 4)
    })
    if (!criado.ok) throw new Error(criado.erro)

    // 'Proposta' (4) -> 'Contato feito' (2).
    await store.moverEtapa(criado.valor, p.valor.etapas[1].id)

    const r = await store.metricasDaCoorte({
      pipelineId: p.valor.pipeline.id,
      de: new Date('2000-01-01T00:00:00Z'),
      ate: new Date('2100-01-01T00:00:00Z'),
    })
    if (!r.ok) throw new Error(r.erro)
    const linha = r.valor.find((l) => l.leadId === criado.valor)
    expect(linha?.ordemMax).toBe(4)
  })

  // Par em memoria do teste de integracao "lead que nasceu direto numa etapa
  // nao-aberta reporta ordem_max 0". criarLead (assim como o INSERT direto
  // usado no teste de integracao) nao valida o tipo da etapa inicial, entao
  // e possivel alcancar em memoria o estado que o guard `ordens.length > 0
  // ? ... : 0` existe para cobrir, sem fabricar nada fora da API publica do
  // store.
  it('lead que nunca ocupou etapa aberta reporta ordemMax 0', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const perdido = p.valor.etapas.find((e) => e.tipo === 'perdido')!
    const criado = await store.criarLead({
      ...novoLead('Lead direto em Perdido'),
      pipelineId: p.valor.pipeline.id,
      stageId: perdido.id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.metricasDaCoorte({
      pipelineId: p.valor.pipeline.id,
      de: new Date('2000-01-01T00:00:00Z'),
      ate: new Date('2100-01-01T00:00:00Z'),
    })
    if (!r.ok) throw new Error(r.erro)
    const linha = r.valor.find((l) => l.leadId === criado.valor)
    expect(linha).toBeDefined()
    expect(linha?.ordemMax).toBe(0)
  })

  it('metricasDaCoorte com responsavelId estreita para so aquele lead', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const respA = '11111111-1111-4111-a111-111111111111'
    const respB = '22222222-2222-4222-a222-222222222222'
    const a = await store.criarLead({
      ...novoLead('Ana', { responsavelId: respA }),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    const b = await store.criarLead({
      ...novoLead('Bruno', { responsavelId: respB }),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!a.ok || !b.ok) throw new Error('falha ao criar')

    const janela = {
      pipelineId: p.valor.pipeline.id,
      de: new Date('2000-01-01T00:00:00Z'),
      ate: new Date('2100-01-01T00:00:00Z'),
    }

    const comFiltro = await store.metricasDaCoorte({ ...janela, responsavelId: respA })
    if (!comFiltro.ok) throw new Error(comFiltro.erro)
    expect(comFiltro.valor.map((l) => l.leadId)).toEqual([a.valor])

    const semFiltro = await store.metricasDaCoorte(janela)
    if (!semFiltro.ok) throw new Error(semFiltro.erro)
    expect(semFiltro.valor.map((l) => l.leadId).sort()).toEqual([a.valor, b.valor].sort())
  })

  describe('multiplas pipelines', () => {
    it('criar monta Ganho/Perdido ao final', async () => {
      const criado = await store.criarPipeline('Outbound', ['Prospecção', 'Contato'])
      if (!criado.ok) throw new Error(criado.erro)

      const r = await store.pipelinePorId(criado.valor)
      if (!r.ok) throw new Error(r.erro)
      expect(r.valor.pipeline.nome).toBe('Outbound')
      expect(r.valor.etapas.map((e) => [e.nome, e.ordem, e.tipo])).toEqual([
        ['Prospecção', 1, 'aberta'],
        ['Contato', 2, 'aberta'],
        ['Ganho', 3, 'ganho'],
        ['Perdido', 4, 'perdido'],
      ])
    })

    it('listar poe a padrao primeiro', async () => {
      const a = await store.criarPipeline('Outbound', ['Prospecção'])
      const b = await store.criarPipeline('Inbound', ['Contato'])
      if (!a.ok || !b.ok) throw new Error('falha ao criar')

      const r = await store.listarPipelines()
      if (!r.ok) throw new Error(r.erro)
      expect(r.valor[0].isDefault).toBe(true)
      expect(r.valor.slice(1).map((p) => p.id)).toEqual([a.valor, b.valor])
    })

    it('excluir recusa a padrao', async () => {
      const p = await store.pipelinePadrao()
      if (!p.ok) throw new Error(p.erro)

      const r = await store.excluirPipeline(p.valor.pipeline.id)
      expect(r).toEqual({ ok: false, erro: 'pipeline_padrao_nao_exclui' })
    })

    it('excluir recusa pipeline com lead', async () => {
      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)
      const nova = await store.pipelinePorId(criado.valor)
      if (!nova.ok) throw new Error(nova.erro)

      await store.criarLead({
        ...novoLead('Ana'),
        pipelineId: nova.valor.pipeline.id,
        stageId: nova.valor.etapas[0].id,
      })

      const r = await store.excluirPipeline(criado.valor)
      expect(r).toEqual({ ok: false, erro: 'pipeline_com_leads' })
    })

    it('excluir pipeline vazia some da lista', async () => {
      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)

      const r = await store.excluirPipeline(criado.valor)
      expect(r.ok).toBe(true)

      const lista = await store.listarPipelines()
      if (!lista.ok) throw new Error(lista.erro)
      expect(lista.valor.map((p) => p.id)).not.toContain(criado.valor)

      const buscada = await store.pipelinePorId(criado.valor)
      expect(buscada).toEqual({ ok: false, erro: 'pipeline_nao_encontrado' })
    })

    it('listarLeads filtra por pipelineId', async () => {
      const p = await store.pipelinePadrao()
      if (!p.ok) throw new Error(p.erro)
      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)
      const nova = await store.pipelinePorId(criado.valor)
      if (!nova.ok) throw new Error(nova.erro)

      await store.criarLead({
        ...novoLead('Ana'),
        pipelineId: p.valor.pipeline.id,
        stageId: p.valor.etapas[0].id,
      })
      await store.criarLead({
        ...novoLead('Bruno'),
        pipelineId: nova.valor.pipeline.id,
        stageId: nova.valor.etapas[0].id,
      })

      const r = await store.listarLeads({ pipelineId: nova.valor.pipeline.id })
      if (!r.ok) throw new Error(r.erro)
      expect(r.valor.map((l) => l.nome)).toEqual(['Bruno'])
    })

    it('leadsDoFunil pagina POR ETAPA e conta a etapa inteira', async () => {
      const p = await store.pipelinePadrao()
      if (!p.ok) throw new Error(p.erro)
      const [primeira, segunda] = p.valor.etapas

      for (let i = 0; i < 5; i++) {
        await store.criarLead({
          ...novoLead(`A${i}`, { valorCents: 1000 }),
          pipelineId: p.valor.pipeline.id,
          stageId: primeira.id,
        })
      }
      await store.criarLead({
        ...novoLead('B0'),
        pipelineId: p.valor.pipeline.id,
        stageId: segunda.id,
      })

      const r = await store.leadsDoFunil({ pipelineId: p.valor.pipeline.id, limite: 2 })
      if (!r.ok) throw new Error(r.erro)

      const colunaA = r.valor.find((c) => c.etapaId === primeira.id)!
      // Duas na pagina, cinco no total: o cabecalho da coluna nao mente por
      // causa do limite.
      expect(colunaA.leads).toHaveLength(2)
      expect(colunaA.total).toBe(5)
      expect(colunaA.somaCents).toBe(5000)
      // O limite da coluna A nao consome o da coluna B.
      expect(r.valor.find((c) => c.etapaId === segunda.id)!.leads).toHaveLength(1)
    })

    it('leadsDoFunil devolve somaCents null quando ninguem preencheu valor', async () => {
      const p = await store.pipelinePadrao()
      if (!p.ok) throw new Error(p.erro)
      await store.criarLead({
        ...novoLead('Sem valor'),
        pipelineId: p.valor.pipeline.id,
        stageId: p.valor.etapas[0].id,
      })

      const r = await store.leadsDoFunil({ pipelineId: p.valor.pipeline.id, limite: 50 })
      if (!r.ok) throw new Error(r.erro)
      // null, e nao 0: "R$ 0,00" afirmaria que os leads valem zero.
      expect(r.valor[0].somaCents).toBeNull()
    })

    it('leadsDoFunil com etapaId e offset nao repete nem pula cartao', async () => {
      const p = await store.pipelinePadrao()
      if (!p.ok) throw new Error(p.erro)
      const alvo = p.valor.etapas[0]
      for (let i = 0; i < 5; i++) {
        await store.criarLead({
          ...novoLead(`L${i}`),
          pipelineId: p.valor.pipeline.id,
          stageId: alvo.id,
        })
      }

      const base = { pipelineId: p.valor.pipeline.id, etapaId: alvo.id, limite: 2 }
      const pg1 = await store.leadsDoFunil({ ...base, offset: 0 })
      const pg2 = await store.leadsDoFunil({ ...base, offset: 2 })
      const pg3 = await store.leadsDoFunil({ ...base, offset: 4 })
      if (!pg1.ok || !pg2.ok || !pg3.ok) throw new Error('paginacao falhou')

      const ids = [...pg1.valor[0].leads, ...pg2.valor[0].leads, ...pg3.valor[0].leads].map(
        (l) => l.id,
      )
      expect(ids).toHaveLength(5)
      expect(new Set(ids).size).toBe(5)
      // Uma etapa so: as demais colunas nao voltam.
      expect(pg1.valor).toHaveLength(1)
    })

    it('renomear reflete em listarPipelines', async () => {
      const criado = await store.criarPipeline('Outbound', ['Prospecção'])
      if (!criado.ok) throw new Error(criado.erro)

      const r = await store.renomearPipeline(criado.valor, 'Outbound v2')
      expect(r.ok).toBe(true)

      const lista = await store.listarPipelines()
      if (!lista.ok) throw new Error(lista.erro)
      expect(lista.valor.find((p) => p.id === criado.valor)?.nome).toBe('Outbound v2')
    })
  })
})
