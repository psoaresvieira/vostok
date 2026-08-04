import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseWhatsAppStore } from '@/lib/data/whatsapp'
import { comoServico, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, type Cenario } from './helpers/cenario'

/**
 * Store irmao de SupabaseFonteStore (ver tests/integration/entregas-recentes.test.ts
 * e admin-store.test.ts para o mesmo desenho): cliente supabase-js autenticado
 * como o usuario, RPCs da migration 0019 por baixo. O segredo de ingestao vem
 * de process.env.INGESTAO_SEGREDO, carregado do .env.local pelo
 * tests/integration/setup.ts — o mesmo valor que supabase/seed.sql grava em
 * ingestion_config ('segredo-de-ingestao-local').
 */

const DADOS = {
  phoneNumberId: '1234567890',
  wabaId: 'waba-abc',
  numeroExibicao: '+55 11 90000-0000',
  nomeVerificado: 'Exemplo Marketing',
  token: 'EAAG-token-do-whatsapp',
}

/** Uma segunda conta completa, com admin proprio. Mesmo helper de 0008/0009/0012. */
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

describe('SupabaseWhatsAppStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  // 1. conectar grava e atual() devolve a conexao mapeada (camelCase, criadoEm como Date).
  it('conectar grava e atual() devolve a conexao mapeada', async () => {
    const store = new SupabaseWhatsAppStore(await clienteDoUsuario(c.adminId), c.accountId)

    const conectado = await store.conectar(DADOS)
    if (!conectado.ok) throw new Error(conectado.erro)
    expect(conectado.valor).toBeTruthy()

    const r = await store.atual()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({
      id: conectado.valor,
      phoneNumberId: DADOS.phoneNumberId,
      wabaId: DADOS.wabaId,
      numeroExibicao: DADOS.numeroExibicao,
      nomeVerificado: DADOS.nomeVerificado,
      criadoEm: expect.any(Date),
    })
  })

  // 2. atual() sem conexao devolve ok(null) — nunca erro.
  it('atual() sem conexao devolve ok(null)', async () => {
    const store = new SupabaseWhatsAppStore(await clienteDoUsuario(c.adminId), c.accountId)

    const r = await store.atual()
    expect(r).toEqual({ ok: true, valor: null })
  })

  // 3. conectar numa conta que ja tem numero devolve falha('whatsapp_ja_conectado') — o codigo exato, nao a mensagem crua.
  it('conectar numa conta que ja tem numero devolve falha whatsapp_ja_conectado', async () => {
    const store = new SupabaseWhatsAppStore(await clienteDoUsuario(c.adminId), c.accountId)
    const primeiro = await store.conectar(DADOS)
    expect(primeiro.ok).toBe(true)

    const segundo = await store.conectar({ ...DADOS, phoneNumberId: '999999' })

    expect(segundo).toEqual({ ok: false, erro: 'whatsapp_ja_conectado' })
  })

  // 4. desconectar remove, e atual() volta a null. A credencial morre junto (cascade).
  it('desconectar remove a conexao e a credencial junto', async () => {
    const store = new SupabaseWhatsAppStore(await clienteDoUsuario(c.adminId), c.accountId)
    const conectado = await store.conectar(DADOS)
    if (!conectado.ok) throw new Error(conectado.erro)

    const r = await store.desconectar(conectado.valor)
    expect(r).toEqual({ ok: true, valor: undefined })

    const depois = await store.atual()
    expect(depois).toEqual({ ok: true, valor: null })

    const credencial = await comoServico(
      (cli) =>
        cli.query('select 1 from public.whatsapp_credentials where connection_id = $1', [
          conectado.valor,
        ]),
    )
    expect(credencial.rowCount).toBe(0)
  })

  // 5. desconectar de id alheio devolve falha('sem_permissao') e a linha sobrevive.
  it('desconectar de id alheio devolve falha sem_permissao e a linha sobrevive', async () => {
    const store = new SupabaseWhatsAppStore(await clienteDoUsuario(c.adminId), c.accountId)
    const conectado = await store.conectar(DADOS)
    if (!conectado.ok) throw new Error(conectado.erro)

    const outra = await outraContaComAdmin('Conta B', 'whatsapp-b@b.com')
    const storeDeOutro = new SupabaseWhatsAppStore(
      await clienteDoUsuario(outra.adminId),
      outra.accountId,
    )

    const r = await storeDeOutro.desconectar(conectado.valor)

    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })

    const sobrevive = await store.atual()
    if (!sobrevive.ok) throw new Error(sobrevive.erro)
    expect(sobrevive.valor?.id).toBe(conectado.valor)
  })
})
