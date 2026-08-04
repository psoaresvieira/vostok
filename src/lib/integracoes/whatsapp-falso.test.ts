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

describe('WhatsAppGraphFalso — submeterTemplate e statusDoTemplate', () => {
  it('submeterTemplate registra a chamada e o template nasce approved por padrao', async () => {
    const g = new WhatsAppGraphFalso()

    const r = await g.submeterTemplate('token-valido', 'waba-1', {
      nome: 'boas_vindas',
      idioma: 'pt_BR',
      categoria: 'marketing',
      corpo: 'Ola {{1}}',
    })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.status).toBe('approved')
    expect(g.submetidos).toEqual([
      {
        token: 'token-valido',
        wabaId: 'waba-1',
        nome: 'boas_vindas',
        idioma: 'pt_BR',
        categoria: 'marketing',
        corpo: 'Ola {{1}}',
      },
    ])

    const status = await g.statusDoTemplate('token-valido', 'waba-1', 'boas_vindas')
    if (!status.ok) throw new Error(status.erro)
    expect(status.valor).toEqual({ status: 'approved', motivo: null })
  })

  it('template configurado como pending/rejected devolve isso com motivo em statusDoTemplate', async () => {
    const g = new WhatsAppGraphFalso()
    g.templates.set('promo_pendente', {
      status: 'pending',
      motivo: null,
      corpo: 'x',
      categoria: 'marketing',
    })
    g.templates.set('promo_rejeitada', {
      status: 'rejected',
      motivo: 'FORMATTING_ISSUES',
      corpo: 'x',
      categoria: 'marketing',
    })

    const pendente = await g.statusDoTemplate('token', 'waba-1', 'promo_pendente')
    if (!pendente.ok) throw new Error(pendente.erro)
    expect(pendente.valor).toEqual({ status: 'pending', motivo: null })

    const rejeitada = await g.statusDoTemplate('token', 'waba-1', 'promo_rejeitada')
    if (!rejeitada.ok) throw new Error(rejeitada.erro)
    expect(rejeitada.valor).toEqual({ status: 'rejected', motivo: 'FORMATTING_ISSUES' })
  })

  it('statusDoTemplate de nome inexistente devolve template_nao_encontrado', async () => {
    const g = new WhatsAppGraphFalso()

    const r = await g.statusDoTemplate('token', 'waba-1', 'nao_existe')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('template_nao_encontrado')
  })
})

describe('WhatsAppGraphFalso — enviarTemplate', () => {
  it('caminho feliz registra token, phoneNumberId, e164Destino, nome e valores', async () => {
    const g = new WhatsAppGraphFalso()
    g.templates.set('boas_vindas', {
      status: 'approved',
      motivo: null,
      corpo: 'Ola {{1}}',
      categoria: 'marketing',
    })

    const r = await g.enviarTemplate('token-valido', 'phone-1', '5511999999999', {
      nome: 'boas_vindas',
      idioma: 'pt_BR',
      valores: ['Fulano'],
    })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.idMensagem).toBeTruthy()
    expect(g.enviados).toEqual([
      {
        token: 'token-valido',
        phoneNumberId: 'phone-1',
        e164Destino: '5511999999999',
        nome: 'boas_vindas',
        valores: ['Fulano'],
      },
    ])
  })

  it('recusa envio de template inexistente ou nao aprovado com envio_recusado', async () => {
    const g = new WhatsAppGraphFalso()
    g.templates.set('promo_pendente', {
      status: 'pending',
      motivo: null,
      corpo: 'x',
      categoria: 'marketing',
    })

    const inexistente = await g.enviarTemplate('token', 'phone-1', '5511999999999', {
      nome: 'nao_existe',
      idioma: 'pt_BR',
      valores: [],
    })
    expect(inexistente.ok).toBe(false)
    if (inexistente.ok) throw new Error('deveria ter falhado')
    expect(inexistente.erro).toBe('envio_recusado')

    const naoAprovado = await g.enviarTemplate('token', 'phone-1', '5511999999999', {
      nome: 'promo_pendente',
      idioma: 'pt_BR',
      valores: [],
    })
    expect(naoAprovado.ok).toBe(false)
    if (naoAprovado.ok) throw new Error('deveria ter falhado')
    expect(naoAprovado.erro).toBe('envio_recusado')

    expect(g.enviados).toHaveLength(2)
  })
})
