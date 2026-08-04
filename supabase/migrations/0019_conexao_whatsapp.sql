-- Conexao do WhatsApp Cloud API, uma por conta. Spec:
-- docs/superpowers/specs/2026-08-03-crm-conexao-whatsapp-design.md
--
-- WhatsApp NAO e fonte de lead — e canal de saida. Por isso tabela propria,
-- e nao uma linha em lead_sources: o enum provedor_lead e castado para
-- lead_origem na ingestao, e todo caminho que ramifica por provedor teria que
-- aprender a ignorar 'whatsapp'.
--
-- O padrao de seguranca e o da 0008/0012, replicado e nao reinventado:
-- credencial em tabela gemea SEM GRANT, escrita so por RPC security definer
-- que exige o segredo de ingestao E a sessao de admin, cumulativos.

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number_id text not null,
  waba_id text not null,
  numero_exibicao text not null,
  nome_verificado text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um numero por conta (decisao de MVP declarada na spec): relaxar isto um dia
-- e trocar um indice, nao reescrever o modelo.
create unique index whatsapp_connections_account_idx
  on public.whatsapp_connections (account_id);

-- Unico GLOBAL, como o page_id em lead_sources e pelo mesmo motivo, so que
-- olhando para a frente: o webhook de resposta (fase 2 do sub-projeto 5)
-- resolve a conta pelo numero. Dois tenants com o mesmo numero seria
-- ambiguidade sem desempate — falhar na conexao com mensagem clara e melhor.
create unique index whatsapp_connections_numero_idx
  on public.whatsapp_connections (phone_number_id);

-- Tabela gemea sem grant, como source_credentials: se o token fosse coluna da
-- tabela de cima, qualquer select * da tela o traria para o payload RSC.
create table public.whatsapp_credentials (
  connection_id uuid primary key
    references public.whatsapp_connections(id) on delete cascade,
  token text not null,
  atualizado_em timestamptz not null default now()
);

-- Grant so de select na tabela de conexoes; insert e delete passam pelas RPCs.
-- Nas credenciais, NENHUM grant, e RLS ligada sem policy — cinto e
-- suspensorio: um grant acidental numa migration futura nao pode abrir a
-- tabela.
grant select on public.whatsapp_connections to authenticated;

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_credentials enable row level security;

-- So admin ve a conexao: e configuracao da conta, como lead_sources.
create policy whatsapp_connections_admin_select on public.whatsapp_connections
  for select using (public.papel_na_conta(account_id) = 'admin');

-- SECURITY DEFINER exigindo o segredo de ingestao, o padrao da 0012:
-- o segredo prova QUEM chamou (so o servidor o tem); sessao e papel provam
-- POR CONTA DE QUEM. Cumulativos, nao alternativos. A validacao de que o
-- token realmente le o numero acontece ANTES, na Server Action, contra o
-- Graph (WhatsAppGraph.dadosDoNumero) — o banco nao tem como chamar o Graph,
-- entao o segredo e o que amarra aquela prova a esta escrita.
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
  if public.papel_na_conta(p_account_id) is distinct from 'admin' then
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
  if public.papel_na_conta(v_account) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- whatsapp_credentials cai pelo on delete cascade da PK.
  delete from public.whatsapp_connections where id = p_connection_id;
end;
$$;

-- O CONTRATO DO SUB-PROJETO 5. Sem check de sessao, DELIBERADAMENTE: quem
-- chama e o servidor (a Server Action do disparo), que se identifica pelo
-- segredo — mesmo desenho de registrar_entrega/ingerir_lead. Se o token
-- fosse alcancavel por sessao, a tabela sem grant nao estaria protegendo
-- nada. Nao acrescente auth.uid() aqui achando que e endurecimento: e o
-- disparo por cron (sem sessao nenhuma) que voce estaria quebrando.
create or replace function public.credencial_whatsapp(
  p_segredo text,
  p_account_id uuid
)
returns table (token text, phone_number_id text, waba_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  return query
    select cr.token, wc.phone_number_id, wc.waba_id
      from public.whatsapp_connections wc
      join public.whatsapp_credentials cr on cr.connection_id = wc.id
     where wc.account_id = p_account_id;
  if not found then
    raise exception 'whatsapp_nao_encontrado';
  end if;
end;
$$;

-- Grant explicito de execute, como a 0014 faz: redundante se o default ACL
-- de funcao conceder public, inofensivo se nao conceder — e a chamada nunca
-- morre em permission denied por causa da imagem do Postgres.
grant execute on function public.conectar_whatsapp(text, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.desconectar_whatsapp(text, uuid) to authenticated;
grant execute on function public.credencial_whatsapp(text, uuid) to authenticated;
