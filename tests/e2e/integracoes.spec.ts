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

  await page.getByRole('button', { name: 'Exemplo Marketing' }).click()

  // A fonte aparece na lista, com o selo do provedor.
  const fonte = page.locator('li').filter({ hasText: 'Exemplo Marketing' })
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
  await fonte.getByRole('combobox').selectOption({ label: 'Cliente E2E' })
  await respostaResponsavel
  await page.reload()
  await expect(
    page.locator('li').filter({ hasText: 'Exemplo Marketing' }).getByRole('combobox'),
  ).toHaveValue(/.+/)

  // Google: a URL e a chave aparecem uma vez.
  const nome = `Formulario ${carimbo()}`
  await page.getByPlaceholder('nome do formulário', { exact: true }).fill(nome)
  await page.getByRole('button', { name: 'Gerar URL do Google' }).click()

  await expect(page.getByText('Copie agora — não mostramos de novo.')).toBeVisible()
  await expect(page.getByText('/api/webhooks/google/')).toBeVisible()

  // E some para sempre no recarregamento. A âncora positiva vem PRIMEIRO: ela
  // só passa depois que o documento pós-reload renderizou de verdade, então a
  // negativa que vem depois está checando o mesmo documento, não um estado
  // anterior por sorte de tempo (achado do review final de branch — mesma
  // classe de risco do `toHaveCount(0)` explicado em :133-142 acima).
  await page.reload()
  await expect(page.locator('li').filter({ hasText: nome })).toBeVisible()
  await expect(page.getByText('Copie agora — não mostramos de novo.')).toHaveCount(0)
})

test('desconectar remove a fonte da lista', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await page.getByRole('button', { name: 'Exemplo Imóveis' }).click()

  const fonte = page.locator('li').filter({ hasText: 'Exemplo Imóveis' })
  await expect(fonte).toBeVisible()

  await fonte.getByRole('button', { name: 'Desconectar' }).click()
  await expect(page.locator('li').filter({ hasText: 'Exemplo Imóveis' })).toHaveCount(0)
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
// Terceira Page (Exemplo Consultoria) de proposito: o indice de lead_sources e
// global e o banco local nao e limpo entre rodadas de E2E — reusar "Exemplo
// Marketing" ou "Exemplo Imoveis", ja conectadas pelos dois testes acima,
// estouraria page_ja_conectada por um motivo que nao tem nada a ver com o que
// este teste verifica.
test('reload depois de conectar uma Page nao mostra "conexao expirou"', async ({ page }) => {
  await criarConta(page)
  await page.goto('/config')

  await page.getByRole('link', { name: 'Conectar Facebook' }).click()
  await expect(page).toHaveURL(/\/config\?meta=escolher/)
  const botaoDaPagina = page.getByRole('button', { name: 'Exemplo Consultoria' })
  await expect(botaoDaPagina).toBeVisible()

  await botaoDaPagina.click()

  // Asserção 1: o router.replace tirou o meta= da URL. Fica vermelho no
  // instante em que alguem trocar de volta para router.refresh().
  await expect(page).toHaveURL(/\/config$/)

  // Asserção 2: a fonte ja aparece conectada sem nenhum reload — uma
  // propriedade real que o usuario percebe (nao precisa apertar F5 depois de
  // escolher a Page). NAO trava o revalidatePath('/config'): testei
  // removendo a chamada (commit temporario, revertido) e o teste continuou
  // verde, porque com `staleTimes` no valor padrao do Next 15 (dinamico = 0)
  // o `router.replace('/config')` sempre busca o RSC de novo, revalidando ou
  // nao. Quem mantiver essa asserção nao deve esperar dela protecao contra
  // remover o revalidatePath — so contra a tela exigir um reload manual para
  // mostrar a fonte recem-conectada.
  const fonte = page.locator('li').filter({ hasText: 'Exemplo Consultoria' })
  await expect(fonte).toBeVisible()
  await expect(fonte.getByText('meta')).toBeVisible()

  // Registrado ANTES do reload, e nao depois: a resposta pode chegar antes
  // que o teste comece a escutar por ela. Sem timeout curto, porque no
  // caminho certo (URL ja sem meta=) esta chamada nunca acontece — o `.catch`
  // absorve o timeout default do Playwright para nao gerar unhandled
  // rejection num listener que talvez nunca seja consumido.
  const respostaDaListagemAposReload = page
    .waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/config',
    )
    .catch(() => null)

  await page.reload()

  // So faz sentido esperar essa resposta se a URL, depois do reload, prova
  // que o efeito de `Integracoes` TEM como disparar `listarPaginasDoMetaAction`
  // de novo (etapa === 'escolher'). `page.reload()` recarrega a MESMA URL, o
  // que faz este check refletir diretamente a asserção 1 sem precisar
  // reexecuta-la: se ela passou, a URL aqui já não tem `meta=`, o efeito não
  // dispara nada, e esperar a resposta indiscriminadamente prenderia o teste
  // ate o timeout mesmo no caminho bom.
  if (/meta=escolher/.test(page.url())) {
    await respostaDaListagemAposReload
  }

  // Asserção 3: a asserção do bug em si. Depois do reload inteiro, sem o
  // conserto, a tela pintaria "A conexao com o Meta expirou" por cima de uma
  // fonte que conectou perfeitamente. Esperar a resposta acima ANTES de
  // checar e essencial — achado do review: `toHaveCount(0)` resolve assim que
  // observa a contagem zero uma unica vez, sem continuar olhando para ver se
  // ela muda depois. Sem a espera, este `expect` podia rodar bem no meio do
  // POST assincrono que o proprio efeito dispara (listarPaginasDoMetaAction),
  // achar o texto ainda ausente por sorte de tempo, e passar mesmo com o bug
  // presente — o que de fato aconteceu ao testar isto isoladamente (4/4
  // rodadas verdes com a regressao no lugar, antes deste ajuste).
  await expect(page.getByText('A conexão com o Meta expirou')).toHaveCount(0)
  await expect(page.locator('li').filter({ hasText: 'Exemplo Consultoria' })).toBeVisible()
})
