-- Sub-projeto 2, Plano 3: as fontes de lead que uma conta conectou.
-- Spec: docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md

create type public.provedor_lead as enum ('meta', 'google');

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provedor public.provedor_lead not null,
  external_id text,
  nome text not null,
  responsavel_padrao_id uuid references public.profiles(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- O grant abaixo ja restringe update de authenticated a colunas que nao
  -- incluem external_id/provedor, mas o check fica na tabela como a garantia
  -- de verdade: vale tambem para as funcoes SECURITY DEFINER e para qualquer
  -- migration futura que amplie o grant sem revisar isto. Sem ele, anular
  -- external_id de uma fonte meta a tira do indice unico global sem soltar a
  -- Page, e trocar provedor cria uma linha meta com external_id nulo que
  -- nenhum caminho de codigo espera. Nomeada (em vez do automatico
  -- lead_sources_check) porque conectar_fonte_meta precisa reconhecer o nome
  -- para traduzir a violacao em page_id_invalido, no mesmo padrao de
  -- unique_violation -> page_ja_conectada. String vazia entra no mesmo check
  -- que nulo: '' passaria em "is not null" e ainda assim participaria do
  -- indice unico global com uma chave sem sentido.
  constraint lead_sources_meta_tem_external_id
    check (provedor <> 'meta' or (external_id is not null and external_id <> ''))
);

-- Unico GLOBAL, nao por conta. O webhook do Meta e do app, nao da conta, e o
-- payload traz apenas o page_id: se duas contas reivindicassem a mesma Page, o
-- lead chegaria sem criterio de desempate. Falhar na conexao, com mensagem
-- clara, e melhor do que entregar lead para a conta errada.
--
-- Parcial (where external_id is not null) porque o Google nao tem identificador
-- estavel de fonte no payload — quem resolve a conta la e o token da URL. O
-- indice ignora essas linhas, e varias fontes Google convivem na mesma conta.
create unique index lead_sources_provedor_external_idx
  on public.lead_sources (provedor, external_id)
  where external_id is not null;

create index lead_sources_account_idx on public.lead_sources (account_id);

-- Tabela separada, e nao colunas em lead_sources, porque ela NAO recebe grant.
-- Se o token fosse coluna da tabela acima, qualquer `select *` da tela o traria
-- para o payload RSC — a mesma armadilha que o tipo Convite em admin.ts ja
-- documenta para o token de convite.
create table public.source_credentials (
  source_id uuid primary key references public.lead_sources(id) on delete cascade,
  meta_page_token text,
  token_expira_em timestamptz,
  google_key_hash text,
  url_token_hash text,
  atualizado_em timestamptz not null default now()
);

-- O webhook do Google resolve a conta por este hash, entao ele precisa ser
-- inequivoco entre todas as contas.
create unique index source_credentials_url_token_idx
  on public.source_credentials (url_token_hash)
  where url_token_hash is not null;

-- Linha unica: o check garante que so existe a linha `true`.
--
-- NENHUMA funcao exposta a aplicacao escreve segredo_hash, e isso e deliberado.
-- A linha nasce nula e fica nula ao fim do Plano 3. O segredo de ingestao e
-- configuracao de OPERADOR, nao dado de tenant: ele existe para o servidor
-- provar que a chamada veio dele, antes de qualquer conta ser resolvida. Quem le
-- esse campo e o Plano 4 (rotas de webhook), e e la que entram a semeadura em
-- desenvolvimento e a definicao por SQL no painel em producao.
--
-- A primeira versao desta migration tinha uma RPC
-- `definir_segredo_ingestao(p_account_id, p_segredo)` gateada em
-- `papel_na_conta(p_account_id) = 'admin'`. Era falha de isolamento entre
-- contas: esta tabela e global, e no produto qualquer pessoa cria a propria
-- conta por signup e nasce admin dela — logo qualquer cliente podia sobrescrever
-- o segredo de todos os tenants e derrubar a ingestao alheia. O p_account_id
-- dava aparencia de escopo a uma operacao sem escopo. Nao reintroduza.
create table public.ingestion_config (
  id boolean primary key default true check (id),
  segredo_hash text,
  atualizado_em timestamptz not null default now()
);
insert into public.ingestion_config (id, segredo_hash) values (true, null);

-- GRANTS
--
-- lead_sources: select completo, update restrito as colunas que a tela de
-- Integracoes precisa escrever direto: nome, responsavel_padrao_id e ativo
-- (edicao manual da fonte) e atualizado_em (o definirResponsavel da Task 7
-- carimba a hora junto com a troca de responsavel — sem a coluna aqui esse
-- update morre com permission denied assim que a Task 7 existir). provedor e
-- external_id ficam de fora do update de proposito: o `with check` da policy
-- abaixo so valida papel e responsavel, entao sem essa restricao de coluna um
-- admin podia, direto pelo PostgREST, anular external_id (tirando a fonte do
-- indice unico global sem soltar o token da Page) ou trocar provedor (criando
-- uma linha meta com external_id nulo). Nenhuma dessas duas colunas carrega
-- risco equivalente: um admin carimbar a propria atualizado_em nao e
-- diferente de qualquer outra escrita nela. O check da tabela cobre a mesma
-- garantia de external_id/provedor por baixo, como segunda linha de defesa.
-- Insert e delete NAO tem grant — passam pelas funcoes abaixo, as unicas que
-- sabem escrever a credencial junto, na mesma transacao.
--
-- source_credentials e ingestion_config: nenhum grant, de proposito. Sem
-- privilegio a RLS nem chega a ser avaliada e o erro e `permission denied`, que
-- e o que os testes asseguram. As funcoes SECURITY DEFINER rodam como postgres
-- e nao dependem desse ACL.
grant select, update (nome, responsavel_padrao_id, ativo, atualizado_em) on public.lead_sources to authenticated;

alter table public.lead_sources enable row level security;
alter table public.source_credentials enable row level security;
alter table public.ingestion_config enable row level security;

-- Fonte e configuracao da conta: so admin ve e mexe. Vendedor e gestor nao tem
-- o que fazer aqui — o responsavel padrao aparece para eles pelo lead, nunca
-- pela fonte.
create policy lead_sources_admin_select on public.lead_sources
  for select using (public.papel_na_conta(account_id) = 'admin');
create policy lead_sources_admin_update on public.lead_sources
  for update using (public.papel_na_conta(account_id) = 'admin')
  with check (
    public.papel_na_conta(account_id) = 'admin'
    and public.e_membro_da_conta(account_id, responsavel_padrao_id)
  );

-- Nenhuma policy em source_credentials e ingestion_config: RLS ligada sem
-- policy nega tudo, e o grant ausente ja nega antes. Cinto e suspensorio,
-- porque um grant acidental numa migration futura nao pode abrir a tabela.

-- FUNCOES
--
-- sha256 e nativo do Postgres desde a 11: nenhuma extensao nova.
create or replace function public.hash_segredo(p_valor text)
returns text
language sql
immutable
as $$
  select encode(sha256(p_valor::bytea), 'hex');
$$;

-- Esta funcao prova que o chamador e admin da conta que ele mesmo passou, mas
-- NAO prova que ele controla p_page_id — risco nomeado e com dono, aceito
-- conscientemente para o Plano 3, no README de riscos da spec (secao "Por que
-- unique (provedor, external_id) e global", em
-- docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md). Nao
-- "consertar" aqui sem ler aquela secao primeiro.
create or replace function public.conectar_fonte_meta(
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
      -- O indice global e a unica unicidade possivel aqui; traduzir para um
      -- codigo que a UI saiba explicar, em vez de vazar o nome do indice.
      raise exception 'page_ja_conectada';
    when check_violation then
      -- lead_sources_meta_tem_external_id: p_page_id nulo ou vazio. Mesmo
      -- tratamento do unique_violation acima — a UI nao deveria ver o nome
      -- cru da constraint.
      raise exception 'page_id_invalido';
  end;

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
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;
  if not public.e_membro_da_conta(p_account_id, p_responsavel) then
    raise exception 'responsavel_invalido';
  end if;
  if p_url_token is null or btrim(p_url_token) = '' then
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
  if public.papel_na_conta(v_account) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- source_credentials cai pelo on delete cascade da PK.
  delete from public.lead_sources where id = p_source_id;
end;
$$;
