// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FormularioLogin } from './formulario'

vi.mock('../acoes', () => ({ entrar: vi.fn() }))

afterEach(cleanup)

describe('FormularioLogin', () => {
  it('sem convite nao oferece criar conta: cadastro e fechado', () => {
    render(<FormularioLogin convite={null} />)
    expect(screen.queryByRole('link', { name: 'Criar uma conta' })).toBeNull()
  })

  it('com convite oferece criar conta levando o token junto', () => {
    render(<FormularioLogin convite="tok123" />)
    const link = screen.getByRole('link', { name: 'Criar uma conta' }) as HTMLAnchorElement
    expect(link.href).toContain('/signup?convite=tok123')
  })
})
