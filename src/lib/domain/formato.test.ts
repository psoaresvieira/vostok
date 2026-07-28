import { describe, it, expect } from 'vitest'
import { formatarMoeda, formatarTelefone, parsearReaisEmCentavos } from './formato'

describe('formatarMoeda', () => {
  it('formata centavos em reais', () => {
    expect(formatarMoeda(150000)).toBe('R$ 1.500,00')
    expect(formatarMoeda(0)).toBe('R$ 0,00')
  })

  it('devolve traco para valor ausente', () => {
    expect(formatarMoeda(null)).toBe('—')
  })
})

describe('parsearReaisEmCentavos', () => {
  it('devolve null para string vazia', () => {
    expect(parsearReaisEmCentavos('')).toBeNull()
  })

  it('devolve null para string so com espacos', () => {
    expect(parsearReaisEmCentavos('   ')).toBeNull()
  })

  it('converte numero inteiro simples', () => {
    expect(parsearReaisEmCentavos('1500')).toBe(150000)
  })

  it('converte com virgula decimal', () => {
    expect(parsearReaisEmCentavos('1500,50')).toBe(150050)
  })

  it('converte com separador de milhar pt-BR', () => {
    expect(parsearReaisEmCentavos('1.500,00')).toBe(150000)
  })

  it('converte com multiplos separadores de milhar', () => {
    expect(parsearReaisEmCentavos('1.234.567,89')).toBe(123456789)
  })

  it('converte valor colado com prefixo R$ e espaco comum', () => {
    expect(parsearReaisEmCentavos('R$ 1.500,00')).toBe(150000)
  })

  it('converte valor colado com prefixo R$ e espaco nao separavel (NBSP)', () => {
    expect(parsearReaisEmCentavos('R$ 1.500,00')).toBe(150000)
  })

  it('converte ponto como separador decimal quando nao ha virgula', () => {
    expect(parsearReaisEmCentavos('1500.50')).toBe(150050)
  })

  it('devolve null para texto nao numerico', () => {
    expect(parsearReaisEmCentavos('abc')).toBeNull()
  })

  it('devolve null para valor negativo', () => {
    expect(parsearReaisEmCentavos('-100')).toBeNull()
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
