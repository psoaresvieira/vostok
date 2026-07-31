import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { InMemoryIngestaoStore } from '@/lib/data/ingestao-memoria'
import { metaFalso } from '@/lib/integracoes/fabrica'
import { ok, falha } from '@/lib/domain/resultado'

/**
 * `after()` real exige o AsyncLocalStorage de request scope que so existe
 * dentro do runtime do Next -- chamado direto num teste unitario, ele lanca
 * ("after() foi chamado fora de um request scope"). O mock guarda o
 * callback agendado num array em vez de rodar o Graph de verdade: os 10
 * casos deste arquivo cobrem so o que a rota decide ANTES do 200 (registro,
 * assinatura, forma do corpo), nunca o processamento em si -- esse e' o
 * territorio de processar.test.ts, com InMemoryIngestaoStore +
 * MetaGraphFalso e sem rede.
 */
const { agendados } = vi.hoisted(() => ({ agendados: [] as Array<() => unknown> }))
vi.mock('next/server', async (importOriginal) => {
  const real = await importOriginal<typeof import('next/server')>()
  return {
    ...real,
    after: (tarefa: () => unknown) => {
      agendados.push(tarefa)
    },
  }
})

const ingestaoMock = vi.fn()
vi.mock('@/lib/data/ingestao', () => ({
  criarIngestaoStore: () => ingestaoMock(),
}))

import { GET, POST } from './route'

const SEGREDO = 'app-secret-de-teste'
const VERIFY_TOKEN = 'verify-token-de-teste'

function assinar(corpo: string, segredo: string): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`
}

function requisicaoGet(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/webhooks/meta?${query}`)
}

function requisicaoPost(corpo: string, assinatura?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (assinatura !== undefined) headers['x-hub-signature-256'] = assinatura
  return new NextRequest('http://localhost/api/webhooks/meta', {
    method: 'POST',
    headers,
    body: corpo,
  })
}

describe('/api/webhooks/meta', () => {
  let ingestao: InMemoryIngestaoStore

  beforeEach(() => {
    agendados.length = 0
    ingestao = new InMemoryIngestaoStore()
    ingestaoMock.mockReset()
    ingestaoMock.mockReturnValue(ok(ingestao))
    vi.stubEnv('META_APP_SECRET', SEGREDO)
    vi.stubEnv('META_VERIFY_TOKEN', VERIFY_TOKEN)
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    // metaGraph() com META_FAKE=1 devolve o singleton de processo
    // (metaFalso()) -- sem reiniciar aqui, o estado (`buscados` etc) de um
    // teste vazaria para o proximo.
    metaFalso().reiniciar()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('GET (verificacao do webhook)', () => {
    it('com hub.verify_token correto devolve 200 com hub.challenge como texto puro', async () => {
      const res = await GET(
        requisicaoGet(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=desafio-123`),
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).not.toContain('application/json')
      // Texto puro: o Meta compara o corpo byte a byte com o challenge que
      // ele mandou. Devolver JSON (`"desafio-123"`, com aspas) reprovaria a
      // verificacao.
      expect(await res.text()).toBe('desafio-123')
    })

    it('com token errado devolve 403 e nao devolve o challenge', async () => {
      const res = await GET(
        requisicaoGet('hub.mode=subscribe&hub.verify_token=token-errado&hub.challenge=desafio-123'),
      )

      expect(res.status).toBe(403)
      const corpo = await res.text()
      expect(corpo).not.toContain('desafio-123')
    })

    it('com META_VERIFY_TOKEN nao configurado devolve 403, nunca 200 (falha fechado)', async () => {
      vi.stubEnv('META_VERIFY_TOKEN', '')

      // O atacante manda verify_token vazio de proposito, tentando bater com
      // um env tambem vazio.
      const res = await GET(requisicaoGet('hub.mode=subscribe&hub.verify_token=&hub.challenge=desafio-123'))

      expect(res.status).toBe(403)
    })
  })

  describe('POST (entrega do lead)', () => {
    const corpoUmaEntrega = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 1,
          changes: [
            {
              field: 'leadgen',
              value: { leadgen_id: 'leadgen-1', page_id: 'page-1', form_id: 'form-1', ad_id: 'ad-1' },
            },
          ],
        },
      ],
    })

    it('sem X-Hub-Signature-256 devolve 401 e nao grava nada', async () => {
      const res = await POST(requisicaoPost(corpoUmaEntrega))

      expect(res.status).toBe(401)
      expect(ingestao.entregas).toHaveLength(0)
    })

    it('com assinatura invalida devolve 401 e nao grava nada', async () => {
      const res = await POST(requisicaoPost(corpoUmaEntrega, 'sha256=' + '0'.repeat(64)))

      expect(res.status).toBe(401)
      expect(ingestao.entregas).toHaveLength(0)
    })

    it('com assinatura valida devolve 200 e registra uma entrega por changes[].value', async () => {
      const res = await POST(requisicaoPost(corpoUmaEntrega, assinar(corpoUmaEntrega, SEGREDO)))

      expect(res.status).toBe(200)
      expect(ingestao.entregas).toHaveLength(1)
      expect(ingestao.entregas[0]?.provedor).toBe('meta')
      expect(ingestao.entregas[0]?.externalId).toBe('leadgen-1')
      expect(ingestao.entregas[0]?.chaveDaFonte).toBe('page-1')
    })

    it('com assinatura valida e corpo com dois entry registra as duas entregas', async () => {
      const corpoDoisEntry = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1,
            changes: [{ field: 'leadgen', value: { leadgen_id: 'leadgen-1', page_id: 'page-1' } }],
          },
          {
            id: 'page-2',
            time: 2,
            changes: [{ field: 'leadgen', value: { leadgen_id: 'leadgen-2', page_id: 'page-2' } }],
          },
        ],
      })

      const res = await POST(requisicaoPost(corpoDoisEntry, assinar(corpoDoisEntry, SEGREDO)))

      expect(res.status).toBe(200)
      expect(ingestao.entregas).toHaveLength(2)
      expect(ingestao.entregas.map((e) => e.externalId).sort()).toEqual(['leadgen-1', 'leadgen-2'])

      // after() agenda exatamente uma tarefa para o POST inteiro (ela
      // processa as duas entregas pendentes por dentro, via Promise.all) --
      // sem isto, nada prova que o trabalho foi de fato agendado.
      expect(agendados).toHaveLength(1)
      // No instante em que o 200 ja voltou, nenhuma chamada externa rodou
      // ainda: e a garantia "200 antes de qualquer chamada externa" do
      // comentario da rota, provada em estado, nao em ordem de execucao.
      expect(ingestao.ingeridos).toHaveLength(0)
      expect(metaFalso().buscados).toHaveLength(0)

      // Agora invoca o que foi agendado e confirma que a ingestao de fato
      // aconteceu -- uma vez por entrega pendente do lote.
      await Promise.all(agendados.map((tarefa) => tarefa()))

      expect(ingestao.ingeridos).toHaveLength(2)
      expect(metaFalso().buscados.sort()).toEqual(['leadgen-1', 'leadgen-2'])
    })

    it('change.field diferente de leadgen e ignorado', async () => {
      const corpoOutroCampo = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1,
            changes: [{ field: 'conversations', value: { alguma: 'coisa' } }],
          },
        ],
      })

      const res = await POST(requisicaoPost(corpoOutroCampo, assinar(corpoOutroCampo, SEGREDO)))

      expect(res.status).toBe(200)
      expect(ingestao.entregas).toHaveLength(0)
    })

    it('corpo que nao e JSON valido devolve 200 e nao grava, so depois da assinatura ter passado', async () => {
      const corpoInvalido = '{ nao e json valido'

      const res = await POST(requisicaoPost(corpoInvalido, assinar(corpoInvalido, SEGREDO)))

      // Nunca 500: um 500 aqui faria o Meta retentar em rajada um corpo que
      // nunca vai funcionar.
      expect(res.status).toBe(200)
      expect(ingestao.entregas).toHaveLength(0)
    })

    it('a verificacao da assinatura acontece sobre o corpo cru, mesmo quando a reserializacao dele diverge', async () => {
      // Formatado com indentacao: JSON.stringify(JSON.parse(corpo)) SEM o
      // terceiro argumento produz uma string diferente desta (sem espacos).
      // Se o handler trocasse `req.text()` por `req.json()` reserializado, a
      // assinatura calculada aqui sobre o cru pretty-printed nao bateria
      // mais com o corpo que o handler passaria para assinaturaValida, e
      // este teste ficaria vermelho -- e a unica defesa contra essa
      // regressao.
      const corpoComEspacos = JSON.stringify(
        {
          object: 'page',
          entry: [
            {
              id: 'page-1',
              time: 1,
              changes: [{ field: 'leadgen', value: { leadgen_id: 'leadgen-10', page_id: 'page-1' } }],
            },
          ],
        },
        null,
        2,
      )
      // Confirma a premissa do teste: reserializar de fato muda os bytes.
      expect(JSON.stringify(JSON.parse(corpoComEspacos))).not.toBe(corpoComEspacos)

      const res = await POST(requisicaoPost(corpoComEspacos, assinar(corpoComEspacos, SEGREDO)))

      expect(res.status).toBe(200)
      expect(ingestao.entregas).toHaveLength(1)
      expect(ingestao.entregas[0]?.externalId).toBe('leadgen-10')
    })

    it('leadgen_id ausente no payload nao registra a entrega e nao agenda nada', async () => {
      const corpoSemLeadgenId = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1,
            changes: [{ field: 'leadgen', value: { page_id: 'page-1' } }],
          },
        ],
      })

      const res = await POST(requisicaoPost(corpoSemLeadgenId, assinar(corpoSemLeadgenId, SEGREDO)))

      expect(res.status).toBe(200)
      // Nunca chega a chamar registrarEntrega com externalId vazio: a RPC
      // recusaria de qualquer forma, so depois de gravar a tentativa.
      expect(ingestao.entregas).toHaveLength(0)
      expect(agendados).toHaveLength(1)
      await Promise.all(agendados.map((tarefa) => tarefa()))
      expect(ingestao.ingeridos).toHaveLength(0)
    })

    it('com criarIngestaoStore falhando (servidor sem INGESTAO_SEGREDO) devolve 500, nunca 200, e nao agenda nada', async () => {
      const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
      ingestaoMock.mockReturnValue(falha('ingestao_nao_configurada'))

      const res = await POST(requisicaoPost(corpoUmaEntrega, assinar(corpoUmaEntrega, SEGREDO)))

      // 500, nao 200: e um erro nosso e transitorio, e o Meta so retenta
      // 5xx. Um 200 aqui diria "recebido e guardado" para um lote jogado
      // fora inteiro, e o Meta nunca reenvia um 200.
      expect(res.status).toBe(500)
      expect(agendados).toHaveLength(0)
      // O codigo do erro tem que ficar em algum lugar: nada foi gravado em
      // integration_log, entao o log e o unico rastro que sobra.
      expect(consoleErro).toHaveBeenCalled()

      consoleErro.mockRestore()
    })

    it('registrarEntrega falhando para uma entrega do lote nao derruba as outras, e loga o erro', async () => {
      const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
      ingestao.falharRegistrarEntregaPara = 'leadgen-1'

      const corpoDoisEntry = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1,
            changes: [{ field: 'leadgen', value: { leadgen_id: 'leadgen-1', page_id: 'page-1' } }],
          },
          {
            id: 'page-2',
            time: 2,
            changes: [{ field: 'leadgen', value: { leadgen_id: 'leadgen-2', page_id: 'page-2' } }],
          },
        ],
      })

      const res = await POST(requisicaoPost(corpoDoisEntry, assinar(corpoDoisEntry, SEGREDO)))

      // O 200 nao muda: a garantia de entrega ao Meta e por lote, nao por
      // change individual.
      expect(res.status).toBe(200)
      // As duas tentativas de registro aconteceram, mas so leadgen-2 virou
      // log pendente -- leadgen-1 falhou e foi logado, nao silenciado.
      expect(ingestao.entregas.map((e) => e.externalId).sort()).toEqual(['leadgen-1', 'leadgen-2'])
      expect(consoleErro).toHaveBeenCalled()

      await Promise.all(agendados.map((tarefa) => tarefa()))

      expect(ingestao.ingeridos).toHaveLength(1)
      expect(metaFalso().buscados).toEqual(['leadgen-2'])

      consoleErro.mockRestore()
    })
  })
})
