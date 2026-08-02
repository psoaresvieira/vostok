// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Lista } from './lista'
import type { Tarefa } from '@/lib/data/tarefas'

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito.
// Sem o registro manual abaixo, o document do jsdom persiste entre os it()
// deste arquivo e, do segundo render() em diante, as consultas acham o velho
// ou estouram "multiple elements found". Copiado de tarefas.test.tsx (Task 5).
afterEach(cleanup)

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

    render(<Lista tarefas={[atrasada, hoje, proxima, depois]} agora={AGORA} />)

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
})
