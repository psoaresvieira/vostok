import { describe, it, expect } from 'vitest'
import { mapearLeadDoGoogle } from './mapear-google'

describe('mapearLeadDoGoogle', () => {
  it('mapeia FULL_NAME, EMAIL, PHONE_NUMBER e COMPANY_NAME para os campos certos', () => {
    const payload = {
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Ana Silva', column_name: 'Nome completo' },
        { column_id: 'EMAIL', string_value: 'ana@example.com', column_name: 'E-mail' },
        { column_id: 'PHONE_NUMBER', string_value: '+5511999998888', column_name: 'Telefone' },
        { column_id: 'COMPANY_NAME', string_value: 'Exemplo Marketing', column_name: 'Empresa' },
      ],
    }
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.nome).toBe('Ana Silva')
    expect(dados.email).toBe('ana@example.com')
    expect(dados.telefone).toBe('+5511999998888')
    expect(dados.empresa).toBe('Exemplo Marketing')
  })

  it('junta FIRST_NAME e LAST_NAME com espaco quando FULL_NAME nao vem', () => {
    const payload = {
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'Ana', column_name: 'Primeiro nome' },
        { column_id: 'LAST_NAME', string_value: 'Silva', column_name: 'Sobrenome' },
      ],
    }
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.nome).toBe('Ana Silva')
  })

  it('column_id desconhecido cai em extras usando column_name como chave', () => {
    const payload = {
      user_column_data: [
        { column_id: 'QUESTION_1', string_value: 'Entre R$5.000 e R$10.000', column_name: 'Qual o seu orcamento?' },
      ],
    }
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.extras).toEqual({ 'Qual o seu orcamento?': 'Entre R$5.000 e R$10.000' })
  })

  it('usa column_id como chave em extras quando column_name nao existe', () => {
    const payload = {
      user_column_data: [{ column_id: 'QUESTION_1', string_value: 'Sim' }],
    }
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.extras).toEqual({ QUESTION_1: 'Sim' })
  })

  it('os ids do Google viram rastreamento, e todo nome fica nulo', () => {
    const payload = {
      campaign_id: 123456789,
      adgroup_id: 222,
      creative_id: 333,
      form_id: 987654321,
      gcl_id: 'gcl-abc',
      user_column_data: [],
    }

    const dados = mapearLeadDoGoogle(payload)

    // Numero vira texto: as colunas sao text, e o mesmo id chegando ora como
    // numero ora como string criaria dois grupos na metrica.
    expect(dados.campanhaId).toBe('123456789')
    expect(dados.conjuntoId).toBe('222')
    expect(dados.anuncioId).toBe('333')
    expect(dados.formularioId).toBe('987654321')
    expect(dados.clickId).toBe('gcl-abc')
    // O Google nao manda nome nenhum, e resolver exigiria a Google Ads API
    // com developer token. Nulo e o contrato — a tela exibe o id rotulado
    // como id em vez de fingir que e nome.
    expect(dados.campanhaNome).toBeNull()
    expect(dados.conjuntoNome).toBeNull()
    expect(dados.anuncioNome).toBeNull()
  })

  it('payload sem nenhum id de rastreamento cai tudo em nulo', () => {
    const dados = mapearLeadDoGoogle({ user_column_data: [] })

    expect(dados.campanhaId).toBeNull()
    expect(dados.conjuntoId).toBeNull()
    expect(dados.anuncioId).toBeNull()
    expect(dados.formularioId).toBeNull()
    expect(dados.clickId).toBeNull()
  })

  it('user_column_data ausente nao quebra: devolve tudo nulo', () => {
    const dados = mapearLeadDoGoogle({})
    expect(dados.nome).toBeNull()
    expect(dados.telefone).toBeNull()
    expect(dados.email).toBeNull()
    expect(dados.empresa).toBeNull()
    expect(dados.extras).toEqual({})
  })

  it('user_column_data nao-array nao quebra: devolve tudo nulo', () => {
    expect(() => mapearLeadDoGoogle({ user_column_data: 'nao e um array' })).not.toThrow()
    const dados = mapearLeadDoGoogle({ user_column_data: 'nao e um array' })
    expect(dados.nome).toBeNull()
    expect(dados.extras).toEqual({})
  })

  it('column desconhecida sem string_value nao inventa string vazia em extras: a chave fica ausente', () => {
    const payload = {
      user_column_data: [{ column_id: 'QUESTION_1', column_name: 'Pergunta sem resposta' }],
    }
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.extras).not.toHaveProperty('Pergunta sem resposta')
  })

  it('duas colunas sem column_id e sem column_name nao colidem em "campo_desconhecido": ambas sao ignoradas sem lancar', () => {
    const payload = {
      user_column_data: [
        { string_value: 'Primeira resposta' },
        { string_value: 'Segunda resposta' },
      ],
    }
    expect(() => mapearLeadDoGoogle(payload)).not.toThrow()
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.extras).not.toHaveProperty('campo_desconhecido')
    expect(dados.extras).toEqual({})
  })

  it('telefone e email passam pelas mesmas normalizacoes do Meta', () => {
    const payload = {
      user_column_data: [
        { column_id: 'PHONE_NUMBER', string_value: '(83) 99999-1234', column_name: 'Telefone' },
        { column_id: 'EMAIL', string_value: 'ANA@EXAMPLE.COM', column_name: 'E-mail' },
      ],
    }
    const dados = mapearLeadDoGoogle(payload)
    expect(dados.telefoneE164).toBe('+5583999991234')
    expect(dados.telefone).toBe('(83) 99999-1234')
    expect(dados.emailNorm).toBe('ana@example.com')
    expect(dados.email).toBe('ANA@EXAMPLE.COM')
  })
})
