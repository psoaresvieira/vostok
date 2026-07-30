import { describe, it, expect } from 'vitest'
import { gerarEstado, conferirEstado } from './estado-oauth'

describe('gerarEstado', () => {
  it('gera 64 caracteres hexadecimais', () => {
    expect(gerarEstado()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('nao repete', () => {
    const vistos = new Set(Array.from({ length: 50 }, () => gerarEstado()))
    expect(vistos.size).toBe(50)
  })
})

describe('conferirEstado', () => {
  it('aceita quando os dois lados batem', () => {
    const e = gerarEstado()
    expect(conferirEstado(e, e)).toBe(true)
  })

  it('recusa quando diferem', () => {
    expect(conferirEstado(gerarEstado(), gerarEstado())).toBe(false)
  })

  it('recusa quando o cookie nao existe', () => {
    expect(conferirEstado(undefined, gerarEstado())).toBe(false)
  })

  it('recusa quando a url nao traz state', () => {
    expect(conferirEstado(gerarEstado(), null)).toBe(false)
  })

  it('recusa string vazia dos dois lados — vazio nao e igualdade valida', () => {
    expect(conferirEstado('', '')).toBe(false)
  })

  it('recusa tamanhos diferentes sem estourar', () => {
    expect(conferirEstado('abc', 'abcdef')).toBe(false)
  })
})
