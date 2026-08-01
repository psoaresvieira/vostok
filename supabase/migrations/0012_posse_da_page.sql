-- Sub-projeto 2, Plano 4: fecha o squat de Page ID que a 0008 aceitou com dono.
--
-- O BURACO: conectar_fonte_meta provava que o chamador e admin da conta que ele
-- mesmo passou, e nada mais. p_page_id era texto arbitrario, page ids sao
-- informacao publica, e funcao no Postgres nasce com execute para public —
-- entao qualquer pessoa que fizesse signup travava a Page de um concorrente
-- para sempre, direto pelo PostgREST, sem passar por tela nenhuma. A vitima
-- recebia page_ja_conectada para sempre e nao tinha recurso: nao enxerga nem
-- apaga a linha do invasor. Risco aceito conscientemente no Plano 3, com dono
-- registrado (spec, "Risco nomeado: squat de Page ID em conectar_fonte_meta").
--
-- O CONSERTO tem duas metades, e nenhuma das duas sozinha resolve:
--
--   1. AQUI: as duas funcoes passam a exigir o segredo de ingestao. Isso nao
--      prova posse — o banco nao tem como chamar o Graph API — mas tira a RPC
--      do alcance de quem so tem uma sessao valida. So o servidor chama.
--
--   2. NA APLICACAO (src/app/(app)/config/acoes-fontes.ts): antes de chamar, a
--      Server Action pede ao Graph que confirme que aquele token administra
--      aquela Page (MetaGraph.posseDaPagina, que compara /me com o page id).
--      E o servidor que prova posse; o segredo e o que amarra a prova a chamada.
--
-- Trocar so uma das metades reabre o buraco: sem (1) qualquer um chama a RPC
-- direto, sem (2) o segredo autoriza um squat igualzinho, so que pela tela.
--
-- conectar_fonte_google NAO ganha segredo, de proposito: external_id e sempre
-- nulo la, entao o indice unico global nem alcanca essas linhas, e o token da
-- URL e gerado no servidor. Nao ha Page de terceiro a travar. A assimetria e
-- decisao registrada, com teste que a afirma.
--
-- Ela ganha OUTRA coisa, por achado do review da Task 3: validacao de
-- p_google_key. Ver o bloco dela no fim deste arquivo.

-- drop, e nao create or replace: a assinatura mudou, e replace com lista de
-- argumentos diferente CRIA UMA SOBRECARGA em vez de substituir. As duas
-- versoes conviveriam e a antiga continuaria sendo a porta aberta.
drop function public.conectar_fonte_meta(uuid, text, text, text, uuid);

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
  -- Os tres seguintes sao os da 0008, inalterados: cumulativos, nao
  -- alternativos. O segredo prova QUEM chamou; estes provam por conta de quem.
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
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

-- O caminho de reivindicacao que o portao de deploy do README exige. Quem
-- apresenta posse comprovada da Page toma a linha de quem estava la antes,
-- inclusive de outra conta — a unica saida para uma Page squattada antes desta
-- migration existir, e a razao de o portao poder ser levantado.
--
-- Apaga e reinsere, em vez de dar update no account_id: source_credentials cai
-- pelo `on delete cascade` da PK e o token do dono anterior morre junto. Um
-- update deixaria o token velho apontando para a conta nova, o que e
-- exatamente o "entregar lead para a conta errada" que tudo isto existe para
-- impedir.
--
-- integration_log sobrevive: source_id e `on delete set null` (0009) e
-- account_id fica intacto, entao o historico de entregas do dono anterior
-- continua visivel para ele.
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
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
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

-- Fecha a outra ponta do achado do review da Task 3.
--
-- A `0010` fez `registrar_entrega` recusar entrega de fonte Google cujo
-- google_key_hash seja nulo. Isto impede que essa fonte chegue a existir: sem a
-- validacao, um admin podia chamar esta funcao direto pelo PostgREST com
-- p_google_key nulo, e a linha nascia com hash nulo. A tela nunca faz isso (o
-- SupabaseFonteStore gera a chave), entao o custo aqui e zero e o ganho e que o
-- estado invalido deixa de ser representavel.
--
-- Nenhuma das duas metades bastava sozinha: so a da 0010 deixaria dado
-- inconsistente no banco, e so esta deixaria vulneravel qualquer linha criada
-- antes dela.
--
-- Assinatura inalterada (5 argumentos, sem segredo) — o teste que afirma isso
-- continua valendo.
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
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_url_token is null or btrim(p_url_token) = '' then
    raise exception 'segredo_vazio';
  end if;
  -- NOVO. Mesmo codigo de erro do url_token: para quem esta na tela, os dois
  -- sao "o segredo saiu em branco", e a UI ja traduz segredo_vazio.
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
