import { Client } from 'pg'
import { exigirHostLocal } from './guarda-host'

// exigirHostLocal lanca se SUPABASE_DB_URL apontar para fora de
// 127.0.0.1/localhost. limparBanco() abaixo trunca as tabelas raiz do schema
// mais delete from auth.users — sem esta guarda, um .env copiado ou uma variavel
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
    await abrirTransacaoDoUsuario(client, userId)
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

/** Abre a transacao e veste o usuario. Extraido de comoUsuario porque
 * abrirSessaoUsuario precisa do mesmo preambulo sem o commit no fim. */
async function abrirTransacaoDoUsuario(client: Client, userId: string): Promise<void> {
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
}

export type SessaoAberta = {
  /** Conexao crua com a transacao ABERTA, na pele do usuario. */
  cliente: Client
  /** Fecha a transacao e devolve a conexao. Idempotente. */
  encerrar: (acao: 'commit' | 'rollback') => Promise<void>
}

/**
 * Igual a comoUsuario, mas devolve a transacao ABERTA em vez de commitar no
 * fim do callback. Existe para os testes de corrida entre duas sessoes: a
 * escrita fica pendurada aqui, invisivel para qualquer outra conexao, enquanto
 * uma SEGUNDA sessao (o supabase-js falando por PostgREST) tenta a escrita
 * conflitante e BLOQUEIA; so entao `encerrar('commit')` solta o conflito e a
 * segunda sessao recebe o SQLSTATE real (23505 no indice unico de ordem, 23503
 * na FK de pipeline). Sem manter a transacao aberta essas corridas nao teriam
 * como ser encenadas de forma deterministica.
 *
 * Quem chama e' responsavel por chamar `encerrar` — de preferencia num
 * `finally`, senao a transacao segura locks e o proximo `limparBanco` trava.
 */
export async function abrirSessaoUsuario(userId: string): Promise<SessaoAberta> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    await abrirTransacaoDoUsuario(client, userId)
  } catch (e) {
    await client.end()
    throw e
  }

  let fechada = false
  return {
    cliente: client,
    encerrar: async (acao) => {
      if (fechada) return
      fechada = true
      try {
        await client.query(acao)
      } finally {
        await client.end()
      }
    },
  }
}

/**
 * Espera ate uma sessao ficar PARADA esperando por lock — o sinal de que a
 * escrita concorrente ja chegou no conflito e nao passou dele. E' o que torna
 * as corridas deterministicas: sem isso, commitar cedo demais deixaria a outra
 * sessao ler o estado ja resolvido e nunca colidir. Estoura se o bloqueio nao
 * acontecer, para o teste falhar em vez de virar verde por engano.
 */
export async function esperarBloqueioEm(tabela: string, tentativas = 200): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    const bloqueada = await comoServico(async (c) => {
      const r = await c.query(
        `select 1 from pg_stat_activity
          where wait_event_type = 'Lock'
            and pid <> pg_backend_pid()
            and query ilike $1`,
        [`%${tabela}%`],
      )
      return (r.rowCount ?? 0) > 0
    })
    if (bloqueada) return
    await new Promise((resolver) => setTimeout(resolver, 25))
  }
  throw new Error(`nenhuma sessao ficou bloqueada em ${tabela} — a corrida nao foi encenada`)
}

/** Insere userId em platform_owners (idempotente). Usado pelos testes das
 * migrations que restringem operacoes ao dono da plataforma (0028+). */
export async function tornarDono(userId: string): Promise<void> {
  await comoServico((c) =>
    c.query('insert into public.platform_owners (user_id) values ($1) on conflict do nothing', [userId]),
  )
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
        public.integration_log, public.notifications,
        public.lead_events, public.stage_history, public.lead_tags, public.tags,
        public.leads, public.loss_reasons, public.stages, public.pipelines,
        public.invites, public.memberships, public.accounts, public.profiles,
        public.platform_owners
      restart identity cascade
    `)
    await c.query('delete from auth.users')
  })
}
