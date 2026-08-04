-- Scripts de venda. Spec: docs/superpowers/specs/2026-08-02-crm-scripts-tarefas-design.md §4.
--
-- Script NAO e filho de lead: e conhecimento da conta, como tags. Leva
-- account_id e is_member_of na leitura — todo membro consome a biblioteca;
-- escrita e de admin/gestor (uma linha para mudar, se a decisao mudar).
--
-- tags e array, nao tabela de juncao, de proposito: etiqueta de lead precisa
-- de identidade (congela stage_id_no_momento, alimenta /metricas); tag de
-- script so precisa ser buscada. Juncao aqui importaria a classe de bug do
-- ILIKE em subconsulta sem comprar nada.

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  titulo text not null check (btrim(titulo) <> ''),
  conteudo text not null,
  -- Nulo = serve em qualquer etapa. ON DELETE SET NULL e deliberado e veio
  -- DEPOIS da spec: o Plano 8 tornou etapa excluivel de verdade, e um script
  -- de etapa excluida deve virar "qualquer etapa" — nao travar excluir_etapa
  -- com 23503 que o AdminStore traduziria para etapa_tem_leads (mentira).
  -- Mesmo destino das FKs de stage_history/lead_tags na 0016.
  stage_id uuid references public.stages(id) on delete set null,
  tags text[] not null default '{}'
    check (coalesce(array_length(tags, 1), 0) <= 10),
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index scripts_account_stage_idx on public.scripts (account_id, stage_id);
create index scripts_tags_idx on public.scripts using gin (tags);

-- A FK de stage_id aceita etapa de QUALQUER conta (a conta esta a dois saltos:
-- stages -> pipelines -> account) — mesma classe que o Plano 3 fechou para
-- responsavel_id. Este helper e a checagem que as policies de escrita exigem.
--
-- SECURITY DEFINER dito em voz alta: a funcao le stages e pipelines DE
-- PASSAGEM, dentro de policy de outra tabela, e o veredito dela nao pode
-- depender do que a RLS dessas tabelas mostra a quem chama — e a mesma razao
-- que fez is_member_of, conta_do_pipeline e pode_ver_lead nascerem definer.
-- Nao e a guarda no 5 (leitura recortada por papel): devolve boolean sobre um
-- par de ids, nao linhas de dados.
create or replace function public.stage_da_conta(p_stage_id uuid, p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.stages s
      join public.pipelines p on p.id = s.pipeline_id
     where s.id = p_stage_id
       and p.account_id = p_account_id
  );
$$;

grant execute on function public.stage_da_conta(uuid, uuid) to authenticated;

-- Grant explicito: o default ACL desta imagem da a anon/authenticated so Dxtm
-- — sem o grant a RLS nem e avaliada. E o revoke de TRUNCATE e a guarda no 6:
-- o D do default ACL e TRUNCATE, que a RLS NAO restringe.
grant select, insert, update, delete on public.scripts to authenticated;
revoke truncate on public.scripts from anon, authenticated;

alter table public.scripts enable row level security;

create policy scripts_select on public.scripts
  for select using (public.is_member_of(account_id));

create policy scripts_insert on public.scripts
  for insert with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and (stage_id is null or public.stage_da_conta(stage_id, account_id))
  );

-- O WITH CHECK repete a clausula de stage_da_conta DE PROPOSITO: ele reavalia
-- a linha inteira, inclusive colunas que o update nao tocou — e um update que
-- trocasse so o titulo de um script com stage_id alheio (impossivel hoje, a
-- tabela nasce com a regra) tem que continuar impossivel amanha. Nao mova a
-- regra para "so no insert".
create policy scripts_update on public.scripts
  for update using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  )
  with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and (stage_id is null or public.stage_da_conta(stage_id, account_id))
  );

create policy scripts_delete on public.scripts
  for delete using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  );
