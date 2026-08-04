import { describe, it, expect } from 'vitest'
import { WhatsAppGraphFalso } from './whatsapp-falso'

describe('WhatsAppGraphFalso', () => {
  it('devolve os dados de um numero cadastrado e registra a consulta', async () => {
    const g = new WhatsAppGraphFalso()
    g.tokensAceitos.add('token-valido')
    g.numeros.set('1234567890', {
      numeroExibicao: '+55 11 99999-9999',
      nomeVerificado: 'Empresa X',
    })

    const r = await g.dadosDoNumero('token-valido', '1234567890')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({
      numeroExibicao: '+55 11 99999-9999',
      nomeVerificado: 'Empresa X',
    })
    expect(g.consultados).toEqual([{ token: 'token-valido', phoneNumberId: '1234567890' }])
  })

  it('recusa token nao cadastrado com token_whatsapp_invalido e ainda assim registra a consulta', async () => {
    // O registro existe para provar que a chamada aconteceu, inclusive as
    // recusadas — a Task 3 precisa poder afirmar isso sem espionar a chamada.
    const g = new WhatsAppGraphFalso()
    g.numeros.set('1234567890', {
      numeroExibicao: '+55 11 99999-9999',
      nomeVerificado: 'Empresa X',
    })

    const r = await g.dadosDoNumero('token-desconhecido', '1234567890')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('token_whatsapp_invalido')
    expect(g.consultados).toEqual([{ token: 'token-desconhecido', phoneNumberId: '1234567890' }])
  })
})
