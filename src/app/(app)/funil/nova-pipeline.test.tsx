// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { NovaPipeline } from './nova-pipeline'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'

// Mesmo motivo de disparar.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const empurrados: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (url: string) => empurrados.push(url),
    replace: () => {},
    refresh: () => {},
  }),
}))

/** Stub de acao que so registra as chamadas recebidas — arranjo de
 * disparar.test.tsx / barra-pipelines.test.tsx. */
function stubRegistrando<A extends unknown[], T>(
  resultado: Resultado<T>,
): { fn: (...args: A) => Promise<Resultado<T>>; chamadas: A[] } {
  const chamadas: A[] = []
  const fn = async (...args: A): Promise<Resultado<T>> => {
    chamadas.push(args)
    return resultado
  }
  return { fn, chamadas }
}

/** Le o campo `etapas` (JSON) da FormData recebida pela action, na mesma
 * forma que acoes-pipelines.ts o interpreta. */
function etapasDaChamada(formData: FormData): string[] {
  return JSON.parse(String(formData.get('etapas')))
}

function abrirModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Nova pipeline' }))
}

beforeEach(() => {
  empurrados.length = 0
})

describe('NovaPipeline', () => {
  it('caso 1 — ordem visual é a ordem enviada', async () => {
    const { fn: criar, chamadas } = stubRegistrando<[FormData], string>(ok('pipeline-nova'))
    render(<NovaPipeline criar={criar} />)
    abrirModal()

    fireEvent.change(screen.getByLabelText('Nome da pipeline'), {
      target: { value: 'Pipeline B2B' },
    })

    // Move 'Proposta' (4a etapa sugerida) uma posicao para cima, trocando
    // de lugar com 'Qualificação'.
    fireEvent.click(screen.getByRole('button', { name: 'Mover Proposta para cima' }))

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(chamadas).toHaveLength(1))
    const [formData] = chamadas[0]
    expect(formData.get('nome')).toBe('Pipeline B2B')
    expect(etapasDaChamada(formData)).toEqual([
      'Novo lead',
      'Contato feito',
      'Proposta',
      'Qualificação',
      'Fechamento',
    ])
  })

  it('caso 2 — remover some com a linha e o submit não a envia', async () => {
    const { fn: criar, chamadas } = stubRegistrando<[FormData], string>(ok('pipeline-nova'))
    render(<NovaPipeline criar={criar} />)
    abrirModal()

    fireEvent.change(screen.getByLabelText('Nome da pipeline'), {
      target: { value: 'Pipeline B2B' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remover Qualificação' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(chamadas).toHaveLength(1))
    const [formData] = chamadas[0]
    expect(etapasDaChamada(formData)).toEqual([
      'Novo lead',
      'Contato feito',
      'Proposta',
      'Fechamento',
    ])
  })

  it('caso 3 — última etapa não é removível', () => {
    render(<NovaPipeline criar={stubRegistrando(ok('x')).fn} />)
    abrirModal()

    fireEvent.click(screen.getByRole('button', { name: 'Remover Novo lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remover Contato feito' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remover Qualificação' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remover Proposta' }))

    const ultimoRemover = screen.getByRole('button', { name: 'Remover Fechamento' })
    expect((ultimoRemover as HTMLButtonElement).disabled).toBe(true)
  })

  it('caso 4 — sucesso navega para a pipeline nova', async () => {
    const { fn: criar, chamadas } = stubRegistrando<[FormData], string>(ok('pipeline-abc123'))
    render(<NovaPipeline criar={criar} />)
    abrirModal()

    fireEvent.change(screen.getByLabelText('Nome da pipeline'), {
      target: { value: 'Pipeline B2B' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(chamadas).toHaveLength(1))
    await waitFor(() => expect(empurrados).toEqual(['/funil?pipeline=pipeline-abc123']))
  })

  it('caso 5 — dois cliques no mesmo frame disparam UMA chamada', async () => {
    const { fn: criar, chamadas } = stubRegistrando<[FormData], string>(ok('pipeline-nova'))
    render(<NovaPipeline criar={criar} />)
    abrirModal()

    fireEvent.change(screen.getByLabelText('Nome da pipeline'), {
      target: { value: 'Pipeline B2B' },
    })

    const botao = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement
    // `.click()` nativo, os DOIS dentro do MESMO `act`, e nao dois
    // `fireEvent.click` separados — mesma forma de disparar.test.tsx: cada
    // `fireEvent.click` ja flusha o re-render antes do proximo clique, entao
    // o segundo bateria num botao ja `disabled` e o teste passaria sem
    // provar nada sobre a trava sincrona.
    await act(async () => {
      botao.click()
      botao.click()
    })

    expect(chamadas).toHaveLength(1)
  })

  it('caso 6 — erro mantém o modal aberto com a frase mapeada', async () => {
    const { fn: criar } = stubRegistrando<[FormData], string>(falha('nome_obrigatorio'))
    render(<NovaPipeline criar={criar} />)
    abrirModal()

    fireEvent.change(screen.getByLabelText('Nome da pipeline'), {
      target: { value: 'Pipeline digitada' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.getByText('Dê um nome antes de salvar.')).toBeTruthy())
    expect(screen.queryByText('nome_obrigatorio')).toBeNull()

    // Modal continua aberto com o que foi digitado.
    expect(screen.getByLabelText('Nome da pipeline')).toBeTruthy()
    expect((screen.getByLabelText('Nome da pipeline') as HTMLInputElement).value).toBe(
      'Pipeline digitada',
    )
  })
})
