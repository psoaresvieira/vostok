// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { FormularioSenha } from './formulario'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'

// Mesmo motivo de nova-pipeline.test.tsx / disparar.test.tsx: o cleanup
// automatico do @testing-library/react so se registra com globals: true, e
// este vitest.config nao liga de proposito.
afterEach(cleanup)

/** Stub de acao que so registra as chamadas recebidas — arranjo de
 * nova-pipeline.test.tsx / disparar.test.tsx. */
function stubRegistrando(
  resultado: Resultado<void>,
): { fn: (formData: FormData) => Promise<Resultado<void>>; chamadas: FormData[] } {
  const chamadas: FormData[] = []
  const fn = async (formData: FormData): Promise<Resultado<void>> => {
    chamadas.push(formData)
    return resultado
  }
  return { fn, chamadas }
}

function preencher(senha: string, confirmacao: string) {
  const [campoSenha, campoConfirmacao] = screen.getAllByPlaceholderText(
    /senha/i,
  ) as HTMLInputElement[]
  act(() => {
    campoSenha.value = senha
    campoSenha.dispatchEvent(new Event('input', { bubbles: true }))
    campoConfirmacao.value = confirmacao
    campoConfirmacao.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('FormularioSenha', () => {
  it('submete e mostra Senha trocada', async () => {
    const { fn: trocar, chamadas } = stubRegistrando(ok(undefined))
    render(<FormularioSenha trocar={trocar} />)

    preencher('senhanova123', 'senhanova123')
    const botao = screen.getByRole('button', { name: /trocar senha/i }) as HTMLButtonElement

    await act(async () => {
      botao.click()
    })

    expect(chamadas).toHaveLength(1)
    expect(await screen.findByText('Senha trocada ✓')).toBeTruthy()

    const [campoSenha, campoConfirmacao] = screen.getAllByPlaceholderText(
      /senha/i,
    ) as HTMLInputElement[]
    expect(campoSenha.value).toBe('')
    expect(campoConfirmacao.value).toBe('')
  })

  it('dois cliques num act unico disparam UMA chamada', async () => {
    const { fn: trocar, chamadas } = stubRegistrando(ok(undefined))
    render(<FormularioSenha trocar={trocar} />)

    preencher('senhanova123', 'senhanova123')
    const botao = screen.getByRole('button', { name: /trocar senha/i }) as HTMLButtonElement

    // `.click()` nativo, os DOIS dentro do MESMO `act`, e nao dois
    // `fireEvent.click` separados — mesma forma de nova-pipeline.test.tsx
    // caso 5: cada `fireEvent.click` ja flusha o re-render antes do proximo
    // clique, entao o segundo bateria num botao ja `disabled` e o teste
    // passaria sem provar nada sobre a trava sincrona.
    await act(async () => {
      botao.click()
      botao.click()
    })

    expect(chamadas).toHaveLength(1)
  })

  it('erro da action aparece traduzido, nunca o codigo', async () => {
    const { fn: trocar } = stubRegistrando(falha('senha_igual'))
    render(<FormularioSenha trocar={trocar} />)

    preencher('senhanova123', 'senhanova123')
    const botao = screen.getByRole('button', { name: /trocar senha/i }) as HTMLButtonElement

    await act(async () => {
      botao.click()
    })

    expect(await screen.findByText('A senha nova precisa ser diferente da atual.')).toBeTruthy()
    expect(screen.queryByText('senha_igual')).toBeNull()
  })

  it('senhas diferentes barram no cliente sem chamar a action', async () => {
    const { fn: trocar, chamadas } = stubRegistrando(ok(undefined))
    render(<FormularioSenha trocar={trocar} />)

    preencher('senhanova123', 'outradiferente')
    const botao = screen.getByRole('button', { name: /trocar senha/i }) as HTMLButtonElement

    await act(async () => {
      botao.click()
    })

    expect(chamadas).toHaveLength(0)
    expect(await screen.findByText('As duas senhas não conferem.')).toBeTruthy()
  })
})
