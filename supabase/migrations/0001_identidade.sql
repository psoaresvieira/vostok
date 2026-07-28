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

-- Nesta versao do supabase/postgres o default ACL do schema public da a
-- anon/authenticated apenas Dxtm (sem select/insert/update/delete), entao o
-- grant tem que ser explicito ou a RLS nem chega a ser avaliada. Grant so para
-- authenticated: nada aqui e publico, e service_role nao e usada pela aplicacao.
grant select, update on public.accounts to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invites to authenticated;

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
