import { test, expect } from '@playwright/test'
import { criarConta, carimbo } from './apoio'

test('admin conecta uma Page do Meta e gera a URL do Google', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await expect(page.getByRole('heading', { name: 'Integrações', level: 2 })).toBeVisible()
  await expect(page.getByText('Nenhuma fonte conectada ainda.')).toBeVisible()

  // O clique sai do app, passa pelo retorno e volta — em modo falso, sem rede.
  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await expect(page).toHaveURL(/\/config\?meta=escolher/)

  await page.getByRole('button', { name: 'SE7E Marketing' }).click()

  // A fonte aparece na lista, com o selo do provedor.
  const fonte = page.locator('li').filter({ hasText: 'SE7E Marketing' })
  await expect(fonte).toBeVisible()
  await expect(fonte.getByText('meta')).toBeVisible()

  // Responsavel padrao persiste depois do recarregamento. O onChange dispara
  // definirResponsavelAction (Server Action == POST na propria rota) sem que
  // o selectOption do Playwright espere a viagem terminar — sem aguardar essa
  // resposta, o reload as vezes corre na frente da gravacao e o teste fica
  // instavel (visto ao repetir localmente: falha por vezes, passa por
  // outras). Esperar a resposta, e nao um tempo fixo, elimina a corrida.
  const respostaResponsavel = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/config',
  )
  await fonte.getByRole('combobox').selectOption({ label: 'Pedro E2E' })
  await respostaResponsavel
  await page.reload()
  await expect(
    page.locator('li').filter({ hasText: 'SE7E Marketing' }).getByRole('combobox'),
  ).toHaveValue(/.+/)

  // Google: a URL e a chave aparecem uma vez.
  const nome = `Formulario ${carimbo()}`
  await page.getByPlaceholder('nome do formulário', { exact: true }).fill(nome)
  await page.getByRole('button', { name: 'Gerar URL do Google' }).click()

  await expect(page.getByText('Copie agora — não mostramos de novo.')).toBeVisible()
  await expect(page.getByText('/api/webhooks/google/')).toBeVisible()

  // E some para sempre no recarregamento.
  await page.reload()
  await expect(page.getByText('Copie agora — não mostramos de novo.')).toHaveCount(0)
  await expect(page.locator('li').filter({ hasText: nome })).toBeVisible()
})

test('desconectar remove a fonte da lista', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await page.getByRole('button', { name: 'SE7E Imóveis' }).click()

  const fonte = page.locator('li').filter({ hasText: 'SE7E Imóveis' })
  await expect(fonte).toBeVisible()

  await fonte.getByRole('button', { name: 'Desconectar' }).click()
  await expect(page.locator('li').filter({ hasText: 'SE7E Imóveis' })).toHaveCount(0)
})

// Gate obrigatorio: o bug que este teste trava ja aconteceu (achado do review
// da Task 7) e foi visto por quem implementou como comportamento correto na
// verificacao manual em navegador — so o review pegou. `?meta=escolher`
// sobrevivia a um router.refresh() depois de conectar a Page com sucesso; no
// reload seguinte o componente remontava com `etapa` ainda 'escolher', o
// efeito chamava listarPaginasDoMetaAction de novo, o COOKIE_TOKEN ja tinha
// sido apagado no sucesso da conexao anterior, e a tela pintava "a conexao
// com o Meta expirou" por cima de uma fonte que tinha conectado perfeitamente.
// O conserto foi trocar por router.replace('/config').
//
// Terceira Page (SE7E Consultoria) de proposito: o indice de lead_sources e
// global e o banco local nao e limpo entre rodadas de E2E — reusar "SE7E
// Marketing" ou "SE7E Imoveis", ja conectadas pelos dois testes acima,
// estouraria page_ja_conectada por um motivo que nao tem nada a ver com o que
// este teste verifica.
test('reload depois de conectar uma Page nao mostra "conexao expirou"', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await expect(page).toHaveURL(/\/config\?meta=escolher/)
  const botaoDaPagina = page.getByRole('button', { name: 'SE7E Consultoria' })
  await expect(botaoDaPagina).toBeVisible()

  await botaoDaPagina.click()

  // Asserção 1: o router.replace tirou o meta= da URL. Fica vermelho no
  // instante em que alguem trocar de volta para router.refresh().
  await expect(page).toHaveURL(/\/config$/)

  // Asserção 2: a fonte ja aparece conectada sem nenhum reload. Fica vermelho
  // se o revalidatePath('/config') sair do conectarPaginaAction, ou se algum
  // dia configurarem staleTimes no next.config.ts.
  const fonte = page.locator('li').filter({ hasText: 'SE7E Consultoria' })
  await expect(fonte).toBeVisible()
  await expect(fonte.getByText('meta')).toBeVisible()

  await page.reload()

  // Asserção 3: a asserção do bug em si. Depois do reload inteiro, sem o
  // conserto, a tela pintaria "A conexao com o Meta expirou" por cima de uma
  // fonte que conectou perfeitamente.
  await expect(page.getByText('A conexão com o Meta expirou')).toHaveCount(0)
  await expect(page.locator('li').filter({ hasText: 'SE7E Consultoria' })).toBeVisible()
})
