import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

/**
 * Modo operador: a implantacao de cada cliente e feita MANUALMENTE pelo dono
 * da plataforma (spec docs/superpowers/specs/2026-08-25-modo-operador... —
 * ver .superpowers/sdd/task-1-brief.md). O dono NAO e membro das contas dos
 * clientes (0028), entao as seis RPCs de conexao ganham a alternativa
 * `sou_dono_da_plataforma()` na guarda de papel.
 *
 * Segredo: o mesmo que supabase/seed.sql grava em ingestion_config — os dois
 * tem que andar juntos, e `npx supabase db reset` reseta o banco para este
 * valor. Padrao copiado de 0019_conexao_whatsapp.test.ts / 0012_posse_da_page.test.ts.
 */
const SEGREDO = 'segredo-de-ingestao-local'

async function tornarDono(userId: string): Promise<void> {
  await comoServico((c) =>
    c.query('insert into public.platform_owners (user_id) values ($1) on conflict do nothing', [userId]),
  )
}

/**
 * Nasce uma conta de cliente pela mao do dono (criar_conta_cliente) e insere
 * um usuario-cliente como membro admin dela diretamente via comoServico —
 * sem isto nao existiria p_responsavel valido (e_membro_da_conta) para as
 * RPCs de conexao.
 */
async function contaDeClienteComAdmin(
  donoId: string,
  nome: string,
  emailConvite: string,
  emailMembro: string,
): Promise<{ accountId: string; membroId: string }> {
  const token = await comoUsuario(donoId, async (c) => {
    const r = await c.query<{ t: string }>(`select public.criar_conta_cliente($1, $2) as t`, [
      nome,
      emailConvite,
    ])
    return r.rows[0].t
  })
  const accountId = await comoServico(async (c) => {
    const r = await c.query<{ account_id: string }>(
      'select account_id from public.invites where token = $1',
      [token],
    )
    return r.rows[0].account_id
  })
  const membroId = await criarUsuario(emailMembro)
  await comoServico((c) =>
    c.query(`insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'admin')`, [
      accountId,
      membroId,
    ]),
  )
  return { accountId, membroId }
}

beforeEach(limparBanco)

describe('0030 — conexoes pelo dono da plataforma (modo operador)', () => {
  it('dono conecta fonte meta em conta da qual nao e membro', async () => {
    const dono = await criarUsuario('dono1-0030@a.com')
    await tornarDono(dono)
    const { accountId, membroId } = await contaDeClienteComAdmin(
      dono,
      'Cliente 1',
      'cliente1-0030@x.com',
      'membro1-0030@x.com',
    )

    const sourceId = await comoUsuario(dono, async (c) => {
      const r = await c.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, accountId, 'page-30-1', 'Página X', 'tok', membroId],
      )
      return r.rows[0].id
    })

    const linha = await comoServico(async (c) => {
      const r = await c.query('select account_id from public.lead_sources where id = $1', [sourceId])
      return r.rows[0]
    })
    expect(linha.account_id).toBe(accountId)
  })

  it('dono conecta fonte google em conta alheia', async () => {
    const dono = await criarUsuario('dono2-0030@a.com')
    await tornarDono(dono)
    const { accountId, membroId } = await contaDeClienteComAdmin(
      dono,
      'Cliente 2',
      'cliente2-0030@x.com',
      'membro2-0030@x.com',
    )

    const sourceId = await comoUsuario(dono, async (c) => {
      const r = await c.query<{ id: string }>(
        'select public.conectar_fonte_google($1, $2, $3, $4, $5) as id',
        [accountId, 'Google X', 'url-tok', 'gkey', membroId],
      )
      return r.rows[0].id
    })

    const linha = await comoServico(async (c) => {
      const r = await c.query('select account_id from public.lead_sources where id = $1', [sourceId])
      return r.rows[0]
    })
    expect(linha.account_id).toBe(accountId)
  })

  it('dono conecta e desconecta whatsapp de conta alheia', async () => {
    const dono = await criarUsuario('dono3-0030@a.com')
    await tornarDono(dono)
    const { accountId } = await contaDeClienteComAdmin(
      dono,
      'Cliente 3',
      'cliente3-0030@x.com',
      'membro3-0030@x.com',
    )

    const connectionId = await comoUsuario(dono, async (c) => {
      const r = await c.query<{ id: string }>(
        'select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7) as id',
        [SEGREDO, accountId, 'pn-1', 'waba-1', '+55 11 9...', 'Empresa', 'tok'],
      )
      return r.rows[0].id
    })

    await comoUsuario(dono, (c) =>
      c.query('select public.desconectar_whatsapp($1, $2)', [SEGREDO, connectionId]),
    )

    const linha = await comoServico(async (c) => {
      const r = await c.query('select id from public.whatsapp_connections where id = $1', [connectionId])
      return r.rows
    })
    expect(linha).toHaveLength(0)
  })

  it('dono reivindica page conectada por outra conta', async () => {
    const dono = await criarUsuario('dono4-0030@a.com')
    await tornarDono(dono)
    const contaA = await contaDeClienteComAdmin(dono, 'Conta A4', 'contaA4-0030@x.com', 'membroA4-0030@x.com')
    const contaB = await contaDeClienteComAdmin(dono, 'Conta B4', 'contaB4-0030@x.com', 'membroB4-0030@x.com')

    const sourceIdA = await comoUsuario(contaA.membroId, async (c) => {
      const r = await c.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, contaA.accountId, 'page-30-4', 'Page A', 'tok-a', contaA.membroId],
      )
      return r.rows[0].id
    })

    const sourceIdB = await comoUsuario(dono, async (c) => {
      const r = await c.query<{ id: string }>(
        'select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, contaB.accountId, 'page-30-4', 'Page B', 'tok-b', contaB.membroId],
      )
      return r.rows[0].id
    })

    expect(sourceIdB).not.toBe(sourceIdA)
    const linha = await comoServico(async (c) => {
      const r = await c.query('select account_id from public.lead_sources where id = $1', [sourceIdB])
      return r.rows[0]
    })
    expect(linha.account_id).toBe(contaB.accountId)
  })

  it('dono desconecta fonte de conta alheia', async () => {
    const dono = await criarUsuario('dono5-0030@a.com')
    await tornarDono(dono)
    const { accountId, membroId } = await contaDeClienteComAdmin(
      dono,
      'Cliente 5',
      'cliente5-0030@x.com',
      'membro5-0030@x.com',
    )

    const sourceId = await comoUsuario(dono, async (c) => {
      const r = await c.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, accountId, 'page-30-5', 'Page 5', 'tok-5', membroId],
      )
      return r.rows[0].id
    })

    await comoUsuario(dono, (c) => c.query('select public.desconectar_fonte($1)', [sourceId]))

    const linha = await comoServico(async (c) => {
      const r = await c.query('select id from public.lead_sources where id = $1', [sourceId])
      return r.rows
    })
    expect(linha).toHaveLength(0)
  })

  it('usuario comum continua barrado com sem_permissao', async () => {
    const dono = await criarUsuario('dono6-0030@a.com')
    await tornarDono(dono)
    const { accountId, membroId } = await contaDeClienteComAdmin(
      dono,
      'Cliente 6',
      'cliente6-0030@x.com',
      'membro6-0030@x.com',
    )
    const estranho = await criarUsuario('estranho6-0030@x.com')

    await expect(
      comoUsuario(estranho, (c) =>
        c.query('select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          accountId,
          'page-30-6',
          'Page 6',
          'tok-6',
          membroId,
        ]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('responsavel de fora da conta continua responsavel_invalido, ate para o dono', async () => {
    const dono = await criarUsuario('dono7-0030@a.com')
    await tornarDono(dono)
    const { accountId } = await contaDeClienteComAdmin(
      dono,
      'Cliente 7',
      'cliente7-0030@x.com',
      'membro7-0030@x.com',
    )
    const foraDaConta = await criarUsuario('fora7-0030@x.com')

    await expect(
      comoUsuario(dono, (c) =>
        c.query('select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          accountId,
          'page-30-7',
          'Page 7',
          'tok-7',
          foraDaConta,
        ]),
      ),
    ).rejects.toThrow(/responsavel_invalido/)
  })
})
