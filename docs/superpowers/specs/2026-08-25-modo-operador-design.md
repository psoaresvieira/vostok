# Modo operador — bypass de dono nas conexões + troca de senha

Data: 2026-08-25. Aprovado pelo Pedro em conversa (brainstorm curto; escopo
escolhido por multipla escolha).

## Contexto e motivação

O modelo de negócio do Vostok é operado pelo dono: o Pedro cria a conta do
cliente pelo `/admin` (plano contas-so-pelo-dono, 0028), o cliente entra por
convite, e **toda a implantação — conectar Meta, Google e WhatsApp — é feita
manualmente pelo Pedro**, por script, fora da UI do app. Decisão explícita do
Pedro em 2026-08-25: *"as integrações não serão feitas pelo app, serão feitas
manualmente por mim, toda essa etapa de implantação de cada cliente será feita
por mim"*.

Dois fatos do código impedem esse modelo hoje:

1. As seis RPCs de conexão (`conectar_fonte_meta`, `reivindicar_fonte_meta`,
   `conectar_fonte_google`, `desconectar_fonte`, `conectar_whatsapp`,
   `desconectar_whatsapp`) exigem
   `papel_na_conta(conta) = 'admin'` — e a 0028 decidiu, de propósito, que o
   dono **não** vira membro das contas de clientes (uma membership do dono
   roubaria a resolução de conta ativa, que é a membership mais antiga). O
   script de implantação do Pedro morre em `sem_permissao` no primeiro
   cliente real.
2. Não existe troca de senha em lugar nenhum do app (nem `resetPasswordForEmail`
   nem update de senha). O cliente define a senha no cadastro por convite e
   nunca mais consegue mudá-la.

## Escopo

- **Entra:** migration 0030 (bypass de dono nas cinco RPCs de conexão) e a
  página `/senha` (troca de senha para o usuário logado, qualquer papel).
- **Fora, decidido:** fluxo "esqueci a senha" por email (exigiria SMTP próprio;
  enquanto não existir, cliente que esquecer a senha depende do Pedro resetar
  no dashboard do Supabase) e **qualquer UI de integrações** — nem no `/admin`
  nem no `/config` além do que já existe.

## Parte 1 — Migration 0030: bypass de dono nas conexões

As seis RPCs são recriadas idênticas, mudando SÓ a guarda de papel
(`reivindicar_fonte_meta` entra porque a implantação também toma Page
squattada — mesma família, mesma guarda):

    if public.papel_na_conta(<conta>) is distinct from 'admin'
       and not public.sou_dono_da_plataforma() then
      raise exception 'sem_permissao';
    end if;

`sou_dono_da_plataforma()` já existe (0028, definer stable, lê
`platform_owners` por `auth.uid()`).

O que **não** muda, de propósito:

- O segredo de ingestão continua obrigatório onde já era (`conectar_fonte_meta`
  via 0012, `conectar_whatsapp`/`desconectar_whatsapp` via 0019): o segredo
  prova QUE o servidor chamou; o papel-ou-dono prova POR CONTA DE QUEM.
- `sem_sessao` continua antes de tudo que lê `auth.uid()`.
- A ordem das guardas de `desconectar_fonte`/`desconectar_whatsapp`
  (`*_nao_encontrada` antes do papel) fica como está — o id é uuid gerado,
  não identificador público, então a ordem não vaza nada (comentário original
  da 0019).
- **`p_responsavel` continua tendo que ser membro da conta do cliente**
  (`responsavel_invalido`), inclusive para o dono. Isso vira REGRA OPERACIONAL
  da implantação: o cliente aceita o convite ANTES de o Pedro conectar as
  fontes — sem membro não há para quem atribuir lead.
- Grants e assinaturas inalterados (o teste-mapa da 0024 não muda).

Testes de integração (arquivo novo `0030_*.test.ts`, estilo dos vizinhos):

- Dono conecta fonte Meta numa conta da qual NÃO é membro (caminho novo).
- Dono conecta fonte Google e WhatsApp idem (as três famílias cobertas).
- Dono desconecta fonte e WhatsApp de conta alheia.
- Usuário comum (não-dono, não-membro) continua `sem_permissao` (regressão).
- `responsavel_invalido` continua valendo até para o dono.

## Parte 2 — Página `/senha`

Rota nova no grupo `(app)`, acessível a **qualquer papel** — o `/config` é
admin-only e vendedor também precisa trocar senha. Link discreto junto ao
"Sair" na barra do app.

- Formulário: nova senha + confirmação. Mesma regra de tamanho do cadastro
  (schema zod próprio, `senhasConferem` explícito).
- Server Action `trocarSenha` chama `cliente.auth.updateUser({ password })`.
  Erros do GoTrue normalizados para códigos com tradução própria (disciplina
  `codigoDoErroDo*` — mensagem crua NUNCA chega à tela; já é a terceira vez
  que o repo paga esse padrão, ver `(auth)/acoes.ts`). Códigos previstos:
  `senha_igual` ("New password should be different"), `senha_fraca`, e o
  genérico `erro_ao_trocar_senha`.
- Trava de duplo submit na forma validada do repo
  ([[teste-duplo-clique-vacuo]]: `click(); click()` num único `act` assíncrono).
- Sucesso: mensagem transitória na própria página ("Senha trocada ✓"), sessão
  continua válida (o GoTrue não derruba a sessão corrente no update).

Cobertura: testes de schema, de action (servidor mockado no padrão
file-scoped do repo), de componente (foco, dupla submissão, erro traduzido) e
**um E2E**: entra com a conta demo, troca a senha em `/senha`, sai, entra com
a senha nova (prova o ciclo real contra o GoTrue local).

## Erros e riscos considerados

- O bypass NÃO alcança RPCs de dados (leads, etapas, scripts…): o dono continua
  sem ver o funil dos clientes. Só conexão de integrações — menor privilégio.
- `updateUser` exige sessão recente? No GoTrue local/hosted padrão, não
  (secure password change desligado). Se o projeto um dia ligar
  "secure password change", o código de erro cai no genérico — aceito.
- A 0030 vai a produção pelo fluxo normal (`db push`), que voltou a funcionar
  após o conserto do histórico de 2026-08-25.
