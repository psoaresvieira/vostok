import { describe, it, expect } from 'vitest'
import { trocaDeSenhaSchema } from './esquemas'

describe('trocaDeSenhaSchema', () => {
  it('aceita senha de 8+ com confirmacao igual', () => {
    const r = trocaDeSenhaSchema.safeParse({ senha: 'segredo123', confirmacao: 'segredo123' })
    expect(r.success).toBe(true)
  })

  it('rejeita senha curta com senha_curta', () => {
    const r = trocaDeSenhaSchema.safeParse({ senha: '123', confirmacao: '123' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('senha_curta')
  })

  it('rejeita confirmacao diferente com senhas_diferentes', () => {
    const r = trocaDeSenhaSchema.safeParse({ senha: 'segredo123', confirmacao: 'outrasenha1' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('senhas_diferentes')
  })
})
