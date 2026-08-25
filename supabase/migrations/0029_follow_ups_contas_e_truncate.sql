-- Follow-ups do review do plano contas-so-pelo-dono (0028) + a higiene de
-- TRUNCATE que ficou anotada desde a guarda silenciosa nº 6 (Plano 9/0021).

-- 1) criar_conta_cliente: p_email null escapava da guarda entrada_invalida e
--    caia no 23502 do not null de invites.email — erro cru onde deveria haver
--    codigo do vocabulario. So o coalesce muda; o resto do corpo e' o da 0028.
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

  v_email := lower(trim(coalesce(p_email, '')));
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

-- 2) reemitir_convite: aceitava convite de QUALQUER origem, enquanto
--    contas_da_plataforma so lista convites criados por um dono — o /admin
--    podia entao reemitir um convite de equipe (criado pelo admin do cliente)
--    que nem aparece na propria tela. Sem escalacao real (accept_invite compara
--    email), mas a assimetria confunde: a guarda fecha a simetria. O codigo e'
--    convite_invalido, o mesmo do id inexistente — para o dono, um convite fora
--    do conjunto listavel NAO existe, e distinguir os dois casos vazaria a
--    existencia de convites de equipe de outras contas.
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
  if v_invite.criado_por is null
     or not exists (select 1 from public.platform_owners o where o.user_id = v_invite.criado_por) then
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

-- 3) TRUNCATE fora do alcance da API em TODO o schema. O default ACL desta
--    imagem inclui TRUNCATE ('D'), que RLS nao restringe: qualquer sessao SQL
--    authenticated esvaziaria tabelas inteiras de todas as contas de uma vez
--    (inalcancavel via PostgREST, que nao fala TRUNCATE — mas a guarda de
--    verdade e' o grant, nao o dialeto do gateway). A 0021 pagou os casos
--    pontuais conhecidos; aqui a varredura e' total, e o default privilege
--    cobre tabela futura criada por migration. O teste de integracao da 0029
--    enumera pg_class — tabela nova com TRUNCATE largo quebra a suite.
--    `on all tables` de proposito, e nao um loop por relkind='r': a forma da
--    gramatica cobre tambem tabela particionada (relkind 'p'), onde um
--    TRUNCATE no pai esvazia todas as particoes.
revoke truncate on all tables in schema public from anon, authenticated;

alter default privileges in schema public
  revoke truncate on tables from anon, authenticated;

-- Limite conhecido: o comando acima so' edita o default ACL do role que roda a
-- migration (postgres). A imagem tambem tem um default ACL de supabase_admin
-- concedendo TRUNCATE a anon/authenticated em tabela futura criada POR ELE
-- (extensao ligada pelo dashboard, tooling da plataforma) — inalcancavel
-- daqui, porque postgres nao e' membro de supabase_admin. O teste da 0029
-- pega o caso na primeira vez que uma tabela dessas aparecer.
