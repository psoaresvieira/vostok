import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

// Mesmo segredo local usado em tests/integration/0011_ingerir_lead.test.ts —
// nao ha helper compartilhado para isto, e um segundo caminho de leitura de
// env divergiria em silencio do que o proprio arquivo 0011 ja fixa.
const SEGREDO = 'segredo-de-ingestao-local'

let contador = 0
/** Sufixo unico por chamada, igual ao helper `unico` de 0011_ingerir_lead.test.ts. */
function unico(prefixo: string): string {
  contador += 1
  return `${prefixo}-${contador}`
}

/** Copia fiel de criarFonteMeta em 0011_ingerir_lead.test.ts: cria a fonte
 * direto nas tabelas, nao pela RPC (que muda na Task 10). */
async function criarFonteMeta(c: Cenario): Promise<{ sourceId: string; externalId: string }> {
  const externalId = unico('page')
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome, responsavel_padrao_id, ativo)
       values ($1, 'meta', $2, $3, $4, true) returning id`,
      [c.accountId, externalId, `Page ${externalId}`, c.vendedorAId],
    )
    await cli.query(
      `insert into public.source_credentials (source_id, meta_page_token) values ($1, 'tok')`,
      [r.rows[0].id],
    )
    return { sourceId: r.rows[0].id, externalId }
  })
}

/** Copia fiel de registrarEntrega em 0011_ingerir_lead.test.ts: chama a RPC
 * da Task 3 para gerar o log_id pendente que ingerir_lead consome. */
async function registrarEntrega(chaveDaFonte: string): Promise<{ log_id: string }> {
  const externalId = unico('ext')
  return comoServico(async (cli) => {
    const r = await cli.query<{ resultado: { log_id: string } }>(
      `select public.registrar_entrega($1, 'meta', $2, $3, $4) as resultado`,
      [SEGREDO, externalId, JSON.stringify({}), chaveDaFonte],
    )
    return r.rows[0].resultado
  })
}

describe('0013 — colunas de rastreamento: campanha_origem/formulario_origem saem, oito colunas novas entram', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('as colunas ambiguas sairam e as de rastreamento entraram', async () => {
    const colunas = await comoServico((cli) =>
      cli.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'leads'`,
      ),
    )
    const nomes = colunas.rows.map((r) => r.column_name)

    // campanha_origem guardava NOME no Meta e ID no Google. Enquanto a coluna
    // existir, alguem volta a escrever nela e a ambiguidade retorna.
    expect(nomes).not.toContain('campanha_origem')
    expect(nomes).not.toContain('formulario_origem')

    for (const col of [
      'campanha_id', 'campanha_nome', 'conjunto_id', 'conjunto_nome',
      'anuncio_id', 'anuncio_nome', 'formulario_id', 'click_id',
    ]) {
      expect(nomes).toContain(col)
    }
  })

  it('ingerir_lead grava os oito campos de rastreamento do Meta', async () => {
    const fonte = await criarFonteMeta(c)
    const entrega = await registrarEntrega(fonte.externalId)

    await comoServico((cli) =>
      cli.query(`select public.ingerir_lead($1, $2, $3)`, [
        SEGREDO,
        entrega.log_id,
        JSON.stringify({
          nome: 'Fulano',
          email: 'fulano@example.com',
          campanha_id: 'camp-7',
          campanha_nome: 'Campanha de Verao',
          conjunto_id: 'adset-9',
          conjunto_nome: 'Conjunto Interesse',
          anuncio_id: 'ad-1',
          anuncio_nome: 'Video 15s',
          formulario_id: 'form-3',
          click_id: null,
          extras: {},
        }),
      ]),
    )

    const r = await comoServico((cli) =>
      cli.query(
        `select campanha_id, campanha_nome, conjunto_id, conjunto_nome,
                anuncio_id, anuncio_nome, formulario_id, click_id
           from public.leads where account_id = $1`,
        [c.accountId],
      ),
    )
    expect(r.rows[0]).toEqual({
      campanha_id: 'camp-7',
      campanha_nome: 'Campanha de Verao',
      conjunto_id: 'adset-9',
      conjunto_nome: 'Conjunto Interesse',
      anuncio_id: 'ad-1',
      anuncio_nome: 'Video 15s',
      formulario_id: 'form-3',
      click_id: null,
    })
  })

  it('ingerir_lead aceita payload sem nenhum campo de rastreamento', async () => {
    // Lead do Google sem os ids opcionais, ou Meta com arvore falhada. Nao
    // pode estourar: nada aqui e obrigatorio.
    const fonte = await criarFonteMeta(c)
    const entrega = await registrarEntrega(fonte.externalId)

    await comoServico((cli) =>
      cli.query(`select public.ingerir_lead($1, $2, $3)`, [
        SEGREDO,
        entrega.log_id,
        JSON.stringify({ nome: 'Ciclano', email: 'ciclano@example.com', extras: {} }),
      ]),
    )

    const r = await comoServico((cli) =>
      cli.query(
        `select campanha_id, anuncio_id from public.leads where account_id = $1`,
        [c.accountId],
      ),
    )
    expect(r.rows[0]).toEqual({ campanha_id: null, anuncio_id: null })
  })

  it('ingerir_lead continua com uma assinatura so, sem sobrecarga', async () => {
    // create or replace com lista de argumentos diferente cria SOBRECARGA em
    // vez de substituir, e as duas versoes conviveriam. Aconteceu na 0012 e
    // custou um drop function explicito. Aqui a assinatura nao muda — este
    // teste e o que garante que ela nao mudou por acidente.
    const r = await comoServico((cli) =>
      cli.query<{ n: string }>(
        `select count(*)::text as n from pg_proc
          where pronamespace = 'public'::regnamespace and proname = 'ingerir_lead'`,
      ),
    )
    expect(r.rows[0]?.n).toBe('1')
  })
})
