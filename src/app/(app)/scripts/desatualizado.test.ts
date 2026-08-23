import { describe, it, expect } from 'vitest'
import { traduzirParaPosicional } from '@/lib/domain/script'
import { estaDesatualizado } from './desatualizado'

/**
 * Puro contra puro: o snapshot das fixtures vem do proprio
 * traduzirParaPosicional, porque e exatamente assim que ele nasce em
 * producao (submissao grava a traducao do conteudo daquele momento).
 */

function snapshotDe(conteudo: string): { corpoPosicional: string; mapa: string[] } {
  const t = traduzirParaPosicional(conteudo)
  if (!t.ok) throw new Error(`fixture nao traduz: ${conteudo}`)
  return { corpoPosicional: t.valor.corpo, mapa: t.valor.mapa }
}

describe('estaDesatualizado', () => {
  it('conteudo identico ao submetido: atualizado', () => {
    const conteudo = 'Olá {{primeiro_nome}}, aqui é da {{empresa}}.'

    expect(estaDesatualizado(conteudo, snapshotDe(conteudo))).toBe(false)
  })

  it('so o texto literal mudou: desatualizado (corpo posicional difere)', () => {
    const snapshot = snapshotDe('Olá {{primeiro_nome}}!')

    expect(estaDesatualizado('Oi {{primeiro_nome}}!', snapshot)).toBe(true)
  })

  it('mesmo corpo posicional com mapa diferente: desatualizado', () => {
    // 'Olá {{1}}' vale tanto para primeiro_nome quanto para empresa — e
    // exatamente o caso do comentario do modulo: comparar so o corpo
    // preencheria o slot com o valor errado.
    const snapshot = snapshotDe('Olá {{primeiro_nome}}')

    expect(estaDesatualizado('Olá {{empresa}}', snapshot)).toBe(true)
  })

  it('variavel a mais no fim: desatualizado (mapa cresceu)', () => {
    const snapshot = snapshotDe('Olá {{primeiro_nome}}')

    expect(estaDesatualizado('Olá {{primeiro_nome}} da {{empresa}}', snapshot)).toBe(true)
  })

  it('conteudo que nem traduz (variavel desconhecida): desatualizado, fail closed', () => {
    const snapshot = snapshotDe('Olá {{primeiro_nome}}')

    expect(estaDesatualizado('Olá {{variavel_inventada}}', snapshot)).toBe(true)
  })

  it('variavel repetida reusa a posicao e continua batendo com o snapshot', () => {
    const conteudo = '{{primeiro_nome}}, confirma? Obrigado, {{primeiro_nome}}!'

    expect(estaDesatualizado(conteudo, snapshotDe(conteudo))).toBe(false)
  })
})
