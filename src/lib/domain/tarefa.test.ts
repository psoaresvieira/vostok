import { describe, it, expect } from 'vitest'
import { FUSO_PADRAO, classificar, contarUrgentes } from './tarefa'

describe('classificar', () => {
  it('um milissegundo antes de agora e atrasada', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const venceEm = new Date(agora.getTime() - 1)
    expect(classificar(venceEm, agora, FUSO_PADRAO)).toBe('atrasada')
  })

  it('hoje mais tarde e hoje; hoje mais cedo e atrasada, mesmo dia civil', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const maisTarde = new Date('2026-08-02T18:00:00-03:00')
    const maisCedo = new Date('2026-08-02T08:00:00-03:00')
    expect(classificar(maisTarde, agora, FUSO_PADRAO)).toBe('hoje')
    expect(classificar(maisCedo, agora, FUSO_PADRAO)).toBe('atrasada')
  })

  it('caso que so o fuso resolve: mesmo dia em UTC, dias civis diferentes em America/Sao_Paulo', () => {
    // agora = 2026-08-03T02:00:00Z = 2026-08-02T23:00:00-03:00 (dia 2)
    // venceEm = 2026-08-03T03:00:00Z = 2026-08-03T00:00:00-03:00 (dia 3, meia-noite)
    // Em UTC os dois caem no dia 3; no fuso do produto sao dias civis diferentes.
    const agora = new Date('2026-08-03T02:00:00Z')
    const venceEm = new Date('2026-08-03T03:00:00Z')
    expect(classificar(venceEm, agora, FUSO_PADRAO)).toBe('proximos7')
  })

  it('vinte e tres horas e meia de distancia pode ser proximos7', () => {
    // agora 23h30 no fuso, venceEm no dia seguinte as 23h00: menos de 24h de
    // diferenca, mas dias civis diferentes.
    const agora = new Date('2026-08-02T23:30:00-03:00')
    const venceEm = new Date('2026-08-03T23:00:00-03:00')
    expect(classificar(venceEm, agora, FUSO_PADRAO)).toBe('proximos7')
  })

  it('fronteira dos sete dias: amanha+6 e proximos7, amanha+7 e depois', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const amanhaMais6 = new Date('2026-08-09T12:00:00-03:00')
    const amanhaMais7 = new Date('2026-08-10T12:00:00-03:00')
    expect(classificar(amanhaMais6, agora, FUSO_PADRAO)).toBe('proximos7')
    expect(classificar(amanhaMais7, agora, FUSO_PADRAO)).toBe('depois')
  })
})

describe('contarUrgentes', () => {
  it('soma atrasada e hoje e ignora o resto', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const atrasada = new Date('2026-08-02T08:00:00-03:00')
    const hoje = new Date('2026-08-02T18:00:00-03:00')
    const proximos7 = new Date('2026-08-05T12:00:00-03:00')
    const depois = new Date('2026-08-15T12:00:00-03:00')
    expect(contarUrgentes([atrasada, hoje, proximos7, depois], agora, FUSO_PADRAO)).toBe(2)
  })
})
