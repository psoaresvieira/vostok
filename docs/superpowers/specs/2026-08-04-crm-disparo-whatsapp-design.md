# Disparo de WhatsApp (sub-projeto 5) — design

**Data:** 2026-08-04
**Estado:** aprovado no brainstorming, pronto para virar plano
**Irmãs:** `2026-08-03-crm-conexao-whatsapp-design.md` (a conexão e o contrato `credencial_whatsapp` que este design consome) · `2026-08-02-crm-scripts-tarefas-design.md` §9 (o que a biblioteca de Scripts deixou pronto para este sub-projeto)

## 1. O problema

O CRM já conecta o número (Plano 9) e já tem o texto de venda com variáveis na biblioteca (Plano 10) — mas o vendedor ainda sai do CRM para mandar a mensagem, pelo `wa.me`, no WhatsApp dele. O Cloud API só deixa a **empresa** iniciar conversa com **template pré-aprovado pelo Meta**; este sub-projeto fecha o MVP entregando o ciclo inteiro: submeter o template a partir de um script, acompanhar a aprovação, e disparar da ficha do lead pelo número da conta.

## 2. Decisões do brainstorming

| Pergunta | Escolha |
|---|---|
| Recorte do disparo | **Manual, da ficha do lead, um lead por vez** — registro na timeline. Sem agendamento, sem massa: é o menor disparo que prova o canal inteiro |
| Origem do template | **De um script da biblioteca** — botão "Submeter ao WhatsApp" no script; o CRM traduz nomeado→posicional sozinho. Uma fonte de verdade só (a integração que a spec de Scripts previu na §9) |
| Status de aprovação | **Consulta sob demanda ao Graph** quando a tela que mostra o template renderiza. Sem webhook (URL pública é o gargalo de calendário da §9 do progresso), sem cron novo |
| Papéis | **Submete admin/gestor** (mesma regra da edição de scripts — submissão mexe na WABA da conta inteira); **dispara qualquer papel** que enxerga o lead (`pode_ver_lead` recorta) |
| Arquitetura | **Tabela local `whatsapp_templates` + porta `WhatsAppGraph` estendida.** O CRM é dono do mapa posição→variável — sem ele não há como preencher `{{1}}`/`{{2}}` no envio |
| Lacuna no disparo | **Bloqueia** — deliberadamente diferente do Copiar. Copiar é rascunho que o vendedor edita antes de mandar; disparo é mensagem final sem intervenção, e `{{empresa}}` vazio chegando no cliente é a classe de defeito mais paga deste projeto |

Alternativas recusadas com custo comparado: **Graph como única fonte de verdade** (menos uma tabela, mas o mapa posição→variável não existe no Meta — teria que ser re-derivado por parsing do texto, e a ligação template→script se perde); **envio por RPC `definer` com segredo** (padrão da ingestão — desnecessário: quem dispara tem sessão, e as escritas do envio são alcançáveis por sessão via RLS; o segredo só aparece onde o Plano 9 o desenhou, na leitura da credencial).

## 3. O que já existe e este design consome sem mudar

- **`credencial_whatsapp(p_segredo, p_account_id)`** (migration `0019`): devolve `token`, `phone_number_id`, `waba_id`. Sem check de sessão, de propósito — o caller é o servidor, identificado pelo segredo. **O caller copia o padrão `criarIngestaoStore` (client anon + segredo), não `criarClienteServidor`** — é o contrato registrado no progresso.
- **`whatsapp_connections`**: select de admin. A *existência* da conexão para os outros papéis (o vendedor precisa saber se o botão de envio pode existir) é resolvida sem tocar a RLS dela: a linha de `whatsapp_templates` com status aprovado só existe se houve conexão, e o telefone/credencial são resolvidos pelo servidor na hora do envio.
- **Biblioteca de Scripts** (Plano 10): `interpolar`/`textoPlano`/`contextoDoLead`/`VARIAVEIS` em `domain/script.ts`; `ScriptStore.paraEtapa`; o painel da ficha com uma interpolação por script.
- **`lead_events`**: `tipo` é `text` — o evento novo não altera enum; `rotuloEvento` tem `default` que devolve o tipo cru, então nada quebra na ordem das tasks.

## 4. A gramática do template — domínio puro, `domain/script.ts`

### 4.1 Pinar a gramática antes de traduzir (dívida do Plano 10)

O regex atual aceita `\s*` dentro de `{{ }}` — quebra de linha casa, sem teste pinando. O tradutor posicional é o primeiro consumidor para quem a gramática exata importa. **Decisão: apertar para espaço horizontal** (`[ \t]*`), casando com a letra da spec de Scripts ("espaço opcional"). `{{\n empresa \n}}` passa a ficar literal no preview e no template — os dois consumidores concordam por construção. Um caso de teste nomeado pina cada lado.

### 4.2 Funções novas (puras, ao lado de `interpolar`)

- **`traduzirParaPosicional(conteudo)`** → `Resultado<{ corpo: string; mapa: Variavel[] }>`. Percorre com o mesmo regex de `interpolar`; cada variável **distinta** ganha a posição da primeira ocorrência (`mapa[0]` preenche `{{1}}`); todas as ocorrências viram o posicional. Variável **desconhecida** (fora do catálogo) → `falha('template_variavel_desconhecida')` — um template com buraco que o CRM não sabe preencher não pode ser submetido. Conteúdo sem variável nenhuma é válido (template fixo).
- **`valoresPosicionais(mapa, ctx)`** → `Resultado<string[]>`. Valor `null` ou só espaços em qualquer posição → `falha('whatsapp_lacunas')` com os nomes das lacunas — é a revalidação do servidor, além do botão bloqueado na tela.
- **Invariante que amarra os dois mundos, com teste nomeado:** para qualquer conteúdo válido e contexto completo, o corpo posicional preenchido com `valoresPosicionais` é **byte-idêntico** a `textoPlano(interpolar(conteudo, ctx))`. O que o Meta manda é o que o preview mostrou.

### 4.3 Nome do template no Meta

Derivado do título do script: slug em minúsculas/underscore (regras do Meta: `[a-z0-9_]`), truncado, com sufixo curto aleatório para unicidade e versionamento (`abertura_frio_k3f2`). Gerado no servidor na submissão; re-submissão gera nome novo — template aprovado não é editável no Meta, toda mudança é um template novo.

## 5. Banco — migration `0022`

Uma tabela e **uma RPC pequena** (ver o porquê ao fim da seção):

`whatsapp_templates`: `id`, `account_id` (FK cascade), `script_id` (FK cascade, **unique** — um template ativo por script), `nome_meta` (unique com `account_id`), `idioma` (constante `pt_BR` gravada), `categoria` (`marketing`/`utility`, check), `corpo_posicional` (snapshot — o script pode ser editado depois; o que foi ao Meta não muda), `mapa` (`text[]`, posição→variável), `status` (texto livre em minúsculas — `pending`/`approved`/`rejected` esperados; **UI e envio tratam qualquer outro valor como não-aprovado, fail closed**), `motivo_rejeicao` (nulo), `template_id_meta`, `status_consultado_em`, `criado_em`, `atualizado_em`.

RLS como `scripts`, e pelos mesmos motivos: select por `is_member_of` (o vendedor precisa ver o status para o botão de envio existir), insert/update/delete por admin/gestor. Guardas de sempre: grant explícito, `revoke truncate`, teste de discriminação entre contas. `script_id` já confina ao tenant por FK composta? Não — mesma classe do `stage_id` do Plano 10: o `with check` exige que o script pertença à conta (`exists` contra `scripts` com o mesmo `account_id`; helper só se necessário — `scripts` tem `account_id` direto, a subconsulta é um salto só e a RLS de `scripts` deixa membro ler).

**A RPC: `atualizar_status_template(p_segredo, p_template_id, p_status, p_motivo)`** — `security definer` exigindo o segredo de ingestão, sem sessão (padrão `registrar_entrega`). Existe porque a consulta de status roda quando **qualquer** membro renderiza a tela — inclusive vendedor, que não tem (e não deve ter) escrita na tabela. Sem ela, ou o status fresco não persiste (e o botão da tela discordaria da revalidação da action, que lê o registro local), ou a escrita teria que abrir para vendedor (que poderia forjar `approved`). O valor escrito vem do servidor que acabou de consultar o Graph — o segredo prova que é ele. Escreve **só** `status`/`motivo_rejeicao`/`status_consultado_em`, nada mais.

**Excluir o script cascateia a linha local mas não apaga o template no Meta** — risco aceito e documentado: o template órfão fica inerte na WABA (nome versionado nunca colide). Excluir etapa (Plano 8) não toca aqui: template pende do script, não da etapa.

## 6. Porta `WhatsAppGraph` — três métodos novos (mesmo arquivo, mesma dupla falsa)

- `submeterTemplate(token, wabaId, { nome, idioma, categoria, corpo })` → `Resultado<{ idMeta: string; status: string }>` — `POST /{waba_id}/message_templates`, componente `BODY` só de texto.
- `statusDoTemplate(token, wabaId, nome)` → `Resultado<{ status: string; motivo: string | null }>` — `GET /{waba_id}/message_templates?name=...`, status normalizado para minúsculas.
- `apagarTemplate(token, wabaId, nome)` → `Resultado<void>` — usado na re-submissão (apagar o antigo é intenção explícita do usuário, não compensação — guarda nº 4 respeitada).
- `enviarTemplate(token, phoneNumberId, e164Destino, { nome, idioma, valores })` → `Resultado<{ idMensagem: string }>` — `POST /{phone_number_id}/messages`, `type: template`, parâmetros posicionais na ordem de `valores`.

Falhas viram código, nunca corpo cru do Graph: `whatsapp_indisponivel` (rede/5xx, já existe), `template_recusado_pelo_meta` (4xx na submissão), `envio_recusado` (4xx no envio — inclui template não-aprovado e destinatário inválido; o Graph é a última guarda). A falsa registra chamadas e tem estado configurável (templates com status mutável pelos testes; envio que sucede/recusa) — padrão `MetaGraphFalso`.

## 7. Store, actions e telas

**`TemplateStore`** (arquivo novo `data/templates.ts`, padrão `ScriptStore`: filtro explícito de `account_id`, tradução de erro por código): `doScript(scriptId)`, `dosScripts(scriptIds)` (o painel da ficha resolve todos de uma vez), `criar`, `substituir` (re-submissão: update da linha única), `atualizarStatus(id, status, motivo)`, `excluir`.

**Submissão** (`/scripts/[id]`, admin/gestor, só com conexão ativa): bloco "WhatsApp" com o estado do template — inexistente (botão "Submeter ao WhatsApp" + select de categoria com uma linha explicando marketing×utility), `pending` (chip + quando consultou), `approved` (chip verde), `rejected` (chip + motivo + re-submeter). A Server Action: traduz (recusa `template_variavel_desconhecida` antes de qualquer IO), resolve credencial (client anon + segredo), re-submissão apaga o antigo no Meta primeiro, submete, grava a linha. Sem conexão, o bloco diz isso e aponta para `/config`.

**Status sob demanda:** quando `/scripts/[id]` ou o painel da ficha renderiza template com status ≠ `approved`/`rejected` (ou seja, `pending`/desconhecido), o servidor consulta `statusDoTemplate` e **persiste via `atualizar_status_template`** (client anon + segredo — quem renderiza pode ser vendedor, sem escrita na tabela) antes de renderizar. Assim o botão da tela e a revalidação da action leem o mesmo registro. Falha da consulta degrada para o status gravado com o carimbo `status_consultado_em`. Aprovado/rejeitado é terminal — não re-consulta a cada render.

**Disparo** (painel de scripts da ficha): script com template `approved` + lead com telefone ganha "Enviar WhatsApp" ao lado do wa.me. Com lacuna, o botão fica desabilitado dizendo por quê (o contador que já existe). A Server Action revalida no servidor, nesta ordem: lead visível com telefone (`whatsapp_sem_telefone`), template ainda `approved` no registro local (`template_nao_aprovado`), `valoresPosicionais` sem lacuna (`whatsapp_lacunas`), credencial (client anon + segredo; ausência → `sem_conexao_whatsapp`), `enviarTemplate`, e por fim `lead_events` tipo **`whatsapp_enviado`** com payload snapshot `{ template: nome_meta, texto }` — `texto` é o renderizado, mesma regra de snapshot do `tarefa_concluida`. Envio que sucedeu mas evento que falhou ganha código próprio (`whatsapp_enviado_sem_evento`), como `tarefa_concluida_sem_evento` — a mensagem **foi** para o cliente e a tela não pode mentir o contrário. `rotuloEvento` ganha o case (`WhatsApp enviado: <texto>`); confirmação transitória na tela ("Enviado ✓").

**Erros:** mapa próprio ou o de scripts estendido — decisão do plano; chaves mínimas nomeadas: `sem_conexao_whatsapp`, `template_variavel_desconhecida`, `template_ja_pendente` (re-submeter com `pending` no meio é recusado), `template_recusado_pelo_meta`, `template_nao_aprovado`, `whatsapp_sem_telefone`, `whatsapp_lacunas`, `envio_recusado`, `whatsapp_enviado_sem_evento`, e os reusados `whatsapp_indisponivel`/`erro` genéricos. Nunca corpo cru do Graph nem do PostgREST.

## 8. Testes

| Camada | O que cobre | Custo |
|---|---|---|
| Unitário (`node`) | `traduzirParaPosicional` (dedup por primeira ocorrência, desconhecida recusa, sem-variável válido), `valoresPosicionais` (lacuna nula e de espaços), **a invariante de comutação** (§4.2), a gramática apertada (§4.1 — os dois lados), slug do nome | ms |
| Unitário (portas) | Os quatro métodos novos da real (URL/corpo/tradução de erro, técnica de `meta-real.test.ts`) e da falsa (registro de chamadas, estado mutável) | ms |
| Integração | RLS de `whatsapp_templates` (discriminação entre contas; vendedor não escreve; `script_id` de outra conta recusado no insert E no update), unique de `script_id` e de `nome_meta`, store com filtro de conta provado não-vácuo | Docker |
| Componente (`jsdom`) | Bloco de submissão nos quatro estados; botão de envio: aparece só com approved+telefone, bloqueado com lacuna dizendo por quê; recusa traduzida; "Enviado ✓" | ms |
| E2E | Gestor submete de um script (falsa aprova), vendedor abre a ficha, envia, timeline registra o texto; lead sem empresa → botão bloqueado; vendedor não vê "Submeter" | `workers: 1` |

O teste que não pode faltar: **o que foi ao `enviarTemplate` da falsa é byte-idêntico ao `textoPlano` do preview** — a versão de disparo do teste que o Plano 10 fez para o Copiar. Todo teste novo com RED demonstrado; nenhuma contagem de teste neste documento.

## 9. Riscos aceitos

1. **Template órfão no Meta** quando o script é excluído — inerte, nome versionado nunca colide; apagar no Meta em cascata seria IO dentro de caminho de RLS.
2. **Aprovação pode levar dias e é decisão do Meta** — o CRM mostra o estado honesto; nada a fazer em código.
3. **Sem status de entrega** (delivered/read) — exige webhook, fase 2 da v.0 junto com "lead respondeu".
4. **Categoria escolhida pelo usuário pode ser recusada pelo Meta** (utility que ele considera marketing) — o motivo da rejeição aparece; re-submeter com outra categoria é o caminho.
5. **A prova contra o Graph real** (submissão e envio de verdade, com o App Review aprovado) é verificação manual da §9 do progresso — testes automatizados rodam contra a dupla falsa, como todo o repo.

## 10. Critério de aceite

Um gestor abre um script amarrado a uma etapa, clica "Submeter ao WhatsApp" e vê o chip `pending`; quando o Meta (a dupla falsa, nos testes) aprova, o chip vira `approved` sem clique extra na próxima renderização. Um vendedor abre um lead daquela etapa **com telefone e todos os dados**: "Enviar WhatsApp" está ativo; clica, vê "Enviado ✓", e a timeline registra o texto exato — que é o mesmo do preview, byte a byte, provado por teste. Num lead **sem empresa**, o botão está bloqueado dizendo que falta variável; num lead sem telefone, não existe. O vendedor não vê "Submeter ao WhatsApp" em lugar nenhum. Uma conta sem conexão de WhatsApp não vê nada disso, com o bloco do script apontando para `/config`. Suíte verde no resultado do merge após `npx supabase db reset`.

## 11. Disciplina de plano

Forma assimétrica (quarta vez): DDL/policies/grants literais; assinatura + invariantes + casos nomeados para todo TypeScript. As lições acumuladas valem: SQL literal também é código que nenhum engine rodou (casos de teste mirando as fronteiras de RLS); `with check` roda **antes** da FK (Plano 10); os defeitos de costura entre tasks são os que o review final pega — as perguntas do review de branch devem mirar as costuras (tradução×interpolação, submissão×status×envio, camadas do bloqueio de vendedor). Tamanho estimado: um plano (Plano 11), na casa de 6 tasks.
