import { describe, it, expect, beforeEach } from 'vitest'
import { Client } from 'pg'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'
import { exigirHostLocal } from './helpers/guarda-host'

const SEGREDO = 'segredo-de-ingestao-local'
const ERRADO = 'segredo-errado'
const VAZIO = '00000000-0000-0000-0000-000000000000'

const CONN = exigirHostLocal(
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
)

/**
 * Executa como o papel `anon` do PostgREST: sem sessao nenhuma, exatamente o
 * papel que o cliente webhook usa. Nao existe em helpers/db.ts porque nenhum
 * outro arquivo de teste precisou dele ate agora — 0010 e o primeiro caminho
 * de escrita sem auth.uid() do projeto.
 */
async function comoAnonimo<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('set local role anon')
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

/** Cria uma fonte Meta direto nas tabelas — nao pela RPC, que muda na Task 10. */
async function criarFonteMeta(
  c: Cenario,
  pageId: string,
  token: string,
  ativo = true,
): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome, ativo)
       values ($1, 'meta', $2, $3, $4) returning id`,
      [c.accountId, pageId, `Page ${pageId}`, ativo],
    )
    await cli.query(
      `insert into public.source_credentials (source_id, meta_page_token) values ($1, $2)`,
      [r.rows[0].id, token],
    )
    return r.rows[0].id
  })
}

/** Cria uma fonte Google direto nas tabelas — nao pela RPC. */
async function criarFonteGoogle(c: Cenario, urlToken: string, googleKey: string): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome)
       values ($1, 'google', null, $2) returning id`,
      [c.accountId, `Formulario ${urlToken}`],
    )
    await cli.query(
      `insert into public.source_credentials (source_id, url_token_hash, google_key_hash)
       values ($1, public.hash_segredo($2), public.hash_segredo($3))`,
      [r.rows[0].id, urlToken, googleKey],
    )
    return r.rows[0].id
  })
}

/**
 * Cria uma fonte Google com `google_key_hash` NULO — estado que a RPC
 * `conectar_fonte_google` de hoje ainda deixa representavel (a validacao que a
 * fecha e da Task 10). `criarFonteGoogle` sempre grava uma chave real, entao
 * este helper insere direto, sem passar `google_key_hash` nenhum.
 */
async function criarFonteGoogleSemChave(c: Cenario, urlToken: string): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome)
       values ($1, 'google', null, $2) returning id`,
      [c.accountId, `Formulario ${urlToken}`],
    )
    await cli.query(
      `insert into public.source_credentials (source_id, url_token_hash)
       values ($1, public.hash_segredo($2))`,
      [r.rows[0].id, urlToken],
    )
    return r.rows[0].id
  })
}

type ResultadoEntrega = { log_id: string | null; status: string; token: string | null }

/** Chama registrar_entrega como o cliente webhook (sem sessao). */
async function registrarEntrega(
  provedor: 'meta' | 'google',
  externalId: string,
  payload: unknown,
  chaveDaFonte: string,
  googleKey: string | null = null,
  segredo = SEGREDO,
): Promise<ResultadoEntrega> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ resultado: ResultadoEntrega }>(
      `select public.registrar_entrega($1, $2, $3, $4, $5, $6) as resultado`,
      [segredo, provedor, externalId, JSON.stringify(payload), chaveDaFonte, googleKey],
    )
    return r.rows[0].resultado
  })
}

async function buscarLog(logId: string) {
  return comoServico(async (cli) => {
    const r = await cli.query('select * from public.integration_log where id = $1', [logId])
    return r.rows[0]
  })
}

/** Insere uma linha de integration_log direto, com controle fino de tempo via offsets em minutos. */
async function inserirLogBruto(opts: {
  c: Cenario
  externalId: string
  status?: 'pendente' | 'processado' | 'ignorado' | 'falhou'
  tentativas?: number
  ultimaTentativaMinutosAtras?: number | null
  criadoMinutosAtras?: number
  provedor?: 'meta' | 'google'
}): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.integration_log
         (account_id, provedor, external_id, payload_bruto, status, tentativas,
          ultima_tentativa_em, criado_em)
       values (
         $1, $2, $3, '{}'::jsonb, $4, $5,
         case when $6::int is null then null else now() - make_interval(mins => $6::int) end,
         now() - make_interval(mins => $7::int)
       )
       returning id`,
      [
        opts.c.accountId,
        opts.provedor ?? 'meta',
        opts.externalId,
        opts.status ?? 'pendente',
        opts.tentativas ?? 0,
        opts.ultimaTentativaMinutosAtras ?? null,
        opts.criadoMinutosAtras ?? 0,
      ],
    )
    return r.rows[0].id
  })
}

describe('0010 — RPCs de entrega gateadas no segredo de ingestao', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  // Caso 1
  it('segredo errado recusa nas tres funcoes', async () => {
    await expect(
      comoServico((cli) =>
        cli.query(`select public.registrar_entrega($1, 'meta', 'ext-c1', '{}'::jsonb, 'chave')`, [
          ERRADO,
        ]),
      ),
    ).rejects.toThrow(/segredo_invalido/)

    await expect(
      comoServico((cli) => cli.query(`select public.entregas_pendentes($1, 10)`, [ERRADO])),
    ).rejects.toThrow(/segredo_invalido/)

    await expect(
      comoServico((cli) =>
        cli.query(`select public.registrar_falha($1, $2, 'erro')`, [ERRADO, VAZIO]),
      ),
    ).rejects.toThrow(/segredo_invalido/)
  })

  // Caso 2
  it('segredo nulo no banco recusa mesmo com o segredo certo na chamada', async () => {
    await comoServico((cli) =>
      cli.query('update public.ingestion_config set segredo_hash = null where id'),
    )
    try {
      await expect(
        registrarEntrega('meta', 'ext-c2', {}, 'page-qualquer'),
      ).rejects.toThrow(/segredo_invalido/)
    } finally {
      await comoServico((cli) =>
        cli.query(
          'update public.ingestion_config set segredo_hash = public.hash_segredo($1) where id',
          [SEGREDO],
        ),
      )
    }
  })

  // Caso 3
  it('segredo_confere nao e alcancavel por anon nem por authenticated', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select public.segredo_confere($1)', [SEGREDO])),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      comoAnonimo((cli) => cli.query('select public.segredo_confere($1)', [SEGREDO])),
    ).rejects.toThrow(/permission denied/i)
  })

  // Caso 4
  it('meta com Page conhecida grava pendente e devolve o token da Page', async () => {
    const token = 'EAAG-token-da-page-100'
    await criarFonteMeta(c, 'page-100', token)

    const resultado = await registrarEntrega('meta', 'ext-meta-100', { foo: 'bar' }, 'page-100')

    expect(resultado.status).toBe('pendente')
    expect(resultado.token).toBe(token)
    expect(resultado.log_id).not.toBeNull()

    const linha = await buscarLog(resultado.log_id!)
    expect(linha.status).toBe('pendente')
    expect(linha.account_id).toBe(c.accountId)
    expect(linha.erro).toBeNull()
  })

  // Caso 5
  it('meta com Page desconhecida grava ignorado com fonte_nao_encontrada, sem conta e sem token', async () => {
    const resultado = await registrarEntrega('meta', 'ext-meta-200', {}, 'page-desconhecida')

    expect(resultado.status).toBe('ignorado')
    expect(resultado.token).toBeNull()

    const linha = await buscarLog(resultado.log_id!)
    expect(linha.erro).toBe('fonte_nao_encontrada')
    expect(linha.account_id).toBeNull()
  })

  // Caso 6
  it('google com url token valido e chave certa grava pendente, sem token', async () => {
    await criarFonteGoogle(c, 'url-token-abc', 'chave-certa')

    const resultado = await registrarEntrega(
      'google',
      'ext-google-1',
      {},
      'url-token-abc',
      'chave-certa',
    )

    expect(resultado.status).toBe('pendente')
    expect(resultado.token).toBeNull()
  })

  // Caso 7
  it('google com chave errada grava ignorado com chave_invalida e account_id preenchido', async () => {
    await criarFonteGoogle(c, 'url-token-def', 'chave-certa-2')

    const resultado = await registrarEntrega(
      'google',
      'ext-google-2',
      {},
      'url-token-def',
      'chave-errada',
    )

    expect(resultado.status).toBe('ignorado')
    const linha = await buscarLog(resultado.log_id!)
    expect(linha.erro).toBe('chave_invalida')
    expect(linha.account_id).toBe(c.accountId)
  })

  // Caso 7b
  it('google com google_key_hash nulo recusa qualquer entrega, com ou sem chave apresentada', async () => {
    await criarFonteGoogleSemChave(c, 'url-token-sem-chave')

    const semChave = await registrarEntrega(
      'google',
      'ext-google-sem-chave-1',
      {},
      'url-token-sem-chave',
      null,
    )
    expect(semChave.status).toBe('ignorado')
    const linhaSemChave = await buscarLog(semChave.log_id!)
    expect(linhaSemChave.erro).toBe('chave_invalida')

    const comChave = await registrarEntrega(
      'google',
      'ext-google-sem-chave-2',
      {},
      'url-token-sem-chave',
      'alguma-chave',
    )
    expect(comChave.status).toBe('ignorado')
    const linhaComChave = await buscarLog(comChave.log_id!)
    expect(linhaComChave.erro).toBe('chave_invalida')
  })

  // Caso 8
  it('is_test grava ignorado com lead_de_teste, tanto boolean quanto string "true"', async () => {
    await criarFonteMeta(c, 'page-test', 'tok-test')

    const r1 = await registrarEntrega('meta', 'ext-test-bool', { is_test: true }, 'page-test')
    expect(r1.status).toBe('ignorado')
    const linha1 = await buscarLog(r1.log_id!)
    expect(linha1.erro).toBe('lead_de_teste')

    const r2 = await registrarEntrega('meta', 'ext-test-str', { is_test: 'true' }, 'page-test')
    expect(r2.status).toBe('ignorado')
    const linha2 = await buscarLog(r2.log_id!)
    expect(linha2.erro).toBe('lead_de_teste')
  })

  // Caso 9
  it('reenvio e no-op: segunda chamada devolve duplicado, tabela continua com uma linha', async () => {
    await criarFonteMeta(c, 'page-dup', 'tok-dup')

    const r1 = await registrarEntrega('meta', 'ext-dup-1', {}, 'page-dup')
    expect(r1.status).toBe('pendente')

    const r2 = await registrarEntrega('meta', 'ext-dup-1', {}, 'page-dup')
    expect(r2.status).toBe('duplicado')
    expect(r2.log_id).toBeNull()

    const n = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select count(*) as n from public.integration_log where external_id = 'ext-dup-1'`,
      )
      return r.rows[0].n
    })
    expect(n).toBe('1')
  })

  // Caso 10
  it('external_id vazio ou so espaco levanta external_id_invalido', async () => {
    await expect(registrarEntrega('meta', '', {}, 'page-x')).rejects.toThrow(
      /external_id_invalido/,
    )
    await expect(registrarEntrega('meta', '   ', {}, 'page-x')).rejects.toThrow(
      /external_id_invalido/,
    )
  })

  // Caso 11
  it('entregas_pendentes devolve pendente e falhou-com-tentativas-abaixo-de-5, mais antigo primeiro', async () => {
    const idPendente = await inserirLogBruto({
      c,
      externalId: 'ent-pendente',
      status: 'pendente',
      criadoMinutosAtras: 20,
    })
    const idFalhouRetentavel = await inserirLogBruto({
      c,
      externalId: 'ent-falhou-retentavel',
      status: 'falhou',
      tentativas: 2,
      ultimaTentativaMinutosAtras: 10, // janela de tentativas=2 e 9 minutos
      criadoMinutosAtras: 10,
    })
    await inserirLogBruto({ c, externalId: 'ent-processado', status: 'processado' })
    await inserirLogBruto({ c, externalId: 'ent-ignorado', status: 'ignorado' })
    await inserirLogBruto({
      c,
      externalId: 'ent-esgotado',
      status: 'falhou',
      tentativas: 5,
      ultimaTentativaMinutosAtras: 1000,
    })

    const linhas = await comoServico(async (cli) => {
      const r = await cli.query<{ log_id: string }>(
        'select * from public.entregas_pendentes($1, 10)',
        [SEGREDO],
      )
      return r.rows
    })

    expect(linhas.map((l) => l.log_id)).toEqual([idPendente, idFalhouRetentavel])
  })

  // Caso 12
  it('o backoff segura a retentativa: tentativas=2 tem janela de 9 minutos', async () => {
    const id = await inserirLogBruto({
      c,
      externalId: 'backoff-1',
      status: 'falhou',
      tentativas: 2,
      ultimaTentativaMinutosAtras: 0,
    })

    let linhas = await comoServico(async (cli) => {
      const r = await cli.query<{ log_id: string }>(
        'select * from public.entregas_pendentes($1, 10)',
        [SEGREDO],
      )
      return r.rows
    })
    expect(linhas.map((l) => l.log_id)).not.toContain(id)

    await comoServico((cli) =>
      cli.query(
        `update public.integration_log set ultima_tentativa_em = now() - interval '10 minutes' where id = $1`,
        [id],
      ),
    )

    linhas = await comoServico(async (cli) => {
      const r = await cli.query<{ log_id: string }>(
        'select * from public.entregas_pendentes($1, 10)',
        [SEGREDO],
      )
      return r.rows
    })
    expect(linhas.map((l) => l.log_id)).toContain(id)
  })

  // Caso 13b — claim-on-handout (achado 3 do review final). Sem o carimbo,
  // uma linha 'pendente' sem ultima_tentativa_em seria devolvida por TODA
  // chamada, sempre primeiro por criado_em -- o livelock que trava a fila
  // inteira quando o processamento dessa linha e lento demais.
  it('entregas_pendentes carimba ultima_tentativa_em ao devolver, entao a mesma linha nao volta na chamada seguinte', async () => {
    const id = await inserirLogBruto({ c, externalId: 'claim-1', status: 'pendente', criadoMinutosAtras: 5 })

    const logAntes = await buscarLog(id)
    expect(logAntes.ultima_tentativa_em).toBeNull()

    const primeira = await comoServico(async (cli) => {
      const r = await cli.query<{ log_id: string }>(
        'select * from public.entregas_pendentes($1, 10)',
        [SEGREDO],
      )
      return r.rows
    })
    expect(primeira.map((l) => l.log_id)).toContain(id)

    const segunda = await comoServico(async (cli) => {
      const r = await cli.query<{ log_id: string }>(
        'select * from public.entregas_pendentes($1, 10)',
        [SEGREDO],
      )
      return r.rows
    })
    expect(segunda.map((l) => l.log_id)).not.toContain(id)

    const logDepois = await buscarLog(id)
    expect(logDepois.ultima_tentativa_em).not.toBeNull()
    // O carimbo nao mexe em status nem tentativas -- so no relogio do backoff.
    expect(logDepois.status).toBe('pendente')
    expect(logDepois.tentativas).toBe(0)
  })

  // Caso 13
  it('registrar_falha incrementa tentativas e carimba ultima_tentativa_em, e nao mexe em processado', async () => {
    const idPendente = await inserirLogBruto({ c, externalId: 'falha-1', status: 'pendente' })
    await comoServico((cli) =>
      cli.query('select public.registrar_falha($1, $2, $3)', [SEGREDO, idPendente, 'Erro de teste']),
    )
    const linha = await buscarLog(idPendente)
    expect(linha.status).toBe('falhou')
    expect(linha.tentativas).toBe(1)
    expect(linha.erro).toBe('Erro de teste')
    expect(linha.ultima_tentativa_em).not.toBeNull()

    const idProcessado = await inserirLogBruto({ c, externalId: 'falha-2', status: 'processado' })
    await comoServico((cli) =>
      cli.query('select public.registrar_falha($1, $2, $3)', [
        SEGREDO,
        idProcessado,
        'Erro de teste',
      ]),
    )
    const linhaProcessada = await buscarLog(idProcessado)
    expect(linhaProcessada.status).toBe('processado')
    expect(linhaProcessada.tentativas).toBe(0)
  })
})
