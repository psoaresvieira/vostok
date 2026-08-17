# Plano 14 — Múltiplas pipelines no funil

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barra lateral de pipelines na aba Funil — qualquer membro cria, renomeia e exclui pipelines, cada uma com suas etapas; a pipeline ativa vive na URL.

**Architecture:** Pipeline ativa em `/funil?pipeline=<id>` (sem parâmetro = padrão), barra lateral server-side com links, criação via modal (etapas abertas escolhidas + Ganho/Perdido automáticos). RLS de escrita de `pipelines`/`stages` abre para membro; as regras de exclusão (padrão e com-leads) moram na policy de delete com helper `security definer`. Ficha do lead passa a carregar as etapas da pipeline do próprio lead.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase/Postgres com RLS, Vitest + Testing Library, Playwright, vitest.integration contra Postgres local.

**Spec:** `docs/superpowers/specs/2026-08-16-crm-multiplas-pipelines-design.md` — ler antes de começar qualquer task.

## Global Constraints

- **Forma assimétrica deste plano:** SQL de migration é LITERAL (copiar como está). Todo TypeScript é dado por assinatura + invariantes + casos de teste nomeados; o corpo é seu, sob TDD estrito (RED demonstrado antes de GREEN). Onde um caso de teste é nomeado, o texto diz o que ele afirma e o que tem que quebrar para ficar vermelho.
- Nunca declarar contagem de testes; o portão é "suíte verde e todo teste novo com RED demonstrado".
- Todo o trabalho na branch `plano-14-pipelines`. **Nenhum merge para master** — Pedro revisa o preview primeiro.
- Códigos de erro em snake_case pt; mensagens em pt-BR num dicionário local (nunca erro cru na tela) — padrão de `src/app/(app)/funil/erros.ts`.
- `pipelinePadrao()` NÃO muda de assinatura nem de comportamento; métricas, disparo, config, scripts e ingestão continuam usando.
- Fora de escopo (não implementar nada disso): mover lead entre pipelines, métricas por pipeline, pipeline por fonte, edição de etapas de pipelines não-padrão na engrenagem.
- Comandos de verificação: `npm test` (unidade), `npm run test:integration` (exige Supabase local; `npm run db:reset` aplica migrations), `npm run test:e2e`, `npm run typecheck`, `npm run lint`.

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout -b plano-14-pipelines` (a partir de `master` limpa).
- [ ] **Step 2:** Confirmar `git status` limpo e `npm test` verde antes de qualquer mudança.

---

### Task 1: Migration 0025 — escrita de pipelines/stages por membro + guarda de delete

**Files:**
- Create: `supabase/migrations/0025_pipelines_por_membro.sql`
- Create: `tests/integration/0025_pipelines_por_membro.test.ts`
- Modify: `tests/integration/0024_sweep_grants_rpc.test.ts` (mapa de grants ganha `pipeline_tem_leads`)

**Interfaces:**
- Produces: policies `pipelines_membro_insert/update/delete`, `stages_membro_write`; função `public.pipeline_tem_leads(uuid) returns boolean`. O store (Task 3) depende de: membro consegue inserir pipeline+stages; delete de `is_default` ou de pipeline com leads afeta **0 linhas** (sem erro).

- [ ] **Step 1: RED — teste de integração primeiro.** Escrever `0025_pipelines_por_membro.test.ts` com os helpers de `tests/integration/helpers` (`montarCenario`, `comoUsuario`, `comoServico`, `criarLead`, `etapa`). Casos nomeados (todos vermelhos contra a RLS atual, que é admin-only — os de permissão falham com 42501 ou 0 linhas):
  1. **vendedor cria pipeline na própria conta** — insert em `pipelines` por `vendedorAId` retorna id. Vermelho hoje porque a policy exige admin.
  2. **vendedor cria stages nessa pipeline** — inserts em `stages` (abertas 1..N, ganho N+1, perdido N+2) passam. Vermelho hoje pela policy de stages.
  3. **membro não cria pipeline em conta alheia** — montar segunda conta (`criar_conta` por outro usuário); insert de `vendedorAId` com `account_id` da conta B falha (with check). Este caso protege o afrouxamento: tem que continuar vermelho-de-recusa depois da migration.
  4. **membro não escreve stage em pipeline de conta alheia** — idem via `conta_do_pipeline`.
  5. **delete da pipeline padrão afeta 0 linhas** — `delete ... where id = pipelineId` (a padrão do cenário) por admin retorna rowCount 0 e a pipeline continua lá.
  6. **delete de pipeline com leads afeta 0 linhas MESMO quando o chamador não enxerga os leads** — o caso que discrimina o `security definer` do helper: pipeline nova criada pelo vendedor A, lead nela pertencendo ao vendedor B (via `comoServico`), delete por vendedor A → 0 linhas. Se `pipeline_tem_leads` fosse invoker, a RLS de leads esconderia o lead do colega e o delete passaria — este teste é o que fica vermelho nessa regressão.
  7. **delete de pipeline vazia e não-padrão passa** — vendedor A cria e exclui; stages somem junto (cascade).
  8. **renomear por membro da própria conta passa; de conta alheia afeta 0 linhas.**
- [ ] **Step 2: Rodar e ver RED.** `npm run test:integration -- 0025` — casos 1, 2, 7, 8 vermelhos por permissão; 3–6 podem já passar pela recusa atual (registrar quais).
- [ ] **Step 3: Escrever a migration — SQL literal:**

```sql
-- Plano 14: qualquer membro cria, renomeia e exclui pipelines (decisao de
-- produto, 2026-08-16). As regras de exclusao moram AQUI, nao so no store:
-- com a escrita aberta a membros, PostgREST direto alcanca o delete, e
-- leads.pipeline_id NAO cascateia (a FK em 0003_leads.sql nao tem on delete,
-- entao o default e' NO ACTION) — sem a policy, apagar uma pipeline com leads
-- estouraria 23503 (violacao de FK) crua atraves do PostgREST em vez de uma
-- recusa limpa. A policy e' o lugar certo pra essa recusa.

-- Guarda 5 (memoria supabase-guardas-silenciosas): subquery de leads dentro
-- da policy rodaria sob a RLS do CHAMADOR, e a RLS de leads esconde leads de
-- colegas do vendedor — ele conseguiria excluir pipeline com leads dos
-- outros. O helper e' definer para enxergar todos os leads da pipeline.
create or replace function public.pipeline_tem_leads(p_pipeline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.leads l where l.pipeline_id = p_pipeline_id);
$$;

-- Guarda 7: default ACL da EXECUTE a PUBLIC em funcao nova. Revoke + grant
-- explicito, e o mapa em 0024_sweep_grants_rpc.test.ts ganha a entrada.
revoke execute on function public.pipeline_tem_leads(uuid) from public;
grant execute on function public.pipeline_tem_leads(uuid) to authenticated;

drop policy pipelines_admin_write on public.pipelines;

create policy pipelines_membro_insert on public.pipelines
  for insert with check (public.is_member_of(account_id));

create policy pipelines_membro_update on public.pipelines
  for update using (public.is_member_of(account_id))
  with check (public.is_member_of(account_id));

create policy pipelines_membro_delete on public.pipelines
  for delete using (
    public.is_member_of(account_id)
    and not is_default
    and not public.pipeline_tem_leads(id)
  );

drop policy stages_admin_write on public.stages;

create policy stages_membro_write on public.stages
  for all using (public.is_member_of(public.conta_do_pipeline(pipeline_id)))
  with check (public.is_member_of(public.conta_do_pipeline(pipeline_id)));
```

- [ ] **Step 4:** Atualizar o mapa de grants em `tests/integration/0024_sweep_grants_rpc.test.ts`: entrada `pipeline_tem_leads` com grant exatamente `['authenticated']`. Sem isso a catraca da 0024 fica vermelha — é o comportamento desenhado, não um flake.
- [ ] **Step 5:** `npm run db:reset` e `npm run test:integration` inteiro. Esperado: 0025 verde, 0024 verde com o mapa novo, nenhuma outra regressão (0002 e 0018 testam as policies antigas — se algum caso deles afirmar "vendedor não escreve stage", ele agora está afirmando comportamento revogado: atualizar o caso citando esta migration no comentário).
- [ ] **Step 6:** Checklist de guardas silenciosas, dizendo em voz alta: (2) o helper definer não grava nada, só lê — nada a reafirmar; (5) definer aqui é deliberado e o caso 6 é o teste de discriminação; (7) coberto no Step 4; (3) função nova, sem sobrecarga anterior. Registrar no comentário da migration se algo mudar.
- [ ] **Step 7: Commit** — `feat: escrita de pipelines por membro com guarda de delete na policy`.

---

### Task 2: Contrato do store — interface + InMemory

**Files:**
- Modify: `src/lib/data/store.ts`
- Modify: `src/lib/data/memory.ts`
- Test: `src/lib/data/memory.test.ts` (acrescentar bloco de pipelines)

**Interfaces:**
- Produces (normativo — Tasks 3–7 dependem destes nomes e tipos exatos):

```ts
// store.ts — FiltroLeads ganha:
pipelineId?: string | null

// store.ts — CrmStore ganha:
listarPipelines(): Promise<Resultado<Pipeline[]>>
pipelinePorId(pipelineId: string): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
criarPipeline(nome: string, etapasAbertas: string[]): Promise<Resultado<string>>
renomearPipeline(pipelineId: string, nome: string): Promise<Resultado<void>>
excluirPipeline(pipelineId: string): Promise<Resultado<void>>
```

**Invariantes (valem para TODA implementação, memory e supabase):**
- `listarPipelines`: padrão primeiro, demais por data de criação ascendente.
- `pipelinePorId`: mesma forma de retorno de `pipelinePadrao()`; pipeline inexistente ou de outra conta → `falha('pipeline_nao_encontrado')` (código já existente no backend — reusar, não criar variante).
- `criarPipeline`: etapas abertas com `ordem` 1..N na ordem recebida; acrescenta `Ganho` (tipo `ganho`, ordem N+1) e `Perdido` (tipo `perdido`, ordem N+2); devolve o id novo. Não valida nome/lista — validação é da action (Task 4); o store confia no chamador.
- `excluirPipeline`: `falha('pipeline_padrao_nao_exclui')` para a padrão; `falha('pipeline_com_leads')` se houver lead com o `pipelineId`; sucesso remove pipeline e etapas.
- `listarLeads` com `pipelineId` devolve só leads daquela pipeline; sem o campo, comportamento atual intacto.

- [ ] **Step 1: RED.** No `memory.test.ts`, casos nomeados (vermelhos porque os métodos não existem):
  1. **criar monta Ganho/Perdido ao final** — `criarPipeline('Outbound', ['Prospecção', 'Contato'])` seguido de `pipelinePorId` devolve 4 etapas na ordem Prospecção(1,aberta), Contato(2,aberta), Ganho(3,ganho), Perdido(4,perdido).
  2. **listar põe a padrão primeiro** — depois de criar duas pipelines, `listarPipelines()[0].isDefault === true` e as demais na ordem de criação.
  3. **excluir recusa a padrão** — código `pipeline_padrao_nao_exclui`.
  4. **excluir recusa pipeline com lead** — criar lead na pipeline nova; código `pipeline_com_leads`.
  5. **excluir pipeline vazia some da lista** e `pipelinePorId` dela vira `pipeline_nao_encontrado`.
  6. **listarLeads filtra por pipelineId** — dois leads em pipelines diferentes; filtro devolve só o da pedida.
  7. **renomear reflete em listarPipelines.**
- [ ] **Step 2: ver RED** — `npx vitest run src/lib/data/memory.test.ts`.
- [ ] **Step 3: GREEN.** No `InMemoryCrmStore`, os campos `pipeline: Pipeline | null` e `etapas: Etapa[]` viram coleções multi-pipeline (as etapas já carregam `pipelineId`). `semear` mantém o comportamento atual (uma padrão com as 7 etapas). `pipelinePadrao()` devolve a `isDefault` com as etapas dela — nenhum teste existente pode mudar de resultado.
- [ ] **Step 4:** `npm test` inteiro — o refactor interno do memory não pode quebrar nada.
- [ ] **Step 5: Commit** — `feat: contrato de multiplas pipelines no CrmStore + InMemory`.

---

### Task 3: SupabaseCrmStore

**Files:**
- Modify: `src/lib/data/supabase.ts`
- Test: `tests/integration/pipelines-store.test.ts` (novo, no padrão de `supabase-store.test.ts`)

**Interfaces:**
- Consumes: assinaturas e invariantes da Task 2; policies da Task 1.
- Produces: `SupabaseCrmStore` completo para as Tasks 4 e 7.

**Invariantes específicos daqui:**
- Toda query de `pipelines` recorta por `account_id = this.accountId` (o `eq` explícito além da RLS, como o resto do arquivo faz).
- `criarPipeline` insere a pipeline, depois as stages num único insert de array; se o insert de stages falhar, apagar a pipeline recém-criada antes de devolver a falha (compensação segura: a pipeline foi criada por ESTA chamada — guarda 4 satisfeita).
- `excluirPipeline` confere `is_default` e leads ANTES de deletar para devolver o código certo; o delete em si ainda pode afetar 0 linhas (corrida com outro membro) — 0 linhas depois das checagens devolve `falha('pipeline_nao_encontrado')`, nunca sucesso silencioso.
- `listarLeads`: `if (filtro.pipelineId) q = q.eq('pipeline_id', filtro.pipelineId)`.

- [ ] **Step 1: RED.** Integração com cenário real (`montarCenario` + `SupabaseCrmStore` como os testes de store existentes fazem). Casos nomeados:
  1. **criar e reler** — `criarPipeline` por vendedor; `pipelinePorId` devolve etapas na ordem com Ganho/Perdido no fim.
  2. **isolamento entre contas** — `pipelinePorId` com id de pipeline de outra conta → `pipeline_nao_encontrado` (fica vermelho se alguém trocar o recorte por confiança cega na RLS e a RLS mudar).
  3. **excluir padrão / com leads / vazia** — os três códigos da Task 2, agora contra o Postgres com as policies da Task 1 por baixo.
  4. **listarLeads com pipelineId** — leads em duas pipelines; o filtro separa.
  5. **compensação da criação** — forçar falha no insert de stages (ex.: nome de etapa aberta duplicando `ordem` via dado inválido construído no teste) e afirmar que a pipeline órfã NÃO ficou no banco.
- [ ] **Step 2: ver RED; GREEN; `npm run test:integration` inteiro.**
- [ ] **Step 3: Commit** — `feat: multiplas pipelines no SupabaseCrmStore`.

---

### Task 4: Server actions + erros

**Files:**
- Create: `src/app/(app)/funil/acoes-pipelines.ts` (`'use server'`)
- Modify: `src/app/(app)/funil/acoes.ts` (`criarLeadAction`)
- Modify: `src/app/(app)/funil/erros.ts`
- Test: `src/app/(app)/funil/acoes-pipelines.test.ts`, casos novos no teste que já cobre `criarLeadAction`

**Interfaces:**
- Consumes: `CrmStore` da Task 2 via `criarStoreDoServidor()`.
- Produces (normativo para Tasks 5–7):

```ts
// acoes-pipelines.ts
export async function criarPipelineAction(formData: FormData): Promise<Resultado<string>> // devolve id novo
export async function renomearPipelineAction(pipelineId: string, nome: string): Promise<Resultado<void>>
export async function excluirPipelineAction(pipelineId: string): Promise<Resultado<void>>

// erros.ts
export function mensagemDePipeline(codigo: string): string
```

**Invariantes:**
- `criarPipelineAction` lê do FormData: `nome` e `etapas` (JSON array de strings, campo único — mesma técnica de campo composto que o form de lead usa para valores não triviais). Trim em tudo; etapas vazias descartadas; depois: nome vazio → `falha('nome_obrigatorio')`; zero etapas → `falha('etapas_minimo_uma')`. Sucesso: `revalidatePath('/funil')` e devolve o id.
- `renomearPipelineAction`: nome vazio → `nome_obrigatorio`; sucesso revalida `/funil`.
- `excluirPipelineAction`: repassa o código do store; sucesso revalida `/funil`.
- `criarLeadAction` ganha o campo `pipelineId` no FormData: quando presente, resolve `pipelinePorId(pipelineId)` e usa a primeira etapa `aberta` DELA; quando ausente, comportamento atual (padrão). Pipeline inexistente → `falha('pipeline_nao_encontrado')`, sem fallback silencioso.
- `mensagemDePipeline`: dicionário local com `pipeline_nao_encontrado`, `pipeline_padrao_nao_exclui`, `pipeline_com_leads`, `nome_obrigatorio`, `etapas_minimo_uma`, `FALHA_DE_CONEXAO` → frases pt-BR curtas ditas do ponto de vista do usuário (ex.: `pipeline_com_leads` → 'Essa pipeline ainda tem leads. Mova ou exclua os leads antes.'). Fallback: devolve o código (mesmo contrato de `mensagemDeErro`).

- [ ] **Step 1: RED das actions.** Casos nomeados (mock do store no padrão dos testes de action existentes):
  1. **criação feliz** — nome + 3 etapas chegam ao store na ordem digitada; devolve o id.
  2. **etapas em branco somem antes do store** — `['', '  ', 'Contato']` vira `['Contato']`.
  3. **zero etapas úteis** → `etapas_minimo_uma` e o store NÃO é chamado (fica vermelho se a validação escorregar para depois da chamada).
  4. **nome vazio** → `nome_obrigatorio`, store não chamado.
  5. **criarLeadAction com pipelineId** — lead nasce na primeira aberta da pipeline pedida, não da padrão (montar memory store com duas pipelines; fica vermelho enquanto a action ignora o campo).
  6. **criarLeadAction com pipeline inexistente** → `pipeline_nao_encontrado`.
  7. **criarLeadAction sem o campo** — caminho atual intacto (guarda de regressão da ingestão de forms antigos).
- [ ] **Step 2: ver RED; GREEN; `npm test`.**
- [ ] **Step 3: Commit** — `feat: actions de pipelines e lead nascendo na pipeline ativa`.

---

### Task 5: Barra lateral

**Files:**
- Create: `src/app/(app)/funil/barra-pipelines.tsx` (client component — o kebab e os modais de renomear/excluir precisam de estado)
- Test: `src/app/(app)/funil/barra-pipelines.test.tsx`

**Interfaces:**
- Consumes: `renomearPipelineAction`, `excluirPipelineAction`, `mensagemDePipeline` (Task 4).
- Produces (Task 7 monta com estas props):

```tsx
export function BarraPipelines({ pipelines, pipelineAtivaId, queryAtual }: {
  pipelines: Pipeline[]        // já na ordem do listarPipelines
  pipelineAtivaId: string
  queryAtual: string           // searchParams atuais serializados, para preservar filtros nos links
})
```

**Invariantes:**
- Lista como `<nav aria-label="Pipelines">`; cada item um link: a padrão para `/funil` (+ filtros atuais), as demais para `/funil?pipeline=<id>` (+ filtros). O link monta `URLSearchParams` a partir de `queryAtual`, setando/removendo só `pipeline`.
- A ativa marcada com `aria-current="page"` (é isso que o teste afirma, não classe CSS).
- Kebab por item com **Renomear** (modal com o nome atual preenchido) e **Excluir** (confirmação; erro da action vira frase de `mensagemDePipeline` inline). Após excluir a ativa, `router.push('/funil')`.
- A barra NÃO conhece o modal de criação: o botão «+ Nova pipeline» é o componente autocontido da Task 6, montado pela página (Task 7) logo abaixo da barra, dentro da mesma coluna. Assim as Tasks 5 e 6 não dependem uma da outra.
- Estilo: coluna `w-56` com `border-r`, tokens do restante do app (sem cores novas).

- [ ] **Step 1: RED.** Casos nomeados:
  1. **padrão primeiro e ativa com aria-current** — render com 3 pipelines, ativa não-padrão; afirma ordem dos links e o `aria-current` no certo.
  2. **links preservam filtros** — `queryAtual = 'origem=meta&pipeline=X'`; link da padrão é `/funil?origem=meta`, o da outra é `/funil?origem=meta&pipeline=<id>` (fica vermelho se o link montar a query do zero).
  3. **renomear chama a action com id e nome novos** (action mockada).
  4. **excluir com erro mostra a frase mapeada** — action devolve `pipeline_com_leads`; a frase pt-BR aparece, o código cru não.
- [ ] **Step 2: ver RED; GREEN; `npm test`.**
- [ ] **Step 3: Commit** — `feat: barra lateral de pipelines no funil`.

---

### Task 6: Modal de criação

**Files:**
- Create: `src/app/(app)/funil/nova-pipeline.tsx` (client)
- Test: `src/app/(app)/funil/nova-pipeline.test.tsx`

**Interfaces:**
- Consumes: `criarPipelineAction`, `mensagemDePipeline` (Task 4).
- Produces: `export function NovaPipeline()` — botão «+ Nova pipeline» + modal, autocontidos; a Task 7 renderiza `<NovaPipeline />` na coluna da barra, logo abaixo de `<BarraPipelines />`.

**Invariantes:**
- Form: campo nome; lista de etapas abertas começando com as 5 sugeridas ('Novo lead', 'Contato feito', 'Qualificação', 'Proposta', 'Fechamento'), cada linha com input de nome, remover, e mover ↑/↓; botão de adicionar etapa. Texto fixo: 'Ganho e Perdido serão adicionadas ao final automaticamente.'
- Remover é desabilitado quando resta 1 etapa (o mínimo mora também na action; aqui é affordance).
- Submit envia `nome` e `etapas` (JSON array na ordem visual) no formato que `criarPipelineAction` lê.
- Sucesso: fecha o modal e `router.push('/funil?pipeline=<id-devolvido>')`.
- Erro: frase de `mensagemDePipeline` inline no modal; o modal continua aberto com o que foi digitado.

- [ ] **Step 1: RED.** Casos nomeados:
  1. **ordem visual é a ordem enviada** — mover uma etapa para cima e submeter; a action recebe o array na nova ordem (vermelho enquanto ↑/↓ não reordena o estado).
  2. **remover some com a linha e o submit não a envia.**
  3. **última etapa não é removível** — com 1 linha, o botão remover está desabilitado.
  4. **sucesso navega para a pipeline nova** — action mockada devolve id; afirma `router.push` com `/funil?pipeline=<id>`.
  5. **trava de duplo clique** — na forma da memória `teste-duplo-clique-vacuo`: `click(); click()` dentro de UM `act` assíncrono único, afirmando UMA chamada à action. (Dois `fireEvent.click` separados não provam nada: o `disabled` do primeiro render segura o segundo.)
  6. **erro mantém o modal aberto com a frase mapeada.**
- [ ] **Step 2: ver RED; GREEN; `npm test`.**
- [ ] **Step 3: Commit** — `feat: modal de criacao de pipeline com etapas escolhidas`.

---

### Task 7: Fiação — página do funil, novo lead e ficha do lead

**Files:**
- Modify: `src/app/(app)/funil/page.tsx`
- Modify: `src/app/(app)/funil/novo-lead.tsx` (prop nova `pipelineId: string`, vira hidden input do form)
- Modify: `src/app/(app)/leads/[id]/page.tsx`
- Test: casos novos nos testes existentes de `novo-lead` e da ficha; page.tsx é coberto pelo E2E da Task 8

**Interfaces:**
- Consumes: `listarPipelines`, `pipelinePorId`, `FiltroLeads.pipelineId` (Tasks 2–3); `BarraPipelines` (Task 5); `NovaPipeline` (Task 6).

**Invariantes:**
- `page.tsx`: lê `params.pipeline`; com o parâmetro, `pipelinePorId(params.pipeline)` — se falhar com `pipeline_nao_encontrado`, cai na padrão SEM erro (parâmetro inválido é filtro inválido, não exceção); sem parâmetro, `pipelinePadrao()`. `listarLeads` recebe `pipelineId` da pipeline resolvida. Layout: coluna à esquerda com `<BarraPipelines />` e `<NovaPipeline />` logo abaixo (`flex`), quadro à direita — a linha de filtros continua acima do quadro.
- `novo-lead.tsx`: hidden input `pipelineId` com a pipeline ativa; nada mais muda no form.
- `leads/[id]/page.tsx`: trocar `store.pipelinePadrao()` por `store.pipelinePorId(lead.pipelineId)` (o lead já foi carregado antes; reordenar as chamadas se preciso). O link de voltar para o funil: `/funil` quando `pipeline.isDefault`, senão `/funil?pipeline=<id>`. Procurar TODOS os usos das etapas na ficha (mapa de nomes, seletor de mover etapa) — todos passam a vir da pipeline do lead.
- `moverEtapaAction`/modal de movimento não mudam: as etapas oferecidas já vêm da página, que agora entrega as certas.

- [ ] **Step 1: RED nos componentes.** Casos nomeados:
  1. **novo lead envia a pipeline ativa** — render com `pipelineId="abc"`; o FormData da action contém `pipelineId=abc` (vermelho enquanto o hidden não existe).
  2. **ficha usa as etapas da pipeline do lead** — no teste da ficha, lead com `pipelineId` de uma pipeline nova; o seletor de etapas mostra as etapas DELA e não as da padrão (montar o memory store com duas pipelines; fica vermelho contra o código atual, que chama `pipelinePadrao`).
  3. **link de voltar carrega a pipeline** — lead fora da padrão → link contém `?pipeline=`.
- [ ] **Step 2: ver RED; GREEN; `npm test` inteiro.**
- [ ] **Step 3:** `npm run typecheck` e `npm run lint`.
- [ ] **Step 4: Commit** — `feat: funil por pipeline na URL — barra, novo lead e ficha na pipeline certa`.

---

### Task 8: E2E

**Files:**
- Create: `tests/e2e/pipelines.spec.ts` (login e navegação no padrão de `tests/e2e/funil.spec.ts`)

- [ ] **Step 1: RED.** Fluxo único e encadeado (a suíte é serial de propósito — ver `playwright.config.ts`):
  1. **criar pipeline pela barra** — abrir `/funil`, «+ Nova pipeline», nome 'Outbound', remover três das sugeridas, criar; a URL ganha `?pipeline=` e o quadro mostra as colunas da nova (2 abertas + Ganho + Perdido) — afirma pelos headings das colunas.
  2. **lead nasce na pipeline ativa** — criar lead pelo botão da página; o card aparece na primeira coluna da Outbound.
  3. **a padrão não vê o lead** — clicar na padrão na barra; o card não está lá e as colunas voltam às 7.
  4. **ficha mostra as etapas da Outbound** — abrir o card; o seletor de mover etapa lista as etapas da Outbound; voltar pelo link retorna ao funil com `?pipeline=`.
  5. **excluir bloqueada com leads** — tentar excluir a Outbound pelo kebab; a frase de `pipeline_com_leads` aparece e a pipeline continua na barra.
- [ ] **Step 2:** ver RED (a barra não existe), depois GREEN conforme as tasks anteriores já entregaram tudo — este spec não deve exigir código novo de produto; se exigir, o defeito é de uma task anterior: consertar lá.
- [ ] **Step 3:** `npm run test:e2e` inteiro — o spec de funil arrasta cards; provar que o layout novo (barra à esquerda) não quebrou o drag nem a viewport calculada no config.
- [ ] **Step 4: Commit** — `test: E2E de multiplas pipelines no funil`.

---

### Task 9: Verificação final + preview para Pedro

- [ ] **Step 1:** Rodar tudo, na ordem: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`. Qualquer vermelho: consertar antes de seguir (superpowers:verification-before-completion).
- [ ] **Step 2:** `git log --oneline master..plano-14-pipelines` — conferir que cada task virou commit e nada ficou fora.
- [ ] **Step 3:** Subir a branch: `git push -u origin plano-14-pipelines`. **NÃO fazer merge.**
- [ ] **Step 4:** Avisar Pedro: demonstração local com `npm run dev` (criar pipeline, alternar, criar lead, excluir) e o link do preview deployment que o Vercel gera para a branch. O merge é decisão dele depois de ver.
