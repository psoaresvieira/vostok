-- Tarefa e filha de lead e NAO tem dono proprio: ela e de quem responde pelo
-- lead. Por isso nao ha responsavel_id aqui, e por isso as quatro policies sao
-- o mesmo pode_ver_lead_id que lead_tags e stage_history ja usam — nenhuma
-- regra de autorizacao nova entra no projeto com esta tabela.
create type public.task_tipo as enum
  ('ligacao', 'whatsapp', 'reuniao', 'proposta', 'outro');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  titulo text not null check (btrim(titulo) <> ''),
  tipo public.task_tipo not null default 'outro',
  vence_em timestamptz not null,
  concluida_em timestamptz,
  concluida_por uuid references public.profiles(id),
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index tasks_lead_idx on public.tasks (lead_id, vence_em);

-- Parcial: /tarefas e o badge so leem tarefa aberta, e a maioria das linhas
-- da tabela vai estar concluida depois de algumas semanas de uso.
create index tasks_abertas_idx on public.tasks (vence_em)
  where concluida_em is null;

-- Grant explicito: o default ACL do schema public nesta imagem da a
-- authenticated so Dxtm. Sem esta linha a RLS nem chega a ser avaliada.
grant select, insert, update, delete on public.tasks to authenticated;

alter table public.tasks enable row level security;

create policy tasks_select on public.tasks
  for select using (public.pode_ver_lead_id(lead_id));
create policy tasks_insert on public.tasks
  for insert with check (public.pode_ver_lead_id(lead_id));
-- O with check repete o using de proposito: sem ele, um update poderia mover a
-- tarefa para um lead fora do alcance de quem edita.
create policy tasks_update on public.tasks
  for update using (public.pode_ver_lead_id(lead_id))
  with check (public.pode_ver_lead_id(lead_id));
-- Diferente de lead, tarefa se apaga: erro de digitacao em follow-up nao
-- merece ser eterno.
create policy tasks_delete on public.tasks
  for delete using (public.pode_ver_lead_id(lead_id));
