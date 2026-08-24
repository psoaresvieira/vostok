// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const criarContaClienteAction = vi.fn()
vi.mock('./acoes', () => ({
  criarContaClienteAction: (...a: unknown[]) => criarContaClienteAction(...a),
}))

import { NovaConta } from './nova-conta'

beforeEach(() => criarContaClienteAction.mockReset())

// Mesmo motivo de disparar.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

describe('NovaConta', () => {
  it('mostra o link /convite/<token> quando a conta e criada', async () => {
    criarContaClienteAction.mockResolvedValue({ ok: true, valor: 'tok123' })
    render(<NovaConta />)
    fireEvent.change(screen.getByPlaceholderText('nome da conta'), { target: { value: 'Cliente X' } })
    fireEvent.change(screen.getByPlaceholderText('email do cliente'), { target: { value: 'a@a.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => {
      expect(screen.getByText(/\/convite\/tok123$/)).toBeTruthy()
    })
  })

  it('traduz o erro em mensagem na tela', async () => {
    criarContaClienteAction.mockResolvedValue({ ok: false, erro: 'email_invalido' })
    // fireEvent.submit no <form>, e nao fireEvent.click no botao: os dois
    // campos sao `required` e o jsdom, como um navegador real, bloqueia a
    // submissao implicita do clique quando ha campo obrigatorio vazio — sem
    // isso este caso nunca chegaria a chamar a action mockada.
    const { container } = render(<NovaConta />)
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => {
      expect(screen.getByText('Email inválido.')).toBeTruthy()
    })
  })
})
