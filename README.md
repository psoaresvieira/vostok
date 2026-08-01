This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Antes de expor em produção

**Histórico — risco aceito e fechado.** O Plano 3 (conexão de fontes via Meta OAuth, `conectar_fonte_meta`) foi ao ar com um risco aceito conscientemente, com dono: `p_page_id` era texto arbitrário, Facebook Page IDs são informação pública, e uma função Postgres nasce com `execute` para `public` — então qualquer pessoa que fizesse signup podia travar a Page de um concorrente para sempre, direto pelo PostgREST, sem passar por tela nenhuma. A vítima recebia `page_ja_conectada` para sempre e não tinha recurso: não enxergava nem apagava a linha do invasor. Detalhe completo em `docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md`, seção "Risco nomeado: squat de Page ID em `conectar_fonte_meta`".

**O que fechou o risco (Plano 4, Task 10).** O conserto tem duas metades, e nenhuma sozinha bastava:

1. **`conectar_fonte_meta` e `reivindicar_fonte_meta` (migration `0012_posse_da_page.sql`) passam a exigir o segredo de ingestão** (`p_segredo`, primeiro argumento) além das checagens de sessão/admin que já existiam. Isso não prova posse — o banco não tem como chamar o Graph API — mas tira a RPC do alcance de quem só tem uma sessão válida via PostgREST; só o servidor (que conhece `INGESTAO_SEGREDO`) chama.
2. **A Server Action prova posse contra o Graph antes de gravar.** `conectarPaginaAction` e `reivindicarPaginaAction` (`src/app/(app)/config/acoes-fontes.ts`) chamam `MetaGraph.posseDaPagina`, que compara `GET /me` (com o token da Page) contra o `page_id` pedido, **antes** de assinar o leadgen e antes de chamar a RPC. Uma gravação recusada por posse não provada nunca assina leadgen nem toca a RPC.

Trocar só uma das metades reabre o buraco: sem (1), qualquer um com sessão chama a RPC direto; sem (2), o segredo autoriza um squat idêntico, só que pela tela.

`conectar_fonte_google` **não** ganhou segredo — decisão registrada, não esquecimento: `external_id` é sempre nulo lá, o índice único global nem alcança essas linhas, e o token da URL é gerado no servidor. Não há Page de terceiro para travar.

**O caminho de reivindicação.** Quem prova, contra o Graph, que administra uma Page já conectada a outra conta do CRM pode reivindicá-la: a tela oferece o botão "Reivindicar esta página" quando uma tentativa de conectar volta `page_ja_conectada`, com aviso explícito do que acontece (a Page sai da outra conta e passa a entregar leads para esta). Qualquer admin da conta que prove posse pode reivindicar — é a única saída para uma Page squattada antes desta migration existir.

**O que continua sendo pré-requisito de produção**, nada disto sai de graça:

- `INGESTAO_SEGREDO` **definido por SQL direto no painel do Supabase em produção, nunca versionado.** O valor em `supabase/seed.sql` é público (está neste repo) e serve só para desenvolvimento/CI local — subir para produção com esse valor equivale a não ter segredo nenhum.
- `META_VERIFY_TOKEN` e `CRON_SECRET` configurados (webhook do Meta e a rota de reprocessamento, respectivamente).
- `META_FAKE` **ausente** no ambiente de produção. Se essa variável subir por engano, o CRM passa a aceitar qualquer credencial do Meta sem validar nada contra o Graph real — ver `usarFalso()` em `src/lib/integracoes/fabrica.ts`.

**O runbook de operador continua válido como saída de emergência** (não some com o fechamento do risco): se uma Page tiver sido squattada antes desta task existir, o dono legítimo agora tem o caminho de reivindicação pela própria tela, sem precisar de intervenção manual no banco. O runbook documentado na spec (seção citada acima) permanece como referência para diagnosticar o caso, mesmo que a ação corretiva principal hoje seja self-service.

## Reprocessamento de leads (cron)

`GET /api/webhooks/reprocessar`, gateada por `Authorization: Bearer ${CRON_SECRET}`, varre entregas `pendente`/`falhou` e reprocessa cada uma com backoff (a RPC `entregas_pendentes` decide o quê e quando). `vercel.json` declara a cadência de 10 minutos, mas **no plano Hobby da Vercel o cron roda no máximo uma vez por dia, independentemente do que estiver escrito nesse arquivo** — os 10 minutos só valem a partir do plano Pro. A rota continua invocável à mão com o `CRON_SECRET`, e é assim que se esvazia a fila num incidente antes de existir um plano pago.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
