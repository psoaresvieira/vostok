import { describe, it, expect } from 'vitest'
import { mensagemDeErroSenha } from './erros'

describe('mensagemDeErroSenha', () => {
  it.each([
    'senha_curta',
    'senhas_diferentes',
    'senha_igual',
    'sem_sessao',
    'erro_ao_trocar_senha',
  ])('traduz cada codigo novo: %s', (codigo) => {
    expect(mensagemDeErroSenha(codigo)).not.toBe(codigo)
  })

  it('ecoa codigo desconhecido', () => {
    expect(mensagemDeErroSenha('codigo_qualquer')).toBe('codigo_qualquer')
  })
})
