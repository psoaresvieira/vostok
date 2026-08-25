import { beforeEach, describe, expect, it } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

async function tornarDono(userId: string): Promise<void> {
  await comoServico((c) =>
    c.query('insert into public.platform_owners (user_id) values ($1) on conflict do nothing', [userId]),
  )
}

beforeEach(limparBanco)

describe('0029 — follow-ups do plano contas-so-pelo-dono', () => {
  it('criar_conta_cliente com email null cai na guarda entrada_invalida, nao no not-null da tabela', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    await expect(
      comoUsuario(uid, (c) => c.query(`select public.criar_conta_cliente('Cliente X', null)`)),
    ).rejects.toThrow(/entrada_invalida/)
  })

  it('reemitir_convite recusa convite que nao foi criado por um dono da plataforma', async () => {
    // Simetria com contas_da_plataforma: convite de equipe (criado pelo admin
    // do cliente) nao aparece na listagem do /admin — e tambem nao pode ser
    // reemitido por ela.
    const dono = await criarUsuario('dono@a.com')
    const adminCliente = await criarUsuario('admin@cliente.com')
    await tornarDono(dono)
    const token = await comoUsuario(dono, async (c) =>
      (await c.query<{ t: string }>(`select public.criar_conta_cliente('X', 'x@x.com') as t`)).rows[0].t,
    )
    const contaId = await comoServico(async (c) =>
      (await c.query<{ account_id: string }>('select account_id from public.invites where token = $1', [token]))
        .rows[0].account_id,
    )
    const conviteDeEquipe = await comoServico(async (c) =>
      (
        await c.query<{ id: string }>(
          `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
           values ($1, 'vendedor@cliente.com', 'vendedor', replace(gen_random_uuid()::text, '-', ''), now() + interval '7 days', $2)
           returning id`,
          [contaId, adminCliente],
        )
      ).rows[0].id,
    )
    await expect(
      comoUsuario(dono, (c) => c.query('select public.reemitir_convite($1)', [conviteDeEquipe])),
    ).rejects.toThrow(/convite_invalido/)
  })

  it('nenhuma tabela do schema public e truncavel por anon ou authenticated', async () => {
    // Guarda silenciosa nº 6: o default ACL da imagem inclui TRUNCATE, que a
    // RLS nao restringe. A 0021/0024 pagaram casos pontuais; a 0029 varre o
    // schema inteiro — tabela nova com grant largo quebra esta suite.
    const truncaveis = await comoServico(async (c) =>
      (
        await c.query<{ tabela: string; papel: string }>(
          `select c.relname as tabela, r.rolname as papel
             from pg_class c
             cross join (values ('anon'), ('authenticated')) as r(rolname)
            where c.relnamespace = 'public'::regnamespace
              and c.relkind in ('r', 'p')
              and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
            order by 1, 2`,
        )
      ).rows,
    )
    expect(truncaveis).toEqual([])
  })
})
