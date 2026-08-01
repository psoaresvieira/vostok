import { describe, it, expect } from 'vitest'
import { InMemoryIngestaoStore } from '@/lib/data/ingestao-memoria'
import { MetaGraphFalso } from '@/lib/integracoes/meta-falso'
import type { EntregaParaProcessar } from '@/lib/data/ingestao'
import { processarEntrega } from './processar'

describe('processarEntrega', () => {
  it('chama arvoreDoAnuncio e grava os tres niveis', async () => {
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
    // LEAD_PADRAO (meta-falso.ts) traz adId: 'ad-padrao', e
    // MetaGraphFalso.arvoreDoAnuncio resolve os tres niveis a partir dele --
    // prova de que a arvore inteira, e nao so um nome de campanha, chega ate
    // o lead quando a chamada da certo.
    expect(ingestao.ingeridos[0]?.dados.campanhaNome).toBe('Campanha ad-padrao')
    expect(ingestao.ingeridos[0]?.dados.conjuntoId).toBe('adset-ad-padrao')
    expect(ingestao.ingeridos[0]?.dados.anuncioId).toBe('ad-padrao')
  })

  it('Meta sem leadgen_id no payload registra falha especifica e nao chama o Graph', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    ingestao.semearLog('log-sem-leadgen-id', 'pendente', null, {
      provedor: 'meta',
      externalId: '',
      payload: {},
      token: 'tok',
    })
    const entrega: EntregaParaProcessar = {
      logId: 'log-sem-leadgen-id',
      provedor: 'meta',
      payload: {},
      token: 'tok',
    }

    const resultado = await processarEntrega(entrega, { ingestao, graph })

    expect(resultado.ok).toBe(false)
    // Prova de que buscarLead nunca roda com id vazio: sem este guard, o
    // Graph real responderia 400 e o operador veria o generico
    // 'meta_indisponivel' em vez do diagnostico real.
    expect(graph.buscados).toEqual([])
    expect(ingestao.falhas).toHaveLength(1)
    expect(ingestao.falhas[0]?.logId).toBe('log-sem-leadgen-id')
    expect(ingestao.falhas[0]?.erro).toBe('leadgen_id_ausente')
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

  it('arvore e best-effort: falha nela ingere com so o anuncioId', async () => {
    const ingestao = new InMemoryIngestaoStore()
    const graph = new MetaGraphFalso()
    graph.falharEm = 'arvoreDoAnuncio'
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
    // LEAD_PADRAO (meta-falso.ts) traz adId: 'ad-padrao' -- o anuncio fica
    // identificado mesmo com a arvore falhando, e o resto honestamente nulo
    // (a versao antiga gravava o ad_id cru na coluna de nome de campanha).
    expect(ingestao.ingeridos[0]?.dados.anuncioId).toBe('ad-padrao')
    expect(ingestao.ingeridos[0]?.dados.campanhaId).toBeNull()
    expect(ingestao.ingeridos[0]?.dados.campanhaNome).toBeNull()
  })

  it('sem ad_id no lead do Graph, nem tenta buscar a arvore e ingere normalmente', async () => {
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
    // Nulo, e nao 'Campanha null' nem o adId: prova de que a chamada nem
    // rodou, por nao haver ad_id para pedir.
    expect(ingestao.ingeridos[0]?.dados.anuncioId).toBeNull()
    expect(ingestao.ingeridos[0]?.dados.campanhaNome).toBeNull()
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
