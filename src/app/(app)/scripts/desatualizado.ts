import { traduzirParaPosicional } from '@/lib/domain/script'

/**
 * Compara a traducao do conteudo ATUAL do script com o snapshot da submissao —
 * corpo E mapa, nunca so o corpo: dois scripts podem produzir o mesmo corpo
 * posicional com mapas diferentes ('Olá {{1}}' vale tanto para
 * {{primeiro_nome}} quanto para {{empresa}}), e ai o envio preencheria o slot
 * com o valor errado.
 *
 * Conteudo que nem traduz (variavel desconhecida escrita depois da submissao)
 * conta como desatualizado: o que existe hoje no script comprovadamente nao e'
 * o que o Meta aprovou. Fail closed, sempre.
 *
 * Modulo PURO de proposito — nada de `@/lib/data` nem de `next/headers` aqui —
 * porque os tres lugares que precisam desta decisao estao em camadas
 * diferentes: /scripts/[id] (servidor), o painel da ficha do lead (COMPONENTE
 * CLIENTE, que desabilita o botao) e `enviarWhatsApp` (Server Action, que
 * recusa). Uma segunda implementacao em qualquer um deles seria a tela e o
 * servidor discordando sobre o unico fato que decide se o cliente recebe a
 * mensagem certa.
 */
export function estaDesatualizado(
  conteudo: string,
  snapshot: { corpoPosicional: string; mapa: string[] },
): boolean {
  const traducao = traduzirParaPosicional(conteudo)
  if (!traducao.ok) return true
  if (traducao.valor.corpo !== snapshot.corpoPosicional) return true
  if (traducao.valor.mapa.length !== snapshot.mapa.length) return true
  return traducao.valor.mapa.some((v, i) => v !== snapshot.mapa[i])
}
