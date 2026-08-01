import { describe, it, expect } from 'vitest'
import { mapearLeadDoMeta } from './mapear-meta'
import type { LeadDoMeta } from '@/lib/integracoes/meta'

const SEM_ORIGEM = { arvore: null, anuncioId: null, formularioId: null }

/** Constroi um LeadDoMeta so com os campos passados, poupando repeticao de
 * adId/formId/criadoEm (irrelevantes para o mapeamento de campos). */
function leadCom(campos: LeadDoMeta['campos']): LeadDoMeta {
  return { campos, adId: 'ad-1', formId: 'form-1', criadoEm: '2026-01-01T00:00:00+0000' }
}

describe('mapearLeadDoMeta', () => {
  it('mapeia full_name, email, phone_number e company_name para os campos certos', () => {
    const lead = leadCom([
      { name: 'full_name', values: ['Ana Silva'] },
      { name: 'email', values: ['ana@example.com'] },
      { name: 'phone_number', values: ['+5511999998888'] },
      { name: 'company_name', values: ['SE7E Marketing'] },
    ])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.nome).toBe('Ana Silva')
    expect(dados.email).toBe('ana@example.com')
    expect(dados.telefone).toBe('+5511999998888')
    expect(dados.empresa).toBe('SE7E Marketing')
  })

  it('junta first_name e last_name com espaco quando full_name nao vem', () => {
    const lead = leadCom([
      { name: 'first_name', values: ['Ana'] },
      { name: 'last_name', values: ['Silva'] },
    ])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.nome).toBe('Ana Silva')
  })

  it('normaliza telefone brasileiro sem DDI para E.164 e preserva o valor cru', () => {
    const lead = leadCom([{ name: 'phone_number', values: ['(83) 99999-1234'] }])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.telefoneE164).toBe('+5583999991234')
    expect(dados.telefone).toBe('(83) 99999-1234')
  })

  it('telefone impossivel de normalizar fica com telefoneE164 nulo sem perder o cru', () => {
    const lead = leadCom([{ name: 'phone_number', values: ['123'] }])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.telefoneE164).toBeNull()
    expect(dados.telefone).toBe('123')
  })

  it('normaliza email em maiusculas para minusculo e preserva o valor cru', () => {
    const lead = leadCom([{ name: 'email', values: ['ANA@EXAMPLE.COM'] }])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.emailNorm).toBe('ana@example.com')
    expect(dados.email).toBe('ANA@EXAMPLE.COM')
  })

  it('email malformado fica com emailNorm nulo sem perder o cru', () => {
    const lead = leadCom([{ name: 'email', values: ['sem-arroba'] }])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.emailNorm).toBeNull()
    expect(dados.email).toBe('sem-arroba')
  })

  it('campo desconhecido cai em extras com o nome original como chave', () => {
    const lead = leadCom([{ name: 'qual_o_seu_orcamento', values: ['Entre R$5.000 e R$10.000'] }])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.extras).toEqual({ qual_o_seu_orcamento: 'Entre R$5.000 e R$10.000' })
  })

  it('values vazio ou ausente vira nulo, nunca string vazia inventada', () => {
    const lead = leadCom([
      { name: 'phone_number', values: [] },
      { name: 'email', values: [] },
    ])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.telefone).toBeNull()
    expect(dados.email).toBeNull()
  })

  it('formularioOrigem reflete o formularioId do segundo argumento; campanhaOrigem fica sempre nulo', () => {
    // campanhaOrigem e' o campo ambiguo que este plano esta substituindo — o
    // Meta nunca mais o preenche, so os pares id/nome abaixo.
    const lead = leadCom([])
    const dados = mapearLeadDoMeta(lead, { arvore: null, anuncioId: null, formularioId: 'form-A' })
    expect(dados.formularioOrigem).toBe('form-A')
    expect(dados.campanhaOrigem).toBeNull()
  })

  it('a arvore do anuncio vira os seis campos de rastreamento', () => {
    const lead = leadCom([])
    const dados = mapearLeadDoMeta(lead, {
      arvore: {
        anuncioId: 'ad-1',
        anuncioNome: 'Video 15s',
        conjuntoId: 'adset-9',
        conjuntoNome: 'Conjunto Interesse',
        campanhaId: 'camp-7',
        campanhaNome: 'Campanha de Verao',
      },
      formularioId: 'form-3',
    })

    expect(dados.campanhaId).toBe('camp-7')
    expect(dados.campanhaNome).toBe('Campanha de Verao')
    expect(dados.conjuntoId).toBe('adset-9')
    expect(dados.conjuntoNome).toBe('Conjunto Interesse')
    expect(dados.anuncioId).toBe('ad-1')
    expect(dados.anuncioNome).toBe('Video 15s')
    expect(dados.formularioId).toBe('form-3')
    // Lead do Meta nunca tem click id: o gcl_id e conceito do Google Ads.
    expect(dados.clickId).toBeNull()
  })

  it('sem arvore, so o anuncio sobrevive e nada e inventado', () => {
    // E o estado depois de arvoreDoAnuncio falhar: o anuncioId veio de
    // buscarLead, que deu certo. Os outros cinco tem que ficar nulos, e nao
    // receber o adId cru — foi exatamente essa confusao (ad_id ocupando a
    // coluna de nome de campanha) que este plano existe para desfazer.
    const lead = leadCom([])
    const dados = mapearLeadDoMeta(lead, {
      arvore: null,
      anuncioId: 'ad-1',
      formularioId: 'form-3',
    })

    expect(dados.anuncioId).toBe('ad-1')
    expect(dados.anuncioNome).toBeNull()
    expect(dados.conjuntoId).toBeNull()
    expect(dados.conjuntoNome).toBeNull()
    expect(dados.campanhaId).toBeNull()
    expect(dados.campanhaNome).toBeNull()
  })

  it('campo desconhecido sem valores nao inventa string vazia em extras: a chave fica ausente', () => {
    const lead = leadCom([{ name: 'campo_sem_resposta', values: [] }])
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.extras).not.toHaveProperty('campo_sem_resposta')
  })

  it('nenhum campo reconhecido: tudo nulo, extras vazio, e nao lanca', () => {
    const lead = leadCom([])
    expect(() => mapearLeadDoMeta(lead, SEM_ORIGEM)).not.toThrow()
    const dados = mapearLeadDoMeta(lead, SEM_ORIGEM)
    expect(dados.nome).toBeNull()
    expect(dados.telefone).toBeNull()
    expect(dados.telefoneE164).toBeNull()
    expect(dados.email).toBeNull()
    expect(dados.emailNorm).toBeNull()
    expect(dados.empresa).toBeNull()
    expect(dados.extras).toEqual({})
  })
})
