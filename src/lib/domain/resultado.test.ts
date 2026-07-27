import { describe, it, expect } from 'vitest'
import { ok, falha, type Resultado } from './resultado'

describe('Resultado', () => {
  it('ok carrega o valor', () => {
    const r: Resultado<number> = ok(42)
    expect(r).toEqual({ ok: true, valor: 42 })
  })

  it('falha carrega o codigo de erro', () => {
    const r: Resultado<number> = falha('motivo_perda_obrigatorio')
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('estreita o tipo apos checar ok', () => {
    const r: Resultado<string> = ok('lead')
    if (r.ok) {
      expect(r.valor.toUpperCase()).toBe('LEAD')
    } else {
      throw new Error('deveria ser ok')
    }
  })
})
