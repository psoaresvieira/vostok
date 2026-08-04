import { describe, it, expect, vi, afterEach } from 'vitest'
import { WhatsAppGraphReal } from './whatsapp-real'

/**
 * Mesma tecnica de meta-real.test.ts: `global.fetch` e substituido por um
 * double, nunca a rede de verdade. Nenhum destes testes toca rede.
 */
describe('WhatsAppGraphReal', () => {
  const fetchOriginal = global.fetch

  afterEach(() => {
    global.fetch = fetchOriginal
    vi.restoreAllMocks()
  })

  it('monta a URL com o phone_number_id e os dois fields, e mapeia a resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        display_phone_number: '+55 11 99999-9999',
        verified_name: 'Empresa X',
      }),
    })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.dadosDoNumero('token-valido', '1234567890')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({
      numeroExibicao: '+55 11 99999-9999',
      nomeVerificado: 'Empresa X',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0] as string | URL)
    expect(url.pathname).toContain('1234567890')
    expect(decodeURIComponent(url.search)).toContain('fields=display_phone_number,verified_name')
  })

  it('traduz recusa do Graph (401 com corpo de erro) em token_whatsapp_invalido', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid OAuth access token', code: 190 } }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.dadosDoNumero('token-invalido', '1234567890')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('token_whatsapp_invalido')
  })

  it('traduz fetch rejeitado (DNS/conexao/TLS/timeout) em whatsapp_indisponivel', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const g = new WhatsAppGraphReal()

    const r = await g.dadosDoNumero('token-valido', '1234567890')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('whatsapp_indisponivel')
  })
})

describe('WhatsAppGraphReal — submeterTemplate, statusDoTemplate, apagarTemplate, enviarTemplate montam URL e corpo certos', () => {
  const fetchOriginal = global.fetch

  afterEach(() => {
    global.fetch = fetchOriginal
    vi.restoreAllMocks()
  })

  it('submeterTemplate faz POST em /{waba_id}/message_templates com categoria maiuscula no fio e status normalizado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'tpl-123', status: 'PENDING' }),
    })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.submeterTemplate('token-valido', 'waba-1', {
      nome: 'boas_vindas',
      idioma: 'pt_BR',
      categoria: 'marketing',
      corpo: 'Ola {{1}}, bem-vindo!',
    })

    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({ idMeta: 'tpl-123', status: 'pending' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [chamadaUrl, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit]
    const url = new URL(chamadaUrl)
    expect(url.pathname).toContain('waba-1')
    expect(url.pathname).toContain('message_templates')
    expect(url.searchParams.get('access_token')).toBe('token-valido')
    expect(init.method).toBe('POST')
    const corpo = JSON.parse(init.body as string)
    expect(corpo).toEqual({
      name: 'boas_vindas',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Ola {{1}}, bem-vindo!' }],
    })
  })

  it('statusDoTemplate faz GET com name e fields corretos, e normaliza status/rejected_reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ name: 'boas_vindas', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }],
      }),
    })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({ status: 'rejected', motivo: 'INVALID_FORMAT' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0] as string | URL)
    expect(url.pathname).toContain('waba-1')
    expect(url.pathname).toContain('message_templates')
    expect(url.searchParams.get('access_token')).toBe('token-valido')
    expect(decodeURIComponent(url.search)).toContain('name=boas_vindas')
    expect(decodeURIComponent(url.search)).toContain('fields=name,status,rejected_reason')
  })

  it('statusDoTemplate acha o template certo por nome quando a primeira linha da resposta e de outro template', async () => {
    // O filtro `name=` do Graph nao garante que a unica (ou primeira) linha
    // devolvida seja exatamente o template pedido. Sem comparar `name`,
    // pegar `data[0]` cegamente devolveria o status de outro template.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { name: 'outro_template', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
          { name: 'boas_vindas', status: 'APPROVED', rejected_reason: 'NONE' },
        ],
      }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({ status: 'approved', motivo: null })
  })

  it('apagarTemplate faz DELETE em /{waba_id}/message_templates com name na query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.apagarTemplate('token-valido', 'waba-1', 'boas_vindas')
    expect(r.ok).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [chamadaUrl, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit]
    const url = new URL(chamadaUrl)
    expect(url.pathname).toContain('waba-1')
    expect(url.pathname).toContain('message_templates')
    expect(url.searchParams.get('access_token')).toBe('token-valido')
    expect(decodeURIComponent(url.search)).toContain('name=boas_vindas')
    expect(init.method).toBe('DELETE')
  })

  it('enviarTemplate faz POST em /{phone_number_id}/messages com "to" sem + e language.code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.123' }] }),
    })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.enviarTemplate('token-valido', 'phone-1', '+5511999999999', {
      nome: 'boas_vindas',
      idioma: 'pt_BR',
      valores: ['Fulano'],
    })

    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({ idMensagem: 'wamid.123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [chamadaUrl, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit]
    const url = new URL(chamadaUrl)
    expect(url.pathname).toContain('phone-1')
    expect(url.pathname).toContain('messages')
    expect(url.searchParams.get('access_token')).toBe('token-valido')
    expect(init.method).toBe('POST')
    const corpo = JSON.parse(init.body as string)
    expect(corpo).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'template',
      template: {
        name: 'boas_vindas',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Fulano' }] }],
      },
    })
  })
})

describe('WhatsAppGraphReal — traducao de erro por metodo', () => {
  const fetchOriginal = global.fetch

  afterEach(() => {
    global.fetch = fetchOriginal
    vi.restoreAllMocks()
  })

  it('submeterTemplate: 4xx com erro do Graph vira template_recusado_pelo_meta', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid parameter', code: 100 } }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.submeterTemplate('token', 'waba-1', {
      nome: 'x',
      idioma: 'pt_BR',
      categoria: 'marketing',
      corpo: 'oi',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('template_recusado_pelo_meta')
  })

  it('enviarTemplate: 4xx com erro do Graph vira envio_recusado', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Template not approved', code: 132001 } }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.enviarTemplate('token', 'phone-1', '5511999999999', {
      nome: 'x',
      idioma: 'pt_BR',
      valores: [],
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('envio_recusado')
  })

  it('rejeicao de rede (DNS/conexao/TLS/timeout) vira whatsapp_indisponivel', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const g = new WhatsAppGraphReal()

    const r = await g.apagarTemplate('token', 'waba-1', 'x')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('whatsapp_indisponivel')
  })

  it('statusDoTemplate: zero resultados vira template_nao_encontrado', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token', 'waba-1', 'inexistente')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('template_nao_encontrado')
  })

  it('submeterTemplate: 200 sem "error" mas faltando id/status vira whatsapp_indisponivel, nao template_recusado_pelo_meta', async () => {
    // Formato inesperado != recusa: o Graph aceitou a chamada (r.ok, sem
    // corpo de erro) mas devolveu algo que o codigo nao reconhece. Rotular
    // isso de "recusado" seria enganoso — o problema e o formato, nao o
    // conteudo do template.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.submeterTemplate('token', 'waba-1', {
      nome: 'x',
      idioma: 'pt_BR',
      categoria: 'marketing',
      corpo: 'oi',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('whatsapp_indisponivel')
  })

  it('enviarTemplate: 200 sem "error" mas faltando messages[0].id vira whatsapp_indisponivel, nao envio_recusado', async () => {
    // Mesmo raciocinio do caso acima, e ainda mais critico aqui: rotular
    // formato inesperado de "recusado" convidaria um reenvio automatico, e a
    // mensagem original pode ja ter sido enviada do lado do Meta —
    // duplicando o disparo.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.enviarTemplate('token', 'phone-1', '5511999999999', {
      nome: 'x',
      idioma: 'pt_BR',
      valores: [],
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('whatsapp_indisponivel')
  })
})
