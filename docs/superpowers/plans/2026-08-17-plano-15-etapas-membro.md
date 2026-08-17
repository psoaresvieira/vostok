# Plano 15 — Etapas por membro + hardening de stages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualquer membro gerencia as etapas da pipeline ativa pelo funil (criar, renomear, reordenar, excluir), e a RLS de `stages` passa a sustentar os invariantes do produto contra PostgREST cru (tipo e pipeline imutáveis, última etapa do tipo não apagável, sondas cross-account fechadas).

**Architecture:** Migration `0026` refaz as guardas: helpers `security definer` fail-closed, policy de `stages` dividida em insert/update/delete com invariantes nas cláusulas, RPCs de etapa abertas a membro (a guarda 1 de `excluir_etapa` via helper definer — a contagem sob RLS do chamador mentiria para vendedor), `resumo_etapas` vira definer com guarda de membership. No app, os métodos de etapa saem do `AdminStore` para um `EtapaStore` parametrizado por pipeline, as actions vão para o funil, e o componente de etapas migra de `/config` para um painel «Editar etapas» na coluna de pipelines do funil.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase/Postgres com RLS, Vitest + Testing Library, Playwright, vitest.integration contra Postgres local.

**Spec:** `docs/superpowers/specs/2026-08-17-crm-etapas-por-membro-design.md` — ler antes de começar qualquer task.

## Global Constraints

- **Forma assimétrica deste plano:** SQL de migration é LITERAL (copiar como está). Todo TypeScript é dado por assinatura + invariantes + casos de teste nomeados; o corpo é seu, sob TDD estrito (RED demonstrado antes de GREEN). Onde um caso de teste é nomeado, o texto diz o que ele afirma e o que tem que quebrar para ficar vermelho.
- Nunca declarar contagem de testes; o portão é "suíte verde e todo teste novo com RED demonstrado".
- Todo o trabalho na branch `plano-15-etapas-membro` (já existe, com a spec commitada). **Nenhum merge para master** — Pedro decide depois de ver.
- Códigos de erro em snake_case pt; mensagens em pt-BR num dicionário local (nunca erro cru na tela). Nenhum código novo neste plano — reusar os existentes.
- Fora de escopo (não implementar nada disso): mover lead entre pipelines; métricas por pipeline; pipeline por fonte; trocar `tipo` de etapa existente pela UI; papéis finos para etapas.
- Comandos de verificação: `npm test` (unidade), `npm run test:integration` (exige Supabase local; `npm run db:reset` aplica migrations), `npm run test:e2e`, `npm run typecheck`, `npm run lint`.

---

### Task 0: Pré-condição

- [ ] **Step 1:** `git checkout plano-15-etapas-membro` e conferir `git status` limpo.
- [ ] **Step 2:** `npm test` e `npm run test:integration` verdes antes de qualquer mudança (integração exige o stack local: `npx supabase start` + `npm run db:reset` se preciso).

---

### Task 1: Migration 0026 — helpers fail-closed, policies de stages, RPCs por membro

**Files:**
- Create: `supabase/migrations/0026_etapas_por_membro.sql`
- Create: `tests/integration/0026_etapas_por_membro.test.ts`
- Modify: `tests/integration/0018_excluir_reordenar_etapas.test.ts` (casos 4, 9 e 12 afirmam comportamento revogado)
- Modify: `tests/integration/0024_sweep_grants_rpc.test.ts` (mapa ganha os 3 helpers novos)

**Interfaces:**
- Produces: funções `public.etapa_tem_leads(uuid)`, `public.etapa_ultima_do_tipo(uuid)`, `public.etapa_imutaveis_ok(uuid, stage_tipo, uuid)`; `pipeline_tem_leads` fail-closed; policies `stages_membro_insert/update/delete`; RPCs `excluir_etapa`/`reordenar_etapas` chamáveis por qualquer membro; `resumo_etapas` definer com guarda de membership. As Tasks 2–3 dependem de: membro consegue renomear/reordenar/excluir etapa via as mesmas chamadas que antes exigiam admin, com os mesmos códigos de erro.

- [ ] **Step 1: RED — teste de integração primeiro.** Escrever `0026_etapas_por_membro.test.ts` com os helpers de `tests/integration/helpers` (`montarCenario`, `comoUsuario`, `comoServico`, `criarLead`, `etapa`). Para os casos cross-account, montar uma segunda conta no padrão da função `segundaConta` de `0018_excluir_reordenar_etapas.test.ts` (usuário novo + membership de admin via `comoServico`). Casos nomeados:
  1. **vendedor renomeia etapa via update cru** — `update stages set nome = 'X' where id = $1` por `vendedorAId` afeta 1 linha. Vermelho hoje? NÃO — a 0025 já deixa (a policy for all não restringe colunas); o caso existe como guarda de regressão do split: se o `with check` novo recusar renome, ele fica vermelho.
  2. **vendedor NÃO troca tipo via update cru** — `update stages set tipo = 'ganho' where id = <aberta>` por vendedor rejeita com erro de RLS (42501, "violates row-level security"). Vermelho hoje: a 0025 deixa passar.
  3. **vendedor NÃO move etapa para outra pipeline via update cru** — criar segunda pipeline na MESMA conta (inserts diretos por vendedor, permitidos desde a 0025); `update stages set pipeline_id = <outra>` → 42501. Vermelho hoje.
  4. **vendedor NÃO apaga a última etapa de um tipo via delete cru** — `delete from stages where id = <ganho>` (só existe uma `ganho` no cenário) afeta **0 linhas** e a etapa continua lá (semântica de `using` em delete é no-op, não erro). Vermelho hoje: a 0025 apaga.
  5. **vendedor apaga etapa aberta não-última e vazia via delete cru** — afeta 1 linha (decisão de produto: membro pode; o caso protege contra um hardening largo demais).
  6. **sondas cross-account devolvem a constante fail-closed** — admin da conta B chama `select public.pipeline_tem_leads($1)`, `select public.etapa_tem_leads($1)` e `select public.etapa_ultima_do_tipo($1)` com ids da conta A: as três devolvem `true`, tanto para pipeline/etapa COM leads quanto SEM (dois sub-casos por função — resposta constante é o que fecha a sonda; fica vermelho se alguém "simplificar" o helper tirando o `is_member_of`).
  7. **excluir_etapa por vendedor: etapa vazia some** — a mesma chamada que o caso 4 da 0018 afirmava recusar com `sem_permissao`. Vermelho hoje.
  8. **excluir_etapa por vendedor recusa `etapa_tem_leads` quando só um COLEGA tem lead na etapa** — lead do `vendedorBId` na etapa (via `criarLead`), `excluir_etapa` chamado por `vendedorAId` → exceção `etapa_tem_leads` (a nomeada, NÃO 23503 cru). É o teste do ponto cego: fica vermelho se a guarda 1 contar leads sob a RLS do chamador (a RLS de leads esconde o lead do colega, a contagem daria 0, e a recusa viria da FK com outro erro).
  9. **excluir_etapa por vendedor recusa `ultima_etapa_do_tipo`** — mesma regra de antes, agora alcançável por membro.
  10. **reordenar_etapas por vendedor funciona** — permutação válida das abertas por `vendedorAId` aplica a ordem nova. Vermelho hoje (`sem_permissao`).
  11. **resumo_etapas por vendedor conta a conta inteira** — lead do colega na etapa; `resumo_etapas` chamado por `vendedorAId` devolve `leads_na_etapa = 1` para ela. Vermelho hoje: invoker + RLS de leads escondem o lead do colega (o caso que discrimina o definer).
  12. **resumo_etapas por não-membro devolve vazio** — admin da conta B com a pipeline da conta A → zero linhas, sem erro.
  13. **prosecdef dos helpers** — `etapa_tem_leads`, `etapa_ultima_do_tipo`, `etapa_imutaveis_ok`, `pipeline_tem_leads` e `resumo_etapas` com `prosecdef = true`; `excluir_etapa` e `reordenar_etapas` com `prosecdef = false` (continuam invoker — trocar isso desligaria a RLS de stages dentro delas).
  14. *(emenda 2026-08-17)* **delete em LOTE das abertas é abortado** — `delete from stages where pipeline_id = $1 and tipo = 'aberta'` por vendedor estoura `ultima_etapa_do_tipo` (P0001) e TODAS as etapas continuam lá (statement inteiro desfeito). Fica vermelho sem o trigger de statement: a policy linha-a-linha deixa o lote passar.
  15. *(emenda 2026-08-17)* **excluir a pipeline inteira continua passando** — vendedor cria pipeline nova (sem leads) e a deleta; o cascade apaga as stages sem disparar a guarda (a condição "pipeline ainda existe" do trigger). Fica vermelho se o trigger não checar a existência da pipeline.
  16. *(emenda 2026-08-17)* **etapa_imutaveis_ok é fail-closed para não-membro** — admin da conta B chama o helper com a etapa da conta A e os valores CERTOS de tipo/pipeline: resposta `false` (a constante que recusa), não `true`. Fica vermelho com o corpo sem `is_member_of` (que devolvia o booleano real — oráculo cross-account).
- [ ] **Step 2: Rodar e ver RED.** `npm run test:integration -- 0026` — casos 2, 3, 4, 6, 7, 8*, 10, 11 e metade do 13 vermelhos (8 hoje falha porque vendedor leva `sem_permissao` antes de chegar à guarda). Registrar quais casos já passam pelo comportamento atual.
- [ ] **Step 3: Escrever a migration — SQL literal:**

```sql
-- Plano 15: gestao de etapas por membro + hardening de stages.
--
-- A 0025 abriu a escrita de stages a membro com uma policy for all sem
-- guardas — qualquer membro, via PostgREST cru, apagava a ultima etapa
-- 'aberta' (quebra a ingestao Meta/Google) ou trocava tipo/pipeline_id de
-- uma etapa (corrompe funil, metricas e o snapshot da 0016). As guardas da
-- 0018 viviam so dentro das RPCs, antes backstopeadas pela RLS admin-only
-- que a 0025 removeu. Este arquivo poe os invariantes na propria RLS e abre
-- as RPCs a qualquer membro (decisao de produto, 2026-08-17).
--
-- Helpers definer por dois motivos que nao sao conveniencia (guarda 5 da
-- memoria supabase-guardas-silenciosas): subquery de stages dentro de policy
-- de stages recursaria (RLS reentrando na propria tabela), e subquery de
-- leads rodaria sob a RLS do chamador — vendedor nao enxerga lead de colega
-- e a guarda mentiria. Fail-closed em todos: nao-membro (e id inexistente)
-- recebe a resposta que RECUSA a operacao, constante, fechando a sonda
-- cross-account de um boolean.

-- Mesma assinatura da 0025: create or replace substitui de verdade (guarda 3
-- nao se aplica — a lista de argumentos e identica).
create or replace function public.pipeline_tem_leads(p_pipeline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (not public.is_member_of(public.conta_do_pipeline(p_pipeline_id)))
      or exists (select 1 from public.leads l where l.pipeline_id = p_pipeline_id);
$$;

create or replace function public.etapa_tem_leads(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (not public.is_member_of(public.conta_do_pipeline(
            (select s.pipeline_id from public.stages s where s.id = p_stage_id))))
      or exists (select 1 from public.leads l where l.stage_id = p_stage_id);
$$;

-- coalesce(true): etapa inexistente devolve true ("e a ultima") em vez de
-- null — na policy de delete o null ja recusaria, mas a chamada direta via
-- PostgREST tambem deve responder a constante fechada.
create or replace function public.etapa_ultima_do_tipo(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (not public.is_member_of(public.conta_do_pipeline(s.pipeline_id)))
         or (select count(*)
               from public.stages irmas
              where irmas.pipeline_id = s.pipeline_id
                and irmas.tipo = s.tipo) <= 1
       from public.stages s
      where s.id = p_stage_id),
    true);
$$;

-- Compara a linha proposta (new) com a atual. O with check avalia a linha
-- NOVA; esta funcao le a tabela sob o snapshot do statement, que ainda ve a
-- versao antiga — e' exatamente a comparacao old vs new que a policy nao
-- sabe escrever sozinha. Linha inexistente (id trocado no proprio update)
-- devolve null, e null no with check recusa. O is_member_of na frente e'
-- o fail-closed: sem ele a funcao era um oraculo cross-account (devolvia o
-- booleano REAL para nao-membro, confirmando tipo e par stage/pipeline de
-- etapa alheia — achado do review da Task 1, emenda de 2026-08-17). Para
-- nao-membro a resposta agora e' a constante false, que no with check
-- recusa.
create or replace function public.etapa_imutaveis_ok(
  p_stage_id uuid,
  p_tipo public.stage_tipo,
  p_pipeline_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member_of(public.conta_do_pipeline(s.pipeline_id))
     and s.tipo = p_tipo
     and s.pipeline_id = p_pipeline_id
    from public.stages s
   where s.id = p_stage_id;
$$;

-- Guarda 7: default ACL da EXECUTE a PUBLIC em funcao nova. Revoke + grant
-- explicito, e o mapa em 0024_sweep_grants_rpc.test.ts ganha as tres
-- entradas. (pipeline_tem_leads ja tem os grants da 0025; replace de corpo
-- nao mexe em ACL.)
revoke execute on function public.etapa_tem_leads(uuid) from public;
grant execute on function public.etapa_tem_leads(uuid) to authenticated;
revoke execute on function public.etapa_ultima_do_tipo(uuid) from public;
grant execute on function public.etapa_ultima_do_tipo(uuid) to authenticated;
revoke execute on function public.etapa_imutaveis_ok(uuid, public.stage_tipo, uuid) from public;
grant execute on function public.etapa_imutaveis_ok(uuid, public.stage_tipo, uuid) to authenticated;

-- A for all da 0025 vira tres policies com os invariantes nas clausulas.
-- Violacao de with check (update) estoura 42501; delete barrado pelo using
-- e' no-op de 0 linhas — para o PostgREST cru qualquer um dos dois basta,
-- e a superficie do produto continua recebendo os erros nomeados das RPCs.
drop policy stages_membro_write on public.stages;

create policy stages_membro_insert on public.stages
  for insert with check (public.is_member_of(public.conta_do_pipeline(pipeline_id)));

create policy stages_membro_update on public.stages
  for update using (public.is_member_of(public.conta_do_pipeline(pipeline_id)))
  with check (
    public.is_member_of(public.conta_do_pipeline(pipeline_id))
    and public.etapa_imutaveis_ok(id, tipo, pipeline_id)
  );

-- Etapa com leads dentro nao precisa de guarda aqui: leads.stage_id e'
-- NOT NULL / NO ACTION e estoura 23503 antes de qualquer linha sumir.
create policy stages_membro_delete on public.stages
  for delete using (
    public.is_member_of(public.conta_do_pipeline(pipeline_id))
    and not public.etapa_ultima_do_tipo(id)
  );

-- A policy sozinha NAO segura delete em LOTE (achado do review da Task 1,
-- emenda de 2026-08-17): o using avalia linha a linha contra o snapshot do
-- statement, entao num "delete ... where tipo = 'aberta'" cada uma das N
-- abertas ainda ve as outras N-1 vivas, todas passam juntas, e a pipeline
-- fica sem etapa 'aberta' num unico statement cru — exatamente o dano que
-- este arquivo diz prevenir. O trigger de statement abaixo fecha o lote:
-- roda DEPOIS do delete, ve o estado final, e aborta se alguma pipeline
-- afetada ficou sem etapas de um tipo que ela tinha. A condicao "pipeline
-- ainda existe" deixa passar o cascade legitimo de excluir a pipeline
-- inteira (on delete cascade da 0002). Corrida entre dois deletes
-- concorrentes de etapas irmas continua teoricamente possivel (cada
-- trigger ve o uncommitted do outro como vivo) — estritamente melhor que
-- antes, registrado, fora de escopo fechar.
create or replace function public.guarda_ultima_etapa_do_tipo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from (select distinct a.pipeline_id, a.tipo from apagadas a) x
     where exists (select 1 from public.pipelines p where p.id = x.pipeline_id)
       and not exists (
         select 1
           from public.stages s
          where s.pipeline_id = x.pipeline_id
            and s.tipo = x.tipo
       )
  ) then
    raise exception 'ultima_etapa_do_tipo';
  end if;
  return null;
end;
$$;

-- Guarda 7: funcao interna (trigger nao checa EXECUTE ao disparar) — revoke
-- sem grant nenhum, e entrada { anon: false, authenticated: false } no mapa
-- da 0024.
revoke execute on function public.guarda_ultima_etapa_do_tipo() from public;

create trigger stages_guarda_ultima_do_tipo
  after delete on public.stages
  referencing old table as apagadas
  for each statement
  execute function public.guarda_ultima_etapa_do_tipo();

-- RPCs abertas a membro. Mesmas assinaturas — create or replace substitui
-- (guarda 3 nao se aplica). Continuam SECURITY INVOKER (excluir/reordenar):
-- definer desligaria a RLS de stages e qualquer membro apagaria etapa de
-- outra conta — o caso de prosecdef no teste da 0026 transforma isso em
-- assercao, como o da 0018 fazia.

create or replace function public.excluir_etapa(p_stage_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stage public.stages;
  v_mesmo_tipo bigint;
begin
  -- Leitura SEM lock primeiro, de proposito: sob RLS, SELECT ... FOR UPDATE
  -- exige que a linha passe TAMBEM pela policy de update — com o lock aqui,
  -- quem nao passa na policy receberia "nao existe" para uma etapa que
  -- enxerga na tela. Quem nao enxerga a linha nem por select (outra conta)
  -- recebe "nao existe" — e nao "sem permissao", de proposito: nao vaza que
  -- o id e' real.
  select * into v_stage from public.stages where id = p_stage_id;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- Desde a 0026 qualquer membro exclui (nao so admin). A guarda explicita
  -- fica: e' redundante com stages_select hoje, mas auto-documenta e segura
  -- o dia em que a policy de select mudar sem esta funcao acompanhar.
  if not public.is_member_of(public.conta_do_pipeline(v_stage.pipeline_id)) then
    raise exception 'sem_permissao';
  end if;

  -- Agora sim o lock: o chamador passa na policy de update (membro), entao
  -- a linha volta. Serializa contra outra exclusao/reordenacao da mesma
  -- etapa. A etapa pode ter sumido entre as duas leituras — dai o recheck.
  select * into v_stage from public.stages where id = p_stage_id for update;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- Guarda 1: lead dentro — pelo helper definer, NAO por contagem local.
  -- Sob a RLS do chamador um vendedor nao enxerga lead de colega: a
  -- contagem daria zero para etapa cheia e a recusa viria da FK como 23503
  -- cru (mesmo ponto cego que o review do Plano 14 pegou em
  -- excluirPipeline). leads.stage_id continua NOT NULL / NO ACTION: se um
  -- lead entrar entre esta checagem e o delete, a FK estoura 23503 e o
  -- store traduz para o mesmo etapa_tem_leads.
  if public.etapa_tem_leads(p_stage_id) then
    raise exception 'etapa_tem_leads';
  end if;

  -- Guarda 2: ultima etapa do tipo. Sem etapa 'aberta' a ingestao do Meta e
  -- do Google nao teria onde por lead; a regra vale para os tres tipos.
  -- (A policy de delete da 0026 repete esta guarda como backstop do caminho
  -- cru — aqui ela vive para dar o erro nomeado.)
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
  v_encontrados bigint;
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

  -- Desde a 0026 qualquer membro reordena (nao so admin). Redundante com a
  -- visibilidade acima, e deliberada — mesmo racional de excluir_etapa.
  if not public.is_member_of(public.conta_do_pipeline(v_pipeline)) then
    raise exception 'sem_permissao';
  end if;

  -- Serializa reordenacoes concorrentes do mesmo pipeline. order by id para
  -- ordem de lock deterministica (duas concorrentes se enfileiram em vez de
  -- se abracarem em deadlock).
  perform 1 from public.stages s where s.pipeline_id = v_pipeline order by s.id for update;

  -- Permutacao EXATA: mesmo tamanho, sem repeticao, e CADA id resolvendo para
  -- uma etapa deste pipeline. A terceira contagem nao e redundante com o
  -- array_agg la de cima: array_agg agrega so as linhas que casaram, entao uma
  -- lista com um id inexistente (ou invisivel pela RLS) no lugar de um real
  -- ainda resolve para um pipeline so e fecha as outras duas contagens — e o
  -- update aplicaria uma ordem que nao corresponde a lista pedida, ou
  -- estouraria 23505 cru no indice unico.
  select count(*) into v_total from public.stages s where s.pipeline_id = v_pipeline;
  select count(distinct x) into v_distintos from unnest(p_ids_na_ordem) as x;
  select count(*) into v_encontrados
    from public.stages s
   where s.id = any (p_ids_na_ordem)
     and s.pipeline_id = v_pipeline;
  if v_total <> array_length(p_ids_na_ordem, 1)
     or v_distintos <> array_length(p_ids_na_ordem, 1)
     or v_encontrados <> array_length(p_ids_na_ordem, 1) then
    raise exception 'ordem_invalida';
  end if;

  -- Duas fases DENTRO da transacao da funcao: stages_ordem_por_pipeline e um
  -- indice unico nao-deferivel, e um update que permuta valores pode colidir
  -- no meio do proprio statement. A faixa 1000+ e livre (ordens reais sao
  -- pequenas) e distinta entre si. Falha em qualquer ponto desfaz TUDO.
  -- O with check novo (etapa_imutaveis_ok) passa aqui: ordem muda, tipo e
  -- pipeline_id nao.
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

-- resumo_etapas vira DEFINER com guarda de membership — o inverso das duas
-- acima, e deliberado (dizer em voz alta, guarda 5): o dialogo de exclusao
-- mostra estes numeros a qualquer membro, e sob a RLS do vendedor a contagem
-- esconderia leads de colegas — a recusa etapa_tem_leads diria "tem leads"
-- com o dialogo mostrando 0. E' exposicao de contagens agregadas a membro da
-- conta, mesma classe do boolean de pipeline_tem_leads. Nao-membro recebe
-- conjunto vazio (a mesma nao-resposta de pipeline inexistente), nunca erro.
create or replace function public.resumo_etapas(p_pipeline_id uuid)
returns table (stage_id uuid, leads_na_etapa bigint, leads_passaram bigint)
language sql
stable
security definer
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
  where s.pipeline_id = p_pipeline_id
    and public.is_member_of(public.conta_do_pipeline(p_pipeline_id));
$$;
```

- [ ] **Step 4:** Atualizar o mapa de grants em `tests/integration/0024_sweep_grants_rpc.test.ts` — três entradas novas no bloco de helpers de RLS, com grant exatamente `{ anon: false, authenticated: true }`: `'etapa_imutaveis_ok(uuid,stage_tipo,uuid)'`, `'etapa_tem_leads(uuid)'`, `'etapa_ultima_do_tipo(uuid)'`; e uma no bloco de internas, `'guarda_ultima_etapa_do_tipo()'` com `{ anon: false, authenticated: false }` (emenda de 2026-08-17). A grafia da assinatura é a de `oid::regprocedure::text` — se o caso 1 reprovar por diferença de grafia (ex.: o enum qualificado), copiar a grafia exata que o próprio assert imprime.
- [ ] **Step 5:** Atualizar `0018_excluir_reordenar_etapas.test.ts`, citando a migration 0026 em comentário nos três: **Caso 4** (vendedor recusado em `excluir_etapa` com `sem_permissao`) agora afirma o oposto — vendedor exclui etapa vazia com sucesso; **Caso 9** (vendedor recusado em `reordenar_etapas`) — vendedor reordena com sucesso; **Caso 12** (as três funções invoker) — `excluir_etapa` e `reordenar_etapas` com `prosecdef = false`, `resumo_etapas` com `prosecdef = true`.
- [ ] **Step 6:** `npm run db:reset` e `npm run test:integration` inteiro. Esperado: 0026 verde, 0018 verde com os casos atualizados, 0024 verde com o mapa novo, 0025 verde intacta. `admin-store.test.ts` ainda passa (as chamadas de admin continuam válidas — membro inclui admin). Qualquer outro teste que afirme "vendedor não mexe em etapa" está afirmando comportamento revogado: atualizar citando a 0026.
- [ ] **Step 7:** Checklist de guardas silenciosas, dizendo em voz alta: (1) nenhum `is distinct from` novo; (2) os helpers definer só leem — nada a reafirmar; `resumo_etapas` definer reafirma membership por dentro (a cláusula `is_member_of` no where É a reafirmação); (3) todas as assinaturas idênticas às anteriores — `create or replace` substitui, sem sobrecarga; (5) definer em `resumo_etapas` é deliberado e os casos 11/12 da 0026 são o teste de discriminação; (6) nenhuma tabela nova; (7) coberto no Step 4.
- [ ] **Step 8: Commit** — `feat: migration 0026 — etapas por membro, guardas na RLS de stages e helpers fail-closed`.

---

### Task 2: EtapaStore — métodos de etapa saem do AdminStore

**Files:**
- Create: `src/lib/data/etapas.ts`
- Create: `tests/integration/etapas-store.test.ts`
- Modify: `src/lib/data/admin.ts` (encolhe)
- Modify: `tests/integration/admin-store.test.ts` (casos de etapa saem daqui)
- Modify: `src/app/(app)/config/acoes.ts` e `src/app/(app)/config/page.tsx` compilam nesta task só se a remoção for junto — ver Step 4.

**Interfaces:**
- Consumes: RPCs e policies da Task 1; `criarClienteServidor` de `@/lib/supabase/servidor`; `Resultado` de `@/lib/domain/resultado`.
- Produces (normativo — Tasks 3–5 dependem destes nomes e tipos exatos):

```ts
// src/lib/data/etapas.ts
export type ResumoEtapa = {
  etapaId: string
  leadsNaEtapa: number
  leadsPassaram: number
}

export interface EtapaStore {
  criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>>
  renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>>
  excluirEtapa(etapaId: string): Promise<Resultado<void>>
  reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>>
  resumoEtapas(): Promise<Resultado<ResumoEtapa[]>>
}

export class SupabaseEtapaStore implements EtapaStore {
  constructor(cliente: SupabaseClient, pipelineId: string)
}

export async function criarEtapaStoreDoServidor(
  pipelineId: string,
): Promise<Resultado<{ etapas: SupabaseEtapaStore }>>
```

**Invariantes:**
- Os cinco corpos são MUDANÇA DE ENDEREÇO, não de comportamento: copiar de `SupabaseAdminStore` (admin.ts) junto com `codigoDoErroDeEtapa`, `CODIGOS_CONHECIDOS_DE_ETAPA` e o tratamento `23503 → etapa_tem_leads` de `excluirEtapa`. O `pipelineId` do construtor é usado por `criarEtapa` (insert) e `resumoEtapas` (RPC) exatamente como hoje.
- `criarEtapaStoreDoServidor(pipelineId)`: sessão via `cliente.auth.getUser()` → `falha('sem_sessao')` se ausente; **sem checagem de papel e sem resolução de pipeline** — pipeline de outra conta morre na RLS/RPC (mesmo padrão de `acoes-pipelines.ts`: cliente manda ids, o banco decide).
- `admin.ts` encolhe: `AdminStore` perde os cinco métodos e o tipo `ResumoEtapa`; `SupabaseAdminStore` perde os corpos, o parâmetro `pipelineId` do construtor, `codigoDoErroDeEtapa` e `CODIGOS_CONHECIDOS_DE_ETAPA`; `criarAdminStoreDoServidor` perde a query de `pipelines` (`is_default = true`) e o código de falha `pipeline_nao_encontrado`. Motivos, convites e membros ficam intactos.
- Encolher `admin.ts` quebra a compilação de quem usa os métodos removidos — cobrir TODOS os sítios que os nomeiam (lição do plano-assimetrico): `config/acoes.ts` (as quatro actions de etapa), `config/page.tsx` (`resumoEtapas`, `pipeline.valor.etapas`, `<Etapas>`), `config/etapas.tsx` (import de `ResumoEtapa`). Nesta task, o mínimo que compila: remover as quatro actions de etapa de `config/acoes.ts`, e em `config/page.tsx` remover a chamada `resumoEtapas()`, a busca `pipelinePadrao()` e a linha `<Etapas ...>`; `config/etapas.tsx` e o teste dele serão MOVIDOS na Task 4 — até lá, trocar o import de `ResumoEtapa` para `@/lib/data/etapas` (o arquivo antigo continua no lugar, compilando, só que órfão de página).

- [ ] **Step 1: RED.** `tests/integration/etapas-store.test.ts` no padrão de `admin-store.test.ts` (cenário real + store montado com `comoUsuario`). Os casos de etapa de `admin-store.test.ts` MUDAM para cá (deletar de lá), re-encenados por **vendedor** onde eram por admin — a mudança de papel é o ponto do plano. Casos nomeados (vermelhos porque `etapas.ts` não existe):
  1. **vendedor cria etapa no fim do funil** (era o caso da linha 33 + o da 272, unificados).
  2. **reordenar não viola o índice único de ordem** e **lista não-permutação é recusada sem mexer na ordem** (eram linhas 62 e 91, agora por vendedor).
  3. **excluir etapa vazia devolve ok e a etapa some** (era 133, por vendedor).
  4. **excluir etapa com lead devolve `etapa_tem_leads`** (era 152).
  5. **excluir etapa com lead SÓ de colega devolve `etapa_tem_leads` — a nomeada, não a traduzida da FK** (evolução do caso 168: com a guarda 1 via helper definer, este caminho agora vem da exceção da RPC; o caso fica vermelho se `excluirEtapa` deixar de traduzir OU se a RPC regredir para contagem local).
  6. **excluir a última etapa do tipo ganho devolve `ultima_etapa_do_tipo`** (era 224).
  7. **resumoEtapas conta leads parados e passantes** (era 238) — por VENDEDOR, com lead de colega no meio: os números incluem o lead do colega (discrimina o definer da Task 1 na camada do store).
  8. **mutação em etapa de outra conta responde o código de "não existe"** (recorte do caso 308 para os métodos de etapa: `renomearEtapa` → `nao_encontrado`, `excluirEtapa` → `etapa_nao_encontrada`).
- [ ] **Step 2: ver RED** — `npm run test:integration -- etapas-store`.
- [ ] **Step 3: GREEN** — criar `etapas.ts`, encolher `admin.ts`, aparar `config/acoes.ts` e `config/page.tsx`, ajustar o import de `config/etapas.tsx` conforme os invariantes.
- [ ] **Step 4:** `npm run test:integration` inteiro + `npm run typecheck` + `npm test`. `admin-store.test.ts` continua verde com os casos restantes (motivos, convites, mutação cross-account dos que ficaram).
- [ ] **Step 5: Commit** — `feat: EtapaStore por pipeline; AdminStore sem etapas`.

---

### Task 3: Server actions de etapas no funil + dicionário de mensagens

**Files:**
- Create: `src/app/(app)/funil/acoes-etapas.ts` (`'use server'`)
- Modify: `src/app/(app)/funil/erros.ts`
- Test: `src/app/(app)/funil/acoes-etapas.test.ts`

**Interfaces:**
- Consumes: `criarEtapaStoreDoServidor` (Task 2).
- Produces (normativo para a Task 4):

```ts
// acoes-etapas.ts — todas com pipelineId explícito: o EtapaStore é
// construído por pipeline, e o componente sempre sabe qual está ativa.
export async function criarEtapaAction(pipelineId: string, nome: string, tipo: StageTipo): Promise<Resultado<void>>
export async function renomearEtapaAction(pipelineId: string, etapaId: string, nome: string): Promise<Resultado<void>>
export async function excluirEtapaAction(pipelineId: string, etapaId: string): Promise<Resultado<void>>
export async function reordenarEtapasAction(pipelineId: string, idsNaOrdem: string[]): Promise<Resultado<void>>

// erros.ts
export function mensagemDeEtapa(codigo: string): string
```

**Invariantes:**
- Corpos no molde das actions de etapa que saíram de `config/acoes.ts`: trim de nome, `nome_obrigatorio` para vazio (criar e renomear), repassar o código do store, e `revalidatePath('/funil')` no sucesso (só `/funil` — a config não mostra mais etapas).
- `mensagemDeEtapa`: mapa local novo em `funil/erros.ts`, separado de `MENSAGENS_ERRO` e `MENSAGENS_PIPELINE` pelo mesmo motivo documentado ali (vocabulários de actions distintas não se misturam). Entradas — copiar as frases de `config/erros.ts` hoje: `nome_obrigatorio`, `ordem_invalida`, `nao_encontrado`, `etapa_nao_encontrada`, `etapa_tem_leads`, `ultima_etapa_do_tipo`, `[FALHA_DE_CONEXAO]`; mais `sem_permissao: 'Sua sessão não tem acesso a este funil. Recarregue a página.'` (a frase antiga "Só administradores..." ficou falsa) e `sem_sessao: 'Sua sessão expirou. Entre novamente.'`. Fallback devolve o código, como os vizinhos.
- `config/erros.ts` NÃO muda nesta task (a limpeza é na Task 4, junto da remoção do componente — remover código de erro antes de remover quem o exibe deixaria a config exibindo código cru se algo regredir).

- [ ] **Step 1: RED.** Casos nomeados em `acoes-etapas.test.ts` (mock do módulo `@/lib/data/etapas` no padrão dos testes de action existentes, ex.: `acoes-pipelines.test.ts`):
  1. **criar passa nome, tipo e pipeline ao store** — `criarEtapaAction('pip-1', ' Contato ', 'aberta')` chama `criarEtapaStoreDoServidor('pip-1')` e `criarEtapa('Contato', 'aberta')` (trim provado).
  2. **nome vazio recusa sem tocar o store** — `criarEtapaAction('pip-1', '  ', 'aberta')` → `nome_obrigatorio`, store não construído (vermelho se a validação escorregar para depois).
  3. **renomear vazio recusa sem tocar o store.**
  4. **excluir repassa o código do store** — store devolve `etapa_tem_leads`; a action devolve o mesmo código.
  5. **reordenar repassa a lista intacta e na ordem.**
  6. **mensagemDeEtapa mapeia os códigos e faz fallback** — `etapa_tem_leads` vira a frase pt-BR; código desconhecido volta cru.
- [ ] **Step 2: ver RED; GREEN; `npm test`.**
- [ ] **Step 3: Commit** — `feat: actions de etapas no funil com dicionario proprio`.

---

### Task 4: Painel «Editar etapas» no funil (componente movido do config)

**Files:**
- Create: `src/app/(app)/funil/etapas.tsx` (client — nasce de `config/etapas.tsx` movido e adaptado)
- Create: `src/app/(app)/funil/etapas.test.tsx` (nasce de `config/etapas.test.tsx` movido e adaptado)
- Delete: `src/app/(app)/config/etapas.tsx`, `src/app/(app)/config/etapas.test.tsx`
- Modify: `src/app/(app)/config/page.tsx` (remover o import morto de `Etapas`, se ainda restar), `src/app/(app)/config/erros.ts`

**Interfaces:**
- Consumes: as quatro actions e `mensagemDeEtapa` (Task 3); `ResumoEtapa` (Task 2).
- Produces (a Task 5 monta com estas props):

```tsx
export function EditarEtapas({ pipelineId, etapas, resumo }: {
  pipelineId: string
  etapas: Etapa[]        // as da pipeline ativa, na ordem
  resumo: ResumoEtapa[]  // resumo_etapas da pipeline ativa; [] degrada o diálogo para sem números
})
```

**Invariantes:**
- `EditarEtapas` é um disclosure: botão «Editar etapas» (`aria-expanded` refletindo o estado) que abre/fecha o painel; fechado por padrão. O conteúdo do painel é o componente `Etapas` de hoje, inteiro: renomear inline no blur com "Salvo ✓" transitório, ↑↓ chamando `reordenarEtapasAction`, excluir com diálogo (números do resumo e as frases compostas `mensagemLeadsPassaram`/`mensagemMoverLeads`), adicionar com nome+tipo, e a disciplina `reportarErro`/`marcarSalvo` intacta (um erro novo apaga o "Salvo" antigo).
- Toda chamada de action leva `pipelineId` na frente — a adaptação é só essa costura + trocar `mensagemDeErro` (config) por `mensagemDeEtapa` (funil). As props injetáveis de teste (`renomear`, `excluir`) continuam, com as assinaturas novas.
- Limpeza em `config/erros.ts`: remover `ordem_invalida`, `etapa_nao_encontrada`, `etapa_tem_leads`, `ultima_etapa_do_tipo` (órfãos — só o componente de etapas os exibia). **Antes de remover, `grep` dos quatro códigos em `src/app/(app)/config/`** para provar que nenhum outro componente da config os consome; `nome_obrigatorio` e `nao_encontrado` FICAM (motivos e convites usam).

- [ ] **Step 1: RED.** Mover o teste, adaptar, e acrescentar os casos novos. Casos nomeados (os herdados continuam valendo; os novos):
  1. **fechado por padrão e abre no clique** — sem o clique, o input de renomear não está no DOM; após, está (vermelho enquanto o disclosure não existe).
  2. **actions recebem a pipeline** — renomear no blur chama `renomear('pip-1', etapaId, nome)`; ↑ chama `reordenarEtapasAction` com `('pip-1', ids)` (vermelho enquanto a costura não passa o id).
  3. **recusa mostra a frase do dicionário do funil** — excluir devolvendo `ultima_etapa_do_tipo` mostra a frase com o tipo, nunca o código cru (herdado, re-afirmado contra `mensagemDeEtapa`).
- [ ] **Step 2: ver RED; GREEN; `npm test` inteiro** (o teste antigo de `config/etapas` já não existe — conferir que nenhum outro teste importava o módulo apagado).
- [ ] **Step 3:** `npm run typecheck` e `npm run lint`.
- [ ] **Step 4: Commit** — `feat: painel Editar etapas no funil; config sem etapas`.

---

### Task 5: Fiação — página do funil carrega resumo e monta o painel

**Files:**
- Modify: `src/app/(app)/funil/page.tsx`

**Interfaces:**
- Consumes: `EditarEtapas` (Task 4); `criarEtapaStoreDoServidor` (Task 2).

**Invariantes:**
- Na coluna da esquerda, abaixo de `<NovaPipeline />` (mesmo `div` com `border-r`): `<EditarEtapas pipelineId={...} etapas={pipeline.valor.etapas} resumo={resumo} />` — sempre visível (todo papel), operando na pipeline ativa que a página já resolveu.
- `resumo`: `criarEtapaStoreDoServidor(pipeline.valor.pipeline.id)` + `resumoEtapas()`; **qualquer falha degrada para `[]`** em vez de derrubar a página — mesmo racional documentado em `config/page.tsx` (o resumo só alimenta números de diálogo, não é dado estrutural do funil).
- Nenhuma outra mudança na página: filtros, quadro, novo lead e barra intactos.

- [ ] **Step 1:** Implementar a fiação. A página é server component coberta por E2E (padrão do projeto — o Plano 14 fez igual); o RED desta task é o passo 1 do E2E da Task 6 se preferir encadear, ou seguir direto: a mudança é declarativa e os componentes já têm teste próprio.
- [ ] **Step 2:** `npm test`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** — `feat: funil monta Editar etapas da pipeline ativa com resumo`.

---

### Task 6: E2E

**Files:**
- Create: `tests/e2e/etapas-membro.spec.ts` (login e navegação no padrão de `tests/e2e/pipelines.spec.ts`)

- [ ] **Step 1: RED.** Fluxo único e encadeado (a suíte é serial de propósito — ver `playwright.config.ts`):
  1. **criar pipeline e abrir o painel** — criar uma pipeline 'Renovação' com 2 abertas (pelo modal que já existe); clicar «Editar etapas»; o painel lista as 4 etapas dela (2 abertas + Ganho + Perdido).
  2. **renomear etapa reflete no quadro** — renomear a primeira aberta para 'Primeiro contato'; o heading da coluna do quadro muda.
  3. **adicionar etapa aparece no quadro** — adicionar 'Negociação' tipo aberta; vira coluna nova.
  4. **exclusão recusada com lead dentro** — criar lead na primeira etapa (botão da página); tentar excluir essa etapa; a frase de `etapa_tem_leads` aparece e a coluna continua.
  5. **exclusão de etapa vazia some do quadro** — excluir 'Negociação' (vazia); a coluna some.
- [ ] **Step 2:** ver RED (o botão não existia no início da branch), depois GREEN — este spec não deve exigir código novo de produto; se exigir, o defeito é de uma task anterior: consertar lá.
- [ ] **Step 3:** `npm run test:e2e` inteiro — provar que o painel novo na coluna esquerda não quebrou o drag do quadro nem os specs de pipelines/funil existentes.
- [ ] **Step 4: Commit** — `test: E2E de gestao de etapas pelo funil`.

---

### Task 7: Verificação final + preview para Pedro

- [ ] **Step 1:** Rodar tudo, na ordem: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`. Qualquer vermelho: consertar antes de seguir (superpowers:verification-before-completion).
- [ ] **Step 2:** `git log --oneline master..plano-15-etapas-membro` — conferir que cada task virou commit e nada ficou fora.
- [ ] **Step 3:** Subir a branch: `git push -u origin plano-15-etapas-membro`. **NÃO fazer merge; NÃO aplicar a 0026 no staging** — o staging serve a produção e o push da migration é decisão do Pedro na hora do merge.
- [ ] **Step 4:** Avisar Pedro: demonstração local com `npm run dev` (entrar como vendedor, editar etapas de uma pipeline não-padrão, ver recusas) e o preview deployment da branch na Vercel — lembrando que o preview aponta para o staging SEM a 0026, então o fluxo novo de etapas se comporta off-spec lá (vendedor recusado): a demonstração fiel é a local.
