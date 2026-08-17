import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade, mesmo padrao de acoes-pipelines.test.ts: store mockado por
 * vi.mock de '@/lib/data/etapas' — sem Supabase de verdade.
 */

const storeMock = {
  criarEtapa: vi.fn(),
  renomearEtapa: vi.fn(),
  excluirEtapa: vi.fn(),
  reordenarEtapas: vi.fn(),
  resumoEtapas: vi.fn(),
}

const criarEtapaStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/etapas', () => ({
  criarEtapaStoreDoServidor: (...args: unknown[]) => criarEtapaStoreDoServidorMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import {
  criarEtapaAction,
  renomearEtapaAction,
  excluirEtapaAction,
  reordenarEtapasAction,
} from './acoes-etapas'
import { mensagemDeEtapa } from './erros'

function contextoFeliz() {
  criarEtapaStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { etapas: storeMock },
  })
}

describe('criarEtapaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 1 — criar passa nome, tipo e pipeline ao store', async () => {
    contextoFeliz()
    storeMock.criarEtapa.mockResolvedValue({ ok: true, valor: 'etapa-nova' })

    await criarEtapaAction('pip-1', ' Contato ', 'aberta')

    expect(criarEtapaStoreDoServidorMock).toHaveBeenCalledWith('pip-1')
    expect(storeMock.criarEtapa).toHaveBeenCalledWith('Contato', 'aberta')
  })

  it('caso 2 — nome vazio recusa sem tocar o store', async () => {
    contextoFeliz()

    const r = await criarEtapaAction('pip-1', '  ', 'aberta')

    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(criarEtapaStoreDoServidorMock).not.toHaveBeenCalled()
    expect(storeMock.criarEtapa).not.toHaveBeenCalled()
  })
})

describe('renomearEtapaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 3 — nome vazio recusa sem tocar o store', async () => {
    contextoFeliz()

    const r = await renomearEtapaAction('pip-1', 'etapa-1', '   ')

    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(criarEtapaStoreDoServidorMock).not.toHaveBeenCalled()
    expect(storeMock.renomearEtapa).not.toHaveBeenCalled()
  })
})

describe('excluirEtapaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 4 — repassa o codigo do store', async () => {
    contextoFeliz()
    storeMock.excluirEtapa.mockResolvedValue({ ok: false, erro: 'etapa_tem_leads' })

    const r = await excluirEtapaAction('pip-1', 'etapa-1')

    expect(r).toEqual({ ok: false, erro: 'etapa_tem_leads' })
  })
})

describe('reordenarEtapasAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 5 — repassa a lista intacta e na ordem', async () => {
    contextoFeliz()
    storeMock.reordenarEtapas.mockResolvedValue({ ok: true, valor: undefined })
    const ids = ['etapa-3', 'etapa-1', 'etapa-2']

    await reordenarEtapasAction('pip-1', ids)

    expect(storeMock.reordenarEtapas).toHaveBeenCalledWith(ids)
  })
})

describe('revalidatePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextoFeliz()
  })

  // As quatro actions escrevem etapa e voltam para a MESMA tela: sem
  // revalidar /funil o painel continua exibindo a lista velha ate o proximo
  // navegacao dura. Uma por uma, porque cada uma tem seu proprio caminho de
  // saida e a que esquecesse a chamada nao seria pega pelas outras.
  const acoes: [string, () => Promise<unknown>, () => void][] = [
    ['criar', () => criarEtapaAction('pip-1', 'Contato', 'aberta'),
      () => storeMock.criarEtapa.mockResolvedValue({ ok: true, valor: 'etapa-nova' })],
    ['renomear', () => renomearEtapaAction('pip-1', 'etapa-1', 'Contato'),
      () => storeMock.renomearEtapa.mockResolvedValue({ ok: true, valor: undefined })],
    ['excluir', () => excluirEtapaAction('pip-1', 'etapa-1'),
      () => storeMock.excluirEtapa.mockResolvedValue({ ok: true, valor: undefined })],
    ['reordenar', () => reordenarEtapasAction('pip-1', ['etapa-1', 'etapa-2']),
      () => storeMock.reordenarEtapas.mockResolvedValue({ ok: true, valor: undefined })],
  ]

  it.each(acoes)('caso 7 — %s revalida /funil no sucesso', async (_nome, chamar, prepararStore) => {
    prepararStore()

    const r = await chamar()

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
  })

  it('caso 8 — falha do store NAO revalida', async () => {
    // O que discrimina o caso 7: se revalidatePath fosse chamado antes do
    // `if (!r.ok)`, os quatro casos acima continuariam verdes.
    storeMock.excluirEtapa.mockResolvedValue({ ok: false, erro: 'etapa_tem_leads' })

    await excluirEtapaAction('pip-1', 'etapa-1')

    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('mensagemDeEtapa', () => {
  it('caso 6 — mapeia os codigos e faz fallback', () => {
    expect(mensagemDeEtapa('etapa_tem_leads')).toBe('Há leads nesta etapa. Mova-os antes de excluí-la.')
    expect(mensagemDeEtapa('codigo_desconhecido')).toBe('codigo_desconhecido')
  })
})
