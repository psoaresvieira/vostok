import { Client } from 'pg'
import { exigirHostLocal } from './guarda-host'

// exigirHostLocal lanca se SUPABASE_DB_URL apontar para fora de
// 127.0.0.1/localhost. limparBanco() abaixo faz truncate em 14 tabelas mais
// delete from auth.users — sem esta guarda, um .env copiado ou uma variavel
// de shell errada apontando para um banco real seria destruido sem perguntar
// nada. Ver comentario completo em ./guarda-host.ts.
const CONN = exigirHostLocal(
  process.env.SUPABASE_DB_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
)

/** Executa como superusuario: ignora RLS. Use para preparar cenario. */
export async function comoServico<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Executa com RLS ativa na pele de um usuario autenticado.
 * auth.uid() le request.jwt.claims->>'sub', entao setamos esse claim.
 * O claim `email` vai junto porque o GoTrue sempre o emite e accept_invite
 * passou a compara-lo com o email do convite (0005_convite_por_email.sql).
 */
export async function comoUsuario<T>(
  userId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    const dono = await client.query<{ email: string | null }>(
      'select email from auth.users where id = $1',
      [userId],
    )
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [
        JSON.stringify({
          sub: userId,
          role: 'authenticated',
          email: dono.rows[0]?.email ?? undefined,
        }),
      ],
    )
    const r = await fn(client)
    await client.query('commit')
    return r
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    await client.end()
  }
}

export async function criarUsuario(email: string): Promise<string> {
  return comoServico(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1)
       returning id`,
      [email],
    )
    return r.rows[0].id
  })
}

export async function limparBanco(): Promise<void> {
  await comoServico(async (c) => {
    await c.query(`
      truncate table
        public.source_credentials, public.lead_sources,
        public.lead_events, public.stage_history, public.lead_tags, public.tags,
        public.leads, public.loss_reasons, public.stages, public.pipelines,
        public.invites, public.memberships, public.accounts, public.profiles
      restart identity cascade
    `)
    await c.query('delete from auth.users')
  })
}
