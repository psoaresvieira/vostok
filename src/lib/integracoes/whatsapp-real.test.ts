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
