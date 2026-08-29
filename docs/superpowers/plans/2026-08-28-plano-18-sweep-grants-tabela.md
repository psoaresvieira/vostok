# Plano 18 — Sweep de grants de tabela (0033)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma migration (`0033`) revoga de `anon`/`authenticated` todo privilégio de tabela e sequência que o default ACL da nuvem concedeu sem ninguém decidir, re-emite exatamente os grants que as migrations 0001–0032 declararam, fecha o default para objetos futuros, e um teste de sweep (espelho do 0024) torna essa matriz obrigatória.

**Architecture:** Só banco — nenhuma mudança de app, RLS ou RPC. A matriz pretendida é a soma literal dos `grant … to authenticated` das migrations (mais `usage` na única sequência que um insert por sessão precisa). O teste lê o catálogo (`has_table_privilege`, `information_schema.column_privileges`, `pg_default_acl`) e compara por igualdade total. Os 5 testes de integração hoje vermelhos voltam a verde sem edição. Rollout: ensaio local completo → `db push` → sonda → smoke; rollback é um script fora da pasta de migrations.

**Tech Stack:** Supabase/Postgres 17 (`npx supabase`, binário fora do PATH; Docker Desktop precisa estar ligado), vitest integração (`tests/integration`, helper `comoServico` = conexão como `postgres`), Playwright E2E.

Spec: `docs/superpowers/specs/2026-08-28-crm-sweep-grants-tabela-design.md`.

## Global Constraints

- `anon` **não recebe grant nenhum** de tabela nem de sequência (todo caminho anon é RPC `security definer` + segredo).
- `service_role` **não é tocado** (nem revoke nem grant).
- A matriz de `authenticated` é **copiada byte-fiel** das migrations; nenhum grant é julgado ou reduzido. Se um caminho de sessão quebrar no ensaio, a correção é **declarar o grant na 0033 com comentário**, nunca afrouxar o sweep nem editar teste existente.
- Grants de coluna exatos: `integration_log` select em `(id, account_id, source_id, provedor, external_id, status, erro, tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em)` — **sem `payload_bruto`**; `lead_sources` update em `(nome, responsavel_padrao_id, ativo, atualizado_em)`; `notifications` update em `(lida_em)`.
- Sequência: `usage on sequence public.lead_events_seq_seq to authenticated` (coluna `seq` serial de `lead_events`; a sessão insere em `lead_events` por notas/etiquetas e pelas RPCs invoker de movimento). Nenhuma outra sequência existe (`relkind = 'S'`).
- Default privileges do role `postgres` no schema `public`: revogar de `anon, authenticated` em tabelas e sequências; revogar `execute` de `public, anon, authenticated` em funções.
- Os 5 testes hoje vermelhos (`0008` "nao anula external_id…", `0009` "integration_log recusa select *…" e "notifications nao aceita insert…", `0019` "whatsapp_credentials e whatsapp_connections sao inalcancaveis…", `entregas-recentes` "payload_bruto nao e alcancavel…") **não são editados**.
- Identificadores sem acento; comentários em português. Branch `plano-18-sweep-grants-tabela` a partir de `master` (`363d046` ou posterior).
- Ordem das suítes: `npm test` → `npx supabase db reset` → `npm run test:integration` → `npm run db:reset` → `npm run test:e2e` (a integração apaga `auth.users`; derrubar qualquer `next dev` antes do E2E).

---

### Task 1: Teste de sweep de tabelas (vermelho contra o banco atual)

**Files:**
- Create: `tests/integration/0033_sweep_grants_tabela.test.ts`

**Interfaces:**
- Consumes: `comoServico` de `tests/integration/helpers/db.ts` (`comoServico<T>(fn: (c: pg.Client) => Promise<T>): Promise<T>`, conecta como `postgres`).
- Produces: o mapa `MAPA_TABELAS` e `COLUNAS` abaixo — a Task 2 escreve a migration para satisfazê-los; qualquer desvio é da migration, não do mapa.

- [ ] **Step 1: Escrever o teste**

```ts
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
```

- [ ] **Step 2: Garantir banco limpo e rodar — ver falhar**

Run: `npx supabase db reset && npm run test:integration -- 0033`
Expected: Caso 1 FAIL (`efetivo` tem `anon: ['select','insert','update','delete','references','trigger','maintain']` em 19 tabelas); Caso 3 FAIL (anon com linhas em `role_table_grants`; sequência com `anon_usage: true`); Caso 4 FAIL (`r: anon=arwdxtm/postgres`, `S: …`, `f: anon=X/postgres` etc.). Caso 2 pode passar ou falhar — irrelevante agora. Guardar a saída para o relatório (é o RED).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/0033_sweep_grants_tabela.test.ts
git commit -m "test(db): sweep de grants de tabela (vermelho ate a 0033)"
```

---

### Task 2: Migration 0033 + script de rollback

**Files:**
- Create: `supabase/migrations/0033_sweep_grants_tabela.sql`
- Create: `supabase/rollback/0033_rollback.sql` (fora de `migrations/`; `db push` não o vê)

**Interfaces:**
- Consumes: mapa da Task 1.
- Produces: banco em que `0033_sweep_grants_tabela.test.ts` e os 5 testes vermelhos passam.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/0033_sweep_grants_tabela.sql
-- Sweep de grants de TABELA e sequencia (spec 2026-08-28-crm-sweep-grants-tabela).
--
-- O default ACL do role postgres na nuvem Supabase (e na imagem local
-- 17.6.1.147 em diante) concede a anon/authenticated arwdxtm em toda tabela
-- nova e rwU em toda sequencia nova. As migrations 0001-0032 escreveram
-- `grant ... to authenticated` como se fosse o UNICO grant, e `revoke ...
-- from public` como se fechasse a tabela — nenhum dos dois remove o grant
-- explicito que o default ja tinha dado. Em producao, 19 tabelas estavam
-- abertas a anon/authenticated e so a RLS as segurava; cinco testes de
-- integracao (0008, 0009, 0019, entregas-recentes) esperam `permission
-- denied` e recebiam `violates row-level security`.
--
-- A 0029 cobriu so TRUNCATE (por default privilege); a 0031/0032 fecharam
-- as FUNCOES. Esta fecha tabelas e sequencias, e o default para o futuro.
--
-- Regras: (1) anon nao recebe grant nenhum — todo caminho sem sessao passa
-- por RPC security definer gateada por segredo, que roda como dona das
-- tabelas (a 0021 provou que revogar tudo de anon nao quebra definer);
-- (2) a matriz de authenticated abaixo e' COPIA literal dos grants das
-- migrations de origem, nao um julgamento — reduzir grant e' outra spec;
-- (3) service_role nao e' tocado.

-- 1. Zera tudo que o default deu.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 2. Re-emite a matriz declarada, byte-fiel, uma tabela por bloco.
-- 0001
grant select, update on public.accounts to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invites to authenticated;
-- 0002
grant select, insert, update, delete on public.pipelines to authenticated;
grant select, insert, update, delete on public.stages to authenticated;
grant select, insert, update, delete on public.loss_reasons to authenticated;
-- 0003
grant select, insert, update on public.leads to authenticated;
grant select, insert on public.tags to authenticated;
grant select, insert, delete on public.lead_tags to authenticated;
grant select, insert, update, delete on public.stage_history to authenticated;
grant select, insert, update, delete on public.lead_events to authenticated;
-- lead_events.seq e' serial: o nextval do default roda como o papel que
-- insere. Sem usage, toda nota/etiqueta por sessao e as RPCs invoker de
-- movimento (move_lead_stage, mover_lead_pipeline) morrem com 42501.
grant usage on sequence public.lead_events_seq_seq to authenticated;
-- 0008 (update so nas colunas editaveis pela UI; external_id fica fora)
grant select, update (nome, responsavel_padrao_id, ativo, atualizado_em) on public.lead_sources to authenticated;
-- 0009 (select por coluna: payload_bruto fica fora; update so de lida_em)
grant select (id, account_id, source_id, provedor, external_id, status, erro,
              tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em)
  on public.integration_log to authenticated;
grant select, update (lida_em) on public.notifications to authenticated;
-- 0015
grant select, insert, update, delete on public.tasks to authenticated;
-- 0019
grant select on public.whatsapp_connections to authenticated;
-- 0020
grant select, insert, update, delete on public.scripts to authenticated;
-- 0022
grant select, insert, update, delete on public.whatsapp_templates to authenticated;
-- Fechadas de proposito, sem grant: ingestion_config e source_credentials
-- (0021), whatsapp_credentials (0019), platform_owners (0028).

-- 3. Default fechado: tabela, sequencia e funcao futuras nascem sem nada
-- para anon/authenticated (e funcao sem EXECUTE para PUBLIC). O grant
-- explicito por migration — ja a convencao do repo — vira obrigatorio; o
-- sweep 0024 pega funcao sem grant e o teste 0033 pega tabela sem grant.
-- Limite (ver 0029): edita so o default ACL de postgres; o de supabase_admin
-- cobre objetos criados pela plataforma, nao por migration.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
```

- [ ] **Step 2: Escrever o rollback (fora da pasta de migrations)**

```sql
-- supabase/rollback/0033_rollback.sql
-- Desfaz a 0033 restaurando o default ACL que a nuvem tinha dado. So' para
-- rodar A MAO no SQL editor se a sonda ou o smoke pos-push falhar; nunca por
-- `db push` (esta fora de supabase/migrations de proposito). Depois de rodar,
-- `npx supabase migration repair --status reverted 0033`.
grant select, insert, update, delete, references, trigger, maintain
  on all tables in schema public to anon, authenticated;
grant usage, select, update on all sequences in schema public to anon, authenticated;
-- As tabelas que ja eram fechadas ANTES da 0033 voltam a ser fechadas:
revoke all on public.ingestion_config, public.source_credentials,
              public.whatsapp_credentials, public.platform_owners from anon, authenticated;
revoke truncate on all tables in schema public from anon, authenticated; -- 0029
alter default privileges in schema public grant select, insert, update, delete, references, trigger, maintain on tables to anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated; -- 0029
alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to public, anon, authenticated;
```

- [ ] **Step 3: Aplicar e rodar o teste novo — ver passar**

Run: `npx supabase db reset && npm run test:integration -- 0033`
Expected: 4/4 PASS. Se o Caso 1 acusar tabela fora do mapa ou privilégio a mais: a migration está errada, não o mapa (conferir a linha contra a migration de origem).

- [ ] **Step 4: Rodar os 5 testes que estavam vermelhos — ver passar SEM edição**

Run: `npm run test:integration -- 0008 0009 0019 entregas-recentes`
Expected: todos PASS (o `git diff --stat tests/` mostra só o arquivo da Task 1).

- [ ] **Step 5: Suíte de integração inteira**

Run: `npm run test:integration`
Expected: **356/356** (352 + 4 novos). Qualquer vermelho novo é um caminho de sessão que só funcionava pelo default: identificar a tabela/coluna no erro `42501`, **declarar o grant na 0033 com comentário citando o teste**, e relatar. Não editar teste existente.

- [ ] **Step 6: Unit + E2E**

Run: `npm test && npm run typecheck && npm run lint` (nada muda, mas prova que a árvore está sã), depois `npm run db:reset && npm run test:e2e` (derrubar `next dev` antes).
Expected: 833 unit; E2E 24/24. Um E2E vermelho por `42501` recebe o mesmo tratamento do Step 5.

- [ ] **Step 7: Smoke manual dos caminhos anon** — com `next dev` e `.env` local: `curl -X POST` no webhook de ingestão de teste (o repo tem fixture/rota; ver `tests/e2e/ingestao.spec.ts` para o corpo e o segredo do `seed.sql`) → lead aparece no funil; rota de reprocesso (`/api/cron/...`, ver `README.md` "Reprocessamento de leads (cron)") responde 200. Registrar no relatório o que foi chamado e a resposta.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0033_sweep_grants_tabela.sql supabase/rollback/0033_rollback.sql
git commit -m "feat(db): 0033 sweep de grants de tabela — anon sem nada, matriz declarada, default fechado"
```

---

### Task 3: Rollout em produção (operador — controller com o Pedro)

**Files:** `supabase/sondas/0033_pre_push.sql` (sonda pré-push, seções A–E devem voltar 0 linhas), `supabase/sondas/0033_verificar.sql` (matriz completa: 0 linhas = estado correto; validada por mutação na review final); memória e ledger.

> Emendado após a review final da branch (2026-08-28): a versão anterior não tinha sonda pré-push, não checava dono/grantor (num banco antigo, `REVOKE` em objeto de outro dono só AVISA e não remove), e o smoke não exercitava nenhum caminho `anon` — que é a hipótese inteira da mudança.

- [ ] **Step 1: Pré-condições** — branch mergeada em `master` localmente (ff), **sem push ainda**; horário de baixo tráfego; anotar `npx supabase --version` no ledger.

- [ ] **Step 2: Sonda pré-push** — rodar `supabase/sondas/0033_pre_push.sql` em produção (MCP `execute_sql`, read-only). **Regra de abort:** qualquer linha nas seções A (objeto não pertencente a `postgres`), B (objeto fora dos 23+1), C (objeto previsto ausente), D (grant a anon/authenticated com grantor ≠ postgres) ou E (coluna nova em `integration_log`) → **não fazer o push**; corrigir a causa (ou incluir o objeto no mapa + migration) e voltar à Task 2. F deve ler `postgres`; G deve ler `0032`; H é informativo (default de `supabase_admin`, fora do alcance).

- [ ] **Step 3: Dry-run** — `npx supabase db push --dry-run`; abortar se listar qualquer coisa além de `0033_sweep_grants_tabela.sql`.

- [ ] **Step 4: Aplicar** — `npx supabase db push`. Expected: `Applying migration 0033_sweep_grants_tabela.sql... Finished`. (Não acrescentar `begin/commit` ao arquivo: o CLI já envolve cada migration numa transação e registra a versão dentro dela. GRANT/REVOKE não toma lock de relação — não enfileira atrás de query longa.)

- [ ] **Step 5: Verificação pós-push** — rodar `supabase/sondas/0033_verificar.sql` em produção. Expected: **0 linhas**. Qualquer linha nomeia o desvio exato (tabela/papel/privilégio ou default ACL).

- [ ] **Step 6: Smoke no ar — sessão E anon** — `vostok-beta.vercel.app`: login, funil, abrir lead (drawer), escrever uma nota (insere em `lead_events` — prova o `usage` da sequência), sino (`notifications`), `/admin` (invites), `/config` fontes. **Caminhos anon (obrigatórios):** `GET https://vostok-beta.vercel.app/api/webhooks/reprocessar` com `Authorization: Bearer $CRON_SECRET` (valor nas envs da Vercel) → 200 com JSON; e uma entrega real de webhook — Google (`POST /api/webhooks/google/<token de uma fonte conectada>` com o corpo de `tests/e2e/ingestao.spec.ts`) ou o Lead Ads Testing Tool do Meta — → lead aparece no funil e `integration_log` marca `processado`. Depois `mcp__supabase__get_advisors` (security) e `query_logs` postgres dos últimos minutos: nenhum `42501`/`permission denied`.

- [ ] **Step 7: Se a sonda ou o smoke falhar** — rodar `supabase/rollback/0033_rollback.sql` no SQL editor (como `postgres`), rodar `0033_verificar.sql` de novo (agora deve acusar o estado pré-0033 — é o esperado), `npx supabase migration repair --status reverted 0033`, registrar o que quebrou no ledger e voltar à Task 2 Step 5.

- [ ] **Step 8: Push e registro** — `git push origin master` (nenhum deploy funcional; só migration, sondas e teste entram no repo). Atualizar memória: `crm-projeto` (0033 no ar, 33/33; integração 357/357) e `supabase-guardas-silenciosas` nº 9 ("fechado pela 0033 em tabelas/sequências/funções + default privileges de `postgres`; toda migration nova precisa de grant explícito e os sweeps 0024/0033 reprovam a ausência; **tabela criada pelo Table Editor nasce aberta (default de `supabase_admin`) — criar tabela por migration**"). Fechar o ledger.

---

## Self-review (feito ao escrever)

- **Cobertura da spec:** migration (Task 2 Step 1) ✓; teste 4 casos (Task 1) ✓; 5 vermelhos sem edição (Task 2 Step 4) ✓; sequências (constraint + grant + Caso 3) ✓; default privileges tabela/sequência/função (Step 1 §3 + Caso 4) ✓; ensaio local integração/E2E/smoke (Task 2 Steps 5–7) ✓; rollout, sonda, smoke, rollback, memória (Task 3) ✓; fora do escopo respeitado (nenhum grant reduzido; `service_role` intocado) ✓.
- **Placeholders:** nenhum; o smoke (Task 2 Step 7) aponta onde achar corpo/segredo em vez de inventá-los.
- **Consistência:** `MAPA_TABELAS` (23 tabelas) = tabela da spec + `integration_log` com `authenticated: []` no nível de tabela porque o select dela é por coluna (documentado no teste); `COLUNAS` bate com os três grants de coluna da migration; `lead_events_seq_seq` aparece na constraint, na migration, no rollback e no Caso 3 com o mesmo nome.
