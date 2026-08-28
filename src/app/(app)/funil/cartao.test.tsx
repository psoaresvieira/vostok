// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Cartao } from './cartao'
import type { LeadDoFunil } from '@/lib/domain/tipos'

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito — o
// repo importa helper de teste explicitamente em todo lugar. Sem o registro
// manual abaixo, o document do jsdom persiste entre os it() deste arquivo e,
// do segundo render() em diante, as consultas acham no velho ou estouram
// "multiple elements found".
afterEach(cleanup)

function lead(sobre: Partial<LeadDoFunil> = {}): LeadDoFunil {
  return {
    id: 'l1', nome: 'Kariny', stageId: 's1', responsavelId: 'u1', valorCents: 150000,
    entrouNaEtapaEm: new Date(), criadoEm: new Date('2026-08-19T15:00:00Z'),
    telefoneE164: '+5588999279950', etiquetas: [{ id: 't1', nome: 'Não responde' }],
    ...sobre,
  }
}

describe('Cartao', () => {
  it('nome como link para o href recebido, data de criacao, telefone, responsavel e etiqueta', () => {
    render(<Cartao lead={lead()} nomeResponsavel="Pedro Soares" href="/funil?lead=l1" />)
    expect(screen.getByRole('link', { name: 'Kariny' })).toHaveProperty('href', expect.stringContaining('/funil?lead=l1'))
    expect(screen.getByText('19/08/2026')).toBeTruthy()
    expect(screen.getByText('(88) 99927-9950')).toBeTruthy()
    expect(screen.getByText('Pedro Soares')).toBeTruthy()
    expect(screen.getByText('Não responde')).toBeTruthy()
    expect(screen.queryByText('R$ 1.500,00')).toBeNull()
  })
  it('sem telefone e sem responsavel: fallbacks', () => {
    render(<Cartao lead={lead({ telefoneE164: null })} nomeResponsavel={null} href="/x" />)
    expect(screen.getByText('sem telefone')).toBeTruthy()
    expect(screen.getByText('sem responsável')).toBeTruthy()
  })
  it('sem etiquetas: nao renderiza lista', () => {
    render(<Cartao lead={lead({ etiquetas: [] })} nomeResponsavel={null} href="/x" />)
    expect(screen.queryByRole('list')).toBeNull()
  })
  it('bolinha de parado so a partir de 72h na etapa', () => {
    const h71 = new Date(Date.now() - 71 * 3600_000)
    const h72 = new Date(Date.now() - 72 * 3600_000)
    const { unmount } = render(<Cartao lead={lead({ entrouNaEtapaEm: h71 })} nomeResponsavel={null} href="/x" />)
    expect(screen.getByLabelText(/na etapa há/i).className).toContain('bg-muted-foreground/40')
    unmount()
    render(<Cartao lead={lead({ entrouNaEtapaEm: h72 })} nomeResponsavel={null} href="/x" />)
    expect(screen.getByLabelText(/parado há/i).className).toContain('bg-destructive')
  })
})
