import { describe, it, expect } from 'vitest'
import { credenciaisSchema, cadastroSchema } from './esquemas'

describe('credenciaisSchema', () => {
  it('aceita email e senha validos', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana@se7e.com', senha: 'segredo123' })
    expect(r.success).toBe(true)
  })

  it('rejeita email invalido', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana', senha: 'segredo123' })
    expect(r.success).toBe(false)
  })

  it('rejeita senha curta', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana@se7e.com', senha: '123' })
    expect(r.success).toBe(false)
  })

  it('normaliza o email para minusculas', () => {
    const r = credenciaisSchema.parse({ email: '  Ana@SE7E.com ', senha: 'segredo123' })
    expect(r.email).toBe('ana@se7e.com')
  })
})

describe('cadastroSchema', () => {
  it('exige nome da pessoa e nome da conta', () => {
    expect(
      cadastroSchema.safeParse({
        email: 'ana@se7e.com',
        senha: 'segredo123',
        nome: 'Ana',
        nomeConta: 'SE7E',
      }).success,
    ).toBe(true)

    expect(
      cadastroSchema.safeParse({
        email: 'ana@se7e.com',
        senha: 'segredo123',
        nome: 'Ana',
        nomeConta: '  ',
      }).success,
    ).toBe(false)
  })
})
