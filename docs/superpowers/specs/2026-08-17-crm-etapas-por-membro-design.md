# Etapas por membro + hardening de stages — design

Data: 2026-08-17
Status: aprovado em conversa; aguardando revisão do spec escrito

## Objetivo

Fechar o risco v1 aceito no merge do Plano 14 e, junto, resolver a assimetria
que ele criou: qualquer membro cria pipelines com etapas, mas as etapas,
depois de criadas, só podem ser gerenciadas por admin — e só as da pipeline
padrão (a config resolve `is_default = true` fixo, defeito herdado). Este
plano abre a gestão de etapas (criar, renomear, reordenar, excluir) a todo
membro, move a UI para o funil operando na pipeline ativa, e endurece a RLS
de `stages` para que os invariantes do produto sobrevivam a PostgREST cru.

## Decisões tomadas (com Pedro)

1. **Caminho B**: hardening + abertura da gestão de etapas para membro (não
   só o hardening).
2. **A gestão mora no funil**: botão «Editar etapas» junto à barra de
   pipelines, operando na pipeline ativa, visível a todo membro. A seção
   Etapas **sai** do `/config`, que segue admin-only com Motivos, Usuários,
   Integrações e WhatsApp.
3. **Guardas na RLS via helpers `security definer`** (mesma forma da 0025),
   não triggers nem RPC-only: as RPCs continuam dando erros nomeados limpos e
   a policy é o backstop contra PostgREST cru.

## O buraco que o hardening fecha

- `stages_membro_write` (`for all`, 0025) deixa qualquer membro, via
  PostgREST cru, apagar/alterar etapas sem passar pela RPC `excluir_etapa` —
  inclusive apagar a última etapa `aberta` de uma pipeline (a ingestão
  Meta/Google não teria onde pôr lead) ou trocar `tipo`/`pipeline_id` de uma
  etapa por update direto (corrompe funil, métricas e o snapshot da 0016).
  As guardas da 0018 vivem só dentro da RPC; antes da 0025 eram
  backstopeadas pela RLS admin-only, que morreu.
- `pipeline_tem_leads` é `security definer` com grant a `authenticated` e
  não checa membership: qualquer usuário logado sonda se uma pipeline de
  outra conta tem leads (boolean cross-account).

## Fora de escopo (v1)

- Mover lead entre pipelines; métricas por pipeline; pipeline de destino por
  fonte (mesmos "fora" do Plano 14).
- Papéis finos (ex.: só gestor edita etapas) — decisão do Plano 14 foi
  "todo membro", etapas seguem a mesma régua.
- Trocar `tipo` de etapa existente pela UI — nenhuma tela faz isso hoje e o
  hardening passa a proibir também por baixo.

## Banco (migration `0026_etapas_por_membro.sql`)

### Helpers `security definer`

Todos `stable`, `set search_path = public`, com revoke de PUBLIC + grant a
`authenticated`, e entrada no mapa do teste de grants da 0024. Definer é
obrigatório e não conveniência: subquery de `stages` dentro de policy de
`stages` recursaria (RLS reentrando na própria tabela), e subquery de
`leads` rodaria sob a RLS do chamador — o ponto cego do vendedor que o
review do Plano 14 pegou em `excluirPipeline`.

- `pipeline_tem_leads(p_pipeline_id)` — **muda**: ganha guarda de membership
  fail-closed. Não-membro recebe `true` ("tem leads" → recusa exclusão),
  resposta constante que fecha a sonda cross-account sem quebrar a policy
  `pipelines_membro_delete` (que já exige `is_member_of` na própria
  cláusula).
- `etapa_tem_leads(p_stage_id)` — novo, mesma forma fail-closed: não-membro
  da conta da etapa recebe `true`; membro recebe se existe lead com
  `stage_id` na etapa, enxergando a conta inteira (leads de colegas
  incluídos).
- `etapa_ultima_do_tipo(p_stage_id)` — novo, fail-closed (`true` para
  não-membro e para etapa inexistente): conta etapas do mesmo
  `pipeline_id`+`tipo` e responde se a etapa é a última do seu tipo.
- `etapa_imutaveis_ok(p_stage_id, p_tipo, p_pipeline_id)` — novo: lê a linha
  atual e responde se `tipo` e `pipeline_id` propostos são iguais aos
  atuais. Linha inexistente → `null` → o `with check` recusa.

### Policies de `stages`

`stages_membro_write` (`for all`) morre e vira três:

- `stages_membro_insert`: `with check (is_member_of(conta_do_pipeline(pipeline_id)))`
  — como hoje; o modal de criação de pipeline e o «Adicionar etapa»
  continuam funcionando.
- `stages_membro_update`: `using` com membership; `with check` com
  membership **e** `etapa_imutaveis_ok(id, tipo, pipeline_id)` — troca de
  tipo ou mudança de pipeline via PostgREST cru estoura 42501 (violação de
  with check levanta erro, diferente do using). Renomear (`nome`) e
  reordenar (`ordem`, via RPC invoker) passam intactos.
- `stages_membro_delete`: `using` com membership **e**
  `not etapa_ultima_do_tipo(id)` — apagar a última etapa de um tipo via
  PostgREST cru vira no-op silencioso de 0 linhas (semântica de using em
  delete). Etapa com leads dentro não precisa de guarda na policy: a FK
  `leads.stage_id` é `NOT NULL`/`NO ACTION` e estoura 23503 antes.
- *(emenda de 2026-08-17, achado do review da Task 1)* A policy de delete
  sozinha **não segura delete em lote**: o `using` avalia linha a linha
  contra o snapshot do statement, então `delete ... where tipo = 'aberta'`
  apaga todas as abertas num statement só. Entra um **trigger de statement**
  (`after delete ... referencing old table`, o primeiro trigger de
  statement do repo) que
  aborta com `ultima_etapa_do_tipo` se alguma pipeline afetada ficou sem
  etapas de um tipo que tinha — exceto quando a própria pipeline sumiu no
  mesmo statement (o cascade legítimo de `excluirPipeline`). E
  `etapa_imutaveis_ok` também ganha `is_member_of` (fail-closed): sem ele,
  devolvia o booleano real para não-membro — oráculo cross-account.

### RPCs (recriadas na 0026)

- `excluir_etapa`: guarda de papel troca de `= 'admin'` para
  `is_member_of(...)`; a guarda 1 (lead dentro) troca a contagem sob RLS do
  chamador por `etapa_tem_leads(p_stage_id)` — sob a RLS do vendedor a
  contagem mentiria zero para etapa cheia de leads de colegas e a função só
  seria salva pelo 23503 da FK; com o helper a recusa volta a ser a nomeada
  `etapa_tem_leads`. Resto do corpo (lock, recheck, guarda de última do
  tipo, delete) inalterado; continua `security invoker`.
- `reordenar_etapas`: guarda de papel troca para `is_member_of(...)`. Resto
  inalterado; continua `security invoker`.
- `resumo_etapas`: vira `security definer` **com guarda explícita de
  membership** (não-membro da conta da pipeline recebe conjunto vazio, sem
  erro — mesma não-resposta de pipeline inexistente). Motivo: o diálogo de
  exclusão mostra os números ao membro, e sob a RLS do vendedor os números
  esconderiam leads de colegas — a recusa `etapa_tem_leads` diria "tem
  leads" enquanto o diálogo mostra 0. É exposição de contagens agregadas ao
  membro da conta, mesma classe do boolean de `pipeline_tem_leads`.

Conferir contra o checklist de guardas silenciosas antes de finalizar
(grants, search_path, definer/invoker, revokes, teto de recursão de policy).

## Backend TS

- **`EtapaStore` novo** (`src/lib/data/etapas.ts`): os cinco métodos de
  etapa saem do `AdminStore` — `criarEtapa`, `renomearEtapa`,
  `excluirEtapa`, `reordenarEtapas`, `resumoEtapas` — parametrizados por
  `pipelineId` no construtor, **sem exigência de papel** no resolvedor
  (`criarEtapaStoreDoServidor(pipelineId)`: só sessão — sem resolução de
  conta ativa, texto corrigido por emenda; id de pipeline de outra conta
  morre na RLS/RPC, não em código de autorização novo). Tradução de erros
  (`codigoDoErroDeEtapa`, 23503→`etapa_tem_leads`) vai junto. *(emenda
  pós-review-final)* `criarEtapa` ganha a tradução que faltava — era o
  único método devolvendo erro cru do Postgres, alcançável pela tela nova:
  `23503 → nao_encontrado` (pipeline sumiu noutra aba) e `23505 →
  ordem_invalida` (dois membros adicionando ao mesmo tempo colidem no
  índice único de ordem).
- **`AdminStore` encolhe**: perde os cinco métodos e a resolução de
  pipeline padrão no `criarAdminStoreDoServidor` (o parâmetro `pipelineId`
  do construtor morre). Motivos, convites e membros ficam.
- **Actions novas** em `funil/acoes-etapas.ts`: `criarEtapaAction`,
  `renomearEtapaAction`, `excluirEtapaAction`, `reordenarEtapasAction`,
  recebendo a pipeline ativa do form/argumento — mesmo padrão de
  `acoes-pipelines.ts` (cliente manda ids; RLS decide). `revalidatePath`
  de `/funil` (o `/config` não mostra mais etapas). As equivalentes de
  `config/acoes.ts` morrem.

## Frontend

- **Funil**: botão «Editar etapas» junto à barra de pipelines (todo membro),
  abre painel com o componente `Etapas` movido de `config/etapas.tsx` para
  `funil/etapas.tsx` — mesma UI (renomear inline com "Salvo ✓", ↑↓, excluir
  com diálogo e números do resumo, adicionar com tipo), operando na pipeline
  ativa. O `page.tsx` do funil passa a carregar `resumoEtapas` da pipeline
  ativa (degrada para diálogo sem número em falha, como hoje no config).
- **Config**: perde a seção Etapas, o import e as chamadas
  (`resumoEtapas`, `pipelinePadrao` para etapas). Resto intacto,
  admin-only como hoje.

## Erros

Nenhum código novo: `etapa_tem_leads`, `ultima_etapa_do_tipo`,
`etapa_nao_encontrada`, `ordem_invalida`, `sem_permissao`,
`nome_obrigatorio`, `nao_encontrado` já existem e mantêm as frases. O
dicionário de mensagens (`config/erros.ts`) move/expande para o funil junto
com o componente.

## Testes

- **Integração SQL** (a parte que paga o plano):
  - vendedor via update cru: trocar `tipo` → 42501; trocar `pipeline_id`
    (mesmo dentro da conta) → 42501; renomear → passa.
  - vendedor via delete cru: última `aberta` → 0 linhas e a etapa continua
    lá; etapa não-última sem leads → apaga (produto permite).
  - sondas cross-account: `pipeline_tem_leads`, `etapa_tem_leads` e
    `etapa_ultima_do_tipo` chamados por usuário de outra conta devolvem a
    constante fail-closed.
  - `excluir_etapa` por vendedor: etapa vazia → apaga; etapa onde **só um
    colega** tem lead → recusa nomeada `etapa_tem_leads` (o teste do ponto
    cego); última do tipo → `ultima_etapa_do_tipo`.
  - `reordenar_etapas` e renomear por vendedor → funcionam.
  - `resumo_etapas` por vendedor → números da conta inteira (lead do colega
    conta); por não-membro → vazio.
  - mapa de grants da 0024 ganha os helpers novos; prosecdef dos helpers e
    do `resumo_etapas` asserido (e das duas RPCs, que continuam invoker).
- **Componente**: painel de etapas no funil renderiza e chama as actions
  novas com a pipeline ativa; config não renderiza mais a seção.
- **E2E**: membro abre «Editar etapas» no funil numa pipeline não-padrão,
  renomeia e adiciona etapa, vê o quadro refletir; exclusão recusada com a
  mensagem certa quando há lead.

## Preview antes do merge

Todo o trabalho em branch `plano-15-etapas-membro`. Antes de qualquer merge:
suítes completas + demonstração local; push da branch gera preview na Vercel
se Pedro quiser ver. Migration 0026 vai ao staging via `npx supabase db push`
só junto do merge (o staging serve a produção). Merge só depois do OK.
