import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

const SEGREDO = 'segredo-de-ingestao-local'
const ERRADO = 'segredo-errado'
const VAZIO = '00000000-0000-0000-0000-000000000000'

type ResultadoEntrega = {
  log_id: string | null
  status: string
  token: string | null
  externalId: string
}
type ResultadoIngestao = { status: string; lead_id: string | null }

let contador = 0
/** Sufixo unico por chamada: varios casos disparam varias entregas na mesma conta. */
function unico(prefixo: string): string {
  contador += 1
  return `${prefixo}-${contador}`
}

/** Cria uma fonte Meta direto nas tabelas — nao pela RPC, que muda na Task 10. */
async function criarFonteMeta(
  c: { accountId: string },
  opts: { responsavelPadraoId?: string | null; ativo?: boolean } = {},
): Promise<{ sourceId: string; externalId: string }> {
  const externalId = unico('page')
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome, responsavel_padrao_id, ativo)
       values ($1, 'meta', $2, $3, $4, $5) returning id`,
      [
        c.accountId,
        externalId,
        `Page ${externalId}`,
        opts.responsavelPadraoId ?? null,
        opts.ativo ?? true,
      ],
    )
    await cli.query(
      `insert into public.source_credentials (source_id, meta_page_token) values ($1, 'tok')`,
      [r.rows[0].id],
    )
    return { sourceId: r.rows[0].id, externalId }
  })
}

/** Chama registrar_entrega (Task 3) para gerar o log_id que ingerir_lead consome. */
async function registrarEntrega(
  chaveDaFonte: string,
  payload: unknown = {},
  segredo = SEGREDO,
): Promise<ResultadoEntrega> {
  const externalId = unico('ext')
  return comoServico(async (cli) => {
    const r = await cli.query<{ resultado: Omit<ResultadoEntrega, 'externalId'> }>(
      `select public.registrar_entrega($1, 'meta', $2, $3, $4) as resultado`,
      [segredo, externalId, JSON.stringify(payload), chaveDaFonte],
    )
    return { ...r.rows[0].resultado, externalId }
  })
}

/** Insere integration_log direto, pendente e sem source_id — estado que registrar_entrega nunca produz (fonte desconhecida vira 'ignorado', nao 'pendente'), mas que ingerir_lead precisa recusar mesmo assim. */
async function inserirLogPendenteSemFonte(): Promise<string> {
  const externalId = unico('sem-fonte')
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.integration_log (account_id, source_id, provedor, external_id, payload_bruto, status)
       values (null, null, 'meta', $1, '{}'::jsonb, 'pendente') returning id`,
      [externalId],
    )
    return r.rows[0].id
  })
}

async function ingerirLead(
  logId: string,
  dados: unknown,
  segredo = SEGREDO,
): Promise<ResultadoIngestao> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ resultado: ResultadoIngestao }>(
      `select public.ingerir_lead($1, $2, $3) as resultado`,
      [segredo, logId, JSON.stringify(dados)],
    )
    return r.rows[0].resultado
  })
}

/** p_dados padrao para o caminho feliz; cada campo pode ser sobrescrito por caso. */
function dadosPadrao(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Fulano de Tal',
    telefone: '11 99999-9999',
    telefone_e164: '+5511999999999',
    email: 'fulano@example.com',
    email_norm: 'fulano@example.com',
    empresa: 'ACME',
    campanha_origem: 'campanha-x',
    formulario_origem: 'form-y',
    extras: { pergunta: 'resposta' },
    ...overrides,
  }
}

async function buscarLead(leadId: string) {
  return comoServico(async (cli) => {
    const r = await cli.query('select * from public.leads where id = $1', [leadId])
    return r.rows[0]
  })
}

async function buscarLog(logId: string) {
  return comoServico(async (cli) => {
    const r = await cli.query('select * from public.integration_log where id = $1', [logId])
    return r.rows[0]
  })
}

async function buscarNotifications(leadId: string) {
  return comoServico(async (cli) => {
    const r = await cli.query('select * from public.notifications where lead_id = $1', [leadId])
    return r.rows
  })
}

async function buscarLeadEvents(leadId: string, tipo: string) {
  return comoServico(async (cli) => {
    const r = await cli.query(
      'select * from public.lead_events where lead_id = $1 and tipo = $2',
      [leadId, tipo],
    )
    return r.rows
  })
}

async function buscarStageHistory(leadId: string) {
  return comoServico(async (cli) => {
    const r = await cli.query('select * from public.stage_history where lead_id = $1', [leadId])
    return r.rows
  })
}

async function contarLeadsDaConta(accountId: string): Promise<number> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ n: string }>(
      'select count(*) as n from public.leads where account_id = $1',
      [accountId],
    )
    return Number(r.rows[0].n)
  })
}

async function marcarStatusLead(leadId: string, status: 'aberto' | 'ganho' | 'perdido') {
  await comoServico((cli) => cli.query('update public.leads set status = $2 where id = $1', [leadId, status]))
}

/**
 * Uma segunda conta, independente da montada em beforeEach — para o caso 9
 * (dedup nao atravessa contas). Nao usa montarCenario() de novo porque ele
 * cria usuarios com emails fixos (admin@a.com etc.); uma segunda chamada
 * colidiria com o unique parcial de auth.users. criar_conta ja semeia
 * pipeline e etapas padrao, entao basta o admin e um membro para dono do lead.
 */
async function contaSecundaria(): Promise<{ accountId: string; vendedorId: string }> {
  const sufixo = unico('conta-b')
  const adminId = await criarUsuario(`admin-${sufixo}@b.com`)
  const vendedorId = await criarUsuario(`vend-${sufixo}@b.com`)
  const accountId = await comoUsuario(
    adminId,
    async (cli) =>
      (await cli.query<{ id: string }>('select public.criar_conta($1) as id', ['Conta B'])).rows[0].id,
  )
  await comoServico((cli) =>
    cli.query(`insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'vendedor')`, [
      accountId,
      vendedorId,
    ]),
  )
  return { accountId, vendedorId }
}

describe('0011 — ingerir_lead: decide se a entrega vira card ou aviso', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  // Caso 1
  it('segredo errado recusa', async () => {
    await expect(ingerirLead(VAZIO, {}, ERRADO)).rejects.toThrow(/segredo_invalido/)
  })

  // Log inexistente, agora com o segredo CERTO — o caso 1 usa segredo errado e
  // por isso nunca passa da porteira do segredo; nunca chega no lookup do log.
  it('log_id inexistente com segredo correto levanta log_nao_encontrado', async () => {
    await expect(ingerirLead(VAZIO, dadosPadrao())).rejects.toThrow(/log_nao_encontrado/)
  })

  // Caso 2
  it('caminho feliz cria o lead na primeira etapa aberta do pipeline padrao', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)

    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())
    expect(resultado.status).toBe('criado')
    expect(resultado.lead_id).not.toBeNull()

    const lead = await buscarLead(resultado.lead_id!)
    expect(lead.origem).toBe('meta')
    expect(lead.campanha_origem).toBe('campanha-x')
    expect(lead.formulario_origem).toBe('form-y')
    expect(lead.responsavel_id).toBe(c.vendedorAId)
    expect(lead.pipeline_id).toBe(c.pipelineId)
    expect(lead.stage_id).toBe(etapa(c, 'Novo lead'))
  })

  // Caso 3
  it('cria stage_history e um lead_events criado_por_webhook com ator_id nulo', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)
    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())

    const historico = await buscarStageHistory(resultado.lead_id!)
    expect(historico).toHaveLength(1)
    expect(historico[0].stage_origem).toBeNull()
    expect(historico[0].stage_destino).toBe(etapa(c, 'Novo lead'))
    expect(historico[0].movido_por).toBeNull()

    const eventos = await buscarLeadEvents(resultado.lead_id!, 'criado_por_webhook')
    expect(eventos).toHaveLength(1)
    expect(eventos[0].ator_id).toBeNull()
    expect(eventos[0].payload.provedor).toBe('meta')
    expect(eventos[0].payload.external_id).toBe(entrega.externalId)
    expect(eventos[0].payload.extras).toEqual({ pergunta: 'resposta' })
  })

  // Nao esta na lista numerada do brief, mas fecha um buraco que ela nomeia
  // explicitamente: com o seed padrao a etapa de `ordem = 1` e SEMPRE 'aberta',
  // entao nenhum dos 16 casos acima discrimina "primeira etapa aberta" de
  // "primeira etapa por ordem" — os dois escolhem a mesma linha. Aqui a conta
  // reordena para que uma etapa de tipo 'ganho' fique na frente por ordem, e
  // ainda assim o lead tem que nascer numa etapa aberta.
  it('primeira etapa ABERTA, mesmo quando uma etapa de ganho tem ordem menor', async () => {
    await comoServico((cli) =>
      cli.query(
        `update public.stages set ordem = 0 where pipeline_id = $1 and nome = 'Ganho'`,
        [c.pipelineId],
      ),
    )

    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)
    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())

    const lead = await buscarLead(resultado.lead_id!)
    expect(lead.stage_id).toBe(etapa(c, 'Novo lead'))
    // Nao `expect(lead.status).toBe('aberto')`: a coluna tem default 'aberto' e
    // nada aqui a muda, entao essa asserção vale sempre, mesmo se a busca
    // escolhesse a etapa de Ganho por engano. O que prova a escolha certa e o
    // `tipo` da etapa resolvida, nao a coluna `status`.
    const stageEscolhida = c.etapas.find((e) => e.id === lead.stage_id)
    expect(stageEscolhida?.tipo).toBe('aberta')
  })

  // Caso 4
  it('cria notification novo_lead para o responsavel padrao, e nenhuma quando a fonte nao tem responsavel', async () => {
    const fonteComResp = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega1 = await registrarEntrega(fonteComResp.externalId)
    const r1 = await ingerirLead(entrega1.log_id!, dadosPadrao())
    const notifs1 = await buscarNotifications(r1.lead_id!)
    expect(notifs1).toHaveLength(1)
    expect(notifs1[0].usuario_id).toBe(c.vendedorAId)
    expect(notifs1[0].tipo).toBe('novo_lead')

    const fonteSemResp = await criarFonteMeta(c)
    const entrega2 = await registrarEntrega(fonteSemResp.externalId)
    const r2 = await ingerirLead(
      entrega2.log_id!,
      dadosPadrao({ telefone_e164: '+5511888887777', email_norm: 'sem-resp@example.com' }),
    )
    const notifs2 = await buscarNotifications(r2.lead_id!)
    expect(notifs2).toHaveLength(0)
  })

  // Caso 5
  it('fecha o log: status processado, lead_id apontando pro lead, processado_em preenchido', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)
    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())

    const log = await buscarLog(entrega.log_id!)
    expect(log.status).toBe('processado')
    expect(log.lead_id).toBe(resultado.lead_id)
    expect(log.processado_em).not.toBeNull()
  })

  // Caso 6
  it('dedup por telefone contra lead ABERTO nao cria card novo', async () => {
    const fonte1 = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega1 = await registrarEntrega(fonte1.externalId)
    const r1 = await ingerirLead(entrega1.log_id!, dadosPadrao({ telefone_e164: '+5511977776666' }))

    const antesCount = await contarLeadsDaConta(c.accountId)

    // Fonte diferente, com responsavel padrao diferente: a notificacao tem que
    // ir para o dono do lead existente (vendedorA), nao para o da fonte (gestor).
    const fonte2 = await criarFonteMeta(c, { responsavelPadraoId: c.gestorId })
    const entrega2 = await registrarEntrega(fonte2.externalId)
    const r2 = await ingerirLead(
      entrega2.log_id!,
      dadosPadrao({ telefone_e164: '+5511977776666', email_norm: 'outro6@example.com' }),
    )

    expect(r2.status).toBe('reincidente')
    expect(r2.lead_id).toBe(r1.lead_id)

    const depoisCount = await contarLeadsDaConta(c.accountId)
    expect(depoisCount).toBe(antesCount)

    const eventos = await buscarLeadEvents(r1.lead_id!, 'reingestao')
    expect(eventos).toHaveLength(1)
    expect(eventos[0].ator_id).toBeNull()
    expect(eventos[0].payload.external_id).toBe(entrega2.externalId)

    const notifs = await buscarNotifications(r1.lead_id!)
    const reincidentes = notifs.filter((n) => n.tipo === 'lead_reincidente')
    expect(reincidentes).toHaveLength(1)
    expect(reincidentes[0].usuario_id).toBe(c.vendedorAId)
  })

  // Caso 7
  it('dedup por email tem o mesmo comportamento', async () => {
    const fonte1 = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega1 = await registrarEntrega(fonte1.externalId)
    const r1 = await ingerirLead(
      entrega1.log_id!,
      dadosPadrao({ telefone_e164: null, email_norm: 'igual7@example.com' }),
    )

    const fonte2 = await criarFonteMeta(c, { responsavelPadraoId: c.gestorId })
    const entrega2 = await registrarEntrega(fonte2.externalId)
    const r2 = await ingerirLead(
      entrega2.log_id!,
      dadosPadrao({ telefone_e164: null, email_norm: 'igual7@example.com' }),
    )

    expect(r2.status).toBe('reincidente')
    expect(r2.lead_id).toBe(r1.lead_id)

    const notifs = await buscarNotifications(r1.lead_id!)
    const reincidentes = notifs.filter((n) => n.tipo === 'lead_reincidente')
    expect(reincidentes).toHaveLength(1)
    expect(reincidentes[0].usuario_id).toBe(c.vendedorAId)
  })

  // Caso 8
  it('lead PERDIDO ou GANHO nao e duplicata: recompra e lead novo', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })

    const entrega1 = await registrarEntrega(fonte.externalId)
    const r1 = await ingerirLead(entrega1.log_id!, dadosPadrao({ telefone_e164: '+5511955554444' }))
    await marcarStatusLead(r1.lead_id!, 'perdido')

    const entrega2 = await registrarEntrega(fonte.externalId)
    const r2 = await ingerirLead(
      entrega2.log_id!,
      dadosPadrao({ telefone_e164: '+5511955554444', email_norm: 'recompra-perdido@example.com' }),
    )
    expect(r2.status).toBe('criado')
    expect(r2.lead_id).not.toBe(r1.lead_id)
    await marcarStatusLead(r2.lead_id!, 'ganho')

    const entrega3 = await registrarEntrega(fonte.externalId)
    const r3 = await ingerirLead(
      entrega3.log_id!,
      dadosPadrao({ telefone_e164: '+5511955554444', email_norm: 'recompra-ganho@example.com' }),
    )
    expect(r3.status).toBe('criado')
    expect(r3.lead_id).not.toBe(r1.lead_id)
    expect(r3.lead_id).not.toBe(r2.lead_id)
  })

  // Caso 9
  it('dedup nao atravessa contas', async () => {
    const c2 = await contaSecundaria()
    const fonte2 = await criarFonteMeta(c2, { responsavelPadraoId: c2.vendedorId })
    const entregaC2 = await registrarEntrega(fonte2.externalId)
    // Se essa ingestao de setup parasse de produzir um lead aberto (ex.: cair
    // no dedup por engano), a asserção de isolamento la embaixo passaria por
    // vacuidade — nao haveria nenhuma lead na conta 2 pra vazar de qualquer jeito.
    const rSetup = await ingerirLead(entregaC2.log_id!, dadosPadrao({ telefone_e164: '+5511933332222' }))
    expect(rSetup.status).toBe('criado')

    const fonte1 = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega1 = await registrarEntrega(fonte1.externalId)
    const r1 = await ingerirLead(
      entrega1.log_id!,
      dadosPadrao({ telefone_e164: '+5511933332222', email_norm: 'outra-conta@example.com' }),
    )

    expect(r1.status).toBe('criado')
  })

  // Caso 10
  it('idempotencia: mesmo log_id devolve ja_processado na segunda chamada e nao cria nada', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)
    const r1 = await ingerirLead(entrega.log_id!, dadosPadrao())
    expect(r1.status).toBe('criado')

    const antesCount = await contarLeadsDaConta(c.accountId)
    const r2 = await ingerirLead(entrega.log_id!, dadosPadrao())
    expect(r2.status).toBe('ja_processado')
    expect(r2.lead_id).toBe(r1.lead_id)

    const depoisCount = await contarLeadsDaConta(c.accountId)
    expect(depoisCount).toBe(antesCount)
  })

  // Caso 11
  it('entrega ignorado nao vira lead', async () => {
    const entrega = await registrarEntrega('page-desconhecida-11')
    expect(entrega.status).toBe('ignorado')

    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())
    expect(resultado.status).toBe('ja_processado')
    expect(resultado.lead_id).toBeNull()
  })

  // Caso 12
  it('entrega falhou e reprocessavel: e aceita e vira processado', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)
    await comoServico((cli) =>
      cli.query('select public.registrar_falha($1, $2, $3)', [SEGREDO, entrega.log_id, 'erro de teste']),
    )
    const logAntes = await buscarLog(entrega.log_id!)
    expect(logAntes.status).toBe('falhou')

    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())
    expect(resultado.status).toBe('criado')

    const logDepois = await buscarLog(entrega.log_id!)
    expect(logDepois.status).toBe('processado')
  })

  // Ingestao bem sucedida tem que LIMPAR o erro que uma falha anterior deixou
  // gravado — sem isto, remover `erro = null` das duas atualizacoes finais
  // deixaria a suite verde inteira e um erro obsoleto visivel para sempre no
  // painel de diagnostico.
  it('ingestao bem sucedida limpa o erro deixado por uma falha anterior', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega = await registrarEntrega(fonte.externalId)
    await comoServico((cli) =>
      cli.query('select public.registrar_falha($1, $2, $3)', [SEGREDO, entrega.log_id, 'erro de teste']),
    )
    const logAntes = await buscarLog(entrega.log_id!)
    expect(logAntes.erro).not.toBeNull()

    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())
    expect(resultado.status).toBe('criado')

    const logDepois = await buscarLog(entrega.log_id!)
    expect(logDepois.erro).toBeNull()
  })

  // Caso 13
  it('nome ausente ou em branco vira "Lead sem nome"', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })

    // Contato distinto em cada chamada — nome-ausente e nome-em-branco precisam
    // ser leads DIFERENTES para o teste provar algo. Com o mesmo email_norm nos
    // dois (como dadosPadrao ja fornece por padrao), a segunda ingestao bateria
    // no dedup, devolveria 'reincidente' sem criar lead nenhum, e a asserção
    // final so reconfirmaria o nome gravado pela PRIMEIRA chamada — nunca
    // exercitando o caminho `btrim` de um nome so-espacos.
    const entrega1 = await registrarEntrega(fonte.externalId)
    const r1 = await ingerirLead(
      entrega1.log_id!,
      dadosPadrao({
        nome: undefined,
        telefone_e164: '+5511911112222',
        email_norm: 'sem-nome-ausente@example.com',
      }),
    )
    expect(r1.status).toBe('criado')
    const lead1 = await buscarLead(r1.lead_id!)
    expect(lead1.nome).toBe('Lead sem nome')

    const entrega2 = await registrarEntrega(fonte.externalId)
    const r2 = await ingerirLead(
      entrega2.log_id!,
      dadosPadrao({
        nome: '   ',
        telefone_e164: '+5511911113333',
        email_norm: 'sem-nome-espacos@example.com',
      }),
    )
    expect(r2.status).toBe('criado')
    expect(r2.lead_id).not.toBe(r1.lead_id)
    const lead2 = await buscarLead(r2.lead_id!)
    expect(lead2.nome).toBe('Lead sem nome')
  })

  // Caso 14 — checkpoint obrigatorio do brief.
  it('responsavel padrao que nao e mais membro da conta e nulificado, nao gravado', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    await comoServico((cli) =>
      cli.query('delete from public.memberships where account_id = $1 and user_id = $2', [
        c.accountId,
        c.vendedorAId,
      ]),
    )

    const entrega = await registrarEntrega(fonte.externalId)
    const resultado = await ingerirLead(entrega.log_id!, dadosPadrao())

    const lead = await buscarLead(resultado.lead_id!)
    expect(lead.responsavel_id).toBeNull()
  })

  // Caso 14b — mesmo guard do caso 14, so que no caminho de dedup. Achado 1
  // do review final: v_dono vem de leads.responsavel_id de um lead ja
  // existente, sem passar por e_membro_da_conta antes desta correcao.
  it('dono do lead existente que nao e mais membro da conta nao recebe notification de reincidencia (caminho de dedup)', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })
    const entrega1 = await registrarEntrega(fonte.externalId)
    const r1 = await ingerirLead(entrega1.log_id!, dadosPadrao({ telefone_e164: '+5511900001111' }))
    expect(r1.status).toBe('criado')

    // Revoga a membership de quem ficou dono do lead, sem tocar
    // responsavel_id -- exatamente o cenario que o comentario da 0011
    // descreve: nada nulifica responsavel_id na revogacao.
    await comoServico((cli) =>
      cli.query('delete from public.memberships where account_id = $1 and user_id = $2', [
        c.accountId,
        c.vendedorAId,
      ]),
    )

    const fonte2 = await criarFonteMeta(c, { responsavelPadraoId: c.gestorId })
    const entrega2 = await registrarEntrega(fonte2.externalId)
    const r2 = await ingerirLead(
      entrega2.log_id!,
      dadosPadrao({ telefone_e164: '+5511900001111', email_norm: 'outro14b@example.com' }),
    )

    expect(r2.status).toBe('reincidente')
    expect(r2.lead_id).toBe(r1.lead_id)

    const notifs = await buscarNotifications(r1.lead_id!)
    const reincidentes = notifs.filter((n) => n.tipo === 'lead_reincidente')
    expect(reincidentes).toHaveLength(0)
  })

  // Caso 15
  it('log sem source_id levanta fonte_nao_encontrada', async () => {
    const logId = await inserirLogPendenteSemFonte()
    await expect(ingerirLead(logId, dadosPadrao())).rejects.toThrow(/fonte_nao_encontrada/)
  })

  // Caso 16
  it('sem telefone e sem email nao deduplica com ninguem', async () => {
    const fonte = await criarFonteMeta(c, { responsavelPadraoId: c.vendedorAId })

    const entrega1 = await registrarEntrega(fonte.externalId)
    const r1 = await ingerirLead(entrega1.log_id!, dadosPadrao({ telefone_e164: null, email_norm: null }))
    expect(r1.status).toBe('criado')

    const entrega2 = await registrarEntrega(fonte.externalId)
    const r2 = await ingerirLead(entrega2.log_id!, dadosPadrao({ telefone_e164: null, email_norm: null }))
    expect(r2.status).toBe('criado')
    expect(r2.lead_id).not.toBe(r1.lead_id)

    const count = await contarLeadsDaConta(c.accountId)
    expect(count).toBe(2)
  })
})
