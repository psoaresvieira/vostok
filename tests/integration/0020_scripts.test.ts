import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

/**
 * Uma segunda conta com admin proprio e uma etapa propria, para os casos de
 * cross-tenant (padrao de 0008_fontes_conectadas.test.ts / 0018). Diferente
 * do `segundaConta` de 0018 (sem pipeline), este caso precisa de um
 * `stage_id` real de outra conta para o Caso 4 (stage_da_conta negando etapa
 * alheia) — daqui vem a etapa extra.
 */
async function segundaContaComEtapa(
  nome: string,
  email: string,
): Promise<{ accountId: string; adminId: string; stageId: string }> {
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
    const p = await cli.query<{ id: string }>(
      `insert into public.pipelines (account_id, nome, is_default) values ($1, 'Funil', true)
       returning id`,
      [a.rows[0].id],
    )
    const s = await cli.query<{ id: string }>(
      `insert into public.stages (pipeline_id, nome, ordem, tipo) values ($1, 'Novo lead', 1, 'aberta')
       returning id`,
      [p.rows[0].id],
    )
    return { accountId: a.rows[0].id, adminId: u.rows[0].id, stageId: s.rows[0].id }
  })
}

describe('0020 — tabela scripts, stage_da_conta e RLS por papel', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('Caso 1: gestor insere script com etapa da propria conta; vendedor le da biblioteca', async () => {
    const novo = etapa(c, 'Novo lead')

    const id = await comoUsuario(c.gestorId, async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, tags, criado_por)
           values ($1, 'Abordagem inicial', 'Ola, tudo bem?', $2, $3, $4) returning id`,
          [c.accountId, novo, ['frio', 'whatsapp'], c.gestorId],
        )
      ).rows[0].id,
    )

    // Biblioteca e leitura de todo membro: o vendedor nao escreve, mas ve.
    const linha = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query(
        `select account_id, titulo, conteudo, stage_id, tags, criado_por, criado_em, atualizado_em
           from public.scripts where id = $1`,
        [id],
      )
      return r.rows[0]
    })
    expect(linha.account_id).toBe(c.accountId)
    expect(linha.titulo).toBe('Abordagem inicial')
    expect(linha.conteudo).toBe('Ola, tudo bem?')
    expect(linha.stage_id).toBe(novo)
    expect(linha.tags).toEqual(['frio', 'whatsapp'])
    expect(linha.criado_por).toBe(c.gestorId)
    expect(linha.criado_em).not.toBeNull()
    expect(linha.atualizado_em).not.toBeNull()
  })

  it('Caso 2: vendedor nao escreve — insert falha 42501; update/delete afetam zero linhas e o script fica intacto', async () => {
    const novo = etapa(c, 'Novo lead')

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, 'Indevido', 'x', $2, $3)`,
          [c.accountId, novo, c.vendedorAId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    const id = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, 'Original', 'conteudo original', $2, $3) returning id`,
          [c.accountId, novo, c.gestorId],
        )
      ).rows[0].id,
    )

    // O update/delete NAO da erro: a policy `using` esconde a linha do
    // vendedor e o comando afeta zero linhas — e por isso a Task 3 traduz
    // zero linhas para script_nao_encontrado.
    const rUpdate = await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(`update public.scripts set titulo = 'Alterado' where id = $1`, [id]),
    )
    expect(rUpdate.rowCount).toBe(0)

    const rDelete = await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(`delete from public.scripts where id = $1`, [id]),
    )
    expect(rDelete.rowCount).toBe(0)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(`select titulo from public.scripts where id = $1`, [id])
      return r.rows[0]
    })
    expect(linha.titulo).toBe('Original')
  })

  it('Caso 3: isolamento entre contas por discriminacao — mesma consulta devolve numeros diferentes', async () => {
    const novo = etapa(c, 'Novo lead')
    await comoServico((cli) =>
      cli.query(
        `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
         values ($1, 'Script da conta A', 'x', $2, $3)`,
        [c.accountId, novo, c.gestorId],
      ),
    )
    const outra = await segundaContaComEtapa('Conta B', 'admin-b-3@b.com')

    const consulta = 'select count(*)::int as n from public.scripts'
    const nA = await comoUsuario(
      c.vendedorAId,
      async (cli) => (await cli.query(consulta)).rows[0].n,
    )
    const nB = await comoUsuario(
      outra.adminId,
      async (cli) => (await cli.query(consulta)).rows[0].n,
    )

    expect(nA).not.toBe(nB)
    expect(nA).toBe(1)
    expect(nB).toBe(0)
  })

  it('Caso 4: stage_da_conta nega etapa alheia — no insert e no update', async () => {
    const outra = await segundaContaComEtapa('Conta B', 'admin-b-4@b.com')

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, 'Indevido', 'x', $2, $3)`,
          [c.accountId, outra.stageId, c.adminId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    const novo = etapa(c, 'Novo lead')
    const id = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, 'Valido', 'x', $2, $3) returning id`,
          [c.accountId, novo, c.gestorId],
        )
      ).rows[0].id,
    )

    // O with check de scripts_update reavalia a linha inteira, inclusive
    // stage_id — a troca para etapa da conta B tem que morrer aqui tambem.
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(`update public.scripts set stage_id = $1 where id = $2`, [outra.stageId, id]),
      ),
    ).rejects.toThrow(/row-level security/i)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(`select stage_id from public.scripts where id = $1`, [id])
      return r.rows[0]
    })
    expect(linha.stage_id).toBe(novo)
  })

  it('Caso 5: stage_id inexistente morre no with check com 42501, nao FK', async () => {
    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, 'Indevido', 'x', '00000000-0000-0000-0000-000000000000', $2)`,
          [c.accountId, c.gestorId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('Caso 6: mais de 10 tags e recusado pelo check de tags', async () => {
    const novo = etapa(c, 'Novo lead')
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`)

    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, tags, criado_por)
           values ($1, 'Muitas tags', 'x', $2, $3, $4)`,
          [c.accountId, novo, tags, c.gestorId],
        ),
      ),
    ).rejects.toThrow(/violates check constraint/i)
  })

  it('Caso 7: excluir_etapa nao trava em script — a etapa some e o script vira "qualquer etapa"', async () => {
    // Etapa extra tipo 'aberta' sem leads: excluir_etapa recusa a ultima
    // etapa de cada tipo, e o pipeline padrao ja tem 'Novo lead' como aberta.
    const stageId = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.stages (pipeline_id, nome, ordem, tipo)
         values ($1, 'Descartavel', 50, 'aberta') returning id`,
        [c.pipelineId],
      )
      return r.rows[0].id
    })
    const id = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, 'Preso na etapa', 'x', $2, $3) returning id`,
          [c.accountId, stageId, c.gestorId],
        )
      ).rows[0].id,
    )

    await comoUsuario(c.adminId, (cli) => cli.query('select public.excluir_etapa($1)', [stageId]))

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(`select stage_id from public.scripts where id = $1`, [id])
      return r.rows[0]
    })
    expect(linha.stage_id).toBeNull()
  })

  it('Caso 8: TRUNCATE em scripts e negado (permission denied, sem passar pela RLS)', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('truncate public.scripts')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('Caso 9: stage_da_conta e security definer (prosecdef = true)', async () => {
    const linhas = await comoServico(async (cli) => {
      const r = await cli.query<{ prosecdef: boolean }>(
        `select prosecdef from pg_proc where proname = 'stage_da_conta'`,
      )
      return r.rows
    })
    expect(linhas).toHaveLength(1)
    expect(linhas[0].prosecdef).toBe(true)
  })
})
