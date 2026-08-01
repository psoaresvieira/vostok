import { test, expect } from '@playwright/test'
import { criarConta, carimbo } from './apoio'

/**
 * O sino de ponta a ponta: gera uma fonte Google real na tela, define o
 * proprio admin (unico membro da conta recem-criada) como responsavel, posta
 * um lead na URL do webhook como o Google faria, e prova que a contagem de
 * nao-lidas aparece SEM reload nem navegacao — e o Realtime (0009: RLS por
 * assinante) disparando router.refresh(), nao um polling nem um insert local.
 */
test('lead novo acende o sino sem reload, e a entrada linka para a ficha do lead', async ({
  page,
  request,
}) => {
  await criarConta(page)

  await page.goto('/config')
  const nomeDaFonte = `Sino ${carimbo()}`
  await page.getByPlaceholder('nome do formulário', { exact: true }).fill(nomeDaFonte)
  await page.getByRole('button', { name: 'Gerar URL do Google' }).click()

  const urlTexto = await page
    .locator('code')
    .filter({ hasText: '/api/webhooks/google/' })
    .textContent()
  const chaveTexto = await page.locator('code').filter({ hasText: /^chave: / }).textContent()
  expect(urlTexto).toBeTruthy()
  expect(chaveTexto).toBeTruthy()
  const urlDoWebhook = urlTexto!.trim()
  const chaveDoGoogle = chaveTexto!.replace(/^chave:\s*/, '').trim()

  // definirResponsavelAction (Server Action == POST na propria rota) nao e
  // esperada pelo selectOption do Playwright, so pelo evento de DOM — o mesmo
  // achado do Plano 3 que motivou esperar a resposta em integracoes.spec.ts.
  // Sem isto o goto('/funil') do proximo passo corre na frente da gravacao, e
  // a fonte as vezes fica sem responsavel_padrao_id: sem ele ingerir_lead
  // (0011) nao grava a notificacao de novo_lead, e o teste falharia por um
  // motivo que nao tem nada a ver com o Realtime.
  const fonte = page.locator('li').filter({ hasText: nomeDaFonte })
  const respostaResponsavel = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/config',
  )
  await fonte.getByRole('combobox').selectOption({ label: 'Pedro E2E' })
  await respostaResponsavel

  // Fica em /funil pelo resto do teste: nenhum goto, nenhum reload depois
  // daqui. E o unico jeito de a asserção 5 provar Realtime — se a pagina
  // recarregasse, a contagem viria do proximo render do servidor, nao do
  // websocket.
  await page.goto('/funil')

  const leadIdExterno = carimbo()
  const nomeDoLead = `Lead do Sino ${carimbo()}`
  const resposta = await request.post(urlDoWebhook, {
    data: {
      lead_id: leadIdExterno,
      google_key: chaveDoGoogle,
      campaign_id: 1,
      form_id: 1,
      user_column_data: [{ column_id: 'FULL_NAME', string_value: nomeDoLead }],
    },
  })
  expect(resposta.ok()).toBe(true)

  // Asserção positiva, com timeout generoso: o `after()` da rota processa a
  // entrega DEPOIS de responder 200 (ver route.ts), entao ha uma janela real
  // entre o POST devolver e a notificação existir no banco.
  const indicador = page.getByRole('status', { name: 'notificações não lidas' })
  await expect(indicador).toHaveText('1', { timeout: 20_000 })

  await page.getByRole('button', { name: 'Notificações' }).click()
  // Escopado ao painel: o funil por tras mostra o mesmo nome no card do
  // quadro (mesmo lead, mesmo responsavel), entao getByRole('link', { name })
  // sem escopo bateria em dois elementos.
  const painel = page.getByRole('region', { name: 'Notificações' })
  const entrada = painel.getByRole('link', { name: new RegExp(nomeDoLead) })
  await expect(entrada).toBeVisible()

  await entrada.click()
  await expect(page).toHaveURL(/\/leads\//)
  await expect(
    page.getByRole('heading', { name: nomeDoLead, exact: true, level: 1 }),
  ).toBeVisible()
})
