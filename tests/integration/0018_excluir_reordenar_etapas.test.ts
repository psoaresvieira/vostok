import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

/**
 * Uma segunda conta com admin proprio, sem pipeline — o padrao do 0008 para
 * os casos de isolamento. Os casos 5 e 10 nao precisam de etapas na conta B:
 * o que importa e que o admin B nao enxerga (e nao pode agir sobre) as
 * etapas da conta A.
 */
async function segundaConta(nome: string, email: string): Promise<{ adminId: string }> {
  return comoServico(async (cli) => {
    const u = await cli.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id`,
      [email],
    )
    await cli.query(
      `insert into public.profiles (id, nome, email) values ($1, 'Admin', $2)
       on conflict (id) do nothing`,
      [u.rows[0].id, email],
    )
    const a = await cli.query<{ id: string }>(
      `insert into public.accounts (nome) values ($1) returning id`,
      [nome],
    )
    await cli.query(
      `insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'admin')`,
      [a.rows[0].id, u.rows[0].id],
    )
    return { adminId: u.rows[0].id }
  })
}

/** Etapa descartavel, criada "pelo servico" (sem RLS), fora do 1..7 do seed. */
async function criarEtapaDescartavel(c: Cenario): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.stages (pipeline_id, nome, ordem, tipo)
       values ($1, 'Descartavel', 50, 'aberta') returning id`,
      [c.pipelineId],
    )
    return r.rows[0].id
  })
}

async function stageExiste(stageId: string): Promise<boolean> {
  return comoServico(async (cli) => {
    const r = await cli.query('select 1 from public.stages where id = $1', [stageId])
    return (r.rowCount ?? 0) > 0
  })
}

async function ordensDoPipeline(pipelineId: string): Promise<Map<string, number>> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string; ordem: number }>(
      'select id, ordem from public.stages where pipeline_id = $1',
      [pipelineId],
    )
    return new Map(r.rows.map((row) => [row.id, row.ordem]))
  })
}

describe('0018 — excluir_etapa, reordenar_etapas e resumo_etapas', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  describe('excluir_etapa', () => {
    it('Caso 1: admin exclui etapa vazia e ela some', async () => {
      const stageId = await criarEtapaDescartavel(c)

      await comoUsuario(c.adminId, (cli) =>
        cli.query('select public.excluir_etapa($1)', [stageId]),
      )

      expect(await stageExiste(stageId)).toBe(false)
    })

    it('Caso 2: etapa com lead dentro e recusada com etapa_tem_leads — e continua existindo', async () => {
      const contato = etapa(c, 'Contato feito')
      await criarLead(c, 'Lead preso', c.vendedorAId, contato)

      await expect(
        comoUsuario(c.adminId, (cli) => cli.query('select public.excluir_etapa($1)', [contato])),
      ).rejects.toThrow(/etapa_tem_leads/)

      expect(await stageExiste(contato)).toBe(true)
    })

    it('Caso 3: a ultima etapa de um tipo e recusada com ultima_etapa_do_tipo', async () => {
      // "Ganho" e a unica etapa do tipo 'ganho' no pipeline padrao, e nao tem
      // lead nenhum — se a guarda de leads fosse a unica, este caso passaria
      // batido; e a guarda de tipo que tem que barrar.
      const ganho = etapa(c, 'Ganho')

      await expect(
        comoUsuario(c.adminId, (cli) => cli.query('select public.excluir_etapa($1)', [ganho])),
      ).rejects.toThrow(/ultima_etapa_do_tipo/)

      expect(await stageExiste(ganho)).toBe(true)
    })

    it('Caso 4: vendedor e recusado com sem_permissao — a mesma chamada que funciona para o admin', async () => {
      const stageId = await criarEtapaDescartavel(c)

      await expect(
        comoUsuario(c.vendedorAId, (cli) => cli.query('select public.excluir_etapa($1)', [stageId])),
      ).rejects.toThrow(/sem_permissao/)
      expect(await stageExiste(stageId)).toBe(true)

      await comoUsuario(c.adminId, (cli) =>
        cli.query('select public.excluir_etapa($1)', [stageId]),
      )
      expect(await stageExiste(stageId)).toBe(false)
    })

    it('Caso 5: admin de outra conta recebe etapa_nao_encontrada — nao "sem permissao"', async () => {
      const stageId = await criarEtapaDescartavel(c)
      const outra = await segundaConta('Conta B', 'admin-b-5@b.com')

      await expect(
        comoUsuario(outra.adminId, (cli) => cli.query('select public.excluir_etapa($1)', [stageId])),
      ).rejects.toThrow(/etapa_nao_encontrada/)

      // A RLS escondeu a linha do admin B; ela nunca chegou a ser tocada.
      expect(await stageExiste(stageId)).toBe(true)
    })
  })

  describe('reordenar_etapas', () => {
    it('Caso 6: permutacao valida aplica a ordem — pipeline continua com ordens 1..n distintas', async () => {
      const idsOriginais = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      // Inverte as duas primeiras posicoes.
      const novaOrdem = [idsOriginais[1], idsOriginais[0], ...idsOriginais.slice(2)]

      await comoUsuario(c.adminId, (cli) =>
        cli.query('select public.reordenar_etapas($1::uuid[])', [novaOrdem]),
      )

      const ordens = await ordensDoPipeline(c.pipelineId)
      expect(ordens.get(idsOriginais[1])).toBe(1)
      expect(ordens.get(idsOriginais[0])).toBe(2)
      for (let i = 2; i < idsOriginais.length; i++) {
        expect(ordens.get(idsOriginais[i])).toBe(i + 1)
      }
      const valores = [...ordens.values()].sort((a, b) => a - b)
      expect(valores).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it('Caso 7: lista parcial e recusada com ordem_invalida e nenhuma ordem muda', async () => {
      const antes = await ordensDoPipeline(c.pipelineId)
      const idsOriginais = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      const parcial = idsOriginais.slice(0, 3)

      await expect(
        comoUsuario(c.adminId, (cli) =>
          cli.query('select public.reordenar_etapas($1::uuid[])', [parcial]),
        ),
      ).rejects.toThrow(/ordem_invalida/)

      const depois = await ordensDoPipeline(c.pipelineId)
      expect(depois).toEqual(antes)
      // A prova de que a divida antiga (JS em duas fases) foi paga: nenhuma
      // ordem ficou presa na faixa alta usada como intermediaria pela funcao.
      for (const ordem of depois.values()) {
        expect(ordem).toBeLessThan(1000)
      }
    })

    it('Caso 8: id repetido e recusado com ordem_invalida', async () => {
      const antes = await ordensDoPipeline(c.pipelineId)
      const idsOriginais = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      // 7 posicoes, mas com um id repetido no lugar de outro — nao e permutacao.
      const comRepetido = [...idsOriginais.slice(0, 6), idsOriginais[0]]

      await expect(
        comoUsuario(c.adminId, (cli) =>
          cli.query('select public.reordenar_etapas($1::uuid[])', [comRepetido]),
        ),
      ).rejects.toThrow(/ordem_invalida/)

      const depois = await ordensDoPipeline(c.pipelineId)
      expect(depois).toEqual(antes)
    })

    it('Caso 9: vendedor e recusado com sem_permissao', async () => {
      const antes = await ordensDoPipeline(c.pipelineId)
      const idsOriginais = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      const novaOrdem = [idsOriginais[1], idsOriginais[0], ...idsOriginais.slice(2)]

      await expect(
        comoUsuario(c.vendedorAId, (cli) =>
          cli.query('select public.reordenar_etapas($1::uuid[])', [novaOrdem]),
        ),
      ).rejects.toThrow(/sem_permissao/)

      const depois = await ordensDoPipeline(c.pipelineId)
      expect(depois).toEqual(antes)
    })

    it('Caso 10: ids de outra conta sao recusados com ordem_invalida', async () => {
      const outra = await segundaConta('Conta C', 'admin-c-10@c.com')
      const idsDaContaA = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      const antes = await ordensDoPipeline(c.pipelineId)

      await expect(
        comoUsuario(outra.adminId, (cli) =>
          cli.query('select public.reordenar_etapas($1::uuid[])', [idsDaContaA]),
        ),
      ).rejects.toThrow(/ordem_invalida/)

      const depois = await ordensDoPipeline(c.pipelineId)
      expect(depois).toEqual(antes)
    })

    it('Caso 13: lista mista — reais mais um id estranho no lugar de um real — e recusada com ordem_invalida e nenhuma ordem muda', async () => {
      // Seis ids reais e um uuid inventado no lugar do setimo. As tres
      // contagens de tamanho (v_total, v_distintos) fechariam sozinhas — e a
      // funcao aplicaria uma ordem que nao corresponde a lista pedida, ou
      // estouraria 23505 cru no indice unico — se nao houver uma checagem
      // extra de que CADA id resolve para uma etapa deste pipeline.
      const antes = await ordensDoPipeline(c.pipelineId)
      const idsOriginais = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      const misturada = [
        ...idsOriginais.slice(0, 6),
        '00000000-0000-0000-0000-000000000000',
      ]

      await expect(
        comoUsuario(c.adminId, (cli) =>
          cli.query('select public.reordenar_etapas($1::uuid[])', [misturada]),
        ),
      ).rejects.toThrow(/ordem_invalida/)

      const depois = await ordensDoPipeline(c.pipelineId)
      expect(depois).toEqual(antes)
    })
  })

  describe('resumo_etapas', () => {
    it('Caso 11: as contagens contam o que dizem contar', async () => {
      const novo = etapa(c, 'Novo lead')
      const contato = etapa(c, 'Contato feito')
      const qualificacao = etapa(c, 'Qualificação')

      // Lead 1 fica parado em "Contato feito".
      await criarLead(c, 'Lead parado', c.vendedorAId, novo)
      const parado = await criarLead(c, 'Lead parado 2', c.vendedorAId, novo)
      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [parado, contato]),
      )

      // Lead 2 passa por "Contato feito" e segue adiante ate "Qualificacao".
      const passante = await criarLead(c, 'Lead passante', c.vendedorAId, novo)
      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [passante, contato]),
      )
      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [passante, qualificacao]),
      )

      const linhas = await comoUsuario(c.adminId, async (cli) => {
        const r = await cli.query<{
          stage_id: string
          leads_na_etapa: string
          leads_passaram: string
        }>('select * from public.resumo_etapas($1)', [c.pipelineId])
        return r.rows
      })

      const doContato = linhas.find((l) => l.stage_id === contato)
      expect(doContato).toBeDefined()
      expect(Number(doContato!.leads_na_etapa)).toBe(1)
      expect(Number(doContato!.leads_passaram)).toBe(2)

      const naoUsada = etapa(c, 'Proposta')
      const daNaoUsada = linhas.find((l) => l.stage_id === naoUsada)
      expect(daNaoUsada).toBeDefined()
      expect(Number(daNaoUsada!.leads_na_etapa)).toBe(0)
      expect(Number(daNaoUsada!.leads_passaram)).toBe(0)
    })
  })

  describe('prosecdef', () => {
    it('Caso 12: as tres funcoes sao security invoker (prosecdef = false)', async () => {
      const linhas = await comoServico(async (cli) => {
        const r = await cli.query<{ proname: string; prosecdef: boolean }>(
          `select proname, prosecdef from pg_proc
            where proname in ('excluir_etapa', 'reordenar_etapas', 'resumo_etapas')`,
        )
        return r.rows
      })
      expect(linhas).toHaveLength(3)
      for (const linha of linhas) {
        expect(linha.prosecdef).toBe(false)
      }
    })
  })
})
