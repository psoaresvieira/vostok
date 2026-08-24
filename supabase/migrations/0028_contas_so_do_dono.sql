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
