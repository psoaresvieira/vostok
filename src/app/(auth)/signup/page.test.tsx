import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'
import SignupPage from './page'

// redirect() de verdade lanca (interrompe o render); o mock reproduz isso com
// uma excecao sentinela para o teste conseguir afirmar o destino exato.
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`)
  },
}))

// Server Component so passa o token adiante — quem valida a renderizacao do
// formulario em si e formulario.test.tsx. Aqui o stub so grava as props.
vi.mock('./formulario', () => ({
  FormularioCadastro: (props: { convite: string }) => props,
}))

function propsDoElemento(elemento: ReactElement) {
  return elemento.props as { convite: string }
}

describe('SignupPage', () => {
  it('convite ausente redireciona para /login', async () => {
    await expect(SignupPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT:/login'
    )
  })

  it('convite vazio redireciona para /login', async () => {
    await expect(
      SignupPage({ searchParams: Promise.resolve({ convite: '' }) })
    ).rejects.toThrow('REDIRECT:/login')
  })

  it('convite so com espacos redireciona para /login', async () => {
    await expect(
      SignupPage({ searchParams: Promise.resolve({ convite: '   ' }) })
    ).rejects.toThrow('REDIRECT:/login')
  })

  it('convite em array usa o primeiro token, sem redirecionar', async () => {
    const elemento = await SignupPage({
      searchParams: Promise.resolve({ convite: ['tok1', 'tok2'] }),
    })
    expect(propsDoElemento(elemento).convite).toBe('tok1')
  })

  it('convite com espacos ao redor chega trimado no formulario', async () => {
    const elemento = await SignupPage({
      searchParams: Promise.resolve({ convite: '  tok1 ' }),
    })
    expect(propsDoElemento(elemento).convite).toBe('tok1')
  })
})
