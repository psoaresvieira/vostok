# Spec — CRM: Scripts de Venda + Tarefas (sub-projeto 4)

Data: 2026-08-02
Origem: `Obsidian Vault/CRM/v.0.md` §§2.3 e 2.4; sub-projeto 3 entregue em `master` (`752a281`)
Status: aprovado no brainstorming, pronto para `writing-plans`

---

## 1. Contexto e recorte

Os sub-projetos 1 a 3 entregaram o funil, o lead do Meta e do Google caindo nele sozinho, e a leitura desse volume em `/metricas`. O que falta para o vendedor **trabalhar** o lead: lembrar do follow-up, e ter o texto certo na mão na hora de responder.

Este sub-projeto entrega as duas coisas. Elas não compartilham tabela nem tela — a decisão foi **uma spec, dois planos**, pelo precedente do sub-projeto 3 (Planos 5 e 6): decide-se tudo com o contexto fresco, e cada merge fica pequeno.

- **Plano 7 — Tarefas.** Migration `0015`, port `TarefaStore`, tela `/tarefas`, painel na ficha do lead, badge na navegação. Mais a infraestrutura de teste de componente (§7.1).
- **Plano 8 — Scripts.** Migration `0016`, port `ScriptStore`, biblioteca `/scripts`, página de edição `/scripts/[id]`, painel na ficha do lead com interpolação e WhatsApp.

**Fora de escopo**, com a razão de cada um:

| Fora | Razão |
|---|---|
| Versionamento / histórico de edição de script | `v.0` §7 o põe em fase 2 explicitamente |
| Alerta de SLA por etapa | `v.0` §7, fase 2. `stages.sla_horas` continua sem leitor — ver §8 |
| Calendário (mês/semana) | UI cara; o repo não tem base de teste de componente que a sustente |
| Tarefas recorrentes | Nenhum pedido na `v.0` |
| Notificação de tarefa no sino | Decidido no brainstorming — ver §3.5 |
| Anexo em script; markdown ou HTML no conteúdo | Conteúdo é texto puro (§4.4) |
| Disparo real de WhatsApp | Sub-projeto 5. Aqui é link `wa.me` (§4.5) |

### Decomposição do MVP

1. Fundação + núcleo do funil — ✅ completo (Planos 1 e 2)
2. Ingestão automática — ✅ completo (Planos 3 e 4)
3. Rastreamento + Métricas — ✅ completo (Planos 5 e 6)
4. **Scripts de Venda + Tarefas** ← este documento (Planos 7 e 8)
5. Disparo de WhatsApp

## 2. Decisões tomadas no brainstorming

| Decisão | Escolha | Razão |
|---|---|---|
| Estrutura | Uma spec, dois planos | Features independentes; merge menor por vez |
| Superfície de tarefa | Ficha do lead **+** tela "Minhas tarefas" | Tarefa que só existe dentro do lead exige lembrar de abrir o lead — que é o que falhou |
| Lembrete | Badge de contagem na navegação, sem linha em `notifications` | O sino também é in-app, então entregaria quase o mesmo por muito mais superfície: produtor novo, enum novo, e um segundo job no cron global entre tenants que já produziu um livelock |
| Dono da tarefa | O responsável do lead; a tarefa **não** tem `responsavel_id` | `pode_ver_lead_id` já recorta. Zero código de autorização novo, e "tarefa apontando para lead invisível" é impossível por construção |
| Classificação de script | FK opcional para etapa + tags livres | A etapa é o que permite sugerir o script certo na ficha do lead; "produto" e "objeção" da `v.0` são a mesma operação das tags |
| Variável sem valor | Marca a lacuna, não resolve sozinha | Substituir por vazio manda `"vi que a  está crescendo"` para o cliente, em silêncio — a classe de defeito que mais custou neste projeto |
| Formato de variável | Nomeado (`{{nome_lead}}`) | Legível para o vendedor. O sub-projeto 5 traduz para posicional — ver §9 |
| Teste de componente | Pago na Task 1 do Plano 7 | §7.1 |
| Fuso | Constante `America/Sao_Paulo`, passada como parâmetro | §3.3 |

## 3. Tarefas — Plano 7

### 3.1 Modelo de dados (`0015_tarefas.sql`)

Filha de lead, e segue o padrão de `lead_tags` e `stage_history`: **sem `account_id`**, alcança a conta por `lead_id`.

```sql
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
```

Dois índices: `(lead_id, vence_em)` para o painel da ficha, e um **parcial** `(vence_em) where concluida_em is null` para `/tarefas` e para o badge, que só leem tarefa aberta.

`atualizado_em` é escrito **pela aplicação** no update, como `supabase.ts:259` já faz em `leads`. O repo não tem trigger de `atualizado_em` em tabela nenhuma, e este plano não introduz o primeiro — vale igual para `scripts` (§4.1).

**RLS — quatro policies, todas com o mesmo predicado**, idêntico ao que `lead_tags` já usa:

```sql
alter table public.tasks enable row level security;
grant select, insert, update, delete on public.tasks to authenticated;

create policy tasks_select on public.tasks
  for select using (public.pode_ver_lead_id(lead_id));
create policy tasks_insert on public.tasks
  for insert with check (public.pode_ver_lead_id(lead_id));
create policy tasks_update on public.tasks
  for update using (public.pode_ver_lead_id(lead_id))
  with check (public.pode_ver_lead_id(lead_id));
create policy tasks_delete on public.tasks
  for delete using (public.pode_ver_lead_id(lead_id));
```

O `grant` explícito **não é decoração**: o default ACL do schema `public` nesta imagem (Postgres 17.6) dá a `authenticated` só `Dxtm`, e sem ele a RLS nem chega a ser avaliada.

Diferente de lead, tarefa **tem** policy de delete: erro de digitação em follow-up não merece ser eterno.

### 3.2 Estado derivado, nunca gravado

`atrasada` / `hoje` / `próxima` **não existe como coluna**. É calculado na leitura a partir de `vence_em`, mesma regra que `leads.status` já segue (derivado dentro de `move_lead_stage`, nunca escrito pela aplicação).

Vive em função pura, `src/lib/domain/tarefa.ts`:

```ts
export type Balde = 'atrasada' | 'hoje' | 'proximos7' | 'depois'
export function classificar(venceEm: Date, agora: Date, fuso: string): Balde
```

Regra, sem ambiguidade:

- `venceEm < agora` → `atrasada`, **mesmo que seja hoje mais tarde no relógio civil**. Vencer é vencer.
- senão, mesmo dia civil no fuso → `hoje`
- senão, dia civil entre **amanhã e amanhã + 6** (sete dias, ambos os extremos incluídos) → `proximos7`
- senão → `depois`

A comparação é entre **dias civis no fuso**, nunca entre instantes: `agora` às 23h e `venceEm` amanhã às 1h são dias diferentes, e a diferença em horas (2h) não pode decidir nada.

### 3.3 Fuso: pagando a dívida em vez de herdá-la

O ledger registra como dívida aceita que `/metricas` calcula datas em **UTC**, ficando 3h deslocado para este mercado, com o conserto real dependendo de um fuso na conta que não existe. Se Tarefas herdar isso, "vence hoje" passa a mentir todo dia entre 21h e meia-noite.

Não é preciso herdar: **`timeline.tsx:6` já fixa `America/Sao_Paulo`**, então o fuso constante é o padrão do repo e quem destoa é `/metricas`.

Decisão: uma constante `FUSO_PADRAO = 'America/Sao_Paulo'` no domínio, com `classificar` recebendo o fuso **como parâmetro**. Resolve com `Intl` e sem dependência nova, e no dia em que a conta tiver fuso é trocar o argumento — inclusive em métricas. Este plano **não** mexe em `/metricas`.

### 3.4 Port `TarefaStore`

Port novo, **não** métodos novos no `CrmStore` — que já tem ~25 métodos, com `memory.ts` (376 linhas) e `supabase.ts` (501) implementando os dois lados. O precedente é o `NotificacaoStore`, que já vive fora.

**Uma implementação só, a Supabase** — e isto é escolha, não esquecimento. O repo tem in-memory em dois lugares por razões diferentes: `InMemoryIngestaoStore` existe porque três handlers de webhook são testados unitariamente contra ele, ou seja, tem consumidor real; `InMemoryCrmStore` **não tem consumidor nenhum além do próprio `memory.test.ts`** — são 376 linhas mantidas em paralelo com o SQL, e o Plano 6 já gastou um commit (`bc0154c`) cobrindo ramificações dele "que podiam divergir do SQL".

Nada consumiria um `InMemoryTarefaStore`: as telas são server components, cobertos por integração contra Postgres real e por E2E. Duplicar a lógica aqui só criaria uma segunda fonte de verdade capaz de divergir em silêncio. `NotificacaoStore`, que é o análogo mais próximo, já segue exatamente este caminho.

```ts
export type Tarefa = {
  id: string
  leadId: string
  leadNome: string
  titulo: string
  tipo: 'ligacao' | 'whatsapp' | 'reuniao' | 'proposta' | 'outro'
  venceEm: Date
  concluidaEm: Date | null
  concluidaPor: string | null
  criadoPor: string | null
  criadoEm: Date
}

export interface TarefaStore {
  doLead(leadId: string): Promise<Resultado<Tarefa[]>>
  minhasAbertas(responsavelId: string | null): Promise<Resultado<Tarefa[]>>
  criar(d: { leadId: string; titulo: string; tipo: Tarefa['tipo']; venceEm: Date }): Promise<Resultado<string>>
  concluir(id: string): Promise<Resultado<void>>
  reabrir(id: string): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
}
```

**`minhasAbertas` filtra `leads.responsavel_id` explicitamente, por cima da RLS.** Ponto não-óbvio e a única armadilha real da tela: `pode_ver_lead_id` entrega ao **admin toda tarefa da conta**, então sem esse filtro "Minhas tarefas" mostraria as dos outros. Para vendedor o filtro é redundante — e fica assim mesmo, incondicional.

O parâmetro é o responsável a consultar (`null` = leads sem responsável). Quem chama passa `auth.uid()` por padrão; gestor e admin podem passar outro, pelo filtro da tela.

**Consequência declarada:** tarefa em lead **sem responsável** não aparece em "Minhas tarefas" de ninguém. Só pelo filtro "sem responsável", disponível a gestor e admin. É aceito: lead sem dono é um problema anterior ao da tarefa.

**Ordenação:** `vence_em asc`, com desempate por `criado_em asc, id asc`. Desempate não é zelo excessivo — o Plano 3 gastou uma task inteira (`lead_events.seq`) por ordenação sem desempate sob timestamp idêntico.

**O join com `leads` para o `leadNome` é embed simples**, e **não** deve copiar a defesa do `SupabaseNotificacaoStore`. Lá o `leads` pode chegar nulo porque a notificação é do usuário e sobrevive ao lead sair do alcance dele; aqui a policy de `tasks` já exige o lead visível, então tarefa cujo lead sumiu do alcance não volta na consulta.

**O badge não é método novo.** A navegação chama `minhasAbertas` e conta com `classificar` os baldes `atrasada` e `hoje`. Uma fonte de verdade só. Custo: a navegação busca as tarefas abertas para contá-las — aceitável no volume do MVP, e uma consulta a mais por render (o sino já custou duas).

### 3.5 Telas

**`/tarefas`** — server component. Minhas tarefas abertas entre todos os leads, em quatro seções: Atrasadas, Hoje, Próximos 7 dias, Depois. Cada linha: título, tipo (ícone), nome do lead com link para a ficha, prazo formatado, e concluir. Gestor e admin ganham filtro por responsável — os membros mais "sem responsável" — reusando o padrão que o funil já tem.

**Painel na ficha do lead** — criar, concluir, reabrir e excluir. Abertas primeiro, ordenadas por prazo; concluídas abaixo, todas.

**Badge na navegação** — atrasadas + hoje. Zero quando não há.

**Conclusão escreve na timeline.** `lead_events.tipo` é `text`, então não há enum a alterar; o tipo novo é `tarefa_concluida`, com `titulo` e `tipo` no payload. O payload guarda o título como **snapshot**, do mesmo jeito que `etiqueta_aplicada` guarda `tag` — a tarefa pode ser excluída depois, e a história do lead não pode ficar apontando para o vazio. `rotuloEvento` ganha o `case`; o `default` já devolve o tipo cru, então nada quebra na ordem em que as tasks caírem.

**Concluir é reversível, e cada conclusão escreve um evento; reabrir não escreve nada.** Consequência aceita: concluir → reabrir → concluir deixa dois eventos na timeline. É história verdadeira, e `lead_events` é append-only por desenho.

**Criar tarefa não escreve evento** — deliberado, para não dobrar o ruído da timeline. A tarefa já é visível no painel.

## 4. Scripts — Plano 8

### 4.1 Modelo de dados (`0016_scripts.sql`)

Script **não** é filho de lead: é conhecimento da conta. Leva `account_id` e usa `is_member_of`, igual à tabela `tags`.

```sql
create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  titulo text not null check (btrim(titulo) <> ''),
  conteudo text not null,
  stage_id uuid references public.stages(id),   -- nulo = serve em qualquer etapa
  tags text[] not null default '{}'
    check (coalesce(array_length(tags, 1), 0) <= 10),
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index scripts_account_stage_idx on public.scripts (account_id, stage_id);
create index scripts_tags_idx on public.scripts using gin (tags);
```

**`tags` como array, não tabela de junção.** As etiquetas de lead precisam de identidade — congelam `stage_id_no_momento` e alimentam o ranking de `/metricas`. Tag de script só precisa ser buscada. Uma tabela de junção aqui importaria a classe de bug do `ILIKE` (`Desconto 10%` casando com `Desconto 100 leads`, que já corrompeu snapshot de etapa uma vez) sem comprar nada.

Normalização na gravação, feita no domínio antes do insert: `lower(btrim(t))`, vazias removidas, deduplicadas, cada uma com no máximo 40 caracteres. São chave de busca, não rótulo de exibição.

### 4.2 RLS, e a armadilha do `stage_id`

```sql
alter table public.scripts enable row level security;
grant select, insert, update, delete on public.scripts to authenticated;
```

- `select`: `public.is_member_of(account_id)` — todo membro consome a biblioteca.
- `insert`, `update`, `delete`: `is_member_of(account_id) and public.papel_na_conta(account_id) in ('admin', 'gestor')`. Vendedor não edita. É uma linha se a decisão mudar.

**A FK de `stage_id` não confina ao tenant.** `references public.stages(id)` aceita etapa de **qualquer** conta, e a conta do script está a dois saltos da etapa (`stages → pipelines → account`). É a mesma classe que o Plano 3 fechou na Task 4 (`responsavel_id` que não precisava ser membro).

Conserto: helper `public.stage_da_conta(p_stage_id uuid, p_account_id uuid) returns boolean`, `stable security definer set search_path = public`, e o `with check` de insert e update exige `stage_id is null or public.stage_da_conta(stage_id, account_id)`.

Dois cuidados que o repo já pagou para aprender:

- **O `with check` reavalia a linha inteira**, inclusive colunas que o `update` não tocou. Se houvesse script com `stage_id` órfão, ele ficaria travado para qualquer update futuro. Aqui a tabela nasce com a regra, então não há o que limpar — mas o plano não pode escrever a regra "só no insert".
- **`security definer` aqui é para escapar da RLS de `stages` na leitura de conferência**, e é a mesma razão que torna `pode_ver_lead` `definer`. Não é hábito: a função lê `stages` de passagem, e sem `definer` a subconsulta colapsaria para zero em silêncio — recusando script legítimo em vez de dar erro.

### 4.3 Port `ScriptStore`

```ts
export type Script = {
  id: string
  titulo: string
  conteudo: string
  stageId: string | null
  tags: string[]
  criadoEm: Date
  atualizadoEm: Date
}

export interface ScriptStore {
  listar(f: { busca?: string | null; tag?: string | null; stageId?: string | null }): Promise<Resultado<Script[]>>
  buscar(id: string): Promise<Resultado<Script | null>>
  paraEtapa(stageId: string): Promise<Resultado<Script[]>>
  criar(d: Omit<Script, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<Resultado<string>>
  atualizar(id: string, d: Omit<Script, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
  tagsDaConta(): Promise<Resultado<string[]>>
}
```

`paraEtapa` devolve os da etapa **mais** os de `stage_id is null`, ordenados com os da etapa primeiro.

**A busca por texto tem que usar o escape de `src/lib/data/filtro.ts`.** Interpolar termo de usuário em filtro PostgREST foi o backlog #9, fechado na Task 3 do Plano 3 — o helper existe, e este plano não pode reintroduzir a classe. Filtro por tag é `.contains('tags', [tag])`, sem string montada à mão.

Zero linha por RLS chega como `null` em `buscar`, e a página responde `notFound()` — é "não encontrado", nunca 403, igual à ficha do lead.

### 4.4 O motor de variáveis — `src/lib/domain/script.ts`

É a peça que carrega a lógica, e é pura. Mesma arquitetura que o Plano 6 provou: o que erra em silêncio mora em função pura, testada em milissegundos e sem Docker.

```ts
export const VARIAVEIS = [
  'nome_lead', 'primeiro_nome', 'empresa', 'email', 'telefone', 'responsavel', 'etapa',
] as const

export type ContextoScript = Record<(typeof VARIAVEIS)[number], string | null>

export type Segmento =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'valor'; texto: string; nome: string }
  | { tipo: 'lacuna'; texto: string; nome: string }
  | { tipo: 'desconhecida'; texto: string; nome: string }

export function interpolar(conteudo: string, ctx: ContextoScript): Segmento[]
export function textoPlano(segs: Segmento[]): string
export function contarPendencias(segs: Segmento[]): { lacunas: number; desconhecidas: number }
```

**Uma função, dois consumidores.** O preview pinta os segmentos; `textoPlano` concatena `seg.texto` para o Copiar e para o `wa.me`. Não existe caminho para os dois divergirem — que é como "o preview mostrava certo e o copiado saiu errado" costuma nascer.

Regras, sem ambiguidade:

- Padrão reconhecido: `{{ nome }}` com espaço opcional em volta, nome em `[a-z_][a-z0-9_]*`, comparado em minúsculas. Qualquer outra coisa (`{{ }}`, `{{a-b}}`, chave solta) **não casa** e permanece como `texto` literal.
- `lacuna` = nome **no catálogo** cujo valor é `null` **ou só espaços**. String vazia conta como lacuna.
- `desconhecida` = nome fora do catálogo.
- Em `lacuna` e `desconhecida`, `texto` é o `{{nome}}` **literal** — então ele sobrevive à cópia. É a decisão: o erro aparece antes de virar mensagem enviada.
- `contarPendencias` alimenta o aviso "2 variáveis sem valor" acima do botão. Copiar **continua liberado**.

Montagem do contexto a partir do lead: `primeiro_nome` é o primeiro token de `nome` separado por espaço; `telefone` passa por `formatarTelefone`, o mesmo da ficha; `responsavel` e `etapa` vêm dos mapas de nome que a página já constrói.

O conteúdo é texto puro, renderizado como texto — o React escapa e não há superfície de injeção. Sem markdown, sem HTML.

### 4.5 Telas

**`/scripts`** — biblioteca. Busca por texto em título e conteúdo, filtro por tag e por etapa. Admin e gestor veem "Novo script"; vendedor não.

**`/scripts/novo` e `/scripts/[id]`** — a página de edição. Título, etapa (select com "Qualquer etapa"), tags, conteúdo em textarea alta, e **preview ao vivo ao lado** com um lead de exemplo fixo — que inclui campo nulo de propósito, para a lacuna ser visível durante a escrita. A lista de variáveis do catálogo fica clicável, inserindo no cursor.

**Painel na ficha do lead** — `paraEtapa(lead.stageId)`, cada script com preview já interpolado **com aquele lead**, o contador de pendências, Copiar, e WhatsApp.

**WhatsApp:** `https://wa.me/<e164 só dígitos>?text=<encodeURIComponent(textoPlano)>`, desabilitado quando o lead não tem `telefoneE164`. Entrega o "usar no WhatsApp" da `v.0` §2.4 **hoje**, sem Cloud API, sem template e sem App Review.

## 5. Navegação

Duas entradas novas no menu de `(app)`: **Tarefas** (com badge) e **Scripts**. Visíveis aos três papéis.

## 6. Erro

Nada de mensagem crua do PostgREST na tela — o backlog registra ~30 sítios com esse defeito, e este plano não acrescenta o 31º. Cada Server Action nova mapeia para chave conhecida, seguindo `config/erros.ts`. Chaves necessárias no mínimo: título vazio, prazo ausente ou inválido, tarefa inexistente ou fora do alcance, script inexistente, e papel sem permissão de editar script.

## 7. Estratégia de teste

| Camada | O que cobre | Custo |
|---|---|---|
| Unitário (`node`) | `classificar` nos quatro baldes e nas viradas de dia no fuso; `interpolar` / `textoPlano` / `contarPendencias`; normalização de tag | ms, sem Docker |
| Unitário (`jsdom`) | Renderização dos segmentos, WhatsApp desabilitado sem telefone, estados vazios, `rotuloEvento` | ms |
| Integração | RLS das duas tabelas contra Postgres real; `stage_da_conta`; ordenação com desempate; busca com termo contendo metacaractere de PostgREST | Docker |
| E2E | Um por plano | `workers: 1` |

**O teste que não pode faltar é o de discriminação.** A guarda #5 da lista de defeitos silenciosos diz: numa leitura recortada por papel, contar linhas não prova nada — um teste que só conta passaria com a proteção desligada. Então, para `minhasAbertas`, a mesma chamada com os mesmos argumentos por **dois papéis diferentes** tem que produzir números **diferentes**, obrigatoriamente. Vale também um teste afirmando `prosecdef = false` em `pg_proc` para qualquer função nova de leitura.

E as três guardas restantes, checadas explicitamente em cada migration: `grant` explícito (senão a RLS nem é avaliada); nenhum `is distinct from` com possibilidade de dois lados nulos; e mudança de assinatura começando por `drop function` — não há nenhuma prevista aqui, mas `stage_da_conta` nasce agora e é a única função nova.

**E2E do Plano 7:** criar tarefa na ficha → aparecer em `/tarefas` no balde certo → badge incrementar → concluir → sumir da tela e virar evento na timeline.

**E2E do Plano 8:** criar script com etapa e uma variável que o lead não tem → abrir a ficha de um lead naquela etapa → o script aparece, a lacuna está visível e o contador acusa → copiar.

### 7.1 Task 1 do Plano 7 — infraestrutura de teste de componente

O repo não tem nenhum `*.test.tsx`, e `vitest.config.ts` coleta só `src/**/*.test.ts` em `environment: 'node'`.

Custo real, menor do que o backlog sugere: `@vitejs/plugin-react` **já está** nas devDependencies. Falta `jsdom` e `@testing-library/react`, `plugins: [react()]` no config, `include` para `src/**/*.test.{ts,tsx}`, e cada arquivo `.tsx` marcado com `// @vitest-environment jsdom`. Os testes existentes em `node` não são tocados — nenhum config novo, nenhuma suíte nova no `package.json`.

**O que isso honestamente compra.** Não teria pego nenhuma das duas falhas que motivaram o item de backlog: a fonte em serif veio de CSS global mais `layout.tsx`, e o feedback ausente do drag exigia navegador. Teste de componente não pega nenhum dos dois.

O que pega é a costura entre função pura e DOM, que este sub-projeto cria em quatro lugares: o preview pintando `lacuna` como lacuna, o botão de WhatsApp desabilitado sem telefone, os estados vazios das telas novas. E fecha uma lacuna que **já existe**: `rotuloEvento`, em `timeline.tsx`, é pura, exportada, e **não tem teste nenhum hoje**, porque o `include` exclui `.tsx`. Ela ganha cobertura dos cinco casos atuais junto com o `tarefa_concluida` novo.

## 8. `stages.sla_horas` continua sem leitor

O campo existe na tabela e no tipo desde o Plano 1 e nunca foi lido por nada. Tarefas é o primeiro lugar onde ele faria sentido, e **mesmo assim fica fora**: alerta de SLA é fase 2 na `v.0` §7, e o desenho natural dele é *gerar tarefa automaticamente* quando o lead passa do prazo na etapa — o que é Automações (`v.0` §2.5), também fase 2.

Registrado aqui para ser escolha e não esquecimento. Este sub-projeto constrói a tabela sobre a qual essa automação vai escrever.

## 9. O que isto entrega ao sub-projeto 5 (WhatsApp)

O template submetido ao Meta usa parâmetros **posicionais** (`{{1}}`, `{{2}}`); aqui as variáveis são **nomeadas**. A tradução é trabalho do sub-projeto 5, e foi escolha consciente: `{{nome_lead}}` é legível para quem escreve o script e `{{1}}` não é.

O que o sub-projeto 5 herda pronto: o catálogo de variáveis, `interpolar` e `textoPlano` (o disparo real usa o mesmo texto que o `wa.me` usa hoje), a biblioteca com `stage_id`, e `tasks.tipo = 'whatsapp'` como o lugar natural para pendurar o disparo agendado.

## 10. Critério de aceite

**Plano 7.** Um vendedor abre um lead, agenda "Ligar para negociar" para amanhã às 14h, e a tarefa aparece em `/tarefas` sob "Próximos 7 dias" com o nome do lead. Uma tarefa de ontem aparece sob "Atrasadas" e o badge da navegação a conta. Ele conclui: some da lista, o badge desce, e a timeline do lead passa a contar "Tarefa concluída". Um segundo vendedor, na mesma conta, **não vê nenhuma dessas tarefas** em `/tarefas`. O admin vê as dele por padrão, e chega às dos outros pelo filtro. E `npm test` coleta pelo menos um `.test.tsx`.

**Plano 8.** Um gestor cria em `/scripts/novo` um script de abertura amarrado à etapa Qualificação, com tags e uma menção a `{{empresa}}`. Um vendedor abre um lead do Meta que está em Qualificação e **não tem empresa**: o script aparece no painel, o `{{empresa}}` está destacado como lacuna, o aviso diz "1 variável sem valor", e o texto copiado traz o `{{empresa}}` literal — não um buraco. O botão de WhatsApp abre a conversa com o texto; num lead sem telefone, ele está desabilitado. O mesmo vendedor não consegue editar nem excluir o script.

**Nos dois:** suíte verde no resultado do merge, depois de `npx supabase db reset` — unitários, integração, E2E, typecheck, lint e build. Todo teste novo com RED demonstrado antes do verde.

## 11. Disciplina de plano

A lição se repetiu quatro vezes: quase todo achado grave dos reviews era defeito do **plano**, transcrito fielmente pelo implementador. Os dois planos derivados desta spec seguem o que o review final do Plano 3 recomendou:

- **Código literal só onde a forma exata é carga estrutural** — corpo de policy, o `with check` de `stage_da_conta`, o DDL das duas tabelas. O resto vira assinatura mais invariantes, com o implementador escrevendo sob TDD.
- **Preflight mecanizado:** extrair todo bloco ` ```ts ` do plano e rodar `tsc --noEmit`, mais `git check-ignore` em todo caminho citado.
- **Nenhuma contagem de teste dentro do plano.** O portão diz "suíte verde e todo teste novo com RED demonstrado", nunca um número.
- **Instrução defensiva cobre todos os sítios que nomeiam a coisa**, não o mais óbvio — foi assim que o `v_evento` ficou lendo chave aposentada no Plano 5.
- Review de contexto fresco por task, e review de branch inteira antes do merge. Os três defeitos mais graves do Plano 6 só eram visíveis juntando tasks diferentes.
