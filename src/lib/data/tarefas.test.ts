import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SupabaseTarefaStore,
  TAREFA_CONCLUIDA_SEM_EVENTO,
} from './tarefas'

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
    expect(estado.eventosInseridos).toHaveLength(1)
    // Unica assercao com valor duravel aqui: o payload snapshot e' o
    // contrato real com a leitura em timeline.tsx:32 (rotuloEvento le
    // payload.titulo). Asserções sobre os argumentos de .update()/.eq()/
    // .select() so reafirmariam a forma da chamada contra um cliente falso
    // que ja ignora a coluna do .eq() e a lista do .select() — nao provam
    // efeito nenhum, so quebrariam em refatoracao legitima.
    expect(estado.eventosInseridos[0]?.payload).toEqual({ titulo: 'Ligar', tipo: 'ligacao' })
  })

  it('quando so o insert do evento falha, a tarefa fica concluida e o codigo nao diz que a conclusao falhou', async () => {
    const { cliente, estado } = clienteFalso({ insertDeEventoFalha: true })
    const store = new SupabaseTarefaStore(cliente, 'user-1')

    const r = await store.concluir('t-1')

    // A tarefa FOI concluida no banco: o update rodou antes do insert falhar.
    // Afirma PRIMEIRO que o update aconteceu — sem `?.`, que deixaria a
    // asserção passar vazia (undefined) se `concluir` nunca tivesse chamado
    // update — e so depois confere os campos, incluindo que concluida_em e'
    // de fato uma string preenchida, nao so "nao-nulo".
    if (estado.tarefaAtualizadaCom === null) {
      throw new Error('o update de tasks nao foi chamado antes do insert do evento falhar')
    }
    expect(typeof estado.tarefaAtualizadaCom.concluida_em).toBe('string')
    expect(estado.tarefaAtualizadaCom.concluida_em).not.toBe('')
    expect(estado.tarefaAtualizadaCom.concluida_por).toBe('user-1')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('nao deveria ter sucesso')
    // Codigo proprio, nunca o generico de escrita: erro_ao_atualizar_tarefa
    // traduz para "Nao foi possivel atualizar a tarefa", que seria falso.
    expect(r.erro).toBe(TAREFA_CONCLUIDA_SEM_EVENTO)
    expect(r.erro).not.toBe('erro_ao_atualizar_tarefa')
    // O store nunca vaza a mensagem crua do Postgres no codigo que devolve.
    // A traducao do codigo para mensagem de usuario (que precisa dizer a
    // verdade, "tarefa concluida", e nunca a string crua do Postgres) e'
    // responsabilidade do mapa de erro, nao do store — testada a parte em
    // src/app/(app)/tarefas/erros.test.ts.
    expect(r.erro).not.toMatch(/row-level security|42501/)
  })
})
