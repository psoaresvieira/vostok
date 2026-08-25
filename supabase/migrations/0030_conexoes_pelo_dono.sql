-- Modo operador: a implantacao de cada cliente e feita MANUALMENTE pelo dono
-- da plataforma (decisao do Pedro, 2026-08-25 — nada de UI de integracoes).
-- O dono NAO e membro das contas dos clientes (0028: uma membership dele
-- roubaria a resolucao de conta ativa), entao as seis RPCs de conexao ganham
-- na guarda de papel a alternativa `sou_dono_da_plataforma()`. TUDO O MAIS e
-- copia byte a byte da versao anterior (0012/0008/0019): segredo, sem_sessao,
-- validacoes de entrada, ordem das guardas e grants ficam como estavam.
-- `p_responsavel` continua exigindo membro da conta — regra operacional: o
-- cliente aceita o convite ANTES de o dono conectar as fontes.

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
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
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
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
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
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
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

create or replace function public.desconectar_fonte(p_source_id uuid)
returns void
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

  select account_id into v_account from public.lead_sources where id = p_source_id;
  if v_account is null then
    raise exception 'fonte_nao_encontrada';
  end if;
  if public.papel_na_conta(v_account) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  -- source_credentials cai pelo on delete cascade da PK.
  delete from public.lead_sources where id = p_source_id;
end;
$$;

create or replace function public.conectar_whatsapp(
  p_segredo text,
  p_account_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_numero_exibicao text,
  p_nome_verificado text,
  p_token text
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
  -- Diferente das outras cinco RPCs de conexao, esta nao tem backstop depois
  -- (nem e_membro_da_conta, nem um fetch previo do registro) — sem essa
  -- checagem, o bypass do dono deixaria um p_account_id inexistente escapar
  -- da guarda de papel (papel_na_conta de conta inexistente e' null) e
  -- estourar como FK crua 23503 em whatsapp_connections. Restaura o
  -- comportamento pre-0030 (sem_permissao) para conta inexistente.
  if public.papel_na_conta(p_account_id) is distinct from 'admin'
     and not (public.sou_dono_da_plataforma()
              and exists (select 1 from public.accounts a where a.id = p_account_id)) then
    raise exception 'sem_permissao';
  end if;
  if p_phone_number_id is null or btrim(p_phone_number_id) = ''
     or p_waba_id is null or btrim(p_waba_id) = ''
     or p_numero_exibicao is null or btrim(p_numero_exibicao) = ''
     or p_nome_verificado is null or btrim(p_nome_verificado) = ''
     or p_token is null or btrim(p_token) = '' then
    raise exception 'whatsapp_campos_vazios';
  end if;

  begin
    insert into public.whatsapp_connections
      (account_id, phone_number_id, waba_id, numero_exibicao, nome_verificado)
    values (p_account_id, p_phone_number_id, p_waba_id,
            p_numero_exibicao, p_nome_verificado)
    returning id into v_id;
  exception
    when unique_violation then
      -- Dois indices unicos podem estourar; distinguir pelo ESTADO, nao pelo
      -- nome do indice no texto do erro. Conta primeiro: se os dois valem, a
      -- mensagem acionavel para quem esta na tela e "voce ja tem um numero".
      if exists (
        select 1 from public.whatsapp_connections wc
         where wc.account_id = p_account_id
      ) then
        raise exception 'whatsapp_ja_conectado';
      end if;
      raise exception 'numero_ja_conectado';
  end;

  insert into public.whatsapp_credentials (connection_id, token)
  values (v_id, p_token);

  return v_id;
end;
$$;

create or replace function public.desconectar_whatsapp(
  p_segredo text,
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  select account_id into v_account
    from public.whatsapp_connections
   where id = p_connection_id;
  if v_account is null then
    raise exception 'whatsapp_nao_encontrado';
  end if;
  -- Mesma matriz do desconectar_fonte (0008): id e uuid gerado, nao
  -- identificador publico — sem_permissao aqui nao vaza nada util.
  if public.papel_na_conta(v_account) is distinct from 'admin'
     and not public.sou_dono_da_plataforma() then
    raise exception 'sem_permissao';
  end if;

  -- whatsapp_credentials cai pelo on delete cascade da PK.
  delete from public.whatsapp_connections where id = p_connection_id;
end;
$$;
