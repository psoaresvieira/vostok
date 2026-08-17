import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

/**
 * Plano 15: gestao de etapas por membro + hardening da RLS de stages.
 *
 * A 0025 abriu a escrita de stages a qualquer membro com uma policy `for all`
 * sem guardas — pelo PostgREST cru um membro apagava a ultima etapa de um tipo
 * ou trocava `tipo`/`pipeline_id` de uma etapa. A 0026 poe esses invariantes na
 * propria RLS (via helpers definer) e abre `excluir_etapa`/`reordenar_etapas` a
 * qualquer membro, com os mesmos erros nomeados de antes.
 *
 * Dois eixos aparecem em quase todo caso daqui: (a) a guarda tem que valer no
 * caminho CRU (PostgREST direto), nao so dentro da RPC; (b) as guardas que
 * contam leads tem que enxergar leads de COLEGAS — sob a RLS do vendedor a
 * contagem mentiria.
 */

/**
 * Segunda conta com admin proprio, no padrao do 0018: o que importa e que o
 * admin B nao enxerga nem age sobre a conta A.
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

async function linhaDaEtapa(
  stageId: string,
): Promise<{ nome: string; tipo: string; pipeline_id: string } | null> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ nome: string; tipo: string; pipeline_id: string }>(
      'select nome, tipo, pipeline_id from public.stages where id = $1',
      [stageId],
    )
    return r.rows[0] ?? null
  })
}

async function contarEtapas(pipelineId: string): Promise<number> {
  return comoServico(async (cli) => {
    const r = await cli.query('select 1 from public.stages where pipeline_id = $1', [pipelineId])
    return r.rowCount ?? 0
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

type ErroPg = { code?: string; message: string }

/**
 * Devolve o erro em vez de deixar a promessa estourar: os casos abaixo afirmam
 * o SQLSTATE, nao so o texto — 42501 (RLS) e P0001 (`raise exception`) sao o
 * que distingue "a guarda nomeada recusou" de "a FK estourou crua" (23503).
 */
async function erroDe(fn: () => Promise<unknown>): Promise<ErroPg | null> {
  try {
    await fn()
  } catch (e) {
    return e as ErroPg
  }
  return null
}

/** Chama uma das sondas booleanas na pele de um usuario. */
async function sonda(
  userId: string,
  funcao: 'pipeline_tem_leads' | 'etapa_tem_leads' | 'etapa_ultima_do_tipo',
  id: string,
): Promise<boolean> {
  return comoUsuario(userId, async (cli) => {
    const r = await cli.query<{ v: boolean }>(`select public.${funcao}($1) as v`, [id])
    return r.rows[0].v
  })
}

/** Chama `etapa_imutaveis_ok` na pele de um usuario (tres argumentos). */
async function imutaveisOk(
  userId: string,
  stageId: string,
  tipo: string,
  pipelineId: string,
): Promise<boolean | null> {
  return comoUsuario(userId, async (cli) => {
    const r = await cli.query<{ v: boolean | null }>(
      'select public.etapa_imutaveis_ok($1, $2::public.stage_tipo, $3) as v',
      [stageId, tipo, pipelineId],
    )
    return r.rows[0].v
  })
}

describe('0026 — etapas por membro, guardas na RLS de stages e helpers fail-closed', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  describe('update cru pelo PostgREST', () => {
    it('Caso 1: vendedor renomeia etapa via update cru', async () => {
      // Guarda de regressao do split da policy `for all` em tres: o `with
      // check` novo compara tipo/pipeline_id, e renome tem que continuar
      // passando. Se o hardening ficar largo demais, este fica vermelho.
      const contato = etapa(c, 'Contato feito')

      const rowCount = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query(`update public.stages set nome = 'Primeiro contato' where id = $1`, [
          contato,
        ])
        return r.rowCount
      })

      expect(rowCount).toBe(1)
      expect((await linhaDaEtapa(contato))?.nome).toBe('Primeiro contato')
    })

    it('Caso 2: vendedor NAO troca o tipo da etapa via update cru', async () => {
      // Trocar 'aberta' por 'ganho' corrompe funil, metricas e o snapshot da
      // 0016 — e a 0025 deixava passar.
      const novo = etapa(c, 'Novo lead')

      const erro = await erroDe(() =>
        comoUsuario(c.vendedorAId, (cli) =>
          cli.query(`update public.stages set tipo = 'ganho' where id = $1`, [novo]),
        ),
      )

      expect(erro).not.toBeNull()
      expect(erro!.code).toBe('42501')
      expect(erro!.message).toMatch(/violates row-level security/)
      expect((await linhaDaEtapa(novo))?.tipo).toBe('aberta')
    })

    it('Caso 3: vendedor NAO move etapa para outra pipeline via update cru', async () => {
      // A outra pipeline e da MESMA conta (o vendedor pode cria-la desde a
      // 0025) e fica sem etapas, entao o indice unico (pipeline_id, ordem) nao
      // tem como colidir: a recusa que este caso exige e a da RLS, nao 23505.
      const outraPipeline = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query<{ id: string }>(
          `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline B') returning id`,
          [c.accountId],
        )
        return r.rows[0].id
      })
      const novo = etapa(c, 'Novo lead')

      const erro = await erroDe(() =>
        comoUsuario(c.vendedorAId, (cli) =>
          cli.query(`update public.stages set pipeline_id = $1 where id = $2`, [outraPipeline, novo]),
        ),
      )

      expect(erro).not.toBeNull()
      expect(erro!.code).toBe('42501')
      expect(erro!.message).toMatch(/violates row-level security/)
      expect((await linhaDaEtapa(novo))?.pipeline_id).toBe(c.pipelineId)
    })
  })

  describe('delete cru pelo PostgREST', () => {
    it('Caso 4: vendedor NAO apaga a ultima etapa de um tipo via delete cru', async () => {
      // "Ganho" e a unica etapa do tipo 'ganho' no seed. Delete barrado pelo
      // `using` e no-op de 0 linhas — a semantica de delete sob RLS nao estoura
      // erro, e para o caminho cru isso basta.
      const ganho = etapa(c, 'Ganho')

      const rowCount = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query('delete from public.stages where id = $1', [ganho])
        return r.rowCount
      })

      expect(rowCount).toBe(0)
      expect(await stageExiste(ganho)).toBe(true)
    })

    it('Caso 5: vendedor apaga etapa aberta nao-ultima e vazia via delete cru', async () => {
      // Decisao de produto: membro pode. O caso protege contra um hardening
      // largo demais (o seed tem cinco 'aberta', e "Proposta" nao tem lead).
      const proposta = etapa(c, 'Proposta')

      const rowCount = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query('delete from public.stages where id = $1', [proposta])
        return r.rowCount
      })

      expect(rowCount).toBe(1)
      expect(await stageExiste(proposta)).toBe(false)
    })

    it('Caso 14: delete em LOTE das abertas e abortado e nenhuma etapa some', async () => {
      // Emenda de 2026-08-17 (achado do review da Task 1). A policy sozinha nao
      // segura o lote: o `using` avalia linha a linha contra o snapshot do
      // statement, entao cada uma das cinco 'aberta' ainda ve as outras quatro
      // vivas, `etapa_ultima_do_tipo` da false para todas, e o statement apaga
      // as cinco de uma vez — a pipeline fica sem 'aberta' e a ingestao
      // Meta/Google nao tem mais onde por lead. Quem barra e o trigger de
      // statement, que ve o estado FINAL: erro nomeado (P0001) e statement
      // inteiro desfeito.
      const antes = await contarEtapas(c.pipelineId)

      const erro = await erroDe(() =>
        comoUsuario(c.vendedorAId, (cli) =>
          cli.query(`delete from public.stages where pipeline_id = $1 and tipo = 'aberta'`, [
            c.pipelineId,
          ]),
        ),
      )

      expect(erro).not.toBeNull()
      expect(erro!.code).toBe('P0001')
      expect(erro!.message).toMatch(/ultima_etapa_do_tipo/)
      expect(await contarEtapas(c.pipelineId)).toBe(antes)
    })

    it('Caso 15: excluir a pipeline inteira continua passando (o cascade nao dispara a guarda)', async () => {
      // Emenda de 2026-08-17. O contrapeso do caso 14: o cascade da 0002 apaga
      // TODAS as stages da pipeline num statement so, exatamente a forma que o
      // trigger aborta — o que o deixa passar e a condicao "a pipeline ainda
      // existe". Sem essa condicao, ninguem mais consegue excluir pipeline.
      const { pipelineId, stageIds } = await comoUsuario(c.vendedorAId, async (cli) => {
        const p = await cli.query<{ id: string }>(
          `insert into public.pipelines (account_id, nome) values ($1, 'Pipeline descartavel') returning id`,
          [c.accountId],
        )
        const s = await cli.query<{ id: string }>(
          `insert into public.stages (pipeline_id, nome, ordem, tipo)
           values ($1, 'Aberta 1', 1, 'aberta'), ($1, 'Ganho', 2, 'ganho') returning id`,
          [p.rows[0].id],
        )
        return { pipelineId: p.rows[0].id, stageIds: s.rows.map((r) => r.id) }
      })

      const rowCount = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query('delete from public.pipelines where id = $1', [pipelineId])
        return r.rowCount
      })

      expect(rowCount).toBe(1)
      expect(await contarEtapas(pipelineId)).toBe(0)
      for (const id of stageIds) {
        expect(await stageExiste(id)).toBe(false)
      }
    })
  })

  describe('sondas fail-closed', () => {
    it('Caso 6: sondas cross-account devolvem a constante que RECUSA, com e sem leads', async () => {
      // Um boolean exposto por PostgREST e um oraculo: sem o `is_member_of` por
      // dentro, o admin da conta B descobre se uma pipeline/etapa da conta A
      // tem lead, e se uma etapa e a ultima do tipo. A resposta tem que ser
      // CONSTANTE — e a constante e a que recusa a operacao.
      const outra = await segundaConta('Conta B', 'admin-b-6@b.com')
      const contato = etapa(c, 'Contato feito')
      const novo = etapa(c, 'Novo lead')
      const ganho = etapa(c, 'Ganho')
      const inexistente = '00000000-0000-0000-0000-000000000000'

      // Sub-caso "sem leads": nenhum lead no cenario ainda.
      expect(await sonda(outra.adminId, 'pipeline_tem_leads', c.pipelineId)).toBe(true)
      expect(await sonda(outra.adminId, 'etapa_tem_leads', contato)).toBe(true)
      // Para etapa_ultima_do_tipo o par que discrimina e ultima/nao-ultima:
      // "Novo lead" e uma de cinco 'aberta' (para um membro daria false).
      expect(await sonda(outra.adminId, 'etapa_ultima_do_tipo', novo)).toBe(true)
      expect(await sonda(outra.adminId, 'etapa_ultima_do_tipo', ganho)).toBe(true)

      // Sub-caso "com leads": mesma resposta, senao o boolean vira oraculo.
      await criarLead(c, 'Lead do vendedor A', c.vendedorAId, contato)
      expect(await sonda(outra.adminId, 'pipeline_tem_leads', c.pipelineId)).toBe(true)
      expect(await sonda(outra.adminId, 'etapa_tem_leads', contato)).toBe(true)
      expect(await sonda(outra.adminId, 'etapa_ultima_do_tipo', novo)).toBe(true)

      // Id inexistente responde a mesma constante fechada (nao null).
      expect(await sonda(outra.adminId, 'pipeline_tem_leads', inexistente)).toBe(true)
      expect(await sonda(outra.adminId, 'etapa_tem_leads', inexistente)).toBe(true)
      expect(await sonda(outra.adminId, 'etapa_ultima_do_tipo', inexistente)).toBe(true)
    })

    it('Caso 16: etapa_imutaveis_ok e fail-closed para nao-membro', async () => {
      // Emenda de 2026-08-17 (achado do review da Task 1). O helper tambem e
      // um boolean exposto por PostgREST: sem `is_member_of` por dentro ele
      // devolvia o booleano REAL para nao-membro, confirmando o tipo de uma
      // etapa alheia e o par etapa/pipeline. A resposta para quem nao e membro
      // tem que ser a constante que RECUSA (false no `with check`).
      const outra = await segundaConta('Conta B', 'admin-b-16@b.com')
      const novo = etapa(c, 'Novo lead')

      // Valores CERTOS: e assim que o oraculo vazava — o "true" seria a
      // confirmacao. Fail-closed devolve false do mesmo jeito.
      expect(await imutaveisOk(outra.adminId, novo, 'aberta', c.pipelineId)).toBe(false)
      // Valores errados tambem: a resposta e constante, nao discrimina nada.
      expect(await imutaveisOk(outra.adminId, novo, 'ganho', c.pipelineId)).toBe(false)

      // Controle: para um membro o helper continua respondendo o booleano real
      // — senao o fail-closed teria virado um `false` cego que quebraria todo
      // update de etapa (o caso 1 tambem pegaria, mas aqui fica explicito).
      expect(await imutaveisOk(c.vendedorAId, novo, 'aberta', c.pipelineId)).toBe(true)
      expect(await imutaveisOk(c.vendedorAId, novo, 'ganho', c.pipelineId)).toBe(false)
    })
  })

  describe('excluir_etapa por membro', () => {
    it('Caso 7: vendedor exclui etapa vazia e ela some', async () => {
      // A mesma chamada que o caso 4 da 0018 afirmava recusar com
      // sem_permissao antes da 0026.
      const stageId = await criarEtapaDescartavel(c)

      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.excluir_etapa($1)', [stageId]),
      )

      expect(await stageExiste(stageId)).toBe(false)
    })

    it('Caso 8: vendedor e recusado com etapa_tem_leads quando o lead na etapa e de um COLEGA', async () => {
      // O ponto cego: sob a RLS do vendedor A o lead do vendedor B nao existe.
      // Se a guarda contasse leads localmente, ela passaria, o delete rodaria e
      // a recusa viria da FK como 23503 cru. Exigir P0001 + o nome da guarda e
      // o que discrimina o helper definer.
      const contato = etapa(c, 'Contato feito')
      await criarLead(c, 'Lead do colega', c.vendedorBId, contato)

      const erro = await erroDe(() =>
        comoUsuario(c.vendedorAId, (cli) =>
          cli.query('select public.excluir_etapa($1)', [contato]),
        ),
      )

      expect(erro).not.toBeNull()
      expect(erro!.code).toBe('P0001')
      expect(erro!.message).toMatch(/etapa_tem_leads/)
      expect(await stageExiste(contato)).toBe(true)
    })

    it('Caso 9: vendedor e recusado com ultima_etapa_do_tipo', async () => {
      // Mesma regra de sempre, agora alcancavel por membro: "Ganho" e a unica
      // do tipo e nao tem lead nenhum, entao quem barra e a guarda de tipo.
      const ganho = etapa(c, 'Ganho')

      const erro = await erroDe(() =>
        comoUsuario(c.vendedorAId, (cli) => cli.query('select public.excluir_etapa($1)', [ganho])),
      )

      expect(erro).not.toBeNull()
      expect(erro!.code).toBe('P0001')
      expect(erro!.message).toMatch(/ultima_etapa_do_tipo/)
      expect(await stageExiste(ganho)).toBe(true)
    })
  })

  describe('reordenar_etapas por membro', () => {
    it('Caso 10: vendedor reordena e a ordem nova e aplicada', async () => {
      const idsOriginais = [...c.etapas].sort((a, b) => a.ordem - b.ordem).map((e) => e.id)
      // Permutacao EXATA do pipeline (a funcao exige a lista inteira), com as
      // duas primeiras 'aberta' invertidas.
      const novaOrdem = [idsOriginais[1], idsOriginais[0], ...idsOriginais.slice(2)]

      await comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.reordenar_etapas($1::uuid[])', [novaOrdem]),
      )

      const ordens = await ordensDoPipeline(c.pipelineId)
      expect(ordens.get(idsOriginais[1])).toBe(1)
      expect(ordens.get(idsOriginais[0])).toBe(2)
      for (let i = 2; i < idsOriginais.length; i++) {
        expect(ordens.get(idsOriginais[i])).toBe(i + 1)
      }
    })
  })

  describe('resumo_etapas', () => {
    it('Caso 11: vendedor recebe a contagem da conta inteira, incluindo lead de colega', async () => {
      // O dialogo de exclusao mostra estes numeros a qualquer membro. Sob a RLS
      // do vendedor A a contagem esconderia o lead do vendedor B: a recusa
      // diria "tem leads" com a tela mostrando 0. E o caso que discrimina o
      // security definer de resumo_etapas.
      const contato = etapa(c, 'Contato feito')
      await criarLead(c, 'Lead do colega', c.vendedorBId, contato)

      const linhas = await comoUsuario(c.vendedorAId, async (cli) => {
        const r = await cli.query<{
          stage_id: string
          leads_na_etapa: string
          leads_passaram: string
        }>('select * from public.resumo_etapas($1)', [c.pipelineId])
        return r.rows
      })

      expect(linhas).toHaveLength(7)
      const doContato = linhas.find((l) => l.stage_id === contato)
      expect(doContato).toBeDefined()
      expect(Number(doContato!.leads_na_etapa)).toBe(1)
      expect(Number(doContato!.leads_passaram)).toBe(1)
    })

    it('Caso 12: nao-membro recebe conjunto vazio, sem erro', async () => {
      // A mesma nao-resposta de pipeline inexistente. Guarda de regressao do
      // definer: sem a clausula is_member_of no where, o definer devolveria as
      // sete etapas da conta A para o admin da conta B.
      const outra = await segundaConta('Conta B', 'admin-b-12@b.com')
      await criarLead(c, 'Lead da conta A', c.vendedorAId, etapa(c, 'Contato feito'))

      const linhas = await comoUsuario(outra.adminId, async (cli) => {
        const r = await cli.query('select * from public.resumo_etapas($1)', [c.pipelineId])
        return r.rows
      })

      expect(linhas).toEqual([])
    })
  })

  describe('prosecdef', () => {
    it('Caso 13: helpers, guarda e resumo_etapas sao definer; excluir/reordenar continuam invoker', async () => {
      // Trocar as duas RPCs para definer desligaria a RLS de stages dentro
      // delas e qualquer membro apagaria etapa de outra conta. A guarda de
      // statement (emenda de 2026-08-17) tem que ser definer pelo motivo
      // oposto: ela le pipelines e stages da conta inteira para saber se
      // sobrou etapa do tipo — sob a RLS do chamador a leitura mentiria e o
      // lote passaria.
      const esperado: Record<string, boolean> = {
        etapa_imutaveis_ok: true,
        etapa_tem_leads: true,
        etapa_ultima_do_tipo: true,
        excluir_etapa: false,
        guarda_ultima_etapa_do_tipo: true,
        pipeline_tem_leads: true,
        reordenar_etapas: false,
        resumo_etapas: true,
      }

      const efetivo = await comoServico(async (cli) => {
        const r = await cli.query<{ proname: string; prosecdef: boolean }>(
          `select p.proname, p.prosecdef
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = any ($1::text[])`,
          [Object.keys(esperado)],
        )
        return Object.fromEntries(r.rows.map((linha) => [linha.proname, linha.prosecdef]))
      })

      expect(efetivo).toEqual(esperado)
    })
  })
})
