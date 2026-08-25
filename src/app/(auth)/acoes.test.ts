import { describe, it, expect, vi } from 'vitest'
import { credenciaisSchema, cadastroPorConviteSchema } from './esquemas'
import { mensagemDeErro } from './erros'
import { cadastrar } from './acoes'

vi.mock('@/lib/supabase/servidor', () => ({
  criarClienteServidor: vi.fn(async () => {
    throw new Error('cadastro sem convite nao pode tocar o supabase')
  }),
}))

describe('credenciaisSchema', () => {
  it('aceita email e senha validos', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana@exemplo.com', senha: 'segredo123' })
    expect(r.success).toBe(true)
  })

  it('rejeita email invalido', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana', senha: 'segredo123' })
    expect(r.success).toBe(false)
  })

  it('rejeita senha curta', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana@exemplo.com', senha: '123' })
    expect(r.success).toBe(false)
  })

  it('normaliza o email para minusculas', () => {
    const r = credenciaisSchema.parse({ email: '  Ana@Exemplo.com ', senha: 'segredo123' })
    expect(r.email).toBe('ana@exemplo.com')
  })
})

describe('cadastroPorConviteSchema', () => {
  it('aceita cadastro sem nome de empresa quando ha token', () => {
    const r = cadastroPorConviteSchema.safeParse({
      email: 'ana@exemplo.com',
      senha: 'segredo123',
      nome: 'Ana',
      convite: 'abc123',
    })
    expect(r.success).toBe(true)
  })

  it('rejeita token vazio: sem token nao ha convite a resgatar', () => {
    expect(
      cadastroPorConviteSchema.safeParse({
        email: 'ana@exemplo.com',
        senha: 'segredo123',
        nome: 'Ana',
        convite: '   ',
      }).success,
    ).toBe(false)
  })

  it('nao exige nomeConta, mesmo se vier junto', () => {
    const r = cadastroPorConviteSchema.parse({
      email: 'ana@exemplo.com',
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

describe('cadastrar sem convite', () => {
  it('falha com cadastro_fechado antes de qualquer chamada ao supabase', async () => {
    const fd = new FormData()
    fd.set('nome', 'Ana')
    fd.set('email', 'ana@exemplo.com')
    fd.set('senha', 'segredo123')
    const r = await cadastrar(fd)
    expect(r).toEqual({ ok: false, erro: 'cadastro_fechado' })
  })
})

describe('mensagemDeErro do cadastro fechado', () => {
  it('explica que o cadastro e por convite', () => {
    expect(mensagemDeErro('cadastro_fechado')).toBe(
      'O cadastro é feito por convite. Peça o link ao administrador.',
    )
  })
})

describe('mensagemDeErro do login', () => {
  it('traduz credenciais invalidas em vez de mostrar o codigo cru', () => {
    expect(mensagemDeErro('credenciais_invalidas')).toBe('Email ou senha incorretos.')
  })
})
