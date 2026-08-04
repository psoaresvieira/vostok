-- Templates do WhatsApp Cloud API, um por script. Spec:
-- docs/superpowers/specs/2026-08-04-crm-disparo-whatsapp-design.md
--
-- corpo_posicional e mapa sao SNAPSHOT da submissao: o script pode ser
-- editado depois, e o que foi ao Meta nao muda. O envio usa o snapshot, e a
-- camada de cima (Task 6) so habilita enviar quando a traducao do conteudo
-- atual bate com ele — fail closed, nunca "o preview mostra X e o cliente
-- recebe Y".

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  script_id uuid not null references public.scripts(id) on delete cascade,
  nome_meta text not null,
  idioma text not null,
  categoria text not null check (categoria in ('marketing', 'utility')),
  corpo_posicional text not null,
  mapa text[] not null default '{}',
  -- Texto livre em minusculas ('pending'/'approved'/'rejected' esperados;
  -- o Meta tem outros estados e pode inventar mais). SEM check de enum de
  -- proposito: quem decide o que um estado desconhecido significa e a
  -- aplicacao, que trata tudo que nao e 'approved' como nao-enviavel.
  status text not null,
  motivo_rejeicao text,
  template_id_meta text,
  status_consultado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um template ativo por script; nome unico por conta (a conta tem uma WABA,
-- e nome de template e unico por WABA no Meta).
create unique index whatsapp_templates_script_idx
  on public.whatsapp_templates (script_id);
create unique index whatsapp_templates_nome_idx
  on public.whatsapp_templates (account_id, nome_meta);

-- Grant explicito (default ACL desta imagem da so Dxtm) e a guarda no 6.
grant select, insert, update, delete on public.whatsapp_templates to authenticated;
revoke truncate on public.whatsapp_templates from anon, authenticated;

alter table public.whatsapp_templates enable row level security;

-- Select de todo membro: o vendedor precisa ver o status para o botao de
-- envio existir. Escrita de admin/gestor, como scripts.
create policy whatsapp_templates_select on public.whatsapp_templates
  for select using (public.is_member_of(account_id));

-- O exists confina script_id ao tenant (mesma classe do stage_id do Plano
-- 10). A subconsulta roda sob a RLS de scripts como o chamador — membro
-- enxerga os scripts da propria conta, e script alheio e invisivel, entao o
-- exists falha. O WITH CHECK repete a clausula no update DE PROPOSITO: ele
-- reavalia a linha inteira.
create policy whatsapp_templates_insert on public.whatsapp_templates
  for insert with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and exists (
      select 1 from public.scripts s
       where s.id = script_id and s.account_id = whatsapp_templates.account_id
    )
  );

create policy whatsapp_templates_update on public.whatsapp_templates
  for update using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  )
  with check (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
    and exists (
      select 1 from public.scripts s
       where s.id = script_id and s.account_id = whatsapp_templates.account_id
    )
  );

create policy whatsapp_templates_delete on public.whatsapp_templates
  for delete using (
    public.is_member_of(account_id)
    and public.papel_na_conta(account_id) in ('admin', 'gestor')
  );

-- SECURITY DEFINER exigindo o segredo de ingestao, padrao registrar_entrega:
-- a consulta de status roda quando QUALQUER membro renderiza a tela —
-- inclusive vendedor, que nao tem (e nao deve ter) escrita na tabela. Sem
-- esta RPC, ou o status fresco nao persistiria (o botao da tela discordaria
-- da revalidacao da action), ou a escrita abriria para vendedor (que poderia
-- forjar 'approved'). O valor vem do servidor que acabou de consultar o
-- Graph; o segredo prova que e ele. Escreve SO status/motivo/carimbo.
create or replace function public.atualizar_status_template(
  p_segredo text,
  p_template_id uuid,
  p_status text,
  p_motivo text
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

  update public.whatsapp_templates
     set status = lower(coalesce(p_status, '')),
         motivo_rejeicao = p_motivo,
         status_consultado_em = now(),
         atualizado_em = now()
   where id = p_template_id;
  if not found then
    raise exception 'template_nao_encontrado';
  end if;
end;
$$;

-- anon incluso de proposito: o chamador e o client anon + segredo do
-- servidor (padrao criarIngestaoStore), como credencial_whatsapp.
grant execute on function public.atualizar_status_template(text, uuid, text, text) to anon, authenticated;
