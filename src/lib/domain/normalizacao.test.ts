import { describe, it, expect } from 'vitest'
import { normalizarTelefone, normalizarEmail, normalizarNomeEtiqueta } from './normalizacao'

describe('normalizarTelefone', () => {
  it('converte celular brasileiro com mascara para E.164', () => {
    expect(normalizarTelefone('(83) 99999-1234')).toBe('+5583999991234')
  })

  it('converte fixo de 10 digitos', () => {
    expect(normalizarTelefone('83 3222-1234')).toBe('+558332221234')
  })

  it('mantem numero que ja veio com codigo do pais', () => {
    expect(normalizarTelefone('5583999991234')).toBe('+5583999991234')
    expect(normalizarTelefone('+55 83 99999-1234')).toBe('+5583999991234')
  })

  it('preserva internacional nao brasileiro', () => {
    expect(normalizarTelefone('+1 415 555 0100')).toBe('+14155550100')
  })

  it('devolve null para vazio, nulo ou lixo', () => {
    expect(normalizarTelefone('')).toBeNull()
    expect(normalizarTelefone(null)).toBeNull()
    expect(normalizarTelefone('   ')).toBeNull()
    expect(normalizarTelefone('123')).toBeNull()
  })
})

describe('normalizarEmail', () => {
  it('baixa a caixa e apara espacos', () => {
    expect(normalizarEmail('  Ana.Silva@Exemplo.com ')).toBe('ana.silva@exemplo.com')
  })

  it('devolve null para vazio ou invalido', () => {
    expect(normalizarEmail(null)).toBeNull()
    expect(normalizarEmail('')).toBeNull()
    expect(normalizarEmail('sem-arroba')).toBeNull()
  })
})

describe('normalizarNomeEtiqueta', () => {
  it('apara espacos e colapsa espacos internos', () => {
    expect(normalizarNomeEtiqueta('  Preço   alto  ')).toBe('Preço alto')
  })

  it('preserva a caixa digitada pelo usuario', () => {
    expect(normalizarNomeEtiqueta('PREÇO ALTO')).toBe('PREÇO ALTO')
  })
})
