import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { InMemoryIngestaoStore } from '@/lib/data/ingestao-memoria'
import { ok, falha } from '@/lib/domain/resultado'

/**
 * Mesmo harness do teste do webhook do Meta (route.test.ts): `after()` real
 * exige request scope que so existe dentro do runtime do Next, entao o mock
 * so guarda o callback agendado -- provar que ele RODA (e ingere de fato) e
 * territorio de processar.test.ts, com InMemoryIngestaoStore e sem rede.
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

import { POST } from './route'

const TOKEN = 'url-token-secreto-de-teste'

function requisicao(corpo: string): NextRequest {
  return new NextRequest(`http://localhost/api/webhooks/google/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpo,
  })
}

function contexto(): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token: TOKEN }) }
}

describe('/api/webhooks/google/[token]', () => {
  let ingestao: InMemoryIngestaoStore

  beforeEach(() => {
    agendados.length = 0
    ingestao = new InMemoryIngestaoStore()
    ingestaoMock.mockReset()
    ingestaoMock.mockReturnValue(ok(ingestao))
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const corpoValido = JSON.stringify({
    lead_id: 'lead-google-1',
    google_key: 'chave-do-cliente',
    api_version: '1.0',
    user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Fulano de Tal' }],
  })

  it('caso 1: payload valido registra a entrega com externalId, chaveDaFonte e googleKey certos', async () => {
    const res = await POST(requisicao(corpoValido), contexto())

    expect(res.status).toBe(200)
    expect(ingestao.entregas).toHaveLength(1)
    expect(ingestao.entregas[0]?.provedor).toBe('google')
    expect(ingestao.entregas[0]?.externalId).toBe('lead-google-1')
    expect(ingestao.entregas[0]?.chaveDaFonte).toBe(TOKEN)
    expect(ingestao.entregas[0]?.googleKey).toBe('chave-do-cliente')
  })

  it('caso 2: fonte desconhecida ainda devolve 200 -- 404 seria oraculo de quais URLs estao ativas', async () => {
    // Simula o que registrar_entrega devolve quando url_token_hash nao bate
    // com fonte nenhuma: sucesso, status 'ignorado'. A rota nao sabe (nem
    // precisa saber) o motivo -- so reage ao status.
    ingestao.ignorarRegistrarEntregaPara = 'lead-google-1'

    const res = await POST(requisicao(corpoValido), contexto())

    expect(res.status).toBe(200)
    expect(agendados).toHaveLength(0)
  })

  it('caso 3: is_test devolve 200, a entrega volta ignorada, e nao dispara processamento', async () => {
    const corpoDeTeste = JSON.stringify({
      lead_id: 'lead-google-teste',
      google_key: 'chave-do-cliente',
      is_test: 'true',
      user_column_data: [],
    })
    // A deteccao de is_test e' da RPC (0010), nao da rota nem do duplo --
    // aqui so simulamos a resposta que ela daria para esse external_id.
    ingestao.ignorarRegistrarEntregaPara = 'lead-google-teste'

    const res = await POST(requisicao(corpoDeTeste), contexto())

    expect(res.status).toBe(200)
    expect(ingestao.entregas).toHaveLength(1)
    expect(agendados).toHaveLength(0)
  })

  it('caso 4: corpo que nao e JSON valido devolve 200 e nao grava nada', async () => {
    const res = await POST(requisicao('{ isso nao e json'), contexto())

    expect(res.status).toBe(200)
    expect(ingestao.entregas).toHaveLength(0)
    expect(agendados).toHaveLength(0)
  })

  it('caso 5: lead_id ausente devolve 200 e nao grava -- sem external_id nao ha chave de idempotencia', async () => {
    const corpoSemLeadId = JSON.stringify({ google_key: 'chave-do-cliente', user_column_data: [] })

    const res = await POST(requisicao(corpoSemLeadId), contexto())

    expect(res.status).toBe(200)
    expect(ingestao.entregas).toHaveLength(0)
    expect(agendados).toHaveLength(0)
  })

  it('caso 6: entrega pendente dispara processarEntrega; ignorado e duplicado nao disparam', async () => {
    // pendente: primeiro envio de um lead novo.
    const res1 = await POST(requisicao(corpoValido), contexto())
    expect(res1.status).toBe(200)
    expect(agendados).toHaveLength(1)

    // duplicado: reenvio do mesmo lead_id nao agenda uma segunda vez.
    const res2 = await POST(requisicao(corpoValido), contexto())
    expect(res2.status).toBe(200)
    expect(agendados).toHaveLength(1)

    // ignorado: outro lead_id, mas o duplo simula fonte desconhecida/lead de
    // teste -- tambem nao agenda.
    ingestao.ignorarRegistrarEntregaPara = 'lead-google-ignorado'
    const corpoIgnorado = JSON.stringify({ lead_id: 'lead-google-ignorado', google_key: 'x', user_column_data: [] })
    const res3 = await POST(requisicao(corpoIgnorado), contexto())
    expect(res3.status).toBe(200)
    expect(agendados).toHaveLength(1)

    // Confirma que o unico agendado de fato processa e ingere -- sem isto,
    // nada prova que o agendamento nao e' so decorativo (a mesma lacuna que
    // a Task 7 deixou no teste do Meta).
    expect(ingestao.ingeridos).toHaveLength(0)
    await Promise.all(agendados.map((tarefa) => tarefa()))
    expect(ingestao.ingeridos).toHaveLength(1)
  })

  it('caso 7: o token do caminho nunca aparece na resposta, em nenhum branch', async () => {
    const respostas: Response[] = []
    respostas.push(await POST(requisicao(corpoValido), contexto()))
    respostas.push(await POST(requisicao('{ nao e json'), contexto()))
    respostas.push(await POST(requisicao(JSON.stringify({ google_key: 'x' })), contexto()))

    ingestaoMock.mockReturnValue(falha('ingestao_nao_configurada'))
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    respostas.push(await POST(requisicao(corpoValido), contexto()))
    consoleErro.mockRestore()

    for (const res of respostas) {
      const corpo = await res.text()
      expect(corpo).not.toContain(TOKEN)
      for (const [, valor] of res.headers.entries()) {
        expect(valor).not.toContain(TOKEN)
      }
    }
  })

  it('com criarIngestaoStore falhando (servidor sem INGESTAO_SEGREDO) devolve 500, nunca 200, e nao agenda nada', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    ingestaoMock.mockReturnValue(falha('ingestao_nao_configurada'))

    const res = await POST(requisicao(corpoValido), contexto())

    // 500, nao 200: culpa nossa (env ausente) e transitoria. Um 200 aqui
    // diria ao Google "recebido e guardado" para um lead jogado fora, e o
    // Google nao reenvia um 200.
    expect(res.status).toBe(500)
    expect(agendados).toHaveLength(0)
    expect(consoleErro).toHaveBeenCalled()

    consoleErro.mockRestore()
  })

  it('registrarEntrega falhando com external_id_invalido devolve 200 mesmo assim -- corpo nunca vai suceder em retentativa', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    ingestao.falharRegistrarEntregaPara = 'lead-google-1'

    const res = await POST(requisicao(corpoValido), contexto())

    expect(res.status).toBe(200)
    expect(agendados).toHaveLength(0)
    expect(consoleErro).toHaveBeenCalled()

    consoleErro.mockRestore()
  })

  // Achado 2 do review final. Antes desta correcao a rota respondia 200 para
  // QUALQUER falha de registrarEntrega -- inclusive uma transitoria (banco
  // inalcancavel, pool esgotado), onde nada foi gravado e o lead sumiria com
  // so um console.error atras. O Google nao reenvia um 200, entao essa era a
  // falha MAIS provavel recebendo a resposta ERRADA.
  it('registrarEntrega falhando com erro transitorio (nao external_id_invalido) devolve 500, nao 200', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    ingestao.falharRegistrarEntregaTransitoriamentePara = 'lead-google-1'

    const res = await POST(requisicao(corpoValido), contexto())

    expect(res.status).toBe(500)
    expect(agendados).toHaveLength(0)
    expect(consoleErro).toHaveBeenCalled()

    consoleErro.mockRestore()
  })

  // Achado 5 do review final: sem cap de tamanho, qualquer corpo grande vira
  // payload_bruto gigante em integration_log -- disk-fill nao autenticado,
  // ja que esta rota nao tem prova de origem antes da escrita.
  it('corpo acima de 256 KiB devolve 413 e nao chega a chamar registrarEntrega', async () => {
    const corpoGigante = JSON.stringify({
      lead_id: 'lead-google-gigante',
      google_key: 'chave-do-cliente',
      user_column_data: [{ column_id: 'FULL_NAME', string_value: 'x'.repeat(300 * 1024) }],
    })

    const res = await POST(requisicao(corpoGigante), contexto())

    expect(res.status).toBe(413)
    expect(ingestao.entregas).toHaveLength(0)
    expect(agendados).toHaveLength(0)
  })

  it('corpo dentro do limite de 256 KiB continua processando normalmente', async () => {
    const corpoNoLimite = JSON.stringify({
      lead_id: 'lead-google-no-limite',
      google_key: 'chave-do-cliente',
      user_column_data: [{ column_id: 'FULL_NAME', string_value: 'x'.repeat(10 * 1024) }],
    })

    const res = await POST(requisicao(corpoNoLimite), contexto())

    expect(res.status).toBe(200)
    expect(ingestao.entregas).toHaveLength(1)
  })
})
