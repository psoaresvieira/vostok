import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseEtapaStore } from '@/lib/data/etapas'
import {
  abrirSessaoUsuario,
  comoServico,
  comoUsuario,
  criarUsuario,
  esperarBloqueioEm,
  limparBanco,
} from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

/**
 * Task 2 do Plano 15: estes casos MUDARAM de admin-store.test.ts para ca —
 * mesmo comportamento de banco (RPCs e RLS da migration 0026, ja mergeada),
 * so' que agora encenados por VENDEDOR onde antes exigiam admin. A mudanca de
 * papel e' o proprio ponto do plano: qualquer membro gerencia etapas.
 */

/** Segunda conta, so para ter um id de etapa (e o pipeline dela) que a conta
 * do cenario nao enxerga — mesmo padrao de `outraConta` em
 * pipelines-store.test.ts. */
async function outraConta(email: string): Promise<{ etapaId: string; pipelineId: string }> {
  const userId = await criarUsuario(email)
  const accountId = await comoUsuario(
    userId,
    async (c) =>
      (await c.query<{ id: string }>('select public.criar_conta($1) as id', ['Outra'])).rows[0]
        .id,
  )
  const { etapaId, pipelineId } = await comoServico(async (cli) => {
    const r = await cli.query<{ id: string; pipeline_id: string }>(
      `select s.id, s.pipeline_id from public.stages s
       join public.pipelines p on p.id = s.pipeline_id
       where p.account_id = $1 order by s.ordem limit 1`,
      [accountId],
    )
    return { etapaId: r.rows[0].id, pipelineId: r.rows[0].pipeline_id }
  })
  return { etapaId, pipelineId }
}

describe('SupabaseEtapaStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('vendedor cria etapa no fim do funil', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)

    const r = await etapas.criarEtapa('Negociação', 'aberta')
    if (!r.ok) throw new Error(r.erro)

    const { total, criada, maiorOrdem } = await comoServico(async (cli) => {
      const t = await cli.query(
        'select count(*)::int as n, max(ordem)::int as maior from public.stages where pipeline_id = $1',
        [c.pipelineId],
      )
      const e = await cli.query(
        'select nome, tipo, ordem from public.stages where id = $1',
        [r.valor],
      )
      return { total: t.rows[0].n, maiorOrdem: t.rows[0].maior, criada: e.rows[0] }
    })
    expect(total).toBe(8)
    expect(criada.nome).toBe('Negociação')
    expect(criada.tipo).toBe('aberta')
    // "no fim do funil": nenhuma etapa fica depois dela
    expect(criada.ordem).toBe(maiorOrdem)
    expect(criada.ordem).toBe(8)
  })

  it('vendedor reordena etapas sem violar o indice unico de ordem', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const invertida = [...c.etapas].reverse().map((e) => e.id)

    const r = await etapas.reordenarEtapas(invertida)
    expect(r.ok).toBe(true)

    const linhas = await comoServico(async (cli) =>
      (
        await cli.query(
          'select nome, ordem from public.stages where pipeline_id = $1 order by ordem',
          [c.pipelineId],
        )
      ).rows,
    )
    const nomes = linhas.map((x) => x.nome)
    expect(nomes[0]).toBe('Perdido')
    expect(nomes[6]).toBe('Novo lead')
    expect(nomes).toEqual([...c.etapas].reverse().map((e) => e.nome))
    // a ordem tem que voltar compacta: linha parada na faixa de estacionamento
    // (1000+) passaria despercebida se so olhassemos os nomes.
    expect(linhas.map((x) => x.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('vendedor: lista que nao e permutacao exata e recusada sem mexer na ordem', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const ids = c.etapas.map((e) => e.id)
    const ordemOriginal = async () =>
      comoServico(async (cli) =>
        (
          await cli.query(
            'select nome, ordem from public.stages where pipeline_id = $1 order by ordem',
            [c.pipelineId],
          )
        ).rows,
      )
    const antes = await ordemOriginal()

    const parcial = await etapas.reordenarEtapas([ids[6], ids[5]])
    expect(parcial.ok).toBe(false)
    if (!parcial.ok) expect(parcial.erro).toBe('ordem_invalida')

    const repetida = await etapas.reordenarEtapas([ids[0], ids[0], ...ids.slice(1, 6)])
    expect(repetida.ok).toBe(false)
    if (!repetida.ok) expect(repetida.erro).toBe('ordem_invalida')

    const deOutroFunil = await etapas.reordenarEtapas([
      ...ids.slice(1),
      '00000000-0000-0000-0000-000000000001',
    ])
    expect(deOutroFunil.ok).toBe(false)
    if (!deOutroFunil.ok) expect(deOutroFunil.erro).toBe('ordem_invalida')

    // nada escrito: nem posicao trocada, nem linha estacionada em 1000+
    expect(await ordemOriginal()).toEqual(antes)

    // e a reordenacao legitima seguinte continua funcionando
    const valida = await etapas.reordenarEtapas([...ids].reverse())
    expect(valida.ok).toBe(true)
  })

  it('vendedor exclui etapa vazia: devolve ok e a etapa some', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const proposta = etapa(c, 'Proposta')

    const r = await etapas.excluirEtapa(proposta)
    expect(r.ok).toBe(true)

    const existe = await comoServico(
      async (cli) =>
        (await cli.query('select 1 from public.stages where id = $1', [proposta])).rowCount,
    )
    expect(existe).toBe(0)
  })

  it('vendedor exclui etapa com lead dentro: devolve falha etapa_tem_leads', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const contato = etapa(c, 'Contato feito')
    await criarLead(c, 'Lead preso', c.vendedorAId, contato)

    const r = await etapas.excluirEtapa(contato)
    expect(r.ok).toBe(false)
    // codigo conhecido, nao a mensagem crua do Postgres
    if (!r.ok) expect(r.erro).toBe('etapa_tem_leads')
  })

  it('vendedor exclui etapa com lead SO de colega: devolve etapa_tem_leads pela guarda definer, nao pela FK', async () => {
    // Evolucao do caso 168 de admin-store.test.ts: antes de 0026 a guarda 1
    // de excluir_etapa contava leads sob a RLS do CHAMADOR — vendedorA nao
    // enxerga lead cujo responsavel e' vendedorB (leads_select restringe
    // vendedor a responsavel_id = auth.uid()), entao a contagem local dava
    // zero e a recusa so' vinha depois, da FK 23503 crua. Desde a 0026 a
    // guarda 1 usa o helper security definer etapa_tem_leads, que ve TODOS os
    // leads da conta independente de quem chama — a excecao nomeada
    // etapa_tem_leads vem direto da RPC, e excluirEtapa so' precisa traduzir
    // o texto (nao mais o SQLSTATE 23503). Fica vermelho se excluirEtapa
    // parar de traduzir OU se a RPC regredir para contagem local.
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const contato = etapa(c, 'Contato feito')
    await criarLead(c, 'Lead do colega', c.vendedorBId, contato)

    const r = await etapas.excluirEtapa(contato)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toBe('etapa_tem_leads')

    const existe = await comoServico(
      async (cli) =>
        (await cli.query('select 1 from public.stages where id = $1', [contato])).rowCount,
    )
    expect(existe).toBe(1)
  })

  it('vendedor exclui a ultima etapa do tipo ganho: devolve falha ultima_etapa_do_tipo', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const ganho = etapa(c, 'Ganho')

    const r = await etapas.excluirEtapa(ganho)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toBe('ultima_etapa_do_tipo')
  })

  it('resumoEtapas por vendedor conta leads parados e passantes, inclusive do colega', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const novo = etapa(c, 'Novo lead')
    const contato = etapa(c, 'Contato feito')
    const qualificacao = etapa(c, 'Qualificação')

    // Lead do COLEGA (vendedorB) fica parado em "Contato feito" — move quem
    // e' dono, ja que a RLS de update tambem restringe vendedor ao proprio
    // responsavel_id. resumo_etapas e' security definer (migration 0026):
    // vendedorA, que nem enxerga este lead via leads_select, tem que ver a
    // contagem dele no resumo mesmo assim — e o que discrimina o definer
    // nesta camada.
    const parado = await criarLead(c, 'Lead parado do colega', c.vendedorBId, novo)
    await comoUsuario(c.vendedorBId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [parado, contato]),
    )

    // Lead 2, do proprio vendedorA, passa por "Contato feito" e segue ate
    // "Qualificacao".
    const passante = await criarLead(c, 'Lead passante', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [passante, contato]),
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [passante, qualificacao]),
    )

    const r = await etapas.resumoEtapas()
    if (!r.ok) throw new Error(r.erro)

    const doContato = r.valor.find((x) => x.etapaId === contato)
    expect(doContato).toEqual({ etapaId: contato, leadsNaEtapa: 1, leadsPassaram: 2 })
  })

  it('mutacao em etapa de outra conta responde o codigo de "nao existe", nao sucesso', async () => {
    const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)
    const { etapaId: etapaDeFora } = await outraConta('vendedor@outra-etapas.com')

    const renomeada = await etapas.renomearEtapa(etapaDeFora, 'Invadida')
    expect(renomeada.ok).toBe(false)
    if (!renomeada.ok) expect(renomeada.erro).toBe('nao_encontrado')

    const excluida = await etapas.excluirEtapa(etapaDeFora)
    expect(excluida.ok).toBe(false)
    if (!excluida.ok) expect(excluida.erro).toBe('etapa_nao_encontrada')

    // e a etapa de fora continua intacta
    const intacta = await comoServico(
      async (cli) =>
        (await cli.query('select nome from public.stages where id = $1', [etapaDeFora])).rows[0]
          .nome,
    )
    expect(intacta).toBe('Novo lead')
  })

  /**
   * Emenda pos-review-final: criarEtapa era o unico dos cinco metodos que
   * devolvia `falha(error.message)` cru. Os dois casos abaixo sao os SQLSTATEs
   * que a tela nova (todo membro, toda pipeline, abas concorrentes) alcanca —
   * ambos encenados com uma segunda sessao de transacao aberta, porque em
   * ambos o erro so' existe DURANTE a corrida: resolvida a corrida, o mesmo
   * caminho devolve outra coisa.
   */
  describe('criarEtapa traduz o SQLSTATE em vez de vazar a mensagem do Postgres', () => {
    it('pipeline apagada em outra aba no meio do insert: nao_encontrado, nao a mensagem da FK', async () => {
      // A pipeline tem que sumir DEPOIS que o `with check` da RLS a enxergou e
      // ANTES da checagem da FK — e' o unico arranjo que produz 23503. Com o
      // delete ja commitado a recusa vem antes, do proprio `with check`
      // (42501), e nunca chega na FK.
      const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query<{ id: string }>(
          `insert into public.pipelines (account_id, nome, is_default)
           values ($1, 'Funil recem-criado', false) returning id`,
          [c.accountId],
        )
        return r.rows[0].id
      })
      const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), pipelineId)

      const outraAba = await abrirSessaoUsuario(c.vendedorAId)
      try {
        await outraAba.cliente.query('delete from public.pipelines where id = $1', [pipelineId])

        // Sem await: o insert do store precisa ficar PENDURADO no lock da
        // linha de pipelines que a outra aba esta apagando.
        const pendente = etapas.criarEtapa('Negociação', 'aberta')
        await esperarBloqueioEm('stages')
        await outraAba.encerrar('commit')

        const r = await pendente
        expect(r.ok).toBe(false)
        if (!r.ok) {
          expect(r.erro).toBe('nao_encontrado')
          // a mensagem crua do Postgres nunca pode chegar na tela
          expect(r.erro).not.toContain('foreign key')
        }
      } finally {
        await outraAba.encerrar('rollback')
      }
    })

    it('dois membros adicionando ao mesmo tempo colidem na ordem: ordem_invalida, nao "duplicate key"', async () => {
      const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), c.pipelineId)

      const colega = await abrirSessaoUsuario(c.vendedorBId)
      try {
        // O colega grava a etapa dele em max+1 e NAO commita: a linha existe
        // para o indice unico, mas e' invisivel para a leitura de max do
        // store — que por isso mira exatamente a mesma ordem.
        await colega.cliente.query(
          `insert into public.stages (pipeline_id, nome, tipo, ordem)
           select $1, 'Do colega', 'aberta', coalesce(max(ordem), 0) + 1
             from public.stages where pipeline_id = $1`,
          [c.pipelineId],
        )

        const pendente = etapas.criarEtapa('Negociação', 'aberta')
        await esperarBloqueioEm('stages')
        await colega.encerrar('commit')

        const r = await pendente
        expect(r.ok).toBe(false)
        if (!r.ok) {
          expect(r.erro).toBe('ordem_invalida')
          expect(r.erro).not.toContain('duplicate key')
        }
      } finally {
        await colega.encerrar('rollback')
      }

      // e a etapa do colega, que ganhou a corrida, ficou inteira
      const doColega = await comoServico(
        async (cli) =>
          (
            await cli.query(
              `select ordem from public.stages where pipeline_id = $1 and nome = 'Do colega'`,
              [c.pipelineId],
            )
          ).rows[0]?.ordem,
      )
      expect(doColega).toBe(8)
    })

    /**
     * Terceira emenda (Task 2, plano 2026-08-17): o caso acima (23503) so
     * acontece DURANTE a corrida — pipeline ainda visivel no `with check`,
     * apagada so' depois, na checagem da FK. Com o delete ja COMMITADO antes
     * do insert comecar, a recusa vem antes: o proprio `with check` da RLS
     * (is_member_of(conta_do_pipeline(id-morto)) = false) nunca deixa a
     * linha entrar, e o Postgres estoura 42501 com a mensagem crua "new row
     * violates row-level security policy for table \"stages\"". O mesmo
     * caminho cobre um pipelineId forjado de outra conta — o segundo caso
     * abaixo.
     */
    it('pipeline excluida (commit) antes do insert: nao_encontrado, nao a mensagem crua da RLS', async () => {
      const pipelineId = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query<{ id: string }>(
          `insert into public.pipelines (account_id, nome, is_default)
           values ($1, 'Funil efemero', false) returning id`,
          [c.accountId],
        )
        return r.rows[0].id
      })
      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query('delete from public.pipelines where id = $1', [pipelineId]),
      )

      const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), pipelineId)
      const r = await etapas.criarEtapa('Negociação', 'aberta')

      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.erro).toBe('nao_encontrado')
        // a mensagem crua da RLS nunca pode chegar na tela
        expect(r.erro).not.toMatch(/row-level security/)
      }
    })

    it('pipelineId de outra conta: nao_encontrado, nao a mensagem crua da RLS (fail-closed)', async () => {
      const { pipelineId: pipelineDeFora } = await outraConta('vendedor@outra-criar-etapa.com')

      const etapas = new SupabaseEtapaStore(await clienteDoUsuario(c.vendedorAId), pipelineDeFora)
      const r = await etapas.criarEtapa('Negociação', 'aberta')

      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.erro).toBe('nao_encontrado')
        expect(r.erro).not.toMatch(/row-level security/)
      }
    })
  })
})
