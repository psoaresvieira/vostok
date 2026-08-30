// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Modal } from './modal'

afterEach(cleanup)

function gatilhoFocado() {
  const gatilho = document.createElement('button')
  gatilho.textContent = 'gatilho'
  document.body.appendChild(gatilho)
  gatilho.focus()
  return gatilho
}

describe('Modal — foco', () => {
  it('ao abrir, o foco entra no primeiro campo do dialogo', () => {
    gatilhoFocado()
    render(
      <Modal titulo="Renomear">
        <input placeholder="nome" />
        <button type="button">Salvar</button>
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByPlaceholderText('nome'))
  })

  it('um filho com autoFocus ganha: o Modal nao rouba o foco dele', () => {
    gatilhoFocado()
    render(
      <Modal titulo="Excluir">
        <button type="button">Excluir</button>
        <button type="button" autoFocus>
          Cancelar
        </button>
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
  })

  it('sem nada focavel dentro, o proprio dialogo recebe o foco', () => {
    gatilhoFocado()
    render(
      <Modal titulo="Aviso">
        <p>so texto</p>
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Aviso' }))
  })

  it('ao fechar, o foco volta para o elemento que o tinha antes de abrir', () => {
    const gatilho = gatilhoFocado()
    const { unmount } = render(
      <Modal titulo="Renomear" aoFechar={() => {}}>
        <input placeholder="nome" />
      </Modal>,
    )
    expect(document.activeElement).not.toBe(gatilho)

    unmount()
    expect(document.activeElement).toBe(gatilho)
    gatilho.remove()
  })

  it('Escape continua chamando aoFechar', () => {
    const aoFechar = vi.fn()
    render(
      <Modal titulo="Renomear" aoFechar={aoFechar}>
        <input placeholder="nome" />
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })
})
