import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { criarIngestaoStore } from '@/lib/data/ingestao'
import { processarEntrega } from '@/lib/ingestao/processar'
import { metaGraph } from '@/lib/integracoes/fabrica'

// A plataforma mata o handler por tempo. Uma varredura sem limite tenta
// esvaziar a fila inteira numa execucao so e nao termina nenhuma entrega --
// 20 por invocacao deixa o cron seguinte pegar o resto.
const LIMITE_POR_INVOCACAO = 20

const PREFIXO_BEARER = 'Bearer '

/**
 * Confere o `Authorization: Bearer <CRON_SECRET>` que o Vercel Cron manda.
 *
 * CRON_SECRET E' SEGREDO PORTADOR (quem o apresenta e autorizado), diferente
 * do `conta.id` do `tokenDaConta` (Plano 3), onde `!==` foi julgado correto
 * no review por NAO ser segredo -- ali o id e publico por natureza, e nao
 * ha nada para um atacante extrair comparando tempos de resposta. Aqui e o
 * oposto: `===`/`!==` teria curto-circuitado no primeiro byte diferente, e o
 * tempo de resposta vazaria quantos bytes do segredo um atacante acertou.
 * timingSafeEqual compara em tempo constante -- nao "simplificar" isto de
 * volta para `===` achando as duas comparacoes equivalentes, elas nao sao.
 *
 * Falha fechado: CRON_SECRET vazio (nao configurado) devolve false sempre,
 * mesmo para um cabecalho que tambem chegue vazio por coincidencia.
 */
function segredoValido(cabecalho: string | null): boolean {
  const segredo = process.env.CRON_SECRET ?? ''
  if (segredo.length === 0) return false

  if (!cabecalho || !cabecalho.startsWith(PREFIXO_BEARER)) return false
  const recebido = Buffer.from(cabecalho.slice(PREFIXO_BEARER.length), 'utf8')
  const esperado = Buffer.from(segredo, 'utf8')

  // timingSafeEqual lanca se os buffers tiverem tamanhos diferentes -- a
  // checagem de tamanho vem antes dela, nao depois (mesma ordem de
  // src/lib/ingestao/hmac.ts).
  if (recebido.length !== esperado.length) return false
  return timingSafeEqual(recebido, esperado)
}

/**
 * Rede de seguranca por tras dos dois webhooks (Meta e Google): varre
 * entregas `pendente` ou `falhou` e reprocessa cada uma com `processarEntrega`,
 * o mesmo caminho que as rotas chamam via `after()`. `entregas_pendentes`
 * (migration 0010) ja aplica o backoff (3^tentativas minutos) e o limite de
 * 5 tentativas antes de desistir -- esta rota nao reimplementa nenhum dos
 * dois, so consome o que a RPC ja filtrou.
 *
 * GET, nao POST: o Vercel Cron invoca com GET. Um handler so de POST nunca
 * seria chamado, e a falha seria muda -- nada no painel da Vercel avisa que
 * o cron bate numa rota que nao responde a esse metodo.
 *
 * O ponto central desta rota: uma entrega que falha NAO pode interromper as
 * seguintes do lote. E por isso mesmo que a varredura existe -- coisas
 * falham, e uma excecao no meio do lote deixaria a fila inteira parada ate a
 * proxima janela do cron. `processarEntrega` devolve `Resultado` e nunca
 * lanca (contrato do proprio port), entao o `for` abaixo, por construcao,
 * segue para a proxima entrega em qualquer resultado.
 */
export async function GET(req: NextRequest) {
  if (!segredoValido(req.headers.get('authorization'))) {
    return new Response(null, { status: 401 })
  }

  const store = criarIngestaoStore()
  if (!store.ok) {
    // Mesma disciplina das rotas de webhook: log e o unico rastro que essa
    // falha deixa, porque nada foi tentado.
    console.error('reprocessamento: store de ingestao indisponivel', store.erro)
    return NextResponse.json({ erro: store.erro }, { status: 500 })
  }
  const ingestao = store.valor

  const pendentes = await ingestao.entregasPendentes(LIMITE_POR_INVOCACAO)
  if (!pendentes.ok) {
    console.error('reprocessamento: entregasPendentes falhou', pendentes.erro)
    return NextResponse.json({ erro: pendentes.erro }, { status: 500 })
  }

  const graph = metaGraph()
  let processadas = 0
  let falhadas = 0
  for (const entrega of pendentes.valor) {
    const resultado = await processarEntrega(entrega, { ingestao, graph })
    if (resultado.ok) processadas += 1
    else falhadas += 1
  }

  return NextResponse.json({ processadas, falhadas, total: pendentes.valor.length })
}
