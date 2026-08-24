// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { ContaDaPlataforma } from '@/lib/data/plataforma'

const reemitirConviteAction = vi.fn()
vi.mock('./acoes', () => ({
  reemitirConviteAction: (...a: unknown[]) => reemitirConviteAction(...a),
}))

import { ListaContas } from './lista-contas'

beforeEach(() => reemitirConviteAction.mockReset())

// Mesmo motivo de nova-conta.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

function conta(overrides: Partial<ContaDaPlataforma> = {}): ContaDaPlataforma {
  return {
    id: 'conta-1',
    nome: 'Cliente X',
    criadoEm: new Date('2026-03-15T12:00:00Z'),
    convite: {
      id: 'convite-1',
      email: 'cliente@x.com',
      expiraEm: new Date('2026-04-01T00:00:00Z'),
      aceitoEm: null,
    },
    ...overrides,
  }
}

describe('ListaContas', () => {
  it('mostra a data de criacao da conta', () => {
    render(<ListaContas contas={[conta()]} />)
    expect(screen.getByText(/15\/03\/2026/)).toBeTruthy()
  })

  it('botao Copiar do link reemitido escreve na area de transferencia e vira Copiado', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
    reemitirConviteAction.mockResolvedValue({ ok: true, valor: 'tok456' })
    render(<ListaContas contas={[conta()]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reemitir convite' }))
    await waitFor(() => {
      expect(screen.getByText(/\/convite\/tok456$/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/convite/tok456'),
      )
      expect(screen.getByRole('button', { name: 'Copiado' })).toBeTruthy()
    })
  })
})
