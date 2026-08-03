# Plano 7 — Tarefas (sub-projeto 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O vendedor agenda follow-up num lead, vê tudo o que vence em `/tarefas`, e conclui — com a conclusão virando história na timeline do lead.

**Architecture:** Tabela `tasks` filha de `leads`, sem dono próprio: a tarefa é do responsável do lead, então as quatro policies são `pode_ver_lead_id(lead_id)` e nenhum código de autorização novo é escrito. A regra que erra em silêncio (classificar prazo em dia civil, num fuso) vive em função pura testada sem Docker. Um port `TarefaStore` com implementação única, a Supabase, coberta por integração contra Postgres real.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Supabase (Postgres/RLS) + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-02-crm-scripts-tarefas-design.md` — leia §3 inteira antes da Task 2.

## Global Constraints

- **`grant` explícito em toda tabela nova.** O default ACL do schema `public` nesta imagem (Postgres 17.6) dá a `anon`/`authenticated` só `Dxtm`. Sem `grant`, o erro é `permission denied` e a RLS **nem chega a ser avaliada**.
- **`npx supabase`, nunca `supabase`.** O binário não está no PATH desta máquina.
- **Antes de rodar E2E, derrube qualquer `npm run dev` aberto.** O `reuseExistingServer` do Playwright se conecta a um servidor que subiu sem `META_FAKE`.
- **Nenhuma mensagem crua do PostgREST na tela.** Toda Server Action devolve código conhecido, traduzido no mapa de erro da rota.
- **Toda Server Action chamada de componente cliente passa por `chamarAcao`** (`@/lib/ui/acao`), senão falha de transporte deixa a tela muda.
- **`atualizado_em` é escrito pela aplicação**, como `supabase.ts:259` faz em `leads`. Este repo não tem trigger de `atualizado_em` em tabela nenhuma e este plano não introduz o primeiro.
- **Fuso:** `America/Sao_Paulo`, e comparação sempre entre **dias civis**, nunca entre instantes.
- **Nenhuma contagem de teste aparece neste plano.** O portão de cada task é "suíte verde e todo teste novo com RED demonstrado".

### Sobre a forma deste plano — leia antes de começar

Quatro vezes seguidas neste projeto, quase todo achado grave de review foi **defeito do plano**, transcrito fielmente pelo implementador. Blocos grandes de TypeScript dentro de um plano são código-fonte que nenhum compilador, linter ou teste jamais roda, e o implementador os trata como normativos.

Então este plano é deliberadamente assimétrico:

- **Literal, para copiar como está:** o DDL, as policies, os `grant`. A forma exata é carga estrutural — uma policy reescrita "com o mesmo sentido" é uma falha de segurança silenciosa.
- **Assinatura + invariantes + casos de teste nomeados, para você escrever sob TDD:** todo o TypeScript. As assinaturas são normativas (outras tasks dependem delas). Os corpos são seus.

Onde um caso de teste está nomeado, ele é obrigatório, e o texto diz **o que ele afirma** e **o que tem que quebrar para ele ficar vermelho**. Se um teste seu passar de primeira sem você ter visto o vermelho, ele não conta: quebre o comportamento de propósito, veja o vermelho, reverta.

---

## Task 1: Infraestrutura de teste de componente

O repo não tem nenhum `*.test.tsx`, e `vitest.config.ts` coleta só `src/**/*.test.ts` em `environment: 'node'`. Consequência já existente: `rotuloEvento`, função pura exportada de `timeline.tsx`, **não tem teste nenhum**.

Esta task existe agora, antes das telas, porque as Tasks 5 e 6 criam quatro superfícies novas na costura entre função pura e DOM.

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `vitest.config.ts`
- Create: `src/app/(app)/leads/[id]/timeline.test.tsx`

**Interfaces:**
- Consumes: `rotuloEvento(evento, nomeEtapa, nomePessoa)` e `Timeline`, ambos já exportados de `src/app/(app)/leads/[id]/timeline.tsx`
- Produces: capacidade de escrever `*.test.tsx`. As Tasks 5 e 6 dependem disto.

- [ ] **Step 1: Instalar as duas dependências**

`@vitejs/plugin-react` **já está** nas devDependencies. Faltam duas:

```bash
npm i -D jsdom @testing-library/react
```

Não instale `@testing-library/jest-dom`. Os testes deste plano usam só `expect` do vitest sobre `textContent` e atributos — um matcher a menos para configurar, e um `setupFiles` a menos.

- [ ] **Step 2: Escrever o teste de componente**

Crie `src/app/(app)/leads/[id]/timeline.test.tsx`. A primeira linha do arquivo tem que ser o docblock de ambiente — sem ele o teste roda em `node` e não há DOM:

```tsx
// @vitest-environment jsdom
```

Três casos, e nenhum deles é decorativo:

1. **`rotuloEvento` traduz `etapa_alterada` usando os dois mapas.** Monte um `EventoLead` com `payload: { de: 'id-a', para: 'id-b' }` e mapas que resolvem os dois ids para nomes. Afirme que a string devolvida contém os dois **nomes**. Fica vermelho se alguém trocar `nomeEtapa.get(...)` por `String(p.de)`.
2. **`rotuloEvento` cai no `default` para tipo desconhecido.** Passe `tipo: 'tarefa_concluida'` — que ainda não existe no `switch` — e afirme que a devolução é a própria string `'tarefa_concluida'`. Este caso é a rede de segurança da Task 5: prova que a timeline não quebra na ordem em que as tasks caírem.
3. **`Timeline` com lista vazia renderiza o estado vazio.** Renderize com `eventos: []` e afirme o texto `'Nada aconteceu ainda.'` no documento.

- [ ] **Step 3: Rodar e observar que o arquivo NÃO é coletado**

```bash
npm test
```

Esperado: a suíte passa **sem executar nada do arquivo novo** — `include: ['src/**/*.test.ts']` não casa com `.tsx`. Confirme lendo a lista de arquivos na saída: `timeline.test.tsx` não aparece.

Este é o vermelho desta task. Ele não é uma asserção falhando; é a prova de que a infraestrutura não existe.

- [ ] **Step 4: Ligar o JSX e o jsdom no vitest**

Em `vitest.config.ts`: importe `react from '@vitejs/plugin-react'`, adicione `plugins: [react()]` no objeto raiz, e troque o `include` para `['src/**/*.test.{ts,tsx}']`.

Mantenha `environment: 'node'` como padrão. O jsdom entra **por arquivo**, pelo docblock do Step 2 — assim nenhum dos testes existentes muda de ambiente, e não há segunda suíte no `package.json`.

- [ ] **Step 5: Rodar e ver os três casos passarem**

```bash
npm test
```

Esperado: `timeline.test.tsx` aparece na lista e os três casos passam.

- [ ] **Step 6: Experimento de discriminação — obrigatório**

Os três casos passaram de primeira, então nenhum deles demonstrou vermelho ainda. Leitura não substitui o experimento; prove um por um:

1. Em `timeline.tsx`, troque `nomeEtapa.get(String(p.para)) ?? '?'` por `String(p.para)`. Rode `npm test`. **O caso 1 tem que ficar vermelho.** Reverta.
2. Troque o `default: return evento.tipo` por `default: return ''`. Rode. **O caso 2 tem que ficar vermelho.** Reverta.
3. Troque o texto `'Nada aconteceu ainda.'`. Rode. **O caso 3 tem que ficar vermelho.** Reverta.

Se algum não ficar vermelho, o teste está errado — conserte o teste, não afrouxe a asserção.

- [ ] **Step 7: Portão e commit**

```bash
npm test && npm run typecheck && npm run lint
```

Os três limpos. Se o `lint` reclamar do arquivo de teste, ajuste o teste — não adicione exceção de lint.

```bash
git add package.json package-lock.json vitest.config.ts "src/app/(app)/leads/[id]/timeline.test.tsx"
git commit -m "test: infraestrutura de teste de componente, e o primeiro teste de rotuloEvento"
```

---

## Task 2: Migration `0015` — tabela `tasks` e a RLS

**Files:**
- Create: `supabase/migrations/0015_tarefas.sql`
- Create: `tests/integration/0015_tarefas.test.ts`

**Interfaces:**
- Consumes: `public.pode_ver_lead_id(uuid)` de `0003_leads.sql:89`; helpers de teste `montarCenario`, `etapa`, `criarLead` (`tests/integration/helpers/cenario.ts`) e `clienteDoUsuario` (`helpers/cliente.ts`)
- Produces: tabela `public.tasks` com as colunas abaixo. A Task 4 lê e escreve nela.

- [ ] **Step 1: Escrever o teste de integração**

Crie `tests/integration/0015_tarefas.test.ts`. Siga a forma de `tests/integration/0003_leads.test.ts`. Monte o cenário uma vez e crie dois leads: um do `vendedorAId` e um do `vendedorBId`, ambos numa etapa aberta.

Casos obrigatórios:

1. **Vendedor A insere tarefa no lead dele e a lê de volta.** Prova o caminho feliz e, junto, o `grant` — sem ele o erro seria `permission denied` e não zero linhas.
2. **Vendedor A não enxerga a tarefa do lead do vendedor B.** Insira pelo serviço uma tarefa no lead de B; `select` como A devolve zero linhas.
3. **Vendedor A não consegue inserir tarefa no lead do vendedor B.** A operação afeta zero linhas ou erra; o que **não** pode acontecer é a linha existir depois. Afirme relendo pelo serviço.
4. **Discriminação por papel — este é o caso que não pode faltar.** Rode **a mesma consulta**, `select count(*) from public.tasks`, como `adminId` e como `vendedorAId`. O admin tem que ver **estritamente mais** que o vendedor. Contar linhas de um papel só passaria com a proteção desligada; é a diferença entre os dois que discrimina.
5. **Título em branco é recusado.** `insert` com `titulo = '   '` viola o check.
6. **Vendedor A exclui a própria tarefa**, e a linha some. Diferente de lead, tarefa tem policy de delete.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm run test:integration -- 0015
```

Esperado: FAIL com `relation "public.tasks" does not exist`.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0015_tarefas.sql`:

```sql
-- Tarefa e filha de lead e NAO tem dono proprio: ela e de quem responde pelo
-- lead. Por isso nao ha responsavel_id aqui, e por isso as quatro policies sao
-- o mesmo pode_ver_lead_id que lead_tags e stage_history ja usam — nenhuma
-- regra de autorizacao nova entra no projeto com esta tabela.
create type public.task_tipo as enum
  ('ligacao', 'whatsapp', 'reuniao', 'proposta', 'outro');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  titulo text not null check (btrim(titulo) <> ''),
  tipo public.task_tipo not null default 'outro',
  vence_em timestamptz not null,
  concluida_em timestamptz,
  concluida_por uuid references public.profiles(id),
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index tasks_lead_idx on public.tasks (lead_id, vence_em);

-- Parcial: /tarefas e o badge so leem tarefa aberta, e a maioria das linhas
-- da tabela vai estar concluida depois de algumas semanas de uso.
create index tasks_abertas_idx on public.tasks (vence_em)
  where concluida_em is null;

-- Grant explicito: o default ACL do schema public nesta imagem da a
-- authenticated so Dxtm. Sem esta linha a RLS nem chega a ser avaliada.
grant select, insert, update, delete on public.tasks to authenticated;

alter table public.tasks enable row level security;

create policy tasks_select on public.tasks
  for select using (public.pode_ver_lead_id(lead_id));
create policy tasks_insert on public.tasks
  for insert with check (public.pode_ver_lead_id(lead_id));
-- O with check repete o using de proposito: sem ele, um update poderia mover a
-- tarefa para um lead fora do alcance de quem edita.
create policy tasks_update on public.tasks
  for update using (public.pode_ver_lead_id(lead_id))
  with check (public.pode_ver_lead_id(lead_id));
-- Diferente de lead, tarefa se apaga: erro de digitacao em follow-up nao
-- merece ser eterno.
create policy tasks_delete on public.tasks
  for delete using (public.pode_ver_lead_id(lead_id));
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0015
```

Esperado: PASS em todos os casos.

- [ ] **Step 5: Experimento de discriminação no caso 4**

Troque o `using` da `tasks_select` de `public.pode_ver_lead_id(lead_id)` para `true` e rode:

```bash
npm run db:reset && npm run test:integration -- 0015
```

**Os casos 2 e 4 têm que ficar vermelhos** — o vendedor passaria a enxergar a tarefa alheia, e as duas contagens do caso 4 ficariam iguais. Reverta.

Este é o experimento certo porque `true` é uma policy **permissiva demais**, que é a direção em que o defeito real acontece. Remover a policy inteira testaria a direção oposta (nega tudo) e faria o caso 1 cair primeiro, sem provar nada sobre isolamento.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck
```

```bash
git add supabase/migrations/0015_tarefas.sql tests/integration/0015_tarefas.test.ts
git commit -m "feat: tabela tasks, com a RLS herdada de pode_ver_lead_id"
```

---

## Task 3: O domínio puro do prazo

**Files:**
- Create: `src/lib/domain/tarefa.ts`
- Create: `src/lib/domain/tarefa.test.ts`

**Interfaces:**
- Produces — assinaturas normativas, usadas pelas Tasks 4, 5 e 6:

```ts
export const FUSO_PADRAO = 'America/Sao_Paulo'

export type Balde = 'atrasada' | 'hoje' | 'proximos7' | 'depois'

export function classificar(venceEm: Date, agora: Date, fuso: string): Balde

/** Conta quantas tarefas caem em 'atrasada' ou 'hoje'. Alimenta o badge. */
export function contarUrgentes(venceEm: Date[], agora: Date, fuso: string): number
```

**Invariantes de `classificar`**, nesta ordem de avaliação:

1. `venceEm < agora` → `'atrasada'`, **mesmo que seja hoje mais tarde no relógio civil**. Vencer é vencer.
2. senão, mesmo dia civil que `agora` no fuso → `'hoje'`
3. senão, dia civil entre amanhã e amanhã + 6 (sete dias, ambos os extremos incluídos) → `'proximos7'`
4. senão → `'depois'`

**A comparação de (2) e (3) é entre dias civis no fuso, nunca entre instantes.** `agora` às 23h e `venceEm` amanhã à 1h são dias diferentes, e a diferença de 2 horas não pode decidir nada. `Intl.DateTimeFormat` com `timeZone` e locale `'en-CA'` devolve `YYYY-MM-DD`, que ordena lexicograficamente — não há dependência nova a instalar.

- [ ] **Step 1: Escrever os testes**

Crie `src/lib/domain/tarefa.test.ts`. Casos obrigatórios:

1. **Um milissegundo antes de `agora` é `'atrasada'`.**
2. **Hoje mais tarde é `'hoje'`;** hoje mais cedo é `'atrasada'`. Os dois no mesmo dia civil — o que separa é a regra (1) vir antes da (2).
3. **O caso que só o fuso resolve.** `agora = 2026-08-03T02:00:00Z` e `venceEm = 2026-08-03T03:00:00Z`. Em UTC os dois são dia 3. Em `America/Sao_Paulo` (UTC−3) os dois são **dia 2 às 23h e dia 3 à meia-noite** — dias civis diferentes, então o resultado é `'proximos7'`, não `'hoje'`. Este caso fica vermelho para qualquer implementação que compare em UTC ou que subtraia milissegundos.
4. **Vinte e três horas e meia de distância pode ser `'proximos7'`.** `agora` às 23h30 no fuso e `venceEm` no dia seguinte às 23h00: menos de 24h de diferença, dias civis diferentes → `'proximos7'`. Quebra qualquer implementação baseada em `(venceEm - agora) / 86400000`.
5. **A fronteira dos sete dias.** Amanhã + 6 é `'proximos7'`; amanhã + 7 é `'depois'`. Ambos obrigatórios — um só não prova onde está a borda.
6. **`contarUrgentes` soma `'atrasada'` e `'hoje'` e ignora o resto.** Uma lista com um de cada balde devolve 2.

Escreva as datas como ISO com offset explícito (`'2026-08-02T23:30:00-03:00'`), nunca como `new Date(2026, 7, 2)` — o construtor por componentes usa o fuso da máquina que roda o teste, e o teste passaria ou falharia conforme a máquina.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm test -- tarefa
```

Esperado: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/lib/domain/tarefa.ts` com as assinaturas acima. Sem IO, sem dependência nova, sem import de nada fora de `Intl`.

- [ ] **Step 4: Verde**

```bash
npm test -- tarefa
```

- [ ] **Step 5: Experimento de discriminação**

Troque a comparação de dia civil por diferença de milissegundos (`venceEm.getTime() - agora.getTime() < 86400000` para `'hoje'`). Rode. **Os casos 3 e 4 têm que ficar vermelhos.** Reverta.

Se eles passarem com a implementação errada, os casos estão mal construídos — conserte os casos.

- [ ] **Step 6: Portão e commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/domain/tarefa.ts src/lib/domain/tarefa.test.ts
git commit -m "feat: classificacao de prazo por dia civil no fuso, em funcao pura"
```

---

## Task 4: Port `TarefaStore`

**Files:**
- Create: `src/lib/data/tarefas.ts`
- Create: `tests/integration/tarefas-store.test.ts`

**Interfaces:**
- Consumes: tabela `public.tasks` (Task 2); `Resultado`, `ok`, `falha` de `@/lib/domain/resultado`; `criarClienteServidor` de `@/lib/supabase/servidor`
- Produces — normativo, consumido pelas Tasks 5 e 6:

```ts
export type TipoTarefa = 'ligacao' | 'whatsapp' | 'reuniao' | 'proposta' | 'outro'

export type Tarefa = {
  id: string
  leadId: string
  leadNome: string
  titulo: string
  tipo: TipoTarefa
  venceEm: Date
  concluidaEm: Date | null
  concluidaPor: string | null
  criadoPor: string | null
  criadoEm: Date
}

export interface TarefaStore {
  doLead(leadId: string): Promise<Resultado<Tarefa[]>>
  minhasAbertas(responsavelId: string | null): Promise<Resultado<Tarefa[]>>
  criar(d: {
    leadId: string
    titulo: string
    tipo: TipoTarefa
    venceEm: Date
  }): Promise<Resultado<string>>
  concluir(id: string): Promise<Resultado<void>>
  reabrir(id: string): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
}

export class SupabaseTarefaStore implements TarefaStore { /* ... */ }

export async function criarTarefaStoreDoServidor(): Promise<Resultado<TarefaStore>>
```

**Uma implementação só, a Supabase.** É escolha, não esquecimento: nada consumiria um in-memory aqui — as telas são server components, cobertos por integração e E2E. `InMemoryCrmStore` já é 376 linhas mantidas em paralelo com o SQL **sem nenhum consumidor além do próprio teste**, e o Plano 6 gastou um commit cobrindo ramificações dele que podiam divergir. `NotificacaoStore` é o análogo próximo e segue este mesmo caminho.

**Invariantes que os testes têm que travar:**

- **`minhasAbertas` filtra `leads.responsavel_id` explicitamente, por cima da RLS.** `pode_ver_lead_id` entrega ao admin **toda** tarefa da conta; sem esse filtro, "Minhas tarefas" mostraria as dos outros. Para vendedor o filtro é redundante — e fica assim mesmo, incondicional. `responsavelId = null` significa "leads sem responsável".
- **`minhasAbertas` devolve só `concluida_em is null`.**
- **Ordenação: `vence_em asc`, desempate `criado_em asc, id asc`.** Desempate não é zelo: o Plano 3 gastou uma task inteira (`lead_events.seq`) por ordenação sem desempate sob timestamp idêntico.
- **O join com `leads` para o `leadNome` é embed simples**, e **não** deve copiar a defesa do `SupabaseNotificacaoStore`. Lá o `leads` pode chegar nulo porque a notificação é do usuário e sobrevive ao lead sair do alcance dele; aqui a policy de `tasks` já exige o lead visível.
- **`concluir` grava `concluida_em = now()` e `concluida_por = auth.uid()`; `reabrir` volta os dois para `null`.** Os dois também escrevem `atualizado_em`.
- **Zero linhas depois da RLS é `falha('tarefa_nao_encontrada')`**, nunca sucesso mudo — a mesma convenção de `marcarLida` em `notificacoes.ts`. Vale para `concluir`, `reabrir` e `excluir`.

- [ ] **Step 1: Escrever o teste de integração**

Crie `tests/integration/tarefas-store.test.ts`, na forma de `tests/integration/notificacoes-store.test.ts`. Casos obrigatórios:

1. **`doLead` ordena por prazo.** Três tarefas com `vence_em` fora de ordem; a devolução vem crescente. Afirme **por posição no array**, nunca com `toContain` — fortalecer asserção fraca é o que já expôs empate real de ordenação neste repo.
2. **Desempate sob `vence_em` idêntico.** Duas tarefas com o mesmo `vence_em` ao milissegundo e `criado_em` diferentes: a mais antiga vem primeiro, sempre. Rode este caso algumas vezes para descartar que a ordem física esteja concordando por sorte.
3. **`minhasAbertas` do admin não traz tarefa de lead alheio — o caso central.** Monte: uma tarefa num lead cujo responsável é o admin, e outra num lead do vendedor A. Chamando como admin, `minhasAbertas(adminId)` devolve **uma** — e, no mesmo teste, `select count(*) from public.tasks` pelo mesmo cliente devolve **duas**. As duas asserções juntas são o que prova que o filtro existe *além* da RLS; a primeira sozinha passaria com o filtro ausente e a RLS restritiva.
4. **`minhasAbertas(null)` devolve as tarefas de lead sem responsável**, e não as outras.
5. **Tarefa concluída não aparece em `minhasAbertas`.**
6. **`concluir` carimba `concluida_em` e `concluida_por`;** `reabrir` devolve os dois a `null`.
7. **`excluir` uma tarefa de lead fora do alcance devolve `falha('tarefa_nao_encontrada')`** e a linha continua existindo (releia pelo serviço para confirmar). Um sucesso mudo aqui seria o defeito.

- [ ] **Step 2: Vermelho**

```bash
npm run test:integration -- tarefas-store
```

Esperado: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/lib/data/tarefas.ts` com as assinaturas e invariantes acima.

- [ ] **Step 4: Verde**

```bash
npm run test:integration -- tarefas-store
```

- [ ] **Step 5: Experimento de discriminação no caso 3**

Remova o filtro por `responsavel_id` de `minhasAbertas`. Rode. **O caso 3 tem que ficar vermelho** na asserção de que o admin recebe uma só. Reverta.

Este é o experimento mais importante da task: é exatamente o defeito que a RLS **não** pega, porque a RLS aqui é permissiva de propósito para admin.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/data/tarefas.ts tests/integration/tarefas-store.test.ts
git commit -m "feat: port de tarefas, com o filtro por responsavel acima da RLS"
```

---

## Task 5: Painel de tarefas na ficha do lead

**Files:**
- Create: `src/app/(app)/tarefas/erros.ts`
- Create: `src/app/(app)/tarefas/acoes.ts`
- Create: `src/app/(app)/leads/[id]/tarefas.tsx`
- Create: `src/app/(app)/leads/[id]/tarefas.test.tsx`
- Modify: `src/app/(app)/leads/[id]/page.tsx`
- Modify: `src/app/(app)/leads/[id]/timeline.tsx`

**Interfaces:**
- Consumes: `TarefaStore`, `Tarefa`, `TipoTarefa`, `criarTarefaStoreDoServidor` (Task 4); `classificar`, `FUSO_PADRAO` (Task 3); `chamarAcao` de `@/lib/ui/acao`
- Produces — Server Actions consumidas por esta task e pela Task 6:

```ts
export async function criarTarefa(d: {
  leadId: string
  titulo: string
  tipo: TipoTarefa
  venceEmISO: string
}): Promise<Resultado<void>>
export async function concluirTarefa(id: string, leadId: string): Promise<Resultado<void>>
export async function reabrirTarefa(id: string, leadId: string): Promise<Resultado<void>>
export async function excluirTarefa(id: string, leadId: string): Promise<Resultado<void>>
```

**Por que as ações vivem em `tarefas/acoes.ts` e não em `leads/[id]/acoes.ts`:** a Task 6 chama `concluirTarefa` de `/tarefas` também. Um lugar só, e `revalidatePath` nos dois caminhos (`/leads/${leadId}` e `/tarefas`).

**Por que o mapa de erro é `tarefas/erros.ts`:** `src/lib/ui/acao.ts:10` registra que este app já traduz erro em quatro convenções diferentes. Não crie a quinta partindo o mapa de tarefas entre a ficha e a tela — um arquivo, importado pelos dois. Chaves mínimas: `titulo_vazio`, `prazo_invalido`, `tarefa_nao_encontrada`, `lead_nao_encontrado`, `sem_sessao`, mais `FALHA_DE_CONEXAO` com `MENSAGEM_FALHA_DE_CONEXAO`.

**A conclusão escreve na timeline.** `lead_events.tipo` é `text`, então não há enum a alterar. Tipo novo: `tarefa_concluida`, com `{ titulo, tipo }` no payload. **O payload guarda o título como snapshot**, do mesmo jeito que `etiqueta_aplicada` guarda `tag`: a tarefa pode ser excluída depois, e a história do lead não pode ficar apontando para o vazio.

**Concluir é reversível, e cada conclusão escreve um evento; reabrir não escreve nada.** Consequência aceita e deliberada: concluir → reabrir → concluir deixa dois eventos. É história verdadeira, e `lead_events` é append-only por desenho. **Criar tarefa não escreve evento** — a tarefa já é visível no painel, e duplicar isso na timeline só faz ruído.

- [ ] **Step 1: Escrever o teste de componente**

Crie `src/app/(app)/leads/[id]/tarefas.test.tsx`, com `// @vitest-environment jsdom` na primeira linha. O componente recebe as tarefas por prop e as ações por prop ou import — monte-o de modo que o teste não precise de servidor.

**Registre `afterEach(cleanup)` explicitamente**, copiando o padrão de `timeline.test.tsx` (Task 1). O `cleanup` automático do `@testing-library/react` só se registra quando `globals: true` está ligado, e este `vitest.config.ts` deliberadamente não liga. Sem o registro manual, o `document` do jsdom persiste entre os `it()` do mesmo arquivo, e a partir do segundo `render()` as consultas passam a achar nó velho ou a estourar "multiple elements found". Este arquivo tem vários `render()` — sem isso, ele falha de forma intermitente.

Casos obrigatórios:

1. **Tarefa vencida ontem aparece marcada como atrasada** e tarefa de semana que vem não. Afirme sobre o texto ou o rótulo acessível, não sobre classe de CSS — classe é forma, e o teste tem que sobreviver a uma troca de estilo.
2. **Abertas vêm antes das concluídas**, e a concluída aparece na seção de concluídas. Afirme por posição.
3. **Lista vazia mostra o estado vazio**, não uma lista vazia sem explicação.

- [ ] **Step 2: Vermelho**

```bash
npm test -- tarefas
```

Esperado: FAIL — o componente não existe.

- [ ] **Step 3: Implementar as Server Actions**

`src/app/(app)/tarefas/acoes.ts`, com `'use server'` no topo. Cada uma: resolve `criarTarefaStoreDoServidor()`, valida, chama o port, e `revalidatePath` de `/leads/${leadId}` **e** de `/tarefas`.

Validações que devolvem código conhecido, nunca mensagem crua:
- título vazio depois de `trim` → `falha('titulo_vazio')`
- `venceEmISO` que produz `Invalid Date` → `falha('prazo_invalido')`. **Valide antes de construir o `Date` que vai para o banco.** O Plano 6 deixou um `?dias=999999999` estourar `RangeError` para fora de um server component; a lição é que entrada de usuário vira data inválida com facilidade e o lugar de barrar é na borda.

`concluirTarefa` também insere o `lead_events` de `tarefa_concluida`. Se a conclusão falhar, **não** insira o evento.

- [ ] **Step 4: Implementar o componente e ligar na página**

`src/app/(app)/leads/[id]/tarefas.tsx` — componente cliente com o formulário de criação (título, tipo, prazo) e a lista. Toda chamada de ação passa por `chamarAcao`, e o erro vai para o mapa de `tarefas/erros.ts`.

Em `page.tsx`: adicione `criarTarefaStoreDoServidor()` e `doLead(id)` ao `Promise.all` existente, seguindo o tratamento de erro que as outras chamadas já usam. Renderize o painel na coluna da esquerda, abaixo de `AcoesLead`.

Em `timeline.tsx`: acrescente o `case 'tarefa_concluida'` ao `switch` de `rotuloEvento`, lendo `titulo` do payload.

- [ ] **Step 5: Verde**

```bash
npm test -- tarefas && npm test -- timeline
```

O caso 2 de `timeline.test.tsx` (Task 1) afirmava que `'tarefa_concluida'` caía no `default`. Agora ele tem `case` próprio, então **esse teste vai ficar vermelho** — e isso é correto, não um acidente. Troque o tipo desconhecido daquele caso por outro que continue não existindo (por exemplo `'tipo_que_nao_existe'`), preservando a intenção original: provar que o `default` protege a timeline de tipos futuros.

- [ ] **Step 6: Verificar no navegador**

```bash
npm run dev
```

Crie uma tarefa numa ficha de lead, conclua, e confira que a timeline passou a mostrar a linha nova. **Este passo não é opcional.** Duas vezes neste projeto o olho achou o que nenhuma suíte achou — a fonte em serif com tudo verde, e o drag sem feedback nenhum.

- [ ] **Step 7: Portão e commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

```bash
git add "src/app/(app)/tarefas" "src/app/(app)/leads/[id]/tarefas.tsx" "src/app/(app)/leads/[id]/tarefas.test.tsx" "src/app/(app)/leads/[id]/page.tsx" "src/app/(app)/leads/[id]/timeline.tsx"
git commit -m "feat: painel de tarefas na ficha do lead, com a conclusao na timeline"
```

---

## Task 6: Tela `/tarefas` e o badge

**Files:**
- Create: `src/app/(app)/tarefas/page.tsx`
- Create: `src/app/(app)/tarefas/lista.tsx`
- Create: `src/app/(app)/tarefas/lista.test.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `minhasAbertas` (Task 4), `classificar`, `contarUrgentes`, `FUSO_PADRAO` (Task 3), as ações de `tarefas/acoes.ts` (Task 5)
- Produces: nada consumido por outra task deste plano.

**O badge não é método novo do port.** A navegação chama `minhasAbertas` e conta com `contarUrgentes`. Uma fonte de verdade só. Custo aceito e declarado: a navegação busca as tarefas abertas para contá-las, e é uma consulta a mais por render — o sino já custou duas.

**O layout degrada, não derruba.** `layout.tsx` envolve **toda** página do app; uma falha na busca de tarefas não pode impedir quem só queria ver o funil. Siga exatamente o tratamento que o bloco do sino já usa em `layout.tsx:19-35`: em caso de falha, badge zero e segue.

**Quem escolhe o responsável:** vendedor sempre vê o próprio (`auth.uid()`). Gestor e admin ganham um select com os membros mais a opção "Sem responsável", que passa `null`. Ler o parâmetro da URL, como `/metricas` já faz com os filtros dela.

**Consequência declarada, e não é bug:** tarefa em lead **sem responsável** não aparece em "Minhas tarefas" de ninguém — só pelo filtro "Sem responsável", que só gestor e admin têm. É aceito: lead sem dono é um problema anterior ao da tarefa.

- [ ] **Step 1: Escrever o teste de componente**

Crie `src/app/(app)/tarefas/lista.test.tsx`, com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` registrado explicitamente — pelo mesmo motivo da Task 5, e aqui também há vários `render()` no arquivo.

`lista.tsx` recebe as tarefas e o `agora` por prop — nunca chame `new Date()` dentro do componente, ou o teste vira refém do relógio.

Casos obrigatórios:

1. **As quatro seções aparecem na ordem Atrasadas → Hoje → Próximos 7 dias → Depois**, e cada tarefa cai na sua. Afirme por posição.
2. **Seção sem tarefa não é renderizada** — quatro cabeçalhos vazios é pior que nenhum.
3. **Lista inteiramente vazia mostra o estado vazio.**
4. **Cada linha leva ao lead**, com um link para `/leads/<id>`.

- [ ] **Step 2: Vermelho**

```bash
npm test -- lista
```

- [ ] **Step 3: Implementar a tela**

`lista.tsx` (cliente, recebe `tarefas` e `agora`) e `page.tsx` (server component: resolve o store, lê o filtro da URL, chama `minhasAbertas`, passa `new Date()` como `agora`).

- [ ] **Step 4: Ligar o badge e a navegação**

Em `layout.tsx`: **uma** entrada nova no cabeçalho, **Tarefas**, ao lado de "Métricas", visível aos três papéis. A entrada de Scripts é do Plano 8 — não a adiante aqui.

O badge é a contagem de `contarUrgentes`, escondido quando zero, dentro do mesmo bloco tolerante a falha descrito acima.

`contarUrgentes` recebe `Date[]`, não `Tarefa[]`: mapeie `tarefas.map((t) => t.venceEm)` na chamada. A função é do domínio puro e não conhece o tipo do port.

- [ ] **Step 5: Verde**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Experimento de discriminação no badge**

Troque `contarUrgentes` por `tarefas.length` no layout. Rode a tela com uma tarefa em cada balde e confira no navegador que o badge passa de 2 para 4. Isso prova que o badge conta o que diz contar. Reverta.

- [ ] **Step 7: Verificar no navegador**

```bash
npm run dev
```

Entre como vendedor, crie tarefas com prazos nos quatro baldes, e confira as quatro seções, o badge, e que concluir remove a linha e desce o badge. Depois entre como admin e confirme que o padrão mostra **as dele**, não as de todo mundo.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/tarefas" "src/app/(app)/layout.tsx"
git commit -m "feat: tela /tarefas com os quatro baldes e badge na navegacao"
```

---

## Task 7: E2E ponta a ponta

**Files:**
- Create: `tests/e2e/tarefas.spec.ts`

**Interfaces:**
- Consumes: helpers de `tests/e2e/apoio.ts`; o fluxo completo das Tasks 2 a 6

**Lembretes do ambiente:** derrube qualquer `npm run dev` aberto antes de rodar. A suíte roda com `workers: 1` de propósito — os specs compartilham um `next dev` e um Postgres, e a disputa derrubava testes por timeout.

- [ ] **Step 1: Escrever o spec**

Um percurso, na forma de `tests/e2e/metricas.spec.ts`:

1. Entrar como vendedor e abrir um lead dele.
2. Criar "Ligar para negociar" com prazo para amanhã.
3. Ir para `/tarefas` e ver a tarefa sob **Próximos 7 dias**, com o nome do lead.
4. Criar, pelo mesmo caminho, uma tarefa com prazo de ontem, e vê-la sob **Atrasadas** com o badge contando.
5. Concluir a atrasada: ela some da lista e o badge desce.
6. Voltar ao lead e ver "Tarefa concluída" na timeline.

**Cuidado com asserção negativa.** "A tarefa sumiu da lista" é negativa, e `toHaveCount(0)` no Playwright resolve no instante em que observa o estado passando — ele **não** afirma que o estado permaneceu, e pode correr na frente do próprio bug que existe para pegar. A regra deste repo: uma asserção negativa só é segura quando uma asserção positiva que **só vale no estado pós-mudança** já passou sobre a mesma subárvore. Aqui, afirme primeiro que o badge exibe o número novo, e só então que a linha sumiu.

- [ ] **Step 2: Rodar**

```bash
npm run test:e2e -- tarefas
```

- [ ] **Step 3: Experimento de discriminação**

Quebre `minhasAbertas` para ignorar `concluida_em`. Rode. **O passo 5 tem que ficar vermelho.** Reverta.

Ler o código e concluir que um teste discrimina não substitui rodar: duas asserções de portão deste repo foram descobertas não-discriminantes *depois* de duas leituras independentes concluírem que discriminavam.

- [ ] **Step 4: Portão final da branch**

```bash
npm run db:reset
npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build
```

Tudo verde, rodado **depois** do reset — não só antes.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/tarefas.spec.ts
git commit -m "test: E2E do ciclo de tarefa, da ficha ao badge"
```

---

## Critério de aceite do plano

Um vendedor abre um lead, agenda "Ligar para negociar" para amanhã às 14h, e a tarefa aparece em `/tarefas` sob "Próximos 7 dias" com o nome do lead. Uma tarefa de ontem aparece sob "Atrasadas" e o badge da navegação a conta. Ele conclui: some da lista, o badge desce, e a timeline do lead passa a contar "Tarefa concluída". Um segundo vendedor da mesma conta **não vê nenhuma dessas tarefas** em `/tarefas`. O admin vê as dele por padrão, e chega às dos outros pelo filtro. E `npm test` coleta pelo menos um `.test.tsx`.

Suíte verde no resultado do merge, depois de `npx supabase db reset`. Todo teste novo com RED demonstrado antes do verde.

## Review

Review de contexto fresco **por task**, e review de branch inteira antes do merge. Os três defeitos mais graves do Plano 6 só eram visíveis juntando tasks diferentes — nenhum portão de task olhava para duas ao mesmo tempo.

Para o revisor de branch inteira, três perguntas que exigem ver mais de uma task junta:

1. `minhasAbertas` filtra por responsável **e** a tela usa esse filtro em todos os caminhos, inclusive o do badge no layout? Um dos dois sem o outro é o defeito.
2. O evento `tarefa_concluida` guarda o título como snapshot, de modo que excluir a tarefa depois não deixa a timeline apontando para o vazio?
3. `classificar` é chamada com `agora` vindo do servidor em todos os sítios, ou algum componente cliente chama `new Date()` por conta própria e diverge do badge?
