import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Apaga as linhas de lead_sources das Pages falsas antes de qualquer teste
  // rodar, para a suite ser re-executável sem `npx supabase db reset` entre
  // rodadas (achado do review final de branch — ver comentário no arquivo).
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
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
    env: { META_FAKE: '1' },
  },
})
