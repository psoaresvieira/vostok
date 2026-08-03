// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { PainelTarefas } from './tarefas'
import { mensagemDeErroTarefa } from '@/app/(app)/tarefas/erros'
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

  it('prazo invalido mostra a mensagem de prazo e nao deixa o botao travado', async () => {
    // O modo de falha que este teste tranca: a conversao do prazo acontecia
    // com `new Date(prazo).toISOString()` DENTRO do argumento de criarTarefa,
    // fora do try do chamarAcao. Prazo invalido lancava RangeError ali, o
    // setErro/setEnviando(false) nunca rodavam e o botao ficava disabled para
    // sempre — a tela muda que a regra do chamarAcao existe para impedir.
    render(<PainelTarefas leadId="lead-1" tarefas={[]} agora={AGORA} />)

    fireEvent.change(screen.getByPlaceholderText(/t[íi]tulo da tarefa/i), {
      target: { value: 'Ligar para o cliente' },
    })
    const botao = screen.getByRole('button', { name: /criar tarefa/i }) as HTMLButtonElement
    // Prazo vazio. O jsdom aplica a mesma sanitizacao de valor que o browser
    // real faz em <input type="datetime-local">: qualquer string que nao seja
    // um datetime local valido vira '' (conferido: '2026-02-31T10:00' e
    // 'lixo total' viram os dois ''). Entao a string vazia e a UNICA entrada
    // invalida que da para injetar por aqui — e e tambem a que chega de um
    // browser sem suporte a datetime-local, onde o campo degrada para texto
    // livre. Nenhuma Server Action chega a ser chamada; a validacao do cliente
    // e conveniencia, a borda de verdade continua sendo criarTarefa no servidor.
    fireEvent.click(botao)

    expect(await screen.findByText(mensagemDeErroTarefa('prazo_invalido'))).toBeTruthy()
    expect(botao.disabled).toBe(false)
  })
})
