// Painel de diagnostico da tela de Integracoes: as ultimas entregas de
// webhook da conta. Sem 'use client' de proposito — so exibe o que o
// servidor ja buscou (config/page.tsx), nao precisa de estado nem de acao.
// E o que transforma "nao esta chegando lead" de misterio em diagnostico: sem
// esta tela, o unico rastro de uma entrega ignorada ou que falhou fica so no
// banco.
import type { Entrega, StatusEntrega } from '@/lib/domain/fonte'

const FORMATO = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

const STATUS: Record<StatusEntrega, string> = {
  pendente: 'Aguardando processamento',
  processado: 'Virou lead',
  ignorado: 'Ignorada',
  falhou: 'Falhou',
}

/**
 * Traduz o que `entrega.erro` guarda. Achado 1 do review (rodada 1) da Task
 * 12: o comentario antigo aqui (e o gemeo em domain/fonte.ts) presumia que
 * "texto livre do provedor" chegava por `registrar_falha` e que mostra-lo cru
 * era o proprio ponto do painel. Falso — lido o codigo: `registrar_falha' so
 * e' chamado com codigos estaveis nossos (processar.ts: token_ausente,
 * leadgen_id_ausente; MetaGraphReal: meta_indisponivel, que e' a UNICA falha
 * que buscarLead devolve) ou com o que `codigoDoErro` (lib/data/ingestao.ts)
 * extrai da RPC `ingerir_lead` — e essa funcao tem um fallback que devolve a
 * mensagem CRUA da excecao do Postgres quando nao reconhece o codigo. Regra
 * do projeto (erro nunca chega cru na tela) exige tratar esse fallback como
 * cru sempre, nunca so quando "parece" tecnico.
 *
 * Lista completa dos codigos que hoje alcancam `integration_log.erro`, com a
 * origem:
 *  - registrar_entrega (0010, insert direto): fonte_nao_encontrada,
 *    chave_invalida, lead_de_teste.
 *  - processar.ts (registrarFalha direto): token_ausente, leadgen_id_ausente.
 *  - MetaGraphReal.buscarLead via processar.ts: meta_indisponivel (unico erro
 *    que buscarLead devolve — todo `chamar()`/`corpo()` traduz qualquer falha
 *    do Graph para esse codigo).
 *  - ingerir_lead (0011, raise exception, capturado por codigoDoErro):
 *    segredo_invalido, log_nao_encontrado, fonte_nao_encontrada,
 *    pipeline_nao_encontrado, etapa_invalida.
 *  - Fallback de codigoDoErro: qualquer excecao do Postgres nao listada acima
 *    (ex.: violacao de constraint dentro de ingerir_lead) chega como a
 *    mensagem crua, truncada em 500 chars por `registrar_falha`. Nunca
 *    reconhecida por nome aqui — cai no `PADRAO` abaixo.
 *
 * posse_nao_comprovada (Graph) NAO entra: e' erro da Server Action de
 * conectar uma Page (acoes-fontes.ts), devolvido direto pro formulario de
 * Integracoes — nunca passa por registrarFalha nem por integration_log.
 * external_id_invalido e o `segredo_invalido` de registrar_entrega tambem
 * nao entram: ambos abortam a transacao ANTES do insert (raise exception),
 * entao nenhuma linha chega a existir para o painel mostrar.
 *
 * fonte_nao_encontrada e chave_invalida sao os dois que o cliente realmente
 * ve na pratica (ver task-12-brief.md), e por isso sao os unicos cuja
 * mensagem diz o que fazer, nao so o que aconteceu.
 */
const ERROS: Record<string, string> = {
  fonte_nao_encontrada:
    'Nenhuma fonte conectada corresponde a esse identificador do Facebook. Confira, em Integrações, qual Page está conectada.',
  chave_invalida:
    'A chave enviada não confere com a chave desta integração. Reconfira a chave colada no Ativo de formulário do Google Ads.',
  lead_de_teste: 'Envio de teste do Google Ads — nenhum lead foi criado de propósito.',
  token_ausente:
    'Esta fonte não tem um token de Page do Facebook salvo. Reconecte a integração em Integrações.',
  leadgen_id_ausente:
    'O Facebook enviou uma notificação sem o identificador do lead — normalmente uma falha passageira do próprio Facebook.',
  meta_indisponivel:
    'O Facebook não respondeu (ou respondeu de forma inesperada) ao buscarmos os dados do lead. O reprocessamento automático vai tentar de novo.',
  segredo_invalido: 'Falha de configuração do servidor de ingestão. Fale com o time técnico.',
  log_nao_encontrado:
    'Falha interna ao localizar esta entrega durante o reprocessamento. Fale com o time técnico.',
  pipeline_nao_encontrado:
    'Esta conta não tem um funil padrão configurado. Configure um funil antes de reprocessar.',
  etapa_invalida:
    'O funil padrão desta conta não tem nenhuma etapa aberta configurada. Confira as etapas do funil.',
}

/**
 * Mensagem para qualquer `erro` fora do mapa acima — inclusive a mensagem
 * crua de excecao do Postgres que `codigoDoErro` (lib/data/ingestao.ts)
 * devolve quando nao reconhece o codigo (ver comentario de ERROS). Nunca
 * interpola `erro` aqui: e exatamente o texto cru que a regra do projeto
 * proibe mostrar. Aponta pro banco de proposito, porque e' onde o detalhe
 * de fato esta.
 */
const PADRAO =
  'Falha técnica ao processar esta entrega. O detalhe está registrado no banco de dados — peça ao time técnico para consultar a coluna "erro" desta linha em integration_log.'

function mensagemDeErro(erro: string): string {
  return ERROS[erro] ?? PADRAO
}

export function Entregas({ entregas }: { entregas: Entrega[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-gray-700">Últimas entregas</h3>

      {entregas.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nenhuma entrega chegou ainda. Isso quer dizer que o webhook desta
          conta ainda não recebeu nenhum lead — confira se a Page do Facebook
          ou a URL do formulário do Google Ads estão configuradas
          corretamente acima.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entregas.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 rounded border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase">
                  {e.provedor}
                </span>
                <span className="font-medium">{STATUS[e.status]}</span>
                <span className="ml-auto text-xs text-gray-500">
                  {FORMATO.format(e.criadoEm)}
                </span>
              </div>
              {e.erro && <p className="text-xs text-red-600">{mensagemDeErro(e.erro)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
