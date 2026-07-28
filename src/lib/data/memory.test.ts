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
      ...novoLead('Ana Silva', { responsavelId: '11111111-1111-1111-1111-111111111111' }),
      pipelineId: p.valor.pipeline.id,
      stageId: etapa,
    })
    await store.criarLead({
      ...novoLead('Bruno Souza'),
      pipelineId: p.valor.pipeline.id,
      stageId: etapa,
    })

    const porResponsavel = await store.listarLeads({
      responsavelId: '11111111-1111-1111-1111-111111111111',
    })
    if (!porResponsavel.ok) throw new Error(porResponsavel.erro)
    expect(porResponsavel.valor.map((l) => l.nome)).toEqual(['Ana Silva'])

    const porBusca = await store.listarLeads({ busca: 'souza' })
    if (!porBusca.ok) throw new Error(porBusca.erro)
    expect(porBusca.valor.map((l) => l.nome)).toEqual(['Bruno Souza'])
  })
})
