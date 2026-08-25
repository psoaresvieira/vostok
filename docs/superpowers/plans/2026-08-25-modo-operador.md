# Modo Operador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono da plataforma conecta/desconecta integrações de QUALQUER conta (implantação manual por script) e todo usuário logado troca a própria senha em `/senha`.

**Architecture:** Migration 0030 recria as seis RPCs de conexão trocando só a guarda de papel para `admin OU dono da plataforma`. A troca de senha é uma rota nova no grupo `(app)` (schema zod → Server Action → `auth.updateUser`), com erros normalizados no padrão `codigoDoErroDo*` do repo e link na barra lateral para todos os papéis.

**Tech Stack:** Postgres/Supabase (plpgsql, security definer), Next.js 15 App Router, zod, vitest (+jsdom p/ .tsx), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-modo-operador-design.md` (leia antes).

## Global Constraints

- FORMA ASSIMÉTRICA (regra do repo): SQL é literal — copie do plano byte a byte. TypeScript vem como contrato (assinatura + invariantes + casos de teste nomeados); o corpo é seu, sob TDD estrito (RED antes de GREEN, sempre rodando o teste).
- Mensagem crua de Postgres/GoTrue NUNCA chega à tela — todo forward passa por normalizador com lista de permissão (ver `src/app/(app)/scripts/erros.ts` como modelo).
- Testes `.tsx` precisam de `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)` manual (o config não liga `globals`).
- `toBeTruthy`, nunca `toBeInTheDocument` (repo sem jest-dom).
- Trava de duplo submit só é provada na forma `await act(async () => { click(); click() })` — dois `fireEvent.click` separados é teste vácuo.
- Comandos: `npx vitest run --config vitest.config.ts <arquivo>` (unit), `npx vitest run --config vitest.integration.config.ts <arquivo>` (integração; exige `npx supabase start` de pé e `npm run db:reset` após criar migration), `npm run test:e2e` (rodar `npm run db:reset` ANTES — limparBanco apaga o dono do seed).
- Commits frequentes, mensagens em pt-BR no padrão `tipo(escopo): resumo`, com o trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration 0030 — bypass de dono nas seis RPCs de conexão

**Files:**
- Create: `supabase/migrations/0030_conexoes_pelo_dono.sql`
- Test: `tests/integration/0030_conexoes_pelo_dono.test.ts`

**Interfaces:**
- Consumes: `public.sou_dono_da_plataforma()` (0028), `platform_owners`, helpers de teste `comoServico/comoUsuario/criarUsuario/limparBanco` (`tests/integration/helpers/db.ts`).
- Produces: as mesmas seis RPCs com assinaturas INALTERADAS (o teste-mapa da 0024 não pode quebrar) aceitando o dono da plataforma como chamador.

- [ ] **Step 1: Escrever o teste de integração que falha**

Crie `tests/integration/0030_conexoes_pelo_dono.test.ts`. Arranjo de segredo: copie a forma de `tests/integration/0019_conexao_whatsapp.test.ts` para semear o hash do segredo de ingestão via `comoServico` (procure `hash_segredo`/`ingestion_config` lá e reuse a mesma função de arranjo). Arranjo de contas: `tornarDono(uid)` idêntico ao de `0029_follow_ups_admin.test.ts`; a conta do cliente nasce por `criar_conta_cliente` chamada pelo dono + um usuário-cliente inserido como membro admin via `comoServico` (insert direto em `memberships`), para existir `p_responsavel` válido.

Casos nomeados (todos com o dono NÃO sendo membro da conta-alvo):
1. `'dono conecta fonte meta em conta da qual nao e membro'` — `conectar_fonte_meta($segredo, $conta, <page_id>, 'Página X', 'tok', $membroCliente)` como o dono → sucesso; provar com `comoServico` que a linha existe em `lead_sources` com `account_id = $conta`. ATENÇÃO: `external_id` de meta tem check constraint — copie o formato de page_id usado em `tests/integration/0012_posse_da_page.test.ts`, não invente um.
2. `'dono conecta fonte google em conta alheia'` — `conectar_fonte_google($conta, 'Google X', 'url-tok', 'gkey', $membroCliente)` → sucesso.
3. `'dono conecta e desconecta whatsapp de conta alheia'` — `conectar_whatsapp($segredo, $conta, 'pn-1', 'waba-1', '+55 11 9...', 'Empresa', 'tok')` → sucesso; depois `desconectar_whatsapp($segredo, $id)` → some de `whatsapp_connections`.
4. `'dono reivindica page conectada por outra conta'` — conta A conecta `page-1` (via membro admin dela); dono chama `reivindicar_fonte_meta($segredo, $contaB, 'page-1', ...)` → a fonte muda para a conta B.
5. `'dono desconecta fonte de conta alheia'` — `desconectar_fonte($id)` como dono → some.
6. `'usuario comum continua barrado com sem_permissao'` — usuário não-dono e não-membro chama `conectar_fonte_meta` → rejects `/sem_permissao/` (regressão).
7. `'responsavel de fora da conta continua responsavel_invalido, ate para o dono'` — dono chama `conectar_fonte_meta` com `p_responsavel` = usuário que NÃO é membro da conta → rejects `/responsavel_invalido/`.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/0030_conexoes_pelo_dono.test.ts`
Expected: casos 1–5 FALHAM com `sem_permissao` (a guarda velha barra o dono); 6 e 7 já passam.

- [ ] **Step 3: Escrever a migration (LITERAL — copie exatamente)**

Crie `supabase/migrations/0030_conexoes_pelo_dono.sql`:

```sql
-- Modo operador: a implantacao de cada cliente e feita MANUALMENTE pelo dono
-- da plataforma (decisao do Pedro, 2026-08-25 — nada de UI de integracoes).
-- O dono NAO e membro das contas dos clientes (0028: uma membership dele
-- roubaria a resolucao de conta ativa), entao as seis RPCs de conexao ganham
-- na guarda de papel a alternativa `sou_dono_da_plataforma()`. TUDO O MAIS e
-- copia byte a byte da versao anterior (0012/0008/0019): segredo, sem_sessao,
-- validacoes de entrada, ordem das guardas e grants ficam como estavam.
-- `p_responsavel` continua exigindo membro da conta — regra operacional: o
-- cliente aceita o convite ANTES de o dono conectar as fontes.

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
  -- Cumulativos, nao alternativos. O segredo prova QUEM chamou; estes provam
  -- por conta de quem. O dono da plataforma passa pela guarda de papel (0030).
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
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
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
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

create or replace function public.conectar_fonte_google(
  p_account_id uuid,
  p_nome text,
  p_url_token text,
  p_google_key text,
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
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_url_token is null or btrim(p_url_token) = '' then
    raise exception 'segredo_vazio';
  end if;
  -- Mesmo codigo de erro do url_token: para quem esta na tela, os dois sao
  -- "o segredo saiu em branco", e a UI ja traduz segredo_vazio.
  if p_google_key is null or btrim(p_google_key) = '' then
    raise exception 'segredo_vazio';
  end if;

  insert into public.lead_sources
    (account_id, provedor, external_id, nome, responsavel_padrao_id)
  values (p_account_id, 'google', null, p_nome, p_responsavel)
  returning id into v_id;

  -- So o hash entra. O token em claro existe uma vez, no retorno da acao que o
  -- gerou, e nunca mais e recuperavel — mesmo contrato do token de convite.
  insert into public.source_credentials (source_id, url_token_hash, google_key_hash)
  values (v_id, public.hash_segredo(p_url_token), public.hash_segredo(p_google_key));

  return v_id;
end;
$$;

create or replace function public.desconectar_fonte(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  select account_id into v_account from public.lead_sources where id = p_source_id;
  if v_account is null then
    raise exception 'fonte_nao_encontrada';
  end if;
  if public.papel_na_conta(v_account) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  -- source_credentials cai pelo on delete cascade da PK.
  delete from public.lead_sources where id = p_source_id;
end;
$$;

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
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
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
  if public.papel_na_conta(v_account) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  -- whatsapp_credentials cai pelo on delete cascade da PK.
  delete from public.whatsapp_connections where id = p_connection_id;
end;
$$;
```

- [ ] **Step 4: Aplicar e ver o teste passar**

Run: `npm run db:reset` e depois `npx vitest run --config vitest.integration.config.ts tests/integration/0030_conexoes_pelo_dono.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Suite de integração inteira (o teste-mapa da 0024 e vizinhos não podem quebrar)**

Run: `npm run test:integration`
Expected: tudo verde (`create or replace` preserva ACLs; assinaturas inalteradas).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0030_conexoes_pelo_dono.sql tests/integration/0030_conexoes_pelo_dono.test.ts
git commit -m "feat(db): migration 0030 — dono da plataforma conecta integracoes de qualquer conta"
```

---

### Task 2: Schema, erros e Server Action `trocarSenha`

**Files:**
- Create: `src/app/(app)/senha/esquemas.ts` + `src/app/(app)/senha/esquemas.test.ts`
- Create: `src/app/(app)/senha/erros.ts` + `src/app/(app)/senha/erros.test.ts`
- Create: `src/app/(app)/senha/acoes.ts` + `src/app/(app)/senha/acoes.test.ts`

**Interfaces:**
- Consumes: `criarClienteServidor` (`@/lib/supabase/servidor`), `ok/falha/Resultado` (`@/lib/domain/resultado`), `FALHA_DE_CONEXAO`/`MENSAGEM_FALHA_DE_CONEXAO` (`@/lib/ui/acao`).
- Produces: `trocaDeSenhaSchema` (zod), `trocarSenha(formData: FormData): Promise<Resultado<void>>` (Server Action), `mensagemDeErroSenha(codigo: string): string`.

**Contrato (corpo é seu, sob TDD):**

`esquemas.ts` — `trocaDeSenhaSchema`: `{ senha: string min 8 → 'senha_curta'; confirmacao: string }` com `refine` de igualdade → código `'senhas_diferentes'`. Mesmo piso de 8 do `credenciaisSchema` do cadastro — não invente outro.

`erros.ts` — mapa `MENSAGENS_ERRO` + `mensagemDeErroSenha` no padrão de `(auth)/erros.ts` (hasOwnProperty, fallback = eco do código). Códigos e textos:
- `senha_curta`: 'A senha precisa de pelo menos 8 caracteres.'
- `senhas_diferentes`: 'As duas senhas não conferem.'
- `senha_igual`: 'A senha nova precisa ser diferente da atual.'
- `sem_sessao`: 'Sua sessão expirou. Entre novamente.'
- `erro_ao_trocar_senha`: 'Não foi possível trocar a senha. Tente de novo.'
- `[FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO`

`acoes.ts` — `'use server'`. `trocarSenha`: parse do schema (falha → primeiro código do zod); `criarClienteServidor()`; `auth.updateUser({ password })`. Invariantes:
- Erro do GoTrue NUNCA vaza cru: `error.code === 'same_password'` OU mensagem contendo 'different from the old' → `falha('senha_igual')`; mensagem contendo 'session' ausente/expirada → `falha('sem_sessao')`; resto → `console.error` + `falha('erro_ao_trocar_senha')`.
- Sucesso → `ok(undefined)` (sem redirect — a página mostra confirmação inline).

**Casos de teste nomeados:**
- esquemas: `'aceita senha de 8+ com confirmacao igual'`; `'rejeita senha curta com senha_curta'`; `'rejeita confirmacao diferente com senhas_diferentes'`.
- erros: `'traduz cada codigo novo'` (it.each nos 5, `not.toBe(codigo)`); `'ecoa codigo desconhecido'`.
- acoes (mock file-scoped de `@/lib/supabase/servidor` com `updateUser` configurável, mesmo arranjo de `(auth)/acoes-cadastro.test.ts`): `'sucesso devolve ok'`; `'same_password vira senha_igual'` (code E variante só-mensagem); `'erro desconhecido vira erro_ao_trocar_senha, nunca a mensagem crua'`; `'schema invalido nem toca o supabase'` (updateUser não chamado).

- [ ] **Step 1: Testes RED** — escreva os três arquivos de teste; rode `npx vitest run --config vitest.config.ts "src/app/(app)/senha/"`; Expected: FAIL por módulo inexistente.
- [ ] **Step 2: Implementar até GREEN** — mesmos comandos, tudo verde.
- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/senha/"
git commit -m "feat(senha): schema, erros e action de troca de senha"
```

---

### Task 3: Página `/senha`, formulário e link na barra lateral

**Files:**
- Create: `src/app/(app)/senha/page.tsx`
- Create: `src/app/(app)/senha/formulario.tsx` + `src/app/(app)/senha/formulario.test.tsx`
- Modify: `src/app/(app)/barra-lateral.tsx` (rodapé, bloco dos ícones ~linha 199–227)
- Test: `src/app/(app)/barra-lateral.test.tsx` (crie se não existir; se existir, acrescente)

**Interfaces:**
- Consumes: `trocarSenha` e `mensagemDeErroSenha` (Task 2).
- Produces: rota `/senha` acessível a qualquer papel logado.

**Contrato:**

`page.tsx` — server component simples: `<h1>Trocar senha</h1>` + `<FormularioSenha />`. SEM guarda de papel (o middleware já exige sessão; a action revalida). Não chame `resolverContaAtiva` — a troca de senha é do usuário, não da conta.

`formulario.tsx` — client component: dois `<input type="password">` com placeholders `nova senha (min. 8 caracteres)` e `confirme a nova senha`; submit chama `trocarSenha`; estado `pendente` desabilita o botão E a trava é síncrona (seta antes do await — o risco é dupla chamada ao GoTrue); erro via `mensagemDeErroSenha`; sucesso mostra `Senha trocada ✓` e limpa os campos. Use `Botao` (`@/components/ui/botao`) para o submit.

`barra-lateral.tsx` — link novo no rodapé, JUNTO do bloco Sino/Config/Sair, para TODOS os papéis (diferente do `/config`, que é `papel === 'admin'`): ícone `KeyRound` do lucide com `PROPS_ICONE`, `aria-label="Trocar senha"`, `title="Trocar senha"`, mesma classe dos vizinhos e mesmo tratamento de `caminho.startsWith('/senha')` para o estado ativo.

**Casos de teste nomeados:**
- formulario (jsdom, mock da action): `'submete e mostra Senha trocada'`; `'dois cliques num act unico disparam UMA chamada'` (forma da Global Constraint; valide por mutação: remova a trava e o teste TEM que ficar vermelho antes de devolvê-la); `'erro da action aparece traduzido, nunca o codigo'`; `'senhas diferentes barram no cliente sem chamar a action'`.
- barra-lateral (jsdom): `'link Trocar senha aparece para vendedor'` (render com `papel="vendedor"`, `getByRole('link', { name: 'Trocar senha' })`); `'link Configuração continua so para admin'` (regressão: com vendedor, `queryByRole('link', { name: 'Configuração' })` é null).

- [ ] **Step 1: Testes RED** — `npx vitest run --config vitest.config.ts "src/app/(app)/senha/formulario.test.tsx" "src/app/(app)/barra-lateral.test.tsx"`; Expected: FAIL.
- [ ] **Step 2: Implementar até GREEN.**
- [ ] **Step 3: Suite unitária inteira** — `npm test`; Expected: tudo verde.
- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/senha/" "src/app/(app)/barra-lateral.tsx" "src/app/(app)/barra-lateral.test.tsx"
git commit -m "feat(senha): pagina /senha com link na barra para todos os papeis"
```

---

### Task 4: E2E do ciclo real de senha

**Files:**
- Create: `tests/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: `criarConta`, `SENHA`, helpers de `tests/e2e/apoio.ts`.

**Contrato:** UM teste. `criarConta(page)` devolve `{ email }` de um usuário novo (NUNCA use o DONO — trocar a senha dele quebraria os specs seguintes, o banco não é limpo entre arquivos). Estando logado como esse usuário: clicar no link `Trocar senha` da barra → URL `/senha` → preencher nova senha (`SENHA + '-nova'`) e confirmação → submeter → esperar `Senha trocada`; `Sair`; logar com a senha ANTIGA → continua em `/login` com erro; logar com a NOVA → `/funil`.

- [ ] **Step 1: Escrever o spec e rodar (RED se a UI não existir; nesta altura das tasks, deve passar direto — se passar de primeira, quebre de propósito o seletor uma vez para provar que o teste morde, e desfaça).**

Run: `npm run db:reset` e depois `npx playwright test tests/e2e/senha.spec.ts`
Expected: 1 passed.

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/senha.spec.ts
git commit -m "test(e2e): ciclo real de troca de senha"
```

---

### Task 5: Verificação final da branch

- [ ] **Step 1:** `npm test` && `npm run typecheck` && `npm run lint` && `npm run build` — tudo limpo.
- [ ] **Step 2:** `npm run test:integration` — verde.
- [ ] **Step 3:** `npm run db:reset` && `npm run test:e2e` — verde (23 specs).
- [ ] **Step 4:** Review final de branch em contexto fresco (`/code-review master..HEAD high`); aplicar/recusar achados com justificativa no ledger.
- [ ] **Step 5:** Merge ff em master. ORDEM banco→app: `npx supabase db push` (aplica a 0030 em produção — o histórico está são desde 2026-08-25) ANTES de `git push origin master` (auto-deploy). Smoke: produção responde; `npx supabase migration list` 30/30.
