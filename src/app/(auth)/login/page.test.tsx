import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'
import LoginPage from './page'

// Server Component so passa os parametros adiante — quem valida a
// renderizacao do formulario em si e formulario.test.tsx. Aqui o stub so
// grava as props (mesmo artificio de signup/page.test.tsx).
vi.mock('./formulario', () => ({
  FormularioLogin: (props: { convite: string | null; semConta?: boolean }) => props,
}))

function propsDoElemento(elemento: ReactElement) {
  return elemento.props as { convite: string | null; semConta?: boolean }
}

describe('LoginPage', () => {
  it('sem query params: convite nulo e sem aviso de conta sem vinculo', async () => {
    const elemento = await LoginPage({ searchParams: Promise.resolve({}) })
    expect(propsDoElemento(elemento)).toEqual({ convite: null, semConta: false })
  })

  it('convite em array usa o primeiro token', async () => {
    const elemento = await LoginPage({
      searchParams: Promise.resolve({ convite: ['tok1', 'tok2'] }),
    })
    expect(propsDoElemento(elemento).convite).toBe('tok1')
  })

  it('convite com espacos ao redor chega trimado', async () => {
    const elemento = await LoginPage({ searchParams: Promise.resolve({ convite: '  tok1 ' }) })
    expect(propsDoElemento(elemento).convite).toBe('tok1')
  })

  it('erro=sem_conta ativa o aviso de conta sem vinculo', async () => {
    const elemento = await LoginPage({ searchParams: Promise.resolve({ erro: 'sem_conta' }) })
    expect(propsDoElemento(elemento).semConta).toBe(true)
  })

  it('erro diferente de sem_conta nao ativa o aviso', async () => {
    const elemento = await LoginPage({ searchParams: Promise.resolve({ erro: 'outra_coisa' }) })
    expect(propsDoElemento(elemento).semConta).toBe(false)
  })
})
