import { describe, it, expect } from 'vitest'
import { valorPostgrest, padraoIlike } from './filtro'

describe('valorPostgrest', () => {
  it('envolve em aspas duplas', () => {
    expect(valorPostgrest('joao')).toBe('"joao"')
  })

  it('neutraliza a virgula, que separaria condicoes no or()', () => {
    expect(valorPostgrest('a,b')).toBe('"a,b"')
  })

  it('neutraliza o ponto, que separaria coluna de operador', () => {
    expect(valorPostgrest('nome.eq.x')).toBe('"nome.eq.x"')
  })

  it('escapa aspas duplas com barra invertida', () => {
    expect(valorPostgrest('diz "oi"')).toBe('"diz \\"oi\\""')
  })

  it('escapa a barra invertida antes das aspas, sem escapar duas vezes', () => {
    expect(valorPostgrest('c:\\temp')).toBe('"c:\\\\temp"')
  })

  it('aceita string vazia', () => {
    expect(valorPostgrest('')).toBe('""')
  })

  it('nao mexe em parenteses, que so tem sentido fora das aspas', () => {
    expect(valorPostgrest('(a)')).toBe('"(a)"')
  })
})

describe('padraoIlike', () => {
  it('cerca o texto de curingas', () => {
    expect(padraoIlike('joao')).toBe('"%joao%"')
  })

  it('trata o porcento digitado como literal', () => {
    // Sem isso, buscar "100%" casaria com "1000 leads": o texto do usuario
    // virava padrao. Este e o bug do backlog #9.
    expect(padraoIlike('100%')).toBe('"%100\\\\%%"')
  })

  it('trata o underline digitado como literal', () => {
    expect(padraoIlike('lead_frio')).toBe('"%lead\\\\_frio%"')
  })

  it('escapa a barra invertida do LIKE antes de tudo', () => {
    expect(padraoIlike('a\\b')).toBe('"%a\\\\\\\\b%"')
  })

  it('neutraliza virgula e ponto junto com os curingas', () => {
    expect(padraoIlike('a,b.c')).toBe('"%a,b.c%"')
  })
})
