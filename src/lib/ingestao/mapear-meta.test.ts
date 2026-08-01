import { describe, it, expect } from 'vitest'
import { mapearLeadDoMeta } from './mapear-meta'
import type { LeadDoMeta } from '@/lib/integracoes/meta'

const SEM_ORIGEM = { campanha: null, formulario: null }

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

  it('campanha e formulario do segundo argumento aparecem em campanhaOrigem/formularioOrigem', () => {
    const lead = leadCom([])
    const dados = mapearLeadDoMeta(lead, { campanha: 'Campanha de Verao', formulario: 'Formulario A' })
    expect(dados.campanhaOrigem).toBe('Campanha de Verao')
    expect(dados.formularioOrigem).toBe('Formulario A')
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
