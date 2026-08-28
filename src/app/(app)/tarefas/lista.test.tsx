// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Lista } from './lista'
import { mensagemDeErroTarefa } from './erros'
import type { Tarefa } from '@/lib/data/tarefas'

// concluirTarefa e' 'use server': fora de um runtime Next real (o que este
// arquivo, rodando sob jsdom puro, nao e), chamar a implementacao de verdade
// tocaria criarTarefaStoreDoServidor() -> next/headers fora de um request
// scope. Mockado por inteiro para o teste de erro-apos-esvaziar abaixo poder
// controlar o Resultado sem passar perto disso — mesmo motivo pelo qual
// nenhum teste deste repo invoca uma Server Action real a partir de jsdom
// (ver funil/drawer/tarefas.test.tsx).
const concluirTarefaMock = vi.fn()
vi.mock('@/app/(app)/tarefas/acoes', () => ({
  concluirTarefa: (...args: unknown[]) => concluirTarefaMock(...args),
}))

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito.
// Sem o registro manual abaixo, o document do jsdom persiste entre os it()
// deste arquivo e, do segundo render() em diante, as consultas acham o velho
// ou estouram "multiple elements found". Copiado de tarefas.test.tsx (Task 5).
afterEach(cleanup)
afterEach(() => concluirTarefaMock.mockReset())

const AGORA = new Date('2026-08-02T12:00:00Z')

function tarefa(overrides: Partial<Tarefa> = {}): Tarefa {
  return {
    id: 't-1',
    leadId: 'lead-1',
    leadNome: 'Fulano de Tal',
    titulo: 'Ligar para o cliente',
    tipo: 'ligacao',
    venceEm: new Date('2026-08-05T12:00:00Z'),
    concluidaEm: null,
    concluidaPor: null,
    criadoPor: 'user-1',
    criadoEm: new Date('2026-07-20T12:00:00Z'),
    ...overrides,
  }
}

describe('Lista', () => {
  it('mostra as quatro secoes na ordem Atrasadas, Hoje, Proximos 7 dias, Depois, cada tarefa na sua', () => {
    const atrasada = tarefa({ id: 't-atrasada', titulo: 'Tarefa atrasada', venceEm: new Date('2026-08-01T12:00:00Z') })
    const hoje = tarefa({ id: 't-hoje', titulo: 'Tarefa de hoje', venceEm: new Date('2026-08-02T18:00:00Z') })
    const proxima = tarefa({ id: 't-proxima', titulo: 'Tarefa proxima', venceEm: new Date('2026-08-06T12:00:00Z') })
    const depois = tarefa({ id: 't-depois', titulo: 'Tarefa de depois', venceEm: new Date('2026-09-01T12:00:00Z') })

    // Ordem de ENTRADA deliberadamente embaralhada em relacao a ordem de
    // EXIBICAO esperada (Atrasadas -> Hoje -> Proximos 7 dias -> Depois).
    // `porBalde` (lista.tsx) e' um Map, e Map preserva ordem de insercao: se
    // a fixture chegasse na mesma ordem dos baldes (como minhasAbertas
    // devolve em producao, por ordenar `vence_em` asc), uma implementacao
    // errada que iterasse `porBalde.entries()` em vez da constante
    // ORDEM_BALDES acertaria por coincidencia e este teste passaria mesmo
    // assim. Embaralhada, so ORDEM_BALDES produz o toEqual abaixo — achado
    // Important 1 do review da Task 6.
    render(<Lista tarefas={[depois, hoje, atrasada, proxima]} agora={AGORA} />)

    const cabecalhos = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(cabecalhos).toEqual(['Atrasadas', 'Hoje', 'Próximos 7 dias', 'Depois'])

    const secaoAtrasadas = screen.getByRole('heading', { name: 'Atrasadas' }).closest('section')
    const secaoHoje = screen.getByRole('heading', { name: 'Hoje' }).closest('section')
    const secaoProximos = screen.getByRole('heading', { name: 'Próximos 7 dias' }).closest('section')
    const secaoDepois = screen.getByRole('heading', { name: 'Depois' }).closest('section')

    expect(secaoAtrasadas).not.toBeNull()
    expect(secaoHoje).not.toBeNull()
    expect(secaoProximos).not.toBeNull()
    expect(secaoDepois).not.toBeNull()

    expect(secaoAtrasadas!.textContent).toContain('Tarefa atrasada')
    expect(secaoHoje!.textContent).toContain('Tarefa de hoje')
    expect(secaoProximos!.textContent).toContain('Tarefa proxima')
    expect(secaoDepois!.textContent).toContain('Tarefa de depois')
  })

  it('nao renderiza secao sem tarefa', () => {
    const hoje = tarefa({ id: 't-hoje', titulo: 'Tarefa de hoje', venceEm: new Date('2026-08-02T18:00:00Z') })

    render(<Lista tarefas={[hoje]} agora={AGORA} />)

    const cabecalhos = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(cabecalhos).toEqual(['Hoje'])
    expect(screen.queryByRole('heading', { name: 'Atrasadas' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Próximos 7 dias' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Depois' })).toBeNull()
  })

  it('lista vazia mostra o estado vazio', () => {
    render(<Lista tarefas={[]} agora={AGORA} />)

    screen.getByText(/nenhuma tarefa/i)
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
  })

  it('cada linha leva ao lead, com um link para /leads/<id>', () => {
    const t = tarefa({ id: 't-1', leadId: 'lead-42', titulo: 'Tarefa de hoje', venceEm: new Date('2026-08-02T18:00:00Z') })

    render(<Lista tarefas={[t]} agora={AGORA} />)

    const link = screen.getByRole('link', { name: /tarefa de hoje/i })
    expect(link.getAttribute('href')).toBe('/leads/lead-42')
  })

  // Achado minor do review da Task 6: nenhum teste afirmava que cada linha
  // leva um botao "Concluir" — comportamento testavel sem mock nenhum,
  // porque so verifica o que esta na tela, nao o que acontece ao clicar.
  it('cada linha tem um botao Concluir', () => {
    const a = tarefa({ id: 't-a', titulo: 'Tarefa A', venceEm: new Date('2026-08-02T18:00:00Z') })
    const b = tarefa({
      id: 't-b',
      leadId: 'lead-2',
      titulo: 'Tarefa B',
      venceEm: new Date('2026-08-06T12:00:00Z'),
    })

    render(<Lista tarefas={[a, b]} agora={AGORA} />)

    expect(screen.getAllByRole('button', { name: 'Concluir' })).toHaveLength(2)
  })

  // Achado minor do review da Task 6: nenhuma fixture caia exatamente na
  // fronteira de dia civil de America/Sao_Paulo — todas caiam no meio do
  // dia. 2026-08-03T02:00:00Z e' 2 de agosto as 23:00 em SP (UTC-3), ainda o
  // MESMO dia civil de AGORA (2026-08-02T12:00:00Z = 2 de agosto 09:00 SP).
  // Classificar comparando instantes UTC brutos jogaria isso em "Proximos 7
  // dias" (dia seguinte); a regra certa (classificar, lib/domain/tarefa.ts)
  // compara dia civil no fuso e cai em "Hoje". E a classe de defeito que
  // mais mordeu este projeto.
  it('tarefa na fronteira de dia civil de Sao Paulo (23h de hoje em UTC-3) cai em Hoje, nao em Proximos 7 dias', () => {
    const naFronteira = tarefa({
      id: 't-fronteira',
      titulo: 'Tarefa na fronteira do dia civil',
      venceEm: new Date('2026-08-03T02:00:00Z'),
    })

    render(<Lista tarefas={[naFronteira]} agora={AGORA} />)

    const cabecalhos = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(cabecalhos).toEqual(['Hoje'])
    expect(
      screen.getByRole('heading', { name: 'Hoje' }).closest('section')!.textContent,
    ).toContain('Tarefa na fronteira do dia civil')
  })

  // Achado minor do review da Task 6: o retorno antecipado do estado vazio
  // vinha ANTES da renderizacao de `erro`. Concluir a ultima tarefa aberta
  // pelo caminho TAREFA_CONCLUIDA_SEM_EVENTO seta `erro` e revalida
  // /tarefas, que chega de novo com a lista vazia — e a mensagem nunca
  // aparecia. `rerender` com `tarefas=[]` simula exatamente essa revalidacao
  // (mesma instancia de componente, novas props — o que o Next faz de
  // verdade apos revalidatePath + refresh do RSC).
  it('concluir a ultima tarefa por um caminho que so seta erro: a mensagem continua visivel depois que a lista esvazia', async () => {
    concluirTarefaMock.mockResolvedValueOnce({ ok: false, erro: 'tarefa_concluida_sem_evento' })
    const unica = tarefa({ id: 't-unica', titulo: 'Unica tarefa aberta', venceEm: new Date('2026-08-02T18:00:00Z') })

    const { rerender } = render(<Lista tarefas={[unica]} agora={AGORA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))

    expect(await screen.findByText(mensagemDeErroTarefa('tarefa_concluida_sem_evento'))).toBeTruthy()

    rerender(<Lista tarefas={[]} agora={AGORA} />)

    expect(screen.getByText(mensagemDeErroTarefa('tarefa_concluida_sem_evento'))).toBeTruthy()
    screen.getByText(/nenhuma tarefa/i)
  })
})
