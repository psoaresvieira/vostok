import { test, expect, type Page } from '@playwright/test'
import { carimbo, coluna, criarConta } from './apoio'
import { NUMERO_FALSO_PADRAO, TOKEN_FALSO_PADRAO } from '@/lib/integracoes/whatsapp-falso'

/**
 * O caso nomeado da Task 9 (spec §5 do Plano 13 remodelada): pela aba
 * /disparo, sem abrir a ficha do lead, o admin escolhe o script com template
 * aprovado, busca o lead pelo nome, ve a previa com o valor interpolado,
 * envia, ve "Enviado ✓", clica em "Ver na ficha" e a timeline mostra o
 * evento whatsapp_enviado com o texto EXATO.
 *
 * disparo-whatsapp.spec.ts ja tranca o mesmo envio pela FICHA do lead (com
 * dialogo de confirmacao, gate de papel, lacuna bloqueando). Este arquivo e'
 * separado dele de proposito: a area "Disparar" (Task 7) e' uma segunda
 * SUPERFICIE para a mesma action (`enviarWhatsApp`), com fluxo proprio —
 * escolher script na lista da aba, buscar lead por texto, sem dialogo de
 * confirmacao — e por isso precisa do proprio elo ponta a ponta contra o
 * Postgres de verdade. Fundir os dois arquivos obrigaria escolher entre
 * repetir toda a arrumacao (conta, WhatsApp, template aprovado) dentro do
 * teste da ficha ou acoplar dois casos com propositos diferentes num so'
 * `test()` gigante.
 */

const ETAPA_DO_LEAD = 'Novo lead'

/** Copiado de disparo-whatsapp.spec.ts pelo mesmo motivo: a tela de
 * configuracao chega por navegacao de documento inteiro, e um clique
 * disparado antes de o React anexar o onClick se perde. */
async function conectarWhatsApp(pagina: Page): Promise<void> {
  await pagina.goto('/config')
  await expect(pagina.getByRole('heading', { name: 'Configuração', level: 1 })).toBeVisible()

  const conectar = pagina.getByRole('button', { name: 'Conectar' })
  await expect(async () => {
    await conectar.click()
    await expect(
      pagina.getByText('Preencha o token, o ID do número e o ID da WABA.'),
    ).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })

  await pagina.getByLabel('Token').fill(TOKEN_FALSO_PADRAO)
  await pagina.getByLabel('ID do número').fill(NUMERO_FALSO_PADRAO.phoneNumberId)
  await pagina.getByLabel('ID da WABA').fill(NUMERO_FALSO_PADRAO.wabaId)
  await conectar.click()

  await expect(pagina.getByText(NUMERO_FALSO_PADRAO.numeroExibicao)).toBeVisible()
}

/**
 * `whatsapp_connections_numero_idx` (0019:33) e' unico GLOBAL — o mesmo motivo
 * documentado em global-setup.ts para as Pages falsas do Meta. Sem desconectar
 * no fim deste teste, o numero falso fixo (NUMERO_FALSO_PADRAO) fica preso a
 * esta conta ate o fim da rodada inteira do `npm run test:e2e`, e
 * disparo-whatsapp.spec.ts — que conecta o MESMO numero para uma conta
 * diferente — falha logo depois com "numero ja conectado a outra conta"
 * (achado ao rodar a suite completa: a falha so' aparece com os dois arquivos
 * juntos, nunca isolado).
 */
async function desconectarWhatsApp(pagina: Page): Promise<void> {
  await pagina.goto('/config')
  await pagina.getByRole('button', { name: 'Desconectar' }).click()
  await pagina.getByRole('button', { name: 'Confirmar desconexão' }).click()
  await expect(pagina.getByRole('button', { name: 'Conectar' })).toBeVisible()
}

async function criarLeadCompleto(
  pagina: Page,
  d: { nome: string; telefone: string; empresa: string },
): Promise<void> {
  await pagina.goto('/funil')
  await expect(async () => {
    await pagina.getByRole('button', { name: 'Novo lead' }).click()
    await expect(pagina.getByPlaceholder('nome', { exact: true })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })

  await pagina.getByPlaceholder('nome', { exact: true }).fill(d.nome)
  await pagina.getByPlaceholder('telefone', { exact: true }).fill(d.telefone)
  await pagina.getByPlaceholder('empresa', { exact: true }).fill(d.empresa)
  await pagina.getByRole('button', { name: 'Salvar' }).click()

  await expect(coluna(pagina, ETAPA_DO_LEAD).getByRole('link', { name: d.nome })).toBeVisible()
}

test.describe('disparo de WhatsApp pela aba /disparo', () => {
  test('admin escolhe script, busca o lead, ve a previa, envia e a timeline mostra o texto exato', async ({
    page,
  }) => {
    await criarConta(page)

    // --- WhatsApp conectado + script com template aprovado ---
    await conectarWhatsApp(page)
    try {
      const tituloScript = `Disparo pela aba ${carimbo()}`
      const conteudo = 'Olá {{primeiro_nome}}, tudo bem na {{empresa}}?'
      await page.goto('/scripts/novo')
      await expect(page.getByRole('heading', { name: 'Novo script', level: 1 })).toBeVisible()

      await page.getByLabel('Título').fill(tituloScript)
      // exact: true — a lista "clique para inserir" tem um botao
      // aria-label="Inserir etapa", que casa por substring com 'Etapa'.
      await page.getByLabel('Etapa', { exact: true }).selectOption({ label: ETAPA_DO_LEAD })
      await page.getByLabel('Conteúdo').fill(conteudo)
      await page.getByRole('button', { name: 'Salvar' }).click()
      await page.waitForURL(/\/scripts\/[0-9a-f-]{36}$/)

      await page.getByRole('button', { name: 'Submeter ao WhatsApp' }).click()
      await expect(page.getByText('Aprovado')).toBeVisible()

      // --- Lead com telefone e empresa (as duas variaveis do script) ---
      const nomeLead = `Cliente Disparo Aba ${carimbo()}`
      const empresa = `Loja ${carimbo()}`
      await criarLeadCompleto(page, { nome: nomeLead, telefone: '(83) 98888-1234', empresa })

      const primeiroNome = nomeLead.split(' ')[0]
      const textoEsperado = `Olá ${primeiroNome}, tudo bem na ${empresa}?`

      // --- Pela aba /disparo: escolher script, buscar lead, ver a previa ---
      await page.goto('/disparo')
      await expect(
        page.getByRole('heading', { name: 'Disparo de WhatsApp', level: 1 }),
      ).toBeVisible()

      await page.getByRole('button', { name: tituloScript }).click()

      await page.getByLabel('Buscar lead').fill(nomeLead)
      await page.getByRole('button', { name: 'Buscar' }).click()
      const botaoLead = page.getByRole('button', { name: nomeLead })
      await expect(botaoLead).toBeEnabled()
      await botaoLead.click()

      await expect(page.getByRole('region', { name: `Prévia para ${nomeLead}` })).toHaveText(
        textoEsperado,
      )

      // --- Enviar (sem dialogo de confirmacao nesta superficie) ---
      const enviar = page.getByRole('button', { name: 'Enviar WhatsApp' })
      await expect(enviar).toBeEnabled()
      await enviar.click()

      // Transitorio (2.5s): a asercao comeca a esperar ANTES de a action
      // responder, entao ela ve a janela inteira em vez de correr contra ela.
      await expect(page.getByText('Enviado ✓')).toBeVisible()

      // --- "Ver na ficha" leva para a ficha do lead certo ---
      await page.getByRole('link', { name: 'Ver na ficha' }).click()
      await expect(
        page.getByRole('heading', { name: nomeLead, exact: true, level: 1 }),
      ).toBeVisible()

      // --- A timeline mostra o texto EXATO que foi enviado ---
      await page.reload()
      const linhaEvento = page
        .locator('li')
        .filter({ hasText: 'WhatsApp enviado:' })
        .locator('p')
        .first()
      await expect(linhaEvento).toHaveText(`WhatsApp enviado: ${textoEsperado}`)
    } finally {
      // Libera o numero falso fixo para o proximo arquivo da rodada — ver o
      // comentario de `desconectarWhatsApp`. `finally` de proposito: mesmo
      // que uma asercao acima quebre, o numero nao pode ficar preso a esta
      // conta e derrubar um teste que nao tem nada a ver com a quebra.
      await desconectarWhatsApp(page)
    }
  })
})
