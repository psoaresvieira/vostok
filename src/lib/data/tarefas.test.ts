import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SupabaseTarefaStore,
  TAREFA_CONCLUIDA_SEM_EVENTO,
} from './tarefas'
import { mensagemDeErroTarefa } from '@/app/(app)/tarefas/erros'

type LinhaAtualizada = Record<string, unknown>

/**
 * Cliente Postgrest falso, so com a fatia de cadeia que concluir() usa:
 * from('tasks').update(...).eq(...).select(...) e from('lead_events').insert(...).
 * Existe para forcar a falha do insert do evento, que e o unico jeito de
 * exercitar o caminho "tarefa concluida, timeline nao" sem Docker — o teste de
 * integracao (tests/integration/tarefas-store.test.ts) nao consegue fazer o
 * insert em lead_events falhar sem mexer em policy.
 */
function clienteFalso(opcoes: { insertDeEventoFalha: boolean }) {
  const estado = {
    tarefaAtualizadaCom: null as LinhaAtualizada | null,
    eventosInseridos: [] as LinhaAtualizada[],
  }

  const cliente = {
    from(tabela: string) {
      if (tabela === 'tasks') {
        return {
          update(valores: LinhaAtualizada) {
            estado.tarefaAtualizadaCom = valores
            return {
              eq(_coluna: string, valor: string) {
                void _coluna
                return {
                  select(_colunas: string) {
                    void _colunas
                    return Promise.resolve({
                      data: [
                        { id: valor, lead_id: 'lead-1', titulo: 'Ligar', tipo: 'ligacao' },
                      ],
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }
      if (tabela === 'lead_events') {
        return {
          insert(linha: LinhaAtualizada) {
            if (opcoes.insertDeEventoFalha) {
              return Promise.resolve({
                // Mensagem crua do Postgres de proposito: o teste prova que ela
                // nunca chega a viajar para fora do store.
                error: {
                  code: '42501',
                  message: 'new row violates row-level security policy for table "lead_events"',
                },
              })
            }
            estado.eventosInseridos.push(linha)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`tabela inesperada no cliente falso: ${tabela}`)
    },
  }

  return { cliente: cliente as unknown as SupabaseClient, estado }
}

describe('SupabaseTarefaStore.concluir', () => {
  it('conclui a tarefa e escreve o evento de timeline com o snapshot do titulo', async () => {
    const { cliente, estado } = clienteFalso({ insertDeEventoFalha: false })
    const store = new SupabaseTarefaStore(cliente, 'user-1')

    const r = await store.concluir('t-1')

    expect(r.ok).toBe(true)
    expect(estado.tarefaAtualizadaCom?.concluida_por).toBe('user-1')
    expect(estado.tarefaAtualizadaCom?.concluida_em).not.toBeNull()
    expect(estado.eventosInseridos).toHaveLength(1)
    expect(estado.eventosInseridos[0]).toMatchObject({
      lead_id: 'lead-1',
      tipo: 'tarefa_concluida',
      payload: { titulo: 'Ligar', tipo: 'ligacao' },
      ator_id: 'user-1',
    })
  })

  it('quando so o insert do evento falha, a tarefa fica concluida e o codigo nao diz que a conclusao falhou', async () => {
    const { cliente, estado } = clienteFalso({ insertDeEventoFalha: true })
    const store = new SupabaseTarefaStore(cliente, 'user-1')

    const r = await store.concluir('t-1')

    // A tarefa FOI concluida no banco: o update rodou antes do insert falhar.
    expect(estado.tarefaAtualizadaCom?.concluida_em).not.toBeNull()
    expect(estado.tarefaAtualizadaCom?.concluida_por).toBe('user-1')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('nao deveria ter sucesso')
    // Codigo proprio, nunca o generico de escrita: erro_ao_atualizar_tarefa
    // traduz para "Nao foi possivel atualizar a tarefa", que seria falso.
    expect(r.erro).toBe(TAREFA_CONCLUIDA_SEM_EVENTO)
    expect(r.erro).not.toBe('erro_ao_atualizar_tarefa')

    const mensagem = mensagemDeErroTarefa(r.erro)
    // A mensagem tem que dizer a verdade: a tarefa foi concluida.
    expect(mensagem).toMatch(/conclu[íi]da/i)
    expect(mensagem).not.toMatch(/n[ãa]o foi poss[íi]vel atualizar/i)
    // E nunca a mensagem crua do Postgres.
    expect(mensagem).not.toMatch(/row-level security|42501/)
    // O codigo tambem tem que estar no mapa, e nao cair no fallback que
    // devolve o proprio codigo.
    expect(mensagem).not.toBe(r.erro)
  })
})
