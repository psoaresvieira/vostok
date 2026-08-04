# Plano 10 — Scripts de Venda

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gestor escreve scripts de venda com variáveis (`{{empresa}}`) numa biblioteca da conta, amarrados (ou não) a uma etapa do funil; o vendedor abre a ficha de um lead e vê os scripts daquela etapa já interpolados com os dados do lead, com lacuna visível quando falta dado, botão Copiar e link de WhatsApp (`wa.me`) — sem Cloud API, sem template, sem App Review.

**Architecture:** Migration `0020` cria `scripts` — conhecimento da conta (leva `account_id`, como `tags`), leitura por `is_member_of`, escrita por admin/gestor, e o helper `stage_da_conta` fechando o buraco cross-tenant da FK de `stage_id`. A FK é `on delete set null`: o excluir-etapa do Plano 8 é fato novo que a spec não conhecia, e um script de etapa excluída vira "qualquer etapa" em vez de bloquear a exclusão. O motor de variáveis é função pura em `src/lib/domain/script.ts` — uma função (`interpolar`), dois consumidores (preview pintado e `textoPlano` para Copiar/`wa.me`), sem caminho para divergirem. Acima: port `ScriptStore` no padrão de `TarefaStore`, telas `/scripts`, `/scripts/novo`, `/scripts/[id]` com preview ao vivo, e o painel na ficha do lead. De carona, a migration `0021` paga o item 3 do backlog (revokes da guarda silenciosa nº 6).

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Supabase (Postgres/RLS) + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-02-crm-scripts-tarefas-design.md`, §§4–11 (a metade de Scripts; a de Tarefas já foi o Plano 7). As decisões de produto de lá continuam fechadas — não reabra nenhuma.

**O que mudou desde a spec (2026-08-02) — este plano prevalece sobre a spec nestes pontos:**

1. A spec chama Scripts de "Plano 8" e a migration de `0016`. Os dois números foram consumidos (Plano 8 = excluir etapa; `0016`–`0019` existem). Este é o **Plano 10**, migration **`0020`**.
2. A spec escreveu `stage_id uuid references public.stages(id)` sem cláusula de delete — quando etapa não podia ser excluída. O Plano 8 mudou isso: a FK agora é **`on delete set null`**, coerente com "nulo = qualquer etapa" e com o precedente das FKs de `stage_history`/`lead_tags`. Sem isso, `excluir_etapa` estouraria 23503 num script e o backstop do `AdminStore` traduziria para `etapa_tem_leads` — mensagem falsa.
3. O texto de `etapa_invalida` cobre "etapa excluída" — recomendação aceita do review final do Plano 8, que previu exatamente este plano tocando o mapa do funil.
4. `revoke truncate` na tabela nova — guarda silenciosa nº 6, achada no Plano 9, posterior à spec.

## Global Constraints

- **`npx supabase`, nunca `supabase`.** O binário não está no PATH desta máquina.
- **Nenhuma mensagem crua do PostgREST na tela.** Todo código novo entra no mapa de `scripts/erros.ts` (Task 4).
- **Toda Server Action chamada de componente cliente passa por `chamarAcao`** (`@/lib/ui/acao`).
- **Todo filtro PostgREST com texto do usuário passa pelo escape de `src/lib/data/filtro.ts`** (`padraoIlike`/`valorPostgrest`) — reintroduzir interpolação crua é reabrir o backlog #9, fechado no Plano 3.
- **Componente novo com teste: `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` registrado à mão** (o vitest deste repo não liga `globals: true`; sem o cleanup o `document` persiste entre `it()` e o arquivo falha intermitente a partir do segundo `render()`).
- **Domínio puro sem IO:** `src/lib/domain/script.ts` não importa nada de `data/`, `supabase/` ou `next/*`.
- **Nenhuma contagem de teste aparece neste plano.** O portão de cada task é "suíte verde e todo teste novo com RED demonstrado".
- **As seis guardas silenciosas valem nas duas migrations** (memória do assistente + spec §7): grant explícito senão a RLS nem é avaliada; nenhum `is distinct from` com dois lados possivelmente nulos; mudança de assinatura começa por `drop function` (nenhuma prevista aqui — `stage_da_conta` nasce agora); `definer`/`invoker` decidido dizendo em voz alta o que a função precisa da RLS; `revoke truncate` em tabela nova; e teste de discriminação para toda leitura recortada.

### Sobre a forma deste plano — leia antes de começar

Mesma forma assimétrica dos Planos 7–9, com a lição do 8 aplicada: **SQL literal dentro de plano também é código que nenhum engine rodou** — os casos de teste nomeados abaixo miram exatamente as fronteiras do SQL (RLS por papel, cross-tenant via `stage_da_conta`, `with check` no update, `set null` na exclusão de etapa, truncate), e nenhum vermelho pode ser pulado.

- **Literal, para copiar como está:** o DDL, as policies, o helper, os grants/revokes.
- **Assinatura + invariantes + casos de teste nomeados, para você escrever sob TDD:** todo o TypeScript.

Onde um caso de teste está nomeado, ele é obrigatório, e o texto diz o que ele afirma e o que tem que quebrar para ele ficar vermelho. Teste que passa de primeira sem vermelho demonstrado não conta: quebre de propósito, veja o vermelho, reverta.

**Branch:** crie `plano-10-scripts` a partir de `master` antes da Task 1. Merge só depois do review de branch inteira.

---

## Task 1: Migration `0020` — a tabela `scripts` e o helper `stage_da_conta`

**Files:**
- Create: `supabase/migrations/0020_scripts.sql`
- Create: `tests/integration/0020_scripts.test.ts`

**Interfaces:**
- Consumes: `public.is_member_of(uuid)` e `public.papel_na_conta(uuid)` (`0001`); `public.excluir_etapa(uuid)` (`0018`); helpers `montarCenario`/`etapa` (`tests/integration/helpers/cenario.ts`), `comoServico`/`comoUsuario` (`helpers/db.ts`), `clienteDoUsuario` (`helpers/cliente.ts`).
- Produces: a tabela `scripts` com as colunas exatas que a Task 3 seleciona (`id, account_id, titulo, conteudo, stage_id, tags, criado_por, criado_em, atualizado_em`) e o comportamento de RLS que ela mapeia para códigos.

- [ ] **Step 1: Escrever o teste de integração**

Crie `tests/integration/0020_scripts.test.ts` na forma de `0015_tarefas.test.ts` (cenário com dois papéis) e monte também uma **segunda conta** (padrão de `0008_fontes_conectadas.test.ts`). Casos obrigatórios:

1. **Fluxo feliz e biblioteca de todos.** Gestor da conta A insere script com `stage_id` de etapa da própria conta; o **vendedor** da mesma conta o enxerga por `select` (biblioteca é leitura de todo membro). Afirme as colunas gravadas, inclusive `tags`.
2. **Vendedor não escreve.** `insert` como vendedor → falha com `42501` (with check da policy). `update` e `delete` como vendedor sobre o script existente → **zero linhas afetadas** e, relido pelo serviço, o script está intacto. O update/delete não dá erro — a policy `using` esconde a linha; é por isso que a Task 3 traduz zero linhas para `script_nao_encontrado`.
3. **Isolamento entre contas, por discriminação.** A mesma consulta (`select count(*)`) por membro da conta A e por membro da conta B devolve números **diferentes** (A tem o script, B tem zero). Contar linhas só de um lado não prova nada — guarda nº 5.
4. **`stage_da_conta` nega etapa alheia — no insert E no update.** Admin da conta A: `insert` com `stage_id` de etapa da conta B → `42501`. Depois, sobre um script válido da conta A, `update` trocando `stage_id` para a etapa da conta B → `42501` e linha intacta. O caso do update fica vermelho se o `with check` de `scripts_update` esquecer a cláusula de `stage_da_conta` — o `with check` reavalia a linha inteira, e a spec §4.2 manda a regra valer nos dois.
5. **Etapa inexistente também morre no `with check` — `42501`, não FK.** `insert` como gestor com `stage_id` uuid aleatório → `42501`: o `with check` roda **antes** da validação de FK, e `stage_da_conta` devolve `false` para uuid que não resolve em lugar nenhum. A FK fica como integridade para caminhos que não passam pela RLS (escrita de serviço) e como portadora do `set null` — não como o erro que o cliente vê.
6. **Check de tags.** `insert` com 11 tags → `23514`.
7. **Excluir etapa não trava em script — vira "qualquer etapa".** Como serviço, crie uma etapa extra `tipo='aberta'` sem leads na conta A; crie script apontando para ela; como **admin** da conta A, chame `select public.excluir_etapa(...)` via `comoUsuario`. A RPC **sucede**, e o script relido tem `stage_id is null`. Este caso fica vermelho se a FK for `no action` (o delete estoura 23503) — é a deriva nº 2 do topo do plano virando asserção.
8. **TRUNCATE revogado.** Como usuário autenticado, `truncate public.scripts` → **permission denied** (guarda nº 6; sem o revoke da migration este caso fica vermelho, porque o default ACL `Dxtm` desta imagem o concederia).
9. **`prosecdef` de `stage_da_conta` é `true`.** `select prosecdef from pg_proc where proname = 'stage_da_conta'` → uma linha, `true`. `definer` aqui é desenho declarado (ver comentário da migration): a função lê `stages`/`pipelines` de passagem dentro de policy, e a família de helpers de policy deste repo (`is_member_of`, `conta_do_pipeline`, `pode_ver_lead`) é toda `definer` para o veredito não depender da RLS das tabelas que atravessa.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm run test:integration -- 0020
```

Esperado: FAIL — `relation "public.scripts" does not exist`.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0020_scripts.sql`:

```sql
-- Scripts de venda. Spec: docs/superpowers/specs/2026-08-02-crm-scripts-tarefas-design.md §4.
--
-- Script NAO e filho de lead: e conhecimento da conta, como tags. Leva
-- account_id e is_member_of na leitura — todo membro consome a biblioteca;
-- escrita e de admin/gestor (uma linha para mudar, se a decisao mudar).
--
-- tags e array, nao tabela de juncao, de proposito: etiqueta de lead precisa
-- de identidade (congela stage_id_no_momento, alimenta /metricas); tag de
-- script so precisa ser buscada. Juncao aqui importaria a classe de bug do
-- ILIKE em subconsulta sem comprar nada.

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  titulo text not null check (btrim(titulo) <> ''),
  conteudo text not null,
  -- Nulo = serve em qualquer etapa. ON DELETE SET NULL e deliberado e veio
  -- DEPOIS da spec: o Plano 8 tornou etapa excluivel de verdade, e um script
  -- de etapa excluida deve virar "qualquer etapa" — nao travar excluir_etapa
  -- com 23503 que o AdminStore traduziria para etapa_tem_leads (mentira).
  -- Mesmo destino das FKs de stage_history/lead_tags na 0016.
  stage_id uuid references public.stages(id) on delete set null,
  tags text[] not null default '{}'
    check (coalesce(array_length(tags, 1), 0) <= 10),
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index scripts_account_stage_idx on public.scripts (account_id, stage_id);
create index scripts_tags_idx on public.scripts using gin (tags);

-- A FK de stage_id aceita etapa de QUALQUER conta (a conta esta a dois saltos:
-- stages -> pipelines -> account) — mesma classe que o Plano 3 fechou para
-- responsavel_id. Este helper e a checagem que as policies de escrita exigem.
--
-- SECURITY DEFINER dito em voz alta: a funcao le stages e pipelines DE
-- PASSAGEM, dentro de policy de outra tabela, e o veredito dela nao pode
-- depender do que a RLS dessas tabelas mostra a quem chama — e a mesma razao
-- que fez is_member_of, conta_do_pipeline e pode_ver_lead nascerem definer.
-- Nao e a guarda no 5 (leitura recortada por papel): devolve boolean sobre um
-- par de ids, nao linhas de dados.
create or replace function public.stage_da_conta(p_stage_id uuid, p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.stages s
      join public.pipelines p on p.id = s.pipeline_id
     where s.id = p_stage_id
       and p.account_id = p_account_id
  );
$$;

grant execute on function public.stage_da_conta(uuid, uuid) to authenticated;

-- Grant explicito: o default ACL desta imagem da a anon/authenticated so Dxtm
-- — sem o grant a RLS nem e avaliada. E o revoke de TRUNCATE e a guarda no 6:
-- o D do default ACL e TRUNCATE, que a RLS NAO restringe.
grant select, insert, update, delete on public.scripts to authenticated;
revoke truncate on public.scripts from anon, authenticated;

alter table public.scripts enable row level security;

create policy scripts_select on public.scripts
  for select using (public.is_member_of(account_id));

create policy scripts_insert on public.scripts
  for insert with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and (stage_id is null or public.stage_da_conta(stage_id, account_id))
  );

-- O WITH CHECK repete a clausula de stage_da_conta DE PROPOSITO: ele reavalia
-- a linha inteira, inclusive colunas que o update nao tocou — e um update que
-- trocasse so o titulo de um script com stage_id alheio (impossivel hoje, a
-- tabela nasce com a regra) tem que continuar impossivel amanha. Nao mova a
-- regra para "so no insert".
create policy scripts_update on public.scripts
  for update using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  )
  with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and (stage_id is null or public.stage_da_conta(stage_id, account_id))
  );

create policy scripts_delete on public.scripts
  for delete using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  );
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0020
```

- [ ] **Step 5: Experimento de discriminação**

Remova `and (stage_id is null or public.stage_da_conta(stage_id, account_id))` **só do `with check` de `scripts_update`**. `npm run db:reset && npm run test:integration -- 0020`. **A metade de update do caso 4 tem que ficar vermelha — e só ela.** Reverta e confirme byte-idêntico ao plano.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck
```

```bash
git add supabase/migrations/0020_scripts.sql tests/integration/0020_scripts.test.ts
git commit -m "feat: tabela scripts com RLS por papel e stage_da_conta fechando o cross-tenant da FK"
```

---

## Task 2: O motor de variáveis — `src/lib/domain/script.ts`

**Files:**
- Create: `src/lib/domain/script.ts`
- Create: `src/lib/domain/script.test.ts`

**Interfaces:**
- Consumes: `formatarTelefone` de `@/lib/domain/formato`; tipo `Lead` de `@/lib/domain/tipos`.
- Produces — normativo, consumido pelas Tasks 3, 4 e 5:

```ts
// src/lib/domain/script.ts
export const VARIAVEIS = [
  'nome_lead', 'primeiro_nome', 'empresa', 'email', 'telefone', 'responsavel', 'etapa',
] as const

export type Variavel = (typeof VARIAVEIS)[number]
export type ContextoScript = Record<Variavel, string | null>

export type Segmento =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'valor'; texto: string; nome: Variavel }
  | { tipo: 'lacuna'; texto: string; nome: Variavel }
  | { tipo: 'desconhecida'; texto: string; nome: string }

export function interpolar(conteudo: string, ctx: ContextoScript): Segmento[]
export function textoPlano(segs: Segmento[]): string
export function contarPendencias(segs: Segmento[]): { lacunas: number; desconhecidas: number }
export function normalizarTags(brutas: string[]): string[]
export function contextoDoLead(
  lead: Lead,
  nomeEtapa: Map<string, string>,
  nomePessoa: Map<string, string>,
): ContextoScript
export function linkWhatsApp(telefoneE164: string, texto: string): string
```

**Invariantes — regras sem ambiguidade (spec §4.4, com as decisões fechadas):**

- **Padrão reconhecido:** `{{nome}}` com espaço opcional em volta (`{{ nome }}` casa), nome em `[a-z_][a-z0-9_]*` — **minúsculas apenas**. Qualquer outra coisa (`{{ }}`, `{{a-b}}`, `{{Empresa}}` com maiúscula, chave solta `{{`) **não casa** e permanece como segmento `texto` literal.
- **`valor`:** nome do catálogo com valor não vazio; `texto` é o valor interpolado.
- **`lacuna`:** nome do catálogo cujo valor no contexto é `null` **ou só espaços** (string vazia conta). `texto` é o `{{nome}}` **literal** — sobrevive à cópia; o erro aparece antes de virar mensagem enviada.
- **`desconhecida`:** nome com a forma válida mas fora do catálogo. `texto` é o `{{nome}}` literal, idem.
- **`textoPlano`** concatena `seg.texto` de todos os segmentos, sem exceção — é o mesmo texto do preview por construção. **Uma função, dois consumidores; não existe segundo caminho de render.**
- **`contarPendencias`** conta segmentos `lacuna` e `desconhecida` separadamente.
- **`normalizarTags`:** para cada bruta, `trim` → minúsculas → descarta vazia → corta em 40 caracteres → dedup (após o corte, para `aaa…a41` e `aaa…a40` não duplicarem). Preserva a ordem da primeira ocorrência. **Não** limita a 10 — o limite é validação com erro (`tags_demais`, Task 4), não truncamento silencioso: a spec §2 decidiu "marca a lacuna, não resolve sozinho", e engolir a 11ª tag em silêncio é a mesma classe de defeito.
- **`contextoDoLead`:** `nome_lead` = `lead.nome`; `primeiro_nome` = primeiro token de `lead.nome` separado por espaço (após `trim`); `empresa`/`email` diretos (`null` propaga); `telefone` = `lead.telefoneE164 ? formatarTelefone(lead.telefoneE164) : null` — **nunca** `formatarTelefone(null)`, que devolve `'—'` e mascararia a lacuna; `responsavel` = `lead.responsavelId ? nomePessoa.get(...) ?? null : null`; `etapa` = `nomeEtapa.get(lead.stageId) ?? null`.
- **`linkWhatsApp`:** `https://wa.me/<só dígitos do e164>?text=<encodeURIComponent(texto)>`. Quem decide não renderizar sem telefone é a tela; a função exige `telefoneE164` não nulo por assinatura.

- [ ] **Step 1: Escrever os testes**

`src/lib/domain/script.test.ts` (environment `node`, como os vizinhos de `domain/`). Casos obrigatórios, cada um dizendo o que o quebra:

1. **Interpolação feliz com espaços opcionais:** `"Oi {{ primeiro_nome }}, vi a {{empresa}}"` com contexto completo → `[texto, valor, texto, valor]` e `textoPlano` devolve a frase montada. Quebra se o regex não aceitar espaço interno.
2. **Lacuna com `null` e com string de espaços:** `empresa: null` e `empresa: '  '` produzem, os dois, segmento `lacuna` com `texto === '{{empresa}}'`. Quebra se espaços contarem como valor.
3. **Desconhecida:** `{{cupom}}` → `desconhecida`, texto literal preservado. Quebra se o motor descartar ou substituir por vazio.
4. **O que não casa fica literal:** `{{ }}`, `{{a-b}}`, `{{Empresa}}`, `{{"x"}}` e um `{{` solto atravessam como `texto`, byte a byte. Quebra se o regex for guloso ou aceitar maiúscula.
5. **Cópia carrega a lacuna:** `textoPlano` de um resultado com lacuna contém `{{empresa}}` literal — **nunca** buraco vazio. É o caso central da spec ("vi que a  está crescendo" foi a classe de defeito que mais custou no projeto).
6. **`contarPendencias`** distingue: conteúdo com 2 lacunas e 1 desconhecida → `{ lacunas: 2, desconhecidas: 1 }`.
7. **`normalizarTags`:** `[' Objeção ', 'OBJEÇÃO', '', 'preço']` → `['objeção', 'preço']` (trim, minúscula, vazia fora, dedup, ordem da primeira ocorrência); uma tag de 41 caracteres sai com 40.
8. **`contextoDoLead`:** lead com `nome: 'Maria da Silva'`, `telefoneE164: null`, `empresa: null`, sem responsável → `primeiro_nome: 'Maria'`, `telefone: null` (não `'—'`), `empresa: null`, `responsavel: null`; com telefone `+5511912345678` → `telefone: '(11) 91234-5678'`. A metade do `'—'` quebra se alguém passar o nulo direto para `formatarTelefone`.
9. **`linkWhatsApp`:** `('+5511912345678', 'oi {{empresa}}')` → `https://wa.me/5511912345678?text=oi%20%7B%7Bempresa%7D%7D` — sem `+`, com o texto url-encodado.

- [ ] **Step 2: Vermelho**

```bash
npm test -- domain/script
```

Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar sob TDD** (o corpo é seu; as assinaturas e invariantes acima são normativos)

- [ ] **Step 4: Verde + portão e commit**

```bash
npm test -- domain/script && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/domain/script.ts src/lib/domain/script.test.ts
git commit -m "feat: motor de variaveis de script — interpolar puro com lacuna visivel e texto plano unico"
```

---

## Task 3: Port `ScriptStore` — `src/lib/data/scripts.ts`

**Files:**
- Create: `src/lib/data/scripts.ts`
- Create: `tests/integration/scripts-store.test.ts`

**Interfaces:**
- Consumes: a tabela da Task 1; `normalizarTags` da Task 2; `padraoIlike` de `@/lib/data/filtro`; `criarClienteServidor` (`@/lib/supabase/servidor`), `resolverContaAtiva` (`@/lib/data/conta`); `Resultado`/`ok`/`falha` (`@/lib/domain/resultado`); `Papel` (`@/lib/domain/tipos`).
- Produces — normativo, consumido pelas Tasks 4 e 5:

```ts
// src/lib/data/scripts.ts
export type Script = {
  id: string
  titulo: string
  conteudo: string
  stageId: string | null
  tags: string[]
  criadoEm: Date
  atualizadoEm: Date
}

export type DadosScript = {
  titulo: string
  conteudo: string
  stageId: string | null
  tags: string[]
}

export interface ScriptStore {
  listar(f: {
    busca?: string | null
    tag?: string | null
    stageId?: string | null
  }): Promise<Resultado<Script[]>>
  buscar(id: string): Promise<Resultado<Script | null>>
  paraEtapa(stageId: string): Promise<Resultado<Script[]>>
  criar(d: DadosScript): Promise<Resultado<string>>
  atualizar(id: string, d: DadosScript): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
  tagsDaConta(): Promise<Resultado<string[]>>
}

export class SupabaseScriptStore implements ScriptStore {
  constructor(cliente: SupabaseClient, contaId: string, usuarioId: string) { /* ... */ }
}

export async function criarScriptStoreDoServidor(): Promise<
  Resultado<{ scripts: SupabaseScriptStore; papel: Papel }>
>
```

**Invariantes:**

- **`criarScriptStoreDoServidor` segue `criarWhatsAppStoreDoServidor` (`whatsapp.ts:119`) SEM o gate de admin:** sessão + `resolverContaAtiva`, devolvendo o `papel` para as telas gatearem "Novo script". Leitura é de todo membro; quem barra escrita de vendedor é a RLS + o pré-check da action (Task 4).
- **Toda consulta filtra `.eq('account_id', contaId)` explicitamente, por cima da RLS — inclusive `buscar`.** `is_member_of` é permissivo para quem pertence a duas contas; sem o filtro, a biblioteca da conta ativa mostraria scripts da outra. É o mesmo ponto não-óbvio do `minhasAbertas` de `tarefas.ts`.
- **Busca textual escapada:** `f.busca` entra como `.or('titulo.ilike.<padraoIlike(busca)>,conteudo.ilike.<padraoIlike(busca)>')` — o helper já devolve o valor entre aspas; nunca interpole cru (Global Constraints). Tag: `.contains('tags', [tag])`, sem string montada à mão. `stageId`: `.eq('stage_id', f.stageId)`.
- **Ordenação com desempate:** `.order('titulo', { ascending: true }).order('id', { ascending: true })` em `listar` e `paraEtapa` — a lição do `lead_events.seq` vale para qualquer lista.
- **`paraEtapa(stageId)`:** uma consulta com `.or('stage_id.eq.<stageId>,stage_id.is.null')` (o uuid vem do banco, não do usuário — não precisa de escape, e o comentário do código diz isso), e depois partição **estável** em TS: os da etapa primeiro, os de `stage_id null` depois, preservando a ordenação do banco dentro de cada grupo.
- **`buscar`:** `maybeSingle`; zero linhas (RLS ou id inexistente) → `ok(null)`, e a página responde `notFound()` — nunca 403, igual à ficha do lead.
- **`criar`/`atualizar` aplicam `normalizarTags` antes de gravar** — a normalização mora no domínio e o store é o único caminho de escrita; a action valida comprimento (>10 → `tags_demais`) **antes** de chamar o store, então aqui o check do banco é backstop, não fluxo.
- **Mapeamento de erro, nunca `error.message` cru** (forma de `codigoDoErroAoCriarTarefa` em `tarefas.ts:92`): em `criar`/`atualizar`, `42501` (with check negou — etapa de outra conta, etapa inexistente, ou etapa excluída entre o render e o submit: `stage_da_conta` devolve `false` para todas) vira **`etapa_invalida`**. `23503` colapsa no mesmo código como backstop — via PostgREST ele é inalcançável para scripts (o `with check` roda antes da FK), custa um `||` e cobre qualquer caminho futuro que não passe pela RLS. Qualquer outro erro de escrita → `erro_ao_salvar_script`; de leitura → `erro_ao_carregar_scripts`.
- **`atualizar`/`excluir` com `.select('id')` e zero linhas → `falha('script_nao_encontrado')`** — id inexistente, de outra conta, ou vendedor barrado pelo `using`: indistinguíveis daqui, mesma convenção de `concluir` em `tarefas.ts`. Nunca sucesso mudo.
- **`tagsDaConta`:** `select('tags')` da conta, achatado, deduplicado e ordenado (asc) em TS.
- **`criar` grava `criado_por: usuarioId`** e `atualizar` carimba `atualizado_em` **pela aplicação** (`new Date().toISOString()`), como `supabase.ts:259` — o repo não tem trigger de `atualizado_em` e este plano não introduz o primeiro.

- [ ] **Step 1: Escrever os testes**

`tests/integration/scripts-store.test.ts`, na forma de `tarefas-store.test.ts`. Casos obrigatórios:

1. **`criar` normaliza tags e `listar` devolve mapeado.** Crie com `tags: [' Objeção ', 'OBJEÇÃO', 'preço']` → o gravado (relido pelo serviço) é `['objeção', 'preço']`; `listar({})` devolve camelCase com `criadoEm`/`atualizadoEm` como `Date`.
2. **Busca com metacaractere é literal.** Dois scripts: um com `Desconto 100%` no conteúdo, outro com `Desconto 100 leads`. `listar({ busca: '100%' })` devolve **só** o primeiro. Fica vermelho se `padraoIlike` for trocado por interpolação crua — o `%` viraria curinga e casaria os dois.
3. **Filtro por tag e por etapa.** `listar({ tag })` usa `.contains` (crie script com duas tags e busque por uma); `listar({ stageId })` devolve só os da etapa.
4. **`paraEtapa` = etapa + nulos, etapa primeiro, com desempate.** Três scripts: da etapa X, de `stage_id null`, da etapa Y. `paraEtapa(X)` devolve dois — o de X primeiro, o nulo depois, e o de Y **fora**. E o desempate da spec §7: dois scripts com o **mesmo título** voltam em ordem estável (`id` asc) em chamadas repetidas — fica vermelho se a ordenação parar no `titulo`.
5. **`buscar` de outra conta → `ok(null)`.** Um usuário membro das **duas** contas (semeie a segunda membership pelo serviço): com a conta A ativa, `buscar` de um script da conta B devolve `null` — é o filtro explícito de `account_id` trabalhando por cima da RLS permissiva. Fica vermelho se o store confiar só na RLS.
6. **`criar` com etapa de outra conta → `falha('etapa_invalida')`**; com etapa inexistente (uuid aleatório) → **o mesmo código**. Os dois chegam como `42501` (ver Task 1, caso 5) — o caso fica vermelho se a tradução tratar `42501` como genérico. O ramo de `23503` é backstop sem caminho executável pelo cliente; não invente teste para ele.
7. **`atualizar` como vendedor → `falha('script_nao_encontrado')`** e a linha intacta (zero linhas via RLS). **`excluir` idem.**
8. **`tagsDaConta` deduplica entre scripts e não vaza conta.** Dois scripts da conta A com tags sobrepostas → união ordenada; um script na conta B com tag própria → a tag de B **não** aparece com a conta A ativa.

- [ ] **Step 2: Vermelho**

```bash
npm run test:integration -- scripts-store
```

- [ ] **Step 3: Implementar sob TDD**

- [ ] **Step 4: Verde + portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/data/scripts.ts tests/integration/scripts-store.test.ts
git commit -m "feat: ScriptStore com busca escapada, paraEtapa e traducao de erro por codigo"
```

---

## Task 4: Server Actions, mapa de erros, telas `/scripts` e navegação

**Files:**
- Create: `src/app/(app)/scripts/acoes.ts`
- Create: `src/app/(app)/scripts/erros.ts`
- Create: `src/app/(app)/scripts/erros.test.ts`
- Create: `src/app/(app)/scripts/page.tsx`
- Create: `src/app/(app)/scripts/novo/page.tsx`
- Create: `src/app/(app)/scripts/[id]/page.tsx`
- Create: `src/app/(app)/scripts/editor.tsx`
- Create: `src/app/(app)/scripts/editor.test.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `ScriptStore`/`criarScriptStoreDoServidor`/`DadosScript` (Task 3); `interpolar`/`contarPendencias`/`normalizarTags`/`VARIAVEIS`/`ContextoScript` (Task 2); `criarStoreDoServidor` (`@/lib/data/supabase`) para `pipelinePadrao` (o select de etapas); `chamarAcao` (`@/lib/ui/acao`); `revalidatePath`.
- Produces — normativo, consumido pela Task 5:

```ts
// src/app/(app)/scripts/acoes.ts ('use server')
export async function criarScript(d: DadosScript): Promise<Resultado<string>>   // devolve o id
export async function atualizarScript(id: string, d: DadosScript): Promise<Resultado<void>>
export async function excluirScript(id: string): Promise<Resultado<void>>

// src/app/(app)/scripts/erros.ts
export function mensagemDeErroScript(codigo: string): string
```

**Invariantes:**

- **As três actions validam nesta ordem, antes de qualquer IO** (forma de `criarTarefa` em `tarefas/acoes.ts`): (1) `titulo.trim()` vazio → `falha('titulo_vazio')`; (2) `conteudo.trim()` vazio → `falha('conteudo_vazio')`; (3) `normalizarTags(d.tags).length > 10` → `falha('tags_demais')` — validação com erro, nunca truncamento silencioso; (4) resolve o store; **(5) `papel === 'vendedor'` → `falha('sem_permissao')`** — o pré-check existe para a mensagem ser honesta na UI; a guarda de verdade é a RLS da Task 1. `excluirScript` só faz (4) e (5). Depois: chama o store, e sucesso revalida `revalidatePath('/scripts')` e, em `atualizarScript`/`excluirScript`, também `revalidatePath('/scripts/' + id)`.
- **`erros.ts` no padrão de `tarefas/erros.ts`** (mapa fora de `acoes.ts` porque `'use server'` não exporta objeto; chaves literais; `[FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO` no fim), com exatamente estas chaves:

```ts
titulo_vazio: 'Escreva um título antes de salvar.',
conteudo_vazio: 'Escreva o conteúdo do script antes de salvar.',
tags_demais: 'No máximo 10 tags por script.',
etapa_invalida: 'Essa etapa não existe mais — pode ter sido excluída. Recarregue a página e escolha outra.',
script_nao_encontrado: 'Esse script não existe mais ou você não tem acesso a ele.',
sem_permissao: 'Só administradores e gestores editam scripts.',
sem_sessao: 'Sua sessão expirou. Entre novamente.',
erro_ao_salvar_script: 'Não foi possível salvar o script. Tente de novo.',
erro_ao_carregar_scripts: 'Não foi possível carregar os scripts. Tente de novo.',
```

- **`/scripts` (`page.tsx`)** — server component, forma de `tarefas/page.tsx`: resolve `criarScriptStoreDoServidor()` e `criarStoreDoServidor()` em `Promise.all`; lê `searchParams` `busca`/`tag`/`etapa` (strings, `''` = sem filtro) e chama `listar`. Filtros: um `<form method="get">` com input de busca, `<select>` de tag (de `tagsDaConta`) e `<select>` de etapa (de `pipelinePadrao().etapas`, mais "Qualquer etapa" = sem filtro). Cada script é um card com título linkado para `/scripts/[id]`, nome da etapa (ou "Qualquer etapa") e as tags. **"Novo script" (link para `/scripts/novo`) só aparece se `papel !== 'vendedor'`.** Estado vazio com mensagem e, para quem pode, o convite de criar o primeiro. Falha de `listar` → mensagem do mapa, não `throw` (a biblioteca vazia não pode derrubar a navegação de quem só ia olhar).
- **`/scripts/novo` e `/scripts/[id]`** — server wrappers finos: o `[id]` faz `buscar(id)`; `null` → `notFound()`. Os dois resolvem `pipelinePadrao().etapas` e renderizam `<Editor>`. **Vendedor em qualquer um dos dois recebe `notFound()`** — a tela de edição nem existe para ele (mesma convenção de "não encontrado, nunca 403").
- **`editor.tsx`** — componente cliente `Editor`, recebe `script: Script | null` (null = novo), `etapas: Etapa[]`, e as actions **por prop com default** (testável sem servidor, padrão de `whatsapp.tsx`/`etapas.tsx`). Título, `<select>` de etapa (com "Qualquer etapa" = null), tags (input separado por vírgula, exibidas normalizadas), `<textarea>` alto de conteúdo, e **preview ao vivo ao lado**, re-interpolado a cada tecla com o lead de exemplo fixo:

```ts
const LEAD_EXEMPLO: ContextoScript = {
  nome_lead: 'Maria da Silva',
  primeiro_nome: 'Maria',
  empresa: null, // nulo DE PROPOSITO: a lacuna tem que ser visivel durante a escrita
  email: 'maria@exemplo.com.br',
  telefone: '(11) 91234-5678',
  responsavel: 'Você',
  etapa: 'Qualificação',
}
```

  O preview pinta cada segmento por tipo (`lacuna`/`desconhecida` com destaque visível e distinguível — ex.: fundo de aviso com o `{{nome}}` literal dentro; `valor` normal), e mostra o contador de `contarPendencias` ("2 variáveis sem valor") quando > 0. A lista de `VARIAVEIS` fica visível e clicável: clicar insere `{{nome}}` na posição do cursor do textarea (via `selectionStart`/`selectionEnd`), mantendo o foco. Salvar chama a action, estado pendente no botão, erro pela mensagem do mapa; sucesso em "novo" navega para `/scripts/[id]` (use `useRouter` — o id vem do retorno da action). Excluir só no modo edição, com confirmação inline antes de chamar (padrão de `whatsapp.tsx`, sem lib nova).
- **Navegação:** em `layout.tsx`, a entrada `<a href="/scripts" className="text-sm underline">Scripts</a>` logo após a de Tarefas, visível aos três papéis. Nada mais muda no layout.

- [ ] **Step 1: Escrever os testes**

`src/app/(app)/scripts/erros.test.ts` (node, forma de `tarefas/erros.test.ts`): toda chave conhecida tem mensagem própria; código desconhecido volta o próprio código.

`src/app/(app)/scripts/editor.test.tsx` (`// @vitest-environment jsdom`, `afterEach(cleanup)` manual). Casos obrigatórios:

1. **A lacuna aparece enquanto se escreve.** Digite conteúdo com `{{empresa}}` (o `LEAD_EXEMPLO` tem `empresa: null`): o preview mostra `{{empresa}}` com o destaque de lacuna (afirme por texto + atributo acessível, não por classe) e o contador diz "1 variável sem valor". Fica vermelho se o preview substituir lacuna por vazio.
2. **`{{Empresa}}` maiúscula fica texto literal** — sem destaque, sem contar pendência. É a costura com a regra do domínio, no DOM.
3. **Variável clicável insere no cursor.** Com o cursor no meio do conteúdo, clicar em `empresa` na lista insere `{{empresa}}` naquela posição (afirme o valor resultante do textarea).
4. **Salvar envia o que foi editado e traduz recusa.** Stub de action registra a chamada (afirme `titulo`, `stageId`, `tags`, `conteudo`); depois, stub devolvendo `falha('etapa_invalida')` → o texto na tela é a mensagem do mapa, não o código.
5. **Excluir pede confirmação: cancelar não chama, confirmar chama com o id.** Dois renders, padrão de `whatsapp.test.tsx`.

- [ ] **Step 2: Vermelho**

```bash
npm test -- scripts
```

- [ ] **Step 3: Implementar** (actions, erros, as três páginas, editor, navegação)

- [ ] **Step 4: Verde + build**

```bash
npm test -- scripts && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Verificar no navegador — não é opcional**

```bash
npm run dev
```

Como admin: crie um script com `{{empresa}}` e uma etapa; veja a lacuna pintada no preview enquanto digita; salve e confira a biblioteca com filtros funcionando (busca com `%` no termo não explode). Como vendedor (conta demo ou uma criada à mão): `/scripts` sem "Novo script", `/scripts/novo` → 404. Duas vezes neste projeto o olho achou o que nenhuma suíte achou.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add "src/app/(app)/scripts" "src/app/(app)/layout.tsx"
git commit -m "feat: biblioteca /scripts com editor de preview ao vivo e entrada na navegacao"
```

---

## Task 5: Painel de scripts na ficha do lead + E2E

**Files:**
- Create: `src/app/(app)/leads/[id]/scripts.tsx`
- Create: `src/app/(app)/leads/[id]/scripts.test.tsx`
- Modify: `src/app/(app)/leads/[id]/page.tsx`
- Create: `tests/e2e/scripts.spec.ts`

**Interfaces:**
- Consumes: `paraEtapa`/`criarScriptStoreDoServidor` (Task 3); `interpolar`/`textoPlano`/`contarPendencias`/`contextoDoLead`/`linkWhatsApp` (Task 2); os mapas `nomeEtapa`/`nomePessoa` que `page.tsx` já constrói.
- Produces: nada consumido por outra task.

**Comportamento — normativo:**

- **`page.tsx`:** acrescente `criarScriptStoreDoServidor()` ao `Promise.all` existente e, com o store, `paraEtapa(lead.valor.stageId)`. Falha de scripts **degrada para painel vazio com aviso** (mensagem de `erro_ao_carregar_scripts`), não `throw`: o painel é acessório da ficha — a regra do layout (sino/badge) vale aqui. Monte `const contexto = contextoDoLead(lead.valor, nomeEtapa, nomePessoa)` e renderize `<PainelScripts scripts={...} contexto={contexto} telefoneE164={lead.valor.telefoneE164} />` na coluna da esquerda, depois de `<PainelTarefas>`.
- **`scripts.tsx`** — componente cliente `PainelScripts`, recebe `scripts: Script[]`, `contexto: ContextoScript`, `telefoneE164: string | null`. Para cada script: título, preview **interpolado com aquele lead** (segmentos pintados como no editor — `lacuna`/`desconhecida` destacadas com o `{{nome}}` literal), o contador de pendências quando > 0, e dois controles:
  - **Copiar:** `navigator.clipboard.writeText(textoPlano(interpolar(script.conteudo, contexto)))`, com feedback transitório "Copiado ✓" (padrão do "Salvo ✓" de `etapas.tsx`). Copiar **continua liberado com pendência** — o aviso é o contador, a decisão é do vendedor (spec §4.4).
  - **WhatsApp:** com `telefoneE164`, um `<a>` com `href={linkWhatsApp(telefoneE164, texto)}` e `target="_blank"`; sem telefone, um `<button disabled>` com `title` explicando ("Este lead não tem telefone") — nunca um link morto.
  - Interpolação computada **uma vez por script** (memo ou variável local) e usada pelo preview, pelo Copiar e pelo link — os três saem do mesmo `Segmento[]`; não existe segundo caminho.
- **Estado vazio:** "Nenhum script para esta etapa." com link para `/scripts` (e é só isso — a ficha não cria script).

- [ ] **Step 1: Escrever os testes de componente**

`src/app/(app)/leads/[id]/scripts.test.tsx` (`// @vitest-environment jsdom`, `afterEach(cleanup)`). Casos obrigatórios:

1. **Preview com lacuna pintada e contador.** Script com `{{empresa}}`, contexto com `empresa: null` → o painel mostra `{{empresa}}` destacado e "1 variável sem valor".
2. **Copiar escreve o texto plano com a lacuna literal.** Stub de `navigator.clipboard` (defina `writeText` via `Object.defineProperty` no teste); clique; afirme que o texto escrito contém `{{empresa}}` literal e os valores interpolados dos demais. Fica vermelho se o Copiar usar outro caminho que não `textoPlano`.
3. **WhatsApp com e sem telefone.** Com `+5511912345678`: o link tem `href` começando com `https://wa.me/5511912345678?text=` e o texto url-encodado. Sem telefone: não há link, há botão desabilitado.
4. **Estado vazio** com o link para `/scripts`.

- [ ] **Step 2: Vermelho**

```bash
npm test -- leads/.id./scripts
```

(Ajuste o filtro ao runner se o path com colchetes atrapalhar — `npm test -- scripts.test` também serve; os testes da Task 4 têm que continuar verdes.)

- [ ] **Step 3: Implementar** (componente + `page.tsx`)

- [ ] **Step 4: Verde**

```bash
npm test -- scripts && npm run typecheck && npm run lint
```

- [ ] **Step 5: Escrever e rodar o E2E**

`tests/e2e/scripts.spec.ts`, na forma de `tarefas.spec.ts` (mesmos helpers de `apoio.ts`). Cenário da spec §7, mais o gate de papel:

1. Admin cria em `/scripts/novo` um script amarrado à etapa do lead de teste, com `{{empresa}}` no conteúdo (o lead de teste não tem empresa — garanta isso ao criá-lo) e uma tag.
2. Abre a ficha de um lead naquela etapa: o script aparece no painel, o `{{empresa}}` está visível como lacuna e o contador acusa "1 variável sem valor".
3. Copiar: conceda permissão de clipboard ao contexto (`context.grantPermissions(['clipboard-read', 'clipboard-write'])`, chromium) e afirme via `page.evaluate(() => navigator.clipboard.readText())` que o texto contém `{{empresa}}` literal.
4. O vendedor da mesma conta abre `/scripts`: a biblioteca aparece, **sem** "Novo script"; `/scripts/novo` responde 404.

```bash
npm run test:e2e -- scripts
```

- [ ] **Step 6: Portão e commit**

```bash
npm test && npm run test:integration && npm run typecheck && npm run lint
```

```bash
git add "src/app/(app)/leads/[id]/scripts.tsx" "src/app/(app)/leads/[id]/scripts.test.tsx" "src/app/(app)/leads/[id]/page.tsx" tests/e2e/scripts.spec.ts
git commit -m "feat: painel de scripts na ficha do lead — preview interpolado, copiar e wa.me"
```

---

## Task 6: Migration `0021` — os revokes do backlog (carona) e o portão final

**Files:**
- Create: `supabase/migrations/0021_revokes_guarda_6.sql`
- Create: `tests/integration/0021_revokes.test.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores — é o item 3 da §0 do `progresso.md`, entrando de carona como a nota de lá prevê.
- Produces: nada. Nenhum comportamento do produto muda; a suíte inteira existente é a prova (as RPCs `definer` rodam como dona da tabela e não passam por ACL de `anon`/`authenticated`).

- [ ] **Step 1: Escrever o teste de integração**

`tests/integration/0021_revokes.test.ts`. Casos obrigatórios, todos via `comoUsuario` (sessão SQL `authenticated`):

1. `truncate public.source_credentials` → **permission denied**.
2. `truncate public.ingestion_config` → **permission denied**.
3. `select * from public.source_credentials` → **permission denied** (erro de privilégio, não zero linhas — já era assim; o teste pina que o `revoke all` não foi longe demais nem de menos).
4. `truncate public.whatsapp_connections` → permission denied (já revogado na `0019`; pina contra regressão).

- [ ] **Step 2: Vermelho**

```bash
npm run test:integration -- 0021
```

Esperado: FAIL nos casos 1 e 2 — o truncate **passa** hoje (guarda nº 6: o default ACL `Dxtm` da imagem o concede, e RLS não restringe TRUNCATE).

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0021_revokes_guarda_6.sql`:

```sql
-- Paga o item 3 da secao 0 do progresso (guarda silenciosa no 6, achada no
-- review do Plano 9): o default ACL desta imagem concede Dxtm
-- (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) a anon/authenticated em toda tabela
-- nova, e TRUNCATE nao passa pela RLS. source_credentials e ingestion_config
-- estao truncaveis por sessao SQL authenticated desde a 0008 — inalcancavel
-- pela superficie do produto (PostgREST nao fala TRUNCATE), mas o comentario
-- da 0008 promete tabela fechada e sem isto a promessa e falsa.
--
-- Nenhuma RPC quebra: as funcoes definer rodam como a dona das tabelas
-- (postgres) e nao dependem de ACL de anon/authenticated. A suite existente
-- de 0008/0010/0011 e a prova executavel.
revoke all on public.source_credentials from anon, authenticated;
revoke all on public.ingestion_config from anon, authenticated;

-- Na 0019 o revoke foi so de TRUNCATE; o review final do Plano 9 apontou o
-- residuo assimetrico (x, t, m do default ACL ficaram). Fecha aqui.
revoke references, trigger, maintain on public.whatsapp_connections from anon, authenticated;
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0021
```

- [ ] **Step 5: Portão final da branch**

```bash
npm run db:reset
npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build
```

Tudo verde, rodado **depois** do reset. Antes do E2E, derrube qualquer `npm run dev` aberto.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0021_revokes_guarda_6.sql tests/integration/0021_revokes.test.ts
git commit -m "fix: revokes da guarda silenciosa no 6 — credenciais fechadas tambem para TRUNCATE"
```

---

## Critério de aceite do plano

O da spec §10, na íntegra: um gestor cria em `/scripts/novo` um script de abertura amarrado a uma etapa, com tags e uma menção a `{{empresa}}`. Um vendedor abre um lead do Meta que está naquela etapa e **não tem empresa**: o script aparece no painel, o `{{empresa}}` está destacado como lacuna, o aviso diz "1 variável sem valor", e o texto copiado traz o `{{empresa}}` literal — não um buraco. O botão de WhatsApp abre a conversa com o texto; num lead sem telefone, está desabilitado. O mesmo vendedor não consegue editar nem excluir o script — nem pela tela (que ele não vê) nem pelo PostgREST (RLS). E, além da spec: excluir uma etapa com script apontando para ela funciona, e o script vira "qualquer etapa".

Suíte verde no resultado do merge, depois de `npx supabase db reset`. Todo teste novo com RED demonstrado.

## Review

Review de contexto fresco **por task**, e review de branch inteira antes do merge. Cinco perguntas para o revisor de branch inteira, cada uma exigindo mais de uma task junta:

1. **Preview, Copiar e `wa.me` saem todos do MESMO `Segmento[]`?** No editor, no painel da ficha e no link — existe algum segundo caminho de render que possa divergir do que o vendedor viu?
2. **A lacuna sobrevive de ponta a ponta?** Do domínio (`texto` literal) ao preview (pintada), à área de transferência (literal) e ao `wa.me` (url-encodada) — em nenhum ponto vira string vazia?
3. **Vendedor está barrado em TODAS as camadas que prometem isso?** RLS (Task 1), pré-check da action (Task 4), telas de edição em `notFound()` (Task 4), botões ausentes (Tasks 4 e 5) — e há teste para cada camada, não só para a mais externa?
4. **O excluir-etapa do Plano 8 e os scripts se compõem?** FK `set null`, `etapa_invalida` com texto de etapa excluída, `paraEtapa` tratando `stage_id null` — algum caminho ainda supõe que etapa é eterna?
5. **Algum filtro PostgREST novo interpola texto de usuário sem `filtro.ts`?** Inclusive os que não parecem busca (tag, etapa).
