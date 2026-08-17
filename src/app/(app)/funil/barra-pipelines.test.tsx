// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BarraPipelines } from './barra-pipelines'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { Pipeline } from '@/lib/domain/tipos'

// Mesmo motivo de disparar.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const empurrados: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (url: string) => empurrados.push(url),
    replace: () => {},
    refresh: () => {},
  }),
}))

/** Stub de acao que so registra as chamadas recebidas — arranjo de
 * disparar.test.tsx / editor.test.tsx. */
function stubRegistrando<A extends unknown[], T>(
  resultado: Resultado<T>,
): { fn: (...args: A) => Promise<Resultado<T>>; chamadas: A[] } {
  const chamadas: A[] = []
  const fn = async (...args: A): Promise<Resultado<T>> => {
    chamadas.push(args)
    return resultado
  }
  return { fn, chamadas }
}

const PADRAO: Pipeline = { id: 'pipeline-padrao', nome: 'Padrão', isDefault: true }
const B2B: Pipeline = { id: 'pipeline-b2b', nome: 'Vendas B2B', isDefault: false }
const IMOVEIS: Pipeline = { id: 'pipeline-imoveis', nome: 'Imóveis', isDefault: false }

const TRES_PIPELINES = [PADRAO, B2B, IMOVEIS]

describe('BarraPipelines', () => {
  it('caso 1 — padrão primeiro e ativa com aria-current', () => {
    render(
      <BarraPipelines pipelines={TRES_PIPELINES} pipelineAtivaId={B2B.id} queryAtual="" />,
    )

    const nav = screen.getByRole('navigation', { name: 'Pipelines' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Padrão', 'Vendas B2B', 'Imóveis'])

    expect(links[0].getAttribute('aria-current')).toBeNull()
    expect(links[1].getAttribute('aria-current')).toBe('page')
    expect(links[2].getAttribute('aria-current')).toBeNull()
  })

  it('caso 2 — links preservam filtros', () => {
    render(
      <BarraPipelines
        pipelines={TRES_PIPELINES}
        pipelineAtivaId={PADRAO.id}
        queryAtual="origem=meta&pipeline=X"
      />,
    )

    const linkPadrao = screen.getByRole('link', { name: 'Padrão' })
    expect(linkPadrao.getAttribute('href')).toBe('/funil?origem=meta')

    const linkImoveis = screen.getByRole('link', { name: 'Imóveis' })
    expect(linkImoveis.getAttribute('href')).toBe('/funil?origem=meta&pipeline=pipeline-imoveis')
  })

  it('caso 3 — renomear chama a action com id e nome novos', async () => {
    const { fn: renomear, chamadas } = stubRegistrando<[string, string], void>(ok(undefined))

    render(
      <BarraPipelines
        pipelines={TRES_PIPELINES}
        pipelineAtivaId={PADRAO.id}
        queryAtual=""
        renomear={renomear}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Opções de Vendas B2B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }))

    const input = screen.getByLabelText('Nome da pipeline')
    fireEvent.change(input, { target: { value: 'Vendas Corporativas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(chamadas).toHaveLength(1))
    expect(chamadas[0]).toEqual([B2B.id, 'Vendas Corporativas'])
  })

  it('caso 4 — excluir com erro mostra a frase mapeada', async () => {
    const { fn: excluir } = stubRegistrando<[string], void>(falha('pipeline_com_leads'))

    render(
      <BarraPipelines
        pipelines={TRES_PIPELINES}
        pipelineAtivaId={PADRAO.id}
        queryAtual=""
        excluir={excluir}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Opções de Vendas B2B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() =>
      expect(
        screen.getByText('Essa pipeline ainda tem leads. Mova ou exclua os leads antes.'),
      ).toBeTruthy(),
    )
    expect(screen.queryByText('pipeline_com_leads')).toBeNull()
  })
})
