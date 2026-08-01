import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'
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

  it('reingestao grava campanha_id/anuncio_id/click_id no evento, mesmo sem tocar a lead existente', async () => {
    // Achado 2 do review final. Cenario: uma lead manual (todas as colunas de
    // rastreamento nulas, como um cadastro feito na mao no CRM) fica aberta.
    // Duas semanas depois a MESMA pessoa preenche um formulario do Google —
    // que nunca manda campanha_nome (mapear-google.ts poe null de proposito)
    // — com campanha_id/anuncio_id/click_id novos. ingerir_lead cai no ramo
    // de dedup: nao atualiza NENHUMA coluna da lead (so grava o evento). Se
    // v_evento nao carregasse os ids crus, a campanha que de fato converteu
    // ficaria sem registro em lugar nenhum: a lead continua com as colunas
    // nulas do cadastro manual, e lead_events e append-only — nunca
    // reconstruido depois.
    const lead1 = await comoServico((cli) =>
      cli.query<{ id: string }>(
        `insert into public.leads (
           account_id, nome, telefone_e164, pipeline_id, stage_id, responsavel_id
         ) values ($1, 'Lead Manual', '+5511966665555', $2, $3, $4)
         returning id`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorAId],
      ),
    )
    const leadId = lead1.rows[0].id

    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)

    const ingestao = await comoServico((cli) =>
      cli.query<{ resultado: { status: string; lead_id: string } }>(
        `select public.ingerir_lead($1, $2, $3) as resultado`,
        [
          SEGREDO,
          entrega.log_id,
          JSON.stringify({
            telefone_e164: '+5511966665555',
            campanha_nome: null,
            campanha_id: '123456789',
            conjunto_id: 'adset-google-1',
            anuncio_id: 'ad-google-1',
            formulario_id: 'form-google-1',
            click_id: 'abc',
            extras: {},
          }),
        ],
      ),
    )
    // Confirma que caiu mesmo no ramo de dedup, e nao criou uma segunda lead
    // — sem isto o teste nao exercitaria o caminho que perde a atribuicao.
    expect(ingestao.rows[0].resultado.status).toBe('reincidente')
    expect(ingestao.rows[0].resultado.lead_id).toBe(leadId)

    const eventos = await comoServico((cli) =>
      cli.query<{
        payload: {
          campanha: string | null
          campanha_id: string | null
          conjunto_id: string | null
          anuncio_id: string | null
          formulario: string | null
          click_id: string | null
        }
      }>(
        `select payload from public.lead_events where lead_id = $1 and tipo = 'reingestao'`,
        [leadId],
      ),
    )
    expect(eventos.rows).toHaveLength(1)
    expect(eventos.rows[0].payload.campanha_id).toBe('123456789')
    expect(eventos.rows[0].payload.anuncio_id).toBe('ad-google-1')
    expect(eventos.rows[0].payload.click_id).toBe('abc')
    // campanha cai para o id porque o nome e nulo (caso Google) — nao deve
    // sobrar null so porque campanha_nome nao veio.
    expect(eventos.rows[0].payload.campanha).toBe('123456789')

    // A lead em si NAO foi tocada pelo ramo de dedup: continua com as colunas
    // de rastreamento nulas do cadastro manual. E exatamente por isso que o
    // evento e o unico lugar onde esta atribuicao sobrevive.
    const lead = await comoServico((cli) =>
      cli.query<{ campanha_id: string | null }>(
        `select campanha_id from public.leads where id = $1`,
        [leadId],
      ),
    )
    expect(lead.rows[0].campanha_id).toBeNull()
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
