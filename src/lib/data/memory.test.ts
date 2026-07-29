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
    store.semear('SE7E', 'user-1')
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
})
