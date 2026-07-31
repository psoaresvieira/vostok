import { describe, it, expect } from 'vitest'
import { InMemoryIngestaoStore } from '@/lib/data/ingestao-memoria'
import { MetaGraphFalso } from '@/lib/integracoes/meta-falso'
import type { EntregaParaProcessar } from '@/lib/data/ingestao'
import { processarEntrega } from './processar'

describe('processarEntrega', () => {
  it('Meta, caminho feliz: busca no Graph, mapeia e ingere sem registrar falha', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    const registro = await ingestao.registrarEntrega({
      provedor: 'meta',
      externalId: 'leadgen-1',
      payload: { leadgen_id: 'leadgen-1', page_id: 'page-1' },
      chaveDaFonte: 'page-1',
    })
    if (!registro.ok) throw new Error('setup do teste falhou')
    const entrega: EntregaParaProcessar = {
      logId: registro.valor.logId!,
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-1', page_id: 'page-1' },
      token: registro.valor.token,
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(true)
    expect(graph.buscados).toEqual(['leadgen-1'])
    expect(ingestao.ingeridos).toHaveLength(1)
    expect(ingestao.ingeridos[0]?.dados.nome).toBe('Fulano de Tal')
    expect(ingestao.falhas).toHaveLength(0)
  })

  it('Meta sem token registra falha e nao chama o Graph', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    ingestao.semearLog('log-sem-token', 'pendente', null, {
      provedor: 'meta',
      externalId: 'leadgen-2',
      payload: { leadgen_id: 'leadgen-2' },
      token: null,
    })
    const entrega: EntregaParaProcessar = {
      logId: 'log-sem-token',
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-2' },
      token: null,
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(false)
    // Prova de que a chamada nem chegou ao Graph: um buscarLead sem token
    // bateria com credencial vazia. Asserindo sobre o estado do duplo, nao
    // com spy.
    expect(graph.buscados).toEqual([])
    expect(ingestao.falhas).toHaveLength(1)
    expect(ingestao.falhas[0]?.logId).toBe('log-sem-token')
    expect(ingestao.ingeridos).toHaveLength(0)
  })

  it('falha do Graph vira registrarFalha com o codigo de erro, e ingerirLead nao e chamado', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    graph.falharEm = 'buscarLead'
    ingestao.semearLog('log-graph-falha', 'pendente', null, {
      provedor: 'meta',
      externalId: 'leadgen-3',
      payload: { leadgen_id: 'leadgen-3' },
      token: 'tok',
    })
    const entrega: EntregaParaProcessar = {
      logId: 'log-graph-falha',
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-3' },
      token: 'tok',
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(false)
    expect(ingestao.falhas).toHaveLength(1)
    expect(ingestao.falhas[0]?.erro).toBe('meta_indisponivel')
    expect(ingestao.ingeridos).toHaveLength(0)
  })

  it('campanha e best-effort: falha em campanhaDoAnuncio ingere do mesmo jeito, com campanhaOrigem no ad_id cru', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    graph.falharEm = 'campanhaDoAnuncio'
    ingestao.semearLog('log-campanha-falha', 'pendente', null, {
      provedor: 'meta',
      externalId: 'leadgen-4',
      payload: { leadgen_id: 'leadgen-4' },
      token: 'tok',
    })
    const entrega: EntregaParaProcessar = {
      logId: 'log-campanha-falha',
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-4' },
      token: 'tok',
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(true)
    expect(ingestao.falhas).toHaveLength(0)
    expect(ingestao.ingeridos).toHaveLength(1)
    // LEAD_PADRAO (meta-falso.ts) traz adId: 'ad-padrao' — e o cru que tem
    // que sobreviver quando a segunda chamada falha.
    expect(ingestao.ingeridos[0]?.dados.campanhaOrigem).toBe('ad-padrao')
  })

  it('sem ad_id no lead do Graph, nem tenta buscar campanha e ingere normalmente', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    graph.leads.set('leadgen-5', {
      campos: [{ name: 'email', values: ['sem-anuncio@example.com'] }],
      adId: null,
      formId: null,
      criadoEm: null,
    })
    ingestao.semearLog('log-sem-ad-id', 'pendente', null, {
      provedor: 'meta',
      externalId: 'leadgen-5',
      payload: { leadgen_id: 'leadgen-5' },
      token: 'tok',
    })
    const entrega: EntregaParaProcessar = {
      logId: 'log-sem-ad-id',
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-5' },
      token: 'tok',
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(true)
    expect(ingestao.ingeridos).toHaveLength(1)
    // Nulo, e nao 'Campanha null' nem qualquer outro valor inventado: prova
    // de que a chamada de campanha nem rodou sem ad_id para pedir.
    expect(ingestao.ingeridos[0]?.dados.campanhaOrigem).toBeNull()
  })

  it('Google nao toca o Graph: processa o payload direto', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    const registro = await ingestao.registrarEntrega({
      provedor: 'google',
      externalId: 'lead-google-1',
      payload: {
        user_column_data: [{ column_id: 'EMAIL', string_value: 'lead@example.com' }],
        campaign_id: 111,
        form_id: 222,
      },
      chaveDaFonte: 'url-token',
      googleKey: 'chave-do-form',
    })
    if (!registro.ok) throw new Error('setup do teste falhou')
    const entrega: EntregaParaProcessar = {
      logId: registro.valor.logId!,
      provedor: 'google',
      payload: {
        user_column_data: [{ column_id: 'EMAIL', string_value: 'lead@example.com' }],
        campaign_id: 111,
        form_id: 222,
      },
      token: null,
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(true)
    expect(graph.buscados).toEqual([])
    expect(ingestao.ingeridos).toHaveLength(1)
    expect(ingestao.ingeridos[0]?.dados.email).toBe('lead@example.com')
  })

  it('falha do ingerirLead vira registrarFalha', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    // Nenhum log semeado com este id: ingerirLead do duplo devolve
    // log_nao_encontrado, o mesmo caminho de erro que a RPC real levanta
    // com `raise exception` (0011).
    const entrega: EntregaParaProcessar = {
      logId: 'log-inexistente',
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-7' },
      token: 'tok',
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(false)
    expect(ingestao.falhas).toHaveLength(1)
    expect(ingestao.falhas[0]?.logId).toBe('log-inexistente')
    expect(ingestao.falhas[0]?.erro).toBe('log_nao_encontrado')
  })

  it('ingerirLead devolvendo ja_processado nao e falha', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    // Simula a corrida entre o after() da rota e a varredura do cron: o log
    // ja foi processado por outro caminho quando esta chamada chega.
    ingestao.semearLog('log-ja-processado', 'processado', 'lead-8', {
      provedor: 'meta',
      externalId: 'leadgen-8',
      payload: { leadgen_id: 'leadgen-8' },
      token: 'tok',
    })
    const entrega: EntregaParaProcessar = {
      logId: 'log-ja-processado',
      provedor: 'meta',
      payload: { leadgen_id: 'leadgen-8' },
      token: 'tok',
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    // Nao e falha: registra-lo assim subiria o contador de tentativas
    // sozinho ate o give-up (0010), para uma entrega que ja tinha resolvido.
    expect(resultado.ok).toBe(true)
    expect(ingestao.falhas).toHaveLength(0)
  })
})
