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

-- Grant explicito: ver a nota em 0001_identidade.sql.
grant select, insert, update, delete on public.pipelines to authenticated;
grant select, insert, update, delete on public.stages to authenticated;
grant select, insert, update, delete on public.loss_reasons to authenticated;

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
