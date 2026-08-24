-- Semente de DESENVOLVIMENTO. Roda depois das migrations em todo
-- `npx supabase db reset`, e nunca em producao — o Supabase so executa seed em
-- reset local.
--
-- O segredo de ingestao e configuracao de OPERADOR: ele existe para o servidor
-- provar que a chamada veio dele, antes de qualquer conta ser resolvida.
-- Nenhuma tela e nenhuma RPC exposta a aplicacao o escreve (a razao completa
-- esta em 0008_fontes_conectadas.sql:69-82). Em desenvolvimento entra aqui,
-- para que `db reset` deixe o ambiente pronto; em producao entra por SQL no
-- painel do Supabase, com um valor que nunca esteve num arquivo versionado.
--
-- Este valor e publico de proposito: esta versionado, esta no
-- .env.local.example, e vale so contra o Postgres em 127.0.0.1. Se ele aparecer
-- em qualquer ambiente alcancavel de fora, o problema e o ambiente.
update public.ingestion_config
   set segredo_hash = public.hash_segredo('segredo-de-ingestao-local'),
       atualizado_em = now()
 where id;

-- Usuario dono da plataforma para DESENVOLVIMENTO local. Sem ele, depois da
-- 0028 nenhuma conta nasce em ambiente local — nem nos testes E2E. A senha e'
-- publica de proposito, como o segredo de ingestao acima: vale so contra o
-- GoTrue de 127.0.0.1.
-- confirmation_token/recovery_token/email_change_token_new/email_change nao
-- tem default (ficam NULL) e o GoTrue escaneia essas colunas como string Go —
-- NULL af nesse scan e' "Database error querying schema" no login, sem pista
-- nenhuma na tela. Os demais tokens ja tem default ''; estes quatro precisam
-- ser explicitos.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
  'authenticated', 'dono@local.dev', crypt('segredo123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"nome":"Dono Local"}', now(), now(),
  '', '', '', ''
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
