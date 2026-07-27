import { describe, it, expect } from 'vitest'
import { leadSchema, horasNaEtapa, rotuloTempoNaEtapa } from './lead'

describe('leadSchema', () => {
  it('aceita lead so com nome', () => {
    const r = leadSchema.safeParse({ nome: 'Ana' })
    expect(r.success).toBe(true)
  })

  it('rejeita nome vazio', () => {
    const r = leadSchema.safeParse({ nome: '   ' })
    expect(r.success).toBe(false)
  })

  it('normaliza telefone e email ao validar', () => {
    const r = leadSchema.parse({
      nome: 'Ana',
      telefone: '(83) 99999-1234',
      email: ' Ana@SE7E.com ',
    })
    expect(r.telefoneE164).toBe('+5583999991234')
    expect(r.emailNorm).toBe('ana@se7e.com')
  })

  it('rejeita valor negativo', () => {
    const r = leadSchema.safeParse({ nome: 'Ana', valorCents: -1 })
    expect(r.success).toBe(false)
  })
})

describe('horasNaEtapa', () => {
  it('conta as horas cheias desde a entrada', () => {
    const entrou = new Date('2026-07-27T10:00:00Z')
    const agora = new Date('2026-07-27T15:30:00Z')
    expect(horasNaEtapa(entrou, agora)).toBe(5)
  })

  it('nunca devolve negativo', () => {
    const entrou = new Date('2026-07-27T15:00:00Z')
    const agora = new Date('2026-07-27T10:00:00Z')
    expect(horasNaEtapa(entrou, agora)).toBe(0)
  })
})

describe('rotuloTempoNaEtapa', () => {
  it('mostra horas abaixo de um dia', () => {
    expect(rotuloTempoNaEtapa(0)).toBe('agora')
    expect(rotuloTempoNaEtapa(1)).toBe('1h')
    expect(rotuloTempoNaEtapa(23)).toBe('23h')
  })

  it('mostra dias a partir de 24h', () => {
    expect(rotuloTempoNaEtapa(24)).toBe('1d')
    expect(rotuloTempoNaEtapa(75)).toBe('3d')
  })
})
