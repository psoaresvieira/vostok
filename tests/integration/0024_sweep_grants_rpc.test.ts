import { describe, it, expect } from 'vitest'
import { comoServico } from './helpers/db'

/**
 * Sweep de grants de RPC (backlog do review final do Plano 11, item a).
 *
 * O default ACL desta imagem do Postgres deixa EXECUTE para PUBLIC em toda
 * funcao nova — entao ate a 0024 quase toda RPC do repo era executavel por
 * `anon`, incluindo `conectar_fonte_meta`, `move_lead_stage` e helpers
 * internos como `hash_segredo`. Nada disso era explorabilidade direta (as
 * definer conferem segredo/sessao por dentro, as invoker esbarram na RLS),
 * mas a autorizacao ficava implicita: quem le a migration de uma funcao nao
 * consegue dizer quem pode chama-la.
 *
 * A 0024 vira a regra: EXECUTE revogado de PUBLIC em TODA funcao do schema
 * public, e grant explicito so para o papel que o codigo de producao usa —
 * `anon` para o que os clientes anon+segredo chamam (webhooks em
 * criarIngestaoStore, disparo em criarDisparoServico), `authenticated` para o
 * que sai de sessao (Server Actions e stores DoServidor), e NENHUM papel para
 * funcao interna (triggers, helpers chamados so por dentro de definer).
 *
 * Este teste e a generalizacao do da 0023: em vez de conferir uma funcao, ele
 * enumera pg_proc e compara com um mapa explicito. Funcao nova sem decisao de
 * grant quebra o caso 1 — a decisao passa a ser obrigatoria, nao herdada do
 * default ACL.
 */

type Privilegios = { anon: boolean; authenticated: boolean }

/** Assinaturas como `oid::regprocedure::text` as imprime, em ordem alfabetica. */
const MAPA: Record<string, Privilegios> = {
  // Clientes anon + segredo: webhooks (criarIngestaoStore) e disparo
  // (criarDisparoServico). A autorizacao de verdade e o segredo, conferido
  // dentro da funcao; o grant so abre o canal do PostgREST.
  'atualizar_status_template(text,uuid,text,text)': { anon: true, authenticated: false },
  'credencial_whatsapp(text,uuid)': { anon: true, authenticated: false },
  'entregas_pendentes(text,integer)': { anon: true, authenticated: false },
  'ingerir_lead(text,uuid,jsonb)': { anon: true, authenticated: false },
  'registrar_entrega(text,provedor_lead,text,jsonb,text,text)': {
    anon: true,
    authenticated: false,
  },
  'registrar_falha(text,uuid,text)': { anon: true, authenticated: false },

  // RPCs de sessao: chamadas por stores DoServidor / Server Actions com o
  // usuario logado.
  'accept_invite(text)': { anon: false, authenticated: true },
  'conectar_fonte_google(uuid,text,text,text,uuid)': { anon: false, authenticated: true },
  'conectar_fonte_meta(text,uuid,text,text,text,uuid)': { anon: false, authenticated: true },
  'conectar_whatsapp(text,uuid,text,text,text,text,text)': { anon: false, authenticated: true },
  'contas_da_plataforma()': { anon: false, authenticated: true },
  'criar_conta(text)': { anon: false, authenticated: true },
  'criar_conta_cliente(text,text)': { anon: false, authenticated: true },
  'desconectar_fonte(uuid)': { anon: false, authenticated: true },
  'desconectar_whatsapp(text,uuid)': { anon: false, authenticated: true },
  'excluir_etapa(uuid)': { anon: false, authenticated: true },
  // Paginacao por etapa do quadro do funil (migration 0027). Invoker: a RLS
  // de leads e' quem recorta o vendedor, inclusive nos totais da coluna.
  'leads_do_funil(uuid,integer,integer,uuid,uuid,lead_origem,timestamp with time zone,text)': {
    anon: false,
    authenticated: true,
  },
  'metricas_coorte(uuid,timestamp with time zone,timestamp with time zone,uuid)': {
    anon: false,
    authenticated: true,
  },
  'metricas_etiquetas(uuid,timestamp with time zone,timestamp with time zone,uuid)': {
    anon: false,
    authenticated: true,
  },
  'move_lead_stage(uuid,uuid,uuid)': { anon: false, authenticated: true },
  // Guarda de delete da policy pipelines_membro_delete (migration 0025):
  // definer para enxergar leads de colegas que a RLS do chamador esconderia.
  'pipeline_tem_leads(uuid)': { anon: false, authenticated: true },
  'reemitir_convite(uuid)': { anon: false, authenticated: true },
  'reivindicar_fonte_meta(text,uuid,text,text,text,uuid)': { anon: false, authenticated: true },
  'reordenar_etapas(uuid[])': { anon: false, authenticated: true },
  'resumo_etapas(uuid)': { anon: false, authenticated: true },
  'sou_dono_da_plataforma()': { anon: false, authenticated: true },

  // Helpers de RLS: avaliados na pele do papel que consulta a tabela — hoje
  // sempre `authenticated`, porque `anon` nao tem select em tabela nenhuma.
  'compartilha_conta(uuid)': { anon: false, authenticated: true },
  'conta_do_pipeline(uuid)': { anon: false, authenticated: true },
  'e_membro_da_conta(uuid,uuid)': { anon: false, authenticated: true },
  // Guardas das policies de stages (migration 0026): definer pelos dois
  // motivos da guarda 5 — subquery de stages dentro de policy de stages
  // recursaria, e contagem de leads sob a RLS do chamador mentiria. Os tres
  // sao fail-closed para nao-membro, entao o EXECUTE de `authenticated` nao
  // vira sonda cross-account.
  'etapa_imutaveis_ok(uuid,stage_tipo,uuid)': { anon: false, authenticated: true },
  'etapa_tem_leads(uuid)': { anon: false, authenticated: true },
  'etapa_ultima_do_tipo(uuid)': { anon: false, authenticated: true },
  'is_member_of(uuid)': { anon: false, authenticated: true },
  'papel_na_conta(uuid)': { anon: false, authenticated: true },
  'pode_ver_lead(uuid,uuid)': { anon: false, authenticated: true },
  'pode_ver_lead_id(uuid)': { anon: false, authenticated: true },
  'stage_da_conta(uuid,uuid)': { anon: false, authenticated: true },

  // Internas: trigger nao checa EXECUTE ao disparar, e helper chamado dentro
  // de definer roda como a dona (postgres). Nenhum cliente executa direto.
  'backfill_snapshot_etapas()': { anon: false, authenticated: false },
  // Trigger de statement da 0026 (emenda de 2026-08-17): fecha o delete em
  // LOTE de etapas, que a policy linha-a-linha deixava passar.
  'guarda_ultima_etapa_do_tipo()': { anon: false, authenticated: false },
  'handle_new_user()': { anon: false, authenticated: false },
  'hash_segredo(text)': { anon: false, authenticated: false },
  'montar_conta(text)': { anon: false, authenticated: false },
  'segredo_confere(text)': { anon: false, authenticated: false },
  'snapshot_lead_tags()': { anon: false, authenticated: false },
  'snapshot_stage_history()': { anon: false, authenticated: false },
}

type LinhaAcl = {
  assinatura: string
  acl: string[] | null
  anon: boolean
  authenticated: boolean
}

async function aclDasFuncoes(): Promise<LinhaAcl[]> {
  return comoServico(async (cli) => {
    const r = await cli.query<LinhaAcl>(
      `select p.oid::regprocedure::text as assinatura,
              p.proacl::text[] as acl,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        order by 1`,
    )
    return r.rows
  })
}

describe('0024 — sweep de grants de RPC', () => {
  it('Caso 1: toda funcao do schema public esta no mapa, e o mapa nao cita funcao morta', async () => {
    // Ordena os dois lados no JS: a colacao do Postgres discorda do sort do
    // JS em pontuacao ('pode_ver_lead(' vs 'pode_ver_lead_id(').
    const noBanco = (await aclDasFuncoes())
      .map((l) => l.assinatura)
      .sort()
    const noMapa = Object.keys(MAPA).sort()
    // Comparacao nos dois sentidos num assert so: funcao nova sem decisao de
    // grant aparece aqui, e entrada morta no mapa tambem.
    expect(noBanco).toEqual(noMapa)
  })

  it('Caso 2: nenhuma funcao concede EXECUTE a PUBLIC — nem pelo default ACL (proacl nulo)', async () => {
    const comPublic = (await aclDasFuncoes())
      // proacl nulo significa "vale o default", e o default desta imagem da
      // EXECUTE a PUBLIC — entao nulo reprova igual a uma entrada `=X/` (a
      // grafia de aclitem para grantee PUBLIC).
      .filter((l) => l.acl === null || l.acl.some((item) => item.startsWith('=')))
      .map((l) => l.assinatura)
    expect(comPublic).toEqual([])
  })

  it('Caso 3: anon e authenticated tem exatamente o EXECUTE que o mapa diz', async () => {
    const efetivo = Object.fromEntries(
      (await aclDasFuncoes()).map((l) => [
        l.assinatura,
        { anon: l.anon, authenticated: l.authenticated },
      ]),
    )
    expect(efetivo).toEqual(MAPA)
  })
})
