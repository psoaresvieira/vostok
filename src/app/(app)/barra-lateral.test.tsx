// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BarraLateral } from './barra-lateral'

afterEach(cleanup)

vi.mock('next/navigation', () => ({
  usePathname: () => '/funil',
}))

// O Sino puxa contexto proprio (notificacoes, painel) que nao interessa a
// estes testes de rodape/link — stub vazio, mesma tecnica de outros testes
// de componente que isolam vizinhos pesados.
vi.mock('./sino', () => ({
  Sino: () => null,
}))

function props(papel: 'admin' | 'gestor' | 'vendedor') {
  return {
    conta: 'Conta Teste',
    papel,
    nomeUsuario: 'Fulano de Tal',
    contagemNaoLidas: 0,
    notificacoes: [],
    dono: false,
  }
}

describe('BarraLateral', () => {
  it('link Trocar senha aparece para vendedor', () => {
    render(<BarraLateral {...props('vendedor')} />)
    expect(screen.getByRole('link', { name: 'Trocar senha' })).toBeTruthy()
  })

  it('link Configuração continua so para admin', () => {
    render(<BarraLateral {...props('vendedor')} />)
    expect(screen.queryByRole('link', { name: 'Configuração' })).toBeNull()
  })
})
