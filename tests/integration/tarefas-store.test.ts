import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseTarefaStore } from '@/lib/data/tarefas'
import { comoServico, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, criarLead, etapa, type Cenario } from './helpers/cenario'

/** Insere uma tarefa direto, com controle total sobre vence_em e criado_em —
 * o proprio SupabaseTarefaStore.criar() usa o default now() de criado_em, o
 * que nao serve para montar um empate deliberado. */
async function inserirTarefa(
  leadId: string,
  venceEm: string,
  criadoEm: string,
  titulo = 'Ligar',
): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.tasks (lead_id, titulo, tipo, vence_em, criado_em)
       values ($1, $2, 'ligacao', $3, $4) returning id`,
      [leadId, titulo, venceEm, criadoEm],
    )
    return r.rows[0].id
  })
}

async function lerTarefa(id: string) {
  return comoServico(async (cli) => {
    const r = await cli.query(
      `select id, concluida_em, concluida_por, atualizado_em from public.tasks where id = $1`,
      [id],
    )
    return r.rows[0] as
      | { id: string; concluida_em: string | null; concluida_por: string | null; atualizado_em: string }
      | undefined
  })
}

describe('SupabaseTarefaStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('doLead ordena por prazo, vence_em asc', async () => {
    const leadA = await criarLead(c, 'Lead A', c.vendedorAId, etapa(c, 'Novo lead'))
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseTarefaStore(cliente, c.vendedorAId)

    // Criadas fora de ordem de proposito: a terceira (dia 3) primeiro, a
    // primeira (dia 1) por ultimo.
    const t3 = await store.criar({
      leadId: leadA,
      titulo: 'Terceira',
      tipo: 'outro',
      venceEm: new Date('2026-08-13T12:00:00.000Z'),
    })
    const t1 = await store.criar({
      leadId: leadA,
      titulo: 'Primeira',
      tipo: 'outro',
      venceEm: new Date('2026-08-11T12:00:00.000Z'),
    })
    const t2 = await store.criar({
      leadId: leadA,
      titulo: 'Segunda',
      tipo: 'outro',
      venceEm: new Date('2026-08-12T12:00:00.000Z'),
    })
    if (!t1.ok || !t2.ok || !t3.ok) throw new Error('setup falhou')

    const r = await store.doLead(leadA)
    if (!r.ok) throw new Error(r.erro)
    // Por posicao, nao toContain: e exatamente essa asserção fraca que ja
    // deixou passar empate real de ordenacao neste repo.
    expect(r.valor[0].id).toBe(t1.valor)
    expect(r.valor[1].id).toBe(t2.valor)
    expect(r.valor[2].id).toBe(t3.valor)
    expect(r.valor[0].leadNome).toBe('Lead A')
  })

  it('desempate sob vence_em identico usa criado_em asc, nao a ordem fisica da tabela', async () => {
    const leadA = await criarLead(c, 'Lead A', c.vendedorAId, etapa(c, 'Novo lead'))
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseTarefaStore(cliente, c.vendedorAId)
    const venceEm = '2026-08-20T15:00:00.000Z'

    // Repete algumas vezes para descartar que a ordem fisica das linhas na
    // tabela esteja concordando com criado_em por sorte. Em cada rodada a
    // linha inserida FISICAMENTE PRIMEIRO e' a que deve aparecer DEPOIS no
    // resultado (criado_em mais tarde) — se o codigo dependesse da ordem
    // fisica em vez do ORDER BY criado_em, isso pegaria o erro.
    for (let i = 0; i < 5; i++) {
      const depois = await inserirTarefa(
        leadA,
        venceEm,
        `2026-08-0${i + 1}T10:00:00.000Z`,
        `Depois ${i}`,
      )
      const antes = await inserirTarefa(
        leadA,
        venceEm,
        `2026-08-0${i + 1}T09:00:00.000Z`,
        `Antes ${i}`,
      )

      const r = await store.doLead(leadA)
      if (!r.ok) throw new Error(r.erro)
      const antesIdx = r.valor.findIndex((t) => t.id === antes)
      const depoisIdx = r.valor.findIndex((t) => t.id === depois)
      expect(antesIdx).toBeGreaterThanOrEqual(0)
      expect(depoisIdx).toBeGreaterThanOrEqual(0)
      expect(antesIdx).toBeLessThan(depoisIdx)

      // Limpa para a proxima rodada nao acumular ruido na comparacao.
      await comoServico((cli) => cli.query('delete from public.tasks where lead_id = $1', [leadA]))
    }
  })

  it('minhasAbertas ordena por prazo, vence_em asc, entre leads diferentes do mesmo responsavel', async () => {
    const leadA = await criarLead(c, 'Lead A', c.vendedorAId, etapa(c, 'Novo lead'))
    const leadB = await criarLead(c, 'Lead B', c.vendedorAId, etapa(c, 'Novo lead'))
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseTarefaStore(cliente, c.vendedorAId)

    // Caso 1 (doLead) ja cobre ordenacao dentro de um unico lead; aqui as
    // tres linhas de tasks.order() em minhasAbertas (tarefas.ts:110-112)
    // nunca sao exercitadas por nenhum caso existente, ja que todos devolvem
    // 0 ou 1 linha. Duas leads diferentes, tres tarefas fora de ordem.
    const t3 = await store.criar({
      leadId: leadB,
      titulo: 'Terceira',
      tipo: 'outro',
      venceEm: new Date('2026-08-13T12:00:00.000Z'),
    })
    const t1 = await store.criar({
      leadId: leadA,
      titulo: 'Primeira',
      tipo: 'outro',
      venceEm: new Date('2026-08-11T12:00:00.000Z'),
    })
    const t2 = await store.criar({
      leadId: leadB,
      titulo: 'Segunda',
      tipo: 'outro',
      venceEm: new Date('2026-08-12T12:00:00.000Z'),
    })
    if (!t1.ok || !t2.ok || !t3.ok) throw new Error('setup falhou')

    const r = await store.minhasAbertas(c.vendedorAId)
    if (!r.ok) throw new Error(r.erro)
    // Por posicao, nao toContain — mesma regra do caso 1.
    expect(r.valor).toHaveLength(3)
    expect(r.valor[0].id).toBe(t1.valor)
    expect(r.valor[1].id).toBe(t2.valor)
    expect(r.valor[2].id).toBe(t3.valor)
  })

  it('minhasAbertas do admin nao traz tarefa de lead alheio, mesmo a RLS deixando ver', async () => {
    const leadAdmin = await criarLead(c, 'Lead do admin', c.adminId, etapa(c, 'Novo lead'))
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))

    const clienteAdmin = await clienteDoUsuario(c.adminId)
    const storeAdmin = new SupabaseTarefaStore(clienteAdmin, c.adminId)
    const clienteA = await clienteDoUsuario(c.vendedorAId)
    const storeA = new SupabaseTarefaStore(clienteA, c.vendedorAId)

    const tarefaAdmin = await storeAdmin.criar({
      leadId: leadAdmin,
      titulo: 'Tarefa do admin',
      tipo: 'ligacao',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    const tarefaA = await storeA.criar({
      leadId: leadA,
      titulo: 'Tarefa do A',
      tipo: 'ligacao',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    if (!tarefaAdmin.ok || !tarefaA.ok) throw new Error('setup falhou')

    const r = await storeAdmin.minhasAbertas(c.adminId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0].id).toBe(tarefaAdmin.valor)

    // A RLS por si so deixaria o admin ver as duas — e por isso essa segunda
    // asserção, junto com a primeira, prova que o filtro por responsavel_id
    // existe por cima da RLS: a primeira sozinha passaria mesmo sem o filtro,
    // porque so haveria uma tarefa visivel de qualquer forma. Aqui ha duas
    // visiveis e minhasAbertas ainda assim devolve uma so.
    const { count, error } = await clienteAdmin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
    if (error) throw new Error(error.message)
    expect(count).toBe(2)
  })

  it('minhasAbertas(null) devolve as tarefas de lead sem responsavel', async () => {
    const leadSemDono = await criarLead(c, 'Sem dono', null, etapa(c, 'Novo lead'))
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))

    const clienteAdmin = await clienteDoUsuario(c.adminId)
    const storeAdmin = new SupabaseTarefaStore(clienteAdmin, c.adminId)

    const tarefaSemDono = await storeAdmin.criar({
      leadId: leadSemDono,
      titulo: 'Sem dono',
      tipo: 'outro',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    const tarefaA = await storeAdmin.criar({
      leadId: leadA,
      titulo: 'Do A',
      tipo: 'outro',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    if (!tarefaSemDono.ok || !tarefaA.ok) throw new Error('setup falhou')

    const r = await storeAdmin.minhasAbertas(null)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0].id).toBe(tarefaSemDono.valor)
  })

  it('tarefa concluida nao aparece em minhasAbertas', async () => {
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseTarefaStore(cliente, c.vendedorAId)

    const criada = await store.criar({
      leadId: leadA,
      titulo: 'Vai concluir',
      tipo: 'outro',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    if (!criada.ok) throw new Error('setup falhou')

    const antes = await store.minhasAbertas(c.vendedorAId)
    if (!antes.ok) throw new Error(antes.erro)
    expect(antes.valor).toHaveLength(1)

    const concluiu = await store.concluir(criada.valor)
    expect(concluiu.ok).toBe(true)

    const depois = await store.minhasAbertas(c.vendedorAId)
    if (!depois.ok) throw new Error(depois.erro)
    expect(depois.valor).toEqual([])
  })

  it('concluir carimba concluida_em, concluida_por e atualizado_em; reabrir devolve os dois primeiros a null e tambem avanca atualizado_em', async () => {
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseTarefaStore(cliente, c.vendedorAId)

    const criada = await store.criar({
      leadId: leadA,
      titulo: 'Follow up',
      tipo: 'whatsapp',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    if (!criada.ok) throw new Error('setup falhou')

    // Nao ha trigger de atualizado_em neste repo (por desenho, ver comentario
    // em tarefas.ts) — concluir/reabrir escrevem a coluna na aplicacao, e e
    // exatamente essa escrita que este teste tem que travar. Um `>` estrito
    // contra o valor de criacao arriscaria empatar no mesmo tick do relogio
    // do Postgres se as duas escritas (criar, concluir) caissem no mesmo
    // instante; em vez de afrouxar para `>=` — que passaria mesmo se
    // atualizado_em fosse removido do payload do update, derrotando o
    // proposito do teste —, regride o valor explicitamente para uma data
    // fixa no passado antes de cada escrita sob teste. Assim a comparacao
    // discrimina de verdade e nunca flaca.
    const PASSADO = '2020-01-01T00:00:00.000Z'
    await comoServico((cli) =>
      cli.query('update public.tasks set atualizado_em = $1 where id = $2', [PASSADO, criada.valor]),
    )

    const concluiu = await store.concluir(criada.valor)
    expect(concluiu.ok).toBe(true)

    const linhaConcluida = await lerTarefa(criada.valor)
    expect(linhaConcluida?.concluida_em).not.toBeNull()
    expect(linhaConcluida?.concluida_por).toBe(c.vendedorAId)
    expect(new Date(linhaConcluida!.atualizado_em).getTime()).toBeGreaterThan(
      new Date(PASSADO).getTime(),
    )

    // Regride de novo antes de reabrir, pelo mesmo motivo acima.
    await comoServico((cli) =>
      cli.query('update public.tasks set atualizado_em = $1 where id = $2', [PASSADO, criada.valor]),
    )

    const reabriu = await store.reabrir(criada.valor)
    expect(reabriu.ok).toBe(true)

    const linhaReaberta = await lerTarefa(criada.valor)
    expect(linhaReaberta?.concluida_em).toBeNull()
    expect(linhaReaberta?.concluida_por).toBeNull()
    expect(new Date(linhaReaberta!.atualizado_em).getTime()).toBeGreaterThan(
      new Date(PASSADO).getTime(),
    )
  })

  it('criar com lead fora do alcance falha com lead_nao_encontrado, nunca a mensagem crua do Postgres', async () => {
    const leadB = await criarLead(c, 'Lead do B', c.vendedorBId, etapa(c, 'Novo lead'))
    const clienteA = await clienteDoUsuario(c.vendedorAId)
    const storeA = new SupabaseTarefaStore(clienteA, c.vendedorAId)

    // leadB pertence ao vendedor B: pode_ver_lead_id nega para o vendedor A,
    // e o with check de tasks_insert (0015_tarefas.sql) devolve 42501. E
    // esse SQLSTATE, mapeado por codigoDoErroAoCriarTarefa, que tem que
    // aparecer aqui — nunca a mensagem padrao do PostgREST para negacao de
    // RLS.
    const r = await storeA.criar({
      leadId: leadB,
      titulo: 'Nao deveria criar',
      tipo: 'outro',
      venceEm: new Date('2026-08-15T12:00:00.000Z'),
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('nao deveria ter sucesso')
    expect(r.erro).toBe('lead_nao_encontrado')
  })

  it('excluir uma tarefa de lead fora do alcance falha, e a linha continua existindo', async () => {
    const leadB = await criarLead(c, 'Lead do B', c.vendedorBId, etapa(c, 'Novo lead'))
    const tarefaId = await inserirTarefa(leadB, '2026-08-15T12:00:00.000Z', '2026-08-01T10:00:00.000Z')

    const clienteA = await clienteDoUsuario(c.vendedorAId)
    const storeA = new SupabaseTarefaStore(clienteA, c.vendedorAId)

    const r = await storeA.excluir(tarefaId)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('nao deveria ter sucesso')
    expect(r.erro).toBe('tarefa_nao_encontrada')

    const linha = await lerTarefa(tarefaId)
    expect(linha).toBeDefined()
  })
})
