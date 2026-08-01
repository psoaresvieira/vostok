import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'
import { SEGREDO, criarFonteMeta, registrarEntrega } from './helpers/ingestao'

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
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
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
    // Sem order by/limit, r.rows[0] so e a lead certa porque o cenario nao
    // semeia nenhuma outra lead nesta conta -- invariante de outro arquivo.
    // Assertar aqui torna essa dependencia visivel onde ela e usada.
    expect(r.rows).toHaveLength(1)
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
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
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
    // Mesma dependencia da lead unica na conta que o teste acima assume.
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toEqual({ campanha_id: null, anuncio_id: null })
  })

  it('lead_events grava campanha/formulario a partir das chaves NOVAS do payload, nao das aposentadas', async () => {
    // Achado 1 do review: v_evento lia campanha_origem/formulario_origem, que
    // saem nesta mesma migration. Enquanto o TS ainda emitia as duas chaves
    // (antiga e nova) isso passava batido; assim que a chave antiga sumir do
    // payload, campanha/formulario gravariam null para sempre em
    // lead_events, que e append-only e nunca e reconstruido depois.
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)

    const ingestao = await comoServico((cli) =>
      cli.query<{ resultado: { lead_id: string } }>(
        `select public.ingerir_lead($1, $2, $3) as resultado`,
        [
          SEGREDO,
          entrega.log_id,
          JSON.stringify({
            nome: 'Beltrano',
            email: 'beltrano@example.com',
            campanha_nome: 'Campanha de Inverno',
            formulario_id: 'form-42',
            extras: {},
          }),
        ],
      ),
    )
    const leadId = ingestao.rows[0].resultado.lead_id

    const eventos = await comoServico((cli) =>
      cli.query<{ payload: { campanha: string | null; formulario: string | null } }>(
        `select payload from public.lead_events where lead_id = $1 and tipo = 'criado_por_webhook'`,
        [leadId],
      ),
    )
    expect(eventos.rows).toHaveLength(1)
    expect(eventos.rows[0].payload.campanha).toBe('Campanha de Inverno')
    expect(eventos.rows[0].payload.formulario).toBe('form-42')
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

    // count() sozinho tambem passaria se a assinatura tivesse mudado E a
    // versao antiga tivesse sido dropada -- so contar linhas nao discrimina
    // "continua a mesma" de "trocou por outra unica versao". Fixar os
    // argumentos exatos fecha essa lacuna.
    const args = await comoServico((cli) =>
      cli.query<{ args: string }>(
        `select pg_get_function_identity_arguments(oid) as args
           from pg_proc
          where pronamespace = 'public'::regnamespace and proname = 'ingerir_lead'`,
      ),
    )
    expect(args.rows[0]?.args).toBe('p_segredo text, p_log_id uuid, p_dados jsonb')
  })
})
