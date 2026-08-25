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

  it('statusDoTemplate segue paging.next quando o template exato nao esta na primeira pagina', async () => {
    // O `name=` do Graph e prefix-match e a resposta e paginada: com orfaos de
    // re-submissao acumulados (o apagar e best-effort), o template exato pode
    // cair fora da primeira pagina — e parar nela devolveria
    // template_nao_encontrado para um template que EXISTE, derrubando o envio.
    const proxima =
      'https://graph.facebook.com/v21.0/waba-1/message_templates?after=CURSOR&access_token=token-valido'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ name: 'boas_vindas_11111111', status: 'REJECTED', rejected_reason: 'NONE' }],
          paging: { next: proxima },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ name: 'boas_vindas', status: 'APPROVED', rejected_reason: 'NONE' }],
        }),
      })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({ status: 'approved', motivo: null })

    // A segunda chamada foi para o link que o Graph mandou, como esta.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(new URL(fetchMock.mock.calls[1][0] as string | URL))).toBe(proxima)
  })

  it('statusDoTemplate para no teto de paginas e devolve whatsapp_indisponivel, nunca um "nao existe" sem ter olhado tudo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ name: 'outro', status: 'APPROVED', rejected_reason: 'NONE' }],
        paging: {
          next: 'https://graph.facebook.com/v21.0/waba-1/message_templates?after=X&access_token=t',
        },
      }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    // Nao e template_nao_encontrado: com paginas restantes, "nao existe" seria
    // afirmacao sem prova — e a tela trata indisponivel como transitorio.
    expect(r.erro).toBe('whatsapp_indisponivel')
    expect(global.fetch).toHaveBeenCalledTimes(10)
  })

  it('statusDoTemplate respeita um prazo TOTAL na paginacao: paginas lentas nao somam 10x o timeout', async () => {
    // Sem deadline agregado, 10 paginas de ate 10s cada podem segurar o route
    // handler por 100s — a plataforma o mataria muito antes, e o usuario ve um
    // erro generico sem log nosso. O relogio falso avanca 6s por pagina: a
    // primeira cabe no prazo, a segunda tambem comeca dentro dele, e a terceira
    // ja nao comeca (12s > 10s de orcamento total).
    let agora = 0
    vi.spyOn(Date, 'now').mockImplementation(() => agora)
    global.fetch = vi.fn().mockImplementation(async () => {
      agora += 6_000
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ name: 'outro', status: 'APPROVED', rejected_reason: 'NONE' }],
          paging: {
            next: 'https://graph.facebook.com/v21.0/waba-1/message_templates?after=X&access_token=t',
          },
        }),
      }
    })
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('whatsapp_indisponivel')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('statusDoTemplate com paging.next malformado devolve whatsapp_indisponivel em vez de estourar', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ name: 'outro', status: 'APPROVED', rejected_reason: 'NONE' }],
        paging: { next: 'nao-e-uma-url' },
      }),
    })
    const g = new WhatsAppGraphReal()

    const r = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('whatsapp_indisponivel')
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

  it('enviarTemplate SEM variaveis nao manda a chave components — o Graph rejeita parameters vazio', async () => {
    // Template sem placeholder e' template legitimo e comum (um aviso fixo). O
    // Graph recusa `parameters: []` com erro #100, entao mandar a chave vazia
    // faria TODO envio desses templates falhar para sempre com
    // 'envio_recusado' — e a tela nao teria como explicar por que.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.456' }] }),
    })
    global.fetch = fetchMock
    const g = new WhatsAppGraphReal()

    const r = await g.enviarTemplate('token-valido', 'phone-1', '+5511999999999', {
      nome: 'aviso_fixo',
      idioma: 'pt_BR',
      valores: [],
    })

    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({ idMensagem: 'wamid.456' })

    const [, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit]
    const corpo = JSON.parse(init.body as string)
    // AUSENCIA da chave, e nao valor undefined: `components: undefined` some no
    // JSON.stringify de hoje, mas viraria `null` no fio se o serializador
    // mudasse — e null nao e' o mesmo que omitido para o Graph. O `in` prova a
    // ausencia no corpo que de fato foi postado.
    expect('components' in corpo.template).toBe(false)
    expect(corpo.template).toEqual({ name: 'aviso_fixo', language: { code: 'pt_BR' } })
    expect(corpo).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'template',
      template: { name: 'aviso_fixo', language: { code: 'pt_BR' } },
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
