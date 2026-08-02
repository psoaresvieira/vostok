import { describe, it, expect } from 'vitest'
import { mensagemDeErroTarefa } from './erros'
import { TAREFA_CONCLUIDA_SEM_EVENTO } from '@/lib/data/tarefas'

describe('mensagemDeErroTarefa', () => {
  it('tarefa_concluida_sem_evento traduz dizendo a verdade: a tarefa foi concluida', () => {
    // Movido de src/lib/data/tarefas.test.ts (Minor 6 da re-revisao da Task
    // 5): a traducao do codigo para mensagem de usuario e' responsabilidade
    // deste mapa, nao do store — o teste do store afirma sobre o codigo que
    // ele devolve, nao sobre a string que a tela mostra.
    const mensagem = mensagemDeErroTarefa(TAREFA_CONCLUIDA_SEM_EVENTO)
    // A mensagem tem que dizer a verdade: a tarefa foi concluida.
    expect(mensagem).toMatch(/conclu[íi]da/i)
    expect(mensagem).not.toMatch(/n[ãa]o foi poss[íi]vel atualizar/i)
    // E nunca a mensagem crua do Postgres.
    expect(mensagem).not.toMatch(/row-level security|42501/)
    // O codigo tem que estar no mapa, e nao cair no fallback que devolve o
    // proprio codigo.
    expect(mensagem).not.toBe(TAREFA_CONCLUIDA_SEM_EVENTO)
  })

  it('codigo desconhecido cai no fallback que devolve o proprio codigo', () => {
    expect(mensagemDeErroTarefa('codigo_que_nao_existe')).toBe('codigo_que_nao_existe')
  })
})
