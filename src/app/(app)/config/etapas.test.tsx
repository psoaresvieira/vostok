// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Etapas } from './etapas'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { Etapa } from '@/lib/domain/tipos'
import type { ResumoEtapa } from '@/lib/data/admin'

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito — o
// repo importa helper de teste explicitamente em todo lugar. Sem o registro
// manual abaixo, o document do jsdom persiste entre os it() deste arquivo e,
// do segundo render() em diante, as consultas acham no velho ou estouram
// "multiple elements found". Copiado de tarefas.test.tsx (Task 5 do Plano 7).
afterEach(cleanup)

function etapa(overrides: Partial<Etapa> = {}): Etapa {
  return {
    id: 'e-1',
    pipelineId: 'p-1',
    nome: 'Contato inicial',
    ordem: 1,
    tipo: 'aberta',
    slaHoras: null,
    ...overrides,
  }
}

/** Stub de acao que so registra as chamadas recebidas, sem tocar servidor
 * nenhum — o mesmo arranjo que os componentes testados do Plano 7 usam. */
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

describe('Etapas', () => {
  it('o dialogo mostra o numero de leads que passaram antes de confirmar', () => {
    const e = etapa({ id: 'e-1', nome: 'Engano' })
    const resumo: ResumoEtapa[] = [{ etapaId: 'e-1', leadsNaEtapa: 0, leadsPassaram: 12 }]
    const { fn: excluir, chamadas } = stubRegistrando<[string], void>(ok(undefined))

    render(<Etapas etapas={[e]} resumo={resumo} excluir={excluir} />)

    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))

    const dialogo = screen.getByRole('dialog')
    expect(dialogo.textContent).toContain('12')
    expect(dialogo.textContent).toContain('Engano')
    // Fica vermelho se o clique excluir chamar a acao direto, sem confirmacao.
    expect(chamadas).toHaveLength(0)
  })

  it('confirmar chama a acao com o id certo; cancelar nao chama nada', () => {
    const e = etapa({ id: 'e-2', nome: 'Proposta enviada' })
    const resumo: ResumoEtapa[] = [{ etapaId: 'e-2', leadsNaEtapa: 0, leadsPassaram: 5 }]

    // Confirma.
    const confirmando = stubRegistrando<[string], void>(ok(undefined))
    render(<Etapas etapas={[e]} resumo={resumo} excluir={confirmando.fn} />)
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(confirmando.chamadas).toEqual([['e-2']])
    cleanup()

    // Cancela.
    const cancelando = stubRegistrando<[string], void>(ok(undefined))
    render(<Etapas etapas={[e]} resumo={resumo} excluir={cancelando.fn} />)
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(cancelando.chamadas).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('recusa etapa_tem_leads mostra a mensagem com o numero de leads na etapa', async () => {
    const e = etapa({ id: 'e-3', nome: 'Negociação' })
    const resumo: ResumoEtapa[] = [{ etapaId: 'e-3', leadsNaEtapa: 3, leadsPassaram: 20 }]
    const { fn: excluir } = stubRegistrando<[string], void>(falha('etapa_tem_leads'))

    render(<Etapas etapas={[e]} resumo={resumo} excluir={excluir} />)

    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText(/3/)).toBeTruthy()
  })

  it('recusa ultima_etapa_do_tipo mostra o tipo da etapa', async () => {
    const e = etapa({ id: 'e-4', nome: 'Fechado', tipo: 'ganho' })
    const resumo: ResumoEtapa[] = [{ etapaId: 'e-4', leadsNaEtapa: 0, leadsPassaram: 8 }]
    const { fn: excluir } = stubRegistrando<[string], void>(falha('ultima_etapa_do_tipo'))

    render(<Etapas etapas={[e]} resumo={resumo} excluir={excluir} />)

    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText('Esta é a última etapa do tipo ganho.')).toBeTruthy()
  })

  it('renomear com sucesso mostra a confirmacao de salvo; com falha, nao', async () => {
    const e = etapa({ id: 'e-5', nome: 'Contato inicial' })

    // Sucesso.
    const sucesso = stubRegistrando<[string, string], void>(ok(undefined))
    render(<Etapas etapas={[e]} resumo={[]} renomear={sucesso.fn} />)
    const campoSucesso = screen.getByDisplayValue('Contato inicial')
    fireEvent.change(campoSucesso, { target: { value: 'Primeiro contato' } })
    fireEvent.blur(campoSucesso)
    expect(await screen.findByText(/salvo/i)).toBeTruthy()
    cleanup()

    // Falha.
    const falhando = stubRegistrando<[string, string], void>(falha('nao_encontrado'))
    render(<Etapas etapas={[e]} resumo={[]} renomear={falhando.fn} />)
    const campoFalha = screen.getByDisplayValue('Contato inicial')
    fireEvent.change(campoFalha, { target: { value: 'Outro nome' } })
    fireEvent.blur(campoFalha)
    await screen.findByText(/nao existe mais|não existe mais/i)
    expect(screen.queryByText(/salvo/i)).toBeNull()
  })
})
