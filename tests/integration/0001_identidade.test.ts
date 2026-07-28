import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

async function criarConta(nome: string, adminId: string): Promise<string> {
  return comoServico(async (c) => {
    const a = await c.query<{ id: string }>(
      'insert into public.accounts (nome) values ($1) returning id',
      [nome],
    )
    const accountId = a.rows[0].id
    await c.query(
      `insert into public.memberships (account_id, user_id, papel)
       values ($1, $2, 'admin')`,
      [accountId, adminId],
    )
    return accountId
  })
}

describe('0001 — identidade e tenancy', () => {
  beforeEach(limparBanco)

  it('cria profile automaticamente ao criar auth.users', async () => {
    const userId = await criarUsuario('ana@se7e.com')
    const rows = await comoServico(async (c) =>
      (await c.query('select id, email from public.profiles where id = $1', [userId])).rows,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('ana@se7e.com')
  })

  it('usuario da conta A nao le a conta B', async () => {
    const ana = await criarUsuario('ana@a.com')
    const bruno = await criarUsuario('bruno@b.com')
    await criarConta('Conta A', ana)
    await criarConta('Conta B', bruno)

    const vistas = await comoUsuario(ana, async (c) =>
      (await c.query('select nome from public.accounts')).rows,
    )
    expect(vistas).toHaveLength(1)
    expect(vistas[0].nome).toBe('Conta A')
  })

  it('membro le colegas da mesma conta e nao estranhos', async () => {
    const ana = await criarUsuario('ana@a.com')
    const carla = await criarUsuario('carla@a.com')
    const bruno = await criarUsuario('bruno@b.com')
    const contaA = await criarConta('Conta A', ana)
    await criarConta('Conta B', bruno)
    await comoServico((c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, papel)
         values ($1, $2, 'vendedor')`,
        [contaA, carla],
      ),
    )

    const emails = await comoUsuario(ana, async (c) =>
      (await c.query('select email from public.profiles order by email')).rows.map(
        (r) => r.email,
      ),
    )
    expect(emails).toEqual(['ana@a.com', 'carla@a.com'])
  })

  it('vendedor nao le nem cria convites', async () => {
    const ana = await criarUsuario('ana@a.com')
    const vendedor = await criarUsuario('v@a.com')
    const contaA = await criarConta('Conta A', ana)
    await comoServico((c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, papel)
         values ($1, $2, 'vendedor')`,
        [contaA, vendedor],
      ),
    )
    await comoServico((c) =>
      c.query(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values ($1, 'novo@a.com', 'vendedor', 'tok-1', now() + interval '7 days', $2)`,
        [contaA, ana],
      ),
    )

    const lidos = await comoUsuario(vendedor, async (c) =>
      (await c.query('select id from public.invites')).rows,
    )
    expect(lidos).toHaveLength(0)

    await expect(
      comoUsuario(vendedor, (c) =>
        c.query(
          `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
           values ($1, 'x@a.com', 'vendedor', 'tok-2', now() + interval '7 days', $2)`,
          [contaA, vendedor],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('accept_invite cria membership com o papel do convite', async () => {
    const ana = await criarUsuario('ana@a.com')
    const novo = await criarUsuario('novo@a.com')
    const contaA = await criarConta('Conta A', ana)
    await comoServico((c) =>
      c.query(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values ($1, 'novo@a.com', 'gestor', 'tok-ok', now() + interval '7 days', $2)`,
        [contaA, ana],
      ),
    )

    const retorno = await comoUsuario(novo, async (c) =>
      (await c.query('select public.accept_invite($1) as account_id', ['tok-ok'])).rows[0],
    )
    expect(retorno.account_id).toBe(contaA)

    const papel = await comoServico(async (c) =>
      (
        await c.query(
          'select papel from public.memberships where account_id = $1 and user_id = $2',
          [contaA, novo],
        )
      ).rows[0].papel,
    )
    expect(papel).toBe('gestor')
  })

  it('accept_invite rejeita token invalido, expirado e ja aceito', async () => {
    const ana = await criarUsuario('ana@a.com')
    const novo = await criarUsuario('novo@a.com')
    const contaA = await criarConta('Conta A', ana)
    await comoServico((c) =>
      c.query(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values
           ($1, 'novo@a.com', 'vendedor', 'tok-exp', now() - interval '1 day', $2),
           ($1, 'novo@a.com', 'vendedor', 'tok-usado', now() + interval '7 days', $2)`,
        [contaA, ana],
      ),
    )
    await comoServico((c) =>
      c.query(`update public.invites set aceito_em = now() where token = 'tok-usado'`),
    )

    await expect(
      comoUsuario(novo, (c) => c.query('select public.accept_invite($1)', ['nao-existe'])),
    ).rejects.toThrow(/convite_invalido/)

    await expect(
      comoUsuario(novo, (c) => c.query('select public.accept_invite($1)', ['tok-exp'])),
    ).rejects.toThrow(/convite_expirado/)

    await expect(
      comoUsuario(novo, (c) => c.query('select public.accept_invite($1)', ['tok-usado'])),
    ).rejects.toThrow(/convite_ja_aceito/)
  })
})
