import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

/**
 * Fecha o squat de Page que a 0008 aceitou como risco com dono (ver README e
 * a spec, secao "Risco nomeado: squat de Page ID em conectar_fonte_meta").
 *
 * O segredo aqui e o mesmo que supabase/seed.sql grava em ingestion_config —
 * os dois tem que andar juntos, e `npx supabase db reset` reseta o banco para
 * este valor.
 */
const SEGREDO = 'segredo-de-ingestao-local'
const ERRADO = 'segredo-errado'
const TOKEN = 'EAAG-token-de-pagina-falso'

/** Uma segunda conta completa, com admin proprio. Mesmo helper do 0008. */
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

describe('0012 — posse da Page: segredo de ingestao nas RPCs de conexao, reivindicacao', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  // 1. Sem isto, o `create or replace` teria deixado as duas versoes vivas e
  // a antiga (sem segredo) continuaria sendo a porta aberta.
  it('conectar_fonte_meta com a assinatura antiga de 5 argumentos nao existe mais', async () => {
    const existeAntiga = await comoServico(async (cli) => {
      const r = await cli.query<{ existe: boolean }>(
        `select (to_regprocedure('public.conectar_fonte_meta(uuid,text,text,text,uuid)') is not null) as existe`,
      )
      return r.rows[0].existe
    })
    expect(existeAntiga).toBe(false)
  })

  // 2. Mesmo um admin legitimo da conta nao passa sem o segredo certo.
  it('conectar_fonte_meta com segredo errado levanta segredo_invalido, mesmo com admin legitimo', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          ERRADO,
          c.accountId,
          'page-2',
          'Page',
          TOKEN,
          c.vendedorAId,
        ]),
      ),
    ).rejects.toThrow(/segredo_invalido/)
  })

  // 3. A mudanca nao pode ter quebrado o caminho feliz do Plano 3.
  it('conectar_fonte_meta com segredo certo e admin legitimo continua funcionando e grava a credencial', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, c.accountId, 'page-3', 'Page da SE7E', TOKEN, c.vendedorAId],
      )
      return r.rows[0].id
    })

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select s.provedor, s.external_id, s.responsavel_padrao_id, cr.meta_page_token
           from public.lead_sources s
           join public.source_credentials cr on cr.source_id = s.id
          where s.id = $1`,
        [sourceId],
      )
      return r.rows[0]
    })
    expect(linha.provedor).toBe('meta')
    expect(linha.external_id).toBe('page-3')
    expect(linha.responsavel_padrao_id).toBe(c.vendedorAId)
    expect(linha.meta_page_token).toBe(TOKEN)
  })

  // 4. As checagens sao cumulativas, nao alternativas: segredo certo nao
  // substitui ser admin da conta.
  it('conectar_fonte_meta com segredo certo, chamada por quem nao e admin, continua levantando sem_permissao', async () => {
    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          c.accountId,
          'page-4',
          'Page',
          TOKEN,
          null,
        ]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  // 5. A unica saida para uma Page squattada: quem prova posse toma a linha,
  // inclusive de outra conta.
  it('reivindicar_fonte_meta toma a linha de outra conta, deixando exatamente uma linha', async () => {
    const outra = await outraContaComAdmin('Conta B', 'b-0012@b.com')
    const pageId = 'page-5-squattada'

    const sourceIdOriginal = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, c.accountId, pageId, 'Page do invasor', TOKEN, null],
      )
      return r.rows[0].id
    })

    const novoToken = 'EAAG-token-do-dono-legitimo'
    const sourceIdNovo = await comoUsuario(outra.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, outra.accountId, pageId, 'Page do dono legitimo', novoToken, null],
      )
      return r.rows[0].id
    })

    expect(sourceIdNovo).not.toBe(sourceIdOriginal)

    const linhas = await comoServico(async (cli) => {
      const r = await cli.query(
        `select id, account_id, meta_page_token
           from public.lead_sources s
           join public.source_credentials cr on cr.source_id = s.id
          where s.provedor = 'meta' and s.external_id = $1`,
        [pageId],
      )
      return r.rows
    })
    expect(linhas).toHaveLength(1)
    expect(linhas[0].id).toBe(sourceIdNovo)
    expect(linhas[0].account_id).toBe(outra.accountId)
    expect(linhas[0].meta_page_token).toBe(novoToken)

    // A credencial antiga desapareceu junto com a linha antiga (on delete
    // cascade da PK de source_credentials).
    const credenciaisAntigas = await comoServico(async (cli) => {
      const r = await cli.query('select 1 from public.source_credentials where source_id = $1', [
        sourceIdOriginal,
      ])
      return r.rows
    })
    expect(credenciaisAntigas).toHaveLength(0)
  })

  // 6. A reivindicacao preserva o historico da conta original: e o registro
  // de que os leads dela vieram por aquela fonte, mesmo depois de perde-la.
  it('reivindicar_fonte_meta preserva o historico de integration_log da conta original', async () => {
    const outra = await outraContaComAdmin('Conta C', 'c-0012@c.com')
    const pageId = 'page-6-com-historico'

    const sourceIdOriginal = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6) as id',
        [SEGREDO, c.accountId, pageId, 'Page com historico', TOKEN, null],
      )
      return r.rows[0].id
    })

    const logId = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.integration_log
           (account_id, source_id, provedor, external_id, payload_bruto, status)
         values ($1, $2, 'meta', 'leadgen-6', '{}'::jsonb, 'processado')
         returning id`,
        [c.accountId, sourceIdOriginal],
      )
      return r.rows[0].id
    })

    await comoUsuario(outra.adminId, (cli) =>
      cli.query('select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)', [
        SEGREDO,
        outra.accountId,
        pageId,
        'Page do dono legitimo',
        'token-novo',
        null,
      ]),
    )

    const log = await comoServico(async (cli) => {
      const r = await cli.query(
        'select account_id, source_id from public.integration_log where id = $1',
        [logId],
      )
      return r.rows[0]
    })
    // on delete set null da 0009: a linha sobrevive a queda da fonte.
    expect(log.source_id).toBeNull()
    expect(log.account_id).toBe(c.accountId)
  })

  // 7. As tres formas de recusa de reivindicar_fonte_meta.
  it('reivindicar_fonte_meta sem segredo levanta segredo_invalido; sem sessao, sem_sessao; sem ser admin da conta alvo, sem_permissao', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          ERRADO,
          c.accountId,
          'page-7a',
          'Page',
          TOKEN,
          null,
        ]),
      ),
    ).rejects.toThrow(/segredo_invalido/)

    await expect(
      comoServico((cli) =>
        cli.query('select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          c.accountId,
          'page-7b',
          'Page',
          TOKEN,
          null,
        ]),
      ),
    ).rejects.toThrow(/sem_sessao/)

    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query('select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          c.accountId,
          'page-7c',
          'Page',
          TOKEN,
          null,
        ]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  // 8. page_id vazio ou so espaco nao pode virar linha nem apagar nada.
  it('reivindicar_fonte_meta com page_id vazio ou so espaco levanta page_id_invalido', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          c.accountId,
          null,
          'Page',
          TOKEN,
          null,
        ]),
      ),
    ).rejects.toThrow(/page_id_invalido/)

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)', [
          SEGREDO,
          c.accountId,
          '   ',
          'Page',
          TOKEN,
          null,
        ]),
      ),
    ).rejects.toThrow(/page_id_invalido/)
  })

  // 9. Registro deliberado: a assimetria com o Meta e decisao, nao esquecimento.
  it('conectar_fonte_google continua com a assinatura de 5 argumentos e sem segredo', async () => {
    const existeSemSegredo = await comoServico(async (cli) => {
      const r = await cli.query<{ existe: boolean }>(
        `select (to_regprocedure('public.conectar_fonte_google(uuid,text,text,text,uuid)') is not null) as existe`,
      )
      return r.rows[0].existe
    })
    expect(existeSemSegredo).toBe(true)

    // E de fato chamavel sem segredo nenhum, so com as checagens de sessao/admin.
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_google($1, $2, $3, $4, null) as id',
        [c.accountId, 'Formulario sem segredo', 'token-url-9', 'chave-9'],
      )
      return r.rows[0].id
    })
    expect(sourceId).toBeTruthy()
  })

  // 10. Achado do review da Task 3: sem esta validacao, chamada direta ao
  // PostgREST criava fonte Google com google_key_hash nulo, que a 0010 ja
  // recusa em registrar_entrega — mas a linha invalida chegava a existir.
  // Fail-closed nas duas pontas.
  it('conectar_fonte_google recusa p_google_key nulo ou so espaco, com segredo_vazio', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
          c.accountId,
          'Formulario',
          'token-url-10a',
          null,
        ]),
      ),
    ).rejects.toThrow(/segredo_vazio/)

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
          c.accountId,
          'Formulario',
          'token-url-10b',
          '   ',
        ]),
      ),
    ).rejects.toThrow(/segredo_vazio/)
  })
})
