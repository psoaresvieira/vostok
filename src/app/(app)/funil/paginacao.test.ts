import { describe, it, expect } from 'vitest'
import { filtroDoFunil } from './paginacao'

/**
 * `filtroDoFunil` e' a unica porta por onde os filtros da URL viram consulta —
 * tanto no render da pagina quanto na Server Action do "carregar mais". Como a
 * action recebe os mesmos campos por REDE, o que ela aceita e o que ela
 * descarta e' contrato, nao detalhe.
 */
describe('filtroDoFunil', () => {
  it('caso 1 — sem filtro nenhum, tudo neutro', () => {
    const f = filtroDoFunil('pipe-1', {}, 50)
    expect(f).toEqual({
      pipelineId: 'pipe-1',
      limite: 50,
      etapaId: null,
      offset: 0,
      responsavelId: null,
      origem: null,
      desde: null,
      busca: null,
    })
  })

  it('caso 2 — origem fora do catalogo e DESCARTADA, nao propagada', () => {
    // Um `?origem=` colado de uma URL velha (ou forjado) nao pode virar
    // `.eq('origem', 'xyz')`: seria um filtro que nunca casa, e a tela
    // apareceria vazia sem explicacao.
    expect(filtroDoFunil('p', { origem: 'xyz' }, 50).origem).toBeNull()
    expect(filtroDoFunil('p', { origem: 'meta' }, 50).origem).toBe('meta')
  })

  it('caso 3 — dias fora dos periodos da barra e ignorado', () => {
    expect(filtroDoFunil('p', { dias: '99999' }, 50).desde).toBeNull()
    expect(filtroDoFunil('p', { dias: 'abc' }, 50).desde).toBeNull()
    expect(filtroDoFunil('p', { dias: '30' }, 50).desde).toBeInstanceOf(Date)
  })

  it('caso 4 — busca so de espacos vale como busca ausente', () => {
    expect(filtroDoFunil('p', { busca: '   ' }, 50).busca).toBeNull()
    expect(filtroDoFunil('p', { busca: '  maria ' }, 50).busca).toBe('maria')
  })

  it('caso 5 — etapa e offset entram so quando pedidos (o "carregar mais")', () => {
    const f = filtroDoFunil('p', {}, 50, { etapaId: 'etapa-3', offset: 100 })
    expect(f.etapaId).toBe('etapa-3')
    expect(f.offset).toBe(100)
  })
})
