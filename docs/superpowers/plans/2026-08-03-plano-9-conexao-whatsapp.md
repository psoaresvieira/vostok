# Plano 9 — Conexão do WhatsApp + nota beta do Meta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin cola token, `phone_number_id` e `waba_id` em `/config` e o CRM guarda a credencial do WhatsApp Cloud API validada contra o Graph — deixando pronto o contrato (`credencial_whatsapp`) que o sub-projeto 5 consome — e o cliente beta do Meta vê uma nota honesta em vez de erro cru.

**Architecture:** Migration `0019` replica o padrão da `0008`/`0012`: tabela `whatsapp_connections` (uma por conta, número único global) com gêmea `whatsapp_credentials` **sem grant nenhum**, escrita só por RPCs `security definer` que exigem o segredo de ingestão **e** a sessão de admin (cumulativos, como a `0012` fixou). Uma porta `WhatsAppGraph` com dupla falsa valida a credencial contra o Graph **antes** de gravar — os valores exibidos vêm da resposta do Meta, nunca do formulário. Acima: um store pequeno, duas Server Actions, um bloco novo na tela de Integrações e a nota beta ligada por env var.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Supabase (Postgres/RLS) + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-03-crm-conexao-whatsapp-design.md`. As cinco decisões estão fechadas lá — não reabra nenhuma.

## Global Constraints

- **`npx supabase`, nunca `supabase`.** O binário não está no PATH desta máquina.
- **Nenhuma mensagem crua do PostgREST na tela.** Todo código novo entra no mapa de `config/erros.ts`.
- **Toda Server Action chamada de componente cliente passa por `chamarAcao`** (`@/lib/ui/acao`).
- **Nenhum teste automatizado toca a rede.** A porta real só roda em verificação manual; testes usam a dupla falsa via a mesma fábrica/`META_FAKE` de `lib/integracoes/fabrica.ts`.
- **As RPCs novas são `security definer` exigindo o segredo de ingestão — e isso é o padrão certo AQUI, o inverso do Plano 8.** As tabelas de credencial não têm grant, então `invoker` não alcançaria nada; o que escopa é `segredo_confere` + a checagem explícita de sessão e papel dentro do corpo, **cumulativas** (o segredo prova *quem* chamou; sessão e papel provam *por conta de quem*), exatamente como a `0012` estabeleceu. O teste de `prosecdef` deste plano afirma `true`, não `false`.
- **O token nunca volta à tela depois de gravado**, e nunca entra em payload RSC — por isso a tabela gêmea sem grant, como `source_credentials`.
- **Componente novo com teste: `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` registrado à mão** (o vitest deste repo não liga `globals: true`).
- **Nenhuma contagem de teste aparece neste plano.** O portão de cada task é "suíte verde e todo teste novo com RED demonstrado".

### Sobre a forma deste plano — leia antes de começar

Mesma forma assimétrica dos Planos 7 e 8, com a lição do 8 aplicada: **SQL literal dentro de plano também é código que nenhum engine rodou** — por isso os casos de teste nomeados abaixo miram exatamente as fronteiras do SQL (segredo, sessão, papel, unicidade dupla, grant ausente), e nenhum vermelho pode ser pulado.

- **Literal, para copiar como está:** o DDL, as policies, as RPCs, os grants.
- **Assinatura + invariantes + casos de teste nomeados, para você escrever sob TDD:** todo o TypeScript.

Onde um caso de teste está nomeado, ele é obrigatório, e o texto diz o que ele afirma e o que tem que quebrar para ele ficar vermelho. Teste que passa de primeira sem vermelho demonstrado não conta: quebre de propósito, veja o vermelho, reverta.

**Branch:** crie `plano-9-conexao-whatsapp` a partir de `master` antes da Task 1. Merge só depois do review de branch inteira.

---

## Task 1: Migration `0019` — as duas tabelas e as três RPCs

**Files:**
- Create: `supabase/migrations/0019_conexao_whatsapp.sql`
- Create: `tests/integration/0019_conexao_whatsapp.test.ts`

**Interfaces:**
- Consumes: `public.segredo_confere(text)` (`0010`), `public.papel_na_conta(uuid)` (`0001`); helpers `montarCenario` (`tests/integration/helpers/cenario.ts`), `comoServico`, `comoUsuario` (`helpers/db.ts`); o padrão de semear o segredo de ingestão que `tests/integration/0012_posse_da_page.test.ts` já usa (olhe como ele define o segredo antes de chamar as RPCs).
- Produces: as três RPCs com os códigos exatos que a Task 3 mapeia: `segredo_invalido`, `sem_sessao`, `sem_permissao`, `whatsapp_campos_vazios`, `whatsapp_ja_conectado`, `numero_ja_conectado`, `whatsapp_nao_encontrado`.

- [ ] **Step 1: Escrever o teste de integração**

Crie `tests/integration/0019_conexao_whatsapp.test.ts`, na forma de `0012_posse_da_page.test.ts` (cenário + segredo semeado). Monte também uma **segunda conta** (padrão de `0008_fontes_conectadas.test.ts`). Casos obrigatórios:

1. **Fluxo feliz.** Admin da conta A, com o segredo certo, chama `conectar_whatsapp` e a conexão nasce; releia `whatsapp_connections` pelo serviço (as duas colunas de exibição batem com o que foi passado) e `whatsapp_credentials` pelo serviço (o token está lá). O `select` da própria conexão como o admin (via `comoUsuario`, `select * from whatsapp_connections`) também devolve a linha — é o grant + policy de select funcionando.
2. **Segredo errado recusa as três RPCs com `segredo_invalido` e nada muda.** Para `conectar`: nenhuma linha nasce em nenhuma das duas tabelas. Para `desconectar` e `credencial`: sobre uma conexão existente, a linha continua lá. Este caso é o primeiro portão da `0012`; fica vermelho se alguém esquecer o `segredo_confere` em qualquer uma das três.
3. **Sessão e papel são cumulativos com o segredo.** Com o segredo **certo**: sem sessão (`comoServico` chamando a RPC — `auth.uid()` nulo) → `sem_sessao` em `conectar` e `desconectar`; como `vendedorAId` → `sem_permissao`, e nada muda. O segredo sozinho não basta — é a assimetria deliberada com `credencial_whatsapp`, que o caso 8 cobre.
4. **`whatsapp_ja_conectado`:** conta A já conectada tenta um **segundo número** → recusa, e a conexão original está intacta (mesmo `phone_number_id` de antes, token de antes na credencial).
5. **`numero_ja_conectado`:** conta B tenta o **mesmo número** da conta A → recusa, linha da conta A intacta. Os casos 4 e 5 juntos provam que a tradução distingue os dois índices únicos — fica vermelho se o `exception` traduzir os dois para o mesmo código.
6. **`whatsapp_campos_vazios`:** token só de espaços → recusa, nada gravado. (Um campo basta; o `if` é um só.)
7. **Isolamento no desconectar:** admin da conta B chama `desconectar_whatsapp` com o id da conexão da conta A → `sem_permissao`, linha intacta. Vendedor da própria conta A → `sem_permissao`. Id inexistente → `whatsapp_nao_encontrado`. (Mesma matriz do `desconectar_fonte`.)
8. **`credencial_whatsapp` é o contrato do servidor:** com o segredo certo e **sem sessão nenhuma** (`comoServico`), devolve `token`, `phone_number_id` e `waba_id` da conta A. Sem conexão (conta B) → `whatsapp_nao_encontrado`. A ausência do check de sessão aqui é deliberada — quem chama é o servidor do disparo, e o segredo é a identidade dele.
9. **A credencial é inalcançável por sessão.** Como `adminId` (via `comoUsuario`): `select * from public.whatsapp_credentials` falha com **permission denied** — erro de privilégio, não zero linhas. Fica vermelho se um grant acidental abrir a tabela. (`insert` direto na tabela de conexões como admin também tem que falhar com permission denied: o grant é só de `select`.)
10. **`prosecdef = true` nas três.** `select proname, prosecdef from pg_proc where proname in ('conectar_whatsapp', 'desconectar_whatsapp', 'credencial_whatsapp')` — três linhas, todas `true`. Aqui `definer` é o desenho (Global Constraints); o teste impede que alguém "corrija" para `invoker` lendo o Plano 8 e trave tudo, porque sem grant nas tabelas `invoker` não alcança nada.

- [ ] **Step 2: Rodar e ver o vermelho**

```bash
npm run test:integration -- 0019
```

Esperado: FAIL — `function public.conectar_whatsapp(...) does not exist`.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

Crie `supabase/migrations/0019_conexao_whatsapp.sql`:

```sql
-- Conexao do WhatsApp Cloud API, uma por conta. Spec:
-- docs/superpowers/specs/2026-08-03-crm-conexao-whatsapp-design.md
--
-- WhatsApp NAO e fonte de lead — e canal de saida. Por isso tabela propria,
-- e nao uma linha em lead_sources: o enum provedor_lead e castado para
-- lead_origem na ingestao, e todo caminho que ramifica por provedor teria que
-- aprender a ignorar 'whatsapp'.
--
-- O padrao de seguranca e o da 0008/0012, replicado e nao reinventado:
-- credencial em tabela gemea SEM GRANT, escrita so por RPC security definer
-- que exige o segredo de ingestao E a sessao de admin, cumulativos.

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number_id text not null,
  waba_id text not null,
  numero_exibicao text not null,
  nome_verificado text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um numero por conta (decisao de MVP declarada na spec): relaxar isto um dia
-- e trocar um indice, nao reescrever o modelo.
create unique index whatsapp_connections_account_idx
  on public.whatsapp_connections (account_id);

-- Unico GLOBAL, como o page_id em lead_sources e pelo mesmo motivo, so que
-- olhando para a frente: o webhook de resposta (fase 2 do sub-projeto 5)
-- resolve a conta pelo numero. Dois tenants com o mesmo numero seria
-- ambiguidade sem desempate — falhar na conexao com mensagem clara e melhor.
create unique index whatsapp_connections_numero_idx
  on public.whatsapp_connections (phone_number_id);

-- Tabela gemea sem grant, como source_credentials: se o token fosse coluna da
-- tabela de cima, qualquer select * da tela o traria para o payload RSC.
create table public.whatsapp_credentials (
  connection_id uuid primary key
    references public.whatsapp_connections(id) on delete cascade,
  token text not null,
  atualizado_em timestamptz not null default now()
);

-- Grant so de select na tabela de conexoes; insert e delete passam pelas RPCs.
-- Nas credenciais, NENHUM grant, e RLS ligada sem policy — cinto e
-- suspensorio: um grant acidental numa migration futura nao pode abrir a
-- tabela.
grant select on public.whatsapp_connections to authenticated;

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_credentials enable row level security;

-- So admin ve a conexao: e configuracao da conta, como lead_sources.
create policy whatsapp_connections_admin_select on public.whatsapp_connections
  for select using (public.papel_na_conta(account_id) = 'admin');

-- SECURITY DEFINER exigindo o segredo de ingestao, o padrao da 0012:
-- o segredo prova QUEM chamou (so o servidor o tem); sessao e papel provam
-- POR CONTA DE QUEM. Cumulativos, nao alternativos. A validacao de que o
-- token realmente le o numero acontece ANTES, na Server Action, contra o
-- Graph (WhatsAppGraph.dadosDoNumero) — o banco nao tem como chamar o Graph,
-- entao o segredo e o que amarra aquela prova a esta escrita.
create or replace function public.conectar_whatsapp(
  p_segredo text,
  p_account_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_numero_exibicao text,
  p_nome_verificado text,
  p_token text
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
  if p_phone_number_id is null or btrim(p_phone_number_id) = ''
     or p_waba_id is null or btrim(p_waba_id) = ''
     or p_numero_exibicao is null or btrim(p_numero_exibicao) = ''
     or p_nome_verificado is null or btrim(p_nome_verificado) = ''
     or p_token is null or btrim(p_token) = '' then
    raise exception 'whatsapp_campos_vazios';
  end if;

  begin
    insert into public.whatsapp_connections
      (account_id, phone_number_id, waba_id, numero_exibicao, nome_verificado)
    values (p_account_id, p_phone_number_id, p_waba_id,
            p_numero_exibicao, p_nome_verificado)
    returning id into v_id;
  exception
    when unique_violation then
      -- Dois indices unicos podem estourar; distinguir pelo ESTADO, nao pelo
      -- nome do indice no texto do erro. Conta primeiro: se os dois valem, a
      -- mensagem acionavel para quem esta na tela e "voce ja tem um numero".
      if exists (
        select 1 from public.whatsapp_connections wc
         where wc.account_id = p_account_id
      ) then
        raise exception 'whatsapp_ja_conectado';
      end if;
      raise exception 'numero_ja_conectado';
  end;

  insert into public.whatsapp_credentials (connection_id, token)
  values (v_id, p_token);

  return v_id;
end;
$$;

create or replace function public.desconectar_whatsapp(
  p_segredo text,
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  select account_id into v_account
    from public.whatsapp_connections
   where id = p_connection_id;
  if v_account is null then
    raise exception 'whatsapp_nao_encontrado';
  end if;
  -- Mesma matriz do desconectar_fonte (0008): id e uuid gerado, nao
  -- identificador publico — sem_permissao aqui nao vaza nada util.
  if public.papel_na_conta(v_account) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- whatsapp_credentials cai pelo on delete cascade da PK.
  delete from public.whatsapp_connections where id = p_connection_id;
end;
$$;

-- O CONTRATO DO SUB-PROJETO 5. Sem check de sessao, DELIBERADAMENTE: quem
-- chama e o servidor (a Server Action do disparo), que se identifica pelo
-- segredo — mesmo desenho de registrar_entrega/ingerir_lead. Se o token
-- fosse alcancavel por sessao, a tabela sem grant nao estaria protegendo
-- nada. Nao acrescente auth.uid() aqui achando que e endurecimento: e o
-- disparo por cron (sem sessao nenhuma) que voce estaria quebrando.
create or replace function public.credencial_whatsapp(
  p_segredo text,
  p_account_id uuid
)
returns table (token text, phone_number_id text, waba_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  return query
    select cr.token, wc.phone_number_id, wc.waba_id
      from public.whatsapp_connections wc
      join public.whatsapp_credentials cr on cr.connection_id = wc.id
     where wc.account_id = p_account_id;
  if not found then
    raise exception 'whatsapp_nao_encontrado';
  end if;
end;
$$;

-- Grant explicito de execute, como a 0014 faz: redundante se o default ACL
-- de funcao conceder public, inofensivo se nao conceder — e a chamada nunca
-- morre em permission denied por causa da imagem do Postgres.
grant execute on function public.conectar_whatsapp(text, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.desconectar_whatsapp(text, uuid) to authenticated;
grant execute on function public.credencial_whatsapp(text, uuid) to authenticated;
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0019
```

- [ ] **Step 5: Experimento de discriminação — o do segredo**

Comente o bloco `if not public.segredo_confere(p_segredo)` de `conectar_whatsapp` (só dela). `npm run db:reset && npm run test:integration -- 0019`. **O caso 2 tem que ficar vermelho na parte de `conectar`** — e só nela. Reverta e confirme byte-idêntico ao plano.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck
```

```bash
git add supabase/migrations/0019_conexao_whatsapp.sql tests/integration/0019_conexao_whatsapp.test.ts
git commit -m "feat: conexao do WhatsApp — tabelas, credencial sem grant e as tres RPCs com segredo"
```

---

## Task 2: Porta `WhatsAppGraph` — real, falsa e fábrica

**Files:**
- Create: `src/lib/integracoes/whatsapp.ts`
- Create: `src/lib/integracoes/whatsapp-falso.ts`
- Create: `src/lib/integracoes/whatsapp-falso.test.ts`
- Create: `src/lib/integracoes/whatsapp-real.ts`
- Create: `src/lib/integracoes/whatsapp-real.test.ts`
- Modify: `src/lib/integracoes/fabrica.ts`

**Interfaces:**
- Consumes: `Resultado` de `@/lib/domain/resultado`; `usarFalso()` já exportado de `fabrica.ts`
- Produces — normativo, consumido pelas Tasks 3 e 4:

```ts
// src/lib/integracoes/whatsapp.ts
export type DadosDoNumero = { numeroExibicao: string; nomeVerificado: string }

export interface WhatsAppGraph {
  /**
   * Prova que `token` le `phoneNumberId` e devolve o que o Meta diz sobre o
   * numero. Falhas viram codigo: 'token_whatsapp_invalido' (o Graph recusou a
   * credencial ou o id) ou 'whatsapp_indisponivel' (rede/5xx).
   */
  dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>>
}

// fabrica.ts — acrescentar, no padrao de metaFalso()/metaGraph():
export function whatsappFalso(): WhatsAppGraphFalso
export function whatsappGraph(): WhatsAppGraph
```

**Invariantes:**

- **A falsa segue a forma de `MetaGraphFalso`** (leia `meta-falso.ts` antes): instância compartilhada no processo via `whatsappFalso()` (o E2E depende de estado que sobrevive entre requests), estado configurável pelos testes (um mapa `numeros: Map<string, DadosDoNumero>` e um conjunto de tokens aceitos, ou forma equivalente que `meta-falso` já use), e **registro de chamadas** (`consultados: { token: string; phoneNumberId: string }[]`) para os testes afirmarem sobre o estado do duplo — nunca spy.
- **A real segue a forma de `meta-real.ts`** (mesma versão do Graph, mesmo tratamento de erro): `GET /{phone_number_id}?fields=display_phone_number,verified_name` com o token; resposta 200 mapeia `display_phone_number` → `numeroExibicao` e `verified_name` → `nomeVerificado`; erro do Graph (4xx com corpo de erro) → `token_whatsapp_invalido`; falha de rede ou 5xx → `whatsapp_indisponivel`. Os testes da real seguem a forma de `meta-real.test.ts` (como aquele arquivo substitui o `fetch` — copie a técnica, não invente outra).
- **`whatsappGraph()` usa o MESMO `usarFalso()`** — a invariante de que a falsa nunca sobe em produção já está escrita lá e vale para este canal também.

- [ ] **Step 1: Escrever os testes**

Casos obrigatórios (RED primeiro — os módulos não existem):

1. **A falsa devolve os dados de um número cadastrado e registra a consulta.** Configure o duplo com um número; chame; afirme os dados e o registro em `consultados`.
2. **A falsa recusa token não cadastrado com `token_whatsapp_invalido`** — e ainda assim registra a consulta (o registro existe para provar que a chamada aconteceu, inclusive as recusadas).
3. **A real monta a URL certa e mapeia a resposta.** Com o `fetch` substituído devolvendo 200 e o corpo do Graph, afirme `numeroExibicao`/`nomeVerificado` e a URL chamada (path contém o `phone_number_id` e os dois `fields`).
4. **A real traduz recusa e indisponibilidade.** 401 com corpo de erro do Graph → `token_whatsapp_invalido`; `fetch` rejeitando → `whatsapp_indisponivel`.

- [ ] **Step 2: Vermelho**

```bash
npm test -- whatsapp
```

- [ ] **Step 3: Implementar** (os quatro arquivos + a fábrica)

- [ ] **Step 4: Verde + portão e commit**

```bash
npm test -- whatsapp && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/integracoes/whatsapp.ts src/lib/integracoes/whatsapp-falso.ts src/lib/integracoes/whatsapp-falso.test.ts src/lib/integracoes/whatsapp-real.ts src/lib/integracoes/whatsapp-real.test.ts src/lib/integracoes/fabrica.ts
git commit -m "feat: porta WhatsAppGraph com dupla falsa e fabrica"
```

---

## Task 3: Store, Server Actions e o mapa de erros

**Files:**
- Create: `src/lib/data/whatsapp.ts`
- Create: `tests/integration/whatsapp-store.test.ts`
- Create: `src/app/(app)/config/acoes-whatsapp.ts`
- Create: `src/app/(app)/config/acoes-whatsapp.test.ts`
- Modify: `src/app/(app)/config/erros.ts`

**Interfaces:**
- Consumes: as RPCs da Task 1; `whatsappGraph()` da Task 2; `criarClienteServidor`, `resolverContaAtiva` (mesma resolução de `criarFonteStoreDoServidor` em `lib/data/fontes.ts:261` — leia aquele arquivo antes; este store é o irmão menor dele)
- Produces — normativo, consumido pela Task 4:

```ts
// src/lib/data/whatsapp.ts
export type ConexaoWhatsApp = {
  id: string
  phoneNumberId: string
  wabaId: string
  numeroExibicao: string
  nomeVerificado: string
  criadoEm: Date
}

export interface WhatsAppStore {
  /** A conexao da conta, ou null — nunca mais de uma (unique de account_id). */
  atual(): Promise<Resultado<ConexaoWhatsApp | null>>
  conectar(d: {
    phoneNumberId: string
    wabaId: string
    numeroExibicao: string
    nomeVerificado: string
    token: string
  }): Promise<Resultado<string>>
  desconectar(id: string): Promise<Resultado<void>>
}

export class SupabaseWhatsAppStore implements WhatsAppStore { /* ... */ }

export async function criarWhatsAppStoreDoServidor(): Promise<
  Resultado<{ whatsapp: SupabaseWhatsAppStore; conta: Conta }>
>

// src/app/(app)/config/acoes-whatsapp.ts ('use server')
export async function conectarWhatsAppAction(d: {
  token: string
  phoneNumberId: string
  wabaId: string
}): Promise<Resultado<void>>
export async function desconectarWhatsAppAction(id: string): Promise<Resultado<void>>
```

**Invariantes:**

- **O store repete o padrão de `SupabaseFonteStore`:** `conectar`/`desconectar` via `.rpc()` passando `p_segredo: process.env.INGESTAO_SEGREDO ?? ''` (sem guarda de vazio no store — `segredo_confere` recusa e `segredo_invalido` já tem mensagem de operador); tradução por lista local de códigos com `includes`, na forma do `codigo()` de `fontes.ts:115` (não importe a dele — replique o padrão com os códigos desta task: `sem_sessao`, `sem_permissao`, `segredo_invalido`, `whatsapp_ja_conectado`, `numero_ja_conectado`, `whatsapp_campos_vazios`, `whatsapp_nao_encontrado`). `atual()` lê `whatsapp_connections` por select direto (o grant + policy da Task 1 recortam) com lista explícita de colunas, `maybeSingle`.
- **`criarWhatsAppStoreDoServidor` exige admin**, como `criarFonteStoreDoServidor` — mesma sequência, mesmo `sem_permissao`.
- **`conectarWhatsAppAction` valida nesta ordem, e a ordem é normativa:** (1) resolve o store (admin); (2) `trim` nos três campos, algum vazio → `falha('whatsapp_campos_vazios')` — antes de qualquer IO; (3) `INGESTAO_SEGREDO` ausente → `falha('ingestao_nao_configurada')` **antes de tocar o Graph** (mesmo achado da `acoes-fontes.ts:107`: sem isto, um deploy sem segredo validaria contra o Graph e falharia só na gravação, com efeito colateral já feito — aqui o efeito é menor, mas o padrão é regra do arquivo vizinho e a assimetria confundiria); (4) `whatsappGraph().dadosDoNumero(token, phoneNumberId)` — falha faz forward do código do port; (5) `store.conectar` com `numeroExibicao`/`nomeVerificado` **da resposta do Graph**, nunca do formulário; (6) `revalidatePath('/config')`.
- **`config/erros.ts` ganha exatamente estas chaves:**

```ts
whatsapp_ja_conectado: 'Esta conta já tem um número conectado. Desconecte-o para trocar.',
numero_ja_conectado: 'Esse número já está conectado a outra conta do CRM.',
whatsapp_campos_vazios: 'Preencha o token, o ID do número e o ID da WABA.',
token_whatsapp_invalido: 'O Meta recusou esse token para esse número. Confira os dois no painel.',
whatsapp_indisponivel: 'O Meta não respondeu. Tente de novo em alguns minutos.',
whatsapp_nao_encontrado: 'Essa conexão não existe mais. Recarregue a página.',
```

- [ ] **Step 1: Escrever os testes**

`tests/integration/whatsapp-store.test.ts` (na forma de `admin-store.test.ts`, com o segredo semeado como no teste da Task 1). Casos obrigatórios:

1. **`conectar` grava e `atual()` devolve a conexão mapeada** (camelCase, `criadoEm` como `Date`).
2. **`atual()` sem conexão devolve `ok(null)`** — não erro.
3. **`conectar` numa conta que já tem número devolve `falha('whatsapp_ja_conectado')`** — o código exato, não a mensagem crua.
4. **`desconectar` remove, e `atual()` volta a `null`.** Pelo serviço, confirme que a linha da credencial morreu junto (cascade).
5. **`desconectar` de id alheio devolve `falha('sem_permissao')`** e a linha sobrevive.

`src/app/(app)/config/acoes-whatsapp.test.ts` (unidade, com a dupla falsa via `whatsappFalso()` — na forma de `acoes-fontes.test.ts`, que já resolve como exercitar action com o duplo; leia-o antes). Casos obrigatórios:

6. **Campo vazio falha antes de qualquer IO:** `token: '   '` → `whatsapp_campos_vazios` e `consultados` do duplo continua vazio. Fica vermelho se a validação for depois da chamada ao Graph.
7. **Token recusado pelo Graph não grava:** o duplo recusa; a action devolve `token_whatsapp_invalido`; nada nasce no banco (ou no store falso que o teste do arquivo vizinho usa — siga a técnica de lá).
8. **O que se grava é o que o Graph devolveu — o caso central.** Configure o duplo para devolver `numeroExibicao`/`nomeVerificado` **diferentes** de qualquer coisa digitada; conecte; afirme que o gravado é o do Graph. Fica vermelho se a action passar valores do formulário para o store.

- [ ] **Step 2: Vermelho**

```bash
npm run test:integration -- whatsapp-store
npm test -- acoes-whatsapp
```

- [ ] **Step 3: Implementar** (store, actions, erros.ts)

- [ ] **Step 4: Verde**

```bash
npm run test:integration -- whatsapp-store && npm test -- acoes-whatsapp
```

- [ ] **Step 5: Experimento de discriminação no caso 8**

Na action, troque os valores gravados pelos do formulário (ignorando a resposta do Graph). Rode. **O caso 8 tem que ficar vermelho.** Reverta.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/data/whatsapp.ts tests/integration/whatsapp-store.test.ts "src/app/(app)/config/acoes-whatsapp.ts" "src/app/(app)/config/acoes-whatsapp.test.ts" "src/app/(app)/config/erros.ts"
git commit -m "feat: store e actions da conexao WhatsApp — valida no Graph antes de gravar"
```

---

## Task 4: Tela, nota beta, runbook e portão final

**Files:**
- Create: `src/app/(app)/config/whatsapp.tsx`
- Create: `src/app/(app)/config/whatsapp.test.tsx`
- Modify: `src/app/(app)/config/integracoes.tsx`
- Modify: `src/app/(app)/config/page.tsx`
- Modify: `README.md`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `ConexaoWhatsApp`, `criarWhatsAppStoreDoServidor` e as duas actions (Task 3); `chamarAcao`; `mensagemDeErro` de `config/erros.ts`
- Produces: nada consumido por outra task.

**Comportamento — normativo:**

- **`whatsapp.tsx`** — componente cliente `WhatsApp`, recebe `conexao: ConexaoWhatsApp | null` e as duas actions **por prop com default** (testável sem servidor, como `etapas.tsx` faz).
  - **Desconectado:** três campos — token, ID do número (`phoneNumberId`), ID da WABA — com uma linha curta dizendo onde achá-los (painel do Meta → WhatsApp → Configuração da API), e "Conectar" com estado pendente (disabled em voo). Sucesso limpa os campos.
  - **Conectado:** card com `numeroExibicao`, `nomeVerificado` e `wabaId`, e "Desconectar" com confirmação inline antes de chamar (padrão do diálogo de `etapas.tsx`, sem lib nova). **Nenhum input de token existe no estado conectado** — o token não volta, nem como campo vazio.
  - Erros pelo mapa; toda chamada por `chamarAcao`.
- **`integracoes.tsx`** ganha a prop `modoBeta: boolean` e, quando `true`, renderiza a nota fixa junto ao botão "Conectar Facebook": `Durante o beta, a conexão com o Facebook é liberada por convite — fale com a gente para habilitar sua conta.` Quando `false`, nada muda no DOM.
- **`page.tsx`**: resolve `criarWhatsAppStoreDoServidor()` e `atual()` junto das buscas existentes (mesmo tratamento de erro estrutural: `throw` — a conexão é dado estrutural do bloco, diferente do `resumo` que degrada); `modoBeta = process.env.META_MODO_BETA === '1'`; renderiza `<WhatsApp conexao={...} />` dentro da região de Integrações (logo após o componente `Integracoes`, ou como filho — siga o layout existente da página).
- **`README.md`**: seção nova "Onboarding beta do Meta (operador)" com o runbook: onde adicionar o tester no painel do Meta (Funções do app), o que o cliente precisa aceitar (convite em developers.facebook.com), o que conferir na primeira conexão (a Page aparece na lista, o lead de teste chega), e a nota de que `META_MODO_BETA=1` liga o aviso na tela — desligar quando o App Review passar.
- **`.env.local.example`**: `META_MODO_BETA=` com comentário de uma linha.

- [ ] **Step 1: Escrever o teste de componente**

`src/app/(app)/config/whatsapp.test.tsx`, com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` manual. Casos obrigatórios:

1. **Desconectado renderiza os três campos e envia o que foi digitado.** Stub de action registra a chamada; afirme os três valores.
2. **Conectado mostra número, nome verificado e WABA — e não existe nenhum input.** Afirme a ausência de `textbox` no card conectado (rótulo acessível, não classe).
3. **Desconectar pede confirmação: cancelar não chama, confirmar chama com o id certo.** Dois renders, como os casos de `etapas.test.tsx`.
4. **Recusa traduzida:** stub devolve `falha('token_whatsapp_invalido')`; o texto exibido é a mensagem do mapa, não o código.
5. **Nota beta:** renderize `Integracoes` com `modoBeta` `true` e `false`; o texto do aviso aparece só no primeiro. (Este caso vive em `whatsapp.test.tsx` ou num teste próprio de `integracoes` — onde ficar mais natural; o que importa é o par true/false.)

- [ ] **Step 2: Vermelho**

```bash
npm test -- whatsapp
```

(O filtro também pega os testes da Task 2 — eles têm que continuar verdes; os novos, vermelhos.)

- [ ] **Step 3: Implementar** (componente, prop da nota, page.tsx, README, env example)

- [ ] **Step 4: Verde + build**

```bash
npm test -- whatsapp && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Verificar no navegador — não é opcional**

```bash
npm run dev
```

Com `META_FAKE=1` (o dev já sobe assim para E2E — confira como o `npm run dev` do repo trata a env; se não setar, exporte na chamada): entre como admin, conecte um número cadastrado no duplo falso, e confira: o card mostra o que o **duplo** devolveu (não o digitado), desconectar pede confirmação e volta ao formulário, token recusado mostra a mensagem certa. Ligue `META_MODO_BETA=1` e veja a nota; desligue e veja sumir. Duas vezes neste projeto o olho achou o que nenhuma suíte achou.

- [ ] **Step 6: Portão final da branch**

```bash
npm run db:reset
npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build
```

Tudo verde, rodado **depois** do reset. Antes do E2E, derrube qualquer `npm run dev` aberto.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/config/whatsapp.tsx" "src/app/(app)/config/whatsapp.test.tsx" "src/app/(app)/config/integracoes.tsx" "src/app/(app)/config/page.tsx" README.md .env.local.example
git commit -m "feat: bloco WhatsApp na tela de integracoes e nota beta do Meta"
```

---

## Critério de aceite do plano

O da spec §10, na íntegra: um admin abre `/config`, cola token, `phone_number_id` e `waba_id`, e o card passa a mostrar o número e o nome verificado que o Meta devolveu. Cola um token errado e nada é gravado, com mensagem clara. Uma segunda conta tenta o mesmo número e é recusada dizendo por quê. Nenhuma sessão — nem de admin — alcança o token pelo PostgREST. Com `META_MODO_BETA` ligada, a nota aparece; desligada, some. E o sub-projeto 5 lê a credencial por `credencial_whatsapp` sem migration nova.

A verificação contra o Graph **real** (token de um número da SE7E) fica registrada como pendência de credencial na §9 do `progresso.md`, junto com as outras — não bloqueia o merge.

Suíte verde no resultado do merge, depois de `npx supabase db reset`. Todo teste novo com RED demonstrado.

## Review

Review de contexto fresco **por task**, e review de branch inteira antes do merge. Quatro perguntas para o revisor de branch inteira, cada uma exigindo mais de uma task junta:

1. **O token tem exatamente dois caminhos vivos: entrar por `conectar_whatsapp` e sair por `credencial_whatsapp` com segredo?** Nenhum select, nenhum tipo TS, nenhum payload RSC o carrega — inclusive o tipo `ConexaoWhatsApp` (que não tem campo de token) e o retorno de `conectar` (que devolve id, não credencial)?
2. **Os valores exibidos vêm do Graph em todos os caminhos?** A action grava a resposta do port, o store não aceita sobrescrita silenciosa, e a tela não mostra nada digitado como se fosse verificado?
3. **A assimetria de sessão entre as três RPCs é a desenhada** — `conectar`/`desconectar` exigem sessão+papel, `credencial_whatsapp` não — e há teste afirmando cada lado?
4. **A nota beta é reversível por env var sozinha?** Nenhum estado, nenhuma migration, nenhum texto duplicado que sobreviva ao desligamento?
