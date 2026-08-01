import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseFonteStore } from '@/lib/data/fontes'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, type Cenario } from './helpers/cenario'

/**
 * Insere uma linha de integration_log direto (como servico): quem escreve na
 * producao sao as RPCs de ingestao (0010, 0011), SECURITY DEFINER, nunca a
 * tela. `criadoEm` e opcional e serve so para controlar a ordem entre linhas
 * inseridas no mesmo teste sem depender da resolucao do relogio entre
 * `insert`s sequenciais.
 */
async function inserirEntrega(args: {
  accountId: string | null
  provedor: 'meta' | 'google'
  externalId: string
  status?: 'pendente' | 'processado' | 'ignorado' | 'falhou'
  erro?: string | null
  criadoEm?: string
}): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.integration_log
         (account_id, provedor, external_id, payload_bruto, status, erro, criado_em)
       values ($1, $2, $3, '{}'::jsonb, $4, $5, coalesce($6::timestamptz, now()))
       returning id`,
      [
        args.accountId,
        args.provedor,
        args.externalId,
        args.status ?? 'pendente',
        args.erro ?? null,
        args.criadoEm ?? null,
      ],
    )
    return r.rows[0].id
  })
}

/** Uma segunda conta completa, com admin proprio. Mesmo helper das 0008/0009/0012. */
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

describe('SupabaseFonteStore.entregasRecentes', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('admin le as entregas da propria conta, mais recentes primeiro, respeitando o limite', async () => {
    await inserirEntrega({
      accountId: c.accountId,
      provedor: 'meta',
      externalId: 'e-1',
      criadoEm: '2026-01-01T10:00:00Z',
    })
    await inserirEntrega({
      accountId: c.accountId,
      provedor: 'meta',
      externalId: 'e-2',
      criadoEm: '2026-01-01T10:05:00Z',
    })
    await inserirEntrega({
      accountId: c.accountId,
      provedor: 'google',
      externalId: 'e-3',
      criadoEm: '2026-01-01T10:10:00Z',
    })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseFonteStore(cliente, c.accountId)

    const r = await store.entregasRecentes(2)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(2)
    expect(r.valor.map((e) => e.externalId)).toEqual(['e-3', 'e-2'])
    expect(r.valor[0].provedor).toBe('google')
  })

  it('entregas de outra conta nao aparecem', async () => {
    const outra = await outraContaComAdmin('Conta B', 'entregas-b@b.com')
    await inserirEntrega({ accountId: outra.accountId, provedor: 'meta', externalId: 'da-outra' })
    await inserirEntrega({ accountId: c.accountId, provedor: 'meta', externalId: 'da-minha' })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseFonteStore(cliente, c.accountId)

    const r = await store.entregasRecentes(20)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((e) => e.externalId)).toEqual(['da-minha'])
  })

  it('entrega com account_id nulo nao aparece para ninguem', async () => {
    await inserirEntrega({ accountId: null, provedor: 'meta', externalId: 'orfa' })
    await inserirEntrega({ accountId: c.accountId, provedor: 'meta', externalId: 'normal' })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseFonteStore(cliente, c.accountId)

    const r = await store.entregasRecentes(20)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((e) => e.externalId)).toEqual(['normal'])
  })

  it('payload_bruto nao e alcancavel: entregasRecentes sobrevive ao grant, e um select * cru nao', async () => {
    await inserirEntrega({ accountId: c.accountId, provedor: 'meta', externalId: 'com-payload' })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseFonteStore(cliente, c.accountId)

    // A guarda de verdade contra a lista de colunas do store virar `select
    // *`: se isso acontecesse, a lista deixaria de caber no grant por coluna
    // da 0009 e esta chamada devolveria `{ ok: false, erro: '...42501...' }`
    // em vez de suceder. `r.ok === true` e' o assert que discrimina -- foi
    // verificado manualmente trocando o select do store por `'*'` e vendo
    // este `expect` falhar (RED), depois revertendo (GREEN); evidencia no
    // relatorio da Task 12.
    const r = await store.entregasRecentes(20)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(1)
    // Nenhum payload cru chega no objeto devolvido -- nao so "o tipo Entrega
    // nao declara o campo", mas o objeto de runtime realmente nao o carrega,
    // o que pegaria um `as any`/spread futuro que reintroduzisse a coluna.
    expect(r.valor[0]).not.toHaveProperty('payloadBruto')
    expect(Object.keys(r.valor[0]).sort()).toEqual(
      [
        'id',
        'provedor',
        'externalId',
        'status',
        'erro',
        'tentativas',
        'leadId',
        'criadoEm',
        'processadoEm',
      ].sort(),
    )

    // Mantido ao lado do assert acima, nao no lugar dele: prova que a coluna
    // esta mesmo fora do grant (motivo do 42501), nao so que o metodo do
    // store, do jeito que esta escrito hoje, evita toca-la.
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select * from public.integration_log'),
      ),
    ).rejects.toThrow(/permission denied/i)
  })
})
