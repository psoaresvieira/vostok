-- 0034: backstop de conta nas RPCs de conexao Meta/Google (follow-up do Plano 16).
--
-- A 0030 deu ao dono da plataforma a alternativa `sou_dono_da_plataforma()`
-- na guarda de papel das seis RPCs de conexao e pos o `exists` de accounts
-- so' em conectar_whatsapp, por ela nao ter backstop nenhum depois. As tres
-- daqui TEM um backstop — e_membro_da_conta(p_account_id, p_responsavel) —,
-- mas ele e' vazio quando p_responsavel e' nulo (`p_user_id is null or
-- exists(...)`, 0007), que e' exatamente o caso do `npm run meta:conectar`
-- sem --responsavel: um --conta com typo passava e virava 23503 cru.
--
-- TUDO O MAIS e' copia byte a byte da 0030: segredo, sem_sessao, validacoes,
-- ordem das guardas. `create or replace` preserva os grants (0024/0032), e o
-- sweep 0024 continua verde sem mexer. desconectar_fonte fica como esta: ela
-- busca o registro antes da guarda (fonte_nao_encontrada).

create or replace function public.conectar_fonte_meta(
  p_segredo text,
  p_account_id uuid,
  p_page_id text,
  p_nome text,
  p_token text,
  p_responsavel uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Primeiro portao: so o servidor chega aqui.
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  -- Cumulativos, nao alternativos. O segredo prova QUEM chamou; estes provam
  -- por conta de quem. O dono da plataforma passa pela guarda de papel (0030).
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  -- Backstop da conta (0034): com p_responsavel nulo, e_membro_da_conta nao
  -- toca a conta, e o bypass do dono deixava um p_account_id inexistente
  -- (typo no --conta do meta:conectar) passar da guarda e estourar como FK
  -- crua 23503 em lead_sources. Mesmo `exists` que conectar_whatsapp ja tinha
  -- na 0030; restaura sem_permissao para conta inexistente.
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not (public.sou_dono_da_plataforma()
              and exists (select 1 from public.accounts a where a.id = p_account_id)) then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;

  begin
    insert into public.lead_sources
      (account_id, provedor, external_id, nome, responsavel_padrao_id)
    values (p_account_id, 'meta', p_page_id, p_nome, p_responsavel)
    returning id into v_id;
  exception
    when unique_violation then
      -- Continua sendo o desfecho certo para conectar: quem chega segundo NAO
      -- toma a linha em silencio. Tomar e ato explicito, e e a funcao abaixo.
      raise exception 'page_ja_conectada';
    when check_violation then
      raise exception 'page_id_invalido';
  end;

  insert into public.source_credentials (source_id, meta_page_token)
  values (v_id, p_token);

  return v_id;
end;
$$;

create or replace function public.reivindicar_fonte_meta(
  p_segredo text,
  p_account_id uuid,
  p_page_id text,
  p_nome text,
  p_token text,
  p_responsavel uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  -- Backstop da conta (0034): com p_responsavel nulo, e_membro_da_conta nao
  -- toca a conta, e o bypass do dono deixava um p_account_id inexistente
  -- (typo no --conta do meta:conectar) passar da guarda e estourar como FK
  -- crua 23503 em lead_sources. Mesmo `exists` que conectar_whatsapp ja tinha
  -- na 0030; restaura sem_permissao para conta inexistente.
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not (public.sou_dono_da_plataforma()
              and exists (select 1 from public.accounts a where a.id = p_account_id)) then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_page_id is null or btrim(p_page_id) = '' then
    raise exception 'page_id_invalido';
  end if;

  delete from public.lead_sources
   where provedor = 'meta' and external_id = p_page_id;

  insert into public.lead_sources
    (account_id, provedor, external_id, nome, responsavel_padrao_id)
  values (p_account_id, 'meta', p_page_id, p_nome, p_responsavel)
  returning id into v_id;

  insert into public.source_credentials (source_id, meta_page_token)
  values (v_id, p_token);

  return v_id;
end;
$$;

create or replace function public.conectar_fonte_google(
  p_account_id uuid,
  p_nome text,
  p_url_token text,
  p_google_key text,
  p_responsavel uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  -- Backstop da conta (0034): com p_responsavel nulo, e_membro_da_conta nao
  -- toca a conta, e o bypass do dono deixava um p_account_id inexistente
  -- (typo no --conta do meta:conectar) passar da guarda e estourar como FK
  -- crua 23503 em lead_sources. Mesmo `exists` que conectar_whatsapp ja tinha
  -- na 0030; restaura sem_permissao para conta inexistente.
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not (public.sou_dono_da_plataforma()
              and exists (select 1 from public.accounts a where a.id = p_account_id)) then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_url_token is null or btrim(p_url_token) = '' then
    raise exception 'segredo_vazio';
  end if;
  -- Mesmo codigo de erro do url_token: para quem esta na tela, os dois sao
  -- "o segredo saiu em branco", e a UI ja traduz segredo_vazio.
  if p_google_key is null or btrim(p_google_key) = '' then
    raise exception 'segredo_vazio';
  end if;

  insert into public.lead_sources
    (account_id, provedor, external_id, nome, responsavel_padrao_id)
  values (p_account_id, 'google', null, p_nome, p_responsavel)
  returning id into v_id;

  -- So o hash entra. O token em claro existe uma vez, no retorno da acao que o
  -- gerou, e nunca mais e recuperavel — mesmo contrato do token de convite.
  insert into public.source_credentials (source_id, url_token_hash, google_key_hash)
  values (v_id, public.hash_segredo(p_url_token), public.hash_segredo(p_google_key));

  return v_id;
end;
$$;

