-- Plano 15: gestao de etapas por membro + hardening de stages.
--
-- A 0025 abriu a escrita de stages a membro com uma policy for all sem
-- guardas — qualquer membro, via PostgREST cru, apagava a ultima etapa
-- 'aberta' (quebra a ingestao Meta/Google) ou trocava tipo/pipeline_id de
-- uma etapa (corrompe funil, metricas e o snapshot da 0016). As guardas da
-- 0018 viviam so dentro das RPCs, antes backstopeadas pela RLS admin-only
-- que a 0025 removeu. Este arquivo poe os invariantes na propria RLS e abre
-- as RPCs a qualquer membro (decisao de produto, 2026-08-17).
--
-- Helpers definer por dois motivos que nao sao conveniencia (guarda 5 da
-- memoria supabase-guardas-silenciosas): subquery de stages dentro de policy
-- de stages recursaria (RLS reentrando na propria tabela), e subquery de
-- leads rodaria sob a RLS do chamador — vendedor nao enxerga lead de colega
-- e a guarda mentiria. Fail-closed em todos: nao-membro (e id inexistente)
-- recebe a resposta que RECUSA a operacao, constante, fechando a sonda
-- cross-account de um boolean.

-- Mesma assinatura da 0025: create or replace substitui de verdade (guarda 3
-- nao se aplica — a lista de argumentos e identica).
create or replace function public.pipeline_tem_leads(p_pipeline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (not public.is_member_of(public.conta_do_pipeline(p_pipeline_id)))
      or exists (select 1 from public.leads l where l.pipeline_id = p_pipeline_id);
$$;

create or replace function public.etapa_tem_leads(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (not public.is_member_of(public.conta_do_pipeline(
            (select s.pipeline_id from public.stages s where s.id = p_stage_id))))
      or exists (select 1 from public.leads l where l.stage_id = p_stage_id);
$$;

-- coalesce(true): etapa inexistente devolve true ("e a ultima") em vez de
-- null — na policy de delete o null ja recusaria, mas a chamada direta via
-- PostgREST tambem deve responder a constante fechada.
create or replace function public.etapa_ultima_do_tipo(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (not public.is_member_of(public.conta_do_pipeline(s.pipeline_id)))
         or (select count(*)
               from public.stages irmas
              where irmas.pipeline_id = s.pipeline_id
                and irmas.tipo = s.tipo) <= 1
       from public.stages s
      where s.id = p_stage_id),
    true);
$$;

-- Compara a linha proposta (new) com a atual. O with check avalia a linha
-- NOVA; esta funcao le a tabela sob o snapshot do statement, que ainda ve a
-- versao antiga — e' exatamente a comparacao old vs new que a policy nao
-- sabe escrever sozinha. Linha inexistente (id trocado no proprio update)
-- devolve null, e null no with check recusa. O is_member_of na frente e'
-- o fail-closed: sem ele a funcao era um oraculo cross-account (devolvia o
-- booleano REAL para nao-membro, confirmando tipo e par stage/pipeline de
-- etapa alheia — achado do review da Task 1, emenda de 2026-08-17). Para
-- nao-membro a resposta agora e' a constante false, que no with check
-- recusa. O coalesce(false) cobre id inexistente com a MESMA constante
-- (segunda emenda, review final: null vs false distinguia "esse uuid e'
-- uma stage" para nao-membro — os outros helpers ja respondiam constante
-- ate para id inexistente, este era o unico que nao).
create or replace function public.etapa_imutaveis_ok(
  p_stage_id uuid,
  p_tipo public.stage_tipo,
  p_pipeline_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.is_member_of(public.conta_do_pipeline(s.pipeline_id))
        and s.tipo = p_tipo
        and s.pipeline_id = p_pipeline_id
       from public.stages s
      where s.id = p_stage_id),
    false);
$$;

-- Guarda 7: default ACL da EXECUTE a PUBLIC em funcao nova. Revoke + grant
-- explicito, e o mapa em 0024_sweep_grants_rpc.test.ts ganha as tres
-- entradas. (pipeline_tem_leads ja tem os grants da 0025; replace de corpo
-- nao mexe em ACL.)
revoke execute on function public.etapa_tem_leads(uuid) from public;
grant execute on function public.etapa_tem_leads(uuid) to authenticated;
revoke execute on function public.etapa_ultima_do_tipo(uuid) from public;
grant execute on function public.etapa_ultima_do_tipo(uuid) to authenticated;
revoke execute on function public.etapa_imutaveis_ok(uuid, public.stage_tipo, uuid) from public;
grant execute on function public.etapa_imutaveis_ok(uuid, public.stage_tipo, uuid) to authenticated;

-- A for all da 0025 vira tres policies com os invariantes nas clausulas.
-- Violacao de with check (update) estoura 42501; delete barrado pelo using
-- e' no-op de 0 linhas — para o PostgREST cru qualquer um dos dois basta,
-- e a superficie do produto continua recebendo os erros nomeados das RPCs.
drop policy stages_membro_write on public.stages;

create policy stages_membro_insert on public.stages
  for insert with check (public.is_member_of(public.conta_do_pipeline(pipeline_id)));

create policy stages_membro_update on public.stages
  for update using (public.is_member_of(public.conta_do_pipeline(pipeline_id)))
  with check (
    public.is_member_of(public.conta_do_pipeline(pipeline_id))
    and public.etapa_imutaveis_ok(id, tipo, pipeline_id)
  );

-- Etapa com leads dentro nao precisa de guarda aqui: leads.stage_id e'
-- NOT NULL / NO ACTION e estoura 23503 antes de qualquer linha sumir.
create policy stages_membro_delete on public.stages
  for delete using (
    public.is_member_of(public.conta_do_pipeline(pipeline_id))
    and not public.etapa_ultima_do_tipo(id)
  );

-- A policy sozinha NAO segura delete em LOTE (achado do review da Task 1,
-- emenda de 2026-08-17): o using avalia linha a linha contra o snapshot do
-- statement, entao num "delete ... where tipo = 'aberta'" cada uma das N
-- abertas ainda ve as outras N-1 vivas, todas passam juntas, e a pipeline
-- fica sem etapa 'aberta' num unico statement cru — exatamente o dano que
-- este arquivo diz prevenir. O trigger de statement abaixo fecha o lote:
-- roda DEPOIS do delete, ve o estado final, e aborta se alguma pipeline
-- afetada ficou sem etapas de um tipo que ela tinha. A condicao "pipeline
-- ainda existe" deixa passar o cascade legitimo de excluir a pipeline
-- inteira (on delete cascade da 0002). Corrida entre dois deletes
-- concorrentes de etapas irmas continua teoricamente possivel (cada
-- trigger ve o uncommitted do outro como vivo) — estritamente melhor que
-- antes, registrado, fora de escopo fechar.
create or replace function public.guarda_ultima_etapa_do_tipo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from (select distinct a.pipeline_id, a.tipo from apagadas a) x
     where exists (select 1 from public.pipelines p where p.id = x.pipeline_id)
       and not exists (
         select 1
           from public.stages s
          where s.pipeline_id = x.pipeline_id
            and s.tipo = x.tipo
       )
  ) then
    raise exception 'ultima_etapa_do_tipo';
  end if;
  return null;
end;
$$;

-- Guarda 7: funcao interna (trigger nao checa EXECUTE ao disparar) — revoke
-- sem grant nenhum, e entrada { anon: false, authenticated: false } no mapa
-- da 0024.
revoke execute on function public.guarda_ultima_etapa_do_tipo() from public;

create trigger stages_guarda_ultima_do_tipo
  after delete on public.stages
  referencing old table as apagadas
  for each statement
  execute function public.guarda_ultima_etapa_do_tipo();

-- RPCs abertas a membro. Mesmas assinaturas — create or replace substitui
-- (guarda 3 nao se aplica). Continuam SECURITY INVOKER (excluir/reordenar):
-- definer desligaria a RLS de stages e qualquer membro apagaria etapa de
-- outra conta — o caso de prosecdef no teste da 0026 transforma isso em
-- assercao, como o da 0018 fazia.

create or replace function public.excluir_etapa(p_stage_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stage public.stages;
  v_mesmo_tipo bigint;
begin
  -- Leitura SEM lock primeiro, de proposito: sob RLS, SELECT ... FOR UPDATE
  -- exige que a linha passe TAMBEM pela policy de update — com o lock aqui,
  -- quem nao passa na policy receberia "nao existe" para uma etapa que
  -- enxerga na tela. Quem nao enxerga a linha nem por select (outra conta)
  -- recebe "nao existe" — e nao "sem permissao", de proposito: nao vaza que
  -- o id e' real.
  select * into v_stage from public.stages where id = p_stage_id;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- Desde a 0026 qualquer membro exclui (nao so admin). A guarda explicita
  -- fica: e' redundante com stages_select hoje, mas auto-documenta e segura
  -- o dia em que a policy de select mudar sem esta funcao acompanhar.
  if not public.is_member_of(public.conta_do_pipeline(v_stage.pipeline_id)) then
    raise exception 'sem_permissao';
  end if;

  -- Agora sim o lock: o chamador passa na policy de update (membro), entao
  -- a linha volta. Serializa contra outra exclusao/reordenacao da mesma
  -- etapa. A etapa pode ter sumido entre as duas leituras — dai o recheck.
  select * into v_stage from public.stages where id = p_stage_id for update;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- Guarda 1: lead dentro — pelo helper definer, NAO por contagem local.
  -- Sob a RLS do chamador um vendedor nao enxerga lead de colega: a
  -- contagem daria zero para etapa cheia e a recusa viria da FK como 23503
  -- cru (mesmo ponto cego que o review do Plano 14 pegou em
  -- excluirPipeline). leads.stage_id continua NOT NULL / NO ACTION: se um
  -- lead entrar entre esta checagem e o delete, a FK estoura 23503 e o
  -- store traduz para o mesmo etapa_tem_leads.
  if public.etapa_tem_leads(p_stage_id) then
    raise exception 'etapa_tem_leads';
  end if;

  -- Guarda 2: ultima etapa do tipo. Sem etapa 'aberta' a ingestao do Meta e
  -- do Google nao teria onde por lead; a regra vale para os tres tipos.
  -- (A policy de delete da 0026 repete esta guarda como backstop do caminho
  -- cru — aqui ela vive para dar o erro nomeado.)
  select count(*) into v_mesmo_tipo
    from public.stages s
   where s.pipeline_id = v_stage.pipeline_id
     and s.tipo = v_stage.tipo;
  if v_mesmo_tipo <= 1 then
    raise exception 'ultima_etapa_do_tipo';
  end if;

  -- Exclusao real. O historico sobrevive pelo snapshot da 0016; as FKs de
  -- stage_history e lead_tags viram null via on delete set null.
  delete from public.stages where id = p_stage_id;
end;
$$;

create or replace function public.reordenar_etapas(p_ids_na_ordem uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pipelines uuid[];
  v_pipeline uuid;
  v_total bigint;
  v_distintos bigint;
  v_encontrados bigint;
begin
  if p_ids_na_ordem is null or coalesce(array_length(p_ids_na_ordem, 1), 0) = 0 then
    raise exception 'ordem_invalida';
  end if;

  -- Todos os ids tem que resolver para UM pipeline visivel. Id de outra conta
  -- e invisivel pela RLS, entao cai aqui como permutacao que nao fecha.
  select array_agg(distinct s.pipeline_id) into v_pipelines
    from public.stages s
   where s.id = any (p_ids_na_ordem);
  if v_pipelines is null or array_length(v_pipelines, 1) <> 1 then
    raise exception 'ordem_invalida';
  end if;
  v_pipeline := v_pipelines[1];

  -- Desde a 0026 qualquer membro reordena (nao so admin). Redundante com a
  -- visibilidade acima, e deliberada — mesmo racional de excluir_etapa.
  if not public.is_member_of(public.conta_do_pipeline(v_pipeline)) then
    raise exception 'sem_permissao';
  end if;

  -- Serializa reordenacoes concorrentes do mesmo pipeline. order by id para
  -- ordem de lock deterministica (duas concorrentes se enfileiram em vez de
  -- se abracarem em deadlock).
  perform 1 from public.stages s where s.pipeline_id = v_pipeline order by s.id for update;

  -- Permutacao EXATA: mesmo tamanho, sem repeticao, e CADA id resolvendo para
  -- uma etapa deste pipeline. A terceira contagem nao e redundante com o
  -- array_agg la de cima: array_agg agrega so as linhas que casaram, entao uma
  -- lista com um id inexistente (ou invisivel pela RLS) no lugar de um real
  -- ainda resolve para um pipeline so e fecha as outras duas contagens — e o
  -- update aplicaria uma ordem que nao corresponde a lista pedida, ou
  -- estouraria 23505 cru no indice unico.
  select count(*) into v_total from public.stages s where s.pipeline_id = v_pipeline;
  select count(distinct x) into v_distintos from unnest(p_ids_na_ordem) as x;
  select count(*) into v_encontrados
    from public.stages s
   where s.id = any (p_ids_na_ordem)
     and s.pipeline_id = v_pipeline;
  if v_total <> array_length(p_ids_na_ordem, 1)
     or v_distintos <> array_length(p_ids_na_ordem, 1)
     or v_encontrados <> array_length(p_ids_na_ordem, 1) then
    raise exception 'ordem_invalida';
  end if;

  -- Duas fases DENTRO da transacao da funcao: stages_ordem_por_pipeline e um
  -- indice unico nao-deferivel, e um update que permuta valores pode colidir
  -- no meio do proprio statement. A faixa 1000+ e livre (ordens reais sao
  -- pequenas) e distinta entre si. Falha em qualquer ponto desfaz TUDO.
  -- O with check novo (etapa_imutaveis_ok) passa aqui: ordem muda, tipo e
  -- pipeline_id nao.
  update public.stages s
     set ordem = 1000 + t.i
    from unnest(p_ids_na_ordem) with ordinality as t(id, i)
   where s.id = t.id;

  update public.stages s
     set ordem = t.i
    from unnest(p_ids_na_ordem) with ordinality as t(id, i)
   where s.id = t.id;
end;
$$;

-- resumo_etapas vira DEFINER com guarda de membership — o inverso das duas
-- acima, e deliberado (dizer em voz alta, guarda 5): o dialogo de exclusao
-- mostra estes numeros a qualquer membro, e sob a RLS do vendedor a contagem
-- esconderia leads de colegas — a recusa etapa_tem_leads diria "tem leads"
-- com o dialogo mostrando 0. E' exposicao de contagens agregadas a membro da
-- conta, mesma classe do boolean de pipeline_tem_leads. Nao-membro recebe
-- conjunto vazio (a mesma nao-resposta de pipeline inexistente), nunca erro.
create or replace function public.resumo_etapas(p_pipeline_id uuid)
returns table (stage_id uuid, leads_na_etapa bigint, leads_passaram bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    (select count(*) from public.leads l where l.stage_id = s.id),
    (select count(distinct passou.lead_id)
       from (
         select sh.lead_id
           from public.stage_history sh
          where sh.stage_origem = s.id or sh.stage_destino = s.id
         union all
         select l.id from public.leads l where l.stage_id = s.id
       ) passou)
  from public.stages s
  where s.pipeline_id = p_pipeline_id
    and public.is_member_of(public.conta_do_pipeline(p_pipeline_id));
$$;
