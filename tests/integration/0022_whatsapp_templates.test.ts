import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'
import { SEGREDO } from './helpers/ingestao'

/**
 * whatsapp_templates: snapshot posicional por script, e a RPC de status
 * com segredo. Spec: docs/superpowers/specs/2026-08-04-crm-disparo-whatsapp-design.md
 *
 * Padrao de teste copiado de 0020_scripts.test.ts (duas contas, dois papeis;
 * segundaContaComEtapa aqui adaptado para tambem trazer um script proprio, do
 * qual o Caso 4 precisa para testar script_id de outra conta).
 */
const ERRADO = 'segredo-errado'

async function segundaContaComScript(
  nome: string,
  email: string,
): Promise<{ accountId: string; adminId: string; scriptId: string }> {
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
    const s = await cli.query<{ id: string }>(
      `insert into public.scripts (account_id, titulo, conteudo, criado_por)
       values ($1, 'Script da conta B', 'x', $2) returning id`,
      [a.rows[0].id, u.rows[0].id],
    )
    return { accountId: a.rows[0].id, adminId: u.rows[0].id, scriptId: s.rows[0].id }
  })
}

/** Cria um script na conta do cenario (via servico) — atalho usado por varios casos. */
async function criarScript(c: Cenario, titulo = 'Abordagem inicial'): Promise<string> {
  const novo = etapa(c, 'Novo lead')
  return comoServico(async (cli) =>
    (
      await cli.query<{ id: string }>(
        `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
         values ($1, $2, 'Ola, tudo bem?', $3, $4) returning id`,
        [c.accountId, titulo, novo, c.gestorId],
      )
    ).rows[0].id,
  )
}

type InserirTemplateArgs = {
  scriptId: string
  nomeMeta?: string
  idioma?: string
  categoria?: string
  corpoPosicional?: string
  mapa?: string[]
  status?: string
}

/** Insere um template como gestor da conta do cenario — atalho usado por varios casos. */
async function inserirTemplate(c: Cenario, args: InserirTemplateArgs): Promise<string> {
  const a = {
    nomeMeta: args.nomeMeta ?? 'template_abordagem',
    idioma: args.idioma ?? 'pt_BR',
    categoria: args.categoria ?? 'marketing',
    corpoPosicional: args.corpoPosicional ?? 'Ola {{1}}, tudo bem?',
    mapa: args.mapa ?? ['nome'],
    status: args.status ?? 'pending',
  }
  return comoUsuario(c.gestorId, async (cli) =>
    (
      await cli.query<{ id: string }>(
        `insert into public.whatsapp_templates
           (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          c.accountId,
          args.scriptId,
          a.nomeMeta,
          a.idioma,
          a.categoria,
          a.corpoPosicional,
          a.mapa,
          a.status,
        ],
      )
    ).rows[0].id,
  )
}

describe('0022 — whatsapp_templates, snapshot posicional e RPC de status com segredo', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('Caso 1: gestor insere template para script da propria conta; vendedor le por select', async () => {
    const scriptId = await criarScript(c)
    const id = await inserirTemplate(c, { scriptId })

    const linha = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query(
        `select account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa,
                status, motivo_rejeicao, template_id_meta, status_consultado_em,
                criado_em, atualizado_em
           from public.whatsapp_templates where id = $1`,
        [id],
      )
      return r.rows[0]
    })
    expect(linha.account_id).toBe(c.accountId)
    expect(linha.script_id).toBe(scriptId)
    expect(linha.nome_meta).toBe('template_abordagem')
    expect(linha.idioma).toBe('pt_BR')
    expect(linha.categoria).toBe('marketing')
    expect(linha.corpo_posicional).toBe('Ola {{1}}, tudo bem?')
    expect(linha.mapa).toEqual(['nome'])
    expect(linha.status).toBe('pending')
    expect(linha.motivo_rejeicao).toBeNull()
    expect(linha.template_id_meta).toBeNull()
    expect(linha.status_consultado_em).toBeNull()
    expect(linha.criado_em).not.toBeNull()
    expect(linha.atualizado_em).not.toBeNull()
  })

  it('Caso 2: vendedor nao escreve — insert 42501; update/delete zero linhas e template intacto', async () => {
    const scriptId = await criarScript(c)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.whatsapp_templates
             (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status)
           values ($1, $2, 'indevido', 'pt_BR', 'marketing', 'x', '{}', 'pending')`,
          [c.accountId, scriptId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    const id = await inserirTemplate(c, { scriptId })

    const rUpdate = await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(`update public.whatsapp_templates set status = 'approved' where id = $1`, [id]),
    )
    expect(rUpdate.rowCount).toBe(0)

    const rDelete = await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(`delete from public.whatsapp_templates where id = $1`, [id]),
    )
    expect(rDelete.rowCount).toBe(0)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(`select status from public.whatsapp_templates where id = $1`, [
        id,
      ])
      return r.rows[0]
    })
    expect(linha.status).toBe('pending')
  })

  it('Caso 3: isolamento entre contas por discriminacao — mesma consulta devolve numeros diferentes', async () => {
    const scriptId = await criarScript(c)
    await inserirTemplate(c, { scriptId })
    const outra = await segundaContaComScript('Conta B', 'admin-b-3@b.com')

    const consulta = 'select count(*)::int as n from public.whatsapp_templates'
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

  it('Caso 4: script de outra conta recusado — no insert e no update', async () => {
    const outra = await segundaContaComScript('Conta B', 'admin-b-4@b.com')

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(
          `insert into public.whatsapp_templates
             (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status)
           values ($1, $2, 'indevido', 'pt_BR', 'marketing', 'x', '{}', 'pending')`,
          [c.accountId, outra.scriptId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    const scriptId = await criarScript(c)
    const id = await inserirTemplate(c, { scriptId })

    // O with check de whatsapp_templates_update reavalia a linha inteira,
    // inclusive script_id — a troca para script da conta B tem que morrer
    // aqui tambem.
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(`update public.whatsapp_templates set script_id = $1 where id = $2`, [
          outra.scriptId,
          id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(`select script_id from public.whatsapp_templates where id = $1`, [
        id,
      ])
      return r.rows[0]
    })
    expect(linha.script_id).toBe(scriptId)
  })

  it('Caso 5: unicidades — segundo template por script 23505; nome_meta duplicado na conta 23505; em contas diferentes aceito', async () => {
    const scriptId = await criarScript(c)
    await inserirTemplate(c, { scriptId, nomeMeta: 'template_a' })

    const scriptId2 = await criarScript(c, 'Segundo script')
    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query(
          `insert into public.whatsapp_templates
             (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status)
           values ($1, $2, 'outro_nome', 'pt_BR', 'marketing', 'x', '{}', 'pending')`,
          [c.accountId, scriptId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' })

    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query(
          `insert into public.whatsapp_templates
             (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status)
           values ($1, $2, 'template_a', 'pt_BR', 'marketing', 'x', '{}', 'pending')`,
          [c.accountId, scriptId2],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' })

    const outra = await segundaContaComScript('Conta B', 'admin-b-5@b.com')
    const idOutraConta = await comoUsuario(outra.adminId, async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.whatsapp_templates
             (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status)
           values ($1, $2, 'template_a', 'pt_BR', 'marketing', 'x', '{}', 'pending') returning id`,
          [outra.accountId, outra.scriptId],
        )
      ).rows[0].id,
    )
    expect(idOutraConta).toBeTruthy()
  })

  it('Caso 6: RPC com segredo errado recusa (segredo_invalido) e nada muda', async () => {
    const scriptId = await criarScript(c)
    const id = await inserirTemplate(c, { scriptId })

    await expect(
      comoServico((cli) =>
        cli.query('select public.atualizar_status_template($1, $2, $3, $4)', [
          ERRADO,
          id,
          'approved',
          null,
        ]),
      ),
    ).rejects.toThrow(/segredo_invalido/)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select status, motivo_rejeicao, status_consultado_em
           from public.whatsapp_templates where id = $1`,
        [id],
      )
      return r.rows[0]
    })
    expect(linha.status).toBe('pending')
    expect(linha.motivo_rejeicao).toBeNull()
    expect(linha.status_consultado_em).toBeNull()
  })

  it('Caso 7: RPC com segredo certo, sem sessao nenhuma, atualiza status/motivo/carimbo e SO isso', async () => {
    const scriptId = await criarScript(c)
    const id = await inserirTemplate(c, {
      scriptId,
      corpoPosicional: 'Ola {{1}}, tudo bem?',
      mapa: ['nome'],
      nomeMeta: 'template_abordagem',
    })

    // Mesma tecnica do Caso 8 de 0019_conexao_whatsapp.test.ts:
    // comoServico() nao seta request.jwt.claims nenhum — a chamada e a prova
    // de que a RPC nao exige sessao, so o segredo.
    const linha = await comoServico(async (cli) => {
      await cli.query('select public.atualizar_status_template($1, $2, $3, $4)', [
        SEGREDO,
        id,
        'REJECTED',
        'Motivo do Meta',
      ])
      const r = await cli.query(
        `select status, motivo_rejeicao, status_consultado_em, corpo_posicional, mapa, nome_meta
           from public.whatsapp_templates where id = $1`,
        [id],
      )
      return r.rows[0]
    })
    expect(linha.status).toBe('rejected')
    expect(linha.motivo_rejeicao).toBe('Motivo do Meta')
    expect(linha.status_consultado_em).not.toBeNull()
    expect(linha.corpo_posicional).toBe('Ola {{1}}, tudo bem?')
    expect(linha.mapa).toEqual(['nome'])
    expect(linha.nome_meta).toBe('template_abordagem')
  })

  it('Caso 8: RPC com template inexistente leva template_nao_encontrado', async () => {
    await expect(
      comoServico((cli) =>
        cli.query('select public.atualizar_status_template($1, $2, $3, $4)', [
          SEGREDO,
          '00000000-0000-0000-0000-000000000000',
          'approved',
          null,
        ]),
      ),
    ).rejects.toThrow(/template_nao_encontrado/)
  })

  it('Caso 9: TRUNCATE em whatsapp_templates e negado, e atualizar_status_template e security definer (prosecdef = true)', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('truncate public.whatsapp_templates')),
    ).rejects.toThrow(/permission denied/i)

    const linhas = await comoServico(async (cli) => {
      const r = await cli.query<{ prosecdef: boolean }>(
        `select prosecdef from pg_proc where proname = 'atualizar_status_template'`,
      )
      return r.rows
    })
    expect(linhas).toHaveLength(1)
    expect(linhas[0].prosecdef).toBe(true)
  })
})
