import { describe, it, expect } from 'vitest'
import { credenciaisSchema, cadastroPorConviteSchema } from './esquemas'

describe('credenciaisSchema', () => {
  it('email e trimado e minusculado antes da validacao de formato', () => {
    const r = credenciaisSchema.safeParse({ email: '  Maria@Empresa.COM  ', senha: '12345678' })

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('maria@empresa.com')
  })

  it('email sem formato valido falha com email_invalido', () => {
    const r = credenciaisSchema.safeParse({ email: 'nao-e-email', senha: '12345678' })

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('email_invalido')
  })

  it('senha com menos de 8 caracteres falha com senha_curta', () => {
    const r = credenciaisSchema.safeParse({ email: 'maria@empresa.com', senha: '1234567' })

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('senha_curta')
  })
})

describe('cadastroPorConviteSchema', () => {
  it('NAO exige nomeConta — convidado entra em conta que ja existe', () => {
    const r = cadastroPorConviteSchema.safeParse({
      email: 'maria@empresa.com',
      senha: '12345678',
      nome: 'Maria',
      convite: 'token-abc',
    })

    expect(r.success).toBe(true)
  })

  it('convite vazio falha com convite_invalido', () => {
    const r = cadastroPorConviteSchema.safeParse({
      email: 'maria@empresa.com',
      senha: '12345678',
      nome: 'Maria',
      convite: '  ',
    })

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('convite_invalido')
  })
})
