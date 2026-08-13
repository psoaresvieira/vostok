'use server'

import { revalidatePath } from 'next/cache'
import { criarScriptStoreDoServidor } from '@/lib/data/scripts'
import { criarDisparoServico, criarTemplateStoreDoServidor } from '@/lib/data/templates'
import { nomeMetaDoTitulo, traduzirParaPosicional } from '@/lib/domain/script'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { whatsappGraph } from '@/lib/integracoes/fabrica'
import { codigoDoErroDoTemplate } from './erros'

/**
 * Idioma unico dos templates. Constante privada, e nunca export: 'use server'
 * exige que TODO export deste arquivo seja Server Action assincrona. Quem
 * envia (Task 6) le o idioma da linha gravada, nao daqui — assim um template
 * submetido hoje continua sendo enviado no idioma com que o Meta o aprovou,
 * mesmo que esta constante mude amanha.
 */
const IDIOMA = 'pt_BR'

const CATEGORIAS = ['marketing', 'utility'] as const

/**
 * Sufixo curto e aleatorio do nome no Meta. Existe porque nome de template e'
 * unico por WABA e o Meta NAO reaproveita nome apagado de imediato: sem ele,
 * re-submeter "Abordagem inicial" logo depois de apagar o template antigo
 * colidiria com um nome que o Meta ainda considera ocupado.
 *
 * Hex de UUID v4, e nao Math.random().toString(36): so [0-9a-f], que e' o
 * alfabeto que nomeMetaDoTitulo ja garante para o resto do nome — e sem o
 * comprimento variavel que `toString(36)` produz quando o sorteio termina em
 * zero.
 */
function sufixoAleatorio(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Submete (ou re-submete) o script como template do WhatsApp.
 *
 * Ordem normativa (task-5-brief.md), e ela importa mais do que parece: tudo que
 * da' para recusar sem IO externo e' recusado antes do primeiro round-trip,
 * porque um template registrado no Meta que o CRM nao conseguiu gravar e' lixo
 * que ninguem apaga depois.
 *
 * (0) categoria; (1) stores + papel; (2) o script; (3) a traducao posicional;
 * (4) template `pending` ja em analise; (5) credencial; (6) nome novo; (7)
 * submissao; (8) gravacao; (9) apagar o nome antigo, best-effort; (10)
 * revalidate.
 *
 * O apagar vem DEPOIS da gravacao por emenda ao plano: antes, uma submissao
 * recusada pelo Meta deixava a linha antiga 'approved' no banco apontando para
 * um nome ja apagado na WABA — e 'approved' e' estado final para a atualizacao
 * sob demanda, que nunca mais reconsultaria.
 */
export async function submeterTemplate(
  scriptId: string,
  categoria: 'marketing' | 'utility',
): Promise<Resultado<void>> {
  // (0) A assinatura diz 'marketing' | 'utility', mas o tipo nao sobrevive ao
  // POST da Server Action: o valor chega como veio do cliente. Sem esta
  // recusa, uma categoria forjada so pararia no `check` da 0022 — depois de o
  // Meta ja ter registrado o template.
  if (!CATEGORIAS.includes(categoria)) return falha('template_categoria_invalida')

  // (1) Os dois stores em paralelo: nenhum depende do outro, e os dois
  // resolvem a mesma conta ativa.
  const [contextoScripts, contextoTemplates] = await Promise.all([
    criarScriptStoreDoServidor(),
    criarTemplateStoreDoServidor(),
  ])
  if (!contextoScripts.ok) return falha(codigoDoErroDoTemplate(contextoScripts.erro))
  if (!contextoTemplates.ok) return falha(codigoDoErroDoTemplate(contextoTemplates.erro))

  // Pre-check de papel pela mesma razao de criarScript (acoes.ts): sem ele o
  // vendedor veria a mensagem generica do 42501 em vez de "sem permissao". A
  // guarda de verdade continua sendo a RLS de whatsapp_templates_insert.
  if (contextoTemplates.valor.papel === 'vendedor') return falha('sem_permissao')

  // (2)
  const script = await contextoScripts.valor.scripts.buscar(scriptId)
  if (!script.ok) return falha(codigoDoErroDoTemplate(script.erro))
  if (!script.valor) return falha('script_nao_encontrado')

  // (3) ANTES de qualquer IO externo: 'template_variavel_desconhecida' e
  // 'template_posicional_reservado' sao recusas de dominio, e o usuario nao
  // precisa esperar o Meta para saber que errou o nome de uma variavel.
  const traducao = traduzirParaPosicional(script.valor.conteudo)
  if (!traducao.ok) return falha(traducao.erro)

  // (4) O template atual, se houver. `pending` recusa: re-submeter no meio de
  // uma analise apagaria no Meta um template que ele ainda esta avaliando, e o
  // resultado da analise antiga chegaria para um corpo que ja nao existe.
  const existente = await contextoTemplates.valor.templates.doScript(scriptId)
  if (!existente.ok) return falha(codigoDoErroDoTemplate(existente.erro))
  if (existente.valor && existente.valor.status === 'pending') {
    return falha('template_ja_pendente')
  }

  // (5)
  const servico = criarDisparoServico()
  if (!servico.ok) return falha(codigoDoErroDoTemplate(servico.erro))
  const credencial = await servico.valor.credencial(contextoTemplates.valor.contaId)
  if (!credencial.ok) return falha(codigoDoErroDoTemplate(credencial.erro))

  // (6)
  const nomeMeta = nomeMetaDoTitulo(script.valor.titulo, sufixoAleatorio())

  // (7)
  const submetido = await whatsappGraph().submeterTemplate(
    credencial.valor.token,
    credencial.valor.wabaId,
    { nome: nomeMeta, idioma: IDIOMA, categoria, corpo: traducao.valor.corpo },
  )
  if (!submetido.ok) return falha(codigoDoErroDoTemplate(submetido.erro))

  // (8) Corpo e mapa DA TRADUCAO, nunca do conteudo cru: e' este par que a
  // Task 6 compara com a traducao do conteudo atual para decidir se o envio
  // ainda corresponde ao que o Meta aprovou. O status vem do Graph, e desce
  // minusculo — o store tambem minusculiza, mas o contrato de que status mora
  // em minusculas vale para quem escreve, nao so para quem grava.
  const dados = {
    scriptId,
    nomeMeta,
    idioma: IDIOMA,
    categoria,
    corpoPosicional: traducao.valor.corpo,
    mapa: traducao.valor.mapa,
    status: submetido.valor.status.toLowerCase(),
    templateIdMeta: submetido.valor.idMeta,
  }
  const gravado = existente.valor
    ? await contextoTemplates.valor.templates.substituir(existente.valor.id, dados)
    : await contextoTemplates.valor.templates.criar(dados)
  if (!gravado.ok) return falha(codigoDoErroDoTemplate(gravado.erro))

  // (9) So AGORA o nome antigo sai do Meta, e so quando a submissao nova ja
  // esta gravada. Apagar antes era o defeito: uma submissao recusada pelo Meta
  // deixava a linha antiga intacta no banco — status 'approved', que a
  // atualizacao sob demanda considera FINAL e nunca reconsulta — apontando para
  // um nome que ja nao existe na WABA. O envio daria 'envio_recusado' para
  // sempre, sem nada na tela explicando por que.
  //
  // A falha NAO bloqueia, e o resultado nem e' lido: isto e' higiene da WABA,
  // nao parte do que o usuario pediu. O nome novo tem sufixo proprio e nunca
  // colide com o velho, entao um delete que nao foi so' deixa um template morto
  // la' — abortar aqui devolveria erro para uma re-submissao que JA DEU CERTO e
  // ja esta gravada, o que seria mentir sobre o resultado.
  if (existente.valor) {
    await whatsappGraph().apagarTemplate(
      credencial.valor.token,
      credencial.valor.wabaId,
      existente.valor.nomeMeta,
    )
  }

  // (10)
  revalidatePath(`/scripts/${scriptId}`)
  return ok(undefined)
}

/**
 * Exclui o template do script — o caminho "exclua e submeta" que a
 * re-submissao deliberadamente nao cobre (trocar a categoria e' decisao de
 * submissao do zero).
 *
 * A ordem e' o inverso da submissao, e de proposito: o banco apaga PRIMEIRO,
 * porque o pedido do usuario e' tirar o template do CRM e ele nao pode ficar
 * refem do Meta fora do ar. O apagar na WABA vem depois, best-effort e com o
 * resultado deliberadamente nao lido — e' a mesma higiene do passo (9) da
 * submissao, com o mesmo custo aceito: um delete que nao foi so' deixa um
 * template morto la', e nome novo nunca colide com o velho (sufixo proprio).
 */
export async function excluirTemplate(scriptId: string): Promise<Resultado<void>> {
  const contexto = await criarTemplateStoreDoServidor()
  if (!contexto.ok) return falha(codigoDoErroDoTemplate(contexto.erro))

  // Pre-check de papel pela mesma razao da submissao: sem ele o vendedor veria
  // a mensagem generica em vez de "sem permissao". A guarda de verdade e' a
  // RLS de whatsapp_templates_delete.
  if (contexto.valor.papel === 'vendedor') return falha('sem_permissao')

  const existente = await contexto.valor.templates.doScript(scriptId)
  if (!existente.ok) return falha(codigoDoErroDoTemplate(existente.erro))
  if (!existente.valor) return falha('template_nao_encontrado')

  const apagado = await contexto.valor.templates.excluir(existente.valor.id)
  if (!apagado.ok) return falha(codigoDoErroDoTemplate(apagado.erro))

  // Higiene da WABA: sem credencial (numero desconectado, RPC fora) a exclusao
  // local ja valeu — pular o Graph aqui nao e' erro, e' o best-effort falhando
  // cedo.
  const servico = criarDisparoServico()
  if (servico.ok) {
    const credencial = await servico.valor.credencial(contexto.valor.contaId)
    if (credencial.ok) {
      await whatsappGraph().apagarTemplate(
        credencial.valor.token,
        credencial.valor.wabaId,
        existente.valor.nomeMeta,
      )
    }
  }

  revalidatePath(`/scripts/${scriptId}`)
  return ok(undefined)
}
