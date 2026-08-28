// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Abas } from './abas'

// Mesmo motivo de cartao.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const ABAS = [
  { id: 'principal', rotulo: 'Principal', conteudo: <p>dados do lead</p> },
  { id: 'tarefas', rotulo: 'Tarefas', conteudo: <p>lista de tarefas</p> },
  { id: 'historico', rotulo: 'Histórico', conteudo: <p>linha do tempo</p> },
]

describe('Abas', () => {
  it('a tablist tem nome acessivel', () => {
    render(<Abas abas={ABAS} />)
    expect(screen.getByRole('tablist', { name: 'Seções do lead' })).toBeTruthy()
  })

  it('marca a primeira aba como selecionada e mostra so o painel dela', () => {
    render(<Abas abas={ABAS} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])

    // Um unico tabpanel no DOM: o conteudo das outras abas nem e' montado, para
    // o painel de scripts (que fala com a rede) nao rodar escondido.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByText('dados do lead')).toBeTruthy()
    expect(screen.queryByText('linha do tempo')).toBeNull()
  })

  it('o tabpanel visivel e rotulado pela aba selecionada', () => {
    render(<Abas abas={ABAS} />)

    const selecionada = screen.getByRole('tab', { name: 'Principal' })
    const painel = screen.getByRole('tabpanel')
    expect(painel.getAttribute('aria-labelledby')).toBe(selecionada.getAttribute('id'))
    expect(selecionada.getAttribute('aria-controls')).toBe(painel.getAttribute('id'))
  })

  it('clique troca o painel visivel', () => {
    render(<Abas abas={ABAS} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }))

    expect(screen.getByText('linha do tempo')).toBeTruthy()
    expect(screen.queryByText('dados do lead')).toBeNull()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Histórico' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  it('ArrowRight e ArrowLeft movem selecao E foco, circulando nas pontas', () => {
    render(<Abas abas={ABAS} />)

    const [primeira, segunda, terceira] = screen.getAllByRole('tab')
    primeira.focus()

    fireEvent.keyDown(primeira, { key: 'ArrowRight' })
    expect(screen.getByText('lista de tarefas')).toBeTruthy()
    expect(document.activeElement).toBe(segunda)

    fireEvent.keyDown(segunda, { key: 'ArrowLeft' })
    expect(screen.getByText('dados do lead')).toBeTruthy()
    expect(document.activeElement).toBe(primeira)

    // Da primeira para tras, circula para a ultima.
    fireEvent.keyDown(primeira, { key: 'ArrowLeft' })
    expect(screen.getByText('linha do tempo')).toBeTruthy()
    expect(document.activeElement).toBe(terceira)

    // E da ultima para frente, volta para a primeira.
    fireEvent.keyDown(terceira, { key: 'ArrowRight' })
    expect(screen.getByText('dados do lead')).toBeTruthy()
    expect(document.activeElement).toBe(primeira)
  })

  it('roving tabindex: so a aba selecionada e alcancavel por Tab', () => {
    render(<Abas abas={ABAS} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])

    fireEvent.click(screen.getByRole('tab', { name: 'Tarefas' }))
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
    ])
  })
})
