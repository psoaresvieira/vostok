# Plano 4 — Ingestão de leads e notificações (sub-projeto 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** o lead preenchido no anúncio do Meta ou do Google cai sozinho no funil da conta certa, atribuído ao responsável configurado, com o sino acendendo na tela do vendedor — e a mesma pessoa preenchendo de novo vira aviso na timeline do card que já existe, não card duplicado.

**Architecture:** log primeiro, interpreta depois. A rota de webhook valida a origem, grava o payload cru em `integration_log` por uma RPC `security definer` gateada num segredo de ingestão, e responde 200 **antes** de qualquer chamada externa. O `after()` do Next processa: busca o lead no Graph (Meta) ou usa o corpo (Google), mapeia, e chama `ingerir_lead`, que numa transação faz dedup contra lead aberto, cria (ou não) o card, grava evento, notifica e fecha o log. Um cron varre o que ficou pendente ou falhou, com backoff. Nenhuma chave privilegiada entra no projeto: `service_role` continua sem uso.

**Tech Stack:** Next.js 15.5.22 (App Router, Route Handlers, `after()`), React 19, TypeScript, Supabase (Postgres 17.6, RLS, Realtime), Vitest, Playwright, Vercel Cron.

---

## Global Constraints

Toda task herda estas regras. Violá-las é motivo de reprovação no review, mesmo que a task passe nos testes.

- **Nenhum teste automatizado faz requisição de rede.** Meta e Google são ports com implementação falsa. A única classe que faz `fetch` é `MetaGraphReal`, e ela só é exercitada com o `fetch` global substituído. Verificação contra o provedor real é manual, documentada, em deploy de preview ou túnel.
- **Zero uso de `service_role`.** Nenhuma chave privilegiada no código da aplicação, em nenhum ambiente. Escrita sem sessão passa por função `security definer` gateada no segredo de ingestão.
- **`INGESTAO_SEGREDO` é configuração de operador, não dado de tenant.** Nenhuma tela o escreve, nenhuma RPC exposta o escreve. Em desenvolvimento entra pelo `supabase/seed.sql`; em produção por SQL no painel. Não reintroduza `definir_segredo_ingestao` (a razão está em `0008_fontes_conectadas.sql:69-82`).
- **Toda migration nova precisa de `grant` explícito para `authenticated`.** Nesta versão do `supabase/postgres` (17.6) o default ACL do schema `public` dá a `anon`/`authenticated` só `Dxtm`; sem grant o erro é `permission denied` e a RLS nem chega a ser avaliada.
- **Componente cliente nunca copia prop do servidor para `useState`.** Derive a cada render. A regra existe por dois bugs reais (`quadro.tsx` no Plano 2, `integracoes.tsx` no Plano 3).
- **Erro nunca chega cru na tela.** Código estável traduzido em `config/erros.ts` ou `funil/erros.ts`. Nunca case texto de mensagem do Postgres para detectar negação de RLS — use `erro.code === '42501'` (decisão da Task 4 do Plano 3, `supabase.ts:398-413`).
- **Asserção negativa só é segura quando uma asserção positiva que só vale no estado pós-mudança já passou sobre a mesma subárvore.** Vale para `toHaveCount(0)`, `not.toBeVisible` e `toBeHidden`: no Playwright elas resolvem na primeira observação que passa, e podem correr na frente do bug que existem para pegar.
- **Teste comportamental vence teste de forma da chamada.** Não espione o query builder do Supabase. Quando precisar provar que algo **não** foi chamado, asseverar sobre o estado do duplo (`MetaGraphFalso.listadas`, `.assinadas`), nunca com spy.
- **Nenhum portão deste plano cita contagem de teste.** Contagem é fato derivado que envelhece sozinho — foi corrigida quatro vezes no Plano 3. O portão é: suíte verde, e todo teste novo com RED demonstrado antes do verde.
- **Use `npx supabase ...`.** O binário `supabase` não está no PATH desta máquina.
- **Antes de rodar E2E, derrube qualquer `npm run dev` aberto.** `reuseExistingServer: true` se conecta a um servidor que subiu sem `META_FAKE`, e aí o teste tenta alcançar o Graph de verdade.

### Convenções de código já estabelecidas (siga, não reinvente)

| Convenção | Onde está o precedente |
|---|---|
| Todo acesso a dado atrás de um port com `Resultado<T>` | `src/lib/data/store.ts`, `src/lib/data/fontes.ts` |
| Nomes de domínio em português, colunas do banco em `snake_case` | todo o repo |
| Função `security definer` sempre com `set search_path = public` | `0001`..`0008` |
| Erro de negócio como `raise exception '<codigo_estavel>'` | `0004`, `0008` |
| Test double registra o que foi chamado, em vez de spy | `src/lib/integracoes/meta-falso.ts` |

---

## Preflight mecanizado (o controlador roda ANTES de despachar a Task 1)

O padrão de defeito mais caro do Plano 3 foi bloco de código dentro do plano: código-fonte que nenhum compilador, linter ou teste jamais roda, e que o implementador transcreve como se fosse normativo. Chegaram ao repo por essa via um `TS2554`, um `*/` órfão, anotações de tipo obsoletas, um nome de arquivo silenciosamente gitignorado, e dois defeitos que violavam constraint global do próprio plano.

Este plano responde de três formas, e as três são obrigatórias:

1. **Código TypeScript literal só onde a forma exata é carga estrutural.** O resto do plano dá assinatura, invariantes e a lista de casos de teste; o implementador escreve o código sob TDD. Corpo de função `security definer` continua literal — ali a forma exata *é* o entregável, e é onde nenhum dos defeitos do Plano 3 aconteceu.
2. **Toda contagem de teste está fora dos portões.**
3. **O preflight abaixo roda antes de qualquer despacho.**

- [ ] **Preflight 1: nenhum caminho citado no plano está gitignorado**

O `.gitignore` da raiz tem `.env*` com uma única exceção (`!.env.local.example`), e foi exatamente essa regra que fez a Task 6 do Plano 3 criar um arquivo que o git nunca veria.

```bash
cd /c/Users/Pedro/projects/crm
grep -oE '`(src|tests|supabase|docs|scripts|public)/[^`]+`' \
  docs/superpowers/plans/2026-07-31-plano-4-ingestao.md \
  | tr -d '`' | sed 's/[:(].*$//' | sort -u > /tmp/caminhos-plano-4.txt
printf 'vercel.json\n.env.local.example\nREADME.md\nplaywright.config.ts\npackage.json\n' \
  >> /tmp/caminhos-plano-4.txt
git check-ignore --stdin < /tmp/caminhos-plano-4.txt; echo "(exit $?)"
```

Esperado: **nenhuma linha de caminho** e `(exit 1)` — `git check-ignore` sai 1 quando nada casa. Qualquer caminho impresso é um arquivo que o plano manda criar e o git vai ignorar.

Duas notas sobre o próprio comando, para não se assustar com a saída: `supabase/postgres` aparece na lista por ser citado em prosa (a armadilha de ACL da imagem), e não é caminho de arquivo; e o `sed` corta em `(`, então os caminhos dentro de `src/app/(app)/` chegam truncados em `src/app/`. Nenhum dos dois é problema — o que este passo precisa provar é que nenhum arquivo **novo** cai numa regra do `.gitignore`, e os arquivos de `(app)/` já são versionados.

**Rodado em 2026-07-31, na escrita deste plano: 56 caminhos, nenhum ignorado.**

- [ ] **Preflight 2: os blocos SQL do plano são aceitos pelo Postgres**

Blocos SQL grandes deste plano vão para migrations literalmente. Rodá-los uma vez contra o banco local, antes de qualquer implementador ver, custa um minuto e pega erro de sintaxe e coluna inexistente.

```bash
npx supabase start
npx supabase db reset
```

Esperado: reset limpo, sem erro. Este é só o baseline — as migrations novas ainda não existem. O que este passo garante é que o ambiente está de pé e que a linha de partida está verde.

- [ ] **Preflight 3: linha de partida verde**

```bash
npm test && npm run test:integration && npm run typecheck && npm run lint && npm run build
```

Esperado: tudo verde. Se algo falhar aqui, o problema é anterior ao Plano 4 e tem que ser resolvido antes.

---

## Mapa de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/seed.sql` | Registra o segredo de ingestão de desenvolvimento a cada `db reset` |
| `supabase/migrations/0009_ingestao_log.sql` | `integration_log`, `notifications`, grants, RLS, publicação do Realtime |
| `supabase/migrations/0010_rpc_entrega.sql` | `segredo_confere`, `registrar_entrega`, `entregas_pendentes`, `registrar_falha` |
| `supabase/migrations/0011_ingerir_lead.sql` | `ingerir_lead` — a transação de dedup, criação, evento e notificação |
| `supabase/migrations/0012_posse_da_page.sql` | Fecha o squat: segredo nas RPCs de conexão + `reivindicar_fonte_meta` |
| `src/lib/ingestao/dados.ts` | Tipo `DadosDoLead`, a fronteira entre mapeador e RPC |
| `src/lib/ingestao/hmac.ts` | Verificação do `X-Hub-Signature-256` do Meta |
| `src/lib/ingestao/mapear-meta.ts` | `field_data` do Graph → `DadosDoLead` |
| `src/lib/ingestao/mapear-google.ts` | `user_column_data` do Google → `DadosDoLead` |
| `src/lib/ingestao/processar.ts` | Orquestra uma entrega: Graph → mapeador → `ingerir_lead`, ou falha |
| `src/lib/data/ingestao.ts` | Port `IngestaoStore` + implementação Supabase com cliente anônimo |
| `src/lib/data/ingestao-memoria.ts` | `InMemoryIngestaoStore`, para o unitário de `processarEntrega` |
| `src/lib/data/notificacoes.ts` | Leitura e marcação de lida, pelo cliente da sessão |
| `src/app/api/webhooks/meta/route.ts` | `GET` de verificação e `POST` assinado do Meta |
| `src/app/api/webhooks/google/[token]/route.ts` | `POST` do Google, conta resolvida pelo token da URL |
| `src/app/api/webhooks/reprocessar/route.ts` | Varredura do cron, gateada por `CRON_SECRET` |
| `src/app/(app)/sino.tsx` | Sino + painel, assina `postgres_changes` em `notifications` |
| `src/app/(app)/acoes-notificacoes.ts` | Server Actions de marcar lida |
| `src/app/(app)/config/entregas.tsx` | Painel das últimas entregas do `integration_log` |
| `tests/integration/helpers/guarda-host.ts` | Recusa `SUPABASE_DB_URL` que não seja local |
| `vercel.json` | Agendamento do cron de reprocessamento |

**Modificados**

| Arquivo | O que muda |
|---|---|
| `src/middleware.ts` | `/api/webhooks` vira rota pública — hoje o middleware redireciona o webhook para `/login` |
| `src/lib/integracoes/meta.ts` | Port ganha `buscarLead`, `campanhaDoAnuncio`, `posseDaPagina` |
| `src/lib/integracoes/meta-falso.ts` | Implementa os três, registrando chamadas |
| `src/lib/integracoes/meta-real.ts` | Implementa os três contra o Graph |
| `src/lib/data/fontes.ts` | Segredo nas RPCs de conexão, `reivindicarMeta`, `entregasRecentes` |
| `src/app/(app)/config/acoes-fontes.ts` | Prova de posse antes de conectar; ação de reivindicar |
| `src/app/(app)/config/integracoes.tsx` | Botão de reivindicar e painel de entregas |
| `src/app/(app)/config/erros.ts` | Códigos novos |
| `src/app/(app)/config/page.tsx` | Carrega as entregas recentes |
| `src/app/(app)/layout.tsx` | Monta o sino |
| `src/app/(app)/funil/novo-lead.tsx` | Backlog: `responsavel_invalido` faltando no mapa local |
| `tests/integration/helpers/db.ts` | Guarda de host; `integration_log` e `notifications` no truncate |
| `tests/e2e/global-setup.ts` | Guarda de host |
| `tests/integration/0008_fontes_conectadas.test.ts` | A assinatura de `conectar_fonte_meta` mudou |
| `src/app/(app)/config/acoes-fontes.test.ts` | Prova de posse no caminho feliz e no recusado |
| `.env.local.example` | `INGESTAO_SEGREDO` preenchido, `META_VERIFY_TOKEN`, `CRON_SECRET` |
| `playwright.config.ts` | `INGESTAO_SEGREDO` no `webServer.env` |
| `README.md` | Portão de deploy levantado, com o que passou a valer no lugar |

---

## Task 1: Ambiente da ingestão — guarda de host e segredo semeado

Nada do resto do plano roda sem o segredo registrado no banco: `segredo_hash` fica nulo ao fim do Plano 3 e **toda** função de ingestão recusa enquanto ele for nulo. Essa é a primeira metade. A segunda é o item de backlog mais perigoso do repo, e ele fica aqui porque a partir da Task 2 o `truncate` do helper cresce.

**Files:**
- Create: `supabase/seed.sql`
- Create: `tests/integration/helpers/guarda-host.ts`
- Modify: `tests/integration/helpers/db.ts` (topo do arquivo, onde `CONN` é montado)
- Modify: `tests/e2e/global-setup.ts` (topo do arquivo, onde `CONN` é montado)
- Modify: `.env.local.example`
- Modify: `playwright.config.ts` (bloco `webServer.env`)
- Test: `tests/integration/seed-e-guarda-host.test.ts`

**Interfaces:**
- Produces: `SEGREDO_DEV = 'segredo-de-ingestao-local'` — o valor literal que o `seed.sql` registra e que `.env.local.example` traz em `INGESTAO_SEGREDO`. Todas as tasks seguintes presumem que `db reset` deixa esse segredo válido.
- Produces: `exigirHostLocal(conexao: string): string` em `tests/integration/helpers/guarda-host.ts` — devolve a string se o host for `127.0.0.1` ou `localhost`, e lança se não for.

- [ ] **Step 1: Escrever o teste da guarda de host, e vê-lo falhar**

`tests/integration/seed-e-guarda-host.test.ts` começa com dois casos para `exigirHostLocal`, sem tocar o banco:

1. `exigirHostLocal('postgresql://postgres:postgres@127.0.0.1:54322/postgres')` devolve a string inalterada.
2. `exigirHostLocal('postgresql://user:pw@db.projeto.supabase.co:5432/postgres')` lança, e a mensagem nomeia o host recusado.

Adicione também `localhost` como aceito e uma string que não é URL nenhuma como recusada — parse que falha tem que **recusar**, nunca deixar passar por não conseguir opinar.

Rode `npx vitest run --config vitest.integration.config.ts tests/integration/seed-e-guarda-host.test.ts`.
Esperado: FAIL, por o módulo não existir.

- [ ] **Step 2: Implementar `exigirHostLocal` e ligá-la nos dois consumidores**

Uma função só, exportada, que usa `new URL(...)` e compara `hostname`. O ponto é que ela **lance**, não que devolva booleano: o consumidor é uma constante de módulo, e o erro tem que acontecer antes de qualquer `connect()`.

Ligue nos dois lugares onde a string de conexão nasce hoje com default para o stack local:
- `tests/integration/helpers/db.ts:3-5` — `limparBanco()` faz `truncate` em 14 tabelas mais `delete from auth.users`. É a exposição grande, e é pré-existente.
- `tests/e2e/global-setup.ts:19-20` — apaga linhas de `lead_sources` por id fixo.

Comentário obrigatório em `guarda-host.ts` dizendo o que a guarda impede: se `SUPABASE_DB_URL` um dia apontar para um banco real — um `.env` copiado, uma variável exportada na shell errada — `limparBanco()` destrói o banco inteiro sem perguntar nada. A guarda é a única coisa entre esse acidente e o dano.

Rode o mesmo comando do Step 1. Esperado: PASS.

- [ ] **Step 3: Escrever o teste do segredo semeado, e vê-lo falhar**

No mesmo arquivo, um caso de integração:

- `select public.hash_segredo('segredo-de-ingestao-local') = segredo_hash from public.ingestion_config where id` devolve `true`.

Rode `npm run test:integration -- tests/integration/seed-e-guarda-host.test.ts`.
Esperado: FAIL — `segredo_hash` é nulo, e o `db reset` mais recente não semeou nada.

- [ ] **Step 4: Escrever o `seed.sql`**

`supabase/config.toml:66-71` já tem `[db.seed] enabled = true` com `sql_paths = ["./seed.sql"]`; o arquivo é que não existe.

```sql
-- Semente de DESENVOLVIMENTO. Roda depois das migrations em todo
-- `npx supabase db reset`, e nunca em producao — o Supabase so executa seed em
-- reset local.
--
-- O segredo de ingestao e configuracao de OPERADOR: ele existe para o servidor
-- provar que a chamada veio dele, antes de qualquer conta ser resolvida.
-- Nenhuma tela e nenhuma RPC exposta a aplicacao o escreve (a razao completa
-- esta em 0008_fontes_conectadas.sql:69-82). Em desenvolvimento entra aqui,
-- para que `db reset` deixe o ambiente pronto; em producao entra por SQL no
-- painel do Supabase, com um valor que nunca esteve num arquivo versionado.
--
-- Este valor e publico de proposito: esta versionado, esta no
-- .env.local.example, e vale so contra o Postgres em 127.0.0.1. Se ele aparecer
-- em qualquer ambiente alcancavel de fora, o problema e o ambiente.
update public.ingestion_config
   set segredo_hash = public.hash_segredo('segredo-de-ingestao-local'),
       atualizado_em = now()
 where id;
```

- [ ] **Step 5: Preencher as variáveis de ambiente**

Em `.env.local.example`, trocar `INGESTAO_SEGREDO=` por `INGESTAO_SEGREDO=segredo-de-ingestao-local`, com o comentário existente ajustado para dizer que este valor é o que o `seed.sql` registra e que os dois têm que andar juntos. Acrescentar, com comentário:

- `META_VERIFY_TOKEN=` — o valor que se digita no painel do Meta ao cadastrar o webhook; o `GET` de verificação compara com ele.
- `CRON_SECRET=` — o Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`; a rota de reprocessamento recusa sem ele.

Em `playwright.config.ts`, acrescentar `INGESTAO_SEGREDO: 'segredo-de-ingestao-local'` ao `webServer.env`, ao lado de `META_FAKE`. Comentário: sem isto o E2E depende de o `.env.local` da máquina estar certo, e a falha seria "o lead não aparece" sem nada dizendo por quê.

- [ ] **Step 6: Rodar o reset e a suíte**

```bash
npx supabase db reset
npm run test:integration
npm test && npm run typecheck && npm run lint
```

Esperado: verde. O teste do Step 3 agora passa porque o seed rodou no reset.

- [ ] **Step 7: Commit**

```bash
git add supabase/seed.sql tests/integration/helpers/guarda-host.ts tests/integration/helpers/db.ts tests/e2e/global-setup.ts tests/integration/seed-e-guarda-host.test.ts .env.local.example playwright.config.ts
git commit -m "feat: semeia o segredo de ingestao em dev e recusa SUPABASE_DB_URL nao local"
```

---

## Task 2: Migration 0009 — `integration_log` e `notifications`

**Files:**
- Create: `supabase/migrations/0009_ingestao_log.sql`
- Create: `tests/integration/0009_ingestao_log.test.ts`
- Modify: `tests/integration/helpers/db.ts` (lista do `truncate` em `limparBanco`)

**Interfaces:**
- Consumes: `provedor_lead` (enum da `0008`), `papel_na_conta` (`0001`), `accounts`/`profiles`/`leads`/`lead_sources`.
- Produces: tabelas `integration_log` e `notifications`, tipos `status_entrega` e `tipo_notificacao`. As Tasks 3, 4 e 10 escrevem nelas; a Task 11 lê `notifications`; a Task 12 lê `integration_log`.
- Produces: **grant de select em `integration_log` é por coluna e não inclui `payload_bruto`.** Qualquer `select *` nessa tabela por `authenticated` devolve `42501`. O store da Task 12 tem que listar colunas.

- [ ] **Step 1: Escrever os testes de integração, e vê-los falhar**

`tests/integration/0009_ingestao_log.test.ts`, usando `montarCenario()` de `tests/integration/helpers/cenario.ts` e os helpers `comoServico`/`comoUsuario` de `helpers/db.ts`. Os casos:

1. **`integration_log` recusa `select *` para `authenticated`.** Como admin da conta, um `select *` levanta erro de permissão (SQLSTATE `42501`). É a prova de que `payload_bruto` está fora do grant.
2. **Admin lê as colunas concedidas da própria conta.** Inserida uma linha por `comoServico` com `account_id` da conta, o admin vê a linha listando colunas explicitamente.
3. **Vendedor não lê `integration_log`, nem da própria conta.** Zero linhas — a policy exige `papel_na_conta = 'admin'`.
4. **Linha com `account_id` nulo é invisível para todo mundo,** inclusive para o admin. É a entrega de fonte desconhecida, que existe só como registro de operador.
5. **`unique (provedor, external_id)` é global.** Duas linhas com o mesmo par, em contas diferentes, violam o índice.
6. **`notifications` isola vendedores entre si.** Notificação do vendedor A não aparece para o vendedor B, nem para o gestor, nem para o admin da mesma conta. Este é o teste que sustenta o roteamento do Realtime da Task 11: se ele passar por engano, o sino entrega notificação alheia.
7. **Vendedor marca a própria notificação como lida,** e o `update` de `lida_em` do vendedor B na notificação de A afeta zero linhas.
8. **`notifications` não aceita insert de `authenticated`,** nem do próprio dono. Só as funções `security definer` escrevem.
9. **`notifications` está na publicação do Realtime:** `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'` devolve uma linha. Sem esta linha o sino nunca acende e **nada mais no sistema dá erro** — é o modo de falha silencioso mais fácil de introduzir neste plano.

Rode `npm run test:integration -- tests/integration/0009_ingestao_log.test.ts`.
Esperado: FAIL, as tabelas não existem.

- [ ] **Step 2: Escrever a migration**

```sql
-- Sub-projeto 2, Plano 4: a trilha de auditoria da ingestao e a caixa de
-- notificacoes. Spec:
-- docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md

create type public.status_entrega as enum ('pendente', 'processado', 'ignorado', 'falhou');
create type public.tipo_notificacao as enum ('novo_lead', 'lead_reincidente');

create table public.integration_log (
  id uuid primary key default gen_random_uuid(),
  -- Anulaveis de proposito, os dois. Entrega de Page ou URL desconhecida e
  -- gravada mesmo assim: e o unico rastro que um operador tera de um webhook
  -- que chegou e nao virou lead, e nesse caso nao existe conta nem fonte a que
  -- atribui-la. A policy abaixo torna essas linhas invisiveis para todo tenant.
  account_id uuid references public.accounts(id) on delete cascade,
  -- set null, e nao cascade: desconectar uma fonte nao pode apagar o historico
  -- de entregas dela. A linha continua visivel para o admin pelo account_id.
  source_id uuid references public.lead_sources(id) on delete set null,
  provedor public.provedor_lead not null,
  external_id text not null,
  payload_bruto jsonb not null,
  status public.status_entrega not null default 'pendente',
  erro text,
  tentativas integer not null default 0,
  -- Nao esta no esboco da spec, e e obrigatoria para cumpri-lo: a spec pede
  -- "backoff por numero de tentativas", e backoff precisa saber QUANDO foi a
  -- ultima. Sem esta coluna, `tentativas` sozinha diz quantas vezes, nunca
  -- ha quanto tempo, e a varredura do cron retentaria em rajada.
  ultima_tentativa_em timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  criado_em timestamptz not null default now(),
  processado_em timestamptz
);

-- GLOBAL, nao por conta: leadgen_id (Meta) e lead_id (Google) sao unicos no
-- provedor. E este indice que faz reenvio do provedor virar no-op em vez de
-- card duplicado — o `on conflict (provedor, external_id) do nothing` da
-- registrar_entrega (0010) depende de ele existir com exatamente estas colunas.
create unique index integration_log_provedor_external_idx
  on public.integration_log (provedor, external_id);

-- Varredura do cron: so as linhas que ainda podem virar lead.
create index integration_log_pendentes_idx
  on public.integration_log (criado_em)
  where status in ('pendente', 'falhou');

-- Painel de diagnostico da tela de Integracoes: as ultimas entregas da conta.
create index integration_log_conta_idx
  on public.integration_log (account_id, criado_em desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo public.tipo_notificacao not null,
  lida_em timestamptz,
  criado_em timestamptz not null default now()
);

create index notifications_usuario_idx
  on public.notifications (usuario_id, criado_em desc);

-- GRANTS
--
-- payload_bruto fica FORA do grant, e e o ponto todo da lista explicita: e o
-- unico lugar do sistema onde o corpo cru do provedor fica guardado, e o painel
-- de diagnostico nao precisa dele. So funcao SECURITY DEFINER o le. Mesmo
-- desenho do grant coluna-restrito da 0008, pelo mesmo motivo: o que vaza nao
-- pode ser decidido por um `select *` de tela. Consequencia pratica que a
-- Task 12 tem que respeitar: `select *` aqui devolve 42501 para authenticated.
grant select (id, account_id, source_id, provedor, external_id, status, erro,
              tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em)
  on public.integration_log to authenticated;

-- Sem insert e sem delete: quem escreve sao as funcoes de ingestao. update de
-- lida_em e a unica escrita que a UI faz, e por isso e a unica concedida.
grant select, update (lida_em) on public.notifications to authenticated;

alter table public.integration_log enable row level security;
alter table public.notifications enable row level security;

-- Diagnostico de integracao e assunto de admin, igual as fontes que ele
-- conecta. account_id nulo torna a linha invisivel para todos: papel_na_conta
-- (null) devolve null, e null = 'admin' nao e verdadeiro.
create policy integration_log_admin_select on public.integration_log
  for select using (public.papel_na_conta(account_id) = 'admin');

-- ESTA POLICY E O ROTEAMENTO DA NOTIFICACAO. O Realtime avalia a RLS por
-- assinante, entao cada usuario recebe pelo websocket exatamente o que esta
-- clausula deixa ele ler — sem nenhum filtro no cliente. Trocar por
-- is_member_of entregaria a notificacao de um vendedor para todos os outros da
-- conta, e o sintoma seria "o sino acende demais", nunca um erro.
create policy notifications_dono_select on public.notifications
  for select using (usuario_id = auth.uid());
create policy notifications_dono_update on public.notifications
  for update using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- Realtime so publica o que esta na publicacao. Sem esta linha o sino nunca
-- acende e nada no resto do sistema da erro — modo de falha silencioso, e por
-- isso ha um teste afirmando a presenca desta tabela em pg_publication_tables.
alter publication supabase_realtime add table public.notifications;
```

- [ ] **Step 3: Acrescentar as duas tabelas ao `limparBanco`**

Em `tests/integration/helpers/db.ts:70-82`, `integration_log` e `notifications` entram na lista do `truncate`. Ordem: as duas primeiro, antes de `lead_events`, seguindo a convenção do arquivo de listar dependente antes de dependência (o `cascade` resolve de qualquer forma, mas a lista documenta a direção).

- [ ] **Step 4: Rodar o reset e os testes**

```bash
npx supabase db reset
npm run test:integration -- tests/integration/0009_ingestao_log.test.ts
```

Esperado: PASS nos nove casos.

**Checkpoint obrigatório antes de seguir:** demonstre o RED do caso 9 removendo a linha `alter publication ...` da migration, rodando `npx supabase db reset` e vendo o teste ficar vermelho. Depois restaure. Esse é o teste cujo custo de estar errado é o sino inteiro não funcionar sem sintoma nenhum.

- [ ] **Step 5: Suíte inteira e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
git add supabase/migrations/0009_ingestao_log.sql tests/integration/0009_ingestao_log.test.ts tests/integration/helpers/db.ts
git commit -m "feat: integration_log e notifications, com grant por coluna e roteamento por RLS"
```

---

## Task 3: Migration 0010 — as RPCs que a rota chama sem sessão

O primeiro caminho de escrita sem `auth.uid()` da história do projeto. Toda a autorização é o segredo de ingestão.

**Files:**
- Create: `supabase/migrations/0010_rpc_entrega.sql`
- Create: `tests/integration/0010_rpc_entrega.test.ts`

**Interfaces:**
- Consumes: `hash_segredo` e `ingestion_config` (`0008`), `integration_log` (`0009`), `lead_sources`/`source_credentials` (`0008`).
- Produces, e a Task 7 consome exatamente estas assinaturas:
  - `registrar_entrega(p_segredo text, p_provedor provedor_lead, p_external_id text, p_payload jsonb, p_chave_da_fonte text, p_google_key text default null) returns jsonb` — o retorno é `{"log_id": uuid|null, "status": "pendente"|"ignorado"|"duplicado", "token": text|null}`.
  - `entregas_pendentes(p_segredo text, p_limite integer) returns table (log_id uuid, provedor provedor_lead, payload_bruto jsonb, token text, tentativas integer)`.
  - `registrar_falha(p_segredo text, p_log_id uuid, p_erro text) returns void`.
  - `segredo_confere(p_segredo text) returns boolean` — **sem `execute` para `public`**, uso interno.

- [ ] **Step 1: Escrever os testes de integração, e vê-los falhar**

`tests/integration/0010_rpc_entrega.test.ts`. Cenário base: `montarCenario()`, mais uma fonte Meta e uma fonte Google criadas por `comoServico` direto nas tabelas (não pelas RPCs de conexão — elas mudam na Task 10 e este arquivo não deve depender disso).

Casos:

1. **Segredo errado recusa.** `registrar_entrega` com segredo errado levanta `segredo_invalido`. Idem `entregas_pendentes` e `registrar_falha`.
2. **Segredo nulo no banco recusa mesmo com o segredo certo na chamada.** Zere `ingestion_config.segredo_hash`, chame, veja `segredo_invalido`, e restaure. É o estado "servidor não registrado" da spec, e é o estado em que a `0008` deixa o banco.
3. **`segredo_confere` não é alcançável por `anon` nem por `authenticated`.** Chamar como usuário levanta erro de permissão. Sem isso ela é um oráculo booleano de "esse segredo está certo?".
4. **Meta com Page conhecida grava `pendente` e devolve o token da Page.** O token do retorno é igual ao `meta_page_token` da credencial.
5. **Meta com Page desconhecida grava `ignorado` com `erro = 'fonte_nao_encontrada'`, `account_id` nulo, e devolve token nulo.**
6. **Google com URL token válido e `google_key` certo grava `pendente`,** e o token do retorno é nulo (Google não usa token de página).
7. **Google com URL token válido e `google_key` errado grava `ignorado` com `erro = 'chave_invalida'` e `account_id` preenchido.** É o que faz "configurei a chave errada no Google Ads" aparecer no painel em vez de sumir.
8. **`is_test` grava `ignorado` com `erro = 'lead_de_teste'`.** Cubra `true` booleano do jsonb e a string `"true"`.
9. **Reenvio é no-op.** Duas chamadas com o mesmo `(provedor, external_id)`: a segunda devolve `status = 'duplicado'` e `log_id` nulo, e a tabela continua com uma linha só.
10. **`external_id` vazio ou só espaço levanta `external_id_invalido`.**
11. **`entregas_pendentes` devolve pendente e falhou-com-tentativas-abaixo-de-5, mais antigo primeiro,** e **não** devolve `processado`, `ignorado`, nem `falhou` com `tentativas = 5`.
12. **O backoff segura a retentativa.** Uma linha `falhou` com `tentativas = 2` e `ultima_tentativa_em = now()` não aparece; a mesma linha com `ultima_tentativa_em = now() - interval '10 minutes'` aparece (a janela de 2 tentativas é 9 minutos).
13. **`registrar_falha` incrementa `tentativas` e carimba `ultima_tentativa_em`,** e não mexe numa linha já `processado`.

Rode `npm run test:integration -- tests/integration/0010_rpc_entrega.test.ts`.
Esperado: FAIL, as funções não existem.

- [ ] **Step 2: Escrever a migration**

```sql
-- Sub-projeto 2, Plano 4: as funcoes que a rota de webhook chama SEM SESSAO.
-- Este e o primeiro caminho de escrita sem auth.uid() do projeto. A unica
-- autorizacao e o segredo de ingestao, e o ganho sobre usar service_role e
-- concreto: vazar este segredo permite injetar lead e ler token de pagina;
-- vazar a service_role permite ler e escrever todas as tabelas de todas as
-- contas, inclusive auth.

-- O portao de toda a ingestao.
--
-- NAO recebe execute para public: e chamada so de dentro das funcoes definer
-- abaixo, que rodam como postgres. Alcancavel pelo PostgREST ela seria um
-- oraculo booleano de "esse segredo esta certo?", que e exatamente o que uma
-- forca bruta precisa.
--
-- segredo_hash nulo recusa: "servidor nao registrado" e estado explicito, nao
-- buraco aberto, e e o estado em que a 0008 deixa a linha. p_segredo nulo
-- tambem recusa, porque hash_segredo(null) e null e null = qualquer coisa nunca
-- e verdadeiro.
--
-- Comparacao com `=` comum, e nao em tempo constante, de proposito: o que se
-- compara aqui e o digest hex, nao o segredo. Um canal de tempo revelaria
-- prefixo de SHA-256, e disso nao se volta ao segredo sem uma preimagem.
create or replace function public.segredo_confere(p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ingestion_config c
    where c.id
      and c.segredo_hash is not null
      and c.segredo_hash = public.hash_segredo(p_segredo)
  );
$$;

revoke execute on function public.segredo_confere(text) from public;

-- Grava PRIMEIRO, interpreta depois. A rota chama isto e responde 200 antes de
-- qualquer chamada externa: o provedor nao pode ficar esperando o Graph API, e
-- payload gravado e reprocessavel quando o mapeamento estiver errado.
--
-- Devolve o token da Page no caminho meta porque quem processa a entrega
-- precisa dele para buscar o lead no Graph, e ele mora em source_credentials,
-- que nao tem grant nenhum. Nao e oraculo de token: quem tem o segredo de
-- ingestao ja pode injetar lead em qualquer conta, entao devolver o token nao
-- amplia poder nenhum.
create or replace function public.registrar_entrega(
  p_segredo text,
  p_provedor public.provedor_lead,
  p_external_id text,
  p_payload jsonb,
  p_chave_da_fonte text,
  p_google_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source uuid;
  v_account uuid;
  v_token text;
  v_key_hash text;
  v_status public.status_entrega := 'pendente';
  v_erro text;
  v_log uuid;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id_invalido';
  end if;

  if p_provedor = 'meta' then
    -- A Page e quem resolve a conta: o webhook do Meta e do APP, nao da conta,
    -- e o payload so traz o page_id. E por isso que o indice de lead_sources e
    -- global (0008:34-44).
    select ls.id, ls.account_id, sc.meta_page_token
      into v_source, v_account, v_token
      from public.lead_sources ls
      left join public.source_credentials sc on sc.source_id = ls.id
     where ls.provedor = 'meta'
       and ls.external_id = p_chave_da_fonte
       and ls.ativo;
  else
    -- No Google nao ha identificador estavel da fonte no payload: quem resolve
    -- a conta e o token da URL, e so o hash dele existe no banco.
    select ls.id, ls.account_id, sc.google_key_hash
      into v_source, v_account, v_key_hash
      from public.source_credentials sc
      join public.lead_sources ls on ls.id = sc.source_id
     where sc.url_token_hash = public.hash_segredo(p_chave_da_fonte)
       and ls.ativo;
  end if;

  if v_source is null then
    -- Fonte desconhecida vira log ignorado, nunca erro: um 404 na rota seria
    -- oraculo de quais Pages estao conectadas ao produto. account_id fica nulo,
    -- entao esta linha e invisivel para todo tenant — e registro de operador.
    v_status := 'ignorado';
    v_erro := 'fonte_nao_encontrada';
  elsif p_provedor = 'google'
        and v_key_hash is distinct from public.hash_segredo(p_google_key) then
    -- A URL resolveu, a chave do corpo nao bate. Aqui SABEMOS a conta, entao
    -- esta linha aparece no painel de /config — e o que transforma "configurei
    -- a chave errada no Google Ads" de misterio em diagnostico.
    v_status := 'ignorado';
    v_erro := 'chave_invalida';
  elsif coalesce(p_payload ->> 'is_test', '') in ('true', 't', '1') then
    -- O botao "Enviar dados de teste" do Google. Sem isto, todo teste de
    -- configuracao sujaria o funil do cliente com um card falso.
    --
    -- Comparacao por texto, e nao cast para boolean: `(x)::boolean` levanta
    -- excecao se o provedor mandar "yes" ou "1.0", e derrubar a ingestao por
    -- causa do formato de um campo opcional seria trocar um card sujo por
    -- nenhum lead.
    v_status := 'ignorado';
    v_erro := 'lead_de_teste';
  end if;

  insert into public.integration_log
    (account_id, source_id, provedor, external_id, payload_bruto, status, erro)
  values (v_account, v_source, p_provedor, p_external_id, p_payload, v_status, v_erro)
  on conflict (provedor, external_id) do nothing
  returning id into v_log;

  if v_log is null then
    -- Reenvio do provedor, nao erro. 200 sem efeito e sem token: nao ha nada
    -- novo a processar, e devolver o token aqui deixaria a rota disparar uma
    -- segunda busca no Graph para um lead que ja existe.
    return jsonb_build_object('log_id', null, 'status', 'duplicado', 'token', null);
  end if;

  return jsonb_build_object(
    'log_id', v_log,
    'status', v_status,
    -- So no caminho que vai mesmo processar: entrega ignorada nao precisa do
    -- token, e devolve-lo seria ampliar a superficie sem uso nenhum.
    'token', case when p_provedor = 'meta' and v_status = 'pendente' then v_token end
  );
end;
$$;

-- Varredura do cron. Devolve tudo que o processamento precisa para nao ter que
-- voltar ao banco: o payload cru e, no Meta, o token da Page.
--
-- Backoff por numero de tentativas: 3^n minutos, ou seja 1, 3, 9, 27 e 81.
-- Desiste em 5 — alem disso a falha nao e transitoria, e retentar so gasta cota
-- do Graph e enche o log.
create or replace function public.entregas_pendentes(p_segredo text, p_limite integer)
returns table (
  log_id uuid,
  provedor public.provedor_lead,
  payload_bruto jsonb,
  token text,
  tentativas integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  -- Todas as referencias qualificadas por `l.`/`sc.`: os nomes de saida
  -- (provedor, payload_bruto, tentativas) colidem com colunas da tabela, e sem
  -- a qualificacao o plpgsql recusa por referencia ambigua.
  return query
  select l.id, l.provedor, l.payload_bruto, sc.meta_page_token, l.tentativas
    from public.integration_log l
    left join public.source_credentials sc on sc.source_id = l.source_id
   where (l.status = 'pendente' or (l.status = 'falhou' and l.tentativas < 5))
     and (
       l.ultima_tentativa_em is null
       or l.ultima_tentativa_em < now() - (interval '1 minute' * power(3, l.tentativas))
     )
   order by l.criado_em asc
   limit p_limite;
end;
$$;

-- Nao muda o status para 'falhou' sem incrementar a tentativa: e o contador que
-- entregas_pendentes usa tanto para o backoff quanto para desistir. Sem o
-- incremento, a mesma entrega quebrada voltaria a cada varredura, para sempre.
--
-- O `and status in (...)` impede que uma retentativa tardia rebaixe para
-- 'falhou' uma entrega que ja virou lead — cenario real quando o after() da
-- rota e a varredura do cron correm sobre a mesma linha.
create or replace function public.registrar_falha(
  p_segredo text,
  p_log_id uuid,
  p_erro text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  update public.integration_log
     set status = 'falhou',
         -- Truncado: mensagem de Graph API pode vir com corpo inteiro dentro, e
         -- o log e lido por tela.
         erro = left(coalesce(p_erro, 'erro_desconhecido'), 500),
         tentativas = tentativas + 1,
         ultima_tentativa_em = now()
   where id = p_log_id
     and status in ('pendente', 'falhou');
end;
$$;
```

- [ ] **Step 3: Rodar reset e testes**

```bash
npx supabase db reset
npm run test:integration -- tests/integration/0010_rpc_entrega.test.ts
```

Esperado: PASS nos treze casos. Se algum passar sem que você tenha visto o RED dele, quebre a linha correspondente da migration de propósito e confirme o vermelho antes de seguir.

- [ ] **Step 4: Suíte inteira e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
git add supabase/migrations/0010_rpc_entrega.sql tests/integration/0010_rpc_entrega.test.ts
git commit -m "feat: RPCs de entrega gateadas no segredo de ingestao"
```

---

## Task 4: Migration 0011 — `ingerir_lead`

A transação que decide se nasce card ou aviso. É o coração do sub-projeto.

**Files:**
- Create: `supabase/migrations/0011_ingerir_lead.sql`
- Create: `tests/integration/0011_ingerir_lead.test.ts`

**Interfaces:**
- Consumes: `segredo_confere`, `integration_log` (`0009`), `e_membro_da_conta` (`0007`), `lead_sources`, `pipelines`, `stages`, `leads`, `lead_events`, `stage_history`, `notifications`.
- Produces: `ingerir_lead(p_segredo text, p_log_id uuid, p_dados jsonb) returns jsonb`, com retorno `{"status": "criado"|"reincidente"|"ja_processado", "lead_id": uuid|null}`.
- Produces: **o formato de `p_dados`** — é a fronteira entre os mapeadores da Task 6 e o banco. Chaves lidas: `nome`, `telefone`, `telefone_e164`, `email`, `email_norm`, `empresa`, `campanha_origem`, `formulario_origem`, `extras` (objeto). Qualquer chave a mais é ignorada; qualquer uma ausente vira nulo.

**Nota de segurança que a implementação depende:** funções `security definer` deste projeto rodam como `postgres`, que é dono das tabelas, e nenhuma migration usa `force row level security` — logo a RLS **não** é avaliada dentro delas. É o que faz `criar_conta` (`0002`) conseguir inserir em `accounts`, tabela que não tem policy de insert nenhuma. Consequência direta: toda garantia que hoje mora em policy tem que ser reafirmada à mão aqui dentro. O `if not public.e_membro_da_conta(...)` do corpo abaixo existe exatamente por isso.

- [ ] **Step 1: Escrever os testes de integração, e vê-los falhar**

`tests/integration/0011_ingerir_lead.test.ts`. Cada caso monta uma entrega chamando `registrar_entrega` (já existe, Task 3) e depois `ingerir_lead`. Casos:

1. **Segredo errado recusa** (`segredo_invalido`).
2. **Caminho feliz cria o lead na primeira etapa aberta do pipeline padrão,** com `origem` igual ao provedor, `campanha_origem` e `formulario_origem` preenchidos, e `responsavel_id` igual ao `responsavel_padrao_id` da fonte.
3. **Cria `stage_history` e um `lead_events` de tipo `criado_por_webhook`,** com `ator_id` nulo, e o payload do evento carrega `provedor`, `external_id` e `extras`.
4. **Cria `notifications` de tipo `novo_lead` para o responsável padrão,** e nenhuma quando a fonte não tem responsável configurado.
5. **Fecha o log:** `status = 'processado'`, `lead_id` apontando para o lead, `processado_em` preenchido.
6. **Dedup por telefone contra lead ABERTO não cria card:** grava `lead_events` de tipo `reingestao` no lead existente, cria `notifications` de tipo `lead_reincidente` para o **responsável do lead existente** (não o da fonte), e a contagem de leads da conta não muda.
7. **Dedup por email tem o mesmo comportamento.**
8. **Lead PERDIDO não é duplicata:** com o único lead da pessoa em `status = 'perdido'`, a ingestão cria um card novo. Idem para `ganho`. Recompra é lead novo.
9. **Dedup não atravessa contas:** lead aberto com o mesmo telefone em outra conta não impede a criação.
10. **Idempotência:** chamar duas vezes com o mesmo `log_id` devolve `ja_processado` na segunda e não cria nada.
11. **Entrega `ignorado` não vira lead:** `ingerir_lead` sobre um log `ignorado` devolve `ja_processado`.
12. **Entrega `falhou` é reprocessável:** um log em `falhou` é aceito e vira `processado`.
13. **`nome` ausente ou em branco vira `'Lead sem nome'`,** porque `leads.nome` é `not null` e perder o lead por falta de nome é o pior desfecho possível.
14. **Responsável padrão que não é mais membro da conta é nulificado, não gravado.** Remova a membership do responsável padrão e ingira: o lead nasce com `responsavel_id` nulo. Sem esta guarda o lead nasceria invisível para todo vendedor da conta, sem erro nenhum — é o backlog #4 voltando por dentro do definer.
15. **Log sem `source_id` levanta `fonte_nao_encontrada`.**
16. **Sem telefone e sem email não deduplica com ninguém** — cria card novo mesmo havendo lead aberto sem contato.

Rode `npm run test:integration -- tests/integration/0011_ingerir_lead.test.ts`.
Esperado: FAIL, a função não existe.

- [ ] **Step 2: Escrever a migration**

```sql
-- Sub-projeto 2, Plano 4: a transacao que decide se a entrega vira card ou
-- vira aviso no card que ja existe.
--
-- ATENCAO ao modelo de privilegio: esta funcao e SECURITY DEFINER e roda como
-- postgres, dono das tabelas, e nenhuma migration usa `force row level
-- security` — logo a RLS NAO e avaliada aqui dentro. E o que permite escrever
-- sem auth.uid(). O preco e que toda garantia que mora em policy precisa ser
-- reafirmada a mao neste corpo; ver e_membro_da_conta mais abaixo.
create or replace function public.ingerir_lead(
  p_segredo text,
  p_log_id uuid,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.integration_log;
  v_account uuid;
  v_resp_padrao uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_tel text;
  v_email text;
  v_lead uuid;
  v_dono uuid;
  v_evento jsonb;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  -- `for update` serializa a entrega. O after() da rota e a varredura do cron
  -- podem pegar a mesma linha ao mesmo tempo, e sem a trava as duas passariam
  -- pelo teste de status e criariam um card cada.
  select * into v_log from public.integration_log where id = p_log_id for update;
  if v_log.id is null then
    raise exception 'log_nao_encontrado';
  end if;

  -- 'falhou' entra junto de 'pendente' de proposito: e o estado que o cron
  -- reprocessa. 'processado' e 'ignorado' caem no ja_processado, que e a
  -- idempotencia que a spec pede.
  if v_log.status not in ('pendente', 'falhou') then
    return jsonb_build_object('status', 'ja_processado', 'lead_id', v_log.lead_id);
  end if;
  if v_log.source_id is null then
    raise exception 'fonte_nao_encontrada';
  end if;

  select ls.account_id, ls.responsavel_padrao_id
    into v_account, v_resp_padrao
    from public.lead_sources ls
   where ls.id = v_log.source_id;

  -- A RLS nao nos alcanca aqui, entao o with check da 0007 tambem nao. Sem esta
  -- reafirmacao, um responsavel padrao que saiu da conta (membership revogada
  -- depois de a fonte ter sido configurada) produziria lead invisivel para todo
  -- vendedor — leads_select exige responsavel_id = auth.uid() para vendedor —
  -- e sem erro nenhum. E exatamente o backlog #4 voltando por outra porta.
  -- Nulo e o destino certo: e o estado legitimo da fila que gestor e admin veem.
  if not public.e_membro_da_conta(v_account, v_resp_padrao) then
    v_resp_padrao := null;
  end if;

  select p.id into v_pipeline
    from public.pipelines p
   where p.account_id = v_account and p.is_default;
  if v_pipeline is null then
    raise exception 'pipeline_nao_encontrado';
  end if;

  -- Primeira etapa ABERTA, e nao `ordem = 1`: leads.status e derivado do tipo
  -- da etapa dentro de move_lead_stage, entao se a conta reordenar e puser uma
  -- etapa de ganho na frente, o lead nasceria ganho sem ninguem ter vendido
  -- nada.
  select s.id into v_stage
    from public.stages s
   where s.pipeline_id = v_pipeline and s.tipo = 'aberta'
   order by s.ordem asc
   limit 1;
  if v_stage is null then
    raise exception 'etapa_invalida';
  end if;

  v_tel := nullif(btrim(coalesce(p_dados ->> 'telefone_e164', '')), '');
  v_email := nullif(btrim(coalesce(p_dados ->> 'email_norm', '')), '');

  -- O que a timeline vai contar. `extras` sao os campos do formulario que
  -- nenhum mapeador conhece — as perguntas de qualificacao que o cliente
  -- escreveu. Sao o motivo de o payload cru nunca ser descartado.
  v_evento := jsonb_build_object(
    'provedor', v_log.provedor,
    'external_id', v_log.external_id,
    'campanha', p_dados ->> 'campanha_origem',
    'formulario', p_dados ->> 'formulario_origem',
    'extras', coalesce(p_dados -> 'extras', '{}'::jsonb)
  );

  -- Dedup so contra lead ABERTO, e e por isso que isto nunca virou constraint
  -- unica: com o card sendo o Lead, recompra e lead novo. Lead ganho ou perdido
  -- nao conta.
  if v_tel is not null or v_email is not null then
    select l.id, l.responsavel_id
      into v_lead, v_dono
      from public.leads l
     where l.account_id = v_account
       and l.status = 'aberto'
       and (
         (v_tel is not null and l.telefone_e164 = v_tel)
         or (v_email is not null and l.email_norm = v_email)
       )
     order by l.criado_em desc
     limit 1;
  end if;

  if v_lead is not null then
    insert into public.lead_events (lead_id, tipo, payload, ator_id)
    values (v_lead, 'reingestao', v_evento, null);

    -- Notifica quem ja cuida do lead, e nao o responsavel padrao da fonte: e
    -- essa pessoa que precisa saber que a mesma pessoa voltou.
    if v_dono is not null then
      insert into public.notifications (account_id, usuario_id, lead_id, tipo)
      values (v_account, v_dono, v_lead, 'lead_reincidente');
    end if;

    update public.integration_log
       set status = 'processado',
           lead_id = v_lead,
           processado_em = now(),
           ultima_tentativa_em = now(),
           erro = null
     where id = p_log_id;

    return jsonb_build_object('status', 'reincidente', 'lead_id', v_lead);
  end if;

  insert into public.leads (
    account_id, nome, telefone, telefone_e164, email, email_norm, empresa,
    origem, campanha_origem, formulario_origem,
    pipeline_id, stage_id, responsavel_id
  ) values (
    v_account,
    -- leads.nome e not null. Perder o lead por falta de nome seria o pior
    -- desfecho possivel: o payload cru fica no log, e o nome se corrige depois.
    coalesce(nullif(btrim(coalesce(p_dados ->> 'nome', '')), ''), 'Lead sem nome'),
    p_dados ->> 'telefone',
    v_tel,
    p_dados ->> 'email',
    v_email,
    p_dados ->> 'empresa',
    -- provedor_lead e lead_origem sao enums diferentes com os mesmos rotulos
    -- 'meta' e 'google'; o cast tem que passar por text.
    v_log.provedor::text::public.lead_origem,
    p_dados ->> 'campanha_origem',
    p_dados ->> 'formulario_origem',
    v_pipeline, v_stage, v_resp_padrao
  ) returning id into v_lead;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (v_lead, null, v_stage, null);

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (v_lead, 'criado_por_webhook', v_evento, null);

  if v_resp_padrao is not null then
    insert into public.notifications (account_id, usuario_id, lead_id, tipo)
    values (v_account, v_resp_padrao, v_lead, 'novo_lead');
  end if;

  update public.integration_log
     set status = 'processado',
         lead_id = v_lead,
         processado_em = now(),
         ultima_tentativa_em = now(),
         erro = null
   where id = p_log_id;

  return jsonb_build_object('status', 'criado', 'lead_id', v_lead);
end;
$$;
```

- [ ] **Step 3: Rodar reset e testes**

```bash
npx supabase db reset
npm run test:integration -- tests/integration/0011_ingerir_lead.test.ts
```

Esperado: PASS nos dezesseis casos.

**Checkpoint obrigatório:** demonstre o RED do caso 14 removendo o bloco `if not public.e_membro_da_conta(...)` da migration, rodando o reset e vendo o teste vermelho. É a guarda mais fácil de alguém remover no futuro achando que a policy cobre, e ela não cobre.

- [ ] **Step 4: Suíte inteira e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
git add supabase/migrations/0011_ingerir_lead.sql tests/integration/0011_ingerir_lead.test.ts
git commit -m "feat: ingerir_lead com dedup contra lead aberto e notificacao"
```

---

## Task 5: O port do Graph cresce — buscar lead, campanha e posse da Page

**Files:**
- Modify: `src/lib/integracoes/meta.ts`
- Modify: `src/lib/integracoes/meta-falso.ts`
- Modify: `src/lib/integracoes/meta-real.ts`
- Modify: `src/lib/integracoes/meta-falso.test.ts`
- Modify: `src/lib/integracoes/meta-real.test.ts`

**Interfaces:**
- Produces, em `meta.ts`:
  - `export type LeadDoMeta = { campos: { name: string; values: string[] }[]; adId: string | null; formId: string | null; criadoEm: string | null }`
  - `buscarLead(leadgenId: string, tokenDaPagina: string): Promise<Resultado<LeadDoMeta>>`
  - `campanhaDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<string>>`
  - `posseDaPagina(pageId: string, tokenDaPagina: string): Promise<Resultado<void>>`
- Produces, em `meta-falso.ts`: `readonly buscados: string[]`, `readonly posseConferida: string[]`, e um mapa `leads: Map<string, LeadDoMeta>` com um lead padrão quando o id não estiver no mapa. `falharEm` já é `keyof MetaGraph`, então os três métodos novos entram nele automaticamente — não mude o tipo.
- Consumes: nada de tasks anteriores.

**Como `posseDaPagina` prova posse, e por que não do jeito óbvio.** A chamada é `GET /me?fields=id` **com o token da Page**, e a posse só está provada se o `id` devolvido for igual ao `pageId` pedido. O jeito óbvio — `GET /{page_id}?fields=id` — **não serve**: um token de página consegue ler campos públicos básicos de *outras* páginas, então a chamada teria sucesso com o token errado e a prova seria vazia. O `/me` de um token de página é sempre a própria página; não há como um token de A responder `/me` como B.

- [ ] **Step 1: Escrever os testes do falso, e vê-los falhar**

Em `meta-falso.test.ts`:

1. `buscarLead` devolve o lead padrão e registra o id em `buscados`.
2. `buscarLead` com `falharEm = 'buscarLead'` devolve `falha('meta_indisponivel')` e **não** registra em `buscados` (recusar depois de já ter registrado não prova nada).
3. `posseDaPagina` com o token correto daquela Page devolve `ok`.
4. `posseDaPagina` com o token de **outra** Page da lista devolve `falha('posse_nao_comprovada')`. Este é o caso que a Task 10 usa para provar que o squat está fechado — se ele não discriminar, o fechamento é decorativo.
5. `campanhaDoAnuncio` devolve um nome estável e determinístico.

Rode `npx vitest run --config vitest.config.ts src/lib/integracoes/meta-falso.test.ts`.
Esperado: FAIL, os métodos não existem.

- [ ] **Step 2: Estender o port e o falso até o verde**

Ao acrescentar os três métodos à interface `MetaGraph`, o TypeScript vai apontar `MetaGraphFalso` e `MetaGraphReal` como incompletos — é o compilador cobrando a lista inteira, e é o comportamento desejado. Implemente primeiro o falso.

O lead padrão do falso deve ter `full_name`, `email`, `phone_number` e pelo menos um campo custom (uma pergunta de qualificação com nome arbitrário), porque é ele que a Task 6 e a Task 7 vão exercitar de ponta a ponta.

Rode o teste do Step 1. Esperado: PASS.

- [ ] **Step 3: Escrever os testes do real com `fetch` substituído, e vê-los falhar**

Em `meta-real.test.ts`, seguindo exatamente o padrão que já existe no arquivo (substituição do `fetch` global, nenhuma requisição de rede):

1. `buscarLead` mapeia `field_data` para `campos` e extrai `ad_id`/`form_id`.
2. `buscarLead` com resposta 200 de formato inesperado (sem `field_data`) devolve `meta_indisponivel` em vez de estourar — a mesma guarda que `listarPaginas` já tem em `meta-real.ts:100`.
3. `campanhaDoAnuncio` lê `campaign.name` do corpo.
4. `posseDaPagina` devolve `ok` quando o `/me` responde com o mesmo id, e `posse_nao_comprovada` quando responde com id diferente. **Esse segundo caso é o teste mais importante deste arquivo.**
5. `fetch` que rejeita (o `TypeError: fetch failed` do undici) vira `Resultado` de falha, não exceção, nos três métodos novos.

Rode `npx vitest run --config vitest.config.ts src/lib/integracoes/meta-real.test.ts`.
Esperado: FAIL.

- [ ] **Step 4: Implementar no real até o verde**

Use o helper `chamar<T>()` que já existe em `meta-real.ts:40` — ele já traz `try/catch`, `AbortSignal.timeout` e a tradução de erro. Não abra nova costura nem novo caminho de `fetch`.

Endpoints:
- `buscarLead`: `GET {BASE}/{leadgenId}?fields=field_data,ad_id,form_id,created_time&access_token={tokenDaPagina}`
- `campanhaDoAnuncio`: `GET {BASE}/{adId}?fields=campaign{name}&access_token={tokenDaPagina}`
- `posseDaPagina`: `GET {BASE}/me?fields=id&access_token={tokenDaPagina}`, e compara com `pageId`

Rode o teste do Step 3. Esperado: PASS.

- [ ] **Step 5: Suíte e commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build
git add src/lib/integracoes/
git commit -m "feat: port do Graph busca lead, campanha e prova posse da Page"
```

---

## Task 6: Mapeadores puros e verificação de assinatura

Nenhum banco, nenhuma rede, nenhum mock. Três módulos puros que carregam a parte do sistema mais fácil de errar em silêncio.

**Files:**
- Create: `src/lib/ingestao/dados.ts`
- Create: `src/lib/ingestao/hmac.ts`
- Create: `src/lib/ingestao/hmac.test.ts`
- Create: `src/lib/ingestao/mapear-meta.ts`
- Create: `src/lib/ingestao/mapear-meta.test.ts`
- Create: `src/lib/ingestao/mapear-google.ts`
- Create: `src/lib/ingestao/mapear-google.test.ts`

**Interfaces:**
- Produces, em `dados.ts`:
  ```ts
  export type DadosDoLead = {
    nome: string | null
    telefone: string | null
    telefoneE164: string | null
    email: string | null
    emailNorm: string | null
    empresa: string | null
    campanhaOrigem: string | null
    formularioOrigem: string | null
    extras: Record<string, string>
  }
  ```
  Mais `export function paraPayload(d: DadosDoLead): Record<string, unknown>`, que converte para as chaves `snake_case` que `ingerir_lead` lê (`telefone_e164`, `email_norm`, `campanha_origem`, `formulario_origem`, `extras`). **Uma função só faz essa tradução em todo o repo** — a Task 7, a Task 8 e a Task 9 chamam esta.
- Produces: `assinaturaValida(corpoCru: string, cabecalho: string | null, appSecret: string): boolean` em `hmac.ts`.
- Produces: `mapearLeadDoMeta(lead: LeadDoMeta, extra: { campanha: string | null; formulario: string | null }): DadosDoLead`.
- Produces: `mapearLeadDoGoogle(payload: Record<string, unknown>): DadosDoLead`.
- Consumes: `normalizarTelefone` e `normalizarEmail` de `src/lib/domain/normalizacao.ts`. **Não reimplemente normalização aqui** — ela já existe, é testada, e duas cópias divergem.
- Consumes: `LeadDoMeta` de `src/lib/integracoes/meta.ts` (Task 5).

- [ ] **Step 1: Escrever os testes do HMAC, e vê-los falhar**

`hmac.test.ts`. O corpo canônico e a assinatura de referência devem ser calculados **no próprio teste** com `createHmac` do `node:crypto`, e não colados como literal: literal colado no plano é a classe de defeito que este plano existe para evitar. Casos:

1. Assinatura correta com prefixo `sha256=` → `true`.
2. Um byte diferente no corpo → `false`.
3. Cabeçalho `null` → `false`.
4. Cabeçalho sem o prefixo `sha256=` → `false`.
5. Cabeçalho com hex de tamanho errado → `false`.
6. Cabeçalho com caracteres não-hex → `false`. **Atenção:** `Buffer.from('zz', 'hex')` não lança, devolve buffer vazio — sem checagem de tamanho *depois* da decodificação, esse caso passa por engano.
7. `appSecret` vazio → `false`, mesmo com um cabeçalho que "bateria" com segredo vazio. Falha fechado: variável de ambiente não configurada não pode virar webhook aberto.
8. Corpo com acentuação (UTF-8 multibyte) valida corretamente — o HMAC tem que ser sobre os bytes, não sobre uma reserialização.

Rode `npx vitest run --config vitest.config.ts src/lib/ingestao/hmac.test.ts`.
Esperado: FAIL.

- [ ] **Step 2: Implementar `assinaturaValida`**

Invariantes obrigatórias, nesta ordem:
1. `appSecret` vazio → `false`, antes de qualquer cálculo.
2. Cabeçalho ausente ou sem prefixo `sha256=` → `false`.
3. Decodifica o hex restante em `Buffer`, calcula o HMAC-SHA256 do corpo cru em UTF-8, e **compara os tamanhos antes** de `timingSafeEqual` (que lança se diferirem).
4. Compara com `timingSafeEqual` do `node:crypto`. Nunca `===`.

Comentário obrigatório no arquivo: a rota tem que ler `await req.text()` e passar **essa string**. Ler o JSON e reserializar muda os bytes (ordem de chave, espaçamento, escapes) e a assinatura nunca mais bate — é a falha clássica desta integração, e o sintoma é 401 em 100% dos webhooks legítimos.

Rode o teste do Step 1. Esperado: PASS.

- [ ] **Step 3: Escrever os testes dos dois mapeadores, e vê-los falhar**

`mapear-meta.test.ts`, sobre o formato `field_data` (`[{ name, values }]`):

1. `full_name`, `email`, `phone_number` e `company_name` caem nos campos certos.
2. `first_name` + `last_name` sem `full_name` viram um nome só, com espaço no meio.
3. Telefone brasileiro sem DDI vira `+55…` em `telefoneE164`, e `telefone` guarda o valor cru como veio.
4. Telefone impossível deixa `telefoneE164` nulo **sem** perder `telefone` cru.
5. Email em maiúsculas vira minúsculo em `emailNorm`, e `email` guarda o cru.
6. Email malformado deixa `emailNorm` nulo sem perder `email`.
7. Campo desconhecido cai em `extras` com o nome original como chave.
8. `values` vazio ou ausente não quebra e não inventa string vazia — vira nulo.
9. `campanha` e `formulario` vindos do segundo argumento aparecem em `campanhaOrigem`/`formularioOrigem`.
10. Nenhum campo reconhecido → todos os campos nulos, `extras` vazio, e **nada lança**.

`mapear-google.test.ts`, sobre `user_column_data` (`[{ column_id, string_value, column_name }]`):

11. `FULL_NAME`, `EMAIL`, `PHONE_NUMBER`, `COMPANY_NAME` caem nos campos certos.
12. `FIRST_NAME` + `LAST_NAME` sem `FULL_NAME` viram um nome só.
13. `column_id` desconhecido cai em `extras`, com `column_name` como chave quando ele existir (é o texto que o cliente escreveu no formulário) e `column_id` como fallback.
14. `campaign_id` vira `campanhaOrigem` e `form_id` vira `formularioOrigem`, ambos como texto — o Google manda número.
15. `user_column_data` ausente ou não-array não quebra: devolve tudo nulo. Payload torto não pode derrubar a rota.
16. Telefone e email passam pelas mesmas normalizações do Meta.

Rode `npx vitest run --config vitest.config.ts src/lib/ingestao/`.
Esperado: FAIL.

- [ ] **Step 4: Implementar os dois mapeadores**

Regra que vale para os dois e é o coração do desenho: **nada é descartado.** Campo que o mapeador não conhece vai para `extras` e chega à timeline pelo payload do evento; o corpo cru continua em `integration_log.payload_bruto` para reprocessamento depois que o mapeamento for corrigido. Um mapeador que "não reconheceu" nunca pode devolver menos dado do que recebeu.

`nome` fica `string | null` — a decisão sobre o fallback `'Lead sem nome'` é do banco (`0011`), que é quem tem a constraint `not null`. Não duplique o literal aqui.

Rode o teste do Step 3. Esperado: PASS.

- [ ] **Step 5: Suíte e commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/ingestao/
git commit -m "feat: mapeadores de payload e verificacao de assinatura do Meta"
```

---

## Task 7: O webhook do Meta

**Files:**
- Create: `src/lib/data/ingestao.ts`
- Create: `src/lib/data/ingestao-memoria.ts`
- Create: `src/lib/ingestao/processar.ts`
- Create: `src/lib/ingestao/processar.test.ts`
- Create: `src/app/api/webhooks/meta/route.ts`
- Create: `src/app/api/webhooks/meta/route.test.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Produces, em `ingestao.ts`:
  ```ts
  export type EntregaParaProcessar = {
    logId: string
    provedor: Provedor
    payload: Record<string, unknown>
    token: string | null
  }
  export type ResultadoEntrega = {
    logId: string | null
    status: 'pendente' | 'ignorado' | 'duplicado'
    token: string | null
  }
  export interface IngestaoStore {
    registrarEntrega(e: {
      provedor: Provedor
      externalId: string
      payload: Record<string, unknown>
      chaveDaFonte: string
      googleKey?: string | null
    }): Promise<Resultado<ResultadoEntrega>>
    ingerirLead(logId: string, dados: DadosDoLead): Promise<Resultado<{ status: string; leadId: string | null }>>
    registrarFalha(logId: string, erro: string): Promise<Resultado<void>>
    entregasPendentes(limite: number): Promise<Resultado<EntregaParaProcessar[]>>
  }
  export function criarIngestaoStore(): Resultado<IngestaoStore>
  ```
- Produces: `processarEntrega(e: EntregaParaProcessar, deps: { ingestao: IngestaoStore; graph: MetaGraph }): Promise<Resultado<void>>` em `processar.ts`. **As Tasks 8 e 9 chamam esta mesma função** — há um caminho de processamento só no repo, e é ele que o cron reexecuta.
- Consumes: `paraPayload` e os mapeadores (Task 6), o port do Graph (Task 5), as RPCs (Tasks 3 e 4).

**Descoberta que bloqueia esta task e não está em nenhuma spec:** o `matcher` do `src/middleware.ts:45` casa **todas** as rotas, e `ROTAS_PUBLICAS` (`:4`) tem só `/login`, `/signup` e `/convite`. Sem sessão, um `POST` do Meta hoje é **redirecionado para `/login`** antes de chegar ao route handler. O Meta trata o redirect como falha de entrega e, após reprovações repetidas, desinscreve o app da Page. Nenhum teste existente cobre isso porque nenhuma rota sem sessão existia até agora.

- [ ] **Step 1: Escrever o teste do middleware, e vê-lo falhar**

Em `src/app/api/webhooks/meta/route.test.ts` (ou em um `src/middleware.test.ts`, se preferir isolar), um caso que chama `middleware()` com uma `NextRequest` para `/api/webhooks/meta` **sem cookie de sessão** e afirma que a resposta **não** é um redirect para `/login`.

Rode `npx vitest run --config vitest.config.ts src/app/api/webhooks/`.
Esperado: FAIL — hoje é redirect.

- [ ] **Step 2: Abrir a rota no middleware**

Acrescente `'/api/webhooks'` a `ROTAS_PUBLICAS`. A checagem já é `caminho.startsWith(r)`, então cobre as três rotas de webhook deste plano de uma vez.

Comentário obrigatório: webhook não tem sessão por definição, e a autorização dele é outra e mais forte — HMAC no Meta, token secreto na URL no Google, `CRON_SECRET` no reprocessamento. "Público no middleware" aqui significa "não passa pelo portão de sessão", nunca "não autenticado".

Esperado: PASS.

- [ ] **Step 3: Escrever o store de ingestão e o duplo em memória**

`ingestao.ts` monta um cliente Supabase **anônimo e sem cookies** — `createClient(url, anonKey)` de `@supabase/supabase-js`, não o `criarClienteServidor` de `@/lib/supabase/servidor`, que carrega a sessão do usuário. Este é o único cliente do projeto que fala com o banco sem sessão.

`criarIngestaoStore()` devolve `falha('ingestao_nao_configurada')` quando `process.env.INGESTAO_SEGREDO` está vazio, em vez de montar um store que vai receber `segredo_invalido` a cada chamada. O erro tem que apontar para a configuração, não para o banco.

`ingestao-memoria.ts` implementa o mesmo port guardando tudo em arrays, e expõe o que aconteceu (`entregas`, `ingeridos`, `falhas`) para o teste da Task 7 asseverar sobre estado, e não com spy.

- [ ] **Step 4: Escrever os testes de `processarEntrega`, e vê-los falhar**

`processar.test.ts`, com `InMemoryIngestaoStore` + `MetaGraphFalso`. Sem banco e sem rede. Casos:

1. **Meta, caminho feliz:** busca o lead no Graph com o token recebido, mapeia, chama `ingerirLead` com os dados mapeados, e não registra falha.
2. **Meta sem token registra falha** e **não** chama o Graph (afirme sobre `MetaGraphFalso.buscados`, que tem que continuar vazio). Um `buscarLead` sem token bateria no Graph com credencial vazia.
3. **Falha do Graph vira `registrarFalha` com o código de erro,** e `ingerirLead` **não** é chamado.
4. **A campanha é best-effort:** com `falharEm = 'campanhaDoAnuncio'`, o lead é ingerido do mesmo jeito e `campanhaOrigem` cai para o `ad_id` cru. Nenhum lead se perde por causa do nome da campanha.
5. **Sem `ad_id` no payload, nem tenta buscar campanha** e ingere normalmente.
6. **Google não toca o Graph:** processa o payload direto e `MetaGraphFalso.buscados` continua vazio.
7. **Falha do `ingerirLead` vira `registrarFalha`.**
8. **`ingerirLead` devolvendo `ja_processado` não é falha** — é o caminho normal de uma corrida entre o `after()` e o cron, e registrá-lo como falha faria o contador de tentativas subir sozinho até a desistência.

Rode `npx vitest run --config vitest.config.ts src/lib/ingestao/processar.test.ts`.
Esperado: FAIL.

- [ ] **Step 5: Implementar `processarEntrega`**

A ordem importa e é o entregável: Graph (só no Meta) → mapeia → campanha best-effort → `ingerirLead`. Qualquer falha antes do `ingerirLead` termina em `registrarFalha` e retorna — nunca ingere com dado pela metade.

Rode o teste do Step 4. Esperado: PASS.

- [ ] **Step 6: Escrever os testes da rota, e vê-los falhar**

Em `route.test.ts`, chamando os handlers exportados diretamente com `Request`/`NextRequest` construídos à mão. Casos:

1. **`GET` com `hub.verify_token` correto devolve 200 com o `hub.challenge` no corpo, como texto puro.** O Meta compara byte a byte; JSON aqui reprova a verificação.
2. **`GET` com token errado devolve 403 e não devolve o challenge.**
3. **`GET` com `META_VERIFY_TOKEN` não configurado devolve 403,** nunca 200 — falha fechado.
4. **`POST` sem `X-Hub-Signature-256` devolve 401 e não grava nada** (afirme sobre o store em memória).
5. **`POST` com assinatura inválida devolve 401 e não grava nada.**
6. **`POST` com assinatura válida devolve 200 e registra uma entrega por `changes[].value`.**
7. **`POST` com assinatura válida e corpo com dois `entry` registra as duas entregas.**
8. **`change.field` diferente de `leadgen` é ignorado** — o mesmo webhook do Meta entrega outros campos, e tratá-los como lead cria card de nada.
9. **`POST` com corpo que não é JSON válido devolve 200 e não grava** — só depois da assinatura ter passado. Um 500 aqui faria o Meta retentar em rajada um corpo que nunca vai funcionar.
10. **A verificação da assinatura acontece sobre o corpo cru.** Prove com um corpo cuja reserialização difere do original (espaço extra, ordem de chave diferente): a assinatura calculada sobre o cru passa. Se o handler ler `req.json()` e reserializar, este caso fica vermelho — é a única defesa contra o modo de falha mais clássico desta integração.

Rode `npx vitest run --config vitest.config.ts src/app/api/webhooks/meta/route.test.ts`.
Esperado: FAIL.

- [ ] **Step 7: Implementar a rota**

Estrutura obrigatória do `POST`, nesta ordem — a ordem é o entregável e é o que os testes 4, 5 e 10 protegem:

```ts
const cru = await req.text()
if (!assinaturaValida(cru, req.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET ?? '')) {
  return new Response(null, { status: 401 })
}
```

Só depois disso `JSON.parse(cru)`. Para cada `entry[].changes[]` com `field === 'leadgen'`, chame `registrarEntrega` com `externalId = value.leadgen_id` e `chaveDaFonte = value.page_id`. Colete os retornos, **responda 200**, e só então agende o processamento com `after()` do `next/server`, uma chamada de `processarEntrega` por retorno de status `pendente`.

Uma entrega que falhe ao registrar **não** pode derrubar as outras do mesmo lote nem mudar o 200.

Rode o teste do Step 6. Esperado: PASS.

- [ ] **Step 8: Suíte e commit**

```bash
npm test && npm run test:integration && npm run typecheck && npm run lint && npm run build
git add src/lib/data/ingestao.ts src/lib/data/ingestao-memoria.ts src/lib/ingestao/processar.ts src/lib/ingestao/processar.test.ts src/app/api/webhooks/meta/ src/middleware.ts
git commit -m "feat: webhook do Meta com assinatura verificada e processamento em after()"
```

---

## Task 8: O webhook do Google

**Files:**
- Create: `src/app/api/webhooks/google/[token]/route.ts`
- Create: `src/app/api/webhooks/google/[token]/route.test.ts`

**Interfaces:**
- Consumes: `criarIngestaoStore`, `processarEntrega` (Task 7), `mapearLeadDoGoogle` (Task 6).
- Produces: a URL que `conectarGoogleAction` já monta desde o Plano 3 — `${origem}/api/webhooks/google/${urlToken}` (`acoes-fontes.ts:126`). **A rota tem que casar com esse caminho exatamente**, porque a URL já está no texto que a tela manda o cliente colar no Google Ads.

- [ ] **Step 1: Escrever os testes da rota, e vê-los falhar**

Casos:

1. **Payload válido registra a entrega** com `externalId = body.lead_id`, `chaveDaFonte` igual ao token do caminho, e `googleKey = body.google_key`.
2. **Devolve 200 mesmo quando a fonte é desconhecida.** Um 404 seria oráculo de quais URLs estão ativas, e o Google marca a integração como quebrada em resposta não-200.
3. **Devolve 200 para `is_test`** e não dispara processamento (a entrega volta como `ignorado`).
4. **Corpo que não é JSON devolve 200 e não grava.**
5. **`lead_id` ausente devolve 200 e não grava** — sem `external_id` não há chave de idempotência, e inventar uma faria reenvio virar card duplicado.
6. **Entrega `pendente` dispara `processarEntrega`; entrega `ignorado` ou `duplicado` não dispara.**
7. **O token do caminho nunca aparece na resposta,** em nenhum dos casos — nem em mensagem de erro. Ele é o segredo que resolve a conta.

Rode `npx vitest run --config vitest.config.ts src/app/api/webhooks/google/`.
Esperado: FAIL.

- [ ] **Step 2: Implementar a rota**

`params` é `Promise` no Next 15 — `const { token } = await params`.

Não há assinatura a verificar: quem autoriza é o token da URL, e a conferência do `google_key` acontece dentro de `registrar_entrega` (Task 3), no mesmo lugar que resolve a conta. Não duplique essa conferência aqui; duas cópias divergem, e a de dentro do banco é a que tem acesso ao hash.

Rode o teste do Step 1. Esperado: PASS.

- [ ] **Step 3: Suíte e commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build
git add src/app/api/webhooks/google/
git commit -m "feat: webhook do Google resolvido pelo token da URL"
```

---

## Task 9: Reprocessamento e cron

**Files:**
- Create: `src/app/api/webhooks/reprocessar/route.ts`
- Create: `src/app/api/webhooks/reprocessar/route.test.ts`
- Create: `vercel.json`
- Modify: `.env.local.example` (comentário do `CRON_SECRET`)

**Interfaces:**
- Consumes: `entregasPendentes` e `processarEntrega`.
- Produces: `GET /api/webhooks/reprocessar`, gateada por `Authorization: Bearer ${CRON_SECRET}`.

**Por que `GET` e não `POST`:** o Vercel Cron invoca o endpoint com `GET`. Um handler só de `POST` nunca seria chamado, e a falha seria completamente silenciosa — nada no painel diz "seu cron bate numa rota que não responde a esse método".

- [ ] **Step 1: Escrever os testes, e vê-los falhar**

1. **Sem cabeçalho `Authorization` devolve 401** e não processa nada.
2. **Com `Bearer` errado devolve 401.**
3. **Com `CRON_SECRET` não configurado devolve 401 mesmo com um cabeçalho que casaria com string vazia.** Falha fechado, mesma regra do `appSecret` vazio da Task 6.
4. **Com o segredo certo, processa cada entrega devolvida por `entregasPendentes`** e responde com um resumo em JSON contando processadas e falhadas.
5. **Uma entrega que falha não interrompe as seguintes.** Este é o ponto: a varredura existe justamente porque coisas falham, e uma exceção no meio do lote deixaria a fila parada esperando a próxima janela do cron.
6. **A comparação do segredo é em tempo constante** — o teste que garante isso é de leitura, não de execução; o que o caso automatizado verifica é que segredo certo passa e errado não. Registre no comentário do código que `timingSafeEqual` é obrigatório aqui, com pré-checagem de tamanho, porque `CRON_SECRET` **é** segredo portador (diferente do `conta.id` do `tokenDaConta`, onde `!==` foi julgado correto no Plano 3 justamente por não ser segredo).

Rode `npx vitest run --config vitest.config.ts src/app/api/webhooks/reprocessar/`.
Esperado: FAIL.

- [ ] **Step 2: Implementar a rota**

Limite fixo por invocação (20 é razoável): a plataforma mata o handler por tempo, e uma varredura sem limite tenta esvaziar a fila inteira numa execução e não termina nenhuma.

- [ ] **Step 3: Escrever o `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/webhooks/reprocessar",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

Comentário obrigatório no README (a Task 10 mexe nele de qualquer forma): **no plano Hobby da Vercel o cron roda no máximo uma vez por dia**, independentemente do que estiver escrito aqui. A cadência de 10 minutos só vale a partir do plano Pro. A rota continua invocável à mão com o `CRON_SECRET`, e é assim que se esvazia a fila num incidente antes de haver plano pago.

- [ ] **Step 4: Suíte e commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build
git add src/app/api/webhooks/reprocessar/ vercel.json .env.local.example
git commit -m "feat: varredura de reprocessamento gateada no CRON_SECRET"
```

---

## Task 10: Fechar o squat de Page — posse provada e reivindicação

Esta é a task que levanta o portão de deploy do `README.md`. Enquanto ela não estiver verde, o Plano 3 continua proibido de ir para URL pública.

**Files:**
- Create: `supabase/migrations/0012_posse_da_page.sql`
- Create: `tests/integration/0012_posse_da_page.test.ts`
- Modify: `tests/integration/0008_fontes_conectadas.test.ts`
- Modify: `src/lib/data/fontes.ts`
- Modify: `src/app/(app)/config/acoes-fontes.ts`
- Modify: `src/app/(app)/config/acoes-fontes.test.ts`
- Modify: `src/app/(app)/config/integracoes.tsx`
- Modify: `src/app/(app)/config/erros.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `conectar_fonte_meta(p_segredo text, p_account_id uuid, p_page_id text, p_nome text, p_token text, p_responsavel uuid)` — assinatura nova, com o segredo **em primeiro lugar**.
- Produces: `reivindicar_fonte_meta(p_segredo text, p_account_id uuid, p_page_id text, p_nome text, p_token text, p_responsavel uuid) returns uuid`.
- Produces, no `FonteStore`: `reivindicarMeta(pageId, nome, tokenDaPagina, responsavelId)`, mesma forma de `conectarMeta`.
- Consumes: `segredo_confere` (Task 3), `posseDaPagina` (Task 5).

**O desenho, e por que as duas metades são obrigatórias.** O banco não tem como chamar o Graph API, então ele não consegue provar posse sozinho; e a aplicação sozinha não adianta, porque a RPC é alcançável direto pelo PostgREST. Então: (1) as RPCs passam a exigir o segredo de ingestão, o que tira a chamada do alcance de quem só tem uma sessão válida; (2) a Server Action chama `posseDaPagina` antes de gravar. Trocar só uma das metades reabre o buraco — sem (1) qualquer um chama a RPC direto, sem (2) o segredo autoriza um squat igualzinho, só que pela tela.

- [ ] **Step 1: Escrever os testes de integração, e vê-los falhar**

`tests/integration/0012_posse_da_page.test.ts`:

1. **`conectar_fonte_meta` com a assinatura antiga de 5 argumentos não existe mais.** `to_regprocedure('public.conectar_fonte_meta(uuid,text,text,text,uuid)') is null`. Sem isto o `create or replace` teria deixado as duas versões vivas e a antiga continuaria sendo a porta aberta.
2. **`conectar_fonte_meta` com segredo errado levanta `segredo_invalido`,** mesmo sendo chamada por um admin legítimo da conta.
3. **`conectar_fonte_meta` com segredo certo e admin legítimo continua funcionando** e ainda grava a credencial — a mudança não pode ter quebrado o caminho feliz do Plano 3.
4. **`conectar_fonte_meta` com segredo certo, chamada por quem não é admin da conta, continua levantando `sem_permissao`.** As duas checagens são cumulativas, não alternativas.
5. **`reivindicar_fonte_meta` toma a linha de outra conta:** com a Page conectada à conta A, uma reivindicação pela conta B deixa exatamente uma linha, pertencente a B, e a credencial antiga desaparece.
6. **A reivindicação preserva o histórico:** as linhas de `integration_log` da conta A continuam existindo, com `source_id` nulo (é o `on delete set null` da `0009`) e `account_id` intacto.
7. **`reivindicar_fonte_meta` sem segredo levanta `segredo_invalido`;** sem sessão, `sem_sessao`; por não-admin da conta alvo, `sem_permissao`.
8. **`reivindicar_fonte_meta` com `page_id` vazio ou só espaço levanta `page_id_invalido`.**
9. **`conectar_fonte_google` continua com a assinatura de 5 argumentos e sem segredo.** Registro deliberado: não há vetor de squat no Google — `external_id` é sempre nulo, o índice global não a alcança, e o token é gerado no servidor. Este teste existe para que a assimetria seja decisão registrada, e não esquecimento.

`tests/integration/0008_fontes_conectadas.test.ts` precisa passar a chamar a RPC com o argumento novo; **não afrouxe nenhuma asserção existente lá** — se algum caso ficar vermelho por outro motivo que não a assinatura, pare e reporte.

Rode `npm run test:integration -- tests/integration/0012_posse_da_page.test.ts`.
Esperado: FAIL.

- [ ] **Step 2: Escrever a migration**

```sql
-- Sub-projeto 2, Plano 4: fecha o squat de Page ID que a 0008 aceitou com dono.
--
-- O BURACO: conectar_fonte_meta provava que o chamador e admin da conta que ele
-- mesmo passou, e nada mais. p_page_id era texto arbitrario, page ids sao
-- informacao publica, e funcao no Postgres nasce com execute para public —
-- entao qualquer pessoa que fizesse signup travava a Page de um concorrente
-- para sempre, direto pelo PostgREST, sem passar por tela nenhuma. A vitima
-- recebia page_ja_conectada para sempre e nao tinha recurso: nao enxerga nem
-- apaga a linha do invasor. Risco aceito conscientemente no Plano 3, com dono
-- registrado (spec, "Risco nomeado: squat de Page ID em conectar_fonte_meta").
--
-- O CONSERTO tem duas metades, e nenhuma das duas sozinha resolve:
--
--   1. AQUI: as duas funcoes passam a exigir o segredo de ingestao. Isso nao
--      prova posse — o banco nao tem como chamar o Graph API — mas tira a RPC
--      do alcance de quem so tem uma sessao valida. So o servidor chama.
--
--   2. NA APLICACAO (src/app/(app)/config/acoes-fontes.ts): antes de chamar, a
--      Server Action pede ao Graph que confirme que aquele token administra
--      aquela Page (MetaGraph.posseDaPagina, que compara /me com o page id).
--      E o servidor que prova posse; o segredo e o que amarra a prova a chamada.
--
-- Trocar so uma das metades reabre o buraco: sem (1) qualquer um chama a RPC
-- direto, sem (2) o segredo autoriza um squat igualzinho, so que pela tela.
--
-- conectar_fonte_google NAO ganha segredo, de proposito: external_id e sempre
-- nulo la, entao o indice unico global nem alcanca essas linhas, e o token da
-- URL e gerado no servidor. Nao ha Page de terceiro a travar. A assimetria e
-- decisao registrada, com teste que a afirma.

-- drop, e nao create or replace: a assinatura mudou, e replace com lista de
-- argumentos diferente CRIA UMA SOBRECARGA em vez de substituir. As duas
-- versoes conviveriam e a antiga continuaria sendo a porta aberta.
drop function public.conectar_fonte_meta(uuid, text, text, text, uuid);

create or replace function public.conectar_fonte_meta(
  p_segredo text,
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
  -- Primeiro portao: so o servidor chega aqui.
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  -- Os tres seguintes sao os da 0008, inalterados: cumulativos, nao
  -- alternativos. O segredo prova QUEM chamou; estes provam por conta de quem.
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
  exception
    when unique_violation then
      -- Continua sendo o desfecho certo para conectar: quem chega segundo NAO
      -- toma a linha em silencio. Tomar e ato explicito, e e a funcao abaixo.
      raise exception 'page_ja_conectada';
    when check_violation then
      raise exception 'page_id_invalido';
  end;

  insert into public.source_credentials (source_id, meta_page_token)
  values (v_id, p_token);

  return v_id;
end;
$$;

-- O caminho de reivindicacao que o portao de deploy do README exige. Quem
-- apresenta posse comprovada da Page toma a linha de quem estava la antes,
-- inclusive de outra conta — a unica saida para uma Page squattada antes desta
-- migration existir, e a razao de o portao poder ser levantado.
--
-- Apaga e reinsere, em vez de dar update no account_id: source_credentials cai
-- pelo `on delete cascade` da PK e o token do dono anterior morre junto. Um
-- update deixaria o token velho apontando para a conta nova, o que e
-- exatamente o "entregar lead para a conta errada" que tudo isto existe para
-- impedir.
--
-- integration_log sobrevive: source_id e `on delete set null` (0009) e
-- account_id fica intacto, entao o historico de entregas do dono anterior
-- continua visivel para ele.
create or replace function public.reivindicar_fonte_meta(
  p_segredo text,
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
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_page_id is null or btrim(p_page_id) = '' then
    raise exception 'page_id_invalido';
  end if;

  delete from public.lead_sources
   where provedor = 'meta' and external_id = p_page_id;

  insert into public.lead_sources
    (account_id, provedor, external_id, nome, responsavel_padrao_id)
  values (p_account_id, 'meta', p_page_id, p_nome, p_responsavel)
  returning id into v_id;

  insert into public.source_credentials (source_id, meta_page_token)
  values (v_id, p_token);

  return v_id;
end;
$$;
```

- [ ] **Step 3: Rodar reset e os testes de integração**

```bash
npx supabase db reset
npm run test:integration
```

Esperado: PASS, incluindo o arquivo da `0008` já ajustado.

- [ ] **Step 4: Escrever os testes da Server Action, e vê-los falhar**

Em `src/app/(app)/config/acoes-fontes.test.ts`, seguindo o padrão que o arquivo já usa:

1. **Caminho feliz:** `conectarPaginaAction` chama `posseDaPagina` **antes** de gravar, e o registro acontece.
2. **Posse não comprovada recusa com `posse_nao_comprovada`, não grava, e não assina o leadgen.** Afirme sobre `MetaGraphFalso.assinadas`, que tem que continuar vazio: assinar uma Page cuja posse não foi provada é exatamente o dano que esta task existe para impedir.
3. **`reivindicarPaginaAction` exige posse do mesmo jeito** e recusa com o mesmo código quando ela falha.
4. **Backlog do Plano 3, fechado aqui:** um caso de caminho feliz afirmando `expect(metaFalso().desassinadas).toEqual([])`. Hoje nada prova que a compensação de `desassinarLeadgen` (`acoes-fontes.ts:101`) está **dentro** do ramo de falha. Se um refactor a içar para fora, todo connect bem-sucedido desassinaria o leadgen na hora e **nenhum lead chegaria jamais** — silenciosamente, sem nada no repo ficando vermelho. Uma linha resolve.
5. **Backlog do Plano 3, fechado aqui:** com `falharEm = 'desassinarLeadgen'` num caso em que `conectarMeta` falha, o erro que volta é o **original** de `conectarMeta`, não o da compensação. É a propriedade da qual um operador depende ao ler a mensagem na tela.

Esperado: FAIL.

- [ ] **Step 5: Implementar o lado da aplicação**

Em `fontes.ts`: `conectarMeta` passa `p_segredo` lendo `process.env.INGESTAO_SEGREDO`; `reivindicarMeta` nasce com a mesma forma. Acrescente `segredo_invalido` e `posse_nao_comprovada` à lista `CODIGOS` (`fontes.ts:38-46`), senão o código chega cru à tela.

Em `acoes-fontes.ts`: `posseDaPagina` entra **antes** do `assinarLeadgen`, não depois. `reivindicarPaginaAction` repete a mesma sequência e chama `reivindicarMeta`.

Em `erros.ts`: mensagens para `posse_nao_comprovada` ("Não conseguimos confirmar no Facebook que essa página é sua."), `segredo_invalido` ("A ingestão não está configurada neste ambiente. Fale com o suporte.") e `ingestao_nao_configurada` (mesma mensagem).

Em `integracoes.tsx`: quando uma tentativa de conectar volta `page_ja_conectada`, ofereça o botão de reivindicar, com texto que diga o que vai acontecer — a página sai da outra conta do CRM e passa para esta. Ação destrutiva para um terceiro tem que ser escolha consciente, não um "tentar de novo".

Esperado: PASS.

- [ ] **Step 6: Levantar o portão do README**

Substitua a seção "Antes de expor em produção" (`README.md:3-5`). O que ela deve passar a dizer:

- O squat está fechado, e como: segredo de ingestão nas RPCs de conexão, mais prova de posse contra o Graph antes de gravar.
- O caminho de reivindicação existe e quem pode usá-lo.
- O que **continua** sendo pré-requisito de produção: `INGESTAO_SEGREDO` definido por SQL no painel (nunca versionado — o valor do `seed.sql` é público), `META_VERIFY_TOKEN` e `CRON_SECRET` configurados, e `META_FAKE` **ausente** no ambiente de produção.
- O runbook de operador continua válido como saída de emergência, e não some.

Não apague a história: quem ler o README daqui a seis meses precisa entender que houve um risco aceito e o que exatamente o fechou.

- [ ] **Step 7: Suíte inteira e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint && npm run build
git add supabase/migrations/0012_posse_da_page.sql tests/integration/ src/lib/data/fontes.ts src/app/\(app\)/config/ README.md
git commit -m "feat: fecha o squat de Page com posse provada e caminho de reivindicacao"
```

---

## Task 11: O sino — notificação em tempo real

**Files:**
- Create: `src/lib/data/notificacoes.ts`
- Create: `src/app/(app)/acoes-notificacoes.ts`
- Create: `src/app/(app)/sino.tsx`
- Create: `tests/integration/notificacoes-store.test.ts`
- Create: `tests/e2e/sino.spec.ts`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `NotificacaoStore` com `listar(limite: number): Promise<Resultado<Notificacao[]>>`, `naoLidas(): Promise<Resultado<number>>`, `marcarLida(id: string)`, `marcarTodasLidas()`.
- Produces: `Notificacao = { id: string; leadId: string; leadNome: string; tipo: 'novo_lead' | 'lead_reincidente'; lidaEm: Date | null; criadoEm: Date }`.
- Consumes: `notifications` e a policy `notifications_dono_select` (Task 2).

**A regra que não pode ser quebrada aqui:** quando chega notificação, o quadro se atualiza por `router.refresh()`. **Não** insira o card no cliente. É a lição do `useState(props)` da Task 1 do Plano 2 — componente cliente que copia estado do servidor nunca mais reconcilia, e insistir custaria o mesmo bug outra vez.

- [ ] **Step 1: Escrever os testes de integração do store, e vê-los falhar**

`tests/integration/notificacoes-store.test.ts`, com `clienteDoUsuario` de `helpers/cliente.ts`:

1. Vendedor lista só as próprias notificações, com o nome do lead junto.
2. Vendedor B não vê nem consegue marcar como lida a notificação de A.
3. `naoLidas()` conta só as de `lida_em` nulo do próprio usuário.
4. `marcarLida` carimba `lida_em` e é idempotente.
5. `marcarTodasLidas` não toca notificação de outro usuário.

Rode `npm run test:integration -- tests/integration/notificacoes-store.test.ts`.
Esperado: FAIL.

- [ ] **Step 2: Implementar o store e as Server Actions**

O join com `leads(nome)` só devolve o que a RLS de `leads` permitir. Se o lead ficou invisível para o usuário, a notificação aparece sem nome, e não deve quebrar — trate como `null` e mostre um rótulo genérico.

Esperado: PASS.

- [ ] **Step 3: Montar o sino no layout**

`layout.tsx` já resolve o store do servidor (`:6`); a contagem inicial e a lista vêm daí, no servidor. O `sino.tsx` é cliente e recebe as duas por prop — **derivadas a cada render, nunca copiadas para `useState`**.

A assinatura do Realtime:

```ts
const cliente = criarClienteNavegador()
const canal = cliente
  .channel('notificacoes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
    router.refresh()
  })
  .subscribe()
return () => { void cliente.removeChannel(canal) }
```

Sem `filter` de propósito: **a RLS é o filtro**. `notifications_dono_select` já restringe a `usuario_id = auth.uid()`, e o Realtime avalia a policy por assinante. Um filtro no cliente aqui seria redundante no melhor caso e mentiria sobre onde mora a garantia no pior.

A limpeza no `return` do `useEffect` não é opcional: sem `removeChannel`, cada navegação soft deixa um canal aberto e o `router.refresh()` passa a disparar N vezes por notificação.

- [ ] **Step 4: Escrever o E2E do sino, e vê-lo falhar**

Nesta altura as Tasks 1 a 10 estão prontas, inclusive o webhook do Google — então o sino dá para provar automatizado, e esta task não fecha com o entregável principal só em verificação manual.

`tests/e2e/sino.spec.ts`:

1. `criarConta(page)` — o admin recém-criado é o único membro, então ele mesmo é o responsável.
2. Em `/config`, gere a URL do Google e capture URL e chave. Defina o responsável padrão da fonte como o próprio admin, **esperando a resposta POST da Server Action** — o `selectOption` só espera o evento de DOM, e o passo seguinte passa na frente da escrita (é a corrida que o Plano 3 encontrou; o padrão correto já existe em `tests/e2e/funil.spec.ts`).
3. Vá para `/funil` e **fique lá**, sem navegar nem recarregar.
4. Com `request.post` do Playwright, poste um lead na URL capturada, com a chave capturada e `lead_id` único (`carimbo()` de `tests/e2e/apoio.ts`).
5. **Asserção positiva:** o indicador de não-lidas do sino aparece **sem reload**, com timeout generoso. É o Realtime disparando `router.refresh()`.
6. Abrir o painel do sino mostra a entrada, e ela linka para a ficha daquele lead.

Rode `npm run test:e2e -- sino.spec.ts`, com o `npm run dev` derrubado antes.
Esperado: FAIL.

**Se o sino não acender, o suspeito número um é o token de autenticação do Realtime:** o canal precisa da sessão para a RLS ser avaliada com `auth.uid()` preenchido. Sem sessão o assinante é `anon`, `notifications_dono_select` nega tudo, e o sintoma é exatamente "não chega nada, sem erro nenhum". Se for o caso, chame `cliente.realtime.setAuth(...)` com o token da sessão antes de `subscribe()`, e **escreva no código por que a linha existe** — é o tipo de linha que alguém apaga por parecer supérflua.

- [ ] **Step 5: Experimento de discriminação**

Prove que a asserção 5 discrimina: remova a assinatura do Realtime, rode, confirme o vermelho, restaure. **Não substitua isto por leitura de código.** No Plano 3, duas leituras independentes concluíram que asserções discriminavam e as duas estavam erradas; o que separou foi rodar o experimento.

- [ ] **Step 6: Verificação manual do isolamento entre usuários**

O E2E acima prova que a notificação **chega** a quem deve. Que ela **não chega** a quem não deve está coberto no nível do banco pelo caso 2 do teste de integração (vendedor B não lê a notificação de A), que é onde a garantia realmente mora — a policy é o roteamento.

Confirme uma vez à mão, com dois navegadores (um normal e um anônimo), que o Realtime respeita isso na prática: admin numa janela, vendedor na outra, ambos em `/funil`, ingestão com o vendedor como responsável. O sino do vendedor acende; o do admin não. **Confirme o "não acende" depois de ter visto o do vendedor acender, nunca antes** — asserção negativa observada antes de a mudança chegar não afirma nada.

- [ ] **Step 7: Suíte e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint && npm run build
git add src/lib/data/notificacoes.ts src/app/\(app\)/sino.tsx src/app/\(app\)/acoes-notificacoes.ts src/app/\(app\)/layout.tsx tests/integration/notificacoes-store.test.ts tests/e2e/sino.spec.ts
git commit -m "feat: sino de notificacoes com roteamento por RLS no Realtime"
```

---

## Task 12: Diagnóstico — as últimas entregas na tela de Integrações

É o que transforma "não está chegando lead" de mistério em diagnóstico, e é a razão de o log ser visível na UI e não só no banco.

**Files:**
- Create: `src/app/(app)/config/entregas.tsx`
- Modify: `src/lib/data/fontes.ts`
- Modify: `src/app/(app)/config/page.tsx`
- Modify: `src/app/(app)/config/integracoes.tsx`
- Modify: `src/app/(app)/funil/novo-lead.tsx`
- Create: `tests/integration/entregas-recentes.test.ts`

**Interfaces:**
- Produces: `FonteStore.entregasRecentes(limite: number): Promise<Resultado<Entrega[]>>`, com `Entrega = { id, provedor, externalId, status, erro, tentativas, leadId, criadoEm, processadoEm }`.
- Consumes: o grant coluna-restrito da Task 2. **`select *` aqui devolve `42501`** — a consulta tem que listar colunas, exatamente como `SupabaseFonteStore.listar` já faz (`fontes.ts:83`).

- [ ] **Step 1: Escrever o teste de integração, e vê-lo falhar**

1. Admin lê as entregas da própria conta, mais recentes primeiro, respeitando o limite.
2. Entregas de outra conta não aparecem.
3. Entrega com `account_id` nulo não aparece para ninguém.
4. **`payload_bruto` não é alcançável pelo store** — um `select` que o inclua falha com `42501`. É o teste que impede alguém de "simplificar" a lista de colunas para `*` no futuro.

Esperado: FAIL.

- [ ] **Step 2: Implementar o store e a tela**

O painel mostra: provedor, status, quando chegou, e o erro quando houver. Traduza o status para texto do domínio, não mostre o rótulo do enum cru. `fonte_nao_encontrada` e `chave_invalida` são os dois erros que o cliente vai realmente ver, e a mensagem deles tem que dizer o que fazer — conferir o Page ID conectado, no primeiro caso, e reconferir a chave colada no Google Ads, no segundo.

Quando não houver nenhuma entrega, diga isso explicitamente e diga o que significa: o webhook ainda não chegou nenhuma vez. Painel vazio sem explicação é o mesmo mistério que ele existe para resolver.

- [ ] **Step 3: Fechar o item de backlog do `novo-lead.tsx`**

`src/app/(app)/funil/novo-lead.tsx` tem um mapa `MENSAGENS` próprio, separado de `funil/erros.ts`, **sem entrada para `responsavel_invalido`**. Era baixo risco enquanto só um dropdown de membros reais alimentava o campo. A partir deste plano, `ingerir_lead` grava `responsavel_id` sem humano no meio, e o código cru pode chegar à tela.

Acrescente a entrada. Não refatore as quatro convenções de erro do repo aqui — isso é o backlog #8 do Plano 2 e não é escopo desta task.

- [ ] **Step 4: Suíte e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint && npm run build
git add src/app/\(app\)/config/ src/lib/data/fontes.ts src/app/\(app\)/funil/novo-lead.tsx tests/integration/entregas-recentes.test.ts
git commit -m "feat: painel de entregas recentes na tela de Integracoes"
```

---

## Task 13: E2E — do webhook ao card, sem reload

**Files:**
- Create: `tests/e2e/ingestao.spec.ts`
- Modify: `tests/e2e/global-setup.ts` (limpar também as fontes Google e os logs das rodadas anteriores)

**Interfaces:**
- Consumes: tudo. É a prova de que as peças se encaixam.

**Restrição herdada:** o webhook do Meta exige URL pública HTTPS, então **nenhum E2E exercita o caminho do Meta ponta a ponta**. O E2E usa o Google, cujo endpoint aceita um `POST` local. O caminho do Meta é coberto por unitários de rota (Task 7), integração das RPCs (Tasks 3 e 4) e verificação manual documentada.

- [ ] **Step 1: Tornar a suíte re-executável**

O `global-setup.ts` hoje apaga só as três Pages falsas. As fontes Google criadas por este teste novo têm `external_id` nulo e nome variável, e o `integration_log` acumula linhas com `external_id` único por rodada.

O `external_id` único por rodada é justamente o que impede colisão, então o log **não** precisa ser limpo para a suíte passar duas vezes. As fontes Google, sim, acumulam. Apague-as pelo padrão de nome que o teste usa (o `carimbo()` de `tests/e2e/apoio.ts` já dá unicidade; use um prefixo fixo e reconhecível no nome da fonte).

- [ ] **Step 2: Escrever o teste, e vê-lo falhar**

`tests/e2e/ingestao.spec.ts`, um fluxo:

1. `criarConta(page)` — o admin recém-criado é o único membro, então ele mesmo será o responsável.
2. Vá a `/config`, preencha o nome do formulário e clique em "Gerar URL do Google". Capture a URL e a chave da caixa de aviso.
3. Defina o responsável padrão da fonte como o próprio admin. **Espere a resposta POST da Server Action**, não só o evento de `selectOption` — o `selectOption` só espera o DOM, e o passo seguinte passa na frente da escrita. É a corrida que o Plano 3 encontrou, e o padrão correto já existe em `tests/e2e/funil.spec.ts`.
4. Vá para `/funil` e **fique lá**.
5. Com `request.post` do Playwright, poste na URL capturada um payload de lead do Google, com a chave capturada e `lead_id` único (use `carimbo()`).
6. **Asserção positiva primeiro:** o card com o nome do lead aparece na coluna "Novo lead" **sem reload**, com timeout generoso. É o Realtime disparando `router.refresh()`. Esta asserção é a que dá segurança para todas as seguintes.
7. Poste **de novo**, com `lead_id` diferente e o mesmo telefone. Espere a asserção positiva de que a timeline do lead existente ganhou o evento de reingestão, e **só então** afirme que continua havendo um card só com aquele nome. Nunca o contrário — asserção negativa antes da mudança chegar passa observando o instante anterior.
8. Vá a `/config` e confirme que as duas entregas aparecem no painel, com status de processado.

O sino **não** é asserido aqui: a Task 11 já o cobre em `tests/e2e/sino.spec.ts`, e repetir a asserção em dois arquivos faz os dois falharem juntos pelo mesmo motivo sem dizer nada a mais.

Rode `npm run test:e2e -- ingestao.spec.ts` (com o `npm run dev` derrubado antes).
Esperado: FAIL, e por motivo relacionado ao que falta, não por setup.

- [ ] **Step 3: Fazer passar, sem afrouxar asserção**

Se alguma asserção ficar vermelha, **conserte o produto, não o teste**. Foi essa regra que fez o Plano 2 encontrar um empate de ordenação real e o Plano 3 encontrar uma corrida ditada pelo próprio plano. Se você concluir que a asserção está errada, pare e reporte em vez de enfraquecê-la.

- [ ] **Step 4: Experimento de discriminação**

Para as asserções 6 e 7, prove que discriminam: quebre o comportamento de propósito (remova a assinatura do Realtime para a 6; remova o ramo de dedup do `ingerir_lead` para a 7), rode, confirme o vermelho, restaure.

**Este passo não é opcional e não pode ser substituído por leitura.** No Plano 3, duas leituras independentes de código concluíram que duas asserções discriminavam, e as duas estavam erradas — o que separou foi rodar o experimento. Rode uma asserção por vez: o Playwright aborta no primeiro `expect` que falha, então um experimento com as três juntas só valida a primeira.

- [ ] **Step 5: Suíte inteira, duas vezes seguidas**

```bash
npx supabase db reset
npm test && npm run test:integration && npm run typecheck && npm run lint && npm run build
npm run test:e2e
npm run test:e2e
```

A segunda rodada de E2E **sem reset de banco no meio** é obrigatória: é o portão de re-executabilidade que o Plano 3 estabeleceu, e é o que pega estado acumulado que o `global-setup` não limpa.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/
git commit -m "test: E2E do webhook do Google ao card e ao sino"
```

---

## Verificação manual pendente ao fim do plano

Nada disto é coberto por teste automatizado, por decisão de design da spec (nenhum teste toca a rede). Fazer em deploy de preview da Vercel ou túnel, com `META_FAKE` **desligado**:

1. **Verificação do webhook no painel do Meta.** Cadastre a URL `/api/webhooks/meta` e o `META_VERIFY_TOKEN`; o `GET` tem que devolver o challenge e o painel aceitar. Confirme que a resposta é texto puro — JSON reprova.
2. **Lead de teste pelo painel do Meta** ("Ferramenta de teste de anúncios de cadastro"): confirme o card no funil, com origem e campanha preenchidas, e o log `processado` em `/config`.
3. **"Enviar dados de teste" do Google Ads:** confirme que aparece em `/config` como `ignorado` com `lead_de_teste`, e que **nenhum card** foi criado.
4. **Lead real do Google Ads:** confirme card, responsável e sino.
5. **`META_REDIRECT_URI`** no painel do Meta bate exatamente com a URL do ambiente — divergência de barra final já derruba a troca do `code`.
6. **`posseDaPagina` contra o Graph real:** confirme que `/me` com um token de página devolve o id daquela página. É a única parte do fechamento do squat que nenhum teste automatizado exercita contra o provedor.
7. **Cron:** confirme no painel da Vercel que a invocação chega com o `Authorization` esperado, e lembre que no plano Hobby a cadência real é diária.

---

## Autorrevisão (feita ao escrever este plano)

**Cobertura da spec, seção por seção.**

| Spec | Onde é implementado |
|---|---|
| §3 `integration_log`, `notifications` | Task 2 |
| §3 leads ingeridos na primeira etapa | Task 4 (com o refinamento de "primeira etapa **aberta**") |
| §4 modelo de privilégio, segredo de ingestão | Tasks 1 e 3 |
| §4 superfície de funções | Tasks 3, 4 e 10 |
| §5 fluxo do Meta, 5 passos | Tasks 5, 6 e 7 |
| §5 fluxo do Google, 3 passos | Tasks 3 e 8 |
| §5 `ingerir_lead`, 5 passos | Task 4 |
| §5 reprocessamento com backoff | Tasks 3 e 9 |
| §6 caminho de reivindicação | Task 10 |
| §6 `/config` mostra as últimas entregas | Task 12 |
| §7 notificações e `router.refresh()` | Task 11 |
| §8 todos os casos de erro | Tasks 3, 7, 8 |
| §9 backlog #3, #4, #9, #10 | Fechados no Plano 3; a reafirmação do #4 dentro do definer está na Task 4 |
| §10 testes unitários, integração, E2E, manual | Tasks 6, 2–4, 13, e a seção acima |
| §11 "Pronto quando" | Task 13 cobre o fluxo Google; o Meta fica na verificação manual, como a spec determina |

**Desvios conscientes da spec, todos registrados no ponto de uso:**

1. **`integration_log.ultima_tentativa_em` não está no esboço do §3.** É obrigatória para cumprir o backoff que o próprio §5 pede — `tentativas` sozinha diz quantas vezes, nunca há quanto tempo.
2. **`registrar_falha` não está na tabela do §4.** A tabela lista `registrar_entrega`, `ingerir_lead` e `entregas_pendentes`; sem uma quarta função para marcar falha, o contador nunca sobe e o backoff não existe.
3. **Migration repartida em `0009`–`0012` em vez de só `0009`.** O §3 diz que `integration_log` e `notifications` ficam "para a 0009"; as funções ganharam arquivos próprios para que cada task tenha um entregável que um revisor possa rejeitar sozinho.
4. **A primeira etapa é a primeira etapa *aberta*.** O §3 diz "primeira etapa do pipeline padrão". Ordem 1 pode ser de ganho se a conta reordenar, e `leads.status` é derivado do tipo — o lead nasceria ganho.
5. **`conectar_fonte_meta` ganha o segredo de ingestão.** A spec atribui ao Plano 4 só o "caminho de reivindicação". Decisão do humano nesta sessão: fechar o buraco, e não só criar recurso contra ele. O §3 previa exatamente esse desfecho ao dizer que o dono é o Plano 4.

**Verificações de consistência que rodei sobre o próprio plano:**
- Toda função SQL citada numa task posterior tem a assinatura definida na task que a cria (`segredo_confere`, `registrar_entrega`, `entregas_pendentes`, `registrar_falha`, `ingerir_lead`, `conectar_fonte_meta`, `reivindicar_fonte_meta`).
- Todo tipo TypeScript usado numa task posterior tem o bloco `Interfaces` que o define (`DadosDoLead`, `EntregaParaProcessar`, `ResultadoEntrega`, `IngestaoStore`, `LeadDoMeta`, `Notificacao`, `Entrega`).
- `paraPayload` (Task 6) é a única tradução de `DadosDoLead` para as chaves `snake_case` que `ingerir_lead` (Task 4) lê — as duas listas de chaves foram conferidas uma contra a outra.
- Nenhum portão cita contagem de teste.
