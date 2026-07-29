import { describe, it, expect } from 'vitest'
import { credenciaisSchema, cadastroSchema, cadastroPorConviteSchema } from './esquemas'
import { mensagemDeErro } from './erros'

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

describe('cadastroPorConviteSchema', () => {
  it('aceita cadastro sem nome de empresa quando ha token', () => {
    const r = cadastroPorConviteSchema.safeParse({
      email: 'ana@se7e.com',
      senha: 'segredo123',
      nome: 'Ana',
      convite: 'abc123',
    })
    expect(r.success).toBe(true)
  })

  it('rejeita token vazio: sem token nao ha convite a resgatar', () => {
    expect(
      cadastroPorConviteSchema.safeParse({
        email: 'ana@se7e.com',
        senha: 'segredo123',
        nome: 'Ana',
        convite: '   ',
      }).success,
    ).toBe(false)
  })

  it('nao exige nomeConta, mesmo se vier junto', () => {
    const r = cadastroPorConviteSchema.parse({
      email: 'ana@se7e.com',
      senha: 'segredo123',
      nome: 'Ana',
      convite: 'abc123',
      nomeConta: '',
    })
    expect(r).not.toHaveProperty('nomeConta')
  })
})

describe('mensagemDeErro do fluxo de convite', () => {
  it('traduz o convite de outro email em vez de mostrar o codigo', () => {
    expect(mensagemDeErro('convite_de_outro_email')).toBe(
      'Este convite foi enviado para outro email. Entre com o email convidado para aceitá-lo.',
    )
  })

  it('devolve o codigo cru quando nao conhece a mensagem', () => {
    expect(mensagemDeErro('coisa_estranha')).toBe('coisa_estranha')
  })
})
