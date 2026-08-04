import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade, na forma de config/acoes-whatsapp.test.ts: store mockado por
 * vi.mock de '@/lib/data/scripts', para provar validacao, pre-check de papel
 * e normalizacao de erro de construcao sem tocar Supabase nenhum.
 */

const scriptsStoreMock = {
  listar: vi.fn(),
  buscar: vi.fn(),
  paraEtapa: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  excluir: vi.fn(),
  tagsDaConta: vi.fn(),
}

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const criarScriptStoreDoServidorMock = vi.fn()

vi.mock('@/lib/data/scripts', () => ({
  criarScriptStoreDoServidor: (...args: unknown[]) => criarScriptStoreDoServidorMock(...args),
}))

import { criarScript, atualizarScript, excluirScript } from './acoes'

function contextoOk(papel: 'admin' | 'gestor' | 'vendedor') {
  return { ok: true, valor: { scripts: scriptsStoreMock, papel } }
}

const DADOS_VALIDOS = { titulo: 'Abertura', conteudo: 'Ola, tudo bem?', stageId: null, tags: [] }

describe('scripts/acoes', () => {
  beforeEach(() => {
    criarScriptStoreDoServidorMock.mockReset()
    scriptsStoreMock.criar.mockReset()
    scriptsStoreMock.atualizar.mockReset()
    scriptsStoreMock.excluir.mockReset()
  })

  describe('pre-check de papel: vendedor nunca alcanca o store', () => {
    it('criarScript: vendedor recebe sem_permissao e criar nunca e chamado', async () => {
      criarScriptStoreDoServidorMock.mockResolvedValueOnce(contextoOk('vendedor'))

      const r = await criarScript(DADOS_VALIDOS)

      expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
      expect(scriptsStoreMock.criar).not.toHaveBeenCalled()
    })

    it('atualizarScript: vendedor recebe sem_permissao e atualizar nunca e chamado', async () => {
      criarScriptStoreDoServidorMock.mockResolvedValueOnce(contextoOk('vendedor'))

      const r = await atualizarScript('script-1', DADOS_VALIDOS)

      expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
      expect(scriptsStoreMock.atualizar).not.toHaveBeenCalled()
    })

    it('excluirScript: vendedor recebe sem_permissao e excluir nunca e chamado', async () => {
      criarScriptStoreDoServidorMock.mockResolvedValueOnce(contextoOk('vendedor'))

      const r = await excluirScript('script-1')

      expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
      expect(scriptsStoreMock.excluir).not.toHaveBeenCalled()
    })
  })

  describe('validacao roda antes de qualquer IO', () => {
    it('titulo so com espacos: titulo_vazio e a fabrica do store nunca e chamada', async () => {
      const r = await criarScript({ ...DADOS_VALIDOS, titulo: '  ' })

      expect(r).toEqual({ ok: false, erro: 'titulo_vazio' })
      expect(criarScriptStoreDoServidorMock).not.toHaveBeenCalled()
    })

    it('titulo valido mas conteudo so com espacos: conteudo_vazio', async () => {
      const r = await criarScript({ ...DADOS_VALIDOS, conteudo: ' ' })

      expect(r).toEqual({ ok: false, erro: 'conteudo_vazio' })
      expect(criarScriptStoreDoServidorMock).not.toHaveBeenCalled()
    })

    it('11 tags depois de normalizadas: tags_demais', async () => {
      const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`)

      const r = await criarScript({ ...DADOS_VALIDOS, tags })

      expect(r).toEqual({ ok: false, erro: 'tags_demais' })
      expect(criarScriptStoreDoServidorMock).not.toHaveBeenCalled()
    })
  })

  describe('normalizacao do erro de construcao do store (Finding 1)', () => {
    it('mensagem crua do Postgres de resolverContaAtiva vira erro_ao_salvar_script, nunca o texto cru', async () => {
      criarScriptStoreDoServidorMock.mockResolvedValueOnce({
        ok: false,
        erro: 'permission denied for table memberships',
      })

      const r = await criarScript(DADOS_VALIDOS)

      expect(r).toEqual({ ok: false, erro: 'erro_ao_salvar_script' })
    })

    it('codigo conhecido sem_sessao atravessa sem alteracao', async () => {
      criarScriptStoreDoServidorMock.mockResolvedValueOnce({ ok: false, erro: 'sem_sessao' })

      const r = await criarScript(DADOS_VALIDOS)

      expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
    })
  })
})
