-- Sub-projeto 3: rastreamento de origem ate o nivel do anuncio.
--
-- Por que as duas colunas antigas saem em vez de ficarem: campanha_origem
-- guardava coisas DIFERENTES por provedor — o nome da campanha no Meta
-- (campaign{name}) e o id numerico no Google (String(payload.campaign_id)).
-- Agrupar por ela na metrica mostraria "Black November" numa linha e
-- "123456789" na outra. Enquanto a coluna existir, alguem volta a escrever
-- nela.
--
-- Por que id E nome: a metrica agrupa pelo ID, porque renomear campanha no
-- gerenciador do Meta e rotina e partiria o historico em duas linhas; e exibe
-- o NOME, escolhendo o do lead mais recente daquele id. Nome nulo e estado
-- legitimo e permanente para o Google, que nunca manda nome — resolver
-- exigiria a Google Ads API com developer token.
--
-- Nao ha backfill porque nao ha dado: nada deste projeto foi para producao
-- ainda (webhook nunca verificado no painel do Meta, sem URL publica,
-- META_APP_ID vazio).

alter table public.leads
  drop column campanha_origem,
  drop column formulario_origem,
  add column campanha_id    text,
  add column campanha_nome  text,
  add column conjunto_id    text,
  add column conjunto_nome  text,
  add column anuncio_id     text,
  add column anuncio_nome   text,
  add column formulario_id  text,
  -- gcl_id do Google. Nao e lido por nada hoje: entra porque chega de graca
  -- no payload e e a unica chave que um dia fecha o laco de conversao offline
  -- de volta no Google Ads. Capturar depois e impossivel para o lead que ja
  -- passou.
  add column click_id       text;

-- Sem grant novo: as colunas herdam o privilegio e a RLS de public.leads, que
-- ja e pode_ver_lead. Sem tabela nova, nao ha armadilha de default ACL aqui.

-- A metrica agrupa por campanha_id dentro de origem. Sem indice, cada carga
-- da aba varre a conta inteira.
create index leads_account_campanha_idx on public.leads (account_id, campanha_id);

-- ingerir_lead precisa ser recriada porque o insert dela nomeia as colunas
-- que acabaram de sair. A assinatura NAO muda (p_segredo text, p_log_id uuid,
-- p_dados jsonb), entao `create or replace` de fato substitui. Se algum dia a
-- lista de argumentos mudar, sera preciso `drop function` com a assinatura
-- antiga antes: `create or replace` com argumentos diferentes cria uma
-- SOBRECARGA e as duas versoes convivem — foi o que a 0012 teve que tratar.
--
-- Corpo copiado de supabase/migrations/0011_ingerir_lead.sql, alterando
-- APENAS o `insert into public.leads` para gravar as oito colunas de
-- rastreamento no lugar de campanha_origem/formulario_origem. Todo o resto
-- (e_membro_da_conta reafirmado nos dois ramos, o `for update` que serializa
-- a entrega, o coalesce do nome, a dedup, as notifications) e identico a
-- 0011 — nao reescrito de memoria.
create or replace function public.ingerir_lead(
  p_segredo text,
  p_log_id uuid,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.integration_log;
  v_account uuid;
  v_resp_padrao uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_tel text;
  v_email text;
  v_lead uuid;
  v_dono uuid;
  v_evento jsonb;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  -- `for update` serializa a entrega. O after() da rota e a varredura do cron
  -- podem pegar a mesma linha ao mesmo tempo, e sem a trava as duas passariam
  -- pelo teste de status e criariam um card cada.
  select * into v_log from public.integration_log where id = p_log_id for update;
  if v_log.id is null then
    raise exception 'log_nao_encontrado';
  end if;

  -- 'falhou' entra junto de 'pendente' de proposito: e o estado que o cron
  -- reprocessa. 'processado' e 'ignorado' caem no ja_processado, que e a
  -- idempotencia que a spec pede.
  if v_log.status not in ('pendente', 'falhou') then
    return jsonb_build_object('status', 'ja_processado', 'lead_id', v_log.lead_id);
  end if;
  if v_log.source_id is null then
    raise exception 'fonte_nao_encontrada';
  end if;

  select ls.account_id, ls.responsavel_padrao_id
    into v_account, v_resp_padrao
    from public.lead_sources ls
   where ls.id = v_log.source_id;

  -- A RLS nao nos alcanca aqui, entao o with check da 0007 tambem nao. Sem esta
  -- reafirmacao, um responsavel padrao que saiu da conta (membership revogada
  -- depois de a fonte ter sido configurada) produziria lead invisivel para todo
  -- vendedor — leads_select exige responsavel_id = auth.uid() para vendedor —
  -- e sem erro nenhum. E exatamente o backlog #4 voltando por outra porta.
  -- Nulo e o destino certo: e o estado legitimo da fila que gestor e admin veem.
  if not public.e_membro_da_conta(v_account, v_resp_padrao) then
    v_resp_padrao := null;
  end if;

  select p.id into v_pipeline
    from public.pipelines p
   where p.account_id = v_account and p.is_default;
  if v_pipeline is null then
    raise exception 'pipeline_nao_encontrado';
  end if;

  -- Primeira etapa ABERTA, e nao `ordem = 1`. Se a conta reordenar e puser uma
  -- etapa de ganho na frente, `ordem = 1` poria o lead na coluna Ganho — e
  -- `leads.status` NAO acompanharia, porque ele so muda dentro de
  -- move_lead_stage e o default da coluna e 'aberto'. O resultado seria um card
  -- na coluna de Ganho com status 'aberto': dessincronizado, contando como
  -- ganho em toda leitura por etapa e como aberto em toda leitura por status —
  -- e, de quebra, elegivel a dedup para sempre.
  select s.id into v_stage
    from public.stages s
   where s.pipeline_id = v_pipeline and s.tipo = 'aberta'
   order by s.ordem asc
   limit 1;
  if v_stage is null then
    raise exception 'etapa_invalida';
  end if;

  v_tel := nullif(btrim(coalesce(p_dados ->> 'telefone_e164', '')), '');
  v_email := nullif(btrim(coalesce(p_dados ->> 'email_norm', '')), '');

  -- O que a timeline vai contar. `extras` sao os campos do formulario que
  -- nenhum mapeador conhece — as perguntas de qualificacao que o cliente
  -- escreveu. Sao o motivo de o payload cru nunca ser descartado.
  v_evento := jsonb_build_object(
    'provedor', v_log.provedor,
    'external_id', v_log.external_id,
    'campanha', p_dados ->> 'campanha_origem',
    'formulario', p_dados ->> 'formulario_origem',
    'extras', coalesce(p_dados -> 'extras', '{}'::jsonb)
  );

  -- Dedup so contra lead ABERTO, e e por isso que isto nunca virou constraint
  -- unica: com o card sendo o Lead, recompra e lead novo. Lead ganho ou perdido
  -- nao conta.
  if v_tel is not null or v_email is not null then
    select l.id, l.responsavel_id
      into v_lead, v_dono
      from public.leads l
     where l.account_id = v_account
       and l.status = 'aberto'
       and (
         (v_tel is not null and l.telefone_e164 = v_tel)
         or (v_email is not null and l.email_norm = v_email)
       )
     -- `l.id desc` como desempate, e nao so criado_em: duas leads abertas com o
     -- mesmo telefone existem (cadastro manual nao bloqueia duplicata), e sem
     -- criterio de desempate qual delas recebe o evento de reingestao e quem e
     -- notificado ficam por conta do plano de execucao. E o mesmo defeito que a
     -- 0006 corrigiu em lead_events com a coluna seq; aqui `id` ja serve, so
     -- precisa estar escrito.
     order by l.criado_em desc, l.id desc
     limit 1;
  end if;

  if v_lead is not null then
    insert into public.lead_events (lead_id, tipo, payload, ator_id)
    values (v_lead, 'reingestao', v_evento, null);

    -- Mesmo guard de v_resp_padrao la em cima (linha ~64), e pelo mesmo
    -- motivo: a RLS nao alcanca SECURITY DEFINER, entao o with check da 0007
    -- tambem nao. Aqui o risco e mais direto ainda -- v_dono vem de
    -- leads.responsavel_id de um lead JA EXISTENTE, e nada nulifica essa
    -- coluna quando a membership e revogada (a 0007 so limpou o estado
    -- existente uma vez, na propria migration; dali em diante o invariante
    -- vive so no with check de policy, que codigo definer nunca avalia). Um
    -- admin remove um vendedor da conta, o lead aberto dele continua
    -- apontando pra ele, a mesma pessoa preenche o formulario nao mais, e sem
    -- este guard o ex-membro receberia uma notification 'lead_reincidente' de
    -- uma conta da qual ele nao faz mais parte -- e notifications_dono_select
    -- e so `usuario_id = auth.uid()`, sem escopo de conta nenhum, entao ela
    -- apareceria no sino dele, vazando o UUID do lead e o fato de ter havido
    -- reingestao numa conta que ele nao integra mais.
    if not public.e_membro_da_conta(v_account, v_dono) then
      v_dono := null;
    end if;

    -- Notifica quem ja cuida do lead, e nao o responsavel padrao da fonte: e
    -- essa pessoa que precisa saber que a mesma pessoa voltou.
    if v_dono is not null then
      insert into public.notifications (account_id, usuario_id, lead_id, tipo)
      values (v_account, v_dono, v_lead, 'lead_reincidente');
    end if;

    update public.integration_log
       set status = 'processado',
           lead_id = v_lead,
           processado_em = now(),
           ultima_tentativa_em = now(),
           erro = null
     where id = p_log_id;

    return jsonb_build_object('status', 'reincidente', 'lead_id', v_lead);
  end if;

  insert into public.leads (
    account_id, nome, telefone, telefone_e164, email, email_norm, empresa,
    origem, campanha_id, campanha_nome, conjunto_id, conjunto_nome,
    anuncio_id, anuncio_nome, formulario_id, click_id,
    pipeline_id, stage_id, responsavel_id
  ) values (
    v_account,
    -- leads.nome e not null. Perder o lead por falta de nome seria o pior
    -- desfecho possivel: o payload cru fica no log, e o nome se corrige depois.
    coalesce(nullif(btrim(coalesce(p_dados ->> 'nome', '')), ''), 'Lead sem nome'),
    p_dados ->> 'telefone',
    v_tel,
    p_dados ->> 'email',
    v_email,
    p_dados ->> 'empresa',
    -- provedor_lead e lead_origem sao enums diferentes com os mesmos rotulos
    -- 'meta' e 'google'; o cast tem que passar por text.
    v_log.provedor::text::public.lead_origem,
    p_dados ->> 'campanha_id',
    p_dados ->> 'campanha_nome',
    p_dados ->> 'conjunto_id',
    p_dados ->> 'conjunto_nome',
    p_dados ->> 'anuncio_id',
    p_dados ->> 'anuncio_nome',
    p_dados ->> 'formulario_id',
    p_dados ->> 'click_id',
    v_pipeline, v_stage, v_resp_padrao
  ) returning id into v_lead;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (v_lead, null, v_stage, null);

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (v_lead, 'criado_por_webhook', v_evento, null);

  if v_resp_padrao is not null then
    insert into public.notifications (account_id, usuario_id, lead_id, tipo)
    values (v_account, v_resp_padrao, v_lead, 'novo_lead');
  end if;

  update public.integration_log
     set status = 'processado',
         lead_id = v_lead,
         processado_em = now(),
         ultima_tentativa_em = now(),
         erro = null
   where id = p_log_id;

  return jsonb_build_object('status', 'criado', 'lead_id', v_lead);
end;
$$;
