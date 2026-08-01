import { describe, it, expect } from 'vitest'
import { paraPayload, type DadosDoLead } from './dados'

const DADOS: DadosDoLead = {
  nome: 'Ana Silva',
  telefone: '(83) 99999-1234',
  telefoneE164: '+5583999991234',
  email: 'ANA@EXAMPLE.COM',
  emailNorm: 'ana@example.com',
  empresa: 'SE7E Marketing',
  campanhaOrigem: 'Campanha de Verao',
  formularioOrigem: 'Formulario A',
  extras: { qual_o_seu_orcamento: 'Entre R$5.000 e R$10.000' },
}

describe('paraPayload', () => {
  it('emite exatamente o conjunto de chaves snake_case que a RPC ingerir_lead espera', () => {
    const payload = paraPayload(DADOS)
    expect(Object.keys(payload).sort()).toEqual(
      [
        'nome',
        'telefone',
        'telefone_e164',
        'email',
        'email_norm',
        'empresa',
        'campanha_origem',
        'formulario_origem',
        'extras',
      ].sort()
    )
  })

  it('repassa os valores sem transformar', () => {
    const payload = paraPayload(DADOS)
    expect(payload).toEqual({
      nome: 'Ana Silva',
      telefone: '(83) 99999-1234',
      telefone_e164: '+5583999991234',
      email: 'ANA@EXAMPLE.COM',
      email_norm: 'ana@example.com',
      empresa: 'SE7E Marketing',
      campanha_origem: 'Campanha de Verao',
      formulario_origem: 'Formulario A',
      extras: { qual_o_seu_orcamento: 'Entre R$5.000 e R$10.000' },
    })
  })

  it('repassa nulos como nulos, sem inventar valor', () => {
    const dados: DadosDoLead = {
      nome: null,
      telefone: null,
      telefoneE164: null,
      email: null,
      emailNorm: null,
      empresa: null,
      campanhaOrigem: null,
      formularioOrigem: null,
      extras: {},
    }
    const payload = paraPayload(dados)
    expect(payload).toEqual({
      nome: null,
      telefone: null,
      telefone_e164: null,
      email: null,
      email_norm: null,
      empresa: null,
      campanha_origem: null,
      formulario_origem: null,
      extras: {},
    })
  })

  it('extras vazio passa como objeto vazio, nao nulo nem ausente', () => {
    const dados: DadosDoLead = { ...DADOS, extras: {} }
    const payload = paraPayload(dados)
    expect(payload.extras).toEqual({})
  })
})
