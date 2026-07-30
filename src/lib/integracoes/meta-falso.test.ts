import { describe, it, expect } from 'vitest'
import { MetaGraphFalso } from './meta-falso'

describe('MetaGraphFalso', () => {
  it('troca code por token', async () => {
    const g = new MetaGraphFalso()
    const r = await g.trocarCodePorTokenLongo('code-x', 'http://localhost:3000/retorno')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toContain('token-longo')
  })

  it('lista as paginas semeadas', async () => {
    const g = new MetaGraphFalso([{ id: '1', nome: 'Page Um', token: 't1' }])
    const r = await g.listarPaginas('token-longo')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual([{ id: '1', nome: 'Page Um', token: 't1' }])
  })

  it('registra a inscricao em leadgen', async () => {
    const g = new MetaGraphFalso()
    await g.assinarLeadgen('42', 't')
    expect(g.assinadas).toEqual(['42'])
    expect(g.desassinadas).toEqual([])
  })

  it('registra a desinscricao', async () => {
    const g = new MetaGraphFalso()
    await g.desassinarLeadgen('42', 't')
    expect(g.desassinadas).toEqual(['42'])
  })

  it('falha no metodo configurado e nao registra o efeito', async () => {
    const g = new MetaGraphFalso()
    g.falharEm = 'assinarLeadgen'
    const r = await g.assinarLeadgen('42', 't')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
    expect(g.assinadas).toEqual([])
  })

  it('reiniciar zera o estado gravado', async () => {
    const g = new MetaGraphFalso()
    await g.assinarLeadgen('1', 't')
    g.reiniciar()
    expect(g.assinadas).toEqual([])
  })
})
