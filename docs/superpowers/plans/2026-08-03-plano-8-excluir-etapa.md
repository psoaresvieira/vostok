# Plano 8 — Excluir etapa do funil

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin exclui uma etapa do funil de verdade — a linha sai do banco — e os números de `/metricas` do passado continuam exatamente os mesmos, porque o histórico passa a carregar seu próprio snapshot de `nome`/`ordem`/`tipo`.

**Architecture:** Três migrations. A `0016` põe colunas de snapshot em `stage_history` e `lead_tags`, preenchidas por **trigger `before insert`** (o primeiro deste repositório — desvio consciente, ver §Global) e retroativamente por uma função de backfill que fica no schema como ferramenta de reparo; as FKs para `stages` viram `on delete set null`. A `0017` reescreve as duas RPCs de métricas para ler o snapshot em vez de `join` em `stages` — é o que transforma "apagar etapa reescreve o passado em silêncio" em "apagar etapa não muda nada". A `0018` cria `excluir_etapa` (três guardas, depois apaga), `reordenar_etapas` (paga a dívida da reordenação sem transação) e `resumo_etapas` (contagens que o diálogo mostra) — todas `security invoker`, porque `definer` desligaria a RLS que isola as contas. Acima disso: `AdminStore` ganha dois métodos, `reordenarEtapas` passa a chamar a RPC, e a tela ganha Excluir com diálogo e o feedback de "salvo" no renomear.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Supabase (Postgres/RLS) + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-03-crm-excluir-etapa-design.md`. As seis decisões de produto estão fechadas lá — não reabra nenhuma.

**Correção de nome sobre a spec:** a spec chama a primeira RPC de métricas de `metricas_funil`; o nome real em `0014_metricas.sql` é **`metricas_coorte`**. Este plano usa os nomes reais. Nada mais muda.

## Global Constraints

- **`grant` explícito em toda função nova.** O default ACL do schema `public` nesta imagem (Postgres 17.6) dá a `anon`/`authenticated` só `Dxtm`. Sem `grant execute`, a chamada morre em `permission denied` antes de a RLS ser avaliada.
- **`npx supabase`, nunca `supabase`.** O binário não está no PATH desta máquina.
- **Nenhuma mensagem crua do PostgREST na tela.** Toda Server Action devolve código conhecido, traduzido no mapa de erro da rota (`config/erros.ts`).
- **Toda Server Action chamada de componente cliente passa por `chamarAcao`** (`@/lib/ui/acao`).
- **Este plano introduz os primeiros triggers do repositório** (dois, um por tabela de histórico). É desvio consciente de convenção, decidido na spec §4.1: as duas tabelas aceitam `insert` direto do cliente, então snapshot preenchido "pela aplicação" viraria linha inconsistente no primeiro caminho esquecido — e snapshot é exatamente o dado que ninguém confere depois. **Não** aproveite a viagem para criar trigger de `atualizado_em` nem de mais nada.
- **As RPCs novas são `security invoker`, e isso é o inverso do hábito.** A RLS de `stages` é o que impede um membro de apagar etapa de outra conta; `definer` a desligaria, porque as tabelas são de `postgres` e nenhuma migration usa `force row level security`.
- **As guardas vivem dentro da RPC, não na tela.** As funções são alcançáveis direto pelo PostgREST; guarda que mora só na interface não é guarda.
- **Nenhuma contagem de teste aparece neste plano.** O portão de cada task é "suíte verde e todo teste novo com RED demonstrado".
- **Componente novo com teste: `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` registrado à mão** — o vitest deste repo não roda com `globals: true`, e sem o registro o `document` persiste entre os `it()` e o arquivo falha de forma intermitente a partir do segundo `render()`.

### Sobre a forma deste plano — leia antes de começar

Cinco vezes neste projeto, quase todo achado grave de review foi **defeito do plano**, transcrito fielmente pelo implementador. Então este plano é deliberadamente assimétrico, na forma que quebrou esse padrão no Plano 7:

- **Literal, para copiar como está:** o DDL, os triggers, as policies, os `grant`, os corpos das RPCs. A forma exata é carga estrutural — uma guarda reescrita "com o mesmo sentido" é uma falha silenciosa.
- **Assinatura + invariantes + casos de teste nomeados, para você escrever sob TDD:** todo o TypeScript. As assinaturas são normativas (outras tasks dependem delas). Os corpos são seus.

Onde um caso de teste está nomeado, ele é obrigatório, e o texto diz **o que ele afirma** e **o que tem que quebrar para ele ficar vermelho**. Se um teste seu passar de primeira sem você ter visto o vermelho, ele não conta: quebre o comportamento de propósito, veja o vermelho, reverta.

**Branch:** crie `plano-8-excluir-etapa` a partir de `master` antes da Task 1. Merge em `master` só depois do review de branch inteira.

---

## Task 1: Migration `0016` — snapshot por trigger, backfill e FKs `on delete set null`

**Files:**
- Create: `supabase/migrations/0016_snapshot_etapas.sql`
- Create: `tests/integration/0016_snapshot_etapas.test.ts`

**Interfaces:**
- Consumes: `public.stages`, `public.stage_history`, `public.lead_tags` (`0002`/`0003`); helpers `montarCenario`, `etapa`, `criarLead` (`tests/integration/helpers/cenario.ts`), `comoServico`, `comoUsuario` (`helpers/db.ts`)
- Produces: as seis colunas de snapshot em `stage_history` e as três em `lead_tags`, sempre preenchidas; FKs que viram `null` quando a etapa morre; `public.backfill_snapshot_etapas()` como ferramenta de reparo. As Tasks 2 e 3 dependem de tudo isso.

O que esta task **não** faz: nenhuma RPC muda. Entre esta task e a próxima, `metricas_coorte`/`metricas_etiquetas` continuam fazendo `join` em `stages` — inofensivo, porque nada apaga etapa antes da Task 3 existir.

- [ ] **Step 1: Escrever o teste de integração**

Crie `tests/integration/0016_snapshot_etapas.test.ts`, na forma de `0015_tarefas.test.ts` (cenário montado uma vez em `beforeAll`, `limparBanco` antes). Casos obrigatórios:

1. **O trigger preenche o snapshot num insert direto em `stage_history` — e sobrescreve o que o cliente mandar.** Como `vendedorAId`, insira uma linha em `stage_history` para um lead dele **fornecendo valores errados de snapshot** (`stage_destino_nome: 'MENTIRA'`). Releia pelo serviço: o snapshot tem que ter o `nome`/`ordem`/`tipo` reais da etapa referenciada. Fica vermelho se o trigger respeitar o valor do cliente em vez de derivar — a consistência tem que ser definicional, não convencional.
2. **`stage_origem` nulo deixa o snapshot de origem nulo.** Insira (pelo serviço) linha com `stage_origem = null` — é a forma que `ingerir_lead` grava o nascimento do lead. Os três campos `stage_origem_*` ficam nulos; os `stage_destino_*` vêm preenchidos.
3. **O trigger preenche `lead_tags` num insert direto.** Como `vendedorAId`, insira uma `lead_tags` (crie a tag pelo serviço antes) e releia: `stage_nome_no_momento`/`stage_ordem_no_momento`/`stage_tipo_no_momento` batem com a etapa.
4. **`stage_destino` nulo no insert é recusado com `etapa_invalida`.** O relaxamento do `not null` da coluna existe para o `on delete set null`, não para o cliente — quem insere tem que dizer de que etapa fala.
5. **Etapa de outra conta é recusada.** Monte uma segunda conta (`criarUsuario` + `criar_conta`, como `0008_fontes_conectadas.test.ts` faz). Como `vendedorAId`, insira `stage_history` num lead da conta A apontando `stage_destino` para uma etapa da conta B. Tem que falhar com `etapa_invalida` — o trigger é `security invoker` e a RLS de `stages` não deixa o vendedor da conta A enxergar a etapa da B. Antes desta migration essa linha inconsistente **era aceita**; o teste também documenta o endurecimento.
6. **`backfill_snapshot_etapas` reconstrói snapshot corrompido.** Crie histórico real (mova um lead com `move_lead_stage` via `comoUsuario`), depois, **pelo serviço**, corrompa: `update stage_history set stage_destino_nome = 'CORROMPIDO'` e o mesmo numa `lead_tags`. Chame `select public.backfill_snapshot_etapas()` pelo serviço e releia: os valores reais voltaram. É o único jeito honesto de testar o backfill — ele roda uma vez sobre dados que um banco recém-resetado não tem; a função nomeada o torna re-executável e, de quebra, vira o caminho de reparo se um dia uma linha nascer errada.
7. **`backfill_snapshot_etapas` não é executável por `authenticated`.** Como `vendedorAId`, `select public.backfill_snapshot_etapas()` tem que falhar com permission denied. A função é `security definer` (precisa varrer contas de todo mundo para reparar) — executável por qualquer sessão, seria um jeito de qualquer usuário disparar escrita global.
8. **Apagar a etapa preserva o snapshot e anula a FK.** Crie uma etapa descartável (pelo serviço: `insert into stages` com `ordem` alta), mova um lead por ela e de volta, aplique uma etiqueta nela (insert direto em `lead_tags` com `stage_id_no_momento` dela), e então **apague a etapa pelo serviço** (`delete from stages where id = ...` — o serviço ignora RLS e ainda não há guardas; elas são da Task 3). Releia: `stage_history.stage_origem`/`stage_destino` que apontavam para ela viraram `null`, `lead_tags.stage_id_no_momento` idem, e **todos os snapshots continuam com os valores da etapa morta**.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm run test:integration -- 0016
```

Esperado: FAIL — `column "stage_destino_nome" does not exist`.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0016_snapshot_etapas.sql`:

```sql
-- Sub-projeto "excluir etapa" (Plano 8). O historico passa a carregar seu
-- proprio snapshot de nome/ordem/tipo da etapa, porque as duas RPCs de
-- /metricas recalculam profundidade a cada leitura fazendo join em stages:
-- apagar uma etapa nao mudaria o futuro, reescreveria o passado — sem erro e
-- sem log (guarda silenciosa nº 5). A fonte de verdade do passado vira o
-- snapshot; a FK vira um atalho para a etapa viva.
--
-- Estes sao os primeiros triggers do repositorio, e o desvio e consciente:
-- stage_history e lead_tags aceitam insert DIRETO de authenticated (policies
-- em 0003_leads.sql), entao snapshot escrito "pela aplicacao" dependeria de
-- todo caminho presente e futuro lembrar de escrever — e um caminho esquecido
-- criaria linha com nome de uma etapa e id de outra, que nada detectaria,
-- porque snapshot e exatamente o dado que ninguem confere depois. O trigger
-- torna a consistencia definicional em vez de convencional.

alter table public.stage_history
  add column stage_origem_nome text,
  add column stage_origem_ordem integer,
  add column stage_origem_tipo public.stage_tipo,
  add column stage_destino_nome text,
  add column stage_destino_ordem integer,
  add column stage_destino_tipo public.stage_tipo;

alter table public.lead_tags
  add column stage_nome_no_momento text,
  add column stage_ordem_no_momento integer,
  add column stage_tipo_no_momento public.stage_tipo;

-- SECURITY INVOKER de proposito (e o default; escrito para ficar dito): a
-- leitura de stages dentro do trigger passa pela RLS de quem insere. Um
-- insert apontando para etapa de outra conta nao acha a linha e cai no
-- etapa_invalida — antes desta migration, essa linha inconsistente era aceita.
create or replace function public.snapshot_stage_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage_destino is null then
    -- O drop not null de stage_destino (mais abaixo) existe para o
    -- on delete set null, nao para o cliente: quem insere tem que dizer de
    -- que etapa fala.
    raise exception 'etapa_invalida';
  end if;

  select s.nome, s.ordem, s.tipo
    into new.stage_destino_nome, new.stage_destino_ordem, new.stage_destino_tipo
    from public.stages s
   where s.id = new.stage_destino;
  if not found then
    raise exception 'etapa_invalida';
  end if;

  if new.stage_origem is not null then
    select s.nome, s.ordem, s.tipo
      into new.stage_origem_nome, new.stage_origem_ordem, new.stage_origem_tipo
      from public.stages s
     where s.id = new.stage_origem;
    if not found then
      raise exception 'etapa_invalida';
    end if;
  else
    new.stage_origem_nome := null;
    new.stage_origem_ordem := null;
    new.stage_origem_tipo := null;
  end if;

  return new;
end;
$$;

create or replace function public.snapshot_lead_tags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage_id_no_momento is null then
    raise exception 'etapa_invalida';
  end if;

  select s.nome, s.ordem, s.tipo
    into new.stage_nome_no_momento, new.stage_ordem_no_momento, new.stage_tipo_no_momento
    from public.stages s
   where s.id = new.stage_id_no_momento;
  if not found then
    raise exception 'etapa_invalida';
  end if;

  return new;
end;
$$;

-- BEFORE INSERT apenas: as duas tabelas nao tem policy de update (0003), e o
-- update interno do ON DELETE SET NULL nao dispara trigger de insert — que e
-- exatamente o que se quer: a FK vira null e o snapshot fica.
create trigger stage_history_snapshot
  before insert on public.stage_history
  for each row execute function public.snapshot_stage_history();

create trigger lead_tags_snapshot
  before insert on public.lead_tags
  for each row execute function public.snapshot_lead_tags();

-- Backfill como funcao nomeada, e nao update solto na migration, por dois
-- motivos: (1) e testavel — um banco recem-resetado nao tem dado pre-migration
-- para o teste exercitar, mas a funcao pode ser chamada de novo sobre dado
-- corrompido de proposito; (2) vira a ferramenta de reparo se um dia uma linha
-- nascer errada. SECURITY DEFINER porque repara contas de todo mundo; por isso
-- mesmo, execute e revogado de quem nao e operador.
create or replace function public.backfill_snapshot_etapas()
returns void
language sql
security definer
set search_path = public
as $$
  update public.stage_history sh
     set stage_origem_nome  = s.nome,
         stage_origem_ordem = s.ordem,
         stage_origem_tipo  = s.tipo
    from public.stages s
   where s.id = sh.stage_origem;

  update public.stage_history sh
     set stage_destino_nome  = s.nome,
         stage_destino_ordem = s.ordem,
         stage_destino_tipo  = s.tipo
    from public.stages s
   where s.id = sh.stage_destino;

  update public.lead_tags lt
     set stage_nome_no_momento  = s.nome,
         stage_ordem_no_momento = s.ordem,
         stage_tipo_no_momento  = s.tipo
    from public.stages s
   where s.id = lt.stage_id_no_momento;
$$;

revoke execute on function public.backfill_snapshot_etapas() from public, anon, authenticated;

select public.backfill_snapshot_etapas();

-- A invariante que o not null da FK garantia — toda linha de historico sabe de
-- qual etapa fala — muda de coluna: passa a ser o not null do snapshot.
-- Antes do set not null, o backfill acima ja preencheu toda linha existente
-- (a FK NO ACTION garantiu ate aqui que a etapa referenciada existe).
alter table public.stage_history
  alter column stage_destino_nome set not null,
  alter column stage_destino_ordem set not null,
  alter column stage_destino_tipo set not null;

alter table public.lead_tags
  alter column stage_nome_no_momento set not null,
  alter column stage_ordem_no_momento set not null,
  alter column stage_tipo_no_momento set not null;

-- Nulo passa a significar "essa etapa foi excluida" — nao "dado faltando".
-- leads.stage_id NAO muda: continua not null e NO ACTION, porque a guarda de
-- excluir_etapa (0018) impede a exclusao chegar la, e a FK e o backstop dela.
alter table public.stage_history alter column stage_destino drop not null;
alter table public.lead_tags alter column stage_id_no_momento drop not null;

alter table public.stage_history
  drop constraint stage_history_stage_origem_fkey,
  add constraint stage_history_stage_origem_fkey
    foreign key (stage_origem) references public.stages(id) on delete set null;

alter table public.stage_history
  drop constraint stage_history_stage_destino_fkey,
  add constraint stage_history_stage_destino_fkey
    foreign key (stage_destino) references public.stages(id) on delete set null;

alter table public.lead_tags
  drop constraint lead_tags_stage_id_no_momento_fkey,
  add constraint lead_tags_stage_id_no_momento_fkey
    foreign key (stage_id_no_momento) references public.stages(id) on delete set null;
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0016
```

Esperado: PASS em todos os casos.

- [ ] **Step 5: Experimento de discriminação no caso 1**

No corpo de `snapshot_stage_history`, troque a derivação do destino por um respeito ao valor do cliente:

```sql
if new.stage_destino_nome is null then
  select s.nome ... into ...
end if;
```

(isto é, só derive quando o cliente não mandou nada). Rode `npm run db:reset && npm run test:integration -- 0016`. **O caso 1 tem que ficar vermelho** — `'MENTIRA'` sobreviveria. Reverta.

- [ ] **Step 6: Suíte inteira — os escritores existentes continuam de pé**

```bash
npm run test:integration && npm test && npm run typecheck
```

`move_lead_stage`, `ingerir_lead` e `aplicarEtiquetas` inserem nas duas tabelas sem nomear as colunas novas — o trigger as preenche. Se algum teste existente quebrar, o defeito é da migration, não do teste.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0016_snapshot_etapas.sql tests/integration/0016_snapshot_etapas.test.ts
git commit -m "feat: snapshot de etapa em stage_history e lead_tags, por trigger, com backfill e FKs set null"
```

---

## Task 2: Migration `0017` — as métricas leem o snapshot

**Files:**
- Create: `supabase/migrations/0017_metricas_snapshot.sql`
- Create: `tests/integration/0017_metricas_snapshot.test.ts`
- Modify: `src/lib/domain/metricas.ts` (tipo `AplicacaoEtiqueta`)
- Modify: `src/lib/data/supabase.ts` (`etiquetasDaCoorte`, cast das linhas)
- Modify: `src/lib/domain/metricas.test.ts` (um caso novo)

**Interfaces:**
- Consumes: colunas de snapshot da Task 1
- Produces: `metricas_coorte` e `metricas_etiquetas` imunes a exclusão de etapa; `AplicacaoEtiqueta.stageIdNoMomento` vira `string | null`. A Task 3 pode apagar etapas sem reescrever o passado.

**A mudança de tipo em TypeScript é obrigatória e pequena:** com o `on delete set null`, `metricas_etiquetas` passa a poder devolver `stage_id_no_momento` nulo. Em `metricas.ts`, `AplicacaoEtiqueta.stageIdNoMomento: string | null`; em `supabase.ts`, o cast interno de `etiquetasDaCoorte` idem. O consumo já é seguro — `etiquetasPorEtapa` compara `a.stageIdNoMomento !== etapa.id` e `null` nunca é igual a um id — mas isso precisa de teste, não de fé: acrescente a `metricas.test.ts` o caso nomeado **"aplicação com stageIdNoMomento nulo não conta em etapa nenhuma"** — uma aplicação com `stageIdNoMomento: null` e um ranking calculado para cada etapa viva; nenhum numerador a inclui. Fica vermelho se alguém um dia trocar a comparação por `startsWith`, coalesce ou qualquer coisa que trate `null` como coringa.

- [ ] **Step 1: Escrever o teste de integração — o teste que sustenta a parte cara**

Crie `tests/integration/0017_metricas_snapshot.test.ts`. Siga a forma de `0014_metricas.test.ts` para chamar as RPCs (`select * from public.metricas_coorte(...)` via `comoUsuario(adminId)`).

Cenário base, montado uma vez: dois leads na etapa "Novo lead"; mova o lead 1 até "Qualificação" (ordem 3) com `move_lead_stage` via `comoUsuario`, aplique nele uma etiqueta com `stage_id_no_momento` = "Qualificação" (insert direto em `lead_tags`, com tag criada pelo serviço), e traga-o de volta para "Contato feito" (ordem 2). Mova o lead 2 para "Perdido" (com `motivoId`). Janela da coorte: `p_de` antes da criação, `p_ate` depois.

Casos obrigatórios:

1. **Excluir a etapa não muda `ordem_max` de ninguém.** Capture o resultado de `metricas_coorte` (mapa `lead_id → ordem_max`; o lead 1 tem que estar com `ordem_max = 3`). Apague "Qualificação" **pelo serviço** (mova antes, pelo serviço, qualquer lead que estivesse nela — aqui nenhum está). Chame de novo: **o mapa inteiro é idêntico**, lead a lead. Sem o snapshot, o `max` colapsaria para 2 em silêncio — este caso é a razão de ser do plano inteiro.
2. **Excluir a etapa não muda o ranking de etiquetas.** Capture `metricas_etiquetas` antes e depois da mesma exclusão: a linha da etiqueta do lead 1 continua existindo, com `ordem_no_momento = 3` — e `stage_id_no_momento` agora nulo. Antes, o `inner join` fazia a linha inteira desaparecer.
3. **Lead perdido continua sem profundidade máxima.** O lead 2 (em "Perdido") tem `ordem_max` igual à maior etapa **aberta** que ocupou — não 7. O filtro `tipo = 'aberta'` agora vem do snapshot; este caso fica vermelho se o filtro cair na reescrita.
4. **A união ainda inclui a etapa atual.** Um lead 3 criado direto numa etapa funda (nasce em "Proposta", ordem 4, via `criarLead`, **sem** nenhuma movimentação — logo sem linha de histórico) sai com `ordem_max = 4`. Prova que o braço `leads.stage_id → stages` sobreviveu à reescrita. (É o cego que o Plano 6 encontrou: lead que *nasce* fundo, em vez de mover, é o que discrimina.)
5. **O recorte por papel não mudou.** `metricas_coorte` como `vendedorAId` devolve só os leads dele; como `adminId`, todos. As funções continuam `security invoker` — há teste de `prosecdef` na Task 3 para as novas; aqui o comportamento basta.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm run db:reset && npm run test:integration -- 0017
```

Esperado: FAIL nos casos 1 e 2 — as RPCs atuais ainda fazem `join` em `stages`, então a exclusão muda os números (caso 1) e engole a linha da etiqueta (caso 2). Este vermelho é a demonstração ao vivo da guarda silenciosa nº 5; olhe para ele antes de seguir.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0017_metricas_snapshot.sql`:

```sql
-- As duas leituras de /metricas deixam de fazer join em stages e passam a ler
-- o snapshot da 0016. Antes, apagar uma etapa reescrevia o passado em
-- silencio: o max() de metricas_coorte colapsava e o inner join de
-- metricas_etiquetas engolia a linha. Agora o passado e do snapshot; stages
-- so responde pela etapa ATUAL do lead, que a guarda de excluir_etapa (0018)
-- garante existir.
--
-- Mesmas assinaturas, mesmo SECURITY INVOKER e pelo mesmo motivo de 0014:
-- o recorte por papel e o que pode_ver_lead ja faz, e definer o desligaria.

create or replace function public.metricas_coorte(
  p_pipeline_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_responsavel_id uuid default null
)
returns table (
  lead_id uuid,
  criado_em timestamptz,
  origem public.lead_origem,
  status public.lead_status,
  responsavel_id uuid,
  campanha_id text,
  campanha_nome text,
  conjunto_id text,
  conjunto_nome text,
  anuncio_id text,
  anuncio_nome text,
  ordem_max integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.criado_em,
    l.origem,
    l.status,
    l.responsavel_id,
    l.campanha_id,
    l.campanha_nome,
    l.conjunto_id,
    l.conjunto_nome,
    l.anuncio_id,
    l.anuncio_nome,
    -- A uniao das etapas que o lead JA ocupou: origem e destino de todo
    -- movimento (pelo SNAPSHOT — a etapa pode nao existir mais) e a etapa
    -- atual (por stages — esta existe, a guarda de excluir_etapa impede a
    -- exclusao com lead dentro). O comentario da 0014 dizia que a uniao "e
    -- completa sem backfill nenhum"; desde a 0016 isso NAO e mais verdade —
    -- o backfill da 0016 e pre-requisito destas leituras.
    --
    -- O filtro por tipo 'aberta' NAO e detalhe: Ganho e Perdido tem ordem
    -- maior que toda etapa aberta. Sem ele, todo lead perdido sairia com a
    -- profundidade maxima do funil. Para o historico o tipo vem do snapshot,
    -- congelado no momento do movimento.
    --
    -- coalesce 0: lead que nunca ocupou etapa aberta entra no total da coorte
    -- e em nenhum degrau.
    coalesce((
      select max(f.ordem)
        from (
          select sh.stage_origem_ordem as ordem
            from public.stage_history sh
           where sh.lead_id = l.id
             and sh.stage_origem_tipo = 'aberta'
          union all
          select sh.stage_destino_ordem
            from public.stage_history sh
           where sh.lead_id = l.id
             and sh.stage_destino_tipo = 'aberta'
          union all
          select s.ordem
            from public.stages s
           where s.id = l.stage_id
             and s.tipo = 'aberta'
        ) f
    ), 0)::integer
  from public.leads l
  where l.pipeline_id = p_pipeline_id
    -- Semiaberto: dois periodos adjacentes nunca contam o mesmo lead duas vezes.
    and l.criado_em >= p_de
    and l.criado_em < p_ate
    and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

create or replace function public.metricas_etiquetas(
  p_pipeline_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_responsavel_id uuid default null
)
returns table (
  lead_id uuid,
  tag_id uuid,
  tag_nome text,
  stage_id_no_momento uuid,
  ordem_no_momento integer
)
language sql
stable
security invoker
set search_path = public
as $$
  -- O join em stages sumiu, e com ele o modo de falha: a ordem vem do
  -- snapshot, e stage_id_no_momento pode vir nulo — significa "a etapa foi
  -- excluida", e o dominio ja trata null como "nao pertence a etapa nenhuma".
  select lt.lead_id, t.id, t.nome, lt.stage_id_no_momento, lt.stage_ordem_no_momento
    from public.lead_tags lt
    join public.tags t on t.id = lt.tag_id
    join public.leads l on l.id = lt.lead_id
   where l.pipeline_id = p_pipeline_id
     and l.criado_em >= p_de
     and l.criado_em < p_ate
     and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

-- Mesmas assinaturas de 0014, entao create or replace substitui de verdade
-- (nao cria sobrecarga) e os grants existentes sobrevivem. Reafirmados por
-- clareza — o custo e zero e a leitura da migration fica autossuficiente.
grant execute on function public.metricas_coorte(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.metricas_etiquetas(uuid, timestamptz, timestamptz, uuid) to authenticated;
```

Uma diferença deliberada e inofensiva a registrar no commit: a versão de `0014` só contava etapa do histórico se ela pertencesse a `l.pipeline_id`; o snapshot não guarda pipeline, então o filtro sai. Hoje toda conta tem exatamente um pipeline (índice `pipelines_um_padrao_por_conta`, e `criar_conta` cria um só; não há UI de segundo pipeline), e `move_lead_stage` já valida a conta da etapa — o histórico de um lead não tem como apontar para pipeline alheio.

- [ ] **Step 4: Ajustar os tipos e ver o verde**

Faça a mudança de tipo descrita no cabeçalho da task (`metricas.ts`, `supabase.ts`) e o caso novo de `metricas.test.ts`. **Atenção ao vermelho deste caso:** o vitest roda via esbuild e não checa tipos, então o caso comportamental **passa de primeira** — `etiquetasPorEtapa` já trata `null` corretamente por construção. O que fica vermelho antes da mudança de tipo é o `npm run typecheck` (o literal `null` não é atribuível a `stageIdNoMomento: string`). Como o caso passou sem vermelho comportamental, o experimento de discriminação dele é obrigatório: troque a guarda de `etiquetasPorEtapa` por uma que trate `null` como coringa — `if (a.stageIdNoMomento !== null && a.stageIdNoMomento !== etapa.id) continue` — e rode `npm test -- metricas`. **O caso tem que ficar vermelho** (a aplicação nula passaria a contar em toda etapa). Reverta.

```bash
npm run db:reset && npm run test:integration -- 0017 && npm run test:integration -- 0014 && npm test -- metricas
```

Esperado: PASS. A suíte da `0014` continua de pé — as assinaturas não mudaram e os comportamentos antigos (janela semiaberta, recorte por papel, coalesce 0) têm que sobreviver à reescrita.

- [ ] **Step 5: Experimento de discriminação no caso 3**

Na `0017`, remova `and sh.stage_destino_tipo = 'aberta'` do segundo braço da união. `npm run db:reset && npm run test:integration -- 0017`. **O caso 3 tem que ficar vermelho** — o lead perdido ganharia a profundidade do movimento para "Perdido". Reverta.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add supabase/migrations/0017_metricas_snapshot.sql tests/integration/0017_metricas_snapshot.test.ts src/lib/domain/metricas.ts src/lib/domain/metricas.test.ts src/lib/data/supabase.ts
git commit -m "feat: metricas leem o snapshot — excluir etapa deixa de reescrever o passado"
```

---

## Task 3: Migration `0018` — `excluir_etapa`, `reordenar_etapas` e `resumo_etapas`

**Files:**
- Create: `supabase/migrations/0018_excluir_reordenar_etapas.sql`
- Create: `tests/integration/0018_excluir_reordenar_etapas.test.ts`

**Interfaces:**
- Consumes: snapshot e FKs da Task 1; `public.conta_do_pipeline` (`0002`), `public.papel_na_conta` (`0001`)
- Produces: as três RPCs. A Task 4 as chama pelo `AdminStore`.

Os códigos de erro que as funções levantam — normativos, a Task 4 os mapeia: `etapa_nao_encontrada`, `sem_permissao`, `etapa_tem_leads`, `ultima_etapa_do_tipo`, `ordem_invalida`.

- [ ] **Step 1: Escrever o teste de integração**

Crie `tests/integration/0018_excluir_reordenar_etapas.test.ts`. Além do cenário padrão, monte uma **segunda conta** (como `0008` faz) para os casos de isolamento. Casos obrigatórios:

**De `excluir_etapa`:**

1. **Admin exclui etapa vazia e ela some.** Crie uma etapa descartável (pelo serviço, `ordem` alta, tipo `aberta`), chame `select public.excluir_etapa($1)` como `adminId`, e afirme que a linha sumiu de `stages`.
2. **Etapa com lead dentro é recusada com `etapa_tem_leads` — e continua existindo.** Afirme as duas coisas; a segunda é o que separa recusa de falha silenciosa.
3. **A última etapa de um tipo é recusada com `ultima_etapa_do_tipo`.** O pipeline padrão tem uma etapa `ganho` só ("Ganho", sem leads) — tente excluí-la. Sem etapa `aberta`, a ingestão do Meta/Google não teria onde pôr lead; a guarda vale para os três tipos.
4. **Vendedor é recusado com `sem_permissao` — a mesma chamada, com os mesmos argumentos, que funciona para o admin.** Crie uma etapa descartável, chame como `vendedorAId` (recusa, linha continua), chame como `adminId` (some). É o teste de discriminação por papel: um papel só passaria com a guarda desligada.
5. **Admin de outra conta recebe `etapa_nao_encontrada`.** A RLS de `stages` nem deixa ver a linha — o erro é "não existe", não "sem permissão", e isso é deliberado: não vaza que o id existe.

**De `reordenar_etapas`:**

6. **Permutação válida aplica a ordem — e o pipeline continua com ordens `1..n` distintas.** Inverta duas etapas como `adminId` e releia as ordens.
7. **Lista parcial é recusada com `ordem_invalida` e nenhuma ordem muda.** Mande só 3 dos 7 ids e afirme que as ordens ficaram exatamente como estavam — inclusive **nenhuma na faixa 1000+**. Este caso é o que prova que a dívida foi paga: a implementação antiga em JS deixava linhas na faixa alta quando falhava no meio.
8. **Id repetido é recusado com `ordem_invalida`.** 7 posições, uma duplicada.
9. **Vendedor é recusado com `sem_permissao`.** Sem isto, a chamada do vendedor validaria a permutação (ele enxerga as etapas), os updates afetariam zero linhas pela RLS, e a função devolveria sucesso **mentindo** — o guard existe para transformar o no-op silencioso em erro.
10. **Ids de outra conta são recusados com `ordem_invalida`.** O admin da conta B manda os ids da conta A: invisíveis pela RLS, a checagem de permutação não fecha.

**De `resumo_etapas`:**

11. **As contagens contam o que dizem contar.** Na conta A: um lead parado em "Contato feito" e outro que passou por ela e seguiu adiante. `resumo_etapas(pipelineId)` como admin devolve, para "Contato feito", `leads_na_etapa = 1` e `leads_passaram = 2`. Para uma etapa nunca usada, `0` e `0`.

**Das três:**

12. **`prosecdef = false` nas três.** `select proname, prosecdef from pg_proc where proname in ('excluir_etapa', 'reordenar_etapas', 'resumo_etapas')` — três linhas, todas `false`. Uma letra de diferença no DDL desligaria a RLS sem nenhum erro visível; este teste transforma a convenção em asserção.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm run test:integration -- 0018
```

Esperado: FAIL — `function public.excluir_etapa(uuid) does not exist`.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0018_excluir_reordenar_etapas.sql`:

```sql
-- As guardas vivem AQUI, nao na tela: as funcoes sao alcancaveis direto pelo
-- PostgREST, e guarda que mora so na interface nao e guarda.
--
-- SECURITY INVOKER nas tres, e e o inverso do habito: definer desligaria a
-- RLS de stages (as tabelas sao de postgres, nenhuma migration usa force row
-- level security) e qualquer membro apagaria etapa de outra conta. O teste de
-- prosecdef em 0018_*.test.ts transforma essa letra em asserção.

create or replace function public.excluir_etapa(p_stage_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stage public.stages;
  v_leads bigint;
  v_mesmo_tipo bigint;
begin
  -- Leitura SEM lock primeiro, de proposito: sob RLS, SELECT ... FOR UPDATE
  -- exige que a linha passe TAMBEM pela policy de update (stages_admin_write,
  -- admin-only) — com o lock aqui, o vendedor nunca alcancaria o guard de
  -- papel logo abaixo e receberia "nao existe" para uma etapa que ele enxerga
  -- na tela. Quem nao enxerga a linha nem por select (outra conta) recebe
  -- "nao existe" — e nao "sem permissao", de proposito: nao vaza que o id e
  -- real.
  select * into v_stage from public.stages where id = p_stage_id;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- O select acima passa para qualquer membro (stages_select e is_member_of);
  -- sem este guard, o delete la embaixo afetaria zero linhas pela RLS e a
  -- funcao devolveria sucesso mentindo.
  if public.papel_na_conta(public.conta_do_pipeline(v_stage.pipeline_id)) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- Agora sim o lock: o chamador provou ser admin, entao a policy de update
  -- devolve a linha. Serializa contra outra exclusao/reordenacao da mesma
  -- etapa. A etapa pode ter sumido entre as duas leituras — dai o recheck.
  select * into v_stage from public.stages where id = p_stage_id for update;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- Guarda 1: lead dentro. Como o chamador ja provou ser admin, a RLS de
  -- leads nao esconde nada dele nesta conta. leads.stage_id continua NOT NULL
  -- e NO ACTION: se um lead entrar na etapa entre esta contagem e o delete, a
  -- FK estoura (23503) e a Task 4 traduz para o mesmo etapa_tem_leads.
  select count(*) into v_leads from public.leads l where l.stage_id = p_stage_id;
  if v_leads > 0 then
    raise exception 'etapa_tem_leads';
  end if;

  -- Guarda 2: ultima etapa do tipo. Sem etapa 'aberta' a ingestao do Meta e
  -- do Google nao teria onde por lead; a regra vale para os tres tipos.
  select count(*) into v_mesmo_tipo
    from public.stages s
   where s.pipeline_id = v_stage.pipeline_id
     and s.tipo = v_stage.tipo;
  if v_mesmo_tipo <= 1 then
    raise exception 'ultima_etapa_do_tipo';
  end if;

  -- Exclusao real. O historico sobrevive pelo snapshot da 0016; as FKs de
  -- stage_history e lead_tags viram null via on delete set null.
  delete from public.stages where id = p_stage_id;
end;
$$;

create or replace function public.reordenar_etapas(p_ids_na_ordem uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pipelines uuid[];
  v_pipeline uuid;
  v_total bigint;
  v_distintos bigint;
begin
  if p_ids_na_ordem is null or coalesce(array_length(p_ids_na_ordem, 1), 0) = 0 then
    raise exception 'ordem_invalida';
  end if;

  -- Todos os ids tem que resolver para UM pipeline visivel. Id de outra conta
  -- e invisivel pela RLS, entao cai aqui como permutacao que nao fecha.
  select array_agg(distinct s.pipeline_id) into v_pipelines
    from public.stages s
   where s.id = any (p_ids_na_ordem);
  if v_pipelines is null or array_length(v_pipelines, 1) <> 1 then
    raise exception 'ordem_invalida';
  end if;
  v_pipeline := v_pipelines[1];

  if public.papel_na_conta(public.conta_do_pipeline(v_pipeline)) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- Serializa reordenacoes concorrentes do mesmo pipeline. order by id para
  -- ordem de lock deterministica (duas concorrentes se enfileiram em vez de
  -- se abracarem em deadlock).
  perform 1 from public.stages s where s.pipeline_id = v_pipeline order by s.id for update;

  -- Permutacao EXATA: mesmo tamanho, sem repeticao, todos deste pipeline.
  -- Sem isto, lista parcial deixaria buracos e id repetido colidiria no
  -- indice unico no meio da escrita.
  select count(*) into v_total from public.stages s where s.pipeline_id = v_pipeline;
  select count(distinct x) into v_distintos from unnest(p_ids_na_ordem) as x;
  if v_total <> array_length(p_ids_na_ordem, 1)
     or v_distintos <> array_length(p_ids_na_ordem, 1) then
    raise exception 'ordem_invalida';
  end if;

  -- Duas fases DENTRO da transacao da funcao: stages_ordem_por_pipeline e um
  -- indice unico nao-deferivel, e um update que permuta valores pode colidir
  -- no meio do proprio statement. A faixa 1000+ e livre (ordens reais sao
  -- pequenas) e distinta entre si. Diferente da implementacao antiga em JS,
  -- falha em qualquer ponto desfaz TUDO — nunca sobra linha na faixa alta.
  update public.stages s
     set ordem = 1000 + t.i
    from unnest(p_ids_na_ordem) with ordinality as t(id, i)
   where s.id = t.id;

  update public.stages s
     set ordem = t.i
    from unnest(p_ids_na_ordem) with ordinality as t(id, i)
   where s.id = t.id;
end;
$$;

-- Leitura para a tela: quantos leads estao em cada etapa (a mensagem de
-- recusa mostra o numero) e quantos ja passaram por ela (o dialogo de
-- confirmacao mostra antes de excluir). SECURITY INVOKER: as contagens
-- respeitam a RLS de quem chama; a tela e admin-only e o admin enxerga a
-- conta inteira.
create or replace function public.resumo_etapas(p_pipeline_id uuid)
returns table (stage_id uuid, leads_na_etapa bigint, leads_passaram bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    (select count(*) from public.leads l where l.stage_id = s.id),
    (select count(distinct passou.lead_id)
       from (
         select sh.lead_id
           from public.stage_history sh
          where sh.stage_origem = s.id or sh.stage_destino = s.id
         union all
         select l.id from public.leads l where l.stage_id = s.id
       ) passou)
  from public.stages s
  where s.pipeline_id = p_pipeline_id;
$$;

-- Grant explicito: o default ACL do schema public nesta imagem da a
-- anon/authenticated so Dxtm. Sem isto a chamada morre em permission denied
-- antes de qualquer guarda rodar.
grant execute on function public.excluir_etapa(uuid) to authenticated;
grant execute on function public.reordenar_etapas(uuid[]) to authenticated;
grant execute on function public.resumo_etapas(uuid) to authenticated;
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0018
```

- [ ] **Step 5: Experimento de discriminação — o de `security invoker`**

Troque `security invoker` de `excluir_etapa` por `security definer`. `npm run db:reset && npm run test:integration -- 0018`. **Os casos 5 e 12 têm que ficar vermelhos** (o admin da outra conta passaria a enxergar — e excluir — a etapa alheia; `prosecdef` viraria `true`). Reverta.

Se só o 12 ficar vermelho e o 5 continuar verde, investigue antes de seguir: significa que alguma outra coisa está segurando o isolamento e o teste 5 não discrimina o que diz discriminar.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck
```

```bash
git add supabase/migrations/0018_excluir_reordenar_etapas.sql tests/integration/0018_excluir_reordenar_etapas.test.ts
git commit -m "feat: excluir_etapa com tres guardas, reordenar_etapas transacional e resumo_etapas"
```

---

## Task 4: `AdminStore` e Server Actions

**Files:**
- Modify: `src/lib/data/admin.ts`
- Modify: `src/app/(app)/config/acoes.ts`
- Modify: `src/app/(app)/config/erros.ts`
- Modify: `tests/integration/admin-store.test.ts`

**Interfaces:**
- Consumes: as três RPCs da Task 3
- Produces — normativo, consumido pela Task 5:

```ts
// src/lib/data/admin.ts
export type ResumoEtapa = {
  etapaId: string
  leadsNaEtapa: number
  leadsPassaram: number
}

export interface AdminStore {
  // ... métodos existentes inalterados ...
  excluirEtapa(etapaId: string): Promise<Resultado<void>>
  resumoEtapas(): Promise<Resultado<ResumoEtapa[]>>
}

// src/app/(app)/config/acoes.ts
export async function excluirEtapaAction(etapaId: string): Promise<Resultado<void>>
```

**Invariantes:**

- **`excluirEtapa` chama `.rpc('excluir_etapa', { p_stage_id: etapaId })` e traduz o erro para código conhecido.** Os quatro códigos que a RPC levanta (`etapa_nao_encontrada`, `sem_permissao`, `etapa_tem_leads`, `ultima_etapa_do_tipo`) chegam no `error.message` do PostgREST — case por `message.includes(codigo)`, na mesma lógica de `codigoDoErroPostgres` em `supabase.ts:465` (que é privada daquele módulo; não a exporte, repita o padrão localmente com a lista destes códigos). **Mais um caso: `error.code === '23503'` também vira `falha('etapa_tem_leads')`** — é a FK de `leads.stage_id` estourando quando um lead entra na etapa entre a contagem da guarda e o delete; para o usuário é a mesma recusa. Qualquer outro erro: `falha(error.message)` como o resto do arquivo faz.
- **`reordenarEtapas` troca o corpo inteiro por `.rpc('reordenar_etapas', { p_ids_na_ordem: idsNaOrdem })`**, mapeando `ordem_invalida` e `sem_permissao` pelo mesmo `includes`. **Apague a validação de permutação em JS, as duas fases de update e os dois comentários longos que as explicam** (`admin.ts:81-129`) — a transação agora vive na RPC, e comentário explicando código que não existe mais é o defeito "instrução defensiva escopada na unidade errada" em forma de documentação. A assinatura pública não muda; a tela não percebe.
- **`resumoEtapas` chama `.rpc('resumo_etapas', { p_pipeline_id: this.pipelineId })`** e mapeia as linhas para `ResumoEtapa[]` (os `count` chegam como `number` pelo supabase-js; se chegarem como `string` em algum driver, converta com `Number` — o teste de integração pega).
- **`excluirEtapaAction`**: mesma forma das outras actions do arquivo — `criarAdminStoreDoServidor()`, chama o port, `revalidatePath('/config')` e `revalidatePath('/funil')`.
- **`config/erros.ts` ganha os fallbacks estáticos** (a Task 5 compõe as mensagens com número/tipo no componente; o mapa cobre o caminho em que a composição não tem o dado):

```ts
etapa_nao_encontrada: 'Essa etapa não existe mais. Recarregue a página.',
etapa_tem_leads: 'Há leads nesta etapa. Mova-os antes de excluí-la.',
ultima_etapa_do_tipo: 'Esta é a última etapa deste tipo — o funil precisa de pelo menos uma.',
```

(`sem_permissao` e `ordem_invalida` já existem no mapa.)

- [ ] **Step 1: Escrever os testes de integração**

Em `tests/integration/admin-store.test.ts`, siga a forma dos testes existentes do arquivo (que constroem o store e chamam os métodos). Casos obrigatórios:

1. **`excluirEtapa` de etapa vazia devolve `ok` e a etapa some** (releia pelo serviço).
2. **`excluirEtapa` de etapa com lead devolve `falha('etapa_tem_leads')`** — o código exato, não a mensagem crua do Postgres. Fica vermelho se o mapeamento por `includes` faltar e o `error.message` inteiro vazar.
3. **`excluirEtapa` da última etapa `ganho` devolve `falha('ultima_etapa_do_tipo')`.**
4. **`reordenarEtapas` com permutação válida reordena** — mesma asserção dos testes existentes de reordenação, que devem continuar passando sem edição; se algum afirmava detalhe da implementação antiga (faixa 1000+, número de updates), ele estava testando forma e pode ser ajustado para comportamento.
5. **`reordenarEtapas` com lista parcial devolve `falha('ordem_invalida')`** e as ordens não mudam.
6. **`resumoEtapas` devolve as contagens do cenário do caso 11 da Task 3** — um lead parado, um que passou: `{ leadsNaEtapa: 1, leadsPassaram: 2 }`.

- [ ] **Step 2: Vermelho**

```bash
npm run test:integration -- admin-store
```

Esperado: FAIL — os métodos novos não existem (erro de tipo/`undefined is not a function`), e o caso 5 pode falhar diferente do esperado enquanto o corpo antigo existir.

- [ ] **Step 3: Implementar**

`admin.ts` (métodos novos + corpo novo de `reordenarEtapas`), `acoes.ts` (action nova), `erros.ts` (três chaves).

- [ ] **Step 4: Verde**

```bash
npm run test:integration -- admin-store && npm run typecheck
```

- [ ] **Step 5: Experimento de discriminação no caso 2**

Em `excluirEtapa`, troque o mapeamento por um repasse cru (`return falha(error.message)` sem o `includes`). Rode. **O caso 2 tem que ficar vermelho** se o `error.message` do PostgREST vier com qualquer coisa além do código puro; se ele continuar verde, o experimento provou que o repasse cru bastaria — registre isso no commit e mantenha o mapeamento mesmo assim, porque a forma da mensagem do PostgREST não é contrato nosso. Reverta.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/data/admin.ts "src/app/(app)/config/acoes.ts" "src/app/(app)/config/erros.ts" tests/integration/admin-store.test.ts
git commit -m "feat: excluirEtapa e resumoEtapas no AdminStore; reordenarEtapas vira RPC transacional"
```

---

## Task 5: A tela — Excluir com diálogo, mensagens com número, e o "salvo" do renomear

**Files:**
- Modify: `src/app/(app)/config/etapas.tsx`
- Create: `src/app/(app)/config/etapas.test.tsx`
- Modify: `src/app/(app)/config/page.tsx`

**Interfaces:**
- Consumes: `excluirEtapaAction` e os tipos da Task 4; `resumoEtapas` via `page.tsx`; `chamarAcao`, `mensagemDeErro`
- Produces: nada consumido por outra task.

**Comportamento — normativo:**

- `Etapas` passa a receber `resumo: ResumoEtapa[]` além de `etapas` (o `page.tsx` chama `resumoEtapas()` junto das buscas que já faz e passa para baixo; em falha da busca do resumo, passe lista vazia — a tela degrada para diálogo sem número, não derruba a config inteira).
- **Cada etapa ganha um botão Excluir.** Clicar abre um diálogo de confirmação **antes** de qualquer chamada, dizendo o que vai acontecer: o nome da etapa, quantos leads já passaram por ela (`leadsPassaram` do resumo; se não houver resumo, omita o número) e a frase de que o histórico e as métricas serão preservados. Confirmar chama `chamarAcao(excluirEtapaAction(id))`; cancelar fecha sem chamar nada.
- **Recusa fala o motivo com o dado, não o código:** `etapa_tem_leads` → "Mova os N leads desta etapa antes de excluí-la." com N = `leadsNaEtapa` do resumo (sem resumo, o fallback do mapa); `ultima_etapa_do_tipo` → "Esta é a última etapa do tipo {tipo}." com o tipo da própria etapa (o componente o tem em `e.tipo`). Os demais códigos vão direto ao `mensagemDeErro`.
- **O renomear confirma que gravou:** após o `onBlur` salvar com sucesso, um sinal visual transitório junto ao campo (ex.: "Salvo ✓"). Não aparece quando o valor não mudou (o `onBlur` de valor igual já nem chama a action — comportamento existente que deve ser preservado) nem quando a action falhou.
- Diálogo pode ser estado local + elemento condicional (o repo não tem lib de dialog e este plano não a introduz). Foco e `aria`: o botão de confirmar tem rótulo acessível distinto do de cancelar.
- **Para o teste não precisar de servidor, as ações entram por prop com default** — `excluir = excluirEtapaAction` etc. —, o mesmo arranjo que os componentes testados do Plano 7 usam.

- [ ] **Step 1: Escrever o teste de componente**

Crie `src/app/(app)/config/etapas.test.tsx`, com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` registrado à mão (ver Global Constraints; este arquivo tem vários `render()`).

Casos obrigatórios:

1. **O diálogo mostra o número de leads que passaram antes de confirmar.** Renderize com resumo `{ leadsPassaram: 12 }` para a etapa, clique em Excluir, afirme que o texto do diálogo contém `12` e o nome da etapa — e que a ação **ainda não foi chamada** (a prop de ação é um stub que registra chamadas; afirme o registro vazio). Fica vermelho se o clique excluir direto sem confirmação.
2. **Confirmar chama a ação; cancelar não.** Dois `render()`s: um confirma e o stub registra a chamada com o id certo; outro cancela e o registro continua vazio.
3. **Recusa `etapa_tem_leads` mostra a mensagem com o número.** Stub devolve `falha('etapa_tem_leads')`; com `leadsNaEtapa: 3` no resumo, o texto exibido contém "3". Afirme sobre texto, não sobre classe CSS.
4. **Recusa `ultima_etapa_do_tipo` mostra o tipo.** Stub devolve o código; a etapa é `tipo: 'ganho'`; o texto contém "ganho".
5. **Renomear com sucesso mostra a confirmação de salvo; com falha, não.** Dois `render()`s com stubs de renomear distintos.

- [ ] **Step 2: Vermelho**

```bash
npm test -- etapas
```

Esperado: FAIL — o componente não tem Excluir nem diálogo.

- [ ] **Step 3: Implementar**

`etapas.tsx` conforme o comportamento normativo; `page.tsx` busca o resumo e o injeta. O reordenar por setas fica exatamente como está.

- [ ] **Step 4: Verde**

```bash
npm test -- etapas && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Verificar no navegador — não é opcional**

```bash
npm run dev
```

Duas vezes neste projeto o olho achou o que nenhuma suíte achou. Roteiro, como admin (conta de demonstração ou uma nova):

1. Criar etapa "Engano" e excluí-la — some, com o diálogo dizendo "0 leads".
2. Tentar excluir uma etapa com leads — recusa com o número certo.
3. Tentar excluir "Ganho" — recusa dizendo o tipo.
4. Mover leads por uma etapa, abrir `/metricas` e anotar os números, voltar, mover os leads para fora, excluir a etapa, e conferir que os números de `/metricas` **não mudaram** (o degrau da etapa excluída sai da lista de degraus — a etapa não existe mais —, mas alcance e percentuais dos demais ficam idênticos).
5. Renomear uma etapa e ver o "Salvo ✓"; sair do campo sem mudar nada e **não** ver.
6. Reordenar com as setas — segue funcionando (agora pela RPC).

- [ ] **Step 6: Portão final da branch**

```bash
npm run db:reset
npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build
```

Tudo verde, rodado **depois** do reset — não só antes. Antes do E2E, derrube qualquer `npm run dev` aberto (o `reuseExistingServer` do Playwright conectaria num servidor sem `META_FAKE`).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/config/etapas.tsx" "src/app/(app)/config/etapas.test.tsx" "src/app/(app)/config/page.tsx"
git commit -m "feat: excluir etapa com dialogo e recusa explicada; feedback de salvo no renomear"
```

---

## Critério de aceite do plano

O da spec §9, na íntegra: você abre `/config`, cria uma etapa por engano e a exclui — ela some. Tenta excluir uma etapa com leads dentro e o sistema recusa dizendo quantos são. Tenta excluir a última etapa do tipo ganho e ele recusa dizendo o tipo. Exclui uma etapa antiga, por onde leads já passaram, e os números de `/metricas` do mês passado continuam exatamente os mesmos. Renomeia uma etapa e vê que gravou. Reordena e a ordem nunca fica pela metade.

Suíte verde no resultado do merge, depois de `npx supabase db reset`. Todo teste novo com RED demonstrado antes do verde.

## Review

Review de contexto fresco **por task**, e review de branch inteira antes do merge. Para o revisor de branch inteira, quatro perguntas que exigem ver mais de uma task junta:

1. **Existe algum escritor de `stage_history` ou `lead_tags` que escape dos triggers?** (`COPY`, um futuro `insert` em migration, `session_replication_role` — o trigger cobre `insert` de qualquer papel, mas não cobre quem o desligar.) E o `backfill_snapshot_etapas` continua não-executável por `authenticated`?
2. **As duas RPCs de métricas leem `stages` em exatamente um lugar cada** (a etapa atual do lead em `metricas_coorte`; nenhum em `metricas_etiquetas`)? Qualquer outro `join` em `stages` reintroduz a guarda silenciosa que este plano existe para matar.
3. **A tela compõe as mensagens com números do `resumo_etapas`, que podem estar defasados do erro que a RPC devolveu** (outro admin moveu leads no meio). A recusa continua fazendo sentido nesse caso — o código do erro manda, o número só ilustra?
4. **`reordenarEtapas` não deixou rastro da implementação antiga** — nem validação duplicada em JS, nem comentário descrevendo as duas fases no lugar errado, nem teste afirmando a faixa 1000+?
