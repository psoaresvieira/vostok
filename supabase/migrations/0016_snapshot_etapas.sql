-- Sub-projeto "excluir etapa" (Plano 8). O historico passa a carregar seu
-- proprio snapshot de nome/ordem/tipo da etapa, porque as duas RPCs de
-- /metricas recalculam profundidade a cada leitura fazendo join em stages:
-- apagar uma etapa nao mudaria o futuro, reescreveria o passado — sem erro e
-- sem log (guarda silenciosa nº 5). A fonte de verdade do passado vira o
-- snapshot; a FK vira um atalho para a etapa viva.
--
-- Estes sao os primeiros triggers do repositorio, e o desvio e consciente:
-- stage_history e lead_tags aceitam insert DIRETO de authenticated (policies
-- em 0003_leads.sql), entao snapshot escrito "pela aplicacao" dependeria de
-- todo caminho presente e futuro lembrar de escrever — e um caminho esquecido
-- criaria linha com nome de uma etapa e id de outra, que nada detectaria,
-- porque snapshot e exatamente o dado que ninguem confere depois. O trigger
-- torna a consistencia definicional em vez de convencional.

alter table public.stage_history
  add column stage_origem_nome text,
  add column stage_origem_ordem integer,
  add column stage_origem_tipo public.stage_tipo,
  add column stage_destino_nome text,
  add column stage_destino_ordem integer,
  add column stage_destino_tipo public.stage_tipo;

alter table public.lead_tags
  add column stage_nome_no_momento text,
  add column stage_ordem_no_momento integer,
  add column stage_tipo_no_momento public.stage_tipo;

-- SECURITY INVOKER de proposito (e o default; escrito para ficar dito): a
-- leitura de stages dentro do trigger passa pela RLS de quem insere. Um
-- insert apontando para etapa de outra conta nao acha a linha e cai no
-- etapa_invalida — antes desta migration, essa linha inconsistente era aceita.
create or replace function public.snapshot_stage_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage_destino is null then
    -- O drop not null de stage_destino (mais abaixo) existe para o
    -- on delete set null, nao para o cliente: quem insere tem que dizer de
    -- que etapa fala.
    raise exception 'etapa_invalida';
  end if;

  select s.nome, s.ordem, s.tipo
    into new.stage_destino_nome, new.stage_destino_ordem, new.stage_destino_tipo
    from public.stages s
   where s.id = new.stage_destino;
  if not found then
    raise exception 'etapa_invalida';
  end if;

  if new.stage_origem is not null then
    select s.nome, s.ordem, s.tipo
      into new.stage_origem_nome, new.stage_origem_ordem, new.stage_origem_tipo
      from public.stages s
     where s.id = new.stage_origem;
    if not found then
      raise exception 'etapa_invalida';
    end if;
  else
    new.stage_origem_nome := null;
    new.stage_origem_ordem := null;
    new.stage_origem_tipo := null;
  end if;

  return new;
end;
$$;

create or replace function public.snapshot_lead_tags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage_id_no_momento is null then
    raise exception 'etapa_invalida';
  end if;

  select s.nome, s.ordem, s.tipo
    into new.stage_nome_no_momento, new.stage_ordem_no_momento, new.stage_tipo_no_momento
    from public.stages s
   where s.id = new.stage_id_no_momento;
  if not found then
    raise exception 'etapa_invalida';
  end if;

  return new;
end;
$$;

-- BEFORE INSERT apenas: as duas tabelas nao tem policy de update (0003), e o
-- update interno do ON DELETE SET NULL nao dispara trigger de insert — que e
-- exatamente o que se quer: a FK vira null e o snapshot fica.
create trigger stage_history_snapshot
  before insert on public.stage_history
  for each row execute function public.snapshot_stage_history();

create trigger lead_tags_snapshot
  before insert on public.lead_tags
  for each row execute function public.snapshot_lead_tags();

-- Backfill como funcao nomeada, e nao update solto na migration, por dois
-- motivos: (1) e testavel — um banco recem-resetado nao tem dado pre-migration
-- para o teste exercitar, mas a funcao pode ser chamada de novo sobre dado
-- corrompido de proposito; (2) vira a ferramenta de reparo se um dia uma linha
-- nascer errada. SECURITY DEFINER porque repara contas de todo mundo; por isso
-- mesmo, execute e revogado de quem nao e operador.
--
-- AVISO: rodar esta funcao de novo depois de renomear ou reordenar etapas
-- NAO e uma operacao neutra. Ela re-congela toda linha de historico que ainda
-- tem FK viva (stage_origem/stage_destino/stage_id_no_momento) com o
-- nome/ordem/tipo ATUAL da etapa — ou seja, reescreve o passado para o
-- presente, que e exatamente a guarda silenciosa nº 5 que este snapshot
-- existe para fechar. Correto como backfill one-shot desta migration (o
-- select logo abaixo) e como reparo de linha genuinamente corrompida (FK
-- valida mas snapshot nulo ou inconsistente). Nao e um comando de manutencao
-- de rotina pos-0016: uma linha ja congelada corretamente que passa por aqui
-- de novo perde o valor historico que tinha.
create or replace function public.backfill_snapshot_etapas()
returns void
language sql
security definer
set search_path = public
as $$
  update public.stage_history sh
     set stage_origem_nome  = s.nome,
         stage_origem_ordem = s.ordem,
         stage_origem_tipo  = s.tipo
    from public.stages s
   where s.id = sh.stage_origem;

  update public.stage_history sh
     set stage_destino_nome  = s.nome,
         stage_destino_ordem = s.ordem,
         stage_destino_tipo  = s.tipo
    from public.stages s
   where s.id = sh.stage_destino;

  update public.lead_tags lt
     set stage_nome_no_momento  = s.nome,
         stage_ordem_no_momento = s.ordem,
         stage_tipo_no_momento  = s.tipo
    from public.stages s
   where s.id = lt.stage_id_no_momento;
$$;

revoke execute on function public.backfill_snapshot_etapas() from public, anon, authenticated;

select public.backfill_snapshot_etapas();

-- A invariante que o not null da FK garantia — toda linha de historico sabe de
-- qual etapa fala — muda de coluna: passa a ser o not null do snapshot.
-- Antes do set not null, o backfill acima ja preencheu toda linha existente
-- (a FK NO ACTION garantiu ate aqui que a etapa referenciada existe).
alter table public.stage_history
  alter column stage_destino_nome set not null,
  alter column stage_destino_ordem set not null,
  alter column stage_destino_tipo set not null;

alter table public.lead_tags
  alter column stage_nome_no_momento set not null,
  alter column stage_ordem_no_momento set not null,
  alter column stage_tipo_no_momento set not null;

-- Nulo passa a significar "essa etapa foi excluida" — nao "dado faltando".
-- leads.stage_id NAO muda: continua not null e NO ACTION, porque a guarda de
-- excluir_etapa (0018) impede a exclusao chegar la, e a FK e o backstop dela.
alter table public.stage_history alter column stage_destino drop not null;
alter table public.lead_tags alter column stage_id_no_momento drop not null;

alter table public.stage_history
  drop constraint stage_history_stage_origem_fkey,
  add constraint stage_history_stage_origem_fkey
    foreign key (stage_origem) references public.stages(id) on delete set null;

alter table public.stage_history
  drop constraint stage_history_stage_destino_fkey,
  add constraint stage_history_stage_destino_fkey
    foreign key (stage_destino) references public.stages(id) on delete set null;

alter table public.lead_tags
  drop constraint lead_tags_stage_id_no_momento_fkey,
  add constraint lead_tags_stage_id_no_momento_fkey
    foreign key (stage_id_no_momento) references public.stages(id) on delete set null;
