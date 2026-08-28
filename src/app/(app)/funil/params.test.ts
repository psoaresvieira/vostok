import { describe, expect, it } from 'vitest'
import { hrefDoFunil } from './params'

describe('hrefDoFunil', () => {
  it('seta e remove chaves preservando as demais', () => {
    expect(hrefDoFunil('busca=ana&pipeline=p2', { lead: 'l1' })).toBe('/funil?busca=ana&pipeline=p2&lead=l1')
    expect(hrefDoFunil('busca=ana&lead=l1', { lead: null })).toBe('/funil?busca=ana')
    expect(hrefDoFunil('lead=l1', { lead: null })).toBe('/funil')
    expect(hrefDoFunil('', { pipeline: 'p2', lead: 'l1' })).toBe('/funil?pipeline=p2&lead=l1')
  })
})
