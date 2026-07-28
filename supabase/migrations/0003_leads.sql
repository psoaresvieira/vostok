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

-- Grant explicito: ver a nota em 0001_identidade.sql. Quem barra escrita e a
-- RLS, nao o privilegio: stage_history e lead_events recebem update/delete no
-- grant mas nao tem policy nenhuma para essas acoes, entao a operacao afeta
-- zero linhas em vez de estourar erro de permissao.
grant select, insert, update on public.leads to authenticated;
grant select, insert on public.tags to authenticated;
grant select, insert, delete on public.lead_tags to authenticated;
grant select, insert, update, delete on public.stage_history to authenticated;
grant select, insert, update, delete on public.lead_events to authenticated;

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
