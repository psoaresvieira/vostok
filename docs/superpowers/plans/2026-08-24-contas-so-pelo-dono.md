# Contas só pelo dono da plataforma — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o cadastro aberto do Vostok: só o dono da plataforma cria contas (via `/admin`), clientes entram por link de convite.

**Architecture:** Nova tabela `platform_owners` + guardas nas RPCs (a segurança vive no banco); o caminho `cadastrarAbrindoConta` morre; `/signup` passa a exigir `?convite=`; página `/admin` (404 para não-donos) cria conta+convite via RPC `criar_conta_cliente` e lista contas via `contas_da_plataforma`.

**Tech Stack:** Next.js App Router (server actions), Supabase (Postgres + RLS + RPC security definer), zod v4, vitest + RTL, Playwright, pg (testes de integração).

**Spec:** `docs/superpowers/specs/2026-08-24-contas-so-pelo-dono-design.md` (a spec diz "migration 0014"; o número real da próxima migration é **0028**).

## Global Constraints

- Código, comentários e mensagens em pt-BR, sem acentos em identificadores (padrão do repo).
- Toda action/função de dados retorna `Resultado<T>` (`ok`/`falha`) de `@/lib/domain/resultado`.
- Comentários só para restrição que o código não mostra; nada de "o que a linha faz".
- Migrations seguem o checklist de guardas silenciosas (search_path fixado em função DEFINER, RLS explícita, revoke/grant deliberados — ver 0021/0024 como referência de estilo).
- Testes unitários: `npm test`. Integração: `npm run test:integration` (exige `npx supabase start` ativo; `npx supabase db reset` aplica migrations+seed). E2E: `npm run test:e2e`.
- Tokens de convite: 32 hex (`gen_random_uuid` sem hífens), validade 7 dias — mesmo formato do fluxo existente (`admin.ts` DIAS_DE_VALIDADE).
- Commit ao fim de cada task.

---

### Task 1: Migration 0028 — platform_owners, guardas e RPCs novas

**Files:**
- Create: `supabase/migrations/0028_contas_so_do_dono.sql`
- Create: `tests/integration/0028_contas_so_do_dono.test.ts`
- Modify: `tests/integration/helpers/cenario.ts` (montarCenario: admin vira dono só durante o `criar_conta`)

**Interfaces:**
- Produces (SQL, usadas pelas tasks 4–6):
  - `public.sou_dono_da_plataforma() returns boolean` (grant: authenticated)
  - `public.criar_conta_cliente(p_nome text, p_email text) returns text` — token do convite (grant: authenticated; guarda interna)
  - `public.reemitir_convite(p_convite uuid) returns text` — token novo (grant: authenticated; guarda interna)
  - `public.contas_da_plataforma() returns table (conta_id uuid, nome text, criado_em timestamptz, convite_id uuid, convite_email text, convite_expira_em timestamptz, convite_aceito_em timestamptz)` — vazia para não-dono
  - `public.criar_conta(p_nome)` inalterada na assinatura, agora exige dono
  - `public.montar_conta(p_nome text) returns uuid` — interna (revoke total), seed da conta sem membership

- [ ] **Step 1: Escrever os testes de integração que falham**

`tests/integration/0028_contas_so_do_dono.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

async function tornarDono(userId: string): Promise<void> {
  await comoServico((c) =>
    c.query('insert into public.platform_owners (user_id) values ($1) on conflict do nothing', [userId]),
  )
}

beforeEach(limparBanco)

describe('0028 — contas so pelo dono da plataforma', () => {
  it('criar_conta falha para usuario comum com sem_permissao', async () => {
    const uid = await criarUsuario('comum@a.com')
    await expect(
      comoUsuario(uid, (c) => c.query(`select public.criar_conta('Empresa X')`)),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('criar_conta do dono mantem o seed completo da conta', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    const contaId = await comoUsuario(uid, async (c) =>
      (await c.query<{ id: string }>(`select public.criar_conta('Empresa X') as id`)).rows[0].id,
    )
    const n = await comoServico(async (c) =>
      (
        await c.query<{ etapas: number; motivos: number; membros: number }>(
          `select
             (select count(*)::int from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.account_id = $1) as etapas,
             (select count(*)::int from public.loss_reasons where account_id = $1) as motivos,
             (select count(*)::int from public.memberships where account_id = $1) as membros`,
          [contaId],
        )
      ).rows[0],
    )
    expect(n).toEqual({ etapas: 7, motivos: 5, membros: 1 })
  })

  it('criar_conta_cliente cria conta com convite admin e SEM membership do dono', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    const token = await comoUsuario(uid, async (c) =>
      (
        await c.query<{ t: string }>(
          `select public.criar_conta_cliente('Cliente X', '  Cliente@Ex.com ') as t`,
        )
      ).rows[0].t,
    )
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    const convite = await comoServico(async (c) =>
      (
        await c.query<{ account_id: string; email: string; papel: string; aceito_em: string | null }>(
          'select account_id, email, papel, aceito_em from public.invites where token = $1',
          [token],
        )
      ).rows[0],
    )
    expect(convite.email).toBe('cliente@ex.com')
    expect(convite.papel).toBe('admin')
    expect(convite.aceito_em).toBeNull()
    const membros = await comoServico(async (c) =>
      (
        await c.query<{ n: number }>(
          'select count(*)::int as n from public.memberships where account_id = $1',
          [convite.account_id],
        )
      ).rows[0].n,
    )
    expect(membros).toBe(0)
  })

  it('criar_conta_cliente falha para usuario comum', async () => {
    const uid = await criarUsuario('comum@a.com')
    await expect(
      comoUsuario(uid, (c) => c.query(`select public.criar_conta_cliente('X', 'x@x.com')`)),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('reemitir_convite troca o token e estende a validade; convite aceito e recusado', async () => {
    const uid = await criarUsuario('dono@a.com')
    await tornarDono(uid)
    const token = await comoUsuario(uid, async (c) =>
      (await c.query<{ t: string }>(`select public.criar_conta_cliente('X', 'x@x.com') as t`)).rows[0].t,
    )
    const conviteId = await comoServico(async (c) =>
      (await c.query<{ id: string }>('select id from public.invites where token = $1', [token])).rows[0].id,
    )
    const novo = await comoUsuario(uid, async (c) =>
      (await c.query<{ t: string }>('select public.reemitir_convite($1) as t', [conviteId])).rows[0].t,
    )
    expect(novo).toMatch(/^[0-9a-f]{32}$/)
    expect(novo).not.toBe(token)

    await comoServico((c) => c.query('update public.invites set aceito_em = now() where id = $1', [conviteId]))
    await expect(
      comoUsuario(uid, (c) => c.query('select public.reemitir_convite($1)', [conviteId])),
    ).rejects.toThrow(/convite_ja_aceito/)
  })

  it('contas_da_plataforma lista tudo para o dono e vem VAZIA para usuario comum', async () => {
    const dono = await criarUsuario('dono@a.com')
    const comum = await criarUsuario('comum@a.com')
    await tornarDono(dono)
    await comoUsuario(dono, (c) => c.query(`select public.criar_conta_cliente('Cliente A', 'a@a.com')`))

    const doDono = await comoUsuario(dono, async (c) =>
      (await c.query('select * from public.contas_da_plataforma()')).rows,
    )
    expect(doDono).toHaveLength(1)
    expect(doDono[0]).toMatchObject({ nome: 'Cliente A', convite_email: 'a@a.com', convite_aceito_em: null })

    const doComum = await comoUsuario(comum, async (c) =>
      (await c.query('select * from public.contas_da_plataforma()')).rows,
    )
    expect(doComum).toHaveLength(0)
  })

  it('sou_dono_da_plataforma distingue dono de usuario comum', async () => {
    const dono = await criarUsuario('dono@a.com')
    const comum = await criarUsuario('comum@a.com')
    await tornarDono(dono)
    const rDono = await comoUsuario(dono, async (c) =>
      (await c.query<{ e: boolean }>('select public.sou_dono_da_plataforma() as e')).rows[0].e,
    )
    const rComum = await comoUsuario(comum, async (c) =>
      (await c.query<{ e: boolean }>('select public.sou_dono_da_plataforma() as e')).rows[0].e,
    )
    expect(rDono).toBe(true)
    expect(rComum).toBe(false)
  })

  it('platform_owners e invisivel e imutavel para authenticated', async () => {
    const uid = await criarUsuario('comum@a.com')
    await expect(
      comoUsuario(uid, (c) => c.query('select * from public.platform_owners')),
    ).rejects.toThrow(/permission denied/)
    await expect(
      comoUsuario(uid, (c) => c.query('insert into public.platform_owners (user_id) values ($1)', [uid])),
    ).rejects.toThrow(/permission denied/)
  })
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npx supabase db reset && npm run test:integration -- 0028`
Expected: FAIL — `relation "public.platform_owners" does not exist` / função não existe.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/0028_contas_so_do_dono.sql`:

```sql
-- Contas passam a nascer apenas pela mao do dono da plataforma. O cadastro
-- aberto (qualquer autenticado chamando criar_conta) morre aqui; o app deixa
-- de chamar criar_conta, mas a guarda de verdade e' esta, no banco.

create table public.platform_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

-- RLS ligada SEM policy + revoke: a tabela nao existe para a API. So funcoes
-- DEFINER (dono postgres) a consultam. As duas camadas de proposito — o
-- revoke nega o acesso hoje, a RLS segura o dia em que um grant largo voltar.
alter table public.platform_owners enable row level security;
revoke all on table public.platform_owners from anon, authenticated;

-- Seed de producao por email, idempotente. Onde o email nao existe (banco
-- local recem-resetado), nao insere nada — o dono local vem do seed.sql.
insert into public.platform_owners (user_id)
select id from auth.users where lower(email) = 'psoaresvieira2005@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.sou_dono_da_plataforma()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_owners where user_id = auth.uid());
$$;
revoke all on function public.sou_dono_da_plataforma() from public, anon;
grant execute on function public.sou_dono_da_plataforma() to authenticated;

-- Seed da conta extraido de criar_conta, SEM membership: criar_conta_cliente
-- cria conta para OUTRA pessoa e o dono nao pode virar membro dela (a conta
-- ativa do app e' a membership mais antiga — uma membership do dono roubaria
-- a resolucao). Interna: revoke total, so' roda dentro das funcoes DEFINER.
create or replace function public.montar_conta(p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_pipeline uuid;
begin
  insert into public.accounts (nome) values (p_nome) returning id into v_account;

  insert into public.pipelines (account_id, nome, is_default)
  values (v_account, 'Funil de vendas', true)
  returning id into v_pipeline;

  insert into public.stages (pipeline_id, nome, ordem, tipo) values
    (v_pipeline, 'Novo lead', 1, 'aberta'),
    (v_pipeline, 'Contato feito', 2, 'aberta'),
    (v_pipeline, 'Qualificação', 3, 'aberta'),
    (v_pipeline, 'Proposta', 4, 'aberta'),
    (v_pipeline, 'Fechamento', 5, 'aberta'),
    (v_pipeline, 'Ganho', 6, 'ganho'),
    (v_pipeline, 'Perdido', 7, 'perdido');

  insert into public.loss_reasons (account_id, nome) values
    (v_account, 'Preço'),
    (v_account, 'Sem orçamento'),
    (v_account, 'Sem resposta'),
    (v_account, 'Comprou do concorrente'),
    (v_account, 'Fora do perfil');

  return v_account;
end;
$$;
revoke all on function public.montar_conta(text) from public, anon, authenticated;

-- Mesma assinatura de sempre (o rpc('criar_conta') do app nao quebra), corpo
-- novo: guarda de dono + delega o seed a montar_conta. Grants inalterados.
create or replace function public.criar_conta(p_nome text)
returns uuid
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
  if not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  v_account := public.montar_conta(p_nome);

  insert into public.memberships (account_id, user_id, papel)
  values (v_account, auth.uid(), 'admin');

  return v_account;
end;
$$;

-- Conta para um cliente: seed completo, nenhuma membership, e o primeiro
-- convite (admin) ja emitido para o email do cliente. Token no formato do
-- fluxo existente (32 hex, 7 dias — ver DIAS_DE_VALIDADE em lib/data/admin.ts).
create or replace function public.criar_conta_cliente(p_nome text, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_token text;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  v_email := lower(trim(p_email));
  if v_email = '' or trim(coalesce(p_nome, '')) = '' then
    raise exception 'entrada_invalida';
  end if;

  v_account := public.montar_conta(trim(p_nome));

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
  values (v_account, v_email, 'admin', v_token, now() + interval '7 days', auth.uid());

  return v_token;
end;
$$;
revoke all on function public.criar_conta_cliente(text, text) from public, anon;
grant execute on function public.criar_conta_cliente(text, text) to authenticated;

create or replace function public.reemitir_convite(p_convite uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  select * into v_invite from public.invites where id = p_convite;
  if v_invite.id is null then
    raise exception 'convite_invalido';
  end if;
  if v_invite.aceito_em is not null then
    raise exception 'convite_ja_aceito';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '');
  update public.invites set token = v_token, expira_em = now() + interval '7 days'
   where id = p_convite;

  return v_token;
end;
$$;
revoke all on function public.reemitir_convite(uuid) from public, anon;
grant execute on function public.reemitir_convite(uuid) to authenticated;

-- Listagem do /admin. Guarda por WHERE em vez de exception: para nao-dono a
-- funcao devolve conjunto vazio (nada vaza); o 404 da pagina vem de
-- sou_dono_da_plataforma, nao daqui. O convite mostrado e' o mais recente
-- criado por um dono — convites de equipe (criados pelo admin do cliente)
-- nao aparecem aqui.
create or replace function public.contas_da_plataforma()
returns table (
  conta_id uuid,
  nome text,
  criado_em timestamptz,
  convite_id uuid,
  convite_email text,
  convite_expira_em timestamptz,
  convite_aceito_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.nome, a.criado_em, i.id, i.email, i.expira_em, i.aceito_em
  from public.accounts a
  left join lateral (
    select inv.id, inv.email, inv.expira_em, inv.aceito_em
    from public.invites inv
    where inv.account_id = a.id
      and inv.criado_por in (select user_id from public.platform_owners)
    order by inv.criado_em desc
    limit 1
  ) i on true
  where exists (select 1 from public.platform_owners o where o.user_id = auth.uid())
  order by a.criado_em desc;
$$;
revoke all on function public.contas_da_plataforma() from public, anon;
grant execute on function public.contas_da_plataforma() to authenticated;
```

- [ ] **Step 4: Adaptar montarCenario (a suíte inteira depende dele)**

Em `tests/integration/helpers/cenario.ts`, substituir o bloco que cria a conta:

```ts
  // criar_conta agora exige dono da plataforma. O admin do cenario vira dono
  // SO' durante a criacao e volta a ser um admin comum em seguida — os testes
  // de RLS existentes continuam valendo para um usuario sem privilegio global.
  await comoServico((c) =>
    c.query('insert into public.platform_owners (user_id) values ($1) on conflict do nothing', [adminId]),
  )
  const accountId = await comoUsuario(adminId, async (c) =>
    (await c.query<{ id: string }>('select public.criar_conta($1) as id', ['Empresa Exemplo'])).rows[0].id,
  )
  await comoServico((c) => c.query('delete from public.platform_owners where user_id = $1', [adminId]))
```

- [ ] **Step 5: Aplicar e rodar a integração inteira**

Run: `npx supabase db reset && npm run test:integration`
Expected: PASS — inclusive as suítes antigas (0001–0027 e stores) com o cenário adaptado.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0028_contas_so_do_dono.sql tests/integration/0028_contas_so_do_dono.test.ts tests/integration/helpers/cenario.ts
git commit -m "feat(db): contas so nascem pela mao do dono da plataforma"
```

---

### Task 2: Fechar o cadastro aberto nas actions de auth

**Files:**
- Modify: `src/app/(auth)/acoes.ts` (remover `cadastrarAbrindoConta`; `cadastrar` exige convite)
- Modify: `src/app/(auth)/esquemas.ts` (remover `cadastroSchema`)
- Modify: `src/app/(auth)/erros.ts` (mensagem de `cadastro_fechado`)
- Modify: `src/app/(auth)/acoes.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `cadastrar(formData)` retorna `falha('cadastro_fechado')` quando o formulário não traz `convite`; `cadastroSchema` deixa de existir (era usado só pelo caminho removido).

- [ ] **Step 1: Testes que falham**

Em `src/app/(auth)/acoes.test.ts`: apagar o `describe('cadastroSchema', …)` inteiro, tirar `cadastroSchema` do import de `./esquemas`, e acrescentar:

```ts
import { vi } from 'vitest'
import { cadastrar } from './acoes'

vi.mock('@/lib/supabase/servidor', () => ({
  criarClienteServidor: vi.fn(async () => {
    throw new Error('cadastro sem convite nao pode tocar o supabase')
  }),
}))

describe('cadastrar sem convite', () => {
  it('falha com cadastro_fechado antes de qualquer chamada ao supabase', async () => {
    const fd = new FormData()
    fd.set('nome', 'Ana')
    fd.set('email', 'ana@exemplo.com')
    fd.set('senha', 'segredo123')
    const r = await cadastrar(fd)
    expect(r).toEqual({ ok: false, erro: 'cadastro_fechado' })
  })
})

describe('mensagemDeErro do cadastro fechado', () => {
  it('explica que o cadastro e por convite', () => {
    expect(mensagemDeErro('cadastro_fechado')).toBe(
      'O cadastro é feito por convite. Peça o link ao administrador.',
    )
  })
})
```

(Ajustar o import de `vi`: `import { describe, it, expect, vi } from 'vitest'`.)

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test -- acoes.test`
Expected: FAIL — `cadastrar` ainda abre conta (retorna outro erro/mensagem ausente).

- [ ] **Step 3: Implementar**

Em `src/app/(auth)/esquemas.ts`, remover o export `cadastroSchema` (as linhas 10–13). `credenciaisSchema` e `cadastroPorConviteSchema` ficam.

Em `src/app/(auth)/acoes.ts`:
- Remover a função `cadastrarAbrindoConta` inteira e o import de `cadastroSchema`.
- Substituir `cadastrar` por:

```ts
export async function cadastrar(formData: FormData): Promise<Resultado<void>> {
  const convite = tokenDoConvite(formData)
  // O cadastro aberto morreu com o modelo de negocio: conta nasce pela mao do
  // dono da plataforma (/admin), e quem chega aqui sem convite nao tem o que
  // cadastrar. A guarda de verdade esta no banco (criar_conta exige dono);
  // esta e' so a traducao educada.
  if (!convite) return falha('cadastro_fechado')
  return cadastrarComConvite(formData, convite)
}
```

Em `src/app/(auth)/erros.ts`, acrescentar ao mapa:

```ts
  cadastro_fechado: 'O cadastro é feito por convite. Peça o link ao administrador.',
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS (a suíte toda — nenhum outro módulo importava `cadastroSchema`/`cadastrarAbrindoConta`; confirmar com `grep -rn "cadastroSchema" src/`).

- [ ] **Step 5: Commit**

```bash
git add src/app/(auth)/acoes.ts src/app/(auth)/esquemas.ts src/app/(auth)/erros.ts src/app/(auth)/acoes.test.ts
git commit -m "feat(auth): cadastro passa a exigir convite (cadastro_fechado)"
```

---

### Task 3: /signup exige convite; link "Criar uma conta" só com convite

**Files:**
- Modify: `src/app/(auth)/signup/page.tsx` (redirect sem token)
- Modify: `src/app/(auth)/signup/formulario.tsx` (prop `convite: string`; sem campo de empresa)
- Modify: `src/app/(auth)/login/formulario.tsx` (link condicionado)
- Create: `src/app/(auth)/signup/formulario.test.tsx`
- Create: `src/app/(auth)/login/formulario.test.tsx`

**Interfaces:**
- Consumes: `cadastrar`/`entrar` de `../acoes` (inalterados nesta task).
- Produces: `FormularioCadastro({ convite }: { convite: string })` — prop obrigatória não-nula; `SignupPage` redireciona para `/login` sem token.

- [ ] **Step 1: Testes que falham**

`src/app/(auth)/signup/formulario.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormularioCadastro } from './formulario'

vi.mock('../acoes', () => ({ cadastrar: vi.fn() }))

describe('FormularioCadastro', () => {
  it('nao oferece campo de empresa: a conta ja existe, o convidado so entra', () => {
    render(<FormularioCadastro convite="tok123" />)
    expect(screen.queryByPlaceholderText('nome da empresa')).toBeNull()
    expect(screen.getByPlaceholderText('seu nome')).toBeInTheDocument()
  })

  it('carrega o token do convite no formulario', () => {
    const { container } = render(<FormularioCadastro convite="tok123" />)
    const escondido = container.querySelector('input[name="convite"]')
    expect(escondido).toHaveAttribute('value', 'tok123')
  })
})
```

`src/app/(auth)/login/formulario.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormularioLogin } from './formulario'

vi.mock('../acoes', () => ({ entrar: vi.fn() }))

describe('FormularioLogin', () => {
  it('sem convite nao oferece criar conta: cadastro e fechado', () => {
    render(<FormularioLogin convite={null} />)
    expect(screen.queryByRole('link', { name: 'Criar uma conta' })).toBeNull()
  })

  it('com convite oferece criar conta levando o token junto', () => {
    render(<FormularioLogin convite="tok123" />)
    const link = screen.getByRole('link', { name: 'Criar uma conta' })
    expect(link).toHaveAttribute('href', '/signup?convite=tok123')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test -- formulario.test`
Expected: FAIL — campo "nome da empresa" ainda renderiza sem convite; link sempre presente.

- [ ] **Step 3: Implementar**

`src/app/(auth)/signup/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { FormularioCadastro } from './formulario'

// Server Component so para ler ?convite= e passar como prop. Sem convite nao
// ha cadastro: conta nasce pela mao do dono da plataforma (/admin), e o
// visitante que digitou /signup na mao volta para a porta de entrada.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string | string[] }>
}) {
  const { convite } = await searchParams
  const token = (Array.isArray(convite) ? convite[0] : convite)?.trim()
  if (!token) redirect('/login')
  return <FormularioCadastro convite={token} />
}
```

`src/app/(auth)/signup/formulario.tsx` — mudanças pontuais:
- Prop: `{ convite }: { convite: string }`.
- O aviso "Você foi convidado…" e o `<input type="hidden" name="convite" …/>` deixam de ser condicionais (`{convite && …}` → sempre).
- Remover a linha `{!convite && <Campo name="nomeConta" … />}` inteira.
- Link do rodapé: `href={`/login?convite=${encodeURIComponent(convite)}`}` (sem ternária).

`src/app/(auth)/login/formulario.tsx` — envolver o link:

```tsx
        {convite && (
          <Link
            href={`/signup?convite=${encodeURIComponent(convite)}`}
            className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Criar uma conta
          </Link>
        )}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/signup" "src/app/(auth)/login"
git commit -m "feat(auth): /signup so existe com convite; login sem atalho de cadastro"
```

---

### Task 4: Camada de dados da plataforma

**Files:**
- Create: `src/lib/data/plataforma.ts`
- Create: `src/lib/data/plataforma.test.ts`

**Interfaces:**
- Consumes: `clienteDoServidor` de `./sessao`; RPCs da Task 1.
- Produces (usadas pela Task 5):
  - `souDonoDaPlataforma(): Promise<boolean>` (false em qualquer erro)
  - `criarContaCliente(nome: string, email: string): Promise<Resultado<string>>` (token)
  - `reemitirConvite(conviteId: string): Promise<Resultado<string>>` (token novo)
  - `contasDaPlataforma(): Promise<Resultado<ContaDaPlataforma[]>>`
  - `type ContaDaPlataforma = { id: string; nome: string; criadoEm: Date; convite: { id: string; email: string; expiraEm: Date; aceitoEm: Date | null } | null }`

- [ ] **Step 1: Testes que falham**

`src/lib/data/plataforma.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./sessao', () => ({ clienteDoServidor: vi.fn(async () => ({ rpc })) }))

import {
  souDonoDaPlataforma,
  criarContaCliente,
  reemitirConvite,
  contasDaPlataforma,
} from './plataforma'

beforeEach(() => rpc.mockReset())

describe('souDonoDaPlataforma', () => {
  it('true quando a RPC diz true', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await souDonoDaPlataforma()).toBe(true)
    expect(rpc).toHaveBeenCalledWith('sou_dono_da_plataforma')
  })

  it('false em erro: guarda nunca abre por falha', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await souDonoDaPlataforma()).toBe(false)
  })
})

describe('criarContaCliente', () => {
  it('devolve o token e passa nome/email para a RPC', async () => {
    rpc.mockResolvedValue({ data: 'tok123', error: null })
    const r = await criarContaCliente('Cliente X', 'x@x.com')
    expect(r).toEqual({ ok: true, valor: 'tok123' })
    expect(rpc).toHaveBeenCalledWith('criar_conta_cliente', { p_nome: 'Cliente X', p_email: 'x@x.com' })
  })

  it('extrai o codigo de erro da mensagem do postgres', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: sem_permissao' } })
    const r = await criarContaCliente('X', 'x@x.com')
    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
  })
})

describe('reemitirConvite', () => {
  it('traduz convite_ja_aceito', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'P0001 convite_ja_aceito' } })
    expect(await reemitirConvite('id-1')).toEqual({ ok: false, erro: 'convite_ja_aceito' })
  })
})

describe('contasDaPlataforma', () => {
  it('mapeia linhas com e sem convite', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          conta_id: 'c1', nome: 'Cliente A', criado_em: '2026-08-24T12:00:00Z',
          convite_id: 'i1', convite_email: 'a@a.com',
          convite_expira_em: '2026-08-31T12:00:00Z', convite_aceito_em: null,
        },
        {
          conta_id: 'c2', nome: 'Minha Conta', criado_em: '2026-08-01T12:00:00Z',
          convite_id: null, convite_email: null, convite_expira_em: null, convite_aceito_em: null,
        },
      ],
      error: null,
    })
    const r = await contasDaPlataforma()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor[0].convite?.email).toBe('a@a.com')
    expect(r.valor[0].convite?.aceitoEm).toBeNull()
    expect(r.valor[1].convite).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test -- plataforma`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/lib/data/plataforma.ts`:

```ts
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { clienteDoServidor } from './sessao'

/** Uma conta vista pelo dono da plataforma, com o convite inicial (se houver). */
export type ContaDaPlataforma = {
  id: string
  nome: string
  criadoEm: Date
  convite: { id: string; email: string; expiraEm: Date; aceitoEm: Date | null } | null
}

type LinhaDaRpc = {
  conta_id: string
  nome: string
  criado_em: string
  convite_id: string | null
  convite_email: string | null
  convite_expira_em: string | null
  convite_aceito_em: string | null
}

// Mesmo artificio de aceitarConvite em (auth)/acoes.ts: o postgres embrulha o
// raise exception em prefixos variados, entao procuramos o codigo na mensagem.
const CODIGOS = [
  'sem_sessao',
  'sem_permissao',
  'entrada_invalida',
  'convite_invalido',
  'convite_ja_aceito',
] as const

function codigoDeErro(mensagem: string): string {
  for (const codigo of CODIGOS) if (mensagem.includes(codigo)) return codigo
  return mensagem
}

/** False em qualquer erro: uma guarda que falha aberta nao e' guarda. */
export async function souDonoDaPlataforma(): Promise<boolean> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('sou_dono_da_plataforma')
  if (error) return false
  return data === true
}

export async function criarContaCliente(nome: string, email: string): Promise<Resultado<string>> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('criar_conta_cliente', {
    p_nome: nome,
    p_email: email,
  })
  if (error) return falha(codigoDeErro(error.message))
  return ok(data as string)
}

export async function reemitirConvite(conviteId: string): Promise<Resultado<string>> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('reemitir_convite', { p_convite: conviteId })
  if (error) return falha(codigoDeErro(error.message))
  return ok(data as string)
}

export async function contasDaPlataforma(): Promise<Resultado<ContaDaPlataforma[]>> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('contas_da_plataforma')
  if (error) return falha(error.message)
  return ok(
    ((data ?? []) as LinhaDaRpc[]).map((l) => ({
      id: l.conta_id,
      nome: l.nome,
      criadoEm: new Date(l.criado_em),
      convite:
        l.convite_id && l.convite_email && l.convite_expira_em
          ? {
              id: l.convite_id,
              email: l.convite_email,
              expiraEm: new Date(l.convite_expira_em),
              aceitoEm: l.convite_aceito_em ? new Date(l.convite_aceito_em) : null,
            }
          : null,
    })),
  )
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- plataforma`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/plataforma.ts src/lib/data/plataforma.test.ts
git commit -m "feat(data): camada de dados do dono da plataforma"
```

---

### Task 5: Página /admin, actions e item na barra lateral

**Files:**
- Create: `src/app/(app)/admin/page.tsx`
- Create: `src/app/(app)/admin/acoes.ts`
- Create: `src/app/(app)/admin/erros.ts`
- Create: `src/app/(app)/admin/nova-conta.tsx`
- Create: `src/app/(app)/admin/lista-contas.tsx`
- Create: `src/app/(app)/admin/acoes.test.ts`
- Create: `src/app/(app)/admin/nova-conta.test.tsx`
- Create: `src/app/(app)/admin/page.test.tsx`
- Modify: `src/app/(app)/layout.tsx` (resolver `dono` e passar à barra)
- Modify: `src/app/(app)/barra-lateral.tsx` (prop `dono`, item Admin)

**Interfaces:**
- Consumes: `souDonoDaPlataforma`, `contasDaPlataforma`, `criarContaCliente`, `reemitirConvite`, `ContaDaPlataforma` de `@/lib/data/plataforma`.
- Produces:
  - `criarContaClienteAction(formData: FormData): Promise<Resultado<string>>` (token)
  - `reemitirConviteAction(conviteId: string): Promise<Resultado<string>>` (token novo)
  - `BarraLateral` ganha prop `dono: boolean`.

- [ ] **Step 1: Testes que falham**

`src/app/(app)/admin/acoes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const criarContaCliente = vi.fn()
const reemitirConvite = vi.fn()
vi.mock('@/lib/data/plataforma', () => ({
  criarContaCliente: (...a: unknown[]) => criarContaCliente(...a),
  reemitirConvite: (...a: unknown[]) => reemitirConvite(...a),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { criarContaClienteAction, reemitirConviteAction } from './acoes'

beforeEach(() => {
  criarContaCliente.mockReset()
  reemitirConvite.mockReset()
})

function formulario(nome: string, email: string): FormData {
  const fd = new FormData()
  fd.set('nome', nome)
  fd.set('email', email)
  return fd
}

describe('criarContaClienteAction', () => {
  it('valida antes de chamar a RPC: nome vazio nao passa', async () => {
    const r = await criarContaClienteAction(formulario('  ', 'x@x.com'))
    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(criarContaCliente).not.toHaveBeenCalled()
  })

  it('valida o email', async () => {
    const r = await criarContaClienteAction(formulario('Cliente', 'nao-email'))
    expect(r).toEqual({ ok: false, erro: 'email_invalido' })
  })

  it('normaliza o email e devolve o token', async () => {
    criarContaCliente.mockResolvedValue({ ok: true, valor: 'tok123' })
    const r = await criarContaClienteAction(formulario('Cliente X', '  Ana@Ex.com '))
    expect(criarContaCliente).toHaveBeenCalledWith('Cliente X', 'ana@ex.com')
    expect(r).toEqual({ ok: true, valor: 'tok123' })
  })

  it('propaga o codigo de erro da camada de dados', async () => {
    criarContaCliente.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    const r = await criarContaClienteAction(formulario('Cliente X', 'a@a.com'))
    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
  })
})

describe('reemitirConviteAction', () => {
  it('recusa id vazio sem tocar a RPC', async () => {
    const r = await reemitirConviteAction('   ')
    expect(r).toEqual({ ok: false, erro: 'convite_invalido' })
    expect(reemitirConvite).not.toHaveBeenCalled()
  })

  it('devolve o token novo', async () => {
    reemitirConvite.mockResolvedValue({ ok: true, valor: 'tok456' })
    expect(await reemitirConviteAction('id-1')).toEqual({ ok: true, valor: 'tok456' })
  })
})
```

`src/app/(app)/admin/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

const souDonoDaPlataforma = vi.fn()
const contasDaPlataforma = vi.fn()
vi.mock('@/lib/data/plataforma', () => ({
  souDonoDaPlataforma: () => souDonoDaPlataforma(),
  contasDaPlataforma: () => contasDaPlataforma(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

import AdminPage from './page'

beforeEach(() => {
  souDonoDaPlataforma.mockReset()
  contasDaPlataforma.mockReset()
})

describe('AdminPage', () => {
  it('devolve 404 para quem nao e o dono: a pagina nem revela que existe', async () => {
    souDonoDaPlataforma.mockResolvedValue(false)
    await expect(AdminPage()).rejects.toThrow('NOT_FOUND')
    expect(contasDaPlataforma).not.toHaveBeenCalled()
  })

  it('renderiza para o dono', async () => {
    souDonoDaPlataforma.mockResolvedValue(true)
    contasDaPlataforma.mockResolvedValue({ ok: true, valor: [] })
    await expect(AdminPage()).resolves.toBeTruthy()
  })
})
```

`src/app/(app)/admin/nova-conta.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const criarContaClienteAction = vi.fn()
vi.mock('./acoes', () => ({
  criarContaClienteAction: (...a: unknown[]) => criarContaClienteAction(...a),
}))

import { NovaConta } from './nova-conta'

beforeEach(() => criarContaClienteAction.mockReset())

describe('NovaConta', () => {
  it('mostra o link /convite/<token> quando a conta e criada', async () => {
    criarContaClienteAction.mockResolvedValue({ ok: true, valor: 'tok123' })
    render(<NovaConta />)
    fireEvent.change(screen.getByPlaceholderText('nome da conta'), { target: { value: 'Cliente X' } })
    fireEvent.change(screen.getByPlaceholderText('email do cliente'), { target: { value: 'a@a.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => {
      expect(screen.getByText(/\/convite\/tok123$/)).toBeInTheDocument()
    })
  })

  it('traduz o erro em mensagem na tela', async () => {
    criarContaClienteAction.mockResolvedValue({ ok: false, erro: 'email_invalido' })
    render(<NovaConta />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => {
      expect(screen.getByText('Email inválido.')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test -- admin`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`src/app/(app)/admin/erros.ts`:

```ts
// Mesma convencao de (auth)/erros.ts: traduzir codigo aqui, nunca no componente.
const MENSAGENS_ERRO: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome da conta.',
  email_invalido: 'Email inválido.',
  entrada_invalida: 'Preencha o nome da conta e o email do cliente.',
  sem_permissao: 'Você não tem permissão para isso.',
  sem_sessao: 'Sessão expirada. Entre novamente.',
  convite_invalido: 'Convite não encontrado.',
  convite_ja_aceito: 'Este convite já foi usado — a conta já tem acesso.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
```

`src/app/(app)/admin/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarContaCliente, reemitirConvite } from '@/lib/data/plataforma'

const novaContaSchema = z.object({
  nome: z.string().trim().min(1, 'nome_obrigatorio'),
  email: z.string().trim().toLowerCase().pipe(z.email('email_invalido')),
})

export async function criarContaClienteAction(formData: FormData): Promise<Resultado<string>> {
  const parsed = novaContaSchema.safeParse({
    nome: formData.get('nome'),
    email: formData.get('email'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const r = await criarContaCliente(parsed.data.nome, parsed.data.email)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/admin')
  return ok(r.valor)
}

export async function reemitirConviteAction(conviteId: string): Promise<Resultado<string>> {
  const id = conviteId.trim()
  if (!id) return falha('convite_invalido')

  const r = await reemitirConvite(id)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/admin')
  return ok(r.valor)
}
```

`src/app/(app)/admin/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { souDonoDaPlataforma, contasDaPlataforma } from '@/lib/data/plataforma'
import { NovaConta } from './nova-conta'
import { ListaContas } from './lista-contas'

export default async function AdminPage() {
  // notFound e nao redirect: para quem nao e o dono esta pagina nao existe,
  // e um 404 nao confirma nada a quem sair fucando por rotas.
  if (!(await souDonoDaPlataforma())) notFound()

  const contas = await contasDaPlataforma()
  if (!contas.ok) throw new Error(contas.erro)

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Admin da plataforma</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Crie a conta do cliente e envie o link de convite. O cliente define a própria senha.
      </p>
      <NovaConta />
      <ListaContas contas={contas.valor} />
    </div>
  )
}
```

`src/app/(app)/admin/nova-conta.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { criarContaClienteAction } from './acoes'
import { mensagemDeErro } from './erros'
import { Botao } from '@/components/ui/botao'
import { Campo } from '@/components/ui/campo'

export function NovaConta() {
  const [erro, setErro] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await criarContaClienteAction(formData)
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
      setLink(null)
      return
    }
    setErro(null)
    // Mesmo formato do convite de equipe (config/usuarios.tsx): o link
    // canonico e' /convite/<token>, que sabe encaminhar para signup ou login.
    setLink(`${window.location.origin}/convite/${r.valor}`)
  }

  return (
    <section className="surface mt-6 rounded-2xl p-5">
      <h2 className="text-lg font-medium">Nova conta</h2>
      <form action={acao} className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Campo name="nome" placeholder="nome da conta" required />
        <Campo name="email" type="email" placeholder="email do cliente" required />
        <Botao type="submit" className="shrink-0">
          Criar conta
        </Botao>
      </form>
      {link && (
        <p className="mt-3 rounded bg-muted p-2 text-sm">
          Envie este link ao cliente: <code className="break-all">{link}</code>
        </p>
      )}
      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
    </section>
  )
}
```

(Se `Campo`/`Botao` não aceitarem alguma prop usada aqui, seguir a assinatura real deles — os formulários de `(auth)` são a referência.)

`src/app/(app)/admin/lista-contas.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { ContaDaPlataforma } from '@/lib/data/plataforma'
import { reemitirConviteAction } from './acoes'
import { mensagemDeErro } from './erros'

function estadoDoConvite(c: ContaDaPlataforma['convite']): string {
  if (!c) return '—'
  if (c.aceitoEm) return 'Aceito'
  if (c.expiraEm.getTime() < Date.now()) return 'Expirado'
  return 'Pendente'
}

export function ListaContas({ contas }: { contas: ContaDaPlataforma[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})

  return (
    <section className="surface mt-6 rounded-2xl p-5">
      <h2 className="text-lg font-medium">Contas</h2>
      {contas.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma conta ainda.</p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {contas.map((conta) => {
          const estado = estadoDoConvite(conta.convite)
          return (
            <li key={conta.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <span className="font-medium">{conta.nome}</span>
              <span className="text-muted-foreground">{conta.convite?.email ?? 'sem convite'}</span>
              <span className="text-muted-foreground">{estado}</span>
              {conta.convite && !conta.convite.aceitoEm && (
                <button
                  type="button"
                  className="ml-auto rounded-lg border border-border px-2 py-1 hover:bg-muted"
                  onClick={async () => {
                    const r = await reemitirConviteAction(conta.convite!.id)
                    if (!r.ok) {
                      setErro(mensagemDeErro(r.erro))
                      return
                    }
                    setErro(null)
                    setLinks((atual) => ({
                      ...atual,
                      [conta.id]: `${window.location.origin}/convite/${r.valor}`,
                    }))
                  }}
                >
                  Reemitir convite
                </button>
              )}
              {links[conta.id] && <code className="w-full break-all text-xs">{links[conta.id]}</code>}
            </li>
          )
        })}
      </ul>
      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
    </section>
  )
}
```

`src/app/(app)/barra-lateral.tsx` — mudanças pontuais:
- Import: acrescentar `Shield` ao import do lucide.
- Prop nova: `dono: boolean` (na assinatura do componente e no tipo das props).
- Onde os itens são renderizados a partir de `ITENS`, usar a lista com o item condicional:

```tsx
  const itens = dono
    ? [...ITENS, { href: '/admin', rotulo: 'Admin', icone: <Shield {...PROPS_ICONE} /> }]
    : ITENS
```

(e o `map` passa a iterar `itens` em vez de `ITENS`).

`src/app/(app)/layout.tsx` — mudanças pontuais:
- Import: `import { souDonoDaPlataforma } from '@/lib/data/plataforma'`.
- No `Promise.all` existente, acrescentar a terceira leitura paralela: `const [perfil, notificacao, dono] = await Promise.all([ …, …, souDonoDaPlataforma() ])`.
- Passar `dono={dono}` para `<BarraLateral …/>`.

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS. Se testes existentes da barra lateral/layout reclamarem da prop nova obrigatória, atualizar os usos com `dono={false}`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin" "src/app/(app)/layout.tsx" "src/app/(app)/barra-lateral.tsx"
git commit -m "feat(admin): pagina do dono da plataforma cria contas e convites"
```

---

### Task 6: Seed local do dono, helper e2e novo e validação completa

**Files:**
- Modify: `supabase/seed.sql` (usuário dono local + conta própria)
- Modify: `tests/e2e/apoio.ts` (criarConta via /admin + convite)
- Create: `tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: seed + RPCs da Task 1; página `/admin` da Task 5.
- Produces: `DONO = { email: 'dono@local.dev', senha: 'segredo123' }` exportado de `apoio.ts`; `criarConta(page)` mantém a assinatura `Promise<ContaCriada>` — todo o resto da suíte e2e continua chamando igual.

- [ ] **Step 1: Seed do dono local**

Acrescentar ao fim de `supabase/seed.sql`:

```sql
-- Usuario dono da plataforma para DESENVOLVIMENTO local. Sem ele, depois da
-- 0028 nenhuma conta nasce em ambiente local — nem nos testes E2E. A senha e'
-- publica de proposito, como o segredo de ingestao acima: vale so contra o
-- GoTrue de 127.0.0.1.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
  'authenticated', 'dono@local.dev', crypt('segredo123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"nome":"Dono Local"}', now(), now()
where not exists (select 1 from auth.users where email = 'dono@local.dev');

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email = 'dono@local.dev'
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

insert into public.platform_owners (user_id)
select id from auth.users where email = 'dono@local.dev'
on conflict (user_id) do nothing;

-- Conta propria do dono, espelhando a producao (o Pedro tem a conta dele).
-- Sem ela o layout do app cai em sem_conta e expulsa o dono para o login.
do $$
declare
  v_user uuid;
  v_conta uuid;
begin
  select id into v_user from auth.users where email = 'dono@local.dev';
  if v_user is not null
     and not exists (select 1 from public.memberships where user_id = v_user) then
    v_conta := public.montar_conta('Conta do Dono');
    insert into public.memberships (account_id, user_id, papel)
    values (v_conta, v_user, 'admin');
  end if;
end $$;
```

Run: `npx supabase db reset`
Expected: reset limpo; `select email from auth.users` via psql mostra `dono@local.dev`.

- [ ] **Step 2: Reescrever criarConta no apoio e2e**

Em `tests/e2e/apoio.ts`, acrescentar depois de `SENHA`:

```ts
/** Dono da plataforma semeado por supabase/seed.sql — so existe em local. */
export const DONO = { email: 'dono@local.dev', senha: 'segredo123' }

async function entrarComoDono(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByPlaceholder('email', { exact: true }).fill(DONO.email)
  await page.getByPlaceholder('senha', { exact: true }).fill(DONO.senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/funil/)
}

async function sairDaSessao(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login/)
}
```

E substituir o corpo de `criarConta` por:

```ts
export async function criarConta(page: Page): Promise<ContaCriada> {
  const id = carimbo()
  const empresa = `Empresa ${id}`
  const email = `e2e-${id}@exemplo.com`

  // O cadastro aberto morreu: a conta nasce no /admin do dono e o "cliente"
  // termina o proprio cadastro pelo link de convite — o caminho real do
  // produto, exercitado em todo teste que precisa de uma conta.
  await entrarComoDono(page)
  await page.goto('/admin')
  await page.getByPlaceholder('nome da conta', { exact: true }).fill(empresa)
  await page.getByPlaceholder('email do cliente', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Criar conta' }).click()
  const codigoDoLink = page.locator('code')
  await expect(codigoDoLink).toBeVisible()
  const link = (await codigoDoLink.textContent())?.trim()
  if (!link) throw new Error('link do convite nao apareceu')
  await sairDaSessao(page)

  await page.goto(link)
  await page.getByRole('link', { name: 'Criar conta' }).click()
  await page.getByPlaceholder('seu nome', { exact: true }).fill('Cliente E2E')
  await page.getByPlaceholder('email', { exact: true }).fill(email)
  await page.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page).toHaveURL(/\/funil/)
  await expect(page.getByRole('heading', { name: 'Novo lead', exact: true, level: 2 })).toBeVisible()
  return { email, empresa }
}
```

- [ ] **Step 3: Spec e2e do fechamento**

`tests/e2e/admin.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { criarConta } from './apoio'

test('/signup sem convite volta para o login: cadastro aberto nao existe mais', async ({ page }) => {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/login/)
})

test('/admin e 404 para um admin de conta comum', async ({ page }) => {
  await criarConta(page)
  await page.goto('/admin')
  await expect(page.getByText('404')).toBeVisible()
})
```

- [ ] **Step 4: Rodar tudo**

Run (com `npx supabase start` ativo):

```bash
npx supabase db reset
npm test
npm run test:integration
npm run test:e2e
```

Expected: PASS nas três suítes. Atenção aos pontos com maior chance de fricção:
- `convite.spec.ts` continua válido (os fluxos de convite de equipe não mudaram), mas agora passa pelo novo `criarConta`.
- Qualquer spec que assumisse o formulário antigo de `/signup` (campo "nome da empresa") falharia — o único caminho de cadastro agora é por convite.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql tests/e2e/apoio.ts tests/e2e/admin.spec.ts
git commit -m "test(e2e): contas de teste nascem pelo /admin; seed do dono local"
```

---

## Validação final (depois da Task 6)

- [ ] `npm run build` passa (checagem de tipos do Next).
- [ ] Fluxo manual em local: login como `dono@local.dev` → `/admin` → criar conta → abrir link em janela anônima → cadastro → `/funil`.
- [ ] Deploy: push para master (auto-deploy Git→Vercel). A migration 0028 precisa ser aplicada na produção via `mcp apply_migration`/CLI **antes** do deploy do app (o app novo não chama nada que ainda não exista, e o app velho chamando `criar_conta` já cairia na guarda — ordem segura: banco primeiro).
- [ ] Conferir advisors do Supabase (`get_advisors`) depois da migration.
