-- Sub-projeto 2, Plano 4: a trilha de auditoria da ingestao e a caixa de
-- notificacoes. Spec:
-- docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md

create type public.status_entrega as enum ('pendente', 'processado', 'ignorado', 'falhou');
create type public.tipo_notificacao as enum ('novo_lead', 'lead_reincidente');

create table public.integration_log (
  id uuid primary key default gen_random_uuid(),
  -- Anulaveis de proposito, os dois. Entrega de Page ou URL desconhecida e
  -- gravada mesmo assim: e o unico rastro que um operador tera de um webhook
  -- que chegou e nao virou lead, e nesse caso nao existe conta nem fonte a que
  -- atribui-la. A policy abaixo torna essas linhas invisiveis para todo tenant.
  account_id uuid references public.accounts(id) on delete cascade,
  -- set null, e nao cascade: desconectar uma fonte nao pode apagar o historico
  -- de entregas dela. A linha continua visivel para o admin pelo account_id.
  source_id uuid references public.lead_sources(id) on delete set null,
  provedor public.provedor_lead not null,
  external_id text not null,
  payload_bruto jsonb not null,
  status public.status_entrega not null default 'pendente',
  erro text,
  tentativas integer not null default 0,
  -- Nao esta no esboco da spec, e e obrigatoria para cumpri-lo: a spec pede
  -- "backoff por numero de tentativas", e backoff precisa saber QUANDO foi a
  -- ultima. Sem esta coluna, `tentativas` sozinha diz quantas vezes, nunca
  -- ha quanto tempo, e a varredura do cron retentaria em rajada.
  ultima_tentativa_em timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  criado_em timestamptz not null default now(),
  processado_em timestamptz
);

-- GLOBAL, nao por conta: leadgen_id (Meta) e lead_id (Google) sao unicos no
-- provedor. E este indice que faz reenvio do provedor virar no-op em vez de
-- card duplicado — o `on conflict (provedor, external_id) do nothing` da
-- registrar_entrega (0010) depende de ele existir com exatamente estas colunas.
create unique index integration_log_provedor_external_idx
  on public.integration_log (provedor, external_id);

-- Varredura do cron: so as linhas que ainda podem virar lead.
create index integration_log_pendentes_idx
  on public.integration_log (criado_em)
  where status in ('pendente', 'falhou');

-- Painel de diagnostico da tela de Integracoes: as ultimas entregas da conta.
create index integration_log_conta_idx
  on public.integration_log (account_id, criado_em desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo public.tipo_notificacao not null,
  lida_em timestamptz,
  criado_em timestamptz not null default now()
);

create index notifications_usuario_idx
  on public.notifications (usuario_id, criado_em desc);

-- GRANTS
--
-- payload_bruto fica FORA do grant, e e o ponto todo da lista explicita: e o
-- unico lugar do sistema onde o corpo cru do provedor fica guardado, e o painel
-- de diagnostico nao precisa dele. So funcao SECURITY DEFINER o le. Mesmo
-- desenho do grant coluna-restrito da 0008, pelo mesmo motivo: o que vaza nao
-- pode ser decidido por um `select *` de tela. Consequencia pratica que a
-- Task 12 tem que respeitar: `select *` aqui devolve 42501 para authenticated.
grant select (id, account_id, source_id, provedor, external_id, status, erro,
              tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em)
  on public.integration_log to authenticated;

-- Sem insert e sem delete: quem escreve sao as funcoes de ingestao. update de
-- lida_em e a unica escrita que a UI faz, e por isso e a unica concedida.
grant select, update (lida_em) on public.notifications to authenticated;

alter table public.integration_log enable row level security;
alter table public.notifications enable row level security;

-- Diagnostico de integracao e assunto de admin, igual as fontes que ele
-- conecta. account_id nulo torna a linha invisivel para todos: papel_na_conta
-- (null) devolve null, e null = 'admin' nao e verdadeiro.
create policy integration_log_admin_select on public.integration_log
  for select using (public.papel_na_conta(account_id) = 'admin');

-- ESTA POLICY E O ROTEAMENTO DA NOTIFICACAO. O Realtime avalia a RLS por
-- assinante, entao cada usuario recebe pelo websocket exatamente o que esta
-- clausula deixa ele ler — sem nenhum filtro no cliente. Trocar por
-- is_member_of entregaria a notificacao de um vendedor para todos os outros da
-- conta, e o sintoma seria "o sino acende demais", nunca um erro.
create policy notifications_dono_select on public.notifications
  for select using (usuario_id = auth.uid());
create policy notifications_dono_update on public.notifications
  for update using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- Realtime so publica o que esta na publicacao. Sem esta linha o sino nunca
-- acende e nada no resto do sistema da erro — modo de falha silencioso, e por
-- isso ha um teste afirmando a presenca desta tabela em pg_publication_tables.
alter publication supabase_realtime add table public.notifications;
