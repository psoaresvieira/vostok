-- Backlog #10 do review final do Plano 2.
--
-- O InMemoryCrmStore ja desempata eventos de mesmo criado_em pelo indice de
-- insercao. O SupabaseCrmStore nao tinha criterio nenhum: com dois eventos no
-- mesmo timestamp, `order by criado_em desc` deixa a ordem por conta do plano
-- de execucao. Latente ate aqui porque nenhum caminho escrevia dois eventos na
-- mesma transacao — o Plano 4 escreve, e dentro de uma transacao now() e
-- constante, entao o empate deixa de ser raro e vira regra.
--
-- `generated always` (e nao `by default`) de proposito: a aplicacao nao pode
-- escolher a ordem, senao o desempate volta a ser opiniao de quem insere.
alter table public.lead_events
  add column seq bigint generated always as identity;

-- O indice antigo (lead_id, criado_em desc) nao serve mais ao order by de duas
-- colunas: sem seq no indice o Postgres ordena de novo em memoria.
drop index if exists public.lead_events_lead_idx;
create index lead_events_lead_idx
  on public.lead_events (lead_id, criado_em desc, seq desc);

-- Sem grant novo: `generated always` recusa escrita explicita de qualquer
-- papel, e o insert das colunas existentes ja esta coberto pelo grant da
-- 0003_leads.sql.
