# Plano 11 — Disparo de WhatsApp (sub-projeto 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gestor submete um script da biblioteca como template do WhatsApp ("Submeter ao WhatsApp" em `/scripts/[id]`), acompanha a aprovação do Meta por consulta sob demanda, e o vendedor dispara a mensagem da ficha do lead pelo número da conta — com lacuna bloqueando o envio e o texto enviado registrado na timeline. É o último sub-projeto do MVP em código.

**Architecture:** Migration `0022` cria `whatsapp_templates` (uma por script, snapshot do corpo posicional + mapa posição→variável) e a RPC `atualizar_status_template` (`definer` + segredo — quem renderiza pode ser vendedor, sem escrita na tabela). O domínio ganha o tradutor nomeado→posicional e aperta a gramática do regex (dívida pinada do Plano 10). A porta `WhatsAppGraph` ganha quatro métodos (submeter/status/apagar/enviar) com dupla falsa. O disparo é Server Action com sessão: revalida tudo, busca credencial e persiste status via **client anon + segredo** (contrato do Plano 9), envia o **snapshot** preenchido e grava `lead_events`. Script editado depois da aprovação desativa o envio (`template_desatualizado`, fail closed) até re-submissão.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Supabase (Postgres/RLS) + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-04-crm-disparo-whatsapp-design.md`. As seis decisões da §2 estão fechadas — não reabra nenhuma.

**Um ponto que a spec deixou implícito, fechado aqui (prevalece):** a spec diz que `corpo_posicional` é snapshot ("o script pode ser editado depois; o que foi ao Meta não muda") mas não diz o que o disparo faz quando o script atual divergiu do snapshot. Decisão fail-closed, pela mesma honestidade que bloqueia lacuna: **o Enviar só fica ativo quando `traduzirParaPosicional(conteudo atual)` bate com o snapshot** (`corpo` e `mapa`); divergiu → aviso "O script mudou desde a aprovação — re-submeta" no lugar do botão, e a Server Action revalida com o código `template_desatualizado`. Com isso a invariante de comutação vale para **todo** envio habilitado: o que o Meta manda é byte-idêntico ao `textoPlano` do preview atual.

## Global Constraints

- **`npx supabase`, nunca `supabase`.** Binário fora do PATH.
- **Nenhuma mensagem crua do Graph nem do PostgREST na tela.** Todo código novo entra em mapa (`scripts/erros.ts` estendido — os consumidores novos são as mesmas telas).
- **Toda Server Action chamada de componente cliente passa por `chamarAcao`.**
- **Nenhum teste automatizado toca a rede.** A porta real só roda em verificação manual (§9 da spec); testes usam a dupla falsa via `whatsappFalso()`/`usarFalso()` de `lib/integracoes/fabrica.ts`.
- **Credencial e persistência de status saem por client anon + segredo** (`createClient(url, anonKey)` + `INGESTAO_SEGREDO`, padrão de `criarIngestaoStore` em `ingestao.ts:156`), **nunca `criarClienteServidor`** — é o contrato registrado no progresso e na spec §3.
- **Componente novo com teste: `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` manual.**
- **Domínio puro sem IO** — as funções novas de `domain/script.ts` não importam nada de `data/`, `supabase/` ou `next/*`.
- **Nenhuma contagem de teste neste plano.** Portão por task: "suíte verde e todo teste novo com RED demonstrado".
- **As seis guardas silenciosas valem na migration** (grant explícito; `is distinct from` sem dois lados nulos; `drop function` em mudança de assinatura — nenhuma prevista; `definer`/`invoker` dito em voz alta; `revoke truncate`; discriminação para leitura recortada). E a lição do Plano 10: **`with check` roda antes da FK** — casos de recusa esperam `42501`, não `23503`.

### Sobre a forma deste plano — leia antes de começar

Forma assimétrica (quarta vez): **literal, para copiar como está** — DDL, policies, RPC, grants; **assinatura + invariantes + casos de teste nomeados, para escrever sob TDD** — todo o TypeScript. Onde um caso está nomeado, ele é obrigatório e o texto diz o que o quebra. Teste que passa de primeira sem vermelho demonstrado não conta.

**Branch:** crie `plano-11-disparo-whatsapp` a partir de `master` antes da Task 1. Merge só depois do review de branch inteira.

---

## Task 1: Migration `0022` — `whatsapp_templates` e a RPC de status

**Files:**
- Create: `supabase/migrations/0022_whatsapp_templates.sql`
- Create: `tests/integration/0022_whatsapp_templates.test.ts`

**Interfaces:**
- Consumes: `is_member_of`/`papel_na_conta` (`0001`), `segredo_confere` (`0010`), tabela `scripts` (`0020`); helpers `montarCenario`/`comoServico`/`comoUsuario`, `SEGREDO` de `helpers/ingestao.ts` (é o segredo que o stack local semeia).
- Produces: a tabela com as colunas exatas que a Task 4 seleciona, e a RPC com os códigos que a Task 4 traduz (`segredo_invalido`, `template_nao_encontrado`).

- [ ] **Step 1: Escrever o teste de integração**

`tests/integration/0022_whatsapp_templates.test.ts`, na forma de `0020_scripts.test.ts` (duas contas, dois papéis). Casos obrigatórios:

1. **Fluxo feliz e leitura de todo membro.** Gestor da conta A insere template para um script da própria conta; o **vendedor** da mesma conta o enxerga por select (é o que faz o botão de envio existir). Colunas gravadas afirmadas, incluindo `mapa` e `corpo_posicional`.
2. **Vendedor não escreve.** Insert como vendedor → `42501`; update/delete → zero linhas e linha intacta relida pelo serviço.
3. **Discriminação entre contas.** A mesma consulta por membro de A e por membro de B devolve números diferentes (1 vs 0).
4. **Script de outra conta recusado — no insert E no update.** Admin da conta A com `script_id` da conta B → `42501` nos dois caminhos (o `exists` do `with check`; a subconsulta roda sob a RLS de `scripts`, que esconde o script alheio). Fica vermelho se o `with check` do update esquecer a cláusula.
5. **Unicidades.** Segundo template para o mesmo `script_id` → `23505`; mesmo `nome_meta` na mesma conta → `23505`; mesmo `nome_meta` em **contas diferentes** → aceito (o índice é composto).
6. **RPC: segredo errado recusa e nada muda** (`segredo_invalido`; status/motivo/carimbo intactos).
7. **RPC: segredo certo, sem sessão nenhuma** — chame na mesma técnica do caso 8 de `0019_conexao_whatsapp.test.ts` (que prova `credencial_whatsapp` sem sessão; copie a técnica de lá, não invente outra). Atualiza `status` (minusculizado), `motivo_rejeicao` e `status_consultado_em` — **e nada mais**: `corpo_posicional`, `mapa` e `nome_meta` relidos intactos. Fica vermelho se a RPC aceitar escrever outra coluna.
8. **RPC: template inexistente → `template_nao_encontrado`.**
9. **TRUNCATE revogado** (permission denied como usuário) e **`prosecdef = true`** da RPC (definer é o desenho: o chamador pode ser vendedor sem escrita; o segredo é a identidade do servidor).

- [ ] **Step 2: Vermelho**

```bash
npm run test:integration -- 0022
```

Esperado: FAIL — `relation "public.whatsapp_templates" does not exist`.

- [ ] **Step 3: Escrever a migration — literal, copie como está**

```sql
-- Templates do WhatsApp Cloud API, um por script. Spec:
-- docs/superpowers/specs/2026-08-04-crm-disparo-whatsapp-design.md
--
-- corpo_posicional e mapa sao SNAPSHOT da submissao: o script pode ser
-- editado depois, e o que foi ao Meta nao muda. O envio usa o snapshot, e a
-- camada de cima (Task 6) so habilita enviar quando a traducao do conteudo
-- atual bate com ele — fail closed, nunca "o preview mostra X e o cliente
-- recebe Y".

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  script_id uuid not null references public.scripts(id) on delete cascade,
  nome_meta text not null,
  idioma text not null,
  categoria text not null check (categoria in ('marketing', 'utility')),
  corpo_posicional text not null,
  mapa text[] not null default '{}',
  -- Texto livre em minusculas ('pending'/'approved'/'rejected' esperados;
  -- o Meta tem outros estados e pode inventar mais). SEM check de enum de
  -- proposito: quem decide o que um estado desconhecido significa e a
  -- aplicacao, que trata tudo que nao e 'approved' como nao-enviavel.
  status text not null,
  motivo_rejeicao text,
  template_id_meta text,
  status_consultado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um template ativo por script; nome unico por conta (a conta tem uma WABA,
-- e nome de template e unico por WABA no Meta).
create unique index whatsapp_templates_script_idx
  on public.whatsapp_templates (script_id);
create unique index whatsapp_templates_nome_idx
  on public.whatsapp_templates (account_id, nome_meta);

-- Grant explicito (default ACL desta imagem da so Dxtm) e a guarda no 6.
grant select, insert, update, delete on public.whatsapp_templates to authenticated;
revoke truncate on public.whatsapp_templates from anon, authenticated;

alter table public.whatsapp_templates enable row level security;

-- Select de todo membro: o vendedor precisa ver o status para o botao de
-- envio existir. Escrita de admin/gestor, como scripts.
create policy whatsapp_templates_select on public.whatsapp_templates
  for select using (public.is_member_of(account_id));

-- O exists confina script_id ao tenant (mesma classe do stage_id do Plano
-- 10). A subconsulta roda sob a RLS de scripts como o chamador — membro
-- enxerga os scripts da propria conta, e script alheio e invisivel, entao o
-- exists falha. O WITH CHECK repete a clausula no update DE PROPOSITO: ele
-- reavalia a linha inteira.
create policy whatsapp_templates_insert on public.whatsapp_templates
  for insert with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and exists (
      select 1 from public.scripts s
       where s.id = script_id and s.account_id = whatsapp_templates.account_id
    )
  );

create policy whatsapp_templates_update on public.whatsapp_templates
  for update using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  )
  with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and exists (
      select 1 from public.scripts s
       where s.id = script_id and s.account_id = whatsapp_templates.account_id
    )
  );

create policy whatsapp_templates_delete on public.whatsapp_templates
  for delete using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  );

-- SECURITY DEFINER exigindo o segredo de ingestao, padrao registrar_entrega:
-- a consulta de status roda quando QUALQUER membro renderiza a tela —
-- inclusive vendedor, que nao tem (e nao deve ter) escrita na tabela. Sem
-- esta RPC, ou o status fresco nao persistiria (o botao da tela discordaria
-- da revalidacao da action), ou a escrita abriria para vendedor (que poderia
-- forjar 'approved'). O valor vem do servidor que acabou de consultar o
-- Graph; o segredo prova que e ele. Escreve SO status/motivo/carimbo.
create or replace function public.atualizar_status_template(
  p_segredo text,
  p_template_id uuid,
  p_status text,
  p_motivo text
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

  update public.whatsapp_templates
     set status = lower(coalesce(p_status, '')),
         motivo_rejeicao = p_motivo,
         status_consultado_em = now(),
         atualizado_em = now()
   where id = p_template_id;
  if not found then
    raise exception 'template_nao_encontrado';
  end if;
end;
$$;

-- anon incluso de proposito: o chamador e o client anon + segredo do
-- servidor (padrao criarIngestaoStore), como credencial_whatsapp.
grant execute on function public.atualizar_status_template(text, uuid, text, text) to anon, authenticated;
```

- [ ] **Step 4: Aplicar e ver o verde**

```bash
npm run db:reset && npm run test:integration -- 0022
```

- [ ] **Step 5: Experimento de discriminação**

Remova a cláusula `exists` **só do `with check` do update**. `npm run db:reset && npm run test:integration -- 0022`. **A metade de update do caso 4 fica vermelha — e só ela.** Reverta byte-idêntico.

- [ ] **Step 6: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck
```

```bash
git add supabase/migrations/0022_whatsapp_templates.sql tests/integration/0022_whatsapp_templates.test.ts
git commit -m "feat: whatsapp_templates com snapshot posicional e RPC de status com segredo"
```

---

## Task 2: Domínio — gramática apertada e o tradutor posicional

**Files:**
- Modify: `src/lib/domain/script.ts`
- Modify: `src/lib/domain/script.test.ts`

**Interfaces:**
- Consumes: `PADRAO_TAG` (`script.ts:22`), `VARIAVEIS`/`Variavel`/`ContextoScript`, `interpolar`/`textoPlano` existentes.
- Produces — normativo, consumido pelas Tasks 5 e 6:

```ts
export function traduzirParaPosicional(
  conteudo: string,
): Resultado<{ corpo: string; mapa: Variavel[] }>
export function valoresPosicionais(
  mapa: Variavel[],
  ctx: ContextoScript,
): Resultado<string[]>
export function preencherPosicional(corpo: string, valores: string[]): string
export function nomeMetaDoTitulo(titulo: string, sufixo: string): string
```

**Invariantes:**

- **Gramática apertada (dívida do Plano 10, spec §4.1):** `PADRAO_TAG` troca `\s*` por `[ \t]*` — espaço horizontal apenas. `{{ empresa }}` continua casando; `{{\n empresa }}` passa a ficar **literal** no preview e no template. Os testes existentes de `interpolar` continuam verdes (nenhum deles usa quebra de linha dentro de `{{ }}`); um caso novo pina cada lado.
- **`traduzirParaPosicional`:** percorre com `PADRAO_TAG`; cada variável **distinta** ganha a posição da primeira ocorrência (`mapa[0]` preenche `{{1}}`), e **todas** as ocorrências viram o posicional (variável repetida → mesmo número repetido). Nome de forma válida **fora do catálogo** → `falha('template_variavel_desconhecida')`. **Texto que já contém `{{N}}` literal (`{{1}}`, `{{01}}`, `{{ 2 }}`) → `falha('template_posicional_reservado')`** — o preenchedor não distingue placeholder emitido de texto do usuário, e o Meta renderizaria o literal como parâmetro (achado de review da execução). Conteúdo sem variável → `ok({ corpo: conteudo, mapa: [] })`. O resto que não casa o padrão atravessa literal, como em `interpolar`.
- **`valoresPosicionais`:** para cada posição do mapa, o valor do contexto; `null` ou só espaços em qualquer posição → `falha('whatsapp_lacunas')` (o chamador lista as lacunas pelo mapa — a função pode devolver o código simples; a tela já tem o contador do Plano 10).
- **`preencherPosicional`:** substitui `{{1}}`..`{{n}}` pelos valores, sem tocar em mais nada. É o texto que o Meta manda — usado no snapshot da timeline e no teste de comutação.
- **Invariante de comutação, com teste nomeado (o teste central da task):** para conteúdo válido e contexto completo, `preencherPosicional(corpo, valores) === textoPlano(interpolar(conteudo, ctx))`, byte a byte — incluindo um caso com variável repetida e um com conteúdo multilinha. Fica vermelho se tradução e interpolação divergirem em qualquer regra da gramática.
- **`nomeMetaDoTitulo`:** minúsculas, acentos removidos (normalize NFD + strip), qualquer coisa fora de `[a-z0-9_]` vira `_`, runs de `_` colapsados, truncado em 40 caracteres, e `_${sufixo}` ao final. O sufixo vem do chamador (aleatoriedade é IO do chamador, não do domínio).

- [ ] **Step 1: Testes (RED primeiro).** Casos obrigatórios: (1) gramática — `{{ empresa }}` casa, `{{\n empresa }}` literal nos dois consumidores (`interpolar` E `traduzirParaPosicional`); (2) tradução com repetida — `"Oi {{primeiro_nome}}, {{empresa}}… {{primeiro_nome}}"` → corpo com `{{1}}…{{2}}…{{1}}`, mapa `['primeiro_nome','empresa']`; (3) desconhecida recusa com o código; (4) sem variável → corpo idêntico, mapa vazio; (5) `valoresPosicionais` com lacuna nula e com só-espaços → `whatsapp_lacunas`; feliz devolve na ordem do mapa; (6) **comutação** (dois exemplos, um multilinha com repetida); (7) `nomeMetaDoTitulo('Abertura frio — 1ª msg!', 'k3f2')` → `abertura_frio_1_msg_k3f2` (pino exato).

- [ ] **Step 2: Vermelho** — `npm test -- domain/script`

- [ ] **Step 3: Implementar sob TDD**

- [ ] **Step 4: Verde + portão e commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/domain/script.ts src/lib/domain/script.test.ts
git commit -m "feat: tradutor posicional com gramatica pinada e invariante de comutacao"
```

---

## Task 3: Porta `WhatsAppGraph` — os quatro métodos do disparo

**Files:**
- Modify: `src/lib/integracoes/whatsapp.ts`
- Modify: `src/lib/integracoes/whatsapp-real.ts`
- Modify: `src/lib/integracoes/whatsapp-real.test.ts`
- Modify: `src/lib/integracoes/whatsapp-falso.ts`
- Modify: `src/lib/integracoes/whatsapp-falso.test.ts`

**Interfaces:**
- Consumes: a interface e a dupla existentes (Plano 9); a técnica de substituir `fetch` de `meta-real.test.ts`.
- Produces — normativo, consumido pelas Tasks 5 e 6:

```ts
export type TemplateSubmetido = { idMeta: string; status: string }
export type StatusTemplate = { status: string; motivo: string | null }

export interface WhatsAppGraph {
  dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>>
  submeterTemplate(
    token: string,
    wabaId: string,
    d: { nome: string; idioma: string; categoria: 'marketing' | 'utility'; corpo: string },
  ): Promise<Resultado<TemplateSubmetido>>
  statusDoTemplate(
    token: string,
    wabaId: string,
    nome: string,
  ): Promise<Resultado<StatusTemplate>>
  apagarTemplate(token: string, wabaId: string, nome: string): Promise<Resultado<void>>
  enviarTemplate(
    token: string,
    phoneNumberId: string,
    e164Destino: string,
    d: { nome: string; idioma: string; valores: string[] },
  ): Promise<Resultado<{ idMensagem: string }>>
}
```

**Invariantes:**

- **Real:** `submeterTemplate` → `POST /{waba_id}/message_templates` com `name`/`language`/`category` (categoria em MAIÚSCULAS no fio — o tipo TS fica minúsculo) e `components: [{ type: 'BODY', text: corpo }]`; status da resposta normalizado para minúsculas. `statusDoTemplate` → `GET /{waba_id}/message_templates?name=<nome>&fields=status,rejected_reason` — zero resultados → `falha('template_nao_encontrado')`; status minúsculo, `rejected_reason` → `motivo`. `apagarTemplate` → `DELETE /{waba_id}/message_templates?name=<nome>`. `enviarTemplate` → `POST /{phone_number_id}/messages` com `messaging_product: 'whatsapp'`, `to` (E.164 **sem** `+`, como o `wa.me`), `type: 'template'`, template com `name`/`language.code` e `components: [{ type: 'body', parameters: valores.map(v => ({ type: 'text', text: v })) }]`. Traduções de erro: 4xx da submissão → `template_recusado_pelo_meta`; 4xx do envio → `envio_recusado`; rede/5xx em qualquer um → `whatsapp_indisponivel` — mesma forma de decisão de `whatsapp-real.ts` atual, corpo do Graph nunca vazando.
- **Falsa:** estado por WABA — `templates: Map<nome, { status, motivo, corpo, categoria }>` mutável pelos testes; **default de submissão: nasce `approved`** (é o que deixa o E2E fluir sem rota de seed; testes de pending/rejected configuram explicitamente). Registro de chamadas por método (`submetidos`, `consultados`, `apagados`, `enviados` com todos os argumentos — os testes das Tasks 5/6 afirmam sobre eles, nunca spy). `enviarTemplate` recusa com `envio_recusado` se o template não existe ou não está `approved` — o duplo reproduz a última guarda do Graph.
- **Fábrica:** nada muda — `whatsappGraph()`/`whatsappFalso()` já existem; os métodos novos entram na mesma interface.

- [ ] **Step 1: Testes (RED).** Casos: (1) real monta cada URL/corpo certo (afirme path, método e payload do `fetch` substituído — inclusive categoria maiúscula no fio e `to` sem `+`); (2) real traduz recusa e indisponibilidade por método (submissão 4xx → `template_recusado_pelo_meta`; envio 4xx → `envio_recusado`; rejeição de rede → `whatsapp_indisponivel`; status vazio → `template_nao_encontrado`); (3) falsa: submeter registra e nasce `approved` por default; configurada para `pending`/`rejected` devolve isso em `statusDoTemplate` com motivo; (4) falsa: `enviarTemplate` feliz registra `{ token, phoneNumberId, e164Destino, nome, valores }` e recusa não-aprovado com `envio_recusado`.

- [ ] **Step 2: Vermelho** — `npm test -- whatsapp`

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Verde + portão e commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/integracoes/whatsapp.ts src/lib/integracoes/whatsapp-real.ts src/lib/integracoes/whatsapp-real.test.ts src/lib/integracoes/whatsapp-falso.ts src/lib/integracoes/whatsapp-falso.test.ts
git commit -m "feat: WhatsAppGraph ganha submeter, status, apagar e enviar — real e falsa"
```

---

## Task 4: `TemplateStore` e o serviço de servidor (anon + segredo)

**Files:**
- Create: `src/lib/data/templates.ts`
- Create: `tests/integration/templates-store.test.ts`

**Interfaces:**
- Consumes: tabela e RPC da Task 1; `criarClienteServidor`/`resolverContaAtiva` (para o store de sessão); `createClient` de `@supabase/supabase-js` + `INGESTAO_SEGREDO` (para o serviço, padrão `criarIngestaoStore` de `ingestao.ts:156` — leia aquele arquivo antes); `Resultado`; `Papel`.
- Produces — normativo, consumido pelas Tasks 5 e 6:

```ts
export type TemplateWhatsApp = {
  id: string
  scriptId: string
  nomeMeta: string
  idioma: string
  categoria: 'marketing' | 'utility'
  corpoPosicional: string
  mapa: Variavel[]
  status: string
  motivoRejeicao: string | null
  statusConsultadoEm: Date | null
  criadoEm: Date
}

export type DadosTemplate = {
  scriptId: string
  nomeMeta: string
  idioma: string
  categoria: 'marketing' | 'utility'
  corpoPosicional: string
  mapa: Variavel[]
  status: string
  templateIdMeta: string | null
}

export interface TemplateStore {
  doScript(scriptId: string): Promise<Resultado<TemplateWhatsApp | null>>
  dosScripts(scriptIds: string[]): Promise<Resultado<TemplateWhatsApp[]>>
  criar(d: DadosTemplate): Promise<Resultado<string>>
  substituir(id: string, d: DadosTemplate): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
}

export async function criarTemplateStoreDoServidor(): Promise<
  Resultado<{ templates: SupabaseTemplateStore; papel: Papel }>
>

/** Servico do servidor: client ANON + segredo, padrao criarIngestaoStore.
 *  NAO usa criarClienteServidor — e o contrato do Plano 9. */
export function criarDisparoServico(): Resultado<DisparoServico>

export interface DisparoServico {
  credencial(accountId: string): Promise<Resultado<{ token: string; phoneNumberId: string; wabaId: string }>>
  atualizarStatus(templateId: string, status: string, motivo: string | null): Promise<Resultado<void>>
}
```

**Invariantes:**

- **Store de sessão no padrão `ScriptStore`:** filtro explícito `.eq('account_id', contaId)` em toda consulta; `doScript` com `maybeSingle` → `ok(null)`; `dosScripts` com `.in('script_id', ids)` (ids vêm do banco, não do usuário); erros traduzidos por código, nunca `error.message` — `23505` no `criar`/`substituir` → `template_ja_pendente`... **não**: `23505` aqui significa corrida de dupla submissão → código próprio `template_ja_existe`; `42501` → `sem_permissao`; zero linhas em `substituir`/`excluir` → `template_nao_encontrado`; genéricos `erro_ao_salvar_template`/`erro_ao_carregar_templates`.
- **`criarDisparoServico` replica a validação de `criarIngestaoStore`:** `INGESTAO_SEGREDO` vazio → `falha('ingestao_nao_configurada')` **antes** de montar o cliente; url/anonKey vazios idem. `credencial` chama a RPC `credencial_whatsapp` (traduz `whatsapp_nao_encontrado` → `sem_conexao_whatsapp`); `atualizarStatus` chama `atualizar_status_template`.
- `criarTemplateStoreDoServidor` = forma de `criarScriptStoreDoServidor` (sessão + conta ativa, sem gate — devolve `papel` para as telas gatearem).

- [ ] **Step 1: Testes de integração (RED).** Na forma de `scripts-store.test.ts`. Casos: (1) `criar` grava e `doScript` devolve mapeado (camelCase, `Date`, `mapa` como array); (2) `dosScripts` com dois scripts devolve os dois e **não** devolve template de outra conta (não-vácuo: o client cru do usuário membro das duas contas VÊ a linha alheia; o store não a devolve); (3) `substituir` troca corpo/nome/status e zero linhas → `template_nao_encontrado`; (4) `criar` duplicado (mesmo script) → `template_ja_existe`; (5) serviço: `credencial` devolve o que `conectar_whatsapp` gravou (monte a conexão pelo padrão do teste da `0019`) e `sem_conexao_whatsapp` sem conexão; (6) serviço: `atualizarStatus` persiste e o store relê o status novo — **rodando como serviço anon, sem sessão** (é o caminho de produção); (7) serviço com `INGESTAO_SEGREDO` vazio → `ingestao_nao_configurada` sem tocar rede/banco.

- [ ] **Step 2: Vermelho** — `npm run test:integration -- templates-store`

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Verde + portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add src/lib/data/templates.ts tests/integration/templates-store.test.ts
git commit -m "feat: TemplateStore de sessao e servico anon+segredo para credencial e status"
```

---

## Task 5: Submissão — bloco WhatsApp em `/scripts/[id]`

**Files:**
- Create: `src/app/(app)/scripts/template-whatsapp.tsx`
- Create: `src/app/(app)/scripts/template-whatsapp.test.tsx`
- Create: `src/app/(app)/scripts/acoes-template.ts`
- Create: `src/app/(app)/scripts/acoes-template.test.ts`
- Modify: `src/app/(app)/scripts/[id]/page.tsx`
- Modify: `src/app/(app)/scripts/erros.ts`
- Modify: `src/app/(app)/scripts/erros.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (`traduzirParaPosicional`, `nomeMetaDoTitulo`, porta via `whatsappGraph()`, `TemplateStore`, `DisparoServico`); `chamarAcao`; o padrão de action de `acoes.ts` (validação antes de IO, papel pré-checado).
- Produces — normativo, consumido pela Task 6:

```ts
// acoes-template.ts ('use server')
export async function submeterTemplate(
  scriptId: string,
  categoria: 'marketing' | 'utility',
): Promise<Resultado<void>>
```

**Comportamento — normativo:**

- **A action `submeterTemplate`, nesta ordem:** (1) resolve `criarScriptStoreDoServidor` + `criarTemplateStoreDoServidor`; papel vendedor → `sem_permissao`; (2) `buscar(scriptId)` — nulo → `script_nao_encontrado`; (3) `traduzirParaPosicional(conteudo)` — desconhecida → forward do código, **antes de qualquer IO externo**; (4) template existente com status `pending` → `falha('template_ja_pendente')` (re-submeter no meio de uma análise é recusado); (5) `criarDisparoServico().credencial(contaId)` — sem conexão → `sem_conexao_whatsapp`; (6) re-submissão: `apagarTemplate` do nome antigo no Meta — **falha do apagar não bloqueia** (nome novo nunca colide; comente: intenção explícita do usuário, não compensação — guarda nº 4); (7) `nomeMetaDoTitulo(titulo, sufixo)` com sufixo aleatório curto do chamador; (8) `submeterTemplate` no Graph; (9) `criar` ou `substituir` no store com status devolvido (normalizado; a falsa devolve `approved` por default); (10) `revalidatePath('/scripts/' + scriptId)`.
- **Status sob demanda no `page.tsx` de `/scripts/[id]`:** depois de `buscar`, resolve `doScript(id)`; se template existe com status fora de `approved`/`rejected`, consulta `statusDoTemplate` (credencial via serviço) e persiste via `atualizarStatus` — falha de qualquer ponta degrada para o gravado. Renderiza `<TemplateWhatsApp>` abaixo do `<Editor>`.
- **`template-whatsapp.tsx`** — cliente, actions por prop com default: quatro estados — sem template (select de categoria com uma linha explicando marketing×utility, default `marketing`, botão "Submeter ao WhatsApp"), `pending` (chip + "consultado há X" com `status_consultado_em`), `approved` (chip), `rejected` (chip + `motivo_rejeicao` + re-submeter). Estado extra transversal: **desatualizado** — a página passa `desatualizado: boolean` (calculado com `traduzirParaPosicional(conteudo atual)` ≠ snapshot) e o componente mostra a nota "O script mudou desde a submissão — re-submeta para atualizar" com o botão de re-submeter (admin/gestor). Sem conexão (a página descobre via `credencial` do serviço): o bloco vira uma linha apontando para `/config`. Erros pelo mapa; pendente desabilita o botão em voo.
- **Chaves novas no mapa (mensagens exatas):**

```ts
sem_conexao_whatsapp: 'Conecte um número de WhatsApp em Configuração antes de usar templates.',
template_variavel_desconhecida: 'O script usa uma variável que o CRM não conhece. Confira os nomes.',
template_posicional_reservado: 'O script contém {{número}}, forma reservada dos templates do Meta. Troque por uma variável nomeada.',
template_ja_pendente: 'Este script já tem um template em análise no Meta. Aguarde a resposta.',
template_ja_existe: 'Este script já tem um template. Recarregue a página.',
template_recusado_pelo_meta: 'O Meta recusou a submissão. Tente de novo em alguns minutos.',
template_nao_encontrado: 'Esse template não existe mais. Recarregue a página.',
template_nao_aprovado: 'O template deste script ainda não foi aprovado pelo Meta.',
template_desatualizado: 'O script mudou depois da aprovação. Re-submeta o template para enviar.',
whatsapp_sem_telefone: 'Este lead não tem telefone.',
whatsapp_lacunas: 'Faltam dados do lead para preencher o template.',
envio_recusado: 'O Meta recusou o envio. Confira o template e tente de novo.',
whatsapp_indisponivel: 'O Meta não respondeu. Tente de novo em alguns minutos.',
whatsapp_enviado_sem_evento: 'Mensagem enviada. Não conseguimos registrá-la na linha do tempo do lead.',
erro_ao_salvar_template: 'Não foi possível salvar o template. Tente de novo.',
erro_ao_carregar_templates: 'Não foi possível carregar os templates. Tente de novo.',
```

- [ ] **Step 1: Testes (RED).** `acoes-template.test.ts` (padrão `acoes.test.ts` do Plano 10 — `vi.mock` das fábricas): (1) vendedor → `sem_permissao`, nenhum IO; (2) variável desconhecida → recusa **antes** do Graph (duplo sem chamadas registradas); (3) `pending` existente → `template_ja_pendente` sem tocar o Graph; (4) fluxo feliz grava o que o Graph devolveu (status normalizado) e o corpo/mapa **da tradução** — afirme contra o duplo `submetidos`; (5) re-submissão apaga o antigo (registro em `apagados`) e **falha do apagar não bloqueia** (configure a falsa para falhar o delete; a submissão segue). `template-whatsapp.test.tsx` (jsdom): (6) os quatro estados renderizam o que devem (chip por status, motivo no rejected); (7) desatualizado mostra a nota e o re-submeter; (8) recusa traduzida pelo mapa. `erros.test.ts`: chaves novas cobertas.

- [ ] **Step 2: Vermelho** — `npm test -- template`

- [ ] **Step 3: Implementar** (componente, action, page, erros)

- [ ] **Step 4: Verde + build + verificação no navegador (não é opcional)** — com `META_FAKE`, submeta um script (a falsa aprova), veja o chip; edite o script e veja a nota de desatualizado.

```bash
npm test -- template && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Portão e commit**

```bash
npm run test:integration && npm test && npm run typecheck && npm run lint
```

```bash
git add "src/app/(app)/scripts" 
git commit -m "feat: submeter script como template do WhatsApp com status sob demanda"
```

---

## Task 6: Disparo da ficha, timeline, E2E e portão final

**Files:**
- Modify: `src/app/(app)/leads/[id]/scripts.tsx`
- Modify: `src/app/(app)/leads/[id]/scripts.test.tsx`
- Modify: `src/app/(app)/leads/[id]/page.tsx`
- Create: `src/app/(app)/leads/[id]/acoes-whatsapp.ts`
- Create: `src/app/(app)/leads/[id]/acoes-whatsapp.test.ts`
- Modify: `src/app/(app)/leads/[id]/timeline.tsx`
- Modify: `src/app/(app)/leads/[id]/timeline.test.tsx`
- Create: `tests/e2e/disparo-whatsapp.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 2–5; `PainelScripts`/`ItemScript` (props atuais em `scripts.tsx:192`); o padrão de escrita em `lead_events` de `SupabaseTarefaStore.concluir` (`tarefas.ts:197` — snapshot no payload, código próprio para "escreveu mas o evento falhou").
- Produces: nada consumido por outra task.

**Comportamento — normativo:**

- **`page.tsx` da ficha:** além de `paraEtapa`, resolve `criarTemplateStoreDoServidor().dosScripts(ids dos scripts do painel)` e, para templates `pending`, o refresh de status (mesma rotina da Task 5 — extraia a rotina para um módulo servidor compartilhado, ex. `scripts/status-template.ts`, em vez de duplicá-la). Passa ao painel `templates: TemplateWhatsApp[]` (o componente indexa por `scriptId`). Falha degrada para lista vazia — sem template, sem botão, a ficha vive.
- **`ItemScript`:** com template do script em `approved`, telefone presente, **e** snapshot batendo com a tradução do conteúdo atual (`desatualizado === false`, calculado com as funções puras), renderiza "Enviar WhatsApp". Bloqueios com motivo visível (`title`/texto): lacuna (contador que já existe), desatualizado ("re-submeta"), sem telefone (botão nem aparece — o wa.me já resolve esse estado). Clique → confirmação inline (é mensagem real para o cliente) → action → "Enviado ✓" transitório (padrão do Copiado ✓).
- **`acoes-whatsapp.ts` — `enviarWhatsApp(leadId, scriptId)`, nesta ordem no servidor:** (1) sessão + store; (2) lead visível com telefone → senão `lead_nao_encontrado`/`whatsapp_sem_telefone`; (3) template do script `approved` → senão `template_nao_aprovado`; (4) `traduzirParaPosicional(conteudo atual)` bate com snapshot → senão `template_desatualizado`; (5) `valoresPosicionais(mapa, contextoDoLead(lead, …))` → lacuna → `whatsapp_lacunas`; (6) credencial via serviço → `sem_conexao_whatsapp`; (7) `enviarTemplate(token, phoneNumberId, telefoneE164, { nome, idioma, valores })`; (8) `lead_events` insert (client de **sessão**, como `tarefa_concluida`): tipo `whatsapp_enviado`, payload `{ template: nomeMeta, texto: preencherPosicional(corpo, valores) }`; falha do evento → `whatsapp_enviado_sem_evento` **com revalidate mesmo assim** (a mensagem FOI); (9) `revalidatePath('/leads/' + leadId)`.
- **`rotuloEvento`:** case `whatsapp_enviado` → `WhatsApp enviado: <texto>` (payload snapshot; o `default` cru já protegia a ordem das tasks).
- **E2E `disparo-whatsapp.spec.ts`** (helpers de `apoio.ts`; a falsa aprova por default): admin cria script com `{{primeiro_nome}}` e `{{empresa}}`, conecta o WhatsApp falso em `/config`, submete o template; cria lead **com telefone e empresa** na etapa do script; abre a ficha → "Enviar WhatsApp" ativo → confirma → "Enviado ✓" e a timeline mostra `WhatsApp enviado:` com o texto interpolado exato (igualdade com o texto esperado montado no teste). Num lead **sem empresa**: botão bloqueado com o motivo de lacuna. Vendedor da conta: não vê "Submeter ao WhatsApp" em `/scripts/[id]` (a rota nem abre — 404, já coberto; aqui basta o painel da ficha mostrar Enviar sem o bloco de submissão).

- [ ] **Step 1: Testes (RED).** `acoes-whatsapp.test.ts` (mocks como `acoes.test.ts`): (1) a ordem das guardas — cada recusa com o código certo e **nenhuma chamada ao Graph** nas recusas 2–5 (duplo sem registro); (2) fluxo feliz: o que foi ao `enviarTemplate` da falsa (`valores`, destino) e o payload do evento — **`texto` byte-idêntico a `textoPlano(interpolar(conteudo, ctx))`** (a versão de disparo do teste do Copiar); (3) envio ok + evento falho → `whatsapp_enviado_sem_evento`. `scripts.test.tsx`: (4) botão aparece só com approved+telefone+atualizado; (5) bloqueado com lacuna dizendo por quê; (6) desatualizado mostra "re-submeta"; (7) confirmação: cancelar não chama, confirmar chama com `(leadId, scriptId)`. `timeline.test.tsx`: (8) o case novo com payload snapshot.

- [ ] **Step 2: Vermelho** — `npm test -- "leads/.id."` (ajuste o filtro; os testes do Plano 10 continuam verdes)

- [ ] **Step 3: Implementar**

- [ ] **Step 4: E2E**

```bash
npm run db:reset && npm run test:e2e -- disparo-whatsapp
```

(Derrube qualquer `npm run dev` antes.)

- [ ] **Step 5: Portão final da branch**

```bash
npm run db:reset
npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/leads/[id]" tests/e2e/disparo-whatsapp.spec.ts "src/app/(app)/scripts"
git commit -m "feat: disparo de WhatsApp da ficha do lead com timeline e bloqueio de lacuna"
```

---

## Critério de aceite do plano

O da spec §10, na íntegra — incluindo: o texto enviado é byte-idêntico ao preview (teste de comutação + caso do envio), lacuna bloqueia com motivo, vendedor dispara mas não submete, conta sem conexão não vê nada disso, e script editado depois da aprovação desativa o envio até re-submissão. Suíte verde no resultado do merge após `npx supabase db reset`. Todo teste novo com RED demonstrado.

## Review

Review de contexto fresco **por task**, e review de branch inteira antes do merge. Perguntas do review final, mirando as costuras:

1. **Tradução, interpolação e envio concordam em toda a gramática?** A comutação tem teste, mas há algum caminho (preview, submissão, envio, timeline) que monta texto por uma quarta via?
2. **O snapshot governa o envio em todos os pontos?** Botão, action e timeline usam `corpo_posicional`/`mapa` — e o `desatualizado` é calculado igual na tela e no servidor?
3. **As três identidades estão nos lugares certos?** Sessão (RLS) para ler/escrever templates e eventos; anon + segredo só para credencial e status; nenhum uso de `criarClienteServidor` nos caminhos do serviço?
4. **Vendedor:** dispara mas não submete — testado em cada camada (RLS da tabela, pré-check das actions, telas)?
5. **Nenhum corpo cru do Graph ou do PostgREST alcança tela ou timeline?** Inclusive `motivo_rejeicao` (vem do Graph — é dado, não erro: pode ser exibido, mas nunca como mensagem de exceção não-mapeada).
