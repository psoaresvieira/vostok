// tests/integration/0033_sweep_grants_tabela.test.ts
import { describe, it, expect } from 'vitest'
import { comoServico } from './helpers/db'

/**
 * Sweep de grants de TABELA (spec 2026-08-28-crm-sweep-grants-tabela).
 *
 * Irmao do 0024 (funcoes). O default ACL do role postgres na nuvem — e na
 * imagem local 17.6.1.147 em diante — da a anon/authenticated
 * select/insert/update/delete/references/trigger/maintain em toda tabela
 * nova e usage/select/update em toda sequencia nova. As migrations
 * 0001-0032 declararam `grant ... to authenticated` achando que so aquilo
 * existiria; o default ja tinha dado tudo. A 0033 revoga tudo e re-emite a
 * matriz declarada; este teste a torna obrigatoria: tabela nova sem decisao
 * de grant reprova o Caso 1.
 */

const PRIVILEGIOS = ['select', 'insert', 'update', 'delete', 'references', 'trigger', 'maintain'] as const
type Privilegio = (typeof PRIVILEGIOS)[number]
type Matriz = { anon: Privilegio[]; authenticated: Privilegio[] }

/**
 * Privilegios de TABELA INTEIRA (has_table_privilege nao conta grant de
 * coluna). integration_log fica vazia aqui de proposito: o select dela e'
 * por coluna (Caso 2). notifications e lead_sources tem select de tabela e
 * update por coluna.
 */
const MAPA_TABELAS: Record<string, Matriz> = {
  accounts: { anon: [], authenticated: ['select', 'update'] },
  ingestion_config: { anon: [], authenticated: [] },
  integration_log: { anon: [], authenticated: [] },
  invites: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  lead_events: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  lead_sources: { anon: [], authenticated: ['select'] },
  lead_tags: { anon: [], authenticated: ['select', 'insert', 'delete'] },
  leads: { anon: [], authenticated: ['select', 'insert', 'update'] },
  loss_reasons: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  memberships: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  notifications: { anon: [], authenticated: ['select'] },
  pipelines: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  platform_owners: { anon: [], authenticated: [] },
  profiles: { anon: [], authenticated: ['select', 'update'] },
  scripts: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  source_credentials: { anon: [], authenticated: [] },
  stage_history: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  stages: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  tags: { anon: [], authenticated: ['select', 'insert'] },
  tasks: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
  whatsapp_connections: { anon: [], authenticated: ['select'] },
  whatsapp_credentials: { anon: [], authenticated: [] },
  whatsapp_templates: { anon: [], authenticated: ['select', 'insert', 'update', 'delete'] },
}

/** Grants de COLUNA de authenticated: { tabela: { privilegio: colunas } }. */
const COLUNAS: Record<string, Record<string, string[]>> = {
  integration_log: {
    select: [
      'account_id', 'criado_em', 'erro', 'external_id', 'id', 'lead_id',
      'processado_em', 'provedor', 'source_id', 'status', 'tentativas', 'ultima_tentativa_em',
    ],
  },
  lead_sources: { update: ['ativo', 'atualizado_em', 'nome', 'responsavel_padrao_id'] },
  notifications: { update: ['lida_em'] },
}

async function tabelasDoSchema(): Promise<string[]> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by 1`,
    )
    return r.rows.map((l) => l.relname)
  })
}

async function privilegiosDeTabela(tabela: string, papel: 'anon' | 'authenticated'): Promise<Privilegio[]> {
  return comoServico(async (cli) => {
    const tem: Privilegio[] = []
    for (const p of PRIVILEGIOS) {
      const r = await cli.query<{ tem: boolean }>(
        `select has_table_privilege($1, ('public.' || quote_ident($2))::regclass, $3) as tem`,
        [papel, tabela, p],
      )
      if (r.rows[0].tem) tem.push(p)
    }
    return tem
  })
}

describe('0033 — sweep de grants de tabela', () => {
  it('Caso 1: toda tabela do schema public esta no mapa, e anon/authenticated tem exatamente o que o mapa diz', async () => {
    const noBanco = await tabelasDoSchema()
    expect(noBanco).toEqual(Object.keys(MAPA_TABELAS).sort())

    const efetivo: Record<string, Matriz> = {}
    for (const t of noBanco) {
      efetivo[t] = {
        anon: await privilegiosDeTabela(t, 'anon'),
        authenticated: await privilegiosDeTabela(t, 'authenticated'),
      }
    }
    expect(efetivo).toEqual(MAPA_TABELAS)
  })

  it('Caso 2: grants de coluna de authenticated sao exatamente os declarados, e payload_bruto nao aparece', async () => {
    const efetivo = await comoServico(async (cli) => {
      const r = await cli.query<{ table_name: string; privilege_type: string; column_name: string }>(
        `select table_name, lower(privilege_type) as privilege_type, column_name
           from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = any($1)
          order by 1, 2, 3`,
        [Object.keys(COLUNAS)],
      )
      const mapa: Record<string, Record<string, string[]>> = {}
      for (const l of r.rows) {
        // Privilegio concedido na tabela inteira aparece aqui expandido em
        // todas as colunas; so interessa o que o mapa declara por coluna.
        if (!COLUNAS[l.table_name]?.[l.privilege_type]) continue
        ;((mapa[l.table_name] ??= {})[l.privilege_type] ??= []).push(l.column_name)
      }
      return mapa
    })
    expect(efetivo).toEqual(COLUNAS)

    const payloadBruto = await comoServico(async (cli) =>
      (await cli.query<{ tem: boolean }>(
        `select has_column_privilege('authenticated', 'public.integration_log', 'payload_bruto', 'select') as tem`,
      )).rows[0].tem)
    expect(payloadBruto).toBe(false)
  })

  it('Caso 3: anon nao tem privilegio nenhum de tabela, coluna ou sequencia; authenticated so usage em lead_events_seq_seq', async () => {
    const anon = await comoServico(async (cli) => {
      const tabelas = await cli.query(
        `select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`,
      )
      const colunas = await cli.query(
        `select 1 from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public'`,
      )
      return { tabelas: tabelas.rowCount, colunas: colunas.rowCount }
    })
    expect(anon).toEqual({ tabelas: 0, colunas: 0 })

    const sequencias = await comoServico(async (cli) =>
      (await cli.query<{ relname: string; anon_usage: boolean; anon_select: boolean; anon_update: boolean; auth_usage: boolean; auth_select: boolean; auth_update: boolean }>(
        `select c.relname,
                has_sequence_privilege('anon', c.oid, 'usage') as anon_usage,
                has_sequence_privilege('anon', c.oid, 'select') as anon_select,
                has_sequence_privilege('anon', c.oid, 'update') as anon_update,
                has_sequence_privilege('authenticated', c.oid, 'usage') as auth_usage,
                has_sequence_privilege('authenticated', c.oid, 'select') as auth_select,
                has_sequence_privilege('authenticated', c.oid, 'update') as auth_update
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'S' order by 1`,
      )).rows)
    expect(sequencias).toEqual([
      {
        relname: 'lead_events_seq_seq',
        anon_usage: false, anon_select: false, anon_update: false,
        auth_usage: true, auth_select: false, auth_update: false,
      },
    ])
  })

  it('Caso 4: o default ACL do role postgres em public nao concede nada a anon/authenticated nem EXECUTE a PUBLIC', async () => {
    const defaults = await comoServico(async (cli) =>
      (await cli.query<{ tipo: string; acl: string[] | null }>(
        `select d.defaclobjtype as tipo, d.defaclacl::text[] as acl
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           join pg_namespace n on n.oid = d.defaclnamespace
          where r.rolname = 'postgres' and n.nspname = 'public'
          order by 1`,
      )).rows)
    const vazando = defaults.flatMap((d) =>
      (d.acl ?? []).filter((item) =>
        item.startsWith('anon=') || item.startsWith('authenticated=') || (d.tipo === 'f' && item.startsWith('=')),
      ).map((item) => `${d.tipo}: ${item}`),
    )
    expect(vazando).toEqual([])
  })
})
