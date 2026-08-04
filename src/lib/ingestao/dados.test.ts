import { describe, it, expect } from 'vitest'
import { paraPayload, type DadosDoLead } from './dados'

const DADOS: DadosDoLead = {
  nome: 'Ana Silva',
  telefone: '(83) 99999-1234',
  telefoneE164: '+5583999991234',
  email: 'ANA@EXAMPLE.COM',
  emailNorm: 'ana@example.com',
  empresa: 'Exemplo Marketing',
  campanhaId: 'camp-1',
  campanhaNome: 'Campanha de Verao',
  conjuntoId: 'adset-1',
  conjuntoNome: 'Conjunto Interesse',
  anuncioId: 'ad-1',
  anuncioNome: 'Video 15s',
  formularioId: 'form-1',
  clickId: 'gcl-xyz',
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
        'campanha_id',
        'campanha_nome',
        'conjunto_id',
        'conjunto_nome',
        'anuncio_id',
        'anuncio_nome',
        'formulario_id',
        'click_id',
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
      empresa: 'Exemplo Marketing',
      campanha_id: 'camp-1',
      campanha_nome: 'Campanha de Verao',
      conjunto_id: 'adset-1',
      conjunto_nome: 'Conjunto Interesse',
      anuncio_id: 'ad-1',
      anuncio_nome: 'Video 15s',
      formulario_id: 'form-1',
      click_id: 'gcl-xyz',
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
      campanhaId: null,
      campanhaNome: null,
      conjuntoId: null,
      conjuntoNome: null,
      anuncioId: null,
      anuncioNome: null,
      formularioId: null,
      clickId: null,
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
      campanha_id: null,
      campanha_nome: null,
      conjunto_id: null,
      conjunto_nome: null,
      anuncio_id: null,
      anuncio_nome: null,
      formulario_id: null,
      click_id: null,
      extras: {},
    })
  })

  it('extras vazio passa como objeto vazio, nao nulo nem ausente', () => {
    const dados: DadosDoLead = { ...DADOS, extras: {} }
    const payload = paraPayload(dados)
    expect(payload.extras).toEqual({})
  })

  it('paraPayload emite as chaves de rastreamento em snake_case', () => {
    const payload = paraPayload({
      ...DADOS,
      campanhaId: 'camp-7',
      campanhaNome: 'Campanha de Verao',
      conjuntoId: 'adset-9',
      conjuntoNome: 'Conjunto Interesse',
      anuncioId: 'ad-1',
      anuncioNome: 'Video 15s',
      formularioId: 'form-3',
      clickId: 'gcl-abc',
    })

    expect(payload).toMatchObject({
      campanha_id: 'camp-7',
      campanha_nome: 'Campanha de Verao',
      conjunto_id: 'adset-9',
      conjunto_nome: 'Conjunto Interesse',
      anuncio_id: 'ad-1',
      anuncio_nome: 'Video 15s',
      formulario_id: 'form-3',
      click_id: 'gcl-abc',
    })
  })
})
