// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Etiqueta } from '@/lib/domain/tipos'

// Mesmo registro manual de cartao.test.tsx: sem globals, o cleanup do
// @testing-library nao se registra sozinho e o document vaza entre os it().
afterEach(cleanup)

const adicionarEtiquetasMock = vi.fn()

vi.mock('./acoes', () => ({
  adicionarEtiquetas: (...args: unknown[]) => adicionarEtiquetasMock(...args),
}))

import { EditorEtiquetas } from './etiquetas'

function etiqueta(id: string, nome: string): Etiqueta {
  return { id, nome }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EditorEtiquetas — sugestoes', () => {
  it('filtra as conhecidas pelo texto digitado, sem diferenciar caixa', () => {
    render(
      <EditorEtiquetas
        leadId="lead-1"
        atuais={[]}
        conhecidas={[etiqueta('t1', 'Quente'), etiqueta('t2', 'Frio'), etiqueta('t3', 'Sem orçamento')]}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/nova etiqueta/), { target: { value: 'que' } })

    expect(screen.getByRole('button', { name: 'Quente' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Frio' })).toBeNull()
  })

  it('nao sugere etiqueta que o lead ja tem (mesmo com caixa diferente)', () => {
    render(
      <EditorEtiquetas
        leadId="lead-1"
        atuais={[etiqueta('t1', 'quente')]}
        conhecidas={[etiqueta('t1', 'Quente'), etiqueta('t2', 'Quase quente')]}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Quente' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Quase quente' })).toBeTruthy()
  })
})

describe('EditorEtiquetas — aplicar', () => {
  it('Enter aplica o texto trimado e limpa o campo no sucesso', async () => {
    adicionarEtiquetasMock.mockResolvedValue({ ok: true, valor: undefined })
    render(<EditorEtiquetas leadId="lead-1" atuais={[]} conhecidas={[]} />)

    const campo = screen.getByPlaceholderText(/nova etiqueta/) as HTMLInputElement
    fireEvent.change(campo, { target: { value: '  quente  ' } })
    fireEvent.keyDown(campo, { key: 'Enter' })

    await waitFor(() => expect(campo.value).toBe(''))
    expect(adicionarEtiquetasMock).toHaveBeenCalledWith('lead-1', ['quente'])
  })

  it('Enter com campo so de espacos nao chama a action', () => {
    render(<EditorEtiquetas leadId="lead-1" atuais={[]} conhecidas={[]} />)

    const campo = screen.getByPlaceholderText(/nova etiqueta/)
    fireEvent.change(campo, { target: { value: '   ' } })
    fireEvent.keyDown(campo, { key: 'Enter' })

    expect(adicionarEtiquetasMock).not.toHaveBeenCalled()
  })

  it('clicar numa sugestao aplica aquele nome', async () => {
    adicionarEtiquetasMock.mockResolvedValue({ ok: true, valor: undefined })
    render(
      <EditorEtiquetas leadId="lead-1" atuais={[]} conhecidas={[etiqueta('t1', 'Quente')]} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quente' }))

    await waitFor(() => expect(adicionarEtiquetasMock).toHaveBeenCalledWith('lead-1', ['Quente']))
  })

  it('erro conhecido vira mensagem traduzida e o campo NAO e limpo', async () => {
    adicionarEtiquetasMock.mockResolvedValue({ ok: false, erro: 'lead_nao_encontrado' })
    render(<EditorEtiquetas leadId="lead-1" atuais={[]} conhecidas={[]} />)

    const campo = screen.getByPlaceholderText(/nova etiqueta/) as HTMLInputElement
    fireEvent.change(campo, { target: { value: 'quente' } })
    fireEvent.keyDown(campo, { key: 'Enter' })

    expect(await screen.findByText('Você não tem acesso a esse lead.')).toBeTruthy()
    expect(campo.value).toBe('quente')
  })

  it('rede caida (action rejeita) vira a mensagem de falha de conexao, nao excecao', async () => {
    adicionarEtiquetasMock.mockRejectedValue(new Error('fetch failed'))
    render(<EditorEtiquetas leadId="lead-1" atuais={[]} conhecidas={[]} />)

    const campo = screen.getByPlaceholderText(/nova etiqueta/)
    fireEvent.change(campo, { target: { value: 'quente' } })
    fireEvent.keyDown(campo, { key: 'Enter' })

    expect(
      await screen.findByText(/Não conseguimos falar com o servidor/),
    ).toBeTruthy()
  })

  it('codigo desconhecido cai no fallback cru (?? r.erro)', async () => {
    adicionarEtiquetasMock.mockResolvedValue({ ok: false, erro: 'erro_exotico_do_banco' })
    render(<EditorEtiquetas leadId="lead-1" atuais={[]} conhecidas={[]} />)

    const campo = screen.getByPlaceholderText(/nova etiqueta/)
    fireEvent.change(campo, { target: { value: 'quente' } })
    fireEvent.keyDown(campo, { key: 'Enter' })

    expect(await screen.findByText('erro_exotico_do_banco')).toBeTruthy()
  })
})
