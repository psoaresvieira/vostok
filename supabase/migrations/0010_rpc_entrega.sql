-- Sub-projeto 2, Plano 4: as funcoes que a rota de webhook chama SEM SESSAO.
-- Este e o primeiro caminho de escrita sem auth.uid() do projeto. A unica
-- autorizacao e o segredo de ingestao, e o ganho sobre usar service_role e
-- concreto: vazar este segredo permite injetar lead e ler token de pagina;
-- vazar a service_role permite ler e escrever todas as tabelas de todas as
-- contas, inclusive auth.

-- O portao de toda a ingestao.
--
-- NAO recebe execute para public: e chamada so de dentro das funcoes definer
-- abaixo, que rodam como postgres. Alcancavel pelo PostgREST ela seria um
-- oraculo booleano de "esse segredo esta certo?", que e exatamente o que uma
-- forca bruta precisa.
--
-- segredo_hash nulo recusa: "servidor nao registrado" e estado explicito, nao
-- buraco aberto, e e o estado em que a 0008 deixa a linha. p_segredo nulo
-- tambem recusa, porque hash_segredo(null) e null e null = qualquer coisa nunca
-- e verdadeiro.
--
-- Comparacao com `=` comum, e nao em tempo constante, de proposito: o que se
-- compara aqui e o digest hex, nao o segredo. Um canal de tempo revelaria
-- prefixo de SHA-256, e disso nao se volta ao segredo sem uma preimagem.
create or replace function public.segredo_confere(p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ingestion_config c
    where c.id
      and c.segredo_hash is not null
      and c.segredo_hash = public.hash_segredo(p_segredo)
  );
$$;

revoke execute on function public.segredo_confere(text) from public;

-- Grava PRIMEIRO, interpreta depois. A rota chama isto e responde 200 antes de
-- qualquer chamada externa: o provedor nao pode ficar esperando o Graph API, e
-- payload gravado e reprocessavel quando o mapeamento estiver errado.
--
-- Devolve o token da Page no caminho meta porque quem processa a entrega
-- precisa dele para buscar o lead no Graph, e ele mora em source_credentials,
-- que nao tem grant nenhum. Nao e oraculo de token: quem tem o segredo de
-- ingestao ja pode injetar lead em qualquer conta, entao devolver o token nao
-- amplia poder nenhum.
create or replace function public.registrar_entrega(
  p_segredo text,
  p_provedor public.provedor_lead,
  p_external_id text,
  p_payload jsonb,
  p_chave_da_fonte text,
  p_google_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source uuid;
  v_account uuid;
  v_token text;
  v_key_hash text;
  v_status public.status_entrega := 'pendente';
  v_erro text;
  v_log uuid;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id_invalido';
  end if;

  if p_provedor = 'meta' then
    -- A Page e quem resolve a conta: o webhook do Meta e do APP, nao da conta,
    -- e o payload so traz o page_id. E por isso que o indice de lead_sources e
    -- global (0008:34-44).
    select ls.id, ls.account_id, sc.meta_page_token
      into v_source, v_account, v_token
      from public.lead_sources ls
      left join public.source_credentials sc on sc.source_id = ls.id
     where ls.provedor = 'meta'
       and ls.external_id = p_chave_da_fonte
       and ls.ativo;
  else
    -- No Google nao ha identificador estavel da fonte no payload: quem resolve
    -- a conta e o token da URL, e so o hash dele existe no banco.
    select ls.id, ls.account_id, sc.google_key_hash
      into v_source, v_account, v_key_hash
      from public.source_credentials sc
      join public.lead_sources ls on ls.id = sc.source_id
     where sc.url_token_hash = public.hash_segredo(p_chave_da_fonte)
       and ls.ativo;
  end if;

  if v_source is null then
    -- Fonte desconhecida vira log ignorado, nunca erro: um 404 na rota seria
    -- oraculo de quais Pages estao conectadas ao produto. account_id fica nulo,
    -- entao esta linha e invisivel para todo tenant — e registro de operador.
    v_status := 'ignorado';
    v_erro := 'fonte_nao_encontrada';
  elsif p_provedor = 'google'
        and (v_key_hash is null
             or v_key_hash is distinct from public.hash_segredo(p_google_key)) then
    -- A URL resolveu, a chave do corpo nao bate. Aqui SABEMOS a conta, entao
    -- esta linha aparece no painel de /config — e o que transforma "configurei
    -- a chave errada no Google Ads" de misterio em diagnostico.
    --
    -- O `v_key_hash is null` NAO e redundante, e tirar essa clausula abre um
    -- fail-open: `is distinct from` com os DOIS lados nulos devolve falso, entao
    -- uma fonte sem google_key_hash configurado passaria direto por este check
    -- justamente quando a entrega tambem nao apresenta chave. A assimetria era o
    -- pior da versao anterior — sem chave passava, COM chave era recusada.
    -- Fonte sem chave configurada nao aceita entrega nenhuma. Verificado contra
    -- o Postgres: `null is distinct from hash_segredo(null)` e false.
    v_status := 'ignorado';
    v_erro := 'chave_invalida';
  elsif coalesce(p_payload ->> 'is_test', '') in ('true', 't', '1') then
    -- O botao "Enviar dados de teste" do Google. Sem isto, todo teste de
    -- configuracao sujaria o funil do cliente com um card falso.
    --
    -- Comparacao por texto, e nao cast para boolean: `(x)::boolean` levanta
    -- excecao se o provedor mandar "yes" ou "1.0", e derrubar a ingestao por
    -- causa do formato de um campo opcional seria trocar um card sujo por
    -- nenhum lead.
    v_status := 'ignorado';
    v_erro := 'lead_de_teste';
  end if;

  insert into public.integration_log
    (account_id, source_id, provedor, external_id, payload_bruto, status, erro)
  values (v_account, v_source, p_provedor, p_external_id, p_payload, v_status, v_erro)
  on conflict (provedor, external_id) do nothing
  returning id into v_log;

  if v_log is null then
    -- Reenvio do provedor, nao erro. 200 sem efeito e sem token: nao ha nada
    -- novo a processar, e devolver o token aqui deixaria a rota disparar uma
    -- segunda busca no Graph para um lead que ja existe.
    return jsonb_build_object('log_id', null, 'status', 'duplicado', 'token', null);
  end if;

  return jsonb_build_object(
    'log_id', v_log,
    'status', v_status,
    -- So no caminho que vai mesmo processar: entrega ignorada nao precisa do
    -- token, e devolve-lo seria ampliar a superficie sem uso nenhum.
    'token', case when p_provedor = 'meta' and v_status = 'pendente' then v_token end
  );
end;
$$;

-- Varredura do cron. Devolve tudo que o processamento precisa para nao ter que
-- voltar ao banco: o payload cru e, no Meta, o token da Page.
--
-- Backoff por numero de tentativas: 3^n minutos. Na pratica a janela observada
-- comeca em 3 e nao em 1, porque so registrar_falha marca 'falhou' e ela sempre
-- incrementa antes — entao toda linha que chega aqui em 'falhou' ja tem
-- tentativas >= 1. A sequencia real e 3, 9, 27 e 81 minutos. Desiste em 5:
-- alem disso a falha nao e transitoria, e retentar so gasta cota do Graph e
-- enche o log.
create or replace function public.entregas_pendentes(p_segredo text, p_limite integer)
returns table (
  log_id uuid,
  provedor public.provedor_lead,
  payload_bruto jsonb,
  token text,
  tentativas integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  -- Todas as referencias qualificadas por `l.`/`sc.`: os nomes de saida
  -- (provedor, payload_bruto, tentativas) colidem com colunas da tabela, e sem
  -- a qualificacao o plpgsql recusa por referencia ambigua.
  return query
  select l.id, l.provedor, l.payload_bruto, sc.meta_page_token, l.tentativas
    from public.integration_log l
    left join public.source_credentials sc on sc.source_id = l.source_id
   where (l.status = 'pendente' or (l.status = 'falhou' and l.tentativas < 5))
     and (
       l.ultima_tentativa_em is null
       or l.ultima_tentativa_em < now() - (interval '1 minute' * power(3, l.tentativas))
     )
   order by l.criado_em asc
   limit p_limite;
end;
$$;

-- Nao muda o status para 'falhou' sem incrementar a tentativa: e o contador que
-- entregas_pendentes usa tanto para o backoff quanto para desistir. Sem o
-- incremento, a mesma entrega quebrada voltaria a cada varredura, para sempre.
--
-- O `and status in (...)` impede que uma retentativa tardia rebaixe para
-- 'falhou' uma entrega que ja virou lead — cenario real quando o after() da
-- rota e a varredura do cron correm sobre a mesma linha.
create or replace function public.registrar_falha(
  p_segredo text,
  p_log_id uuid,
  p_erro text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  update public.integration_log
     set status = 'falhou',
         -- Truncado: mensagem de Graph API pode vir com corpo inteiro dentro, e
         -- o log e lido por tela.
         erro = left(coalesce(p_erro, 'erro_desconhecido'), 500),
         tentativas = tentativas + 1,
         ultima_tentativa_em = now()
   where id = p_log_id
     and status in ('pendente', 'falhou');
end;
$$;
