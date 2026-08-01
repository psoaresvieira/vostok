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
    await g.listarPaginas('t')
    g.reiniciar()
    expect(g.assinadas).toEqual([])
    // metaFalso() e singleton de processo: uma entrada em listadas que
    // sobrevivesse ao reiniciar() vazaria de um teste (ou arquivo) para o
    // seguinte, e a Task 7 depende de listadas comecar vazio a cada teste.
    expect(g.listadas).toEqual([])
  })

  it('registra o token recebido em listadas quando a listagem da certo', async () => {
    const g = new MetaGraphFalso()
    const r = await g.listarPaginas('token-x')
    if (!r.ok) throw new Error(r.erro)
    expect(g.listadas).toEqual(['token-x'])
  })

  it('nao registra em listadas quando listarPaginas esta configurado para falhar', async () => {
    const g = new MetaGraphFalso()
    g.falharEm = 'listarPaginas'
    const r = await g.listarPaginas('token-x')
    expect(r.ok).toBe(false)
    expect(g.listadas).toEqual([])
  })

  it('falharEm so aceita nomes reais de metodo — typo vira erro de compilacao', () => {
    // npm run typecheck passando aqui nao prova so que a uniao ACEITA os
    // literais validos ja usados nos testes acima — prova que ela RECUSA um
    // typo. @ts-expect-error exige que a linha seguinte falhe o typecheck;
    // se `falharEm` voltar a ser `string` (regressao), a linha passaria a
    // compilar e o proprio @ts-expect-error, agora sem erro para suprimir,
    // vira erro de compilacao no lugar.
    const g = new MetaGraphFalso()
    // @ts-expect-error typo no nome do metodo tem que ser erro de compilacao
    g.falharEm = 'assinarLeadGen'
  })

  it('a pagina devolvida nao compartilha objeto com a constante padrao', async () => {
    // metaFalso() e singleton de processo: se listarPaginas devolvesse os
    // MESMOS objetos de PAGINAS_PADRAO (so o array seria novo), mutar um
    // campo aqui corromperia a constante para todo teste seguinte do
    // processo, inclusive de outros arquivos.
    const g = new MetaGraphFalso()
    const r1 = await g.listarPaginas('t')
    if (!r1.ok) throw new Error(r1.erro)
    r1.valor[0].nome = 'Mutada'

    const r2 = await g.listarPaginas('t')
    if (!r2.ok) throw new Error(r2.erro)
    expect(r2.valor[0].nome).not.toBe('Mutada')
  })

  it('buscarLead devolve o lead padrao e registra o id em buscados', async () => {
    const g = new MetaGraphFalso()
    const r = await g.buscarLead('leadgen-1', 'token-da-pagina-1')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.campos.some((c) => c.name === 'full_name')).toBe(true)
    expect(r.valor.campos.some((c) => c.name === 'email')).toBe(true)
    expect(r.valor.campos.some((c) => c.name === 'phone_number')).toBe(true)
    expect(g.buscados).toEqual(['leadgen-1'])
  })

  it('buscarLead com falharEm devolve meta_indisponivel e nao registra em buscados', async () => {
    const g = new MetaGraphFalso()
    g.falharEm = 'buscarLead'
    const r = await g.buscarLead('leadgen-1', 'token-da-pagina-1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
    // Recusar depois de ja ter registrado o id nao prova nada: a Task 7
    // precisa poder afirmar que uma acao recusada nao chegou a buscar.
    expect(g.buscados).toEqual([])
  })

  it('posseDaPagina com o token correto daquela Page devolve ok', async () => {
    const g = new MetaGraphFalso()
    const r = await g.posseDaPagina('100000000000001', 'token-da-pagina-1')
    expect(r.ok).toBe(true)
    expect(g.posseConferida).toEqual(['100000000000001'])
  })

  it('posseDaPagina com o token de outra Page devolve posse_nao_comprovada', async () => {
    // Este e o caso que a Task 10 usa para provar que o squat da Page esta
    // fechado — se posseDaPagina nao discriminar entre tokens de Pages
    // diferentes, o fechamento do buraco de squatting e decorativo.
    const g = new MetaGraphFalso()
    const r = await g.posseDaPagina('100000000000001', 'token-da-pagina-2')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('posse_nao_comprovada')
  })

  it('arvoreDoAnuncio e deterministica no proprio adId', async () => {
    const g = new MetaGraphFalso()

    const r1 = await g.arvoreDoAnuncio('ad-1', 't')
    const r2 = await g.arvoreDoAnuncio('ad-1', 't')

    expect(r1).toEqual(r2)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.valor.anuncioId).toBe('ad-1')
    expect(r1.valor.campanhaNome).toBe('Campanha ad-1')
  })

  it('arvoreDoAnuncio respeita o barrado', async () => {
    const g = new MetaGraphFalso()
    g.falharEm = 'arvoreDoAnuncio'

    const r = await g.arvoreDoAnuncio('ad-1', 't')

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro).toBe('meta_indisponivel')
  })
})
