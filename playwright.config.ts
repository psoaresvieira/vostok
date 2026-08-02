import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Apaga as linhas de lead_sources das Pages falsas antes de qualquer teste
  // rodar, para a suite ser re-executável sem `npx supabase db reset` entre
  // rodadas (achado do review final de branch — ver comentário no arquivo).
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  // Serial de proposito. Estes testes nao sao isolados uns dos outros: todos
  // falam com UM servidor `next dev` e UM Postgres local. Com os 5 workers que
  // o Playwright escolhe por padrao nesta maquina, a disputa por esses dois
  // recursos compartilhados derruba testes por timeout de forma intermitente,
  // sempre em passos de navegacao — e o vermelho nao diz nada sobre o produto,
  // so sobre a maquina. Medido: `funil.spec.ts` passou 6/6 em serie e falhou em
  // rodadas paralelas, sem nenhuma mudanca de codigo entre as duas.
  //
  // O repo ja tomou exatamente esta decisao para os testes de integracao
  // (`fileParallelism: false` em vitest.integration.config.ts), pelo mesmo
  // motivo. A suite inteira leva menos de um minuto em serie; comprar
  // determinismo por esse preco e barato, e teste que pisca ensina a ignorar
  // vermelho, que e o pior habito que uma suite pode criar.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    // O quadro tem 7 colunas de 288px num container com overflow-x: a 1280px a
    // coluna "Perdido" fica fora da viewport e o mouse do Playwright nao chega
    // nela (o auto-scroll do dnd-kit depende de segurar o ponteiro na borda,
    // que e movimento de gente, nao de teste). Uma viewport que cabe o funil
    // inteiro deixa o arrasto ser sobre o produto, e nao sobre a rolagem.
    viewport: { width: 2400, height: 900 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
    // Sem isto o teste bateria em facebook.com, o que a constraint global
    // proibe. reuseExistingServer: true significa que um `npm run dev` ja
    // aberto SEM esta variavel continua valendo — derrube-o antes de rodar.
    //
    // INGESTAO_SEGREDO: sem isto o E2E dependeria de o .env.local da maquina
    // estar certo, e a falha seria "o lead nao aparece" sem nada dizendo por
    // que. Tem que ser o mesmo valor que supabase/seed.sql grava.
    //
    // META_APP_SECRET: metricas.spec.ts (Plano 6) e o primeiro E2E a POSTAR
    // de verdade em /api/webhooks/meta, para provar o canal Meta -> campanha
    // -> anuncio com o MetaGraphFalso de verdade (nao um insert direto no
    // banco fingindo que o Graph respondeu). assinaturaValida (hmac.ts) falha
    // FECHADO quando o segredo esta vazio — e e isso que .env.local.example
    // deixa por padrao, porque META_FAKE=1 nunca precisou de credencial real
    // do Meta. Sem fixar um valor aqui, a rota devolveria 401 para qualquer
    // assinatura, MESMO correta, e o teste nao teria como provar nada. O
    // valor e local ao processo do `npm run dev` que o Playwright sobe; metricas.spec.ts
    // assina o corpo com o mesmo literal.
    env: {
      META_FAKE: '1',
      INGESTAO_SEGREDO: 'segredo-de-ingestao-local',
      META_APP_SECRET: 'segredo-webhook-meta-e2e',
    },
  },
})
