// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Drawer } from './drawer'

// Mesmo motivo de cartao.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

describe('Drawer', () => {
  it('renderiza dialogo acessivel com titulo ligado por aria-labelledby', async () => {
    render(
      <Drawer titulo="Kariny" tituloId="titulo-drawer" aoFechar={() => {}}>
        <p>conteudo</p>
      </Drawer>,
    )
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
    expect(dialogo.getAttribute('aria-labelledby')).toBe('titulo-drawer')
  })

  it('com cabecalho proprio, NAO duplica o titulo: o id fica so no cabecalho', async () => {
    render(
      <Drawer
        titulo="Kariny"
        tituloId="titulo-drawer"
        aoFechar={() => {}}
        cabecalho={<h2 id="titulo-drawer">Kariny</h2>}
      >
        <p>conteudo</p>
      </Drawer>,
    )
    const dialogo = await screen.findByRole('dialog')
    // Um unico elemento com esse id (dois seriam HTML invalido) e um unico
    // cabecalho com esse nome.
    expect(document.querySelectorAll('#titulo-drawer')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: 'Kariny' })).toHaveLength(1)
    expect(dialogo.getAttribute('aria-labelledby')).toBe('titulo-drawer')
  })

  it('foca o botao Fechar apos montar', async () => {
    render(
      <Drawer titulo="Kariny" tituloId="titulo-drawer" aoFechar={() => {}}>
        <p>conteudo</p>
      </Drawer>,
    )
    const botaoFechar = await screen.findByRole('button', { name: 'Fechar' })
    expect(document.activeElement).toBe(botaoFechar)
  })

  it('Escape chama aoFechar', async () => {
    const aoFechar = vi.fn()
    render(
      <Drawer titulo="Kariny" tituloId="titulo-drawer" aoFechar={aoFechar}>
        <p>conteudo</p>
      </Drawer>,
    )
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('clique no backdrop chama aoFechar, clique dentro do painel nao chama', async () => {
    const aoFechar = vi.fn()
    render(
      <Drawer titulo="Kariny" tituloId="titulo-drawer" aoFechar={aoFechar}>
        <p>conteudo do painel</p>
      </Drawer>,
    )
    const dialogo = await screen.findByRole('dialog')

    // Clique num elemento DENTRO do painel nao deve fechar.
    fireEvent.click(screen.getByText('conteudo do painel'))
    expect(aoFechar).not.toHaveBeenCalled()

    // O backdrop e' o irmao anterior do painel no wrapper do portal —
    // renderizado antes dele, sem depender de nenhuma classe especifica.
    const backdrop = dialogo.parentElement!.firstElementChild!
    expect(backdrop).not.toBe(dialogo)
    fireEvent.click(backdrop)
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('ao desmontar, devolve o foco ao elemento que estava focado antes de montar', async () => {
    render(<button type="button">botao externo</button>)
    const botao = screen.getByRole('button', { name: 'botao externo' })
    botao.focus()
    expect(document.activeElement).toBe(botao)

    const { unmount } = render(
      <Drawer titulo="Kariny" tituloId="titulo-drawer" aoFechar={() => {}}>
        <p>conteudo</p>
      </Drawer>,
    )
    await screen.findByRole('dialog')
    unmount()
    expect(document.activeElement).toBe(botao)
  })
})
