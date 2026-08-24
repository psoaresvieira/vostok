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

  it('com semConta mostra aviso de que a conta nao esta vinculada a nenhuma empresa', () => {
    render(<FormularioLogin convite={null} semConta />)
    expect(
      screen.getByText(
        'Sua conta ainda não está vinculada a nenhuma empresa. Peça um novo convite ao administrador.',
      ),
    ).toBeTruthy()
  })

  it('sem semConta nao mostra o aviso de conta sem vinculo', () => {
    render(<FormularioLogin convite={null} />)
    expect(screen.queryByText(/ainda não está vinculada/)).toBeNull()
  })
})
