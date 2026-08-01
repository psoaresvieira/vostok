import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { InMemoryIngestaoStore } from '@/lib/data/ingestao-memoria'
import { metaFalso } from '@/lib/integracoes/fabrica'
import { ok, falha } from '@/lib/domain/resultado'

/**
 * Sem after() aqui -- diferente do Meta e do Google, a varredura processa
 * dentro do proprio GET, antes de responder. O cron so recebe a resposta
 * depois do lote inteiro terminar, entao nao ha nada para agendar nem para
 * mockar em 'next/server'.
 */
const ingestaoMock = vi.fn()
vi.mock('@/lib/data/ingestao', () => ({
  criarIngestaoStore: () => ingestaoMock(),
}))

import { GET } from './route'

const SEGREDO = 'cron-secret-de-teste'

function requisicao(autorizacao?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (autorizacao !== undefined) headers['authorization'] = autorizacao
  return new NextRequest('http://localhost/api/webhooks/reprocessar', { headers })
}

describe('/api/webhooks/reprocessar', () => {
  let ingestao: InMemoryIngestaoStore

  beforeEach(() => {
    ingestao = new InMemoryIngestaoStore()
    ingestaoMock.mockReset()
    ingestaoMock.mockReturnValue(ok(ingestao))
    vi.stubEnv('CRON_SECRET', SEGREDO)
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    metaFalso().reiniciar()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('caso 1: sem cabecalho Authorization devolve 401 e nao processa nada', async () => {
    ingestao.semearLog('log-1', 'pendente', null, {
      provedor: 'google',
      externalId: 'ext-1',
      payload: { lead_id: 'ext-1', user_column_data: [] },
    })

    const res = await GET(requisicao())

    expect(res.status).toBe(401)
    // A entrega pendente semeada continua sem ser tocada -- prova que a
    // varredura nunca chegou a rodar, nao so que devolveu 401.
    expect(ingestao.ingeridos).toHaveLength(0)
    expect(ingestao.falhas).toHaveLength(0)
  })

  it('caso 2: com Bearer errado devolve 401 e nao processa nada', async () => {
    ingestao.semearLog('log-1', 'pendente', null, {
      provedor: 'google',
      externalId: 'ext-1',
      payload: { lead_id: 'ext-1', user_column_data: [] },
    })

    const res = await GET(requisicao(`Bearer ${SEGREDO}-errado`))

    expect(res.status).toBe(401)
    expect(ingestao.ingeridos).toHaveLength(0)
  })

  it('caso 3: com CRON_SECRET nao configurado devolve 401 mesmo com cabecalho vazio -- falha fechado', async () => {
    vi.stubEnv('CRON_SECRET', '')
    ingestao.semearLog('log-1', 'pendente', null, {
      provedor: 'google',
      externalId: 'ext-1',
      payload: { lead_id: 'ext-1', user_column_data: [] },
    })

    // O atacante manda um Bearer vazio de proposito, tentando bater com um
    // env tambem vazio por coincidencia.
    const res = await GET(requisicao('Bearer '))

    expect(res.status).toBe(401)
    expect(ingestao.ingeridos).toHaveLength(0)
  })

  it('caso 4: com o segredo certo processa cada entrega pendente e responde um resumo em JSON', async () => {
    ingestao.semearLog('log-1', 'pendente', null, {
      provedor: 'google',
      externalId: 'ext-1',
      payload: { lead_id: 'ext-1', user_column_data: [] },
    })
    ingestao.semearLog('log-2', 'pendente', null, {
      provedor: 'google',
      externalId: 'ext-2',
      payload: { lead_id: 'ext-2', user_column_data: [] },
    })

    const res = await GET(requisicao(`Bearer ${SEGREDO}`))

    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo).toEqual({ processadas: 2, falhadas: 0, total: 2 })
    expect(ingestao.ingeridos.map((i) => i.logId).sort()).toEqual(['log-1', 'log-2'])
  })

  it('caso 5: uma entrega que falha nao interrompe as seguintes', async () => {
    // log-1 e Meta sem token: processarEntrega recusa com token_ausente e
    // chama registrarFalha (falha real do double, nao inspecao de codigo).
    ingestao.semearLog('log-1', 'pendente', null, {
      provedor: 'meta',
      externalId: 'ext-1',
      payload: { leadgen_id: 'leadgen-1' },
      token: null,
    })
    // log-2 vem DEPOIS de log-1 no Map (ordem de insercao) e e um google
    // valido -- se o loop parasse na primeira falha, ele nunca seria
    // processado.
    ingestao.semearLog('log-2', 'pendente', null, {
      provedor: 'google',
      externalId: 'ext-2',
      payload: { lead_id: 'ext-2', user_column_data: [] },
    })

    const res = await GET(requisicao(`Bearer ${SEGREDO}`))

    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo).toEqual({ processadas: 1, falhadas: 1, total: 2 })
    expect(ingestao.falhas.map((f) => f.logId)).toEqual(['log-1'])
    expect(ingestao.ingeridos.map((i) => i.logId)).toEqual(['log-2'])
  })

  it('com criarIngestaoStore falhando devolve 500 e nao processa nada', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    ingestaoMock.mockReturnValue(falha('ingestao_nao_configurada'))

    const res = await GET(requisicao(`Bearer ${SEGREDO}`))

    expect(res.status).toBe(500)
    expect(consoleErro).toHaveBeenCalled()

    consoleErro.mockRestore()
  })
})
