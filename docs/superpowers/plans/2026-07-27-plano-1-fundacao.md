# CRM — Plano 1: Fundação (schema, RLS, domínio, store, auth)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a base multi-tenant do CRM — schema com RLS verificada contra Postgres real, domínio puro testado, port de dados e fluxo completo de signup, convite e login.

**Architecture:** Next.js 15 (App Router) + Supabase. O isolamento entre contas vive em policies de RLS no Postgres, não no `WHERE` da aplicação. O domínio é código puro sem IO; todo acesso a dados passa por um port `CrmStore` com duas implementações (in-memory para teste de domínio, Supabase para produção). Nenhuma chave `service_role` existe no código.

**Tech Stack:** Next.js 15, TypeScript, Tailwind, Supabase (Auth + Postgres + RLS), Supabase CLI local, Vitest, `pg` (só nos testes de integração), Zod.

**Spec:** `docs/superpowers/specs/2026-07-27-crm-fundacao-funil-design.md`

## Global Constraints

- Node 20+. Next.js 15 com App Router. TypeScript `strict: true`.
- **Nunca** usar a chave `service_role` em código de aplicação. Só a `anon`, sempre com a sessão do usuário.
- Toda tabela de domínio tem `account_id` e RLS habilitada. Nenhuma tabela nova sem policy.
- Toda função SQL usa `set search_path = public`. `SECURITY DEFINER` só onde a spec exige (funções auxiliares de policy, `criar_conta`, `accept_invite`, trigger de perfil).
- Dinheiro em centavos (`integer`). Datas em `timestamptz` (UTC). IDs `uuid` com `gen_random_uuid()`.
- Nomes de tabela, coluna e função em português, como na spec. Código TypeScript em português para domínio, inglês para termos técnicos consagrados (`store`, `client`).
- `stage_history` e `lead_events` são insert-only: nunca criar policy de `update` ou `delete` nelas.
- Testes de RLS rodam contra Postgres real (`npx supabase start`). Mock não testa policy.
- Commits em português, imperativo, sem escopo inventado.

---

### Task 1: Setup do projeto e da infraestrutura de testes

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.local.example`
- Create: `vitest.config.ts`, `vitest.integration.config.ts`
- Create: `supabase/config.toml` (gerado pela CLI)
- Create: `src/lib/domain/resultado.ts`
- Test: `src/lib/domain/resultado.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `Resultado<T>` = `{ ok: true; valor: T } | { ok: false; erro: string }`, com helpers `ok<T>(valor: T): Resultado<T>` e `falha<T>(erro: string): Resultado<T>`. Todas as Server Actions e métodos de store dos planos 1 e 2 retornam esse tipo.

- [ ] **Step 1: Criar o projeto Next.js**

```bash
cd /c/Users/Pedro/projects/crm
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --eslint --no-turbopack
```

Responder "yes" se perguntar sobre sobrescrever arquivos existentes que não sejam `docs/` ou `.git/`.

- [ ] **Step 2: Instalar dependências**

```bash
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D vitest @vitejs/plugin-react pg @types/pg dotenv
```

- [ ] **Step 3: Inicializar o Supabase local**

```bash
npx supabase init
npx supabase start
```

Expected: imprime `API URL: http://127.0.0.1:54321`, `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `anon key: eyJ...`.

- [ ] **Step 4: Configurar Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

`fileParallelism: false` é obrigatório: os testes de integração compartilham um banco e limpam tabelas entre si.

- [ ] **Step 5: Adicionar scripts ao `package.json`**

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "db:reset": "supabase db reset"
  }
```

- [ ] **Step 6: Criar `.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=cole-a-anon-key-do-supabase-start-aqui
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Copiar para `.env.local` e preencher a `anon key` impressa no Step 3. `SUPABASE_DB_URL` só é lida pelos testes de integração.

- [ ] **Step 7: Escrever o teste do tipo Resultado**

Create `src/lib/domain/resultado.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ok, falha, type Resultado } from './resultado'

describe('Resultado', () => {
  it('ok carrega o valor', () => {
    const r: Resultado<number> = ok(42)
    expect(r).toEqual({ ok: true, valor: 42 })
  })

  it('falha carrega o codigo de erro', () => {
    const r: Resultado<number> = falha('motivo_perda_obrigatorio')
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('estreita o tipo apos checar ok', () => {
    const r: Resultado<string> = ok('lead')
    if (r.ok) {
      expect(r.valor.toUpperCase()).toBe('LEAD')
    } else {
      throw new Error('deveria ser ok')
    }
  })
})
```

- [ ] **Step 8: Rodar o teste e ver falhar**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./resultado"`.

- [ ] **Step 9: Implementar o tipo Resultado**

Create `src/lib/domain/resultado.ts`:

```ts
export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; erro: string }

export function ok<T>(valor: T): Resultado<T> {
  return { ok: true, valor }
}

export function falha<T>(erro: string): Resultado<T> {
  return { ok: false, erro }
}
```

- [ ] **Step 10: Rodar o teste e ver passar**

Run: `npm test`
Expected: PASS — 3 testes.

- [ ] **Step 11: Confirmar typecheck**

Run: `npm run typecheck`
Expected: sem saída, exit 0.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: setup do projeto Next.js, Supabase local e Vitest"
```

---

### Task 2: Migration 0001 — identidade e tenancy

**Files:**
- Create: `supabase/migrations/0001_identidade.sql`
- Create: `tests/integration/helpers/db.ts`
- Test: `tests/integration/0001_identidade.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - Tabelas `accounts`, `profiles`, `memberships`, `invites`; enum `papel` (`admin|gestor|vendedor`).
  - Funções SQL: `is_member_of(p_account_id uuid) → boolean`, `papel_na_conta(p_account_id uuid) → papel`, `compartilha_conta(p_user_id uuid) → boolean`, `accept_invite(p_token text) → uuid`.
  - Helpers de teste em `tests/integration/helpers/db.ts`: `comoServico<T>(fn)`, `comoUsuario<T>(userId, fn)`, `criarUsuario(email) → Promise<string>`, `limparBanco()`.

- [ ] **Step 1: Escrever os helpers de teste de banco**

Create `tests/integration/helpers/db.ts`:

```ts
import { Client } from 'pg'
import 'dotenv/config'

const CONN =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Executa como superusuario: ignora RLS. Use para preparar cenario. */
export async function comoServico<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Executa com RLS ativa na pele de um usuario autenticado.
 * auth.uid() le request.jwt.claims->>'sub', entao setamos esse claim.
 */
export async function comoUsuario<T>(
  userId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })],
    )
    const r = await fn(client)
    await client.query('commit')
    return r
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    await client.end()
  }
}

export async function criarUsuario(email: string): Promise<string> {
  return comoServico(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1)
       returning id`,
      [email],
    )
    return r.rows[0].id
  })
}

export async function limparBanco(): Promise<void> {
  await comoServico(async (c) => {
    await c.query(`
      truncate table
        public.invites, public.memberships, public.accounts, public.profiles
      restart identity cascade
    `)
    await c.query('delete from auth.users')
  })
}
```

`criarUsuario` insere direto em `auth.users`; o trigger da migration cria o `profiles` correspondente.

- [ ] **Step 2: Escrever os testes de RLS de identidade**

Create `tests/integration/0001_identidade.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

async function criarConta(nome: string, adminId: string): Promise<string> {
  return comoServico(async (c) => {
    const a = await c.query<{ id: string }>(
      'insert into public.accounts (nome) values ($1) returning id',
      [nome],
    )
    const accountId = a.rows[0].id
    await c.query(
      `insert into public.memberships (account_id, user_id, papel)
       values ($1, $2, 'admin')`,
      [accountId, adminId],
    )
    return accountId
  })
}

describe('0001 — identidade e tenancy', () => {
  beforeEach(limparBanco)

  it('cria profile automaticamente ao criar auth.users', async () => {
    const userId = await criarUsuario('ana@se7e.com')
    const rows = await comoServico(async (c) =>
      (await c.query('select id, email from public.profiles where id = $1', [userId])).rows,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('ana@se7e.com')
  })

  it('usuario da conta A nao le a conta B', async () => {
    const ana = await criarUsuario('ana@a.com')
    const bruno = await criarUsuario('bruno@b.com')
    await criarConta('Conta A', ana)
    await criarConta('Conta B', bruno)

    const vistas = await comoUsuario(ana, async (c) =>
      (await c.query('select nome from public.accounts')).rows,
    )
    expect(vistas).toHaveLength(1)
    expect(vistas[0].nome).toBe('Conta A')
  })

  it('membro le colegas da mesma conta e nao estranhos', async () => {
    const ana = await criarUsuario('ana@a.com')
    const carla = await criarUsuario('carla@a.com')
    const bruno = await criarUsuario('bruno@b.com')
    const contaA = await criarConta('Conta A', ana)
    await criarConta('Conta B', bruno)
    await comoServico((c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, papel)
         values ($1, $2, 'vendedor')`,
        [contaA, carla],
      ),
    )

    const emails = await comoUsuario(ana, async (c) =>
      (await c.query('select email from public.profiles order by email')).rows.map(
        (r) => r.email,
      ),
    )
    expect(emails).toEqual(['ana@a.com', 'carla@a.com'])
  })

  it('vendedor nao le nem cria convites', async () => {
    const ana = await criarUsuario('ana@a.com')
    const vendedor = await criarUsuario('v@a.com')
    const contaA = await criarConta('Conta A', ana)
    await comoServico((c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, papel)
         values ($1, $2, 'vendedor')`,
        [contaA, vendedor],
      ),
    )
    await comoServico((c) =>
      c.query(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values ($1, 'novo@a.com', 'vendedor', 'tok-1', now() + interval '7 days', $2)`,
        [contaA, ana],
      ),
    )

    const lidos = await comoUsuario(vendedor, async (c) =>
      (await c.query('select id from public.invites')).rows,
    )
    expect(lidos).toHaveLength(0)

    await expect(
      comoUsuario(vendedor, (c) =>
        c.query(
          `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
           values ($1, 'x@a.com', 'vendedor', 'tok-2', now() + interval '7 days', $2)`,
          [contaA, vendedor],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('accept_invite cria membership com o papel do convite', async () => {
    const ana = await criarUsuario('ana@a.com')
    const novo = await criarUsuario('novo@a.com')
    const contaA = await criarConta('Conta A', ana)
    await comoServico((c) =>
      c.query(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values ($1, 'novo@a.com', 'gestor', 'tok-ok', now() + interval '7 days', $2)`,
        [contaA, ana],
      ),
    )

    const retorno = await comoUsuario(novo, async (c) =>
      (await c.query('select public.accept_invite($1) as account_id', ['tok-ok'])).rows[0],
    )
    expect(retorno.account_id).toBe(contaA)

    const papel = await comoServico(async (c) =>
      (
        await c.query(
          'select papel from public.memberships where account_id = $1 and user_id = $2',
          [contaA, novo],
        )
      ).rows[0].papel,
    )
    expect(papel).toBe('gestor')
  })

  it('accept_invite rejeita token invalido, expirado e ja aceito', async () => {
    const ana = await criarUsuario('ana@a.com')
    const novo = await criarUsuario('novo@a.com')
    const contaA = await criarConta('Conta A', ana)
    await comoServico((c) =>
      c.query(
        `insert into public.invites (account_id, email, papel, token, expira_em, criado_por)
         values
           ($1, 'novo@a.com', 'vendedor', 'tok-exp', now() - interval '1 day', $2),
           ($1, 'novo@a.com', 'vendedor', 'tok-usado', now() + interval '7 days', $2)`,
        [contaA, ana],
      ),
    )
    await comoServico((c) =>
      c.query(`update public.invites set aceito_em = now() where token = 'tok-usado'`),
    )

    await expect(
      comoUsuario(novo, (c) => c.query('select public.accept_invite($1)', ['nao-existe'])),
    ).rejects.toThrow(/convite_invalido/)

    await expect(
      comoUsuario(novo, (c) => c.query('select public.accept_invite($1)', ['tok-exp'])),
    ).rejects.toThrow(/convite_expirado/)

    await expect(
      comoUsuario(novo, (c) => c.query('select public.accept_invite($1)', ['tok-usado'])),
    ).rejects.toThrow(/convite_ja_aceito/)
  })
})
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `npm run test:integration`
Expected: FAIL — `relation "public.profiles" does not exist`.

- [ ] **Step 4: Escrever a migration**

Create `supabase/migrations/0001_identidade.sql`:

```sql
create type public.papel as enum ('admin', 'gestor', 'vendedor');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  criado_em timestamptz not null default now()
);

create table public.memberships (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  papel public.papel not null,
  criado_em timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  email text not null,
  papel public.papel not null,
  token text not null unique,
  expira_em timestamptz not null,
  aceito_em timestamptz,
  criado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);

-- Perfil nasce junto com o usuario do Auth. Evita precisar de service_role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email, 'usuario'), '@', 1)),
    coalesce(new.email, '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- SECURITY DEFINER e obrigatorio: sem isso a policy consulta uma tabela
-- que tambem tem policy e a avaliacao entra em recursao.
create or replace function public.is_member_of(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.account_id = p_account_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.papel_na_conta(p_account_id uuid)
returns public.papel
language sql
stable
security definer
set search_path = public
as $$
  select m.papel from public.memberships m
  where m.account_id = p_account_id and m.user_id = auth.uid();
$$;

create or replace function public.compartilha_conta(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m1
    join public.memberships m2 on m1.account_id = m2.account_id
    where m1.user_id = auth.uid() and m2.user_id = p_user_id
  );
$$;

alter table public.accounts enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;

create policy accounts_select on public.accounts
  for select using (public.is_member_of(id));
create policy accounts_update on public.accounts
  for update using (public.papel_na_conta(id) = 'admin')
  with check (public.papel_na_conta(id) = 'admin');

create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.compartilha_conta(id));
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_select on public.memberships
  for select using (public.is_member_of(account_id));
create policy memberships_admin_write on public.memberships
  for all using (public.papel_na_conta(account_id) = 'admin')
  with check (public.papel_na_conta(account_id) = 'admin');

create policy invites_admin_all on public.invites
  for all using (public.papel_na_conta(account_id) = 'admin')
  with check (public.papel_na_conta(account_id) = 'admin');

-- O convidado ainda nao e membro de nada, entao nao consegue ler o proprio
-- convite por policy. O aceite roda como DEFINER e valida tudo por dentro.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  select * into v_invite from public.invites where token = p_token;

  if v_invite.id is null then
    raise exception 'convite_invalido';
  end if;
  if v_invite.aceito_em is not null then
    raise exception 'convite_ja_aceito';
  end if;
  if v_invite.expira_em < now() then
    raise exception 'convite_expirado';
  end if;

  insert into public.memberships (account_id, user_id, papel)
  values (v_invite.account_id, auth.uid(), v_invite.papel)
  on conflict (account_id, user_id) do nothing;

  update public.invites set aceito_em = now() where id = v_invite.id;

  return v_invite.account_id;
end;
$$;
```

- [ ] **Step 5: Aplicar a migration e rodar os testes**

```bash
npx supabase db reset
npm run test:integration
```

Expected: PASS — 6 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: migration de identidade e tenancy com RLS"
```

---

### Task 3: Migration 0002 — pipeline, etapas, motivos de perda e criação de conta

**Files:**
- Create: `supabase/migrations/0002_pipeline.sql`
- Test: `tests/integration/0002_pipeline.test.ts`
- Modify: `tests/integration/helpers/db.ts` (ampliar `limparBanco`)

**Interfaces:**
- Consumes: `is_member_of`, `papel_na_conta`, tabelas de `0001_identidade.sql`.
- Produces:
  - Tabelas `pipelines`, `stages`, `loss_reasons`; enum `stage_tipo` (`aberta|ganho|perdido`).
  - Função `criar_conta(p_nome text) → uuid` — cria conta, membership `admin` do chamador, pipeline padrão com 7 etapas e 5 motivos de perda.

- [ ] **Step 1: Ampliar `limparBanco` para as novas tabelas**

Modify `tests/integration/helpers/db.ts` — substituir o corpo de `limparBanco`:

```ts
export async function limparBanco(): Promise<void> {
  await comoServico(async (c) => {
    await c.query(`
      truncate table
        public.loss_reasons, public.stages, public.pipelines,
        public.invites, public.memberships, public.accounts, public.profiles
      restart identity cascade
    `)
    await c.query('delete from auth.users')
  })
}
```

- [ ] **Step 2: Escrever os testes**

Create `tests/integration/0002_pipeline.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'

describe('0002 — pipeline e criacao de conta', () => {
  beforeEach(limparBanco)

  it('criar_conta faz o seed completo e torna o chamador admin', async () => {
    const ana = await criarUsuario('ana@a.com')

    const accountId = await comoUsuario(ana, async (c) =>
      (await c.query<{ id: string }>('select public.criar_conta($1) as id', ['SE7E'])).rows[0].id,
    )

    const dados = await comoServico(async (c) => ({
      papel: (
        await c.query('select papel from public.memberships where account_id = $1', [accountId])
      ).rows[0].papel,
      etapas: (
        await c.query(
          `select s.nome, s.ordem, s.tipo from public.stages s
           join public.pipelines p on p.id = s.pipeline_id
           where p.account_id = $1 order by s.ordem`,
          [accountId],
        )
      ).rows,
      motivos: (
        await c.query('select count(*)::int as n from public.loss_reasons where account_id = $1', [
          accountId,
        ])
      ).rows[0].n,
      pipelinePadrao: (
        await c.query('select is_default from public.pipelines where account_id = $1', [accountId])
      ).rows[0].is_default,
    }))

    expect(dados.papel).toBe('admin')
    expect(dados.pipelinePadrao).toBe(true)
    expect(dados.motivos).toBe(5)
    expect(dados.etapas.map((e) => e.nome)).toEqual([
      'Novo lead',
      'Contato feito',
      'Qualificação',
      'Proposta',
      'Fechamento',
      'Ganho',
      'Perdido',
    ])
    expect(dados.etapas.map((e) => e.tipo)).toEqual([
      'aberta',
      'aberta',
      'aberta',
      'aberta',
      'aberta',
      'ganho',
      'perdido',
    ])
  })

  it('criar_conta sem sessao falha', async () => {
    // comoServico nao seta request.jwt.claims, entao auth.uid() e null.
    await expect(
      comoServico((c) => c.query('select public.criar_conta($1)', ['Sem dono'])),
    ).rejects.toThrow(/sem_sessao/)
  })

  it('etapas de uma conta nao sao visiveis por outra', async () => {
    const ana = await criarUsuario('ana@a.com')
    const bruno = await criarUsuario('bruno@b.com')
    await comoUsuario(ana, (c) => c.query('select public.criar_conta($1)', ['Conta A']))
    await comoUsuario(bruno, (c) => c.query('select public.criar_conta($1)', ['Conta B']))

    const doBruno = await comoUsuario(bruno, async (c) =>
      (await c.query('select nome from public.pipelines')).rows,
    )
    expect(doBruno).toHaveLength(1)
    expect(doBruno[0].nome).toBe('Funil de vendas')

    const etapasVistas = await comoUsuario(bruno, async (c) =>
      (await c.query('select count(*)::int as n from public.stages')).rows[0].n,
    )
    expect(etapasVistas).toBe(7)
  })

  it('vendedor nao altera etapas, admin altera', async () => {
    const ana = await criarUsuario('ana@a.com')
    const vendedor = await criarUsuario('v@a.com')
    const accountId = await comoUsuario(ana, async (c) =>
      (await c.query<{ id: string }>('select public.criar_conta($1) as id', ['SE7E'])).rows[0].id,
    )
    await comoServico((c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'vendedor')`,
        [accountId, vendedor],
      ),
    )

    const alteradasPeloVendedor = await comoUsuario(vendedor, async (c) =>
      (await c.query(`update public.stages set nome = 'Hackeada' where ordem = 1`)).rowCount,
    )
    expect(alteradasPeloVendedor).toBe(0)

    const alteradasPelaAna = await comoUsuario(ana, async (c) =>
      (await c.query(`update public.stages set nome = 'Novo contato' where ordem = 1`)).rowCount,
    )
    expect(alteradasPelaAna).toBe(1)
  })
})
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `npm run test:integration -- tests/integration/0002_pipeline.test.ts`
Expected: FAIL — `relation "public.pipelines" does not exist`.

- [ ] **Step 4: Escrever a migration**

Create `supabase/migrations/0002_pipeline.sql`:

```sql
create type public.stage_tipo as enum ('aberta', 'ganho', 'perdido');

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null,
  is_default boolean not null default false,
  criado_em timestamptz not null default now()
);

create unique index pipelines_um_padrao_por_conta
  on public.pipelines (account_id) where is_default;

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  nome text not null,
  ordem integer not null,
  tipo public.stage_tipo not null default 'aberta',
  sla_horas integer,
  criado_em timestamptz not null default now()
);

create unique index stages_ordem_por_pipeline on public.stages (pipeline_id, ordem);

create table public.loss_reasons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Etapa pertence a conta atraves do pipeline; a policy precisa desse salto.
create or replace function public.conta_do_pipeline(p_pipeline_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.account_id from public.pipelines p where p.id = p_pipeline_id;
$$;

alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.loss_reasons enable row level security;

create policy pipelines_select on public.pipelines
  for select using (public.is_member_of(account_id));
create policy pipelines_admin_write on public.pipelines
  for all using (public.papel_na_conta(account_id) = 'admin')
  with check (public.papel_na_conta(account_id) = 'admin');

create policy stages_select on public.stages
  for select using (public.is_member_of(public.conta_do_pipeline(pipeline_id)));
create policy stages_admin_write on public.stages
  for all using (public.papel_na_conta(public.conta_do_pipeline(pipeline_id)) = 'admin')
  with check (public.papel_na_conta(public.conta_do_pipeline(pipeline_id)) = 'admin');

create policy loss_reasons_select on public.loss_reasons
  for select using (public.is_member_of(account_id));
create policy loss_reasons_admin_write on public.loss_reasons
  for all using (public.papel_na_conta(account_id) = 'admin')
  with check (public.papel_na_conta(account_id) = 'admin');

-- Conta nova nasce usavel: pipeline, etapas e motivos padrao.
create or replace function public.criar_conta(p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_pipeline uuid;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  insert into public.accounts (nome) values (p_nome) returning id into v_account;

  insert into public.memberships (account_id, user_id, papel)
  values (v_account, auth.uid(), 'admin');

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
```

- [ ] **Step 5: Aplicar e rodar todos os testes de integração**

```bash
npx supabase db reset
npm run test:integration
```

Expected: PASS — 10 testes (6 da Task 2 + 4 desta).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: pipeline, etapas, motivos de perda e criar_conta com seed"
```

---

### Task 4: Migration 0003 — leads, etiquetas, histórico e eventos

**Files:**
- Create: `supabase/migrations/0003_leads.sql`
- Test: `tests/integration/0003_leads.test.ts`
- Modify: `tests/integration/helpers/db.ts` (ampliar `limparBanco`)

**Interfaces:**
- Consumes: tudo de `0001` e `0002`.
- Produces:
  - Tabelas `leads`, `tags`, `lead_tags`, `stage_history`, `lead_events`; enums `lead_status` (`aberto|ganho|perdido`) e `lead_origem` (`meta|google|manual|indicacao|organico`).
  - Funções `pode_ver_lead(p_account_id uuid, p_responsavel_id uuid) → boolean` e `pode_ver_lead_id(p_lead_id uuid) → boolean`.
  - Coluna `leads.entrou_na_etapa_em timestamptz` — base do contador "tempo parado na etapa" do Kanban.

- [ ] **Step 1: Ampliar `limparBanco`**

Modify `tests/integration/helpers/db.ts` — substituir o `truncate`:

```ts
export async function limparBanco(): Promise<void> {
  await comoServico(async (c) => {
    await c.query(`
      truncate table
        public.lead_events, public.stage_history, public.lead_tags, public.tags,
        public.leads, public.loss_reasons, public.stages, public.pipelines,
        public.invites, public.memberships, public.accounts, public.profiles
      restart identity cascade
    `)
    await c.query('delete from auth.users')
  })
}
```

- [ ] **Step 2: Escrever um helper de cenário reutilizável**

Create `tests/integration/helpers/cenario.ts`:

```ts
import { comoServico, comoUsuario, criarUsuario } from './db'

export type Cenario = {
  accountId: string
  pipelineId: string
  etapas: { id: string; nome: string; ordem: number; tipo: string }[]
  motivoId: string
  adminId: string
  gestorId: string
  vendedorAId: string
  vendedorBId: string
}

/** Uma conta com admin, gestor e dois vendedores, pipeline padrao ja semeado. */
export async function montarCenario(): Promise<Cenario> {
  const adminId = await criarUsuario('admin@a.com')
  const gestorId = await criarUsuario('gestor@a.com')
  const vendedorAId = await criarUsuario('va@a.com')
  const vendedorBId = await criarUsuario('vb@a.com')

  const accountId = await comoUsuario(adminId, async (c) =>
    (await c.query<{ id: string }>('select public.criar_conta($1) as id', ['SE7E'])).rows[0].id,
  )

  await comoServico((c) =>
    c.query(
      `insert into public.memberships (account_id, user_id, papel) values
        ($1, $2, 'gestor'), ($1, $3, 'vendedor'), ($1, $4, 'vendedor')`,
      [accountId, gestorId, vendedorAId, vendedorBId],
    ),
  )

  const { pipelineId, etapas, motivoId } = await comoServico(async (c) => {
    const p = await c.query<{ id: string }>(
      'select id from public.pipelines where account_id = $1',
      [accountId],
    )
    const s = await c.query(
      'select id, nome, ordem, tipo from public.stages where pipeline_id = $1 order by ordem',
      [p.rows[0].id],
    )
    const m = await c.query<{ id: string }>(
      `select id from public.loss_reasons where account_id = $1 and nome = 'Preço'`,
      [accountId],
    )
    return { pipelineId: p.rows[0].id, etapas: s.rows, motivoId: m.rows[0].id }
  })

  return { accountId, pipelineId, etapas, motivoId, adminId, gestorId, vendedorAId, vendedorBId }
}

export function etapa(c: Cenario, nome: string): string {
  const e = c.etapas.find((x) => x.nome === nome)
  if (!e) throw new Error(`etapa nao encontrada: ${nome}`)
  return e.id
}

export async function criarLead(
  c: Cenario,
  nome: string,
  responsavelId: string | null,
  etapaId: string,
): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [c.accountId, nome, c.pipelineId, etapaId, responsavelId],
    )
    return r.rows[0].id
  })
}
```

- [ ] **Step 3: Escrever os testes de RLS de leads**

Create `tests/integration/0003_leads.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

describe('0003 — leads, etiquetas, historico', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('vendedor le so os proprios leads', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    const vistos = await comoUsuario(c.vendedorAId, async (cli) =>
      (await cli.query('select nome from public.leads')).rows.map((r) => r.nome),
    )
    expect(vistos).toEqual(['Lead do A'])
  })

  it('gestor e admin leem a conta inteira', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    for (const usuario of [c.gestorId, c.adminId]) {
      const n = await comoUsuario(usuario, async (cli) =>
        (await cli.query('select count(*)::int as n from public.leads')).rows[0].n,
      )
      expect(n).toBe(2)
    }
  })

  it('usuario de outra conta nao le lead nenhum', async () => {
    const novo = etapa(c, 'Novo lead')
    await criarLead(c, 'Lead do A', c.vendedorAId, novo)
    const forasteiro = await criarUsuario('fora@b.com')
    await comoUsuario(forasteiro, (cli) => cli.query('select public.criar_conta($1)', ['Outra']))

    const n = await comoUsuario(forasteiro, async (cli) =>
      (await cli.query('select count(*)::int as n from public.leads')).rows[0].n,
    )
    expect(n).toBe(0)
  })

  it('etiqueta e unica por conta ignorando maiusculas', async () => {
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(`insert into public.tags (account_id, nome, criado_por) values ($1, 'Preço alto', $2)`, [
        c.accountId,
        c.vendedorAId,
      ]),
    )

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'preço ALTO', $2)`,
          [c.accountId, c.vendedorAId],
        ),
      ),
    ).rejects.toThrow(/duplicate key|tags_account_nome_idx/)
  })

  it('lead_tags guarda a etapa do momento e nao acompanha o lead depois', async () => {
    const qualificacao = etapa(c, 'Qualificação')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, qualificacao)

    const tagId = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.tags (account_id, nome, criado_por) values ($1, 'Preço alto', $2) returning id`,
          [c.accountId, c.vendedorAId],
        )
      ).rows[0].id,
    )

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query(
        `insert into public.lead_tags (lead_id, tag_id, stage_id_no_momento, criado_por)
         values ($1, $2, $3, $4)`,
        [leadId, tagId, qualificacao, c.vendedorAId],
      ),
    )

    await comoServico((cli) =>
      cli.query('update public.leads set stage_id = $1 where id = $2', [proposta, leadId]),
    )

    const snapshot = await comoServico(async (cli) =>
      (
        await cli.query('select stage_id_no_momento from public.lead_tags where lead_id = $1', [
          leadId,
        ])
      ).rows[0].stage_id_no_momento,
    )
    expect(snapshot).toBe(qualificacao)
  })

  it('stage_history e lead_events nao aceitam update nem delete', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)
    await comoServico((cli) =>
      cli.query(
        `insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
         values ($1, null, $2, $3)`,
        [leadId, novo, c.vendedorAId],
      ),
    )
    await comoServico((cli) =>
      cli.query(
        `insert into public.lead_events (lead_id, tipo, payload, ator_id)
         values ($1, 'nota', '{"texto":"oi"}'::jsonb, $2)`,
        [leadId, c.vendedorAId],
      ),
    )

    const historicoAlterado = await comoUsuario(c.adminId, async (cli) =>
      (await cli.query('update public.stage_history set movido_por = null')).rowCount,
    )
    expect(historicoAlterado).toBe(0)

    const eventosApagados = await comoUsuario(c.adminId, async (cli) =>
      (await cli.query('delete from public.lead_events')).rowCount,
    )
    expect(eventosApagados).toBe(0)
  })

  it('vendedor nao le eventos de lead alheio', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadDoB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)
    await comoServico((cli) =>
      cli.query(
        `insert into public.lead_events (lead_id, tipo, payload, ator_id)
         values ($1, 'nota', '{"texto":"segredo"}'::jsonb, $2)`,
        [leadDoB, c.vendedorBId],
      ),
    )

    const n = await comoUsuario(c.vendedorAId, async (cli) =>
      (await cli.query('select count(*)::int as n from public.lead_events')).rows[0].n,
    )
    expect(n).toBe(0)
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm run test:integration -- tests/integration/0003_leads.test.ts`
Expected: FAIL — `relation "public.leads" does not exist`.

- [ ] **Step 5: Escrever a migration**

Create `supabase/migrations/0003_leads.sql`:

```sql
create type public.lead_status as enum ('aberto', 'ganho', 'perdido');
create type public.lead_origem as enum ('meta', 'google', 'manual', 'indicacao', 'organico');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null,
  telefone text,
  telefone_e164 text,
  email text,
  email_norm text,
  empresa text,
  origem public.lead_origem not null default 'manual',
  campanha_origem text,
  formulario_origem text,
  pipeline_id uuid not null references public.pipelines(id),
  stage_id uuid not null references public.stages(id),
  responsavel_id uuid references public.profiles(id),
  status public.lead_status not null default 'aberto',
  valor_cents integer,
  loss_reason_id uuid references public.loss_reasons(id),
  entrou_na_etapa_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index leads_account_stage_idx on public.leads (account_id, stage_id);
-- Indice comum, NAO unico: com o card sendo o Lead, a mesma pessoa vira
-- lead novo em recompra. Dedup e aviso na UI, nunca bloqueio no banco.
create index leads_telefone_idx on public.leads (account_id, telefone_e164);
create index leads_email_idx on public.leads (account_id, email_norm);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null,
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);

create unique index tags_account_nome_idx on public.tags (account_id, lower(nome));

create table public.lead_tags (
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  stage_id_no_momento uuid not null references public.stages(id),
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  stage_origem uuid references public.stages(id),
  stage_destino uuid not null references public.stages(id),
  movido_por uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index stage_history_lead_idx on public.stage_history (lead_id, criado_em);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo text not null,
  payload jsonb not null default '{}'::jsonb,
  ator_id uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);

create index lead_events_lead_idx on public.lead_events (lead_id, criado_em desc);

-- Vendedor so enxerga o que e dele; gestor e admin enxergam a conta.
create or replace function public.pode_ver_lead(p_account_id uuid, p_responsavel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_member_of(p_account_id) then false
    when public.papel_na_conta(p_account_id) = 'vendedor' then p_responsavel_id = auth.uid()
    else true
  end;
$$;

create or replace function public.pode_ver_lead_id(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id and public.pode_ver_lead(l.account_id, l.responsavel_id)
  );
$$;

alter table public.leads enable row level security;
alter table public.tags enable row level security;
alter table public.lead_tags enable row level security;
alter table public.stage_history enable row level security;
alter table public.lead_events enable row level security;

create policy leads_select on public.leads
  for select using (public.pode_ver_lead(account_id, responsavel_id));
create policy leads_insert on public.leads
  for insert with check (public.is_member_of(account_id));
create policy leads_update on public.leads
  for update using (public.pode_ver_lead(account_id, responsavel_id))
  with check (public.is_member_of(account_id));
-- Sem policy de delete: lead nao se apaga, se perde com motivo.

create policy tags_select on public.tags
  for select using (public.is_member_of(account_id));
create policy tags_insert on public.tags
  for insert with check (public.is_member_of(account_id));

create policy lead_tags_select on public.lead_tags
  for select using (public.pode_ver_lead_id(lead_id));
create policy lead_tags_insert on public.lead_tags
  for insert with check (public.pode_ver_lead_id(lead_id));
create policy lead_tags_delete on public.lead_tags
  for delete using (public.pode_ver_lead_id(lead_id));

-- Insert-only: nenhuma policy de update ou delete nas duas tabelas abaixo.
create policy stage_history_select on public.stage_history
  for select using (public.pode_ver_lead_id(lead_id));
create policy stage_history_insert on public.stage_history
  for insert with check (public.pode_ver_lead_id(lead_id));

create policy lead_events_select on public.lead_events
  for select using (public.pode_ver_lead_id(lead_id));
create policy lead_events_insert on public.lead_events
  for insert with check (public.pode_ver_lead_id(lead_id));
```

- [ ] **Step 6: Aplicar e rodar todos os testes**

```bash
npx supabase db reset
npm run test:integration
```

Expected: PASS — 17 testes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: leads, etiquetas, historico e eventos com RLS por responsavel"
```

---

### Task 5: Migration 0004 — `move_lead_stage`

**Files:**
- Create: `supabase/migrations/0004_move_lead_stage.sql`
- Test: `tests/integration/0004_move_lead_stage.test.ts`

**Interfaces:**
- Consumes: tudo de `0003`.
- Produces: `move_lead_stage(p_lead_id uuid, p_stage_destino uuid, p_loss_reason_id uuid default null) → void`. É o **único** caminho para mudar a etapa de um lead. `SECURITY INVOKER` de propósito: a RLS continua valendo, então vendedor não move lead alheio.

- [ ] **Step 1: Escrever os testes**

Create `tests/integration/0004_move_lead_stage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'

describe('0004 — move_lead_stage', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('move o lead e escreve historico e evento na mesma transacao', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, proposta]),
    )

    const estado = await comoServico(async (cli) => ({
      lead: (
        await cli.query('select stage_id, status from public.leads where id = $1', [leadId])
      ).rows[0],
      historico: (
        await cli.query(
          'select stage_origem, stage_destino from public.stage_history where lead_id = $1',
          [leadId],
        )
      ).rows,
      eventos: (
        await cli.query('select tipo, payload from public.lead_events where lead_id = $1', [leadId])
      ).rows,
    }))

    expect(estado.lead.stage_id).toBe(proposta)
    expect(estado.lead.status).toBe('aberto')
    expect(estado.historico).toEqual([{ stage_origem: novo, stage_destino: proposta }])
    expect(estado.eventos).toHaveLength(1)
    expect(estado.eventos[0].tipo).toBe('etapa_alterada')
    expect(estado.eventos[0].payload.para).toBe(proposta)
  })

  it('deriva status de stages.tipo em ganho e em perdido', async () => {
    const novo = etapa(c, 'Novo lead')
    const ganho = etapa(c, 'Ganho')
    const perdido = etapa(c, 'Perdido')

    const leadGanho = await criarLead(c, 'Ganho', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadGanho, ganho]),
    )

    const leadPerdido = await criarLead(c, 'Perdido', c.vendedorAId, novo)
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2, $3)', [leadPerdido, perdido, c.motivoId]),
    )

    const linhas = await comoServico(async (cli) =>
      (
        await cli.query(
          'select nome, status, loss_reason_id from public.leads order by nome',
          [],
        )
      ).rows,
    )
    expect(linhas).toEqual([
      { nome: 'Ganho', status: 'ganho', loss_reason_id: null },
      { nome: 'Perdido', status: 'perdido', loss_reason_id: c.motivoId },
    ])
  })

  it('rejeita perda sem motivo e nao deixa rastro', async () => {
    const novo = etapa(c, 'Novo lead')
    const perdido = etapa(c, 'Perdido')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadId, perdido]),
      ),
    ).rejects.toThrow(/motivo_perda_obrigatorio/)

    const estado = await comoServico(async (cli) => ({
      stage: (await cli.query('select stage_id from public.leads where id = $1', [leadId])).rows[0]
        .stage_id,
      historico: (
        await cli.query('select count(*)::int as n from public.stage_history where lead_id = $1', [
          leadId,
        ])
      ).rows[0].n,
      eventos: (
        await cli.query('select count(*)::int as n from public.lead_events where lead_id = $1', [
          leadId,
        ])
      ).rows[0].n,
    }))
    expect(estado.stage).toBe(novo)
    expect(estado.historico).toBe(0)
    expect(estado.eventos).toBe(0)
  })

  it('rejeita motivo de perda de outra conta', async () => {
    const novo = etapa(c, 'Novo lead')
    const perdido = etapa(c, 'Perdido')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    const forasteiro = await criarUsuario('fora@b.com')
    const outraConta = await comoUsuario(forasteiro, async (cli) =>
      (await cli.query<{ id: string }>('select public.criar_conta($1) as id', ['Outra'])).rows[0].id,
    )
    const motivoAlheio = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          'select id from public.loss_reasons where account_id = $1 limit 1',
          [outraConta],
        )
      ).rows[0].id,
    )

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2, $3)', [leadId, perdido, motivoAlheio]),
      ),
    ).rejects.toThrow(/motivo_perda_invalido/)
  })

  it('rejeita etapa de outra conta', async () => {
    const novo = etapa(c, 'Novo lead')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    const forasteiro = await criarUsuario('fora@b.com')
    const outraConta = await comoUsuario(forasteiro, async (cli) =>
      (await cli.query<{ id: string }>('select public.criar_conta($1) as id', ['Outra'])).rows[0].id,
    )
    const etapaAlheia = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `select s.id from public.stages s
           join public.pipelines p on p.id = s.pipeline_id
           where p.account_id = $1 limit 1`,
          [outraConta],
        )
      ).rows[0].id,
    )

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadId, etapaAlheia]),
      ),
    ).rejects.toThrow(/etapa_invalida/)
  })

  it('vendedor nao move lead de outro vendedor', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadDoB = await criarLead(c, 'Lead do B', c.vendedorBId, novo)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.move_lead_stage($1, $2)', [leadDoB, proposta]),
      ),
    ).rejects.toThrow(/lead_nao_encontrado/)
  })

  it('atualiza entrou_na_etapa_em a cada movimento', async () => {
    const novo = etapa(c, 'Novo lead')
    const proposta = etapa(c, 'Proposta')
    const leadId = await criarLead(c, 'Lead', c.vendedorAId, novo)

    await comoServico((cli) =>
      cli.query(
        `update public.leads set entrou_na_etapa_em = now() - interval '5 days' where id = $1`,
        [leadId],
      ),
    )
    await comoUsuario(c.vendedorAId, (cli) =>
      cli.query('select public.move_lead_stage($1, $2)', [leadId, proposta]),
    )

    const horas = await comoServico(async (cli) =>
      (
        await cli.query(
          `select extract(epoch from (now() - entrou_na_etapa_em)) / 3600 as h
           from public.leads where id = $1`,
          [leadId],
        )
      ).rows[0].h,
    )
    expect(Number(horas)).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integration -- tests/integration/0004_move_lead_stage.test.ts`
Expected: FAIL — `function public.move_lead_stage(uuid, uuid) does not exist`.

- [ ] **Step 3: Escrever a migration**

Create `supabase/migrations/0004_move_lead_stage.sql`:

```sql
-- Unico caminho para trocar a etapa de um lead.
-- SECURITY INVOKER de proposito: a RLS continua valendo, entao um vendedor
-- nao consegue mover lead que nao e dele.
create or replace function public.move_lead_stage(
  p_lead_id uuid,
  p_stage_destino uuid,
  p_loss_reason_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.leads;
  v_stage public.stages;
  v_origem uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead_nao_encontrado';
  end if;

  select s.* into v_stage
  from public.stages s
  join public.pipelines p on p.id = s.pipeline_id
  where s.id = p_stage_destino and p.account_id = v_lead.account_id;

  if v_stage.id is null then
    raise exception 'etapa_invalida';
  end if;

  if v_stage.tipo = 'perdido' then
    if p_loss_reason_id is null then
      raise exception 'motivo_perda_obrigatorio';
    end if;
    if not exists (
      select 1 from public.loss_reasons lr
      where lr.id = p_loss_reason_id
        and lr.account_id = v_lead.account_id
        and lr.ativo
    ) then
      raise exception 'motivo_perda_invalido';
    end if;
  end if;

  v_origem := v_lead.stage_id;

  update public.leads set
    stage_id = p_stage_destino,
    -- status nunca e escrito pela aplicacao: e derivado do tipo da etapa.
    status = (case v_stage.tipo
                when 'ganho' then 'ganho'
                when 'perdido' then 'perdido'
                else 'aberto'
              end)::public.lead_status,
    loss_reason_id = case when v_stage.tipo = 'perdido' then p_loss_reason_id else null end,
    entrou_na_etapa_em = now(),
    atualizado_em = now()
  where id = p_lead_id;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (p_lead_id, v_origem, p_stage_destino, auth.uid());

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (
    p_lead_id,
    'etapa_alterada',
    jsonb_build_object('de', v_origem, 'para', p_stage_destino, 'loss_reason_id', p_loss_reason_id),
    auth.uid()
  );
end;
$$;
```

- [ ] **Step 4: Aplicar e rodar todos os testes**

```bash
npx supabase db reset
npm run test:integration
```

Expected: PASS — 24 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: move_lead_stage com motivo de perda obrigatorio no banco"
```

---

### Task 6: Domínio puro — tipos, normalizações e validações

**Files:**
- Create: `src/lib/domain/tipos.ts`
- Create: `src/lib/domain/normalizacao.ts`
- Create: `src/lib/domain/lead.ts`
- Test: `src/lib/domain/normalizacao.test.ts`, `src/lib/domain/lead.test.ts`

**Interfaces:**
- Consumes: `Resultado`, `ok`, `falha` de `src/lib/domain/resultado.ts`.
- Produces:
  - `tipos.ts`: `Papel`, `StageTipo`, `LeadStatus`, `LeadOrigem`, `Conta`, `Perfil`, `Membro`, `Pipeline`, `Etapa`, `MotivoPerda`, `Lead`, `Etiqueta`, `EventoLead`.
  - `normalizacao.ts`: `normalizarTelefone(bruto: string | null): string | null`, `normalizarEmail(bruto: string | null): string | null`, `normalizarNomeEtiqueta(bruto: string): string`.
  - `lead.ts`: `leadSchema` (Zod), `NovoLead`, `horasNaEtapa(entrouEm: Date, agora: Date): number`, `rotuloTempoNaEtapa(horas: number): string`.

- [ ] **Step 1: Escrever os testes de normalização**

Create `src/lib/domain/normalizacao.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizarTelefone, normalizarEmail, normalizarNomeEtiqueta } from './normalizacao'

describe('normalizarTelefone', () => {
  it('converte celular brasileiro com mascara para E.164', () => {
    expect(normalizarTelefone('(83) 99999-1234')).toBe('+5583999991234')
  })

  it('converte fixo de 10 digitos', () => {
    expect(normalizarTelefone('83 3222-1234')).toBe('+558332221234')
  })

  it('mantem numero que ja veio com codigo do pais', () => {
    expect(normalizarTelefone('5583999991234')).toBe('+5583999991234')
    expect(normalizarTelefone('+55 83 99999-1234')).toBe('+5583999991234')
  })

  it('preserva internacional nao brasileiro', () => {
    expect(normalizarTelefone('+1 415 555 0100')).toBe('+14155550100')
  })

  it('devolve null para vazio, nulo ou lixo', () => {
    expect(normalizarTelefone('')).toBeNull()
    expect(normalizarTelefone(null)).toBeNull()
    expect(normalizarTelefone('   ')).toBeNull()
    expect(normalizarTelefone('123')).toBeNull()
  })
})

describe('normalizarEmail', () => {
  it('baixa a caixa e apara espacos', () => {
    expect(normalizarEmail('  Ana.Silva@SE7E.com ')).toBe('ana.silva@se7e.com')
  })

  it('devolve null para vazio ou invalido', () => {
    expect(normalizarEmail(null)).toBeNull()
    expect(normalizarEmail('')).toBeNull()
    expect(normalizarEmail('sem-arroba')).toBeNull()
  })
})

describe('normalizarNomeEtiqueta', () => {
  it('apara espacos e colapsa espacos internos', () => {
    expect(normalizarNomeEtiqueta('  Preço   alto  ')).toBe('Preço alto')
  })

  it('preserva a caixa digitada pelo usuario', () => {
    expect(normalizarNomeEtiqueta('PREÇO ALTO')).toBe('PREÇO ALTO')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./normalizacao"`.

- [ ] **Step 3: Implementar as normalizações**

Create `src/lib/domain/normalizacao.ts`:

```ts
/**
 * Reduz o telefone a E.164. Numero brasileiro sem codigo do pais recebe +55.
 * Retorna null quando nao da para afirmar que e um telefone.
 */
export function normalizarTelefone(bruto: string | null): string | null {
  if (!bruto) return null
  const jaInternacional = bruto.trim().startsWith('+')
  const digitos = bruto.replace(/\D/g, '')
  if (digitos.length === 0) return null

  if (jaInternacional) {
    return digitos.length >= 8 ? `+${digitos}` : null
  }
  // 10 = fixo com DDD, 11 = celular com DDD
  if (digitos.length === 10 || digitos.length === 11) {
    return `+55${digitos}`
  }
  // 12 ou 13 digitos comecando em 55 ja trazem o codigo do pais
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    return `+${digitos}`
  }
  return null
}

export function normalizarEmail(bruto: string | null): string | null {
  if (!bruto) return null
  const limpo = bruto.trim().toLowerCase()
  if (limpo.length === 0) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) return null
  return limpo
}

/** Apara e colapsa espacos, mas preserva a caixa que o usuario digitou. */
export function normalizarNomeEtiqueta(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 12 testes.

- [ ] **Step 5: Escrever os tipos de domínio**

Create `src/lib/domain/tipos.ts`:

```ts
export type Papel = 'admin' | 'gestor' | 'vendedor'
export type StageTipo = 'aberta' | 'ganho' | 'perdido'
export type LeadStatus = 'aberto' | 'ganho' | 'perdido'
export type LeadOrigem = 'meta' | 'google' | 'manual' | 'indicacao' | 'organico'

export type Conta = { id: string; nome: string }

export type Perfil = { id: string; nome: string; email: string }

export type Membro = Perfil & { papel: Papel }

export type Pipeline = { id: string; nome: string; isDefault: boolean }

export type Etapa = {
  id: string
  pipelineId: string
  nome: string
  ordem: number
  tipo: StageTipo
  slaHoras: number | null
}

export type MotivoPerda = { id: string; nome: string; ativo: boolean }

export type Etiqueta = { id: string; nome: string }

export type Lead = {
  id: string
  accountId: string
  nome: string
  telefone: string | null
  telefoneE164: string | null
  email: string | null
  emailNorm: string | null
  empresa: string | null
  origem: LeadOrigem
  pipelineId: string
  stageId: string
  responsavelId: string | null
  status: LeadStatus
  valorCents: number | null
  lossReasonId: string | null
  entrouNaEtapaEm: Date
  criadoEm: Date
  atualizadoEm: Date
  etiquetas: Etiqueta[]
}

export type EventoLead = {
  id: string
  leadId: string
  tipo: string
  payload: Record<string, unknown>
  atorId: string | null
  criadoEm: Date
}
```

- [ ] **Step 6: Escrever os testes de lead**

Create `src/lib/domain/lead.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { leadSchema, horasNaEtapa, rotuloTempoNaEtapa } from './lead'

describe('leadSchema', () => {
  it('aceita lead so com nome', () => {
    const r = leadSchema.safeParse({ nome: 'Ana' })
    expect(r.success).toBe(true)
  })

  it('rejeita nome vazio', () => {
    const r = leadSchema.safeParse({ nome: '   ' })
    expect(r.success).toBe(false)
  })

  it('normaliza telefone e email ao validar', () => {
    const r = leadSchema.parse({
      nome: 'Ana',
      telefone: '(83) 99999-1234',
      email: ' Ana@SE7E.com ',
    })
    expect(r.telefoneE164).toBe('+5583999991234')
    expect(r.emailNorm).toBe('ana@se7e.com')
  })

  it('rejeita valor negativo', () => {
    const r = leadSchema.safeParse({ nome: 'Ana', valorCents: -1 })
    expect(r.success).toBe(false)
  })
})

describe('horasNaEtapa', () => {
  it('conta as horas cheias desde a entrada', () => {
    const entrou = new Date('2026-07-27T10:00:00Z')
    const agora = new Date('2026-07-27T15:30:00Z')
    expect(horasNaEtapa(entrou, agora)).toBe(5)
  })

  it('nunca devolve negativo', () => {
    const entrou = new Date('2026-07-27T15:00:00Z')
    const agora = new Date('2026-07-27T10:00:00Z')
    expect(horasNaEtapa(entrou, agora)).toBe(0)
  })
})

describe('rotuloTempoNaEtapa', () => {
  it('mostra horas abaixo de um dia', () => {
    expect(rotuloTempoNaEtapa(0)).toBe('agora')
    expect(rotuloTempoNaEtapa(1)).toBe('1h')
    expect(rotuloTempoNaEtapa(23)).toBe('23h')
  })

  it('mostra dias a partir de 24h', () => {
    expect(rotuloTempoNaEtapa(24)).toBe('1d')
    expect(rotuloTempoNaEtapa(75)).toBe('3d')
  })
})
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./lead"`.

- [ ] **Step 8: Implementar `lead.ts`**

Create `src/lib/domain/lead.ts`:

```ts
import { z } from 'zod'
import { normalizarEmail, normalizarTelefone } from './normalizacao'

export const leadSchema = z
  .object({
    nome: z.string().trim().min(1, 'nome_obrigatorio'),
    telefone: z.string().trim().nullish(),
    email: z.string().trim().nullish(),
    empresa: z.string().trim().nullish(),
    valorCents: z.number().int().min(0).nullish(),
    responsavelId: z.string().uuid().nullish(),
  })
  .transform((dados) => ({
    ...dados,
    telefone: dados.telefone || null,
    email: dados.email || null,
    empresa: dados.empresa || null,
    valorCents: dados.valorCents ?? null,
    responsavelId: dados.responsavelId ?? null,
    telefoneE164: normalizarTelefone(dados.telefone ?? null),
    emailNorm: normalizarEmail(dados.email ?? null),
  }))

export type NovoLead = z.output<typeof leadSchema>

export function horasNaEtapa(entrouEm: Date, agora: Date): number {
  const ms = agora.getTime() - entrouEm.getTime()
  if (ms <= 0) return 0
  return Math.floor(ms / 3_600_000)
}

export function rotuloTempoNaEtapa(horas: number): string {
  if (horas < 1) return 'agora'
  if (horas < 24) return `${horas}h`
  return `${Math.floor(horas / 24)}d`
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 20 testes.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: dominio puro com tipos, normalizacoes e validacao de lead"
```

---

### Task 7: Port `CrmStore` e implementação in-memory

**Files:**
- Create: `src/lib/data/store.ts`
- Create: `src/lib/data/memory.ts`
- Test: `src/lib/data/memory.test.ts`

**Interfaces:**
- Consumes: tipos de `src/lib/domain/tipos.ts`, `NovoLead` de `lead.ts`, `Resultado` de `resultado.ts`.
- Produces: interface `CrmStore` com os métodos abaixo, e `InMemoryCrmStore` implementando-a. A Task 8 implementa a mesma interface contra Supabase; a Task 9 e o Plano 2 consomem só a interface.

```ts
interface CrmStore {
  contaAtiva(): Promise<Resultado<Conta | null>>
  membros(): Promise<Resultado<Membro[]>>
  pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
  motivosPerda(): Promise<Resultado<MotivoPerda[]>>
  listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>>
  buscarLead(leadId: string): Promise<Resultado<Lead | null>>
  criarLead(dados: NovoLead & { pipelineId: string; stageId: string }): Promise<Resultado<string>>
  possiveisDuplicados(telefoneE164: string | null, emailNorm: string | null): Promise<Resultado<Lead[]>>
  moverEtapa(leadId: string, stageDestino: string, lossReasonId?: string | null): Promise<Resultado<void>>
  etiquetasDaConta(): Promise<Resultado<Etiqueta[]>>
  aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>>
  eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>>
  registrarNota(leadId: string, texto: string): Promise<Resultado<void>>
}
```

- [ ] **Step 1: Escrever a interface e os tipos de filtro**

Create `src/lib/data/store.ts`:

```ts
import type { Resultado } from '@/lib/domain/resultado'
import type { NovoLead } from '@/lib/domain/lead'
import type {
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Pipeline,
} from '@/lib/domain/tipos'

export type FiltroLeads = {
  responsavelId?: string | null
  origem?: Lead['origem'] | null
  desde?: Date | null
  busca?: string | null
}

export interface CrmStore {
  contaAtiva(): Promise<Resultado<Conta | null>>
  membros(): Promise<Resultado<Membro[]>>
  pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
  motivosPerda(): Promise<Resultado<MotivoPerda[]>>

  listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>>
  buscarLead(leadId: string): Promise<Resultado<Lead | null>>
  criarLead(
    dados: NovoLead & { pipelineId: string; stageId: string },
  ): Promise<Resultado<string>>
  possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>>
  moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>>

  etiquetasDaConta(): Promise<Resultado<Etiqueta[]>>
  aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>>

  eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>>
  registrarNota(leadId: string, texto: string): Promise<Resultado<void>>
}
```

- [ ] **Step 2: Escrever os testes do store in-memory**

Create `src/lib/data/memory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryCrmStore } from './memory'
import { leadSchema } from '@/lib/domain/lead'

function novoLead(nome: string, extras: Record<string, unknown> = {}) {
  return leadSchema.parse({ nome, ...extras })
}

describe('InMemoryCrmStore', () => {
  let store: InMemoryCrmStore

  beforeEach(() => {
    store = new InMemoryCrmStore()
    store.semear('SE7E', 'user-1')
  })

  it('semeia conta com pipeline padrao de 7 etapas', async () => {
    const r = await store.pipelinePadrao()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.etapas).toHaveLength(7)
    expect(r.valor.etapas[0].nome).toBe('Novo lead')
    expect(r.valor.etapas[6].tipo).toBe('perdido')
  })

  it('cria lead na etapa informada', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const r = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    expect(r.ok).toBe(true)

    const leads = await store.listarLeads({})
    if (!leads.ok) throw new Error(leads.erro)
    expect(leads.valor).toHaveLength(1)
    expect(leads.valor[0].nome).toBe('Ana')
    expect(leads.valor[0].status).toBe('aberto')
  })

  it('recusa mover para perdido sem motivo', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    const perdido = p.valor.etapas.find((e) => e.tipo === 'perdido')!

    const r = await store.moverEtapa(criado.valor, perdido.id)
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('deriva status ao mover para ganho e registra evento', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)
    const ganho = p.valor.etapas.find((e) => e.tipo === 'ganho')!

    const r = await store.moverEtapa(criado.valor, ganho.id)
    expect(r.ok).toBe(true)

    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.status).toBe('ganho')

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    expect(eventos.valor.map((e) => e.tipo)).toContain('etapa_alterada')
  })

  it('aplica etiqueta guardando a etapa do momento', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const qualificacao = p.valor.etapas[2]
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: qualificacao.id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    await store.aplicarEtiquetas(criado.valor, ['Preço alto'])
    await store.moverEtapa(criado.valor, p.valor.etapas[3].id)

    expect(store.etapaDaEtiqueta(criado.valor, 'Preço alto')).toBe(qualificacao.id)
  })

  it('reusa etiqueta existente ignorando caixa', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const a = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    const b = await store.criarLead({
      ...novoLead('Bruno'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!a.ok || !b.ok) throw new Error('falha ao criar')

    await store.aplicarEtiquetas(a.valor, ['Preço alto'])
    await store.aplicarEtiquetas(b.valor, ['preço ALTO'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor).toHaveLength(1)
  })

  it('encontra possiveis duplicados por telefone', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    await store.criarLead({
      ...novoLead('Ana', { telefone: '(83) 99999-1234' }),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })

    const r = await store.possiveisDuplicados('+5583999991234', null)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.nome)).toEqual(['Ana'])
  })

  it('filtra leads por responsavel e por busca', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const etapa = p.valor.etapas[0].id
    await store.criarLead({
      ...novoLead('Ana Silva', { responsavelId: '11111111-1111-1111-1111-111111111111' }),
      pipelineId: p.valor.pipeline.id,
      stageId: etapa,
    })
    await store.criarLead({
      ...novoLead('Bruno Souza'),
      pipelineId: p.valor.pipeline.id,
      stageId: etapa,
    })

    const porResponsavel = await store.listarLeads({
      responsavelId: '11111111-1111-1111-1111-111111111111',
    })
    if (!porResponsavel.ok) throw new Error(porResponsavel.erro)
    expect(porResponsavel.valor.map((l) => l.nome)).toEqual(['Ana Silva'])

    const porBusca = await store.listarLeads({ busca: 'souza' })
    if (!porBusca.ok) throw new Error(porBusca.erro)
    expect(porBusca.valor.map((l) => l.nome)).toEqual(['Bruno Souza'])
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./memory"`.

- [ ] **Step 4: Implementar o store in-memory**

Create `src/lib/data/memory.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { normalizarNomeEtiqueta } from '@/lib/domain/normalizacao'
import type { NovoLead } from '@/lib/domain/lead'
import type {
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Pipeline,
} from '@/lib/domain/tipos'
import type { CrmStore, FiltroLeads } from './store'

const ETAPAS_PADRAO: { nome: string; tipo: Etapa['tipo'] }[] = [
  { nome: 'Novo lead', tipo: 'aberta' },
  { nome: 'Contato feito', tipo: 'aberta' },
  { nome: 'Qualificação', tipo: 'aberta' },
  { nome: 'Proposta', tipo: 'aberta' },
  { nome: 'Fechamento', tipo: 'aberta' },
  { nome: 'Ganho', tipo: 'ganho' },
  { nome: 'Perdido', tipo: 'perdido' },
]

const MOTIVOS_PADRAO = [
  'Preço',
  'Sem orçamento',
  'Sem resposta',
  'Comprou do concorrente',
  'Fora do perfil',
]

type LeadTag = { leadId: string; tagId: string; stageIdNoMomento: string }

/** Test double do CrmStore. Nao simula RLS — isso so o Postgres testa. */
export class InMemoryCrmStore implements CrmStore {
  private conta: Conta | null = null
  private usuarioAtual = 'user-1'
  private membrosLista: Membro[] = []
  private pipeline: Pipeline | null = null
  private etapas: Etapa[] = []
  private motivos: MotivoPerda[] = []
  private leads: Lead[] = []
  private tags: Etiqueta[] = []
  private leadTags: LeadTag[] = []
  private eventos: EventoLead[] = []

  semear(nomeConta: string, usuarioId: string): void {
    this.usuarioAtual = usuarioId
    const accountId = randomUUID()
    this.conta = { id: accountId, nome: nomeConta }
    this.membrosLista = [
      { id: usuarioId, nome: 'Admin', email: 'admin@teste.com', papel: 'admin' },
    ]
    this.pipeline = { id: randomUUID(), nome: 'Funil de vendas', isDefault: true }
    this.etapas = ETAPAS_PADRAO.map((e, i) => ({
      id: randomUUID(),
      pipelineId: this.pipeline!.id,
      nome: e.nome,
      ordem: i + 1,
      tipo: e.tipo,
      slaHoras: null,
    }))
    this.motivos = MOTIVOS_PADRAO.map((nome) => ({ id: randomUUID(), nome, ativo: true }))
  }

  /** Só para teste: qual etapa ficou no snapshot da etiqueta. */
  etapaDaEtiqueta(leadId: string, nomeTag: string): string | null {
    const tag = this.acharTag(nomeTag)
    if (!tag) return null
    const rel = this.leadTags.find((lt) => lt.leadId === leadId && lt.tagId === tag.id)
    return rel?.stageIdNoMomento ?? null
  }

  private acharTag(nome: string): Etiqueta | undefined {
    const alvo = normalizarNomeEtiqueta(nome).toLowerCase()
    return this.tags.find((t) => t.nome.toLowerCase() === alvo)
  }

  private etapaPorId(id: string): Etapa | undefined {
    return this.etapas.find((e) => e.id === id)
  }

  async contaAtiva(): Promise<Resultado<Conta | null>> {
    return ok(this.conta)
  }

  async membros(): Promise<Resultado<Membro[]>> {
    return ok([...this.membrosLista])
  }

  async pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>> {
    if (!this.pipeline) return falha('pipeline_nao_encontrado')
    return ok({ pipeline: this.pipeline, etapas: [...this.etapas] })
  }

  async motivosPerda(): Promise<Resultado<MotivoPerda[]>> {
    return ok(this.motivos.filter((m) => m.ativo))
  }

  async listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>> {
    let saida = [...this.leads]
    if (filtro.responsavelId) {
      saida = saida.filter((l) => l.responsavelId === filtro.responsavelId)
    }
    if (filtro.origem) {
      saida = saida.filter((l) => l.origem === filtro.origem)
    }
    if (filtro.desde) {
      saida = saida.filter((l) => l.criadoEm >= filtro.desde!)
    }
    if (filtro.busca) {
      const alvo = filtro.busca.toLowerCase()
      saida = saida.filter(
        (l) =>
          l.nome.toLowerCase().includes(alvo) ||
          (l.telefoneE164 ?? '').includes(alvo) ||
          (l.emailNorm ?? '').includes(alvo),
      )
    }
    return ok(saida)
  }

  async buscarLead(leadId: string): Promise<Resultado<Lead | null>> {
    return ok(this.leads.find((l) => l.id === leadId) ?? null)
  }

  async criarLead(
    dados: NovoLead & { pipelineId: string; stageId: string },
  ): Promise<Resultado<string>> {
    if (!this.conta) return falha('sem_conta')
    const agora = new Date()
    const lead: Lead = {
      id: randomUUID(),
      accountId: this.conta.id,
      nome: dados.nome,
      telefone: dados.telefone,
      telefoneE164: dados.telefoneE164,
      email: dados.email,
      emailNorm: dados.emailNorm,
      empresa: dados.empresa,
      origem: 'manual',
      pipelineId: dados.pipelineId,
      stageId: dados.stageId,
      responsavelId: dados.responsavelId,
      status: 'aberto',
      valorCents: dados.valorCents,
      lossReasonId: null,
      entrouNaEtapaEm: agora,
      criadoEm: agora,
      atualizadoEm: agora,
      etiquetas: [],
    }
    this.leads.push(lead)
    this.eventos.push({
      id: randomUUID(),
      leadId: lead.id,
      tipo: 'lead_criado',
      payload: { origem: 'manual' },
      atorId: this.usuarioAtual,
      criadoEm: agora,
    })
    return ok(lead.id)
  }

  async possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>> {
    if (!telefoneE164 && !emailNorm) return ok([])
    return ok(
      this.leads.filter(
        (l) =>
          (telefoneE164 !== null && l.telefoneE164 === telefoneE164) ||
          (emailNorm !== null && l.emailNorm === emailNorm),
      ),
    )
  }

  async moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')
    const destino = this.etapaPorId(stageDestino)
    if (!destino) return falha('etapa_invalida')

    if (destino.tipo === 'perdido') {
      if (!lossReasonId) return falha('motivo_perda_obrigatorio')
      if (!this.motivos.some((m) => m.id === lossReasonId && m.ativo)) {
        return falha('motivo_perda_invalido')
      }
    }

    const origem = lead.stageId
    const agora = new Date()
    lead.stageId = destino.id
    lead.status = destino.tipo === 'aberta' ? 'aberto' : destino.tipo
    lead.lossReasonId = destino.tipo === 'perdido' ? lossReasonId! : null
    lead.entrouNaEtapaEm = agora
    lead.atualizadoEm = agora

    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'etapa_alterada',
      payload: { de: origem, para: destino.id, loss_reason_id: lossReasonId ?? null },
      atorId: this.usuarioAtual,
      criadoEm: agora,
    })
    return ok(undefined)
  }

  async etiquetasDaConta(): Promise<Resultado<Etiqueta[]>> {
    return ok([...this.tags])
  }

  async aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')

    for (const bruto of nomes) {
      const nome = normalizarNomeEtiqueta(bruto)
      if (nome.length === 0) continue
      let tag = this.acharTag(nome)
      if (!tag) {
        tag = { id: randomUUID(), nome }
        this.tags.push(tag)
      }
      if (this.leadTags.some((lt) => lt.leadId === leadId && lt.tagId === tag.id)) continue
      // Snapshot: a etapa em que o lead estava quando a etiqueta foi aplicada.
      this.leadTags.push({ leadId, tagId: tag.id, stageIdNoMomento: lead.stageId })
      lead.etiquetas.push(tag)
      this.eventos.push({
        id: randomUUID(),
        leadId,
        tipo: 'etiqueta_aplicada',
        payload: { tag: tag.nome, etapa: lead.stageId },
        atorId: this.usuarioAtual,
        criadoEm: new Date(),
      })
    }
    return ok(undefined)
  }

  async eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>> {
    return ok(
      this.eventos
        .filter((e) => e.leadId === leadId)
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime()),
    )
  }

  async registrarNota(leadId: string, texto: string): Promise<Resultado<void>> {
    if (!this.leads.some((l) => l.id === leadId)) return falha('lead_nao_encontrado')
    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'nota',
      payload: { texto },
      atorId: this.usuarioAtual,
      criadoEm: new Date(),
    })
    return ok(undefined)
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 28 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: port CrmStore e implementacao in-memory para testes"
```

---

### Task 8: Clients Supabase e `SupabaseCrmStore`

**Files:**
- Create: `src/lib/supabase/servidor.ts`
- Create: `src/lib/supabase/navegador.ts`
- Create: `src/lib/data/supabase.ts`
- Test: `tests/integration/supabase-store.test.ts`

**Interfaces:**
- Consumes: `CrmStore` e `FiltroLeads` de `src/lib/data/store.ts`; tipos de domínio.
- Produces:
  - `criarClienteServidor(): Promise<SupabaseClient>` — lê a sessão dos cookies (Server Components e Server Actions).
  - `criarClienteNavegador(): SupabaseClient`.
  - `class SupabaseCrmStore implements CrmStore` com construtor `(cliente: SupabaseClient, accountId: string, usuarioId: string)`.
  - `criarStoreDoServidor(): Promise<Resultado<{ store: SupabaseCrmStore; conta: Conta; usuarioId: string; papel: Papel }>>` — resolve a conta ativa (a única membership do usuário) e devolve o store pronto.

- [ ] **Step 1: Escrever os clients Supabase**

Create `src/lib/supabase/servidor.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function criarClienteServidor() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component nao pode escrever cookie; o middleware renova a sessao.
          }
        },
      },
    },
  )
}
```

Create `src/lib/supabase/navegador.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 2: Escrever os testes de integração do store**

Create `tests/integration/supabase-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseCrmStore } from '@/lib/data/supabase'
import { leadSchema } from '@/lib/domain/lead'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Cliente supabase-js falando pelo usuario. Assinamos um JWT local com o
 * segredo padrao do Supabase CLI, que e o mesmo em toda instalacao local.
 */
async function clienteDoUsuario(userId: string) {
  const { SignJWT } = await import('jose')
  const segredo = new TextEncoder().encode(
    'super-secret-jwt-token-with-at-least-32-characters-long',
  )
  const token = await new SignJWT({ sub: userId, role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(segredo)

  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('SupabaseCrmStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('lista o pipeline padrao com as 7 etapas', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)

    const r = await store.pipelinePadrao()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.etapas).toHaveLength(7)
    expect(r.valor.etapas[0].nome).toBe('Novo lead')
  })

  it('cria lead e o encontra na listagem', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana', telefone: '(83) 99999-1234' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const lista = await store.listarLeads({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor.map((l) => l.nome)).toEqual(['Ana'])
    expect(lista.valor[0].telefoneE164).toBe('+5583999991234')
  })

  it('vendedor nao ve lead de outro vendedor pela RLS', async () => {
    await comoServico((cli) =>
      cli.query(
        `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
         values ($1, 'Lead do B', $2, $3, $4)`,
        [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorBId],
      ),
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const lista = await store.listarLeads({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor).toHaveLength(0)
  })

  it('moverEtapa devolve erro tipado quando falta motivo de perda', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)
    const criado = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Novo lead'),
      responsavelId: c.vendedorAId,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.moverEtapa(criado.valor, etapa(c, 'Perdido'))
    expect(r).toEqual({ ok: false, erro: 'motivo_perda_obrigatorio' })
  })

  it('buscarLead devolve null (nao erro) para lead de outra pessoa', async () => {
    const idAlheio = await comoServico(async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
           values ($1, 'Lead do B', $2, $3, $4) returning id`,
          [c.accountId, c.pipelineId, etapa(c, 'Novo lead'), c.vendedorBId],
        )
      ).rows[0].id,
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.vendedorAId)

    const r = await store.buscarLead(idAlheio)
    expect(r).toEqual({ ok: true, valor: null })
  })

  it('aplicarEtiquetas reusa a etiqueta existente ignorando caixa', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const a = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    const b = await store.criarLead({
      ...leadSchema.parse({ nome: 'Bruno' }),
      pipelineId: c.pipelineId,
      stageId: etapa(c, 'Qualificação'),
    })
    if (!a.ok || !b.ok) throw new Error('falha ao criar')

    await store.aplicarEtiquetas(a.valor, ['Preço alto'])
    await store.aplicarEtiquetas(b.valor, ['preço ALTO'])

    const etiquetas = await store.etiquetasDaConta()
    if (!etiquetas.ok) throw new Error(etiquetas.erro)
    expect(etiquetas.valor).toHaveLength(1)

    const snapshot = await comoServico(async (cli) =>
      (
        await cli.query('select stage_id_no_momento from public.lead_tags where lead_id = $1', [
          b.valor,
        ])
      ).rows[0].stage_id_no_momento,
    )
    expect(snapshot).toBe(etapa(c, 'Qualificação'))
  })
})
```

Instalar a dependência usada pelo helper de JWT:

```bash
npm install -D jose
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:integration -- tests/integration/supabase-store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/data/supabase"`.

- [ ] **Step 4: Implementar o `SupabaseCrmStore`**

Create `src/lib/data/supabase.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { normalizarNomeEtiqueta } from '@/lib/domain/normalizacao'
import type { NovoLead } from '@/lib/domain/lead'
import type {
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Papel,
  Pipeline,
} from '@/lib/domain/tipos'
import type { CrmStore, FiltroLeads } from './store'
import { criarClienteServidor } from '@/lib/supabase/servidor'

type LinhaLead = {
  id: string
  account_id: string
  nome: string
  telefone: string | null
  telefone_e164: string | null
  email: string | null
  email_norm: string | null
  empresa: string | null
  origem: Lead['origem']
  pipeline_id: string
  stage_id: string
  responsavel_id: string | null
  status: Lead['status']
  valor_cents: number | null
  loss_reason_id: string | null
  entrou_na_etapa_em: string
  criado_em: string
  atualizado_em: string
  lead_tags?: { tags: { id: string; nome: string } }[]
}

function paraLead(linha: LinhaLead): Lead {
  return {
    id: linha.id,
    accountId: linha.account_id,
    nome: linha.nome,
    telefone: linha.telefone,
    telefoneE164: linha.telefone_e164,
    email: linha.email,
    emailNorm: linha.email_norm,
    empresa: linha.empresa,
    origem: linha.origem,
    pipelineId: linha.pipeline_id,
    stageId: linha.stage_id,
    responsavelId: linha.responsavel_id,
    status: linha.status,
    valorCents: linha.valor_cents,
    lossReasonId: linha.loss_reason_id,
    entrouNaEtapaEm: new Date(linha.entrou_na_etapa_em),
    criadoEm: new Date(linha.criado_em),
    atualizadoEm: new Date(linha.atualizado_em),
    etiquetas: (linha.lead_tags ?? []).map((lt) => ({ id: lt.tags.id, nome: lt.tags.nome })),
  }
}

const SELECT_LEAD =
  '*, lead_tags(tags(id, nome))'

export class SupabaseCrmStore implements CrmStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
    private readonly usuarioId: string,
  ) {}

  async contaAtiva(): Promise<Resultado<Conta | null>> {
    const { data, error } = await this.cliente
      .from('accounts')
      .select('id, nome')
      .eq('id', this.accountId)
      .maybeSingle()
    if (error) return falha(error.message)
    return ok(data ? { id: data.id, nome: data.nome } : null)
  }

  async membros(): Promise<Resultado<Membro[]>> {
    const { data, error } = await this.cliente
      .from('memberships')
      .select('papel, profiles(id, nome, email)')
      .eq('account_id', this.accountId)
    if (error) return falha(error.message)
    const linhas = (data ?? []) as unknown as {
      papel: Papel
      profiles: { id: string; nome: string; email: string }
    }[]
    return ok(
      linhas.map((l) => ({
        id: l.profiles.id,
        nome: l.profiles.nome,
        email: l.profiles.email,
        papel: l.papel,
      })),
    )
  }

  async pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>> {
    const { data: p, error: erroP } = await this.cliente
      .from('pipelines')
      .select('id, nome, is_default')
      .eq('account_id', this.accountId)
      .eq('is_default', true)
      .maybeSingle()
    if (erroP) return falha(erroP.message)
    if (!p) return falha('pipeline_nao_encontrado')

    const { data: s, error: erroS } = await this.cliente
      .from('stages')
      .select('id, pipeline_id, nome, ordem, tipo, sla_horas')
      .eq('pipeline_id', p.id)
      .order('ordem')
    if (erroS) return falha(erroS.message)

    return ok({
      pipeline: { id: p.id, nome: p.nome, isDefault: p.is_default },
      etapas: (s ?? []).map((e) => ({
        id: e.id,
        pipelineId: e.pipeline_id,
        nome: e.nome,
        ordem: e.ordem,
        tipo: e.tipo,
        slaHoras: e.sla_horas,
      })),
    })
  }

  async motivosPerda(): Promise<Resultado<MotivoPerda[]>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .select('id, nome, ativo')
      .eq('account_id', this.accountId)
      .eq('ativo', true)
      .order('nome')
    if (error) return falha(error.message)
    return ok(data ?? [])
  }

  async listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>> {
    let q = this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('account_id', this.accountId)
      .order('criado_em', { ascending: false })

    if (filtro.responsavelId) q = q.eq('responsavel_id', filtro.responsavelId)
    if (filtro.origem) q = q.eq('origem', filtro.origem)
    if (filtro.desde) q = q.gte('criado_em', filtro.desde.toISOString())
    if (filtro.busca) {
      const alvo = `%${filtro.busca}%`
      q = q.or(`nome.ilike.${alvo},telefone_e164.ilike.${alvo},email_norm.ilike.${alvo}`)
    }

    const { data, error } = await q
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaLead[]).map(paraLead))
  }

  async buscarLead(leadId: string): Promise<Resultado<Lead | null>> {
    const { data, error } = await this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('id', leadId)
      .maybeSingle()
    // Com RLS ativa, sem permissao vem zero linhas — nao e erro, e "nao encontrado".
    if (error) return falha(error.message)
    return ok(data ? paraLead(data as unknown as LinhaLead) : null)
  }

  async criarLead(
    dados: NovoLead & { pipelineId: string; stageId: string },
  ): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('leads')
      .insert({
        account_id: this.accountId,
        nome: dados.nome,
        telefone: dados.telefone,
        telefone_e164: dados.telefoneE164,
        email: dados.email,
        email_norm: dados.emailNorm,
        empresa: dados.empresa,
        origem: 'manual',
        pipeline_id: dados.pipelineId,
        stage_id: dados.stageId,
        responsavel_id: dados.responsavelId,
        valor_cents: dados.valorCents,
      })
      .select('id')
      .single()
    if (error) return falha(error.message)

    await this.cliente.from('lead_events').insert({
      lead_id: data.id,
      tipo: 'lead_criado',
      payload: { origem: 'manual' },
      ator_id: this.usuarioId,
    })
    return ok(data.id)
  }

  async possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>> {
    if (!telefoneE164 && !emailNorm) return ok([])
    const condicoes: string[] = []
    if (telefoneE164) condicoes.push(`telefone_e164.eq.${telefoneE164}`)
    if (emailNorm) condicoes.push(`email_norm.eq.${emailNorm}`)

    const { data, error } = await this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('account_id', this.accountId)
      .or(condicoes.join(','))
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaLead[]).map(paraLead))
  }

  async moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('move_lead_stage', {
      p_lead_id: leadId,
      p_stage_destino: stageDestino,
      p_loss_reason_id: lossReasonId ?? null,
    })
    if (error) return falha(codigoDoErroPostgres(error.message))
    return ok(undefined)
  }

  async etiquetasDaConta(): Promise<Resultado<Etiqueta[]>> {
    const { data, error } = await this.cliente
      .from('tags')
      .select('id, nome')
      .eq('account_id', this.accountId)
      .order('nome')
    if (error) return falha(error.message)
    return ok(data ?? [])
  }

  async aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>> {
    const lead = await this.buscarLead(leadId)
    if (!lead.ok) return falha(lead.erro)
    if (!lead.valor) return falha('lead_nao_encontrado')

    for (const bruto of nomes) {
      const nome = normalizarNomeEtiqueta(bruto)
      if (nome.length === 0) continue

      const { data: existente, error: erroBusca } = await this.cliente
        .from('tags')
        .select('id, nome')
        .eq('account_id', this.accountId)
        .ilike('nome', nome)
        .maybeSingle()
      if (erroBusca) return falha(erroBusca.message)

      let tagId = existente?.id
      if (!tagId) {
        const { data: nova, error: erroInsert } = await this.cliente
          .from('tags')
          .insert({ account_id: this.accountId, nome, criado_por: this.usuarioId })
          .select('id')
          .single()
        if (erroInsert) return falha(erroInsert.message)
        tagId = nova.id
      }

      const { error: erroRel } = await this.cliente.from('lead_tags').upsert(
        {
          lead_id: leadId,
          tag_id: tagId,
          // Snapshot da etapa no momento da aplicacao — sem isso a metrica mente.
          stage_id_no_momento: lead.valor.stageId,
          criado_por: this.usuarioId,
        },
        { onConflict: 'lead_id,tag_id', ignoreDuplicates: true },
      )
      if (erroRel) return falha(erroRel.message)

      await this.cliente.from('lead_events').insert({
        lead_id: leadId,
        tipo: 'etiqueta_aplicada',
        payload: { tag: nome, etapa: lead.valor.stageId },
        ator_id: this.usuarioId,
      })
    }
    return ok(undefined)
  }

  async eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>> {
    const { data, error } = await this.cliente
      .from('lead_events')
      .select('id, lead_id, tipo, payload, ator_id, criado_em')
      .eq('lead_id', leadId)
      .order('criado_em', { ascending: false })
    if (error) return falha(error.message)
    return ok(
      (data ?? []).map((e) => ({
        id: e.id,
        leadId: e.lead_id,
        tipo: e.tipo,
        payload: e.payload as Record<string, unknown>,
        atorId: e.ator_id,
        criadoEm: new Date(e.criado_em),
      })),
    )
  }

  async registrarNota(leadId: string, texto: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.from('lead_events').insert({
      lead_id: leadId,
      tipo: 'nota',
      payload: { texto },
      ator_id: this.usuarioId,
    })
    if (error) return falha(error.message)
    return ok(undefined)
  }
}

/** Extrai o codigo levantado por raise exception, ex: 'motivo_perda_obrigatorio'. */
function codigoDoErroPostgres(mensagem: string): string {
  const conhecidos = [
    'lead_nao_encontrado',
    'etapa_invalida',
    'motivo_perda_obrigatorio',
    'motivo_perda_invalido',
    'convite_invalido',
    'convite_expirado',
    'convite_ja_aceito',
    'sem_sessao',
  ]
  const achado = conhecidos.find((c) => mensagem.includes(c))
  return achado ?? mensagem
}

/** Resolve a conta ativa do usuario logado e devolve o store pronto. */
export async function criarStoreDoServidor(): Promise<
  Resultado<{ store: SupabaseCrmStore; conta: Conta; usuarioId: string; papel: Papel }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  const usuario = sessao.user
  if (!usuario) return falha('sem_sessao')

  const { data, error } = await cliente
    .from('memberships')
    .select('papel, accounts(id, nome)')
    .limit(1)
    .maybeSingle()
  if (error) return falha(error.message)
  if (!data) return falha('sem_conta')

  const linha = data as unknown as { papel: Papel; accounts: { id: string; nome: string } }
  const conta: Conta = { id: linha.accounts.id, nome: linha.accounts.nome }
  return ok({
    store: new SupabaseCrmStore(cliente, conta.id, usuario.id),
    conta,
    usuarioId: usuario.id,
    papel: linha.papel,
  })
}
```

- [ ] **Step 5: Rodar todos os testes de integração**

```bash
npx supabase db reset
npm run test:integration
```

Expected: PASS — 30 testes.

- [ ] **Step 6: Rodar unit + typecheck**

```bash
npm test && npm run typecheck
```

Expected: 28 testes unitários passando, typecheck limpo.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: clients Supabase e SupabaseCrmStore com resolucao de conta ativa"
```

---

### Task 9: Autenticação — signup, login, convite e sessão

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/signup/page.tsx`
- Create: `src/app/(auth)/convite/[token]/page.tsx`
- Create: `src/app/(auth)/acoes.ts`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/page.tsx` (redirect)
- Test: `src/app/(auth)/acoes.test.ts`

**Interfaces:**
- Consumes: `criarClienteServidor`, `criarStoreDoServidor`, `Resultado`.
- Produces: Server Actions `entrar(formData)`, `cadastrar(formData)`, `sair()`, `aceitarConvite(token)`, todas retornando `Resultado<void>`; e o layout `(app)` que garante sessão + conta e expõe `conta`, `papel` e `usuarioId` às páginas do Plano 2 via props de `children`.

- [ ] **Step 1: Escrever o teste das validações de formulário**

Create `src/app/(auth)/acoes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { credenciaisSchema, cadastroSchema } from './esquemas'

describe('credenciaisSchema', () => {
  it('aceita email e senha validos', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana@se7e.com', senha: 'segredo123' })
    expect(r.success).toBe(true)
  })

  it('rejeita email invalido', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana', senha: 'segredo123' })
    expect(r.success).toBe(false)
  })

  it('rejeita senha curta', () => {
    const r = credenciaisSchema.safeParse({ email: 'ana@se7e.com', senha: '123' })
    expect(r.success).toBe(false)
  })

  it('normaliza o email para minusculas', () => {
    const r = credenciaisSchema.parse({ email: '  Ana@SE7E.com ', senha: 'segredo123' })
    expect(r.email).toBe('ana@se7e.com')
  })
})

describe('cadastroSchema', () => {
  it('exige nome da pessoa e nome da conta', () => {
    expect(
      cadastroSchema.safeParse({
        email: 'ana@se7e.com',
        senha: 'segredo123',
        nome: 'Ana',
        nomeConta: 'SE7E',
      }).success,
    ).toBe(true)

    expect(
      cadastroSchema.safeParse({
        email: 'ana@se7e.com',
        senha: 'segredo123',
        nome: 'Ana',
        nomeConta: '  ',
      }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./esquemas"`.

- [ ] **Step 3: Escrever os esquemas**

Create `src/app/(auth)/esquemas.ts`:

```ts
import { z } from 'zod'

export const credenciaisSchema = z.object({
  email: z.string().trim().toLowerCase().email('email_invalido'),
  senha: z.string().min(8, 'senha_curta'),
})

export const cadastroSchema = credenciaisSchema.extend({
  nome: z.string().trim().min(1, 'nome_obrigatorio'),
  nomeConta: z.string().trim().min(1, 'nome_conta_obrigatorio'),
})
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 33 testes.

- [ ] **Step 5: Escrever as Server Actions**

Create `src/app/(auth)/acoes.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { cadastroSchema, credenciaisSchema } from './esquemas'

export async function entrar(formData: FormData): Promise<Resultado<void>> {
  const parsed = credenciaisSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const { error } = await cliente.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.senha,
  })
  if (error) return falha('credenciais_invalidas')

  redirect('/funil')
}

export async function cadastrar(formData: FormData): Promise<Resultado<void>> {
  const parsed = cadastroSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
    nome: formData.get('nome'),
    nomeConta: formData.get('nomeConta'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const { error: erroSignup } = await cliente.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.senha,
    options: { data: { nome: parsed.data.nome } },
  })
  if (erroSignup) return falha(erroSignup.message)

  // criar_conta roda como DEFINER e usa auth.uid(): precisa da sessao ja ativa.
  const { error: erroConta } = await cliente.rpc('criar_conta', {
    p_nome: parsed.data.nomeConta,
  })
  if (erroConta) return falha(erroConta.message)

  redirect('/funil')
}

export async function aceitarConvite(token: string): Promise<Resultado<void>> {
  const cliente = await criarClienteServidor()
  const { error } = await cliente.rpc('accept_invite', { p_token: token })
  if (error) {
    for (const codigo of ['convite_invalido', 'convite_expirado', 'convite_ja_aceito', 'sem_sessao']) {
      if (error.message.includes(codigo)) return falha(codigo)
    }
    return falha(error.message)
  }
  return ok(undefined)
}

export async function sair(): Promise<void> {
  const cliente = await criarClienteServidor()
  await cliente.auth.signOut()
  redirect('/login')
}
```

- [ ] **Step 6: Escrever o middleware de sessão**

Create `src/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ROTAS_PUBLICAS = ['/login', '/signup', '/convite']

export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          resposta = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            resposta.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const caminho = request.nextUrl.pathname
  const publica = ROTAS_PUBLICAS.some((r) => caminho.startsWith(r))

  if (!user && !publica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return resposta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 7: Escrever as páginas de auth**

Create `src/app/(auth)/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { entrar } from '../acoes'

export default function LoginPage() {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await entrar(formData)
    if (!r.ok) setErro(r.erro)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <form action={acao} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder="email"
          required
          className="rounded border p-2"
        />
        <input
          name="senha"
          type="password"
          placeholder="senha"
          required
          className="rounded border p-2"
        />
        <button type="submit" className="rounded bg-black p-2 text-white">
          Entrar
        </button>
      </form>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Link href="/signup" className="text-sm underline">
        Criar uma conta
      </Link>
    </main>
  )
}
```

Create `src/app/(auth)/signup/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cadastrar } from '../acoes'

export default function SignupPage() {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await cadastrar(formData)
    if (!r.ok) setErro(r.erro)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Criar conta</h1>
      <form action={acao} className="flex flex-col gap-3">
        <input name="nome" placeholder="seu nome" required className="rounded border p-2" />
        <input
          name="nomeConta"
          placeholder="nome da empresa"
          required
          className="rounded border p-2"
        />
        <input
          name="email"
          type="email"
          placeholder="email"
          required
          className="rounded border p-2"
        />
        <input
          name="senha"
          type="password"
          placeholder="senha (min. 8 caracteres)"
          required
          className="rounded border p-2"
        />
        <button type="submit" className="rounded bg-black p-2 text-white">
          Criar conta
        </button>
      </form>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Link href="/login" className="text-sm underline">
        Já tenho conta
      </Link>
    </main>
  )
}
```

Create `src/app/(auth)/convite/[token]/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { aceitarConvite } from '../../acoes'

const MENSAGENS: Record<string, string> = {
  convite_invalido: 'Convite não encontrado.',
  convite_expirado: 'Este convite expirou. Peça um novo ao administrador.',
  convite_ja_aceito: 'Este convite já foi usado.',
  sem_sessao: 'Crie sua conta ou entre para aceitar o convite.',
}

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cliente = await criarClienteServidor()
  const {
    data: { user },
  } = await cliente.auth.getUser()

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Você foi convidado</h1>
        <p className="text-sm">Crie sua conta ou entre para aceitar o convite.</p>
        <Link href="/signup" className="underline">
          Criar conta
        </Link>
        <Link href="/login" className="underline">
          Entrar
        </Link>
      </main>
    )
  }

  const r = await aceitarConvite(token)
  if (r.ok) redirect('/funil')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Convite não aceito</h1>
      <p className="text-sm text-red-600">{MENSAGENS[r.erro] ?? r.erro}</p>
    </main>
  )
}
```

- [ ] **Step 8: Escrever o layout autenticado e a raiz**

Create `src/app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { sair } from '../(auth)/acoes'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const r = await criarStoreDoServidor()
  if (!r.ok) {
    if (r.erro === 'sem_sessao') redirect('/login')
    if (r.erro === 'sem_conta') redirect('/signup')
    throw new Error(r.erro)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">{r.valor.conta.nome}</span>
        <form action={sair}>
          <button type="submit" className="text-sm underline">
            Sair
          </button>
        </form>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
```

Create `src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/funil')
}
```

Create `src/app/(app)/funil/page.tsx` (placeholder desta task; o Kanban real é a Task 1 do Plano 2):

```tsx
export default function FunilPage() {
  return <p className="p-6 text-sm">Funil em construção.</p>
}
```

- [ ] **Step 9: Verificar o fluxo completo no navegador**

```bash
npm run dev
```

Abrir `http://localhost:3000/signup`, criar conta com nome da empresa "SE7E". Esperado: redireciona para `/funil` mostrando o cabeçalho com "SE7E".

Depois confirmar o seed:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select a.nome, count(s.id) as etapas from public.accounts a join public.pipelines p on p.account_id = a.id join public.stages s on s.pipeline_id = p.id group by a.nome"
```

Expected: uma linha com `SE7E | 7`.

- [ ] **Step 10: Rodar a suíte inteira**

```bash
npm test && npm run test:integration && npm run typecheck && npm run build
```

Expected: 33 unitários e 30 de integração passando; typecheck e build limpos.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: signup com criacao de conta, login, convite e sessao"
```

---

## Estado ao fim deste plano

- Schema completo com RLS verificada contra Postgres real: 30 testes de integração.
- Domínio puro e store in-memory: 33 testes unitários.
- `SupabaseCrmStore` implementando o mesmo port do in-memory.
- Signup cria conta com pipeline e motivos semeados; convite por token funciona sem `service_role`; login e logout funcionando.
- `/funil` existe como placeholder — o Kanban é a primeira task do **Plano 2: Funil**.
