// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FormularioCadastro } from './formulario'

vi.mock('../acoes', () => ({ cadastrar: vi.fn() }))

afterEach(cleanup)

describe('FormularioCadastro', () => {
  it('nao oferece campo de empresa: a conta ja existe, o convidado so entra', () => {
    render(<FormularioCadastro convite="tok123" />)
    expect(screen.queryByPlaceholderText('nome da empresa')).toBeNull()
    expect(screen.getByPlaceholderText('seu nome')).toBeTruthy()
  })

  it('carrega o token do convite no formulario', () => {
    const { container } = render(<FormularioCadastro convite="tok123" />)
    const escondido = container.querySelector('input[name="convite"]') as HTMLInputElement
    expect(escondido?.value).toBe('tok123')
  })
})
