// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { NovoLead } from './novo-lead'
import { ok } from '@/lib/domain/resultado'

// Mesmo motivo de disparar.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

/**
 * criarLeadAction/verificarDuplicados sao importadas direto por novo-lead.tsx
 * (nao por prop injetavel, ao contrario de BarraPipelines/NovaPipeline) —
 * mockar o modulo './acoes' e' o jeito de capturar o FormData que o form
 * realmente monta, sem levantar o Supabase de verdade (mesmo padrao de
 * funil/acoes.test.ts, que mocka '@/lib/data/supabase').
 */
const criarLeadActionMock = vi.fn()
const verificarDuplicadosMock = vi.fn()

vi.mock('./acoes', () => ({
  criarLeadAction: (...args: unknown[]) => criarLeadActionMock(...args),
  verificarDuplicados: (...args: unknown[]) => verificarDuplicadosMock(...args),
}))

describe('NovoLead — pipeline ativa', () => {
  it('caso 1 — envia a pipeline ativa no FormData', async () => {
    criarLeadActionMock.mockResolvedValue(ok('lead-novo'))
    verificarDuplicadosMock.mockResolvedValue(ok([]))

    render(<NovoLead membros={[]} podeEscolherResponsavel={false} pipelineId="abc" />)

    fireEvent.click(screen.getByRole('button', { name: 'Novo lead' }))
    fireEvent.change(screen.getByPlaceholderText('nome'), { target: { value: 'Maria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(criarLeadActionMock).toHaveBeenCalledTimes(1))
    const [formData] = criarLeadActionMock.mock.calls[0] as [FormData]
    expect(formData.get('pipelineId')).toBe('abc')
  })
})
