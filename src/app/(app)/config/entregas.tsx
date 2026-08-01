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
 * Traduz o que `entrega.erro` guarda. Duas origens diferentes moram na mesma
 * coluna (ver LinhaEntrega em lib/data/fontes.ts): codigos estaveis que o
 * banco escreve (0010/0011) e texto livre truncado do provedor
 * (registrar_falha, Task 9). So os codigos estaveis entram neste mapa — texto
 * livre ja e a mensagem de diagnostico, mostra-lo cru e o proprio ponto do
 * painel.
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
}

function mensagemDeErro(erro: string): string {
  return ERROS[erro] ?? erro
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
