// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { PainelTarefas } from './tarefas'
import type { Tarefa } from '@/lib/data/tarefas'

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito — o
// repo importa helper de teste explicitamente em todo lugar. Sem o registro
// manual abaixo, o document do jsdom persiste entre os it() deste arquivo e,
// do segundo render() em diante, as consultas acham no velho ou estouram
// "multiple elements found". Copiado de timeline.test.tsx (Task 1).
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

describe('PainelTarefas', () => {
  it('marca a tarefa vencida ontem como atrasada e nao marca a de semana que vem', () => {
    const atrasada = tarefa({
      id: 't-atrasada',
      titulo: 'Follow-up de ontem',
      venceEm: new Date('2026-08-01T12:00:00Z'),
    })
    const futura = tarefa({
      id: 't-futura',
      titulo: 'Reuniao da semana que vem',
      venceEm: new Date('2026-08-08T12:00:00Z'),
    })

    render(<PainelTarefas leadId="lead-1" tarefas={[atrasada, futura]} agora={AGORA} />)

    const itemAtrasado = screen.getByText('Follow-up de ontem').closest('li')
    const itemFuturo = screen.getByText('Reuniao da semana que vem').closest('li')
    expect(itemAtrasado).not.toBeNull()
    expect(itemFuturo).not.toBeNull()
    expect(within(itemAtrasado!).getByText(/atrasada/i)).toBeTruthy()
    expect(within(itemFuturo!).queryByText(/atrasada/i)).toBeNull()
  })

  it('lista tarefas abertas antes das concluidas, e a concluida aparece na secao de concluidas', () => {
    const aberta = tarefa({ id: 't-aberta', titulo: 'Tarefa aberta' })
    const concluida = tarefa({
      id: 't-concluida',
      titulo: 'Tarefa concluida',
      concluidaEm: new Date('2026-08-01T12:00:00Z'),
      concluidaPor: 'user-1',
    })

    render(<PainelTarefas leadId="lead-1" tarefas={[aberta, concluida]} agora={AGORA} />)

    const itens = screen.getAllByRole('listitem')
    const textos = itens.map((i) => i.textContent ?? '')
    const indiceAberta = textos.findIndex((t) => t.includes('Tarefa aberta'))
    const indiceConcluida = textos.findIndex((t) => t.includes('Tarefa concluida'))
    expect(indiceAberta).toBeGreaterThanOrEqual(0)
    expect(indiceConcluida).toBeGreaterThan(indiceAberta)

    const secaoConcluidas = screen.getByRole('heading', { name: /conclu[íi]das/i })
    const listaConcluidas = secaoConcluidas.closest('section')
    expect(listaConcluidas).not.toBeNull()
    expect(within(listaConcluidas!).getByText('Tarefa concluida')).toBeTruthy()
  })

  it('mostra o estado vazio quando nao ha tarefas', () => {
    render(<PainelTarefas leadId="lead-1" tarefas={[]} agora={AGORA} />)

    screen.getByText(/nenhuma tarefa/i)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
