import { describe, expect, it } from 'vitest'
import { ok, falha } from '@/lib/domain/resultado'
import { MetaGraphFalso } from './meta-falso'
import { conectarPaginaComoOperador, type GravarFonte } from './conectar-pagina-operador'

const PAGE = '100000000000001'
const gravaOk: GravarFonte = async () => ok('source-1')

function entrada(graph: MetaGraphFalso, gravar: GravarFonte, reivindicar = false) {
  return { graph, gravar, pageId: PAGE, tokenDoUsuario: 'token-system-user', reivindicar }
}

describe('conectarPaginaComoOperador', () => {
  it('lista com o token recebido, prova posse, assina e grava, nessa ordem', async () => {
    const graph = new MetaGraphFalso()
    const recebidas: string[] = []
    const gravar: GravarFonte = async (p) => {
      // Se assinar viesse depois de gravar, `assinadas` estaria vazio aqui.
      recebidas.push(`${p.id}|${p.token}|assinadas=${graph.assinadas.length}`)
      return ok('source-1')
    }
    const r = await conectarPaginaComoOperador(entrada(graph, gravar))
    expect(r).toEqual(ok('source-1'))
    expect(graph.listadas).toEqual(['token-system-user'])
    expect(graph.posseConferida).toEqual([PAGE])
    expect(graph.assinadas).toEqual([PAGE])
    // Token da Page vem da listagem, nunca do chamador.
    expect(recebidas).toEqual([`${PAGE}|token-da-pagina-1|assinadas=1`])
  })

  it('Page ausente da listagem: pagina_nao_encontrada, sem tocar posse nem assinar', async () => {
    const graph = new MetaGraphFalso([])
    const r = await conectarPaginaComoOperador(entrada(graph, gravaOk))
    expect(r).toEqual(falha('pagina_nao_encontrada'))
    expect(graph.posseConferida).toEqual([])
    expect(graph.assinadas).toEqual([])
  })

  it('posse recusada: repassa o erro e nao assina', async () => {
    const graph = new MetaGraphFalso()
    graph.falharEm = 'posseDaPagina'
    const r = await conectarPaginaComoOperador(entrada(graph, gravaOk))
    expect(r).toEqual(falha('meta_indisponivel'))
    expect(graph.assinadas).toEqual([])
  })

  it('gravar falha numa conexao: compensa desassinando', async () => {
    const graph = new MetaGraphFalso()
    const r = await conectarPaginaComoOperador(entrada(graph, async () => falha('sem_permissao')))
    expect(r).toEqual(falha('sem_permissao'))
    expect(graph.desassinadas).toEqual([PAGE])
  })

  it('gravar falha com page_ja_conectada: NAO desassina (a inscricao e do outro tenant)', async () => {
    const graph = new MetaGraphFalso()
    const r = await conectarPaginaComoOperador(entrada(graph, async () => falha('page_ja_conectada')))
    expect(r).toEqual(falha('page_ja_conectada'))
    expect(graph.desassinadas).toEqual([])
  })

  it('gravar falha numa reivindicacao: NAO desassina (a Page ja estava inscrita)', async () => {
    const graph = new MetaGraphFalso()
    const r = await conectarPaginaComoOperador(entrada(graph, async () => falha('sem_permissao'), true))
    expect(r).toEqual(falha('sem_permissao'))
    expect(graph.desassinadas).toEqual([])
  })
})
