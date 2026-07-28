import { Client } from 'pg'

const CONN =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

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
 */
export async function comoUsuario<T>(
  userId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })],
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
        public.lead_events, public.stage_history, public.lead_tags, public.tags,
        public.leads, public.loss_reasons, public.stages, public.pipelines,
        public.invites, public.memberships, public.accounts, public.profiles
      restart identity cascade
    `)
    await c.query('delete from auth.users')
  })
}
