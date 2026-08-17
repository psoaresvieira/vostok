// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Etapas } from './etapas'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { Etapa } from '@/lib/domain/tipos'
import type { ResumoEtapa } from '@/lib/data/etapas'

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
    cleanup()

    // Singular: "1 lead já passou", nunca "1 leads já passaram".
    const eSingular = etapa({ id: 'e-1s', nome: 'Engano solitario' })
    const resumoSingular: ResumoEtapa[] = [
      { etapaId: 'e-1s', leadsNaEtapa: 0, leadsPassaram: 1 },
    ]
    const singular = stubRegistrando<[string], void>(ok(undefined))
    render(<Etapas etapas={[eSingular]} resumo={resumoSingular} excluir={singular.fn} />)
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    const dialogoSingular = screen.getByRole('dialog')
    expect(dialogoSingular.textContent).toContain('1 lead já passou por ela.')
    expect(dialogoSingular.textContent).not.toContain('1 leads')
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
    cleanup()

    // Singular: "Mova o 1 lead", nunca "Mova os 1 leads".
    const eSingular = etapa({ id: 'e-3s', nome: 'Negociação solitaria' })
    const resumoSingular: ResumoEtapa[] = [
      { etapaId: 'e-3s', leadsNaEtapa: 1, leadsPassaram: 1 },
    ]
    const { fn: excluirSingular } = stubRegistrando<[string], void>(falha('etapa_tem_leads'))
    render(<Etapas etapas={[eSingular]} resumo={resumoSingular} excluir={excluirSingular} />)
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(
      await screen.findByText('Mova o 1 lead desta etapa antes de excluí-la.'),
    ).toBeTruthy()
  })

  it('recusa etapa_tem_leads com resumo defasado (leadsNaEtapa: 0) mostra a mensagem generica, nunca "0 lead"', async () => {
    // Corrida: o dialogo abriu com o resumo mostrando 0 leads na etapa, um
    // lead entrou depois disso, e a RPC recusa a exclusao porque o banco ja
    // enxerga o lead novo. Compor a frase com o resumo defasado renderizaria
    // "Mova os 0 leads desta etapa antes de exclui-la." — contradiz a propria
    // recusa. So compoe o numero quando ele e maior que zero; caso contrario
    // cai no texto generico de config/erros.ts.
    const e = etapa({ id: 'e-9', nome: 'Qualificação' })
    const resumo: ResumoEtapa[] = [{ etapaId: 'e-9', leadsNaEtapa: 0, leadsPassaram: 4 }]
    const { fn: excluir } = stubRegistrando<[string], void>(falha('etapa_tem_leads'))

    render(<Etapas etapas={[e]} resumo={resumo} excluir={excluir} />)

    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(
      await screen.findByText('Há leads nesta etapa. Mova-os antes de excluí-la.'),
    ).toBeTruthy()
    expect(screen.queryByText(/0 lead/)).toBeNull()
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

  it('um erro depois de um renomear bem-sucedido apaga o "Salvo" antigo — o sinal e transitorio', async () => {
    // Duas etapas: a primeira e renomeada com sucesso (mostra "Salvo"), a
    // segunda tem a exclusao recusada. Sem a limpeza cruzada, o "Salvo" da
    // primeira linha ficaria colado na tela ao lado do erro da segunda,
    // como se os dois fizessem parte do mesmo evento.
    const a = etapa({ id: 'e-6', nome: 'Etapa A' })
    const b = etapa({ id: 'e-7', nome: 'Etapa B', tipo: 'ganho' })
    const renomear = stubRegistrando<[string, string], void>(ok(undefined))
    const excluir = stubRegistrando<[string], void>(falha('ultima_etapa_do_tipo'))

    render(<Etapas etapas={[a, b]} resumo={[]} renomear={renomear.fn} excluir={excluir.fn} />)

    const campo = screen.getByDisplayValue('Etapa A')
    fireEvent.change(campo, { target: { value: 'Etapa A renomeada' } })
    fireEvent.blur(campo)
    expect(await screen.findByText(/salvo/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Excluir etapa Etapa B' }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText('Esta é a última etapa do tipo ganho.')).toBeTruthy()
    expect(screen.queryByText(/salvo/i)).toBeNull()
  })

  it('confirmar fica desabilitado durante a exclusao; clique duplo nao dispara duas chamadas', async () => {
    // O bug que este teste tranca: sem guarda de "em andamento", dois
    // cliques rapidos em "Confirmar exclusão" disparavam a RPC duas vezes —
    // a segunda chegava depois que a etapa ja tinha sido apagada pela
    // primeira e pintava "etapa_nao_encontrada" de vermelho logo apos um
    // sucesso. O stub so resolve quando o teste manda (`liberar`), o que
    // deixa a chamada "em voo" tempo suficiente para o segundo clique
    // acontecer enquanto o botao deveria estar desabilitado.
    const e = etapa({ id: 'e-8', nome: 'Intermediaria' })
    const chamadas: string[] = []
    let liberar: (r: Resultado<void>) => void = () => {}
    const excluir = (id: string): Promise<Resultado<void>> => {
      chamadas.push(id)
      return new Promise((resolve) => {
        liberar = resolve
      })
    }

    render(<Etapas etapas={[e]} resumo={[]} excluir={excluir} />)
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))
    const confirmar = screen.getByRole('button', { name: /confirmar/i }) as HTMLButtonElement

    fireEvent.click(confirmar)
    expect(confirmar.disabled).toBe(true)
    fireEvent.click(confirmar)
    expect(chamadas).toEqual(['e-8'])

    liberar(ok(undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
