import { describe, it, expect } from 'vitest'
import { formatarMoeda, formatarTelefone } from './formato'

describe('formatarMoeda', () => {
  it('formata centavos em reais', () => {
    expect(formatarMoeda(150000)).toBe('R$ 1.500,00')
    expect(formatarMoeda(0)).toBe('R$ 0,00')
  })

  it('devolve traco para valor ausente', () => {
    expect(formatarMoeda(null)).toBe('—')
  })
})

describe('formatarTelefone', () => {
  it('formata celular brasileiro', () => {
    expect(formatarTelefone('+5583999991234')).toBe('(83) 99999-1234')
  })

  it('formata fixo brasileiro', () => {
    expect(formatarTelefone('+558332221234')).toBe('(83) 3222-1234')
  })

  it('devolve o proprio numero quando nao e brasileiro', () => {
    expect(formatarTelefone('+14155550100')).toBe('+14155550100')
  })

  it('devolve traco para ausente', () => {
    expect(formatarTelefone(null)).toBe('—')
  })
})
