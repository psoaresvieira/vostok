import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { assinaturaValida } from './hmac'

const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'

/** Corpo canonico e assinatura de referencia sao calculados aqui, nunca
 * colados como literal: um literal colado no teste e a mesma classe de
 * defeito (bytes divergentes do calculo real) que este modulo existe para
 * pegar na rota de producao. */
function assinar(corpoCru: string, segredo: string): string {
  return 'sha256=' + createHmac('sha256', segredo).update(corpoCru, 'utf8').digest('hex')
}

describe('assinaturaValida', () => {
  it('aceita assinatura correta com o prefixo sha256=', () => {
    const corpo = JSON.stringify({ entry: [{ id: '123', changes: [] }] })
    const cabecalho = assinar(corpo, SEGREDO)
    expect(assinaturaValida(corpo, cabecalho, SEGREDO)).toBe(true)
  })

  it('rejeita quando um unico byte do corpo muda', () => {
    const corpoAssinado = JSON.stringify({ entry: [{ id: '123' }] })
    const cabecalho = assinar(corpoAssinado, SEGREDO)
    const corpoRecebido = JSON.stringify({ entry: [{ id: '124' }] }) // um digito diferente
    expect(assinaturaValida(corpoRecebido, cabecalho, SEGREDO)).toBe(false)
  })

  it('rejeita cabecalho nulo', () => {
    const corpo = JSON.stringify({ entry: [] })
    expect(assinaturaValida(corpo, null, SEGREDO)).toBe(false)
  })

  it('rejeita cabecalho sem o prefixo sha256=', () => {
    const corpo = JSON.stringify({ entry: [] })
    const semPrefixo = createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('hex')
    expect(assinaturaValida(corpo, semPrefixo, SEGREDO)).toBe(false)
  })

  it('rejeita cabecalho com hex de tamanho errado', () => {
    const corpo = JSON.stringify({ entry: [] })
    const correta = assinar(corpo, SEGREDO)
    const truncada = correta.slice(0, -2) // tira o ultimo byte (2 chars hex), continua hex valido
    expect(assinaturaValida(corpo, truncada, SEGREDO)).toBe(false)
  })

  it('rejeita cabecalho com caracteres nao-hex', () => {
    // Buffer.from('zz', 'hex') NAO lanca: para na primeira dupla invalida e
    // devolve um buffer truncado (aqui, vazio). Sem checar o tamanho depois
    // da decodificacao, este caso passaria por engano.
    const corpo = JSON.stringify({ entry: [] })
    const naoHex = 'sha256=' + 'zz'.repeat(32)
    expect(assinaturaValida(corpo, naoHex, SEGREDO)).toBe(false)
  })

  it('rejeita appSecret vazio mesmo que o cabecalho "bateria" com segredo vazio', () => {
    const corpo = JSON.stringify({ entry: [] })
    const cabecalhoQueBateriaComSegredoVazio = assinar(corpo, '')
    expect(assinaturaValida(corpo, cabecalhoQueBateriaComSegredoVazio, '')).toBe(false)
  })

  it('valida corpo com acentuacao (UTF-8 multibyte) sobre os bytes crus', () => {
    const corpo = JSON.stringify({ nome: 'José da Conceição', cidade: 'São Paulo' })
    const cabecalho = assinar(corpo, SEGREDO)
    expect(assinaturaValida(corpo, cabecalho, SEGREDO)).toBe(true)
  })
})
