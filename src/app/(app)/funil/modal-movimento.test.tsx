// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Etapa } from '@/lib/domain/tipos'
import { ModalMovimento, type PedidoMovimento } from './modal-movimento'

afterEach(cleanup)

function etapa(tipo: Etapa['tipo']): Etapa {
  return { id: `e-${tipo}`, pipelineId: 'pipe-1', nome: tipo === 'perdido' ? 'Perdido' : 'Proposta', ordem: 2, tipo, slaHoras: null }
}

function pedido(tipo: Etapa['tipo'] = 'aberta'): PedidoMovimento {
  return { leadId: 'lead-1', nomeLead: 'Kariny', destino: etapa(tipo) }
}

function montar(extras: Partial<Parameters<typeof ModalMovimento>[0]> = {}) {
  const onCancelar = vi.fn()
  const onConfirmar = vi.fn()
  const r = render(
    <ModalMovimento
      pedido={pedido()}
      motivos={[{ id: 'motivo-1', nome: 'Preço', ativo: true }]}
      etiquetasConhecidas={[]}
      onCancelar={onCancelar}
      onConfirmar={onConfirmar}
      {...extras}
    />,
  )
  return { ...r, onCancelar, onConfirmar }
}

describe('ModalMovimento — dialogo acessivel', () => {
  it('e um dialog modal com o nome do titulo (lead → etapa)', () => {
    montar()
    const dialogo = screen.getByRole('dialog', { name: 'Kariny → Proposta' })
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
  })

  it('ao montar, o foco vai para o campo de etiquetas quando nao ha motivo a escolher', () => {
    montar()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('digite e pressione Enter'))
  })

  it('ao montar num destino "perdido", o foco vai para o motivo — e o campo obrigatorio', () => {
    montar({ pedido: pedido('perdido') })
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /motivo da perda/i }))
  })

  it('ao desmontar, o foco volta para o elemento que o tinha antes de abrir', () => {
    const gatilho = document.createElement('button')
    gatilho.textContent = 'gatilho'
    document.body.appendChild(gatilho)
    gatilho.focus()
    expect(document.activeElement).toBe(gatilho)

    const { unmount } = montar()
    expect(document.activeElement).not.toBe(gatilho)

    unmount()
    expect(document.activeElement).toBe(gatilho)
    gatilho.remove()
  })

  it('Escape cancela', () => {
    const { onCancelar } = montar()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancelar).toHaveBeenCalledTimes(1)
  })

  it('Escape durante o envio e no-op: o movimento em voo nao e cancelado', () => {
    const { onCancelar } = montar({ enviando: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancelar).not.toHaveBeenCalled()
  })
})
