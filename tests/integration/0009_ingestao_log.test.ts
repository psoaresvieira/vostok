import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, criarLead, etapa, type Cenario } from './helpers/cenario'

/** Uma segunda conta completa, com admin proprio. */
async function outraContaComAdmin(
  nome: string,
  email: string,
): Promise<{ accountId: string; adminId: string }> {
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
    return { accountId: a.rows[0].id, adminId: u.rows[0].id }
  })
}

/** Insere uma linha de integration_log direto (como servico), devolvendo o id. */
async function inserirLog(
  accountId: string | null,
  provedor: 'meta' | 'google',
  externalId: string,
): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.integration_log (account_id, provedor, external_id, payload_bruto)
       values ($1, $2, $3, '{}'::jsonb) returning id`,
      [accountId, provedor, externalId],
    )
    return r.rows[0].id
  })
}

describe('0009 — integration_log e notifications', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('integration_log recusa select * para authenticated', async () => {
    await inserirLog(c.accountId, 'meta', 'ext-1')
    // Nao e RLS devolvendo zero linhas: payload_bruto esta fora do grant.
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.integration_log')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('admin le as colunas concedidas da propria conta', async () => {
    const id = await inserirLog(c.accountId, 'meta', 'ext-2')
    const linhas = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query(
        `select id, account_id, source_id, provedor, external_id, status, erro,
                tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em
           from public.integration_log`,
      )
      return r.rows
    })
    expect(linhas).toHaveLength(1)
    expect(linhas[0].id).toBe(id)
    expect(linhas[0].provedor).toBe('meta')
    expect(linhas[0].external_id).toBe('ext-2')
  })

  it('vendedor nao le integration_log, nem da propria conta', async () => {
    await inserirLog(c.accountId, 'meta', 'ext-3')
    const linhas = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query(
        `select id, provedor, external_id from public.integration_log`,
      )
      return r.rows
    })
    expect(linhas).toEqual([])
  })

  it('linha com account_id nulo e invisivel para todo mundo, inclusive para o admin', async () => {
    await inserirLog(null, 'meta', 'ext-orfa')
    const linhas = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query(
        `select id, provedor, external_id from public.integration_log`,
      )
      return r.rows
    })
    expect(linhas).toEqual([])
  })

  it('unique (provedor, external_id) e global', async () => {
    await inserirLog(c.accountId, 'meta', 'ext-dup')
    const outra = await outraContaComAdmin('Conta B', 'log-b@b.com')
    await expect(inserirLog(outra.accountId, 'meta', 'ext-dup')).rejects.toThrow(
      /duplicate key|unique/i,
    )
  })

  it('notifications isola vendedores entre si', async () => {
    const leadId = await criarLead(c, 'Lead A', c.vendedorAId, etapa(c, 'Novo lead'))
    const notifId = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.notifications (account_id, usuario_id, lead_id, tipo)
         values ($1, $2, $3, 'novo_lead') returning id`,
        [c.accountId, c.vendedorAId, leadId],
      )
      return r.rows[0].id
    })

    for (const userId of [c.vendedorBId, c.gestorId, c.adminId]) {
      const vistas = await comoUsuario(userId, async (cli) => {
        const r = await cli.query('select id from public.notifications')
        return r.rows
      })
      expect(vistas).toEqual([])
    }

    const vistasDono = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query('select id from public.notifications')
      return r.rows
    })
    expect(vistasDono).toEqual([{ id: notifId }])
  })

  it('vendedor marca a propria notificacao como lida; update de outro afeta zero linhas', async () => {
    const leadId = await criarLead(c, 'Lead B', c.vendedorAId, etapa(c, 'Novo lead'))
    const notifId = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.notifications (account_id, usuario_id, lead_id, tipo)
         values ($1, $2, $3, 'novo_lead') returning id`,
        [c.accountId, c.vendedorAId, leadId],
      )
      return r.rows[0].id
    })

    const resultadoAlheio = await comoUsuario(c.vendedorBId, (cli) =>
      cli.query('update public.notifications set lida_em = now() where id = $1', [notifId]),
    )
    expect(resultadoAlheio.rowCount).toBe(0)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('update public.notifications set lida_em = now() where id = $1', [notifId]),
    )
    const linha = await comoServico(async (cli) => {
      const r = await cli.query<{ lida_em: string | null }>(
        'select lida_em from public.notifications where id = $1',
        [notifId],
      )
      return r.rows[0]
    })
    expect(linha.lida_em).not.toBeNull()
  })

  it('notifications nao aceita insert de authenticated, nem do proprio dono', async () => {
    const leadId = await criarLead(c, 'Lead C', c.vendedorAId, etapa(c, 'Novo lead'))
    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.notifications (account_id, usuario_id, lead_id, tipo)
           values ($1, $2, $3, 'novo_lead')`,
          [c.accountId, c.vendedorAId, leadId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('notifications esta na publicacao do Realtime', async () => {
    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public'
            and tablename = 'notifications'`,
      )
      return r.rows
    })
    expect(linha).toHaveLength(1)
  })
})
