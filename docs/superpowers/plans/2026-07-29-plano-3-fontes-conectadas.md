# CRM — Plano 3: Fontes conectadas (OAuth do Meta, URL do Google, tela de Integrações)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um admin conecta a Page do Meta pelo botão, escolhe o vendedor responsável pelos leads daquela fonte, e copia a URL secreta para colar no Google Ads — tudo antes de existir qualquer lead ingerido.

**Architecture:** Três migrations, cada uma com um propósito. As credenciais das fontes vivem numa tabela **sem grant nenhum** para `authenticated`, escrita e lida só por funções `security definer`. O Graph API do Meta entra como port com implementação falsa, para que nenhum teste automatizado toque a rede. A tela de Integrações é a quarta seção de `/config`, seguindo o mesmo desenho de Server Component + Server Action das outras três.

**Tech Stack:** Next.js 15 (App Router, Route Handlers), TypeScript, Tailwind, Supabase (Postgres/RLS), Vitest, Playwright.

**Pré-requisito:** Planos 1 e 2 concluídos e mergeados em `master` (HEAD `2dd186f`). Existem `CrmStore`, `SupabaseCrmStore`, `AdminStore`, migrations `0001`–`0005`, auth e as telas de funil, ficha e configuração.

**Spec:** `docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md`

**Não faz parte deste plano** (é o Plano 4): rotas de webhook, `integration_log`, `notifications`, RPC `ingerir_lead`, mapeadores de payload, dedup e Realtime. Este plano termina com as fontes conectadas e nenhum lead entrando por elas ainda.

## Global Constraints

- Herda todas as constraints dos Planos 1 e 2: **nenhum uso de `service_role`**, RLS em toda tabela, `set search_path = public` em toda função `security definer`, dinheiro em centavos, `stage_history` e `lead_events` são insert-only.
- **Grant explícito obrigatório.** Nesta versão do `supabase/postgres` (17.6) o default ACL do schema `public` concede a `anon`/`authenticated` apenas `Dxtm`. Toda tabela nova precisa de `grant` explícito para `authenticated`, ou o erro é `permission denied` e a RLS nem chega a ser avaliada. Grant só para `authenticated` — nunca `anon`, nunca `service_role`.
- Nenhum componente cliente importa `@supabase/*`. Dados chegam por props de Server Component; mutações por Server Action.
- Toda Server Action devolve `Resultado<T>` e nenhuma exception vaza para a UI. Toda chamada de Server Action feita de componente cliente passa por `chamarAcao` de `@/lib/ui/acao`.
- Toda leitura que devolve zero linhas por RLS é tratada como "não encontrado", nunca como erro de permissão.
- **Nenhum teste automatizado faz requisição de rede.** O Graph API do Meta é sempre a implementação falsa do port. A prova contra o provedor real é verificação manual, fora deste plano.
- **Segredo nunca volta em listagem.** Token de página e segredo de URL só aparecem no retorno da ação que os gera, seguindo o precedente de `AdminStore.convidar`.
- Componente cliente nunca copia props do servidor para `useState`. Se precisar de estado derivado de props, use `useOptimistic` ou `router.refresh()`.

## Estrutura de arquivos

**Migrations**
- `supabase/migrations/0006_lead_events_seq.sql` — desempate de ordenação de eventos (backlog #10)
- `supabase/migrations/0007_responsavel_membro.sql` — predicado de `responsavel_id` nas policies de `leads` (backlog #4)
- `supabase/migrations/0008_fontes_conectadas.sql` — `lead_sources`, `source_credentials`, `ingestion_config` e as funções de conexão

**Domínio e dados**
- `src/lib/data/conta.ts` — resolução determinística da conta ativa, compartilhada (backlog #3)
- `src/lib/data/filtro.ts` — escape de valor para filtro PostgREST (backlog #9)
- `src/lib/data/fontes.ts` — port `FonteStore` e `SupabaseFonteStore`
- `src/lib/domain/fonte.ts` — tipos `Fonte`, `Provedor`, `PaginaDoMeta`

**Integração**
- `src/lib/integracoes/meta.ts` — port `MetaGraph`, tipos e erros
- `src/lib/integracoes/meta-real.ts` — implementação contra o Graph API
- `src/lib/integracoes/meta-falso.ts` — implementação de teste
- `src/lib/integracoes/estado-oauth.ts` — geração e verificação do `state` anti-CSRF

**Rotas e telas**
- `src/app/api/integracoes/meta/iniciar/route.ts`
- `src/app/api/integracoes/meta/retorno/route.ts`
- `src/app/(app)/config/integracoes.tsx` — componente cliente
- `src/app/(app)/config/acoes-fontes.ts` — Server Actions das fontes

**Testes**
- `tests/integration/helpers/cliente.ts` — `clienteDoUsuario`, extraído para reuso
- `tests/integration/0006_lead_events_seq.test.ts`
- `tests/integration/0007_responsavel_membro.test.ts`
- `tests/integration/0008_fontes_conectadas.test.ts`
- `tests/integration/conta-ativa.test.ts`
- `src/lib/data/filtro.test.ts`
- `src/lib/integracoes/estado-oauth.test.ts`
- `tests/e2e/integracoes.spec.ts`

---

### Task 1: Desempate de ordenação de eventos (backlog #10)

O `InMemoryCrmStore` **já** desempata eventos de mesmo `criado_em` pelo índice de inserção — leia o comentário em `eventosDoLead` antes de começar. Quem não tem critério é o `SupabaseCrmStore`, que ordena só por `criado_em desc` e devolve ordem arbitrária no empate. Esta task dá ao Postgres o mesmo desempate que o fake já tem. **Não mexa no store in-memory:** ele está correto.

Isso importa agora porque o Plano 4 grava lead e evento na mesma transação, onde `now()` é constante — empate deixa de ser raro e vira regra.

**Files:**
- Create: `supabase/migrations/0006_lead_events_seq.sql`
- Create: `tests/integration/helpers/cliente.ts`
- Create: `tests/integration/0006_lead_events_seq.test.ts`
- Modify: `src/lib/data/supabase.ts` (método `eventosDoLead`)
- Modify: `tests/integration/supabase-store.test.ts` (passa a importar `clienteDoUsuario` do helper)

**Interfaces:**
- Consumes: `comoServico`, `limparBanco` de `./helpers/db`; `montarCenario`, `etapa`, `criarLead` de `./helpers/cenario`.
- Produces:
  - `tests/integration/helpers/cliente.ts`: `clienteDoUsuario(userId: string): Promise<SupabaseClient>` — usado por todas as tasks seguintes.
  - Coluna `public.lead_events.seq bigint`, monotônica, gerada pelo banco.

- [ ] **Step 1: Extrair o helper de cliente autenticado**

`clienteDoUsuario` hoje é uma função local dentro de `tests/integration/supabase-store.test.ts`. As tasks 4 e 6 precisam dela. Mova, sem alterar o comportamento.

Crie `tests/integration/helpers/cliente.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Cliente supabase-js falando pelo usuario. Assinamos um JWT local com o
 * segredo padrao do Supabase CLI, que e o mesmo em toda instalacao local.
 */
export async function clienteDoUsuario(userId: string): Promise<SupabaseClient> {
  const { SignJWT } = await import('jose')
  const segredo = new TextEncoder().encode(
    'super-secret-jwt-token-with-at-least-32-characters-long',
  )
  const token = await new SignJWT({ sub: userId, role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(segredo)

  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

Em `tests/integration/supabase-store.test.ts`, apague a constante `URL`, a constante `ANON`, o bloco de comentário e a função local `clienteDoUsuario` (linhas 8 a 30), e acrescente o import junto dos outros:

```ts
import { clienteDoUsuario } from './helpers/cliente'
```

- [ ] **Step 2: Rodar a suíte de integração e ver que nada quebrou**

Docker Desktop tem que estar rodando e `npx supabase start` já executado.

Run: `npm run test:integration`
Expected: PASS, 43 testes. A extração é pura movimentação de código.

- [ ] **Step 3: Escrever o teste que falha**

Crie `tests/integration/0006_lead_events_seq.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseCrmStore } from '@/lib/data/supabase'
import { comoServico, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

describe('0006 — desempate de ordenacao de lead_events', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('devolve o mais recente primeiro quando criado_em empata', async () => {
    const leadId = await criarLead(c, 'Empate', c.adminId, etapa(c, 'Novo lead'))

    // Os tres eventos nascem na MESMA transacao, entao now() e identico nos
    // tres: e exatamente o cenario que o Plano 4 cria ao ingerir um lead.
    await comoServico((cli) =>
      cli.query(
        `insert into public.lead_events (lead_id, tipo, payload, ator_id)
         values ($1, 'primeiro', '{}'::jsonb, $2),
                ($1, 'segundo',  '{}'::jsonb, $2),
                ($1, 'terceiro', '{}'::jsonb, $2)`,
        [leadId, c.adminId],
      ),
    )

    const mesmoInstante = await comoServico(async (cli) => {
      const r = await cli.query<{ distintos: string }>(
        'select count(distinct criado_em) as distintos from public.lead_events where lead_id = $1',
        [leadId],
      )
      return r.rows[0].distintos
    })
    // Se este assert falhar, o cenario nao esta testando o que promete.
    expect(mesmoInstante).toBe('1')

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const r = await store.eventosDoLead(leadId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((e) => e.tipo)).toEqual(['terceiro', 'segundo', 'primeiro'])
  })

  it('seq e monotonica e crescente na ordem de insercao', async () => {
    const leadId = await criarLead(c, 'Sequencia', c.adminId, etapa(c, 'Novo lead'))
    await comoServico(async (cli) => {
      await cli.query(
        `insert into public.lead_events (lead_id, tipo, ator_id) values ($1, 'a', $2)`,
        [leadId, c.adminId],
      )
      await cli.query(
        `insert into public.lead_events (lead_id, tipo, ator_id) values ($1, 'b', $2)`,
        [leadId, c.adminId],
      )
    })

    const seqs = await comoServico(async (cli) => {
      const r = await cli.query<{ tipo: string; seq: string }>(
        'select tipo, seq from public.lead_events where lead_id = $1 order by seq',
        [leadId],
      )
      return r.rows
    })
    expect(seqs.map((s) => s.tipo)).toEqual(['a', 'b'])
    expect(Number(seqs[1].seq)).toBeGreaterThan(Number(seqs[0].seq))
  })

  it('nao deixa a aplicacao escrever seq', async () => {
    const leadId = await criarLead(c, 'Imutavel', c.adminId, etapa(c, 'Novo lead'))
    await expect(
      comoServico((cli) =>
        cli.query(
          `insert into public.lead_events (lead_id, tipo, ator_id, seq)
           values ($1, 'forcado', $2, 99)`,
          [leadId, c.adminId],
        ),
      ),
    ).rejects.toThrow(/generated always/i)
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/0006_lead_events_seq.test.ts`
Expected: FAIL. Os três testes falham com `column "seq" does not exist` — a coluna ainda não existe.

- [ ] **Step 5: Escrever a migration**

Crie `supabase/migrations/0006_lead_events_seq.sql`:

```sql
-- Backlog #10 do review final do Plano 2.
--
-- O InMemoryCrmStore ja desempata eventos de mesmo criado_em pelo indice de
-- insercao. O SupabaseCrmStore nao tinha criterio nenhum: com dois eventos no
-- mesmo timestamp, `order by criado_em desc` deixa a ordem por conta do plano
-- de execucao. Latente ate aqui porque nenhum caminho escrevia dois eventos na
-- mesma transacao — o Plano 4 escreve, e dentro de uma transacao now() e
-- constante, entao o empate deixa de ser raro e vira regra.
--
-- `generated always` (e nao `by default`) de proposito: a aplicacao nao pode
-- escolher a ordem, senao o desempate volta a ser opiniao de quem insere.
alter table public.lead_events
  add column seq bigint generated always as identity;

-- O indice antigo (lead_id, criado_em desc) nao serve mais ao order by de duas
-- colunas: sem seq no indice o Postgres ordena de novo em memoria.
drop index if exists public.lead_events_lead_idx;
create index lead_events_lead_idx
  on public.lead_events (lead_id, criado_em desc, seq desc);

-- Sem grant novo: `generated always` recusa escrita explicita de qualquer
-- papel, e o insert das colunas existentes ja esta coberto pelo grant da
-- 0003_leads.sql.
```

- [ ] **Step 6: Aplicar a migration**

Run: `npm run db:reset`
Expected: todas as migrations aplicam sem erro, terminando em `Finished supabase db reset.`

- [ ] **Step 7: Rodar e ver os dois últimos passarem, o primeiro ainda falhar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/0006_lead_events_seq.test.ts`
Expected: 2 PASS (`seq e monotonica`, `nao deixa a aplicacao escrever seq`), 1 FAIL (`devolve o mais recente primeiro quando criado_em empata`).

A coluna existe, mas o store ainda não a usa para ordenar. **Este é o ponto da task** — a migration sozinha não conserta nada. Se o primeiro teste passar aqui, ele está passando por acaso da ordem física das linhas; não siga em frente achando que acabou.

- [ ] **Step 8: Ordenar por `seq` no store Supabase**

Em `src/lib/data/supabase.ts`, substitua o método `eventosDoLead` inteiro:

```ts
  async eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>> {
    const { data, error } = await this.cliente
      .from('lead_events')
      .select('id, lead_id, tipo, payload, ator_id, criado_em')
      .eq('lead_id', leadId)
      // Duas colunas de propósito: criado_em e o criterio de negocio, mas ele
      // empata sempre que dois eventos nascem na mesma transacao (now() e
      // constante dentro dela). seq e monotonica e desempata na mesma direcao
      // — mais novo primeiro —, igualando o criterio ao do InMemoryCrmStore.
      .order('criado_em', { ascending: false })
      .order('seq', { ascending: false })
    if (error) return falha(error.message)
    return ok(
      (data ?? []).map((e) => ({
        id: e.id,
        leadId: e.lead_id,
        tipo: e.tipo,
        payload: e.payload as Record<string, unknown>,
        atorId: e.ator_id,
        criadoEm: new Date(e.criado_em),
      })),
    )
  }
```

`seq` não entra no `select` nem no tipo `EventoLead`: é critério de ordenação do banco, não dado de domínio. A UI nunca precisa dele.

- [ ] **Step 9: Rodar e ver os três passarem**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/0006_lead_events_seq.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 10: Rodar a suíte inteira**

Run: `npm test && npm run test:integration && npm run typecheck`
Expected: 68 unitários PASS, 46 de integração PASS (43 + 3 novos), typecheck limpo.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0006_lead_events_seq.sql tests/integration/helpers/cliente.ts tests/integration/0006_lead_events_seq.test.ts tests/integration/supabase-store.test.ts src/lib/data/supabase.ts
git commit -m "fix: timeline deixa de embaralhar quando dois eventos nascem juntos"
```

---

### Task 2: Resolução determinística da conta ativa (backlog #3)

Hoje `criarStoreDoServidor` e `criarAdminStoreDoServidor` resolvem a conta cada um por conta própria, com `.limit(1)` **sem `order by`**. O `.eq('user_id')` já corrigido no Plano 2 garante que o *papel* é o da própria pessoa, mas para quem tem duas memberships a *conta* continua indeterminada — e `config/page.tsx` chama os dois resolvedores em sequência, então pode renderizar etapas de uma conta ao lado de convites de outra.

Ninguém tinha duas memberships enquanto o convite estava quebrado. Agora tem, e a tela de Integrações da Task 6 resolve conta uma terceira vez.

**Files:**
- Create: `src/lib/data/conta.ts`
- Create: `tests/integration/conta-ativa.test.ts`
- Modify: `src/lib/data/supabase.ts` (função `criarStoreDoServidor`)
- Modify: `src/lib/data/admin.ts` (função `criarAdminStoreDoServidor`)

**Interfaces:**
- Consumes: `criarClienteServidor` de `@/lib/supabase/servidor`; `Resultado`, `ok`, `falha` de `@/lib/domain/resultado`; `Conta`, `Papel` de `@/lib/domain/tipos`.
- Produces:
  - `src/lib/data/conta.ts`: `type ContaAtiva = { conta: Conta; usuarioId: string; papel: Papel }` e `resolverContaAtiva(cliente: SupabaseClient, usuarioId: string): Promise<Resultado<ContaAtiva>>`. As tasks 4 e 6 usam este tipo.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/integration/conta-ativa.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { resolverContaAtiva } from '@/lib/data/conta'
import { comoServico, limparBanco, criarUsuario } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, type Cenario } from './helpers/cenario'

describe('resolverContaAtiva', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('devolve a conta e o papel do proprio usuario', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const r = await resolverContaAtiva(cliente, c.vendedorAId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.conta.id).toBe(c.accountId)
    expect(r.valor.papel).toBe('vendedor')
  })

  it('escolhe sempre a membership mais antiga quando ha duas', async () => {
    // Uma segunda conta, criada DEPOIS, com o mesmo usuario como admin.
    const outroAdmin = await criarUsuario('outro@b.com')
    const outraConta = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.accounts (nome) values ('Outra') returning id`,
      )
      return r.rows[0].id
    })
    await comoServico((cli) =>
      cli.query(
        `insert into public.memberships (account_id, user_id, papel, criado_em)
         values ($1, $2, 'admin', now() + interval '1 hour'),
                ($1, $3, 'admin', now() + interval '1 hour')`,
        [outraConta, c.adminId, outroAdmin],
      ),
    )

    const cliente = await clienteDoUsuario(c.adminId)

    // Dez resolucoes seguidas: sem order by, o Postgres pode devolver linhas
    // diferentes entre chamadas, entao uma unica assercao passaria por sorte.
    for (let i = 0; i < 10; i++) {
      const r = await resolverContaAtiva(cliente, c.adminId)
      if (!r.ok) throw new Error(r.erro)
      expect(r.valor.conta.id).toBe(c.accountId)
    }
  })

  it('falha com sem_conta quando o usuario nao e membro de nada', async () => {
    const solto = await criarUsuario('solto@c.com')
    const cliente = await clienteDoUsuario(solto)
    const r = await resolverContaAtiva(cliente, solto)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('sem_conta')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/conta-ativa.test.ts`
Expected: FAIL na resolução do import — `Failed to resolve import "@/lib/data/conta"`.

- [ ] **Step 3: Escrever o resolvedor compartilhado**

Crie `src/lib/data/conta.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta, Papel } from '@/lib/domain/tipos'

export type ContaAtiva = { conta: Conta; usuarioId: string; papel: Papel }

/**
 * Resolucao unica da conta ativa. Antes cada resolvedor tinha a sua copia, e
 * `config/page.tsx` chamava os dois — com duas memberships e sem `order by`,
 * cada chamada podia cair numa conta diferente e a tela misturava as duas.
 *
 * Duas coisas nao sao opcionais aqui:
 *
 * - `.eq('user_id')`: a policy memberships_select libera TODAS as linhas da
 *   conta para qualquer membro (e o que faz a tela de usuarios funcionar), logo
 *   sem o filtro o papel lido pode ser o de outra pessoa.
 * - `.order('criado_em')`: e o que torna a escolha deterministica. `limit(1)`
 *   sozinho deixa a escolha da linha por conta do plano de execucao.
 *
 * Criterio: a membership mais antiga vence. Enquanto nao existir seletor de
 * conta na UI, "a primeira conta em que entrei" e a unica regra que nao muda
 * sozinha entre dois carregamentos da mesma pagina.
 */
export async function resolverContaAtiva(
  cliente: SupabaseClient,
  usuarioId: string,
): Promise<Resultado<ContaAtiva>> {
  const { data, error } = await cliente
    .from('memberships')
    .select('papel, criado_em, accounts(id, nome)')
    .eq('user_id', usuarioId)
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return falha(error.message)
  if (!data) return falha('sem_conta')

  const linha = data as unknown as {
    papel: Papel
    accounts: { id: string; nome: string } | null
  }
  // accounts vem nulo se a RLS de accounts esconder a linha — trata como
  // "nao encontrado", nunca como erro de permissao.
  if (!linha.accounts) return falha('sem_conta')

  return ok({
    conta: { id: linha.accounts.id, nome: linha.accounts.nome },
    usuarioId,
    papel: linha.papel,
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/conta-ativa.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Fazer `criarStoreDoServidor` usar o resolvedor**

Em `src/lib/data/supabase.ts`, acrescente o import:

```ts
import { resolverContaAtiva } from './conta'
```

E substitua a função `criarStoreDoServidor` inteira (o bloco final do arquivo, incluindo o comentário longo sobre `.eq('user_id')`, que agora mora em `conta.ts`):

```ts
/** Resolve a conta ativa do usuario logado e devolve o store pronto. */
export async function criarStoreDoServidor(): Promise<
  Resultado<{ store: SupabaseCrmStore; conta: Conta; usuarioId: string; papel: Papel }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  const usuario = sessao.user
  if (!usuario) return falha('sem_sessao')

  const ativa = await resolverContaAtiva(cliente, usuario.id)
  if (!ativa.ok) return falha(ativa.erro)

  return ok({
    store: new SupabaseCrmStore(cliente, ativa.valor.conta.id, usuario.id),
    conta: ativa.valor.conta,
    usuarioId: usuario.id,
    papel: ativa.valor.papel,
  })
}
```

- [ ] **Step 6: Fazer `criarAdminStoreDoServidor` usar o mesmo resolvedor**

Em `src/lib/data/admin.ts`, acrescente o import:

```ts
import { resolverContaAtiva } from './conta'
```

E substitua a função `criarAdminStoreDoServidor` inteira:

```ts
export async function criarAdminStoreDoServidor(): Promise<
  Resultado<{ admin: SupabaseAdminStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  // Mesmo resolvedor de criarStoreDoServidor, de proposito: config/page.tsx
  // chama os dois na mesma renderizacao, e duas resolucoes independentes
  // podiam cair em contas diferentes para quem tem duas memberships.
  const ativa = await resolverContaAtiva(cliente, sessao.user.id)
  if (!ativa.ok) return falha(ativa.erro)
  if (ativa.valor.papel !== 'admin') return falha('sem_permissao')

  const { data: pipeline, error: erroPipeline } = await cliente
    .from('pipelines')
    .select('id')
    .eq('account_id', ativa.valor.conta.id)
    .eq('is_default', true)
    .maybeSingle()
  if (erroPipeline) return falha(erroPipeline.message)
  if (!pipeline) return falha('pipeline_nao_encontrado')

  return ok({
    admin: new SupabaseAdminStore(
      cliente,
      ativa.valor.conta.id,
      sessao.user.id,
      pipeline.id,
    ),
    conta: ativa.valor.conta,
  })
}
```

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test && npm run test:integration && npm run typecheck`
Expected: 68 unitários PASS, 49 de integração PASS (46 + 3 novos), typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add src/lib/data/conta.ts src/lib/data/supabase.ts src/lib/data/admin.ts tests/integration/conta-ativa.test.ts
git commit -m "fix: conta ativa passa a ser deterministica para quem tem duas memberships"
```

---

### Task 3: Fim da interpolação em filtro PostgREST (backlog #9)

`listarLeads` e `possiveisDuplicados` montam o filtro `.or()` concatenando texto do usuário direto na string. É a mesma classe do bug que o Plano 2 já corrigiu em `aplicarEtiquetas`, duas funções ao lado. A RLS limita o estrago a leituras dentro da própria conta, mas uma vírgula na busca vira condição OR extra e o texto do usuário vira **padrão LIKE**: buscar `100%` casa com qualquer coisa começando em `100`.

O Plano 4 passa dado de terceiro por `possiveisDuplicados`, então o caminho deixa de ter só texto digitado por um usuário logado.

**Files:**
- Create: `src/lib/data/filtro.ts`
- Create: `src/lib/data/filtro.test.ts`
- Modify: `src/lib/data/supabase.ts` (métodos `listarLeads` e `possiveisDuplicados`)
- Modify: `tests/integration/duplicados.test.ts` (acrescenta casos)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `src/lib/data/filtro.ts`: `valorPostgrest(valor: string): string` e `padraoIlike(texto: string): string`. Ambas puras.

- [ ] **Step 1: Escrever os testes unitários do escape**

Crie `src/lib/data/filtro.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { valorPostgrest, padraoIlike } from './filtro'

describe('valorPostgrest', () => {
  it('envolve em aspas duplas', () => {
    expect(valorPostgrest('joao')).toBe('"joao"')
  })

  it('neutraliza a virgula, que separaria condicoes no or()', () => {
    expect(valorPostgrest('a,b')).toBe('"a,b"')
  })

  it('neutraliza o ponto, que separaria coluna de operador', () => {
    expect(valorPostgrest('nome.eq.x')).toBe('"nome.eq.x"')
  })

  it('escapa aspas duplas com barra invertida', () => {
    expect(valorPostgrest('diz "oi"')).toBe('"diz \\"oi\\""')
  })

  it('escapa a barra invertida antes das aspas, sem escapar duas vezes', () => {
    expect(valorPostgrest('c:\\temp')).toBe('"c:\\\\temp"')
  })

  it('aceita string vazia', () => {
    expect(valorPostgrest('')).toBe('""')
  })

  it('nao mexe em parenteses, que so tem sentido fora das aspas', () => {
    expect(valorPostgrest('(a)')).toBe('"(a)"')
  })
})

describe('padraoIlike', () => {
  it('cerca o texto de curingas', () => {
    expect(padraoIlike('joao')).toBe('"%joao%"')
  })

  it('trata o porcento digitado como literal', () => {
    // Sem isso, buscar "100%" casaria com "1000 leads": o texto do usuario
    // virava padrao. Este e o bug do backlog #9.
    expect(padraoIlike('100%')).toBe('"%100\\\\%%"')
  })

  it('trata o underline digitado como literal', () => {
    expect(padraoIlike('lead_frio')).toBe('"%lead\\\\_frio%"')
  })

  it('escapa a barra invertida do LIKE antes de tudo', () => {
    expect(padraoIlike('a\\b')).toBe('"%a\\\\\\\\b%"')
  })

  it('neutraliza virgula e ponto junto com os curingas', () => {
    expect(padraoIlike('a,b.c')).toBe('"%a,b.c%"')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/data/filtro.test.ts`
Expected: FAIL — `Failed to resolve import "./filtro"`.

- [ ] **Step 3: Implementar o escape**

Crie `src/lib/data/filtro.ts`:

```ts
/**
 * Escape de valores para os filtros textuais do PostgREST.
 *
 * O `.or()` do supabase-js recebe UMA string no formato
 * `coluna.operador.valor,coluna.operador.valor`. Concatenar texto do usuario
 * ali dentro tem duas consequencias distintas, e cada funcao aqui resolve uma:
 *
 * 1. Virgula e ponto sao a pontuacao da propria sintaxe. Envolver o valor em
 *    aspas duplas tira o poder deles — e o que `valorPostgrest` faz.
 * 2. `%` e `_` sao curingas do LIKE. Aspas nao os neutralizam; so o escape do
 *    proprio LIKE neutraliza — e o que `padraoIlike` faz por cima do item 1.
 */

/**
 * Envolve o valor em aspas duplas, escapando o que quebraria as aspas.
 *
 * A ordem importa: a barra invertida vem primeiro, senao o escape das aspas
 * seria escapado de novo no passo seguinte e o resultado teria barra sobrando.
 */
export function valorPostgrest(valor: string): string {
  const escapado = valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escapado}"`
}

/**
 * Monta o padrao `%texto%` tratando o que o usuario digitou como literal.
 *
 * O `\` que escapa o curinga precisa chegar ao Postgres como um `\` de
 * verdade, e ele atravessa `valorPostgrest`, que dobra barras. Por isso o
 * escape do LIKE usa `\\` aqui: vira `\\\\` na string entre aspas, que o
 * PostgREST desfaz para `\\`, que o LIKE le como "um `\` literal escapando o
 * proximo caractere".
 */
export function padraoIlike(texto: string): string {
  const literal = texto
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
  return valorPostgrest(`%${literal}%`)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/data/filtro.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 5: Usar o escape nos dois métodos do store**

Em `src/lib/data/supabase.ts`, acrescente o import:

```ts
import { valorPostgrest, padraoIlike } from './filtro'
```

Substitua o bloco de busca dentro de `listarLeads`:

```ts
    if (filtro.busca) {
      // padraoIlike, e nao `%${busca}%`: o texto do usuario ia cru para o
      // PostgREST, entao a virgula abria condicao OR extra e % e _ viravam
      // curinga (buscar "100%" casava com "1000 leads").
      const alvo = padraoIlike(filtro.busca)
      q = q.or(`nome.ilike.${alvo},telefone_e164.ilike.${alvo},email_norm.ilike.${alvo}`)
    }
```

E o corpo de `possiveisDuplicados`:

```ts
  async possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>> {
    if (!telefoneE164 && !emailNorm) return ok([])
    const condicoes: string[] = []
    // Comparacao exata, entao aqui basta neutralizar a pontuacao da sintaxe:
    // um email como "a,b@x.com" abria uma condicao OR a mais.
    if (telefoneE164) condicoes.push(`telefone_e164.eq.${valorPostgrest(telefoneE164)}`)
    if (emailNorm) condicoes.push(`email_norm.eq.${valorPostgrest(emailNorm)}`)

    const { data, error } = await this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('account_id', this.accountId)
      .or(condicoes.join(','))
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaLead[]).map(paraLead))
  }
```

- [ ] **Step 6: Acrescentar os testes de integração que provam o comportamento contra o banco**

Os unitários provam o formato da string. Só o Postgres prova que o PostgREST a interpreta como esperado. Acrescente ao final do `describe` de `tests/integration/duplicados.test.ts`:

```ts
  it('busca trata porcento digitado como literal', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    await criarLead(c, 'Desconto 100%', c.adminId, etapa(c, 'Novo lead'))
    await criarLead(c, 'Desconto 1000 leads', c.adminId, etapa(c, 'Novo lead'))

    const r = await store.listarLeads({ busca: '100%' })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.nome)).toEqual(['Desconto 100%'])
  })

  it('busca com virgula nao abre condicao OR extra', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    await criarLead(c, 'Silva, Joao', c.adminId, etapa(c, 'Novo lead'))
    await criarLead(c, 'Pereira', c.adminId, etapa(c, 'Novo lead'))

    const r = await store.listarLeads({ busca: 'Silva, Joao' })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.nome)).toEqual(['Silva, Joao'])
  })

  it('email com virgula nao quebra a busca de duplicados', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const r = await store.possiveisDuplicados(null, 'a,b@x.com')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual([])
  })
```

Confira o topo de `tests/integration/duplicados.test.ts`: se ele ainda declarar `clienteDoUsuario` localmente ou não importar `criarLead`/`etapa`, ajuste os imports para

```ts
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/duplicados.test.ts`
Expected: PASS. Os testes que já existiam continuam verdes e os 3 novos passam.

Se `busca trata porcento digitado como literal` falhar devolvendo os dois leads, o escape do LIKE não chegou inteiro ao Postgres — reveja o número de barras em `padraoIlike`, não afrouxe a asserção.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npm test && npm run test:integration && npm run typecheck`
Expected: 80 unitários PASS (68 + 12), 52 de integração PASS (49 + 3), typecheck limpo.

- [ ] **Step 9: Commit**

```bash
git add src/lib/data/filtro.ts src/lib/data/filtro.test.ts src/lib/data/supabase.ts tests/integration/duplicados.test.ts
git commit -m "fix: texto do usuario para de virar sintaxe e curinga no filtro PostgREST"
```

---

### Task 4: `responsavel_id` tem que ser membro da conta (backlog #4)

As policies de `leads` checam `is_member_of(account_id)` no `with check`, mas não olham `responsavel_id`. Nem `criarLeadAction` nem `trocarResponsavel` validam que o responsável pertence à conta. Hoje a aplicação é o único guarda, e ela não guarda nada — dá para gravar como responsável o `profiles.id` de qualquer pessoa do sistema, inclusive de outra conta. O efeito não é só sujeira de dados: `leads_select` exige `responsavel_id = auth.uid()` para vendedor, então o lead com responsável de fora fica invisível para todos os vendedores da conta, sem erro nenhum.

O Plano 4 grava `responsavel_id` vindo de configuração, sem ninguém digitando. O banco precisa ser o guarda.

**Files:**
- Create: `supabase/migrations/0007_responsavel_membro.sql`
- Create: `tests/integration/0007_responsavel_membro.test.ts`
- Modify: `src/lib/data/supabase.ts` (função `codigoDoErroPostgres`)
- Modify: `src/app/(app)/funil/erros.ts`
- Modify: `src/app/(app)/config/erros.ts`

**Interfaces:**
- Consumes: `is_member_of`, `pode_ver_lead` das migrations `0001`/`0003`.
- Produces: função Postgres `public.e_membro_da_conta(p_account_id uuid, p_user_id uuid) returns boolean`, usada pelas policies de `leads` e reusada pela `0008` na Task 5. Código de erro novo: `responsavel_invalido`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/integration/0007_responsavel_membro.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoUsuario, comoServico, limparBanco, criarUsuario } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

/** O forasteiro precisa de profiles, senao a FK barra antes da policy. */
async function criarForasteiro(email: string): Promise<string> {
  const id = await criarUsuario(email)
  await comoServico((cli) =>
    cli.query(
      `insert into public.profiles (id, nome, email) values ($1, 'Fora', $2)
       on conflict (id) do nothing`,
      [id, email],
    ),
  )
  return id
}

describe('0007 — responsavel_id tem que ser membro da conta', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('aceita responsavel que e membro', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Valido', $2, $3, $4)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorAId],
      ),
    )
    const total = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>('select count(*) as n from public.leads')
      return r.rows[0].n
    })
    expect(total).toBe('1')
  })

  it('aceita responsavel nulo — lead sem dono e estado legitimo', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Sem dono', $2, $3, null)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead')],
      ),
    )
    const total = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>('select count(*) as n from public.leads')
      return r.rows[0].n
    })
    expect(total).toBe('1')
  })

  it('recusa responsavel de fora da conta no insert', async () => {
    const forasteiro = await criarForasteiro('fora@z.com')
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(
          `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
           values ($1, 'Invasor', $2, $3, $4)`,
          [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), forasteiro],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('recusa trocar o responsavel para alguem de fora da conta', async () => {
    const forasteiro = await criarForasteiro('fora2@z.com')
    const leadId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Alvo', $2, $3, $4) returning id`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorAId],
      )
      return r.rows[0].id
    })

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('update public.leads set responsavel_id = $1 where id = $2', [
          forasteiro,
          leadId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/0007_responsavel_membro.test.ts`
Expected: 2 PASS (os dois casos válidos), 2 FAIL. Os inserts com forasteiro **passam** hoje, então o `rejects.toThrow` falha com "promise resolved instead of rejecting". É exatamente o bug.

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/0007_responsavel_membro.sql`:

```sql
-- Backlog #4 do review final do Plano 2.
--
-- As policies de leads checavam is_member_of(account_id), que responde "quem
-- escreve pertence a conta?", e nunca "a pessoa apontada como responsavel
-- pertence a conta?". Com isso um admin podia gravar como responsavel o
-- profiles.id de qualquer usuario do sistema. O efeito nao e so bagunca de
-- dados: leads_select exige responsavel_id = auth.uid() para vendedor, entao o
-- lead com responsavel de fora fica invisivel para todos os vendedores da
-- conta, sem erro nenhum. A aplicacao nao validava isso em lugar nenhum, e o
-- Plano 4 passa a gravar responsavel_id vindo de configuracao, sem humano no
-- meio.

-- Complementa is_member_of, que responde sempre sobre auth.uid(). Esta recebe o
-- usuario explicitamente, que e o que a policy precisa perguntar sobre a
-- coluna. SECURITY DEFINER pelo mesmo motivo de is_member_of: consultar
-- memberships de dentro de uma policy sem isso entra em recursao de avaliacao.
--
-- Nulo e verdadeiro de proposito: lead sem responsavel e estado legitimo (a
-- fila que so gestor e admin enxergam), e o Plano 4 depende disso quando a
-- fonte nao tem responsavel padrao configurado.
create or replace function public.e_membro_da_conta(p_account_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is null or exists (
    select 1 from public.memberships m
    where m.account_id = p_account_id and m.user_id = p_user_id
  );
$$;

-- Recriar as duas policies de escrita. O `using` de leads_update fica igual: ele
-- decide QUAIS linhas podem ser alteradas, e essa regra nao mudou. O que muda e
-- o `with check`, que decide como a linha pode FICAR depois da escrita.
drop policy leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert with check (
    public.is_member_of(account_id)
    and public.e_membro_da_conta(account_id, responsavel_id)
  );

drop policy leads_update on public.leads;
create policy leads_update on public.leads
  for update using (public.pode_ver_lead(account_id, responsavel_id))
  with check (
    public.is_member_of(account_id)
    and public.e_membro_da_conta(account_id, responsavel_id)
  );

-- Sem grant novo: recriar policy nao mexe no ACL da tabela, e a funcao roda
-- como DEFINER (dono postgres).
```

- [ ] **Step 4: Aplicar e rodar**

Run: `npm run db:reset && npx vitest run --config vitest.integration.config.ts tests/integration/0007_responsavel_membro.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Traduzir a negação da policy em código de erro**

Sem isto a tela mostra `new row violates row-level security policy for table "leads"` — mensagem crua do PostgREST, a classe do backlog #8.

Em `src/lib/data/supabase.ts`, substitua a função `codigoDoErroPostgres` inteira:

```ts
/** Extrai o codigo levantado por raise exception, ex: 'motivo_perda_obrigatorio'. */
function codigoDoErroPostgres(mensagem: string): string {
  const conhecidos = [
    'lead_nao_encontrado',
    'etapa_invalida',
    'motivo_perda_obrigatorio',
    'motivo_perda_invalido',
    'convite_invalido',
    'convite_expirado',
    'convite_ja_aceito',
    'sem_sessao',
  ]
  const achado = conhecidos.find((c) => mensagem.includes(c))
  if (achado) return achado

  // A policy nao levanta excecao com nome: ela apenas nega, e o PostgREST
  // devolve o texto padrao. Em leads, a unica regra do with check que a UI
  // consegue violar por DADO (e nao por permissao) e a do responsavel — quem
  // nao e membro da conta nem chega a essa policy.
  if (/row-level security policy/i.test(mensagem) && /"leads"/.test(mensagem)) {
    return 'responsavel_invalido'
  }
  return mensagem
}
```

Confira que `criarLead` e `atribuirResponsavel` passam o erro por essa função. Onde algum deles ainda fizer `return falha(error.message)` direto, troque por `return falha(codigoDoErroPostgres(error.message))`.

- [ ] **Step 6: Acrescentar a mensagem nos dois mapas de erro**

Em `src/app/(app)/funil/erros.ts` e em `src/app/(app)/config/erros.ts`, acrescente a mesma entrada ao mapa de mensagens de cada um:

```ts
  responsavel_invalido: 'Esse responsável não faz parte da sua conta. Recarregue a página e escolha de novo.',
```

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test && npm run test:integration && npm run typecheck`
Expected: 80 unitários PASS, 56 de integração PASS (52 + 4), typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0007_responsavel_membro.sql tests/integration/0007_responsavel_membro.test.ts src/lib/data/supabase.ts "src/app/(app)/funil/erros.ts" "src/app/(app)/config/erros.ts"
git commit -m "fix: banco passa a exigir que o responsavel do lead seja membro da conta"
```

---

### Task 5: Migration das fontes conectadas

Cria as três tabelas do Plano 3 e as funções que as escrevem. Nenhuma tela ainda — esta task termina com os testes de integração provando o contrato do banco.

Duas coisas aqui não são convenção e sim requisito: `source_credentials` e `ingestion_config` **não recebem grant nenhum**, e o índice único de `lead_sources` é global, não por conta.

**Nenhuma função escreve `ingestion_config.segredo_hash`, e isso é deliberado.** A linha nasce com `segredo_hash` nulo e fica assim ao fim deste plano. O segredo de ingestão é configuração de operador — ele existe para o *servidor* provar que a chamada veio dele, antes de qualquer conta ser resolvida —, então não é dado de tenant e a aplicação não o escreve.

A primeira versão deste plano tinha uma RPC `definir_segredo_ingestao(p_account_id, p_segredo)` gateada em `papel_na_conta() = 'admin'`, chamada por um painel na tela de Integrações. Era falha de isolamento entre contas: `ingestion_config` é de linha única e global, qualquer pessoa cria a própria conta por signup e nasce admin dela, logo qualquer cliente poderia sobrescrever o segredo de todos os tenants e derrubar a ingestão alheia. Removida.

Quem passa a precisar do segredo é o Plano 4, que traz as rotas de webhook — e é lá que entram o `supabase/seed.sql` com um valor conhecido para desenvolvimento e a definição por SQL no painel do Supabase em produção. Aqui não, porque nada neste plano lê esse campo.

**Files:**
- Create: `supabase/migrations/0008_fontes_conectadas.sql`
- Create: `tests/integration/0008_fontes_conectadas.test.ts`
- Modify: `tests/integration/helpers/db.ts` (o `truncate` de `limparBanco`)

**Interfaces:**
- Consumes: `papel_na_conta` da `0001`; `e_membro_da_conta` da `0007` (Task 4).
- Produces, todas em `public`:
  - tipo `provedor_lead` (`meta` | `google`)
  - tabelas `lead_sources`, `source_credentials`, `ingestion_config`
  - `hash_segredo(p_valor text) returns text`
  - `conectar_fonte_meta(p_account_id uuid, p_page_id text, p_nome text, p_token text, p_responsavel uuid) returns uuid`
  - `conectar_fonte_google(p_account_id uuid, p_nome text, p_url_token text, p_google_key text, p_responsavel uuid) returns uuid`
  - `desconectar_fonte(p_source_id uuid) returns void`
  - Códigos de erro: `sem_sessao`, `sem_permissao`, `page_ja_conectada`, `fonte_nao_encontrada`, `responsavel_invalido`, `segredo_vazio`

- [ ] **Step 1: Acrescentar as tabelas novas ao `limparBanco`**

Sem isto o estado vaza entre arquivos de teste. Em `tests/integration/helpers/db.ts`, substitua o corpo da função `limparBanco`:

```ts
export async function limparBanco(): Promise<void> {
  await comoServico(async (c) => {
    await c.query(`
      truncate table
        public.source_credentials, public.lead_sources,
        public.lead_events, public.stage_history, public.lead_tags, public.tags,
        public.leads, public.loss_reasons, public.stages, public.pipelines,
        public.invites, public.memberships, public.accounts, public.profiles
      restart identity cascade
    `)
    // ingestion_config tem linha unica e fixa: zerar o segredo, nao apagar a linha.
    await c.query('update public.ingestion_config set segredo_hash = null')
    await c.query('delete from auth.users')
  })
}
```

- [ ] **Step 2: Escrever os testes que falham**

Crie `tests/integration/0008_fontes_conectadas.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

const TOKEN = 'EAAG-token-de-pagina-falso'

/** Uma segunda conta completa, com admin proprio. */
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

describe('0008 — fontes conectadas', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('admin conecta uma Page e a credencial fica gravada', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5) as id',
        [c.accountId, '1234567890', 'Page da SE7E', TOKEN, c.vendedorAId],
      )
      return r.rows[0].id
    })

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select s.provedor, s.external_id, s.responsavel_padrao_id, s.ativo,
                cr.meta_page_token
           from public.lead_sources s
           join public.source_credentials cr on cr.source_id = s.id
          where s.id = $1`,
        [sourceId],
      )
      return r.rows[0]
    })
    expect(linha.provedor).toBe('meta')
    expect(linha.external_id).toBe('1234567890')
    expect(linha.responsavel_padrao_id).toBe(c.vendedorAId)
    expect(linha.ativo).toBe(true)
    expect(linha.meta_page_token).toBe(TOKEN)
  })

  it('a mesma Page nao pode ser conectada por duas contas', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '999',
        'Page A',
        TOKEN,
      ]),
    )
    const outra = await outraContaComAdmin('Conta B', 'b@b.com')

    await expect(
      comoUsuario(outra.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          outra.accountId,
          '999',
          'Page A de novo',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/page_ja_conectada/)
  })

  it('varias fontes do Google convivem na mesma conta', async () => {
    await comoUsuario(c.adminId, async (cli) => {
      await cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
        c.accountId,
        'Formulario A',
        'token-a',
        'chave-a',
      ])
      await cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
        c.accountId,
        'Formulario B',
        'token-b',
        'chave-b',
      ])
    })

    const n = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select count(*) as n from public.lead_sources where provedor = 'google'`,
      )
      return r.rows[0].n
    })
    // external_id nulo nos dois: indice unico nao compara NULL com NULL.
    expect(n).toBe('2')
  })

  it('guarda o hash do token da URL, nunca o token', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
        c.accountId,
        'Formulario',
        'token-secreto',
        'chave',
      ]),
    )
    const cred = await comoServico(async (cli) => {
      const r = await cli.query<{ url_token_hash: string; google_key_hash: string }>(
        'select url_token_hash, google_key_hash from public.source_credentials',
      )
      return r.rows[0]
    })
    expect(cred.url_token_hash).not.toBe('token-secreto')
    expect(cred.url_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(cred.google_key_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gestor nao conecta fonte', async () => {
    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          c.accountId,
          '777',
          'Page',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('recusa responsavel padrao de fora da conta', async () => {
    const outra = await outraContaComAdmin('Conta D', 'd@d.com')
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, $5)', [
          c.accountId,
          '888',
          'Page',
          TOKEN,
          outra.adminId,
        ]),
      ),
    ).rejects.toThrow(/responsavel_invalido/)
  })

  it('authenticated nao le source_credentials de jeito nenhum', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '111',
        'Page',
        TOKEN,
      ]),
    )
    // Nao e RLS devolvendo zero linhas: e falta de privilegio na tabela.
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.source_credentials')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('authenticated nao le ingestion_config', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.ingestion_config')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('admin enxerga as fontes da propria conta e nao as de outra', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '222',
        'Minha Page',
        TOKEN,
      ]),
    )
    const outra = await outraContaComAdmin('Conta E', 'e@e.com')
    await comoUsuario(outra.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        outra.accountId,
        '223',
        'Page alheia',
        TOKEN,
      ]),
    )

    const vistas = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ nome: string }>('select nome from public.lead_sources')
      return r.rows.map((l) => l.nome)
    })
    expect(vistas).toEqual(['Minha Page'])
  })

  it('vendedor nao enxerga fonte nenhuma', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '333',
        'Page',
        TOKEN,
      ]),
    )
    const vistas = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query('select id from public.lead_sources')
      return r.rows
    })
    expect(vistas).toEqual([])
  })

  it('desconectar apaga fonte e credencial', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '444', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.desconectar_fonte($1)', [sourceId]),
    )
    const restou = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select (select count(*) from public.lead_sources)
              + (select count(*) from public.source_credentials) as n`,
      )
      return r.rows[0].n
    })
    expect(restou).toBe('0')
  })

  it('admin de outra conta nao desconecta fonte alheia', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '555', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    const outra = await outraContaComAdmin('Conta C', 'c@c.com')

    await expect(
      comoUsuario(outra.adminId, (cli) =>
        cli.query('select public.desconectar_fonte($1)', [sourceId]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('admin troca o responsavel padrao por update direto', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '666', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    await comoUsuario(c.adminId, (cli) =>
      cli.query('update public.lead_sources set responsavel_padrao_id = $1 where id = $2', [
        c.vendedorBId,
        sourceId,
      ]),
    )
    const dono = await comoServico(async (cli) => {
      const r = await cli.query<{ responsavel_padrao_id: string }>(
        'select responsavel_padrao_id from public.lead_sources where id = $1',
        [sourceId],
      )
      return r.rows[0].responsavel_padrao_id
    })
    expect(dono).toBe(c.vendedorBId)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/0008_fontes_conectadas.test.ts`
Expected: FAIL em todos. O `beforeEach` já estoura no `truncate` com `relation "public.source_credentials" does not exist`.

- [ ] **Step 4: Escrever a migration**

Crie `supabase/migrations/0008_fontes_conectadas.sql`:

```sql
-- Sub-projeto 2, Plano 3: as fontes de lead que uma conta conectou.
-- Spec: docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md

create type public.provedor_lead as enum ('meta', 'google');

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provedor public.provedor_lead not null,
  external_id text,
  nome text not null,
  responsavel_padrao_id uuid references public.profiles(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- O grant abaixo ja restringe update de authenticated a colunas que nao
  -- incluem external_id/provedor, mas o check fica na tabela como a garantia
  -- de verdade: vale tambem para as funcoes SECURITY DEFINER e para qualquer
  -- migration futura que amplie o grant sem revisar isto. Sem ele, anular
  -- external_id de uma fonte meta a tira do indice unico global sem soltar a
  -- Page, e trocar provedor cria uma linha meta com external_id nulo que
  -- nenhum caminho de codigo espera.
  check (provedor <> 'meta' or external_id is not null)
);

-- Unico GLOBAL, nao por conta. O webhook do Meta e do app, nao da conta, e o
-- payload traz apenas o page_id: se duas contas reivindicassem a mesma Page, o
-- lead chegaria sem criterio de desempate. Falhar na conexao, com mensagem
-- clara, e melhor do que entregar lead para a conta errada.
--
-- Parcial (where external_id is not null) porque o Google nao tem identificador
-- estavel de fonte no payload — quem resolve a conta la e o token da URL. O
-- indice ignora essas linhas, e varias fontes Google convivem na mesma conta.
create unique index lead_sources_provedor_external_idx
  on public.lead_sources (provedor, external_id)
  where external_id is not null;

create index lead_sources_account_idx on public.lead_sources (account_id);

-- Tabela separada, e nao colunas em lead_sources, porque ela NAO recebe grant.
-- Se o token fosse coluna da tabela acima, qualquer `select *` da tela o traria
-- para o payload RSC — a mesma armadilha que o tipo Convite em admin.ts ja
-- documenta para o token de convite.
create table public.source_credentials (
  source_id uuid primary key references public.lead_sources(id) on delete cascade,
  meta_page_token text,
  token_expira_em timestamptz,
  google_key_hash text,
  url_token_hash text,
  atualizado_em timestamptz not null default now()
);

-- O webhook do Google resolve a conta por este hash, entao ele precisa ser
-- inequivoco entre todas as contas.
create unique index source_credentials_url_token_idx
  on public.source_credentials (url_token_hash)
  where url_token_hash is not null;

-- Linha unica: o check garante que so existe a linha `true`.
create table public.ingestion_config (
  id boolean primary key default true check (id),
  segredo_hash text,
  atualizado_em timestamptz not null default now()
);
insert into public.ingestion_config (id, segredo_hash) values (true, null);

-- GRANTS
--
-- lead_sources: select completo, update restrito as colunas que a tela de
-- Integracoes edita direto (nome, responsavel_padrao_id, ativo). provedor e
-- external_id ficam de fora do update de proposito: o `with check` da policy
-- abaixo so valida papel e responsavel, entao sem essa restricao de coluna um
-- admin podia, direto pelo PostgREST, anular external_id (tirando a fonte do
-- indice unico global sem soltar o token da Page) ou trocar provedor (criando
-- uma linha meta com external_id nulo). O check da tabela cobre a mesma
-- garantia por baixo, como segunda linha de defesa. Insert e delete NAO tem
-- grant — passam pelas funcoes abaixo, as unicas que sabem escrever a
-- credencial junto, na mesma transacao.
--
-- source_credentials e ingestion_config: nenhum grant, de proposito. Sem
-- privilegio a RLS nem chega a ser avaliada e o erro e `permission denied`, que
-- e o que os testes asseguram. As funcoes SECURITY DEFINER rodam como postgres
-- e nao dependem desse ACL.
grant select, update (nome, responsavel_padrao_id, ativo) on public.lead_sources to authenticated;

alter table public.lead_sources enable row level security;
alter table public.source_credentials enable row level security;
alter table public.ingestion_config enable row level security;

-- Fonte e configuracao da conta: so admin ve e mexe. Vendedor e gestor nao tem
-- o que fazer aqui — o responsavel padrao aparece para eles pelo lead, nunca
-- pela fonte.
create policy lead_sources_admin_select on public.lead_sources
  for select using (public.papel_na_conta(account_id) = 'admin');
create policy lead_sources_admin_update on public.lead_sources
  for update using (public.papel_na_conta(account_id) = 'admin')
  with check (
    public.papel_na_conta(account_id) = 'admin'
    and public.e_membro_da_conta(account_id, responsavel_padrao_id)
  );

-- Nenhuma policy em source_credentials e ingestion_config: RLS ligada sem
-- policy nega tudo, e o grant ausente ja nega antes. Cinto e suspensorio,
-- porque um grant acidental numa migration futura nao pode abrir a tabela.

-- FUNCOES
--
-- sha256 e nativo do Postgres desde a 11: nenhuma extensao nova.
create or replace function public.hash_segredo(p_valor text)
returns text
language sql
immutable
as $$
  select encode(sha256(p_valor::bytea), 'hex');
$$;

-- Esta funcao prova que o chamador e admin da conta que ele mesmo passou, mas
-- NAO prova que ele controla p_page_id — risco nomeado e com dono, aceito
-- conscientemente para o Plano 3, no README de riscos da spec (secao "Por que
-- unique (provedor, external_id) e global", em
-- docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md). Nao
-- "consertar" aqui sem ler aquela secao primeiro.
create or replace function public.conectar_fonte_meta(
  p_account_id uuid,
  p_page_id text,
  p_nome text,
  p_token text,
  p_responsavel uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;

  begin
    insert into public.lead_sources
      (account_id, provedor, external_id, nome, responsavel_padrao_id)
    values (p_account_id, 'meta', p_page_id, p_nome, p_responsavel)
    returning id into v_id;
  exception when unique_violation then
    -- O indice global e a unica unicidade possivel aqui; traduzir para um
    -- codigo que a UI saiba explicar, em vez de vazar o nome do indice.
    raise exception 'page_ja_conectada';
  end;

  insert into public.source_credentials (source_id, meta_page_token)
  values (v_id, p_token);

  return v_id;
end;
$$;

create or replace function public.conectar_fonte_google(
  p_account_id uuid,
  p_nome text,
  p_url_token text,
  p_google_key text,
  p_responsavel uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_url_token is null or btrim(p_url_token) = '' then
    raise exception 'segredo_vazio';
  end if;

  insert into public.lead_sources
    (account_id, provedor, external_id, nome, responsavel_padrao_id)
  values (p_account_id, 'google', null, p_nome, p_responsavel)
  returning id into v_id;

  -- So o hash entra. O token em claro existe uma vez, no retorno da acao que o
  -- gerou, e nunca mais e recuperavel — mesmo contrato do token de convite.
  insert into public.source_credentials (source_id, url_token_hash, google_key_hash)
  values (v_id, public.hash_segredo(p_url_token), public.hash_segredo(p_google_key));

  return v_id;
end;
$$;

create or replace function public.desconectar_fonte(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  select account_id into v_account from public.lead_sources where id = p_source_id;
  if v_account is null then
    raise exception 'fonte_nao_encontrada';
  end if;
  if public.papel_na_conta(v_account) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- source_credentials cai pelo on delete cascade da PK.
  delete from public.lead_sources where id = p_source_id;
end;
$$;
```

- [ ] **Step 5: Aplicar e rodar**

Run: `npm run db:reset && npx vitest run --config vitest.integration.config.ts tests/integration/0008_fontes_conectadas.test.ts`
Expected: PASS, 13 testes.

Se `authenticated nao le source_credentials` falhar dizendo que a consulta devolveu zero linhas em vez de estourar, a tabela ganhou grant em algum lugar. Ache o grant e remova. **Não** troque a asserção por "devolve vazio": zero linhas por RLS e ausência de privilégio são coisas diferentes, e só a segunda sobrevive a uma policy mal escrita no futuro.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test && npm run test:integration && npm run typecheck`
Expected: 80 unitários PASS, 73 de integração PASS (60 + 13), typecheck limpo.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0008_fontes_conectadas.sql tests/integration/0008_fontes_conectadas.test.ts tests/integration/helpers/db.ts
git commit -m "feat: tabelas e funcoes das fontes de lead conectadas"
```

---

### Task 6: Port do Graph API e o fluxo de OAuth

O Graph API entra como port com duas implementações. Isso não é purismo: sem a implementação falsa, o E2E da Task 8 precisaria de rede, credencial de produção e uma Page real — e a constraint global proíbe isso.

O token de página **nunca chega ao navegador**. O retorno do OAuth guarda o token de *usuário* num cookie `httpOnly` de vida curta; a lista de Pages que a tela mostra tem só `id` e `nome`, e o token da Page escolhida é buscado de novo no servidor, na hora de conectar.

**Files:**
- Create: `src/lib/integracoes/meta.ts`
- Create: `src/lib/integracoes/meta-falso.ts`
- Create: `src/lib/integracoes/meta-real.ts`
- Create: `src/lib/integracoes/fabrica.ts`
- Create: `src/lib/integracoes/estado-oauth.ts`
- Create: `src/lib/integracoes/estado-oauth.test.ts`
- Create: `src/lib/integracoes/meta-falso.test.ts`
- Create: `src/app/api/integracoes/meta/iniciar/route.ts`
- Create: `src/app/api/integracoes/meta/retorno/route.ts`
- Create: `.env.example`

**Interfaces:**
- Consumes: `Resultado`, `ok`, `falha` de `@/lib/domain/resultado`; `criarAdminStoreDoServidor` de `@/lib/data/admin`.
- Produces:
  - `meta.ts`: `type PaginaDoMeta = { id: string; nome: string; token: string }` e `interface MetaGraph` com `trocarCodePorTokenLongo`, `listarPaginas`, `assinarLeadgen`, `desassinarLeadgen`.
  - `meta-falso.ts`: `class MetaGraphFalso implements MetaGraph`, com `assinadas: string[]`, `desassinadas: string[]` e `falharEm: string | null`.
  - `fabrica.ts`: `metaGraph(): MetaGraph` e `metaFalso(): MetaGraphFalso`.
  - `estado-oauth.ts`: `COOKIE_ESTADO`, `COOKIE_TOKEN`, `gerarEstado()`, `conferirEstado(doCookie, daUrl)`.
  - Rotas `GET /api/integracoes/meta/iniciar` e `GET /api/integracoes/meta/retorno`. A Task 7 consome o cookie `COOKIE_TOKEN` que o retorno deixa.

- [ ] **Step 1: Escrever os testes do `state` anti-CSRF**

Crie `src/lib/integracoes/estado-oauth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gerarEstado, conferirEstado } from './estado-oauth'

describe('gerarEstado', () => {
  it('gera 64 caracteres hexadecimais', () => {
    expect(gerarEstado()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('nao repete', () => {
    const vistos = new Set(Array.from({ length: 50 }, () => gerarEstado()))
    expect(vistos.size).toBe(50)
  })
})

describe('conferirEstado', () => {
  it('aceita quando os dois lados batem', () => {
    const e = gerarEstado()
    expect(conferirEstado(e, e)).toBe(true)
  })

  it('recusa quando diferem', () => {
    expect(conferirEstado(gerarEstado(), gerarEstado())).toBe(false)
  })

  it('recusa quando o cookie nao existe', () => {
    expect(conferirEstado(undefined, gerarEstado())).toBe(false)
  })

  it('recusa quando a url nao traz state', () => {
    expect(conferirEstado(gerarEstado(), null)).toBe(false)
  })

  it('recusa string vazia dos dois lados — vazio nao e igualdade valida', () => {
    expect(conferirEstado('', '')).toBe(false)
  })

  it('recusa tamanhos diferentes sem estourar', () => {
    expect(conferirEstado('abc', 'abcdef')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/integracoes/estado-oauth.test.ts`
Expected: FAIL — `Failed to resolve import "./estado-oauth"`.

- [ ] **Step 3: Implementar o `state`**

Crie `src/lib/integracoes/estado-oauth.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Cookie do state anti-CSRF, vivo so entre o iniciar e o retorno. */
export const COOKIE_ESTADO = 'meta_oauth_state'

/**
 * Cookie com o token de USUARIO de longa duracao, entre o retorno e a escolha
 * da Page. Nunca guarda token de pagina: esse e buscado no servidor no momento
 * de conectar e vai direto para o banco.
 */
export const COOKIE_TOKEN = 'meta_oauth_token'

export function gerarEstado(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Comparacao em tempo constante. O state e um segredo de curta duracao, e
 * comparar com === vaza o prefixo correto pelo tempo de resposta.
 *
 * Vazio recusa de proposito: `conferirEstado('', '')` seria "igual" e abriria a
 * porta para o caso em que o cookie foi perdido e a URL veio com state vazio.
 */
export function conferirEstado(doCookie: string | undefined, daUrl: string | null): boolean {
  if (!doCookie || !daUrl) return false
  const a = Buffer.from(doCookie)
  const b = Buffer.from(daUrl)
  // timingSafeEqual exige mesmo tamanho; comparar antes nao vaza nada util,
  // porque o tamanho do state e publico e fixo.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/integracoes/estado-oauth.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 5: Escrever o port e o teste da implementação falsa**

Crie `src/lib/integracoes/meta.ts`:

```ts
import type { Resultado } from '@/lib/domain/resultado'

/** Uma Page do Facebook que o usuario administra, com o token dela. */
export type PaginaDoMeta = { id: string; nome: string; token: string }

/**
 * Tudo que o CRM precisa do Graph API para conectar uma fonte. Port, e nao
 * chamadas de fetch espalhadas, para que nenhum teste automatizado toque a
 * rede: a constraint vale para o E2E tambem.
 *
 * Todo metodo devolve Resultado. O Graph API falha de formas que nao sao
 * excecao de programa (token revogado, permissao faltando, Page ja inscrita em
 * outro app), e essas precisam virar mensagem na tela.
 */
export interface MetaGraph {
  /** Troca o `code` do redirect por um token de usuario de longa duracao. */
  trocarCodePorTokenLongo(code: string, redirectUri: string): Promise<Resultado<string>>
  /** Pages que o usuario administra, cada uma com seu proprio token. */
  listarPaginas(tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>>
  /** Inscreve o app no campo `leadgen` da Page. Sem isto, nenhum webhook chega. */
  assinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>>
  desassinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>>
}
```

Crie `src/lib/integracoes/meta-falso.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MetaGraphFalso } from './meta-falso'

describe('MetaGraphFalso', () => {
  it('troca code por token', async () => {
    const g = new MetaGraphFalso()
    const r = await g.trocarCodePorTokenLongo('code-x', 'http://localhost:3000/retorno')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toContain('token-longo')
  })

  it('lista as paginas semeadas', async () => {
    const g = new MetaGraphFalso([{ id: '1', nome: 'Page Um', token: 't1' }])
    const r = await g.listarPaginas('token-longo')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual([{ id: '1', nome: 'Page Um', token: 't1' }])
  })

  it('registra a inscricao em leadgen', async () => {
    const g = new MetaGraphFalso()
    await g.assinarLeadgen('42', 't')
    expect(g.assinadas).toEqual(['42'])
    expect(g.desassinadas).toEqual([])
  })

  it('registra a desinscricao', async () => {
    const g = new MetaGraphFalso()
    await g.desassinarLeadgen('42', 't')
    expect(g.desassinadas).toEqual(['42'])
  })

  it('falha no metodo configurado e nao registra o efeito', async () => {
    const g = new MetaGraphFalso()
    g.falharEm = 'assinarLeadgen'
    const r = await g.assinarLeadgen('42', 't')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
    expect(g.assinadas).toEqual([])
  })

  it('reiniciar zera o estado gravado', async () => {
    const g = new MetaGraphFalso()
    await g.assinarLeadgen('1', 't')
    g.reiniciar()
    expect(g.assinadas).toEqual([])
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/lib/integracoes/meta-falso.test.ts`
Expected: FAIL — `Failed to resolve import "./meta-falso"`.

- [ ] **Step 7: Implementar a falsa, a real e a fábrica**

Crie `src/lib/integracoes/meta-falso.ts`:

```ts
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

const PAGINAS_PADRAO: PaginaDoMeta[] = [
  { id: '100000000000001', nome: 'SE7E Marketing', token: 'token-da-pagina-1' },
  { id: '100000000000002', nome: 'SE7E Imóveis', token: 'token-da-pagina-2' },
]

/**
 * Test double do MetaGraph. Guarda o que foi chamado para que o teste possa
 * asserir efeito (a Page ficou inscrita em leadgen?) e nao so retorno.
 */
export class MetaGraphFalso implements MetaGraph {
  readonly assinadas: string[] = []
  readonly desassinadas: string[] = []
  /** Nome do metodo que deve falhar, para exercitar o caminho de erro. */
  falharEm: string | null = null

  constructor(private paginas: PaginaDoMeta[] = PAGINAS_PADRAO) {}

  reiniciar(): void {
    this.assinadas.length = 0
    this.desassinadas.length = 0
    this.falharEm = null
  }

  private barrado(metodo: string): boolean {
    return this.falharEm === metodo
  }

  async trocarCodePorTokenLongo(code: string): Promise<Resultado<string>> {
    if (this.barrado('trocarCodePorTokenLongo')) return falha('meta_indisponivel')
    return ok(`token-longo-para-${code}`)
  }

  async listarPaginas(): Promise<Resultado<PaginaDoMeta[]>> {
    if (this.barrado('listarPaginas')) return falha('meta_indisponivel')
    return ok([...this.paginas])
  }

  async assinarLeadgen(pageId: string): Promise<Resultado<void>> {
    if (this.barrado('assinarLeadgen')) return falha('meta_indisponivel')
    this.assinadas.push(pageId)
    return ok(undefined)
  }

  async desassinarLeadgen(pageId: string): Promise<Resultado<void>> {
    if (this.barrado('desassinarLeadgen')) return falha('meta_indisponivel')
    this.desassinadas.push(pageId)
    return ok(undefined)
  }
}
```

Crie `src/lib/integracoes/meta-real.ts`:

```ts
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

const VERSAO = process.env.META_API_VERSION ?? 'v21.0'
const BASE = `https://graph.facebook.com/${VERSAO}`

type RespostaErro = { error?: { message?: string; code?: number } }

/**
 * Traduz qualquer falha do Graph API num codigo unico. A mensagem do Meta e
 * util em log, nunca na tela: ela vem em ingles, muda de texto sem aviso e as
 * vezes cita id interno de app.
 */
async function corpo<T>(r: Response): Promise<Resultado<T>> {
  const dados = (await r.json().catch(() => ({}))) as T & RespostaErro
  if (!r.ok || dados.error) {
    console.error('graph api', r.status, dados.error?.code, dados.error?.message)
    return falha('meta_indisponivel')
  }
  return ok(dados)
}

export class MetaGraphReal implements MetaGraph {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  async trocarCodePorTokenLongo(
    code: string,
    redirectUri: string,
  ): Promise<Resultado<string>> {
    // O dialog devolve um token curto; `fb_exchange_token` o converte no longo.
    // Token de PAGINA derivado de um token de usuario longo nao expira, e e por
    // isso que essa etapa nao pode ser pulada.
    const url = new URL(`${BASE}/oauth/access_token`)
    url.searchParams.set('client_id', this.appId)
    url.searchParams.set('client_secret', this.appSecret)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code', code)

    const curto = await corpo<{ access_token: string }>(await fetch(url))
    if (!curto.ok) return falha(curto.erro)

    const troca = new URL(`${BASE}/oauth/access_token`)
    troca.searchParams.set('grant_type', 'fb_exchange_token')
    troca.searchParams.set('client_id', this.appId)
    troca.searchParams.set('client_secret', this.appSecret)
    troca.searchParams.set('fb_exchange_token', curto.valor.access_token)

    const longo = await corpo<{ access_token: string }>(await fetch(troca))
    if (!longo.ok) return falha(longo.erro)
    return ok(longo.valor.access_token)
  }

  async listarPaginas(tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>> {
    const url = new URL(`${BASE}/me/accounts`)
    url.searchParams.set('fields', 'id,name,access_token')
    url.searchParams.set('access_token', tokenDoUsuario)

    const r = await corpo<{ data: { id: string; name: string; access_token: string }[] }>(
      await fetch(url),
    )
    if (!r.ok) return falha(r.erro)
    return ok(r.valor.data.map((p) => ({ id: p.id, nome: p.name, token: p.access_token })))
  }

  async assinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${pageId}/subscribed_apps`)
    url.searchParams.set('subscribed_fields', 'leadgen')
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await corpo<{ success: boolean }>(await fetch(url, { method: 'POST' }))
    if (!r.ok) return falha(r.erro)
    return ok(undefined)
  }

  async desassinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${pageId}/subscribed_apps`)
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await corpo<{ success: boolean }>(await fetch(url, { method: 'DELETE' }))
    if (!r.ok) return falha(r.erro)
    return ok(undefined)
  }
}
```

Crie `src/lib/integracoes/fabrica.ts`:

```ts
import type { MetaGraph } from './meta'
import { MetaGraphFalso } from './meta-falso'
import { MetaGraphReal } from './meta-real'

let falsoCompartilhado: MetaGraphFalso | null = null

/**
 * Instancia unica do falso no processo. O E2E precisa que a Page "inscrita" num
 * request continue inscrita no request seguinte — com uma instancia nova por
 * chamada, `assinadas` nasceria vazia toda vez.
 */
export function metaFalso(): MetaGraphFalso {
  if (!falsoCompartilhado) falsoCompartilhado = new MetaGraphFalso()
  return falsoCompartilhado
}

/**
 * META_FAKE=1 vale em teste e so em teste. O `next build` de producao nao
 * define a variavel, entao a real e o padrao — mas confira o painel da Vercel
 * antes de subir, porque a falsa aceita qualquer credencial em silencio.
 */
export function metaGraph(): MetaGraph {
  if (process.env.META_FAKE === '1') return metaFalso()
  return new MetaGraphReal(process.env.META_APP_ID ?? '', process.env.META_APP_SECRET ?? '')
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run src/lib/integracoes/`
Expected: PASS, 14 testes (8 do estado + 6 do falso).

- [ ] **Step 9: Documentar as variáveis de ambiente**

Crie `.env.example` (ou acrescente ao que já existir):

```
# Supabase local — ja usados pelos Planos 1 e 2
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Meta Lead Ads (Plano 3)
META_APP_ID=
META_APP_SECRET=
META_API_VERSION=v21.0
# URL publica que o Meta chama de volta. Em desenvolvimento exige tunel ou
# deploy de preview: localhost nao e alcancavel pelo Meta.
META_REDIRECT_URI=http://localhost:3000/api/integracoes/meta/retorno
# 1 troca o Graph API pela implementacao falsa. So para teste.
META_FAKE=

# Segredo de ingestao (o Plano 4 consome; a tela do Plano 3 ja o registra)
INGESTAO_SEGREDO=
```

- [ ] **Step 10: Escrever a rota que inicia o OAuth**

Crie `src/app/api/integracoes/meta/iniciar/route.ts`:

```ts
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { COOKIE_ESTADO, gerarEstado } from '@/lib/integracoes/estado-oauth'

const VERSAO = process.env.META_API_VERSION ?? 'v21.0'

/**
 * pages_show_list para listar as Pages, pages_manage_metadata para inscrever o
 * app no campo leadgen, leads_retrieval para buscar o lead depois. Menos que
 * isso quebra o Plano 4; mais que isso atrasa o App Review sem beneficio.
 */
const ESCOPOS = ['pages_show_list', 'pages_manage_metadata', 'leads_retrieval'].join(',')

export async function GET() {
  // Rota publica por definicao: quem exige a sessao de admin e este check.
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) redirect('/login')

  const estado = gerarEstado()
  const jar = await cookies()
  jar.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    sameSite: 'lax', // 'strict' nao sobrevive ao retorno vindo de facebook.com
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  // Em teste nao existe facebook.com: pula direto para o retorno, que e o
  // trecho do fluxo que o codigo do CRM realmente controla.
  if (process.env.META_FAKE === '1') {
    redirect(`/api/integracoes/meta/retorno?code=code-falso&state=${estado}`)
  }

  const url = new URL(`https://www.facebook.com/${VERSAO}/dialog/oauth`)
  url.searchParams.set('client_id', process.env.META_APP_ID ?? '')
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI ?? '')
  url.searchParams.set('state', estado)
  url.searchParams.set('scope', ESCOPOS)
  url.searchParams.set('response_type', 'code')
  redirect(url.toString())
}
```

- [ ] **Step 11: Escrever a rota de retorno**

Crie `src/app/api/integracoes/meta/retorno/route.ts`:

```ts
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_ESTADO, COOKIE_TOKEN, conferirEstado } from '@/lib/integracoes/estado-oauth'
import { metaGraph } from '@/lib/integracoes/fabrica'

export async function GET(req: NextRequest) {
  const jar = await cookies()
  const doCookie = jar.get(COOKIE_ESTADO)?.value
  const daUrl = req.nextUrl.searchParams.get('state')

  // O state morre na primeira tentativa, valida ou nao: sem isso ele vira um
  // segredo reutilizavel enquanto o cookie durar.
  jar.delete(COOKIE_ESTADO)

  if (!conferirEstado(doCookie, daUrl)) redirect('/config?meta=estado_invalido')

  // O usuario recusar a permissao no dialog e caminho normal, nao erro.
  if (req.nextUrl.searchParams.get('error')) redirect('/config?meta=recusado')

  const code = req.nextUrl.searchParams.get('code')
  if (!code) redirect('/config?meta=recusado')

  const troca = await metaGraph().trocarCodePorTokenLongo(
    code,
    process.env.META_REDIRECT_URI ?? '',
  )
  if (!troca.ok) redirect('/config?meta=indisponivel')

  // Token de USUARIO, nao de pagina. Vive 15 minutos, o suficiente para
  // escolher a Page na tela seguinte; o token da Page e buscado no servidor no
  // momento de conectar e vai direto para source_credentials.
  jar.set(COOKIE_TOKEN, troca.valor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 900,
  })

  redirect('/config?meta=escolher')
}
```

- [ ] **Step 12: Verificar que o build aceita as rotas**

Run: `npm run typecheck && npm run build`
Expected: typecheck limpo e build concluído, listando `/api/integracoes/meta/iniciar` e `/api/integracoes/meta/retorno` como rotas dinâmicas.

- [ ] **Step 13: Commit**

```bash
git add src/lib/integracoes "src/app/api/integracoes" .env.example
git commit -m "feat: port do Graph API do Meta e fluxo de OAuth"
```

---

### Task 7: Tela de Integrações

Quarta seção de `/config`, seguindo o desenho das outras três: Server Component lê, componente cliente renderiza, Server Action muta, `chamarAcao` embrulha toda chamada.

O segredo do Google aparece **uma vez**, no retorno da ação que o cria. Se o admin fechar a caixa sem copiar, tem que desconectar e conectar de novo — é o mesmo contrato do link de convite, e o texto na tela precisa dizer isso.

**Files:**
- Create: `src/lib/domain/fonte.ts`
- Create: `src/lib/data/fontes.ts`
- Create: `src/app/(app)/config/acoes-fontes.ts`
- Create: `src/app/(app)/config/integracoes.tsx`
- Modify: `src/app/(app)/config/page.tsx`
- Modify: `src/app/(app)/config/erros.ts`

**Interfaces:**
- Consumes: `resolverContaAtiva` (Task 2), funções da `0008` (Task 5), `metaGraph`/`COOKIE_TOKEN` (Task 6), `chamarAcao` de `@/lib/ui/acao`, `Membro` de `@/lib/domain/tipos`.
- Produces:
  - `fonte.ts`: `type Provedor = 'meta' | 'google'`, `type Fonte = { id, provedor, externalId, nome, responsavelPadraoId, ativo, criadoEm }`.
  - `fontes.ts`: `interface FonteStore` e `criarFonteStoreDoServidor(): Promise<Resultado<{ fontes: FonteStore; conta: Conta }>>`.
  - `acoes-fontes.ts`: `listarPaginasDoMetaAction`, `conectarPaginaAction`, `conectarGoogleAction`, `definirResponsavelAction`, `desconectarFonteAction`.
  - `<Integracoes fontes={} membros={} origem={} etapa={} />`.

- [ ] **Step 1: Escrever os tipos de domínio**

Crie `src/lib/domain/fonte.ts`:

```ts
export type Provedor = 'meta' | 'google'

export type Fonte = {
  id: string
  provedor: Provedor
  /** page_id no Meta; sempre nulo no Google, que se identifica pela URL. */
  externalId: string | null
  nome: string
  responsavelPadraoId: string | null
  ativo: boolean
  criadoEm: Date
}
```

- [ ] **Step 2: Escrever o store das fontes**

Crie `src/lib/data/fontes.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta } from '@/lib/domain/tipos'
import type { Fonte, Provedor } from '@/lib/domain/fonte'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva } from './conta'

/** O que a tela de Integracoes precisa. Escrita sempre por RPC. */
export interface FonteStore {
  listar(): Promise<Resultado<Fonte[]>>
  conectarMeta(
    pageId: string,
    nome: string,
    tokenDaPagina: string,
    responsavelId: string | null,
  ): Promise<Resultado<string>>
  /** Devolve a URL e a chave em claro UMA vez; depois so o hash existe. */
  conectarGoogle(
    nome: string,
    responsavelId: string | null,
  ): Promise<Resultado<{ id: string; urlToken: string; googleKey: string }>>
  definirResponsavel(sourceId: string, responsavelId: string | null): Promise<Resultado<void>>
  desconectar(sourceId: string): Promise<Resultado<void>>
}

type LinhaFonte = {
  id: string
  provedor: Provedor
  external_id: string | null
  nome: string
  responsavel_padrao_id: string | null
  ativo: boolean
  criado_em: string
}

/** Nomes que as funcoes da 0008 levantam com raise exception. */
const CODIGOS = [
  'sem_sessao',
  'sem_permissao',
  'page_ja_conectada',
  'fonte_nao_encontrada',
  'responsavel_invalido',
  'segredo_vazio',
]

function codigo(mensagem: string): string {
  return CODIGOS.find((c) => mensagem.includes(c)) ?? mensagem
}

export class SupabaseFonteStore implements FonteStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
  ) {}

  async listar(): Promise<Resultado<Fonte[]>> {
    const { data, error } = await this.cliente
      .from('lead_sources')
      .select('id, provedor, external_id, nome, responsavel_padrao_id, ativo, criado_em')
      .eq('account_id', this.accountId)
      .order('criado_em', { ascending: true })
    if (error) return falha(error.message)
    return ok(
      ((data ?? []) as LinhaFonte[]).map((l) => ({
        id: l.id,
        provedor: l.provedor,
        externalId: l.external_id,
        nome: l.nome,
        responsavelPadraoId: l.responsavel_padrao_id,
        ativo: l.ativo,
        criadoEm: new Date(l.criado_em),
      })),
    )
  }

  async conectarMeta(
    pageId: string,
    nome: string,
    tokenDaPagina: string,
    responsavelId: string | null,
  ): Promise<Resultado<string>> {
    const { data, error } = await this.cliente.rpc('conectar_fonte_meta', {
      p_account_id: this.accountId,
      p_page_id: pageId,
      p_nome: nome,
      p_token: tokenDaPagina,
      p_responsavel: responsavelId,
    })
    if (error) return falha(codigo(error.message))
    return ok(data as string)
  }

  async conectarGoogle(
    nome: string,
    responsavelId: string | null,
  ): Promise<Resultado<{ id: string; urlToken: string; googleKey: string }>> {
    // Gerados aqui, e nao no banco: sao os unicos valores que precisam voltar
    // em claro para a tela, e o banco so guarda o hash dos dois.
    const urlToken = randomUUID().replace(/-/g, '')
    const googleKey = randomUUID().replace(/-/g, '')

    const { data, error } = await this.cliente.rpc('conectar_fonte_google', {
      p_account_id: this.accountId,
      p_nome: nome,
      p_url_token: urlToken,
      p_google_key: googleKey,
      p_responsavel: responsavelId,
    })
    if (error) return falha(codigo(error.message))
    return ok({ id: data as string, urlToken, googleKey })
  }

  async definirResponsavel(
    sourceId: string,
    responsavelId: string | null,
  ): Promise<Resultado<void>> {
    // Update direto: a policy lead_sources_admin_update ja exige admin e ja
    // valida que o responsavel e membro da conta.
    const { data, error } = await this.cliente
      .from('lead_sources')
      .update({ responsavel_padrao_id: responsavelId, atualizado_em: new Date().toISOString() })
      .eq('id', sourceId)
      .eq('account_id', this.accountId)
      .select('id')
    if (error) {
      if (/row-level security policy/i.test(error.message)) return falha('responsavel_invalido')
      return falha(error.message)
    }
    // Zero linhas depois da RLS e "nao encontrado", nunca erro de permissao.
    if (!data || data.length === 0) return falha('fonte_nao_encontrada')
    return ok(undefined)
  }

  async desconectar(sourceId: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('desconectar_fonte', { p_source_id: sourceId })
    if (error) return falha(codigo(error.message))
    return ok(undefined)
  }

}

export async function criarFonteStoreDoServidor(): Promise<
  Resultado<{ fontes: SupabaseFonteStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  const ativa = await resolverContaAtiva(cliente, sessao.user.id)
  if (!ativa.ok) return falha(ativa.erro)
  if (ativa.valor.papel !== 'admin') return falha('sem_permissao')

  return ok({
    fontes: new SupabaseFonteStore(cliente, ativa.valor.conta.id),
    conta: ativa.valor.conta,
  })
}
```

- [ ] **Step 3: Escrever as Server Actions**

Crie `src/app/(app)/config/acoes-fontes.ts`:

```ts
'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarFonteStoreDoServidor } from '@/lib/data/fontes'
import { COOKIE_TOKEN } from '@/lib/integracoes/estado-oauth'
import { metaGraph } from '@/lib/integracoes/fabrica'

export type PaginaOferecida = { id: string; nome: string }

/**
 * Lista as Pages sem o token de cada uma. O token e segredo de servidor: se
 * fosse devolvido aqui, iria para o payload RSC e para o HTML.
 */
export async function listarPaginasDoMetaAction(): Promise<Resultado<PaginaOferecida[]>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const jar = await cookies()
  const token = jar.get(COOKIE_TOKEN)?.value
  if (!token) return falha('conexao_expirada')

  const r = await metaGraph().listarPaginas(token)
  if (!r.ok) return falha(r.erro)
  return ok(r.valor.map((p) => ({ id: p.id, nome: p.nome })))
}

export async function conectarPaginaAction(pageId: string): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const jar = await cookies()
  const token = jar.get(COOKIE_TOKEN)?.value
  if (!token) return falha('conexao_expirada')

  // Buscar de novo em vez de confiar no que veio do cliente: o token da Page
  // nunca passou pelo navegador, e o nome tambem vem da fonte da verdade.
  const paginas = await metaGraph().listarPaginas(token)
  if (!paginas.ok) return falha(paginas.erro)
  const pagina = paginas.valor.find((p) => p.id === pageId)
  if (!pagina) return falha('pagina_nao_encontrada')

  // Assinar ANTES de gravar: uma fonte gravada sem inscricao em leadgen nunca
  // receberia webhook, e a tela diria que esta tudo certo.
  const assinou = await metaGraph().assinarLeadgen(pagina.id, pagina.token)
  if (!assinou.ok) return falha(assinou.erro)

  const r = await contexto.valor.fontes.conectarMeta(pagina.id, pagina.nome, pagina.token, null)
  if (!r.ok) return falha(r.erro)

  jar.delete(COOKIE_TOKEN)
  revalidatePath('/config')
  return ok(undefined)
}

export type SegredoDoGoogle = { url: string; chave: string }

export async function conectarGoogleAction(
  nome: string,
  origem: string,
): Promise<Resultado<SegredoDoGoogle>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.fontes.conectarGoogle(limpo, null)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/config')
  return ok({
    url: `${origem}/api/webhooks/google/${r.valor.urlToken}`,
    chave: r.valor.googleKey,
  })
}

export async function definirResponsavelAction(
  sourceId: string,
  responsavelId: string | null,
): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.fontes.definirResponsavel(sourceId, responsavelId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}

export async function desconectarFonteAction(sourceId: string): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.fontes.desconectar(sourceId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}
```

Nota sobre `desconectarFonteAction`: ela **não** chama `desassinarLeadgen`. Desassinar exige o token da Page, que só existe em `source_credentials`, e ler credencial fora do banco é justamente o que este plano proibiu. O Plano 4, que já vai precisar ler o token para a ingestão, é onde a desinscrição no Meta entra. Até lá, desconectar remove a fonte do CRM e o webhook que chegar cai como Page desconhecida — comportamento correto, e o Plano 4 o registra em `integration_log`.

- [ ] **Step 4: Acrescentar as mensagens de erro**

Em `src/app/(app)/config/erros.ts`, acrescente ao `MENSAGENS_ERRO`:

```ts
  conexao_expirada: 'A conexão com o Meta expirou. Clique em "Conectar Facebook" de novo.',
  meta_indisponivel: 'O Facebook não respondeu. Tente de novo em alguns minutos.',
  pagina_nao_encontrada: 'Essa página não está mais disponível na sua conta do Facebook.',
  page_ja_conectada: 'Essa página do Facebook já está conectada a outra conta do CRM.',
  fonte_nao_encontrada: 'Essa integração não existe mais. Recarregue a página.',
  segredo_vazio: 'O segredo não pode ficar em branco.',
```

- [ ] **Step 5: Escrever o componente de Integrações**

Crie `src/app/(app)/config/integracoes.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { chamarAcao } from '@/lib/ui/acao'
import type { Resultado } from '@/lib/domain/resultado'
import type { Fonte } from '@/lib/domain/fonte'
import type { Membro } from '@/lib/domain/tipos'
import { mensagemDeErro } from './erros'
import {
  listarPaginasDoMetaAction,
  conectarPaginaAction,
  conectarGoogleAction,
  definirResponsavelAction,
  desconectarFonteAction,
  type PaginaOferecida,
  type SegredoDoGoogle,
} from './acoes-fontes'

type Props = {
  fontes: Fonte[]
  membros: Membro[]
  origem: string
  /** 'escolher' quando o retorno do OAuth acabou de deixar o token no cookie. */
  etapa: string | null
}

export function Integracoes({ fontes, membros, origem, etapa }: Props) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const [erro, setErro] = useState<string | null>(
    etapa === 'estado_invalido'
      ? 'A conexão não pôde ser verificada. Comece de novo.'
      : etapa === 'recusado'
        ? 'Você não autorizou o acesso às páginas.'
        : etapa === 'indisponivel'
          ? mensagemDeErro('meta_indisponivel')
          : null,
  )
  const [paginas, setPaginas] = useState<PaginaOferecida[] | null>(null)
  const [nomeGoogle, setNomeGoogle] = useState('')
  const [segredoGoogle, setSegredoGoogle] = useState<SegredoDoGoogle | null>(null)

  function rodar(promessa: Promise<Resultado<void>>, aoDarCerto?: () => void) {
    iniciar(async () => {
      setErro(null)
      const r = await chamarAcao(promessa)
      if (!r.ok) {
        setErro(mensagemDeErro(r.erro))
        return
      }
      aoDarCerto?.()
      router.refresh()
    })
  }

  async function carregarPaginas() {
    setErro(null)
    const r = await chamarAcao(listarPaginasDoMetaAction())
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
      return
    }
    setPaginas(r.valor)
  }

  // useEffect, e nao chamada solta no corpo do componente: disparar uma Server
  // Action durante o render e efeito colateral em render, e o React 19 renderiza
  // duas vezes em desenvolvimento — a acao sairia duplicada.
  //
  // A guarda `carregou` e do mesmo naipe: em Strict Mode o efeito tambem roda
  // duas vezes, e sem ela a segunda execucao repetiria a chamada ao Graph API.
  const carregou = useRef(false)
  useEffect(() => {
    if (etapa !== 'escolher' || carregou.current) return
    carregou.current = true
    void carregarPaginas()
    // carregarPaginas so le setters de estado, que sao estaveis; depender de
    // `etapa` e o suficiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Integrações</h2>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {paginas && (
        <div className="flex flex-col gap-2 rounded border p-3">
          <p className="text-sm font-medium">Escolha a página que traz os leads</p>
          {paginas.length === 0 && (
            <p className="text-sm text-gray-600">
              Nenhuma página encontrada nesta conta do Facebook.
            </p>
          )}
          {paginas.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pendente}
              className="rounded border px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() =>
                rodar(conectarPaginaAction(p.id), () => setPaginas(null))
              }
            >
              {p.nome}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {fontes.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 rounded border p-3">
            <span className="text-sm font-medium">{f.nome}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase">
              {f.provedor}
            </span>
            <label className="ml-auto flex items-center gap-2 text-sm">
              Responsável
              <select
                className="rounded border px-2 py-1"
                value={f.responsavelPadraoId ?? ''}
                disabled={pendente}
                onChange={(e) =>
                  rodar(definirResponsavelAction(f.id, e.target.value || null))
                }
              >
                <option value="">Sem responsável</option>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pendente}
              className="rounded border px-2 py-1 text-sm disabled:opacity-50"
              onClick={() => rodar(desconectarFonteAction(f.id))}
            >
              Desconectar
            </button>
          </li>
        ))}
        {fontes.length === 0 && (
          <li className="text-sm text-gray-600">Nenhuma fonte conectada ainda.</li>
        )}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <a
          href="/api/integracoes/meta/iniciar"
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
        >
          Conectar Facebook
        </a>

        <label className="flex flex-col text-sm">
          Nome do formulário do Google
          <input
            className="rounded border px-2 py-1"
            placeholder="nome do formulário"
            value={nomeGoogle}
            onChange={(e) => setNomeGoogle(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={pendente}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() =>
            iniciar(async () => {
              setErro(null)
              const r = await chamarAcao(conectarGoogleAction(nomeGoogle, origem))
              if (!r.ok) {
                setErro(mensagemDeErro(r.erro))
                return
              }
              setSegredoGoogle(r.valor)
              setNomeGoogle('')
              router.refresh()
            })
          }
        >
          Gerar URL do Google
        </button>
      </div>

      {segredoGoogle && (
        <div className="flex flex-col gap-1 rounded border border-amber-400 bg-amber-50 p-3">
          <p className="text-sm font-medium">
            Copie agora — não mostramos de novo.
          </p>
          <code className="break-all text-xs">{segredoGoogle.url}</code>
          <code className="break-all text-xs">chave: {segredoGoogle.chave}</code>
          <p className="text-xs text-gray-700">
            No Google Ads, cole os dois em Ativo de formulário de lead → Integração via
            webhook.
          </p>
        </div>
      )}

    </section>
  )
}
```

- [ ] **Step 6: Encaixar a seção na página de configuração**

Em `src/app/(app)/config/page.tsx`, acrescente os imports:

```tsx
import { criarFonteStoreDoServidor } from '@/lib/data/fontes'
import { Integracoes } from './integracoes'
```

Mude a assinatura da função para receber os search params e acrescente a leitura das fontes. Substitua a declaração e o bloco de leituras:

```tsx
export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string }>
}) {
  const { meta } = await searchParams

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  if (contexto.valor.papel !== 'admin') {
    return <p className="p-6 text-sm">Só administradores acessam a configuração.</p>
  }

  const adminContexto = await criarAdminStoreDoServidor()
  if (!adminContexto.ok) throw new Error(adminContexto.erro)

  const fonteContexto = await criarFonteStoreDoServidor()
  if (!fonteContexto.ok) throw new Error(fonteContexto.erro)

  const { store } = contexto.valor
  const [pipeline, membros, convites, fontes] = await Promise.all([
    store.pipelinePadrao(),
    store.membros(),
    adminContexto.valor.admin.convitesPendentes(),
    fonteContexto.valor.fontes.listar(),
  ])
  if (!pipeline.ok) throw new Error(pipeline.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!convites.ok) throw new Error(convites.erro)
  if (!fontes.ok) throw new Error(fontes.erro)
```

E acrescente a seção ao JSX, depois de `<Usuarios ... />`:

```tsx
      <Integracoes
        fontes={fontes.valor}
        membros={membros.valor}
        origem={origem}
        etapa={meta ?? null}
      />
```

- [ ] **Step 7: Verificar no navegador**

Com o stack local rodando (`npx supabase start`) e `META_FAKE=1` no `.env.local`:

Run: `npm run dev`

1. Crie uma conta em `/signup`, vá em `/config`.
2. Clique em **Conectar Facebook**. Como `META_FAKE=1`, você volta direto para `/config?meta=escolher` e a lista mostra "SE7E Marketing" e "SE7E Imóveis".
3. Clique numa delas. A fonte aparece na lista com o selo `meta`.
4. Escolha um responsável no select. Recarregue: a escolha persistiu.
5. Digite um nome e clique em **Gerar URL do Google**. A caixa âmbar mostra a URL e a chave.
6. Recarregue a página: a caixa âmbar **não** volta. Se voltar, o segredo está sendo relido do servidor e isso é defeito.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npm test && npm run test:integration && npm run typecheck && npm run build`
Expected: 94 unitários PASS (80 + 14 da Task 6), 73 de integração PASS, typecheck e build limpos.

- [ ] **Step 9: Commit**

```bash
git add src/lib/domain/fonte.ts src/lib/data/fontes.ts "src/app/(app)/config"
git commit -m "feat: tela de integracoes conecta Page do Meta e gera URL do Google"
```

---

### Task 8: E2E do fluxo de conexão

O E2E é o que provou, no Plano 2, que verificação por HTTP não substitui navegador — o drag-and-drop passava por script e não tinha feedback nenhum na tela. Aqui ele cobre a coisa equivalente: o retorno do OAuth define cookie e redireciona, e nada disso é exercitado por teste de integração.

**Files:**
- Create: `tests/e2e/integracoes.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: `criarConta`, `carimbo` de `./apoio`; rotas e tela das Tasks 6 e 7.
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Ligar o modo falso no servidor do Playwright**

Em `playwright.config.ts`, acrescente `env` ao bloco `webServer`:

```ts
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
    // Sem isto o teste bateria em facebook.com, o que a constraint global
    // proibe. reuseExistingServer: true significa que um `npm run dev` ja
    // aberto SEM esta variavel continua valendo — derrube-o antes de rodar.
    env: { META_FAKE: '1' },
  },
```

- [ ] **Step 2: Escrever o teste**

Crie `tests/e2e/integracoes.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { criarConta, carimbo } from './apoio'

test('admin conecta uma Page do Meta e gera a URL do Google', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await expect(page.getByRole('heading', { name: 'Integrações', level: 2 })).toBeVisible()
  await expect(page.getByText('Nenhuma fonte conectada ainda.')).toBeVisible()

  // O clique sai do app, passa pelo retorno e volta — em modo falso, sem rede.
  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await expect(page).toHaveURL(/\/config\?meta=escolher/)

  await page.getByRole('button', { name: 'SE7E Marketing' }).click()

  // A fonte aparece na lista, com o selo do provedor.
  const fonte = page.locator('li').filter({ hasText: 'SE7E Marketing' })
  await expect(fonte).toBeVisible()
  await expect(fonte.getByText('meta')).toBeVisible()

  // Responsavel padrao persiste depois do recarregamento.
  await fonte.getByRole('combobox').selectOption({ label: 'Pedro E2E' })
  await page.reload()
  await expect(
    page.locator('li').filter({ hasText: 'SE7E Marketing' }).getByRole('combobox'),
  ).toHaveValue(/.+/)

  // Google: a URL e a chave aparecem uma vez.
  const nome = `Formulario ${carimbo()}`
  await page.getByPlaceholder('nome do formulário', { exact: true }).fill(nome)
  await page.getByRole('button', { name: 'Gerar URL do Google' }).click()

  await expect(page.getByText('Copie agora — não mostramos de novo.')).toBeVisible()
  await expect(page.getByText('/api/webhooks/google/')).toBeVisible()

  // E some para sempre no recarregamento.
  await page.reload()
  await expect(page.getByText('Copie agora — não mostramos de novo.')).toHaveCount(0)
  await expect(page.locator('li').filter({ hasText: nome })).toBeVisible()
})

test('desconectar remove a fonte da lista', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await page.getByRole('button', { name: 'SE7E Imóveis' }).click()

  const fonte = page.locator('li').filter({ hasText: 'SE7E Imóveis' })
  await expect(fonte).toBeVisible()

  await fonte.getByRole('button', { name: 'Desconectar' }).click()
  await expect(page.locator('li').filter({ hasText: 'SE7E Imóveis' })).toHaveCount(0)
})
```

- [ ] **Step 3: Rodar o E2E**

Derrube qualquer `npm run dev` aberto antes (o `reuseExistingServer` reaproveitaria um servidor sem `META_FAKE`).

Run: `npm run test:e2e`
Expected: PASS, 6 testes (4 que já existiam + 2 novos).

Se `admin conecta uma Page do Meta` falhar em `/config?meta=escolher` com a lista vazia, o cookie do token não sobreviveu ao redirect — confira `sameSite: 'lax'` e `path: '/'` no `retorno/route.ts`. Não troque o teste por um que aceite lista vazia.

**Atenção à segunda Page:** o segundo teste conecta "SE7E Imóveis" e não "SE7E Marketing" de propósito. O índice de `lead_sources` é **global**, e o banco local não é limpo entre rodadas de E2E — dois testes conectando a mesma Page fariam o segundo estourar `page_ja_conectada`. Se você acrescentar mais um teste que conecta Page, ele precisa de uma terceira Page em `PAGINAS_PADRAO`.

- [ ] **Step 4: Rodar tudo**

Run: `npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run build`
Expected: 94 unitários, 73 de integração, 6 E2E, typecheck e build limpos.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/integracoes.spec.ts playwright.config.ts
git commit -m "test: E2E do fluxo de conexao de fontes"
```

- [ ] **Step 6: Registrar a verificação manual pendente**

Esta verificação **não** roda neste plano e não bloqueia o merge — ela depende de URL pública. Acrescente ao final de `.superpowers/sdd/progress.md`, na seção de backlog:

```
## Verificacao manual pendente (sub-projeto 2)

Nao coberta por teste automatizado, por decisao de design (spec §1: nenhum teste
toca a rede). Fazer em deploy de preview da Vercel ou tunel, com META_FAKE
desligado:

1. OAuth real: clicar em Conectar Facebook, autorizar, e conferir que a Page
   escolhida aparece inscrita em `leadgen` em
   GET /{page_id}/subscribed_apps.
2. Confirmar que META_REDIRECT_URI no painel do Meta bate exatamente com a URL
   do ambiente — divergencia de barra final ja derruba a troca do code.
3. O "Enviar dados de teste" do Google so tem o que exercitar depois do Plano 4,
   que cria a rota /api/webhooks/google/[token].
```

- [ ] **Step 7: Commit final do plano**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: registra a verificacao manual pendente do sub-projeto 2"
```

Nota: `.superpowers/sdd/progress.md` é gitignored no repo. Se o `git add` recusar, o arquivo é local por desenho — registre a nota nele mesmo assim e pule o commit.

---

## Pronto quando

- `npm test` (94), `npm run test:integration` (73), `npm run test:e2e` (6), `npm run typecheck` e `npm run build` todos limpos, rodados no resultado do merge e não só antes dele.
- Um admin abre `/config`, clica em **Conectar Facebook**, escolhe a Page, define o responsável padrão e vê a fonte listada.
- O mesmo admin gera a URL secreta do Google, ela aparece uma vez e não volta no recarregamento.
- `select * from public.source_credentials` como `authenticated` responde `permission denied`.
- Conectar a mesma Page por duas contas falha com `page_ja_conectada`.
- Os quatro itens do backlog (#3, #4, #9, #10) estão fechados, cada um com teste que falhava antes.
- Nenhum teste automatizado faz requisição de rede.
