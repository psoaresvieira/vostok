import { twMerge } from 'tailwind-merge'

/**
 * Junta classes condicionais RESOLVENDO conflito de eixo: quando duas classes
 * mexem na mesma propriedade (`w-full` e `w-auto`, `px-3` e `px-2.5`), a
 * ULTIMA vence — que e' a ordem em que quem chama espera pensar.
 *
 * A primeira versao disto era um `filter(Boolean).join(' ')` sem tailwind-merge,
 * com um comentario dizendo que nenhum consumidor precisaria sobrescrever eixo
 * de variante. Essa aposta custou um bug visivel: `BASE_CONTROLE` (campo.tsx)
 * declara `w-full`, os filtros do funil passavam `w-auto` por cima, e as duas
 * classes iam juntas para o atributo — quem decide o vencedor nesse caso e' a
 * ORDEM NA FOLHA DE ESTILO, nao a ordem dos argumentos. O Tailwind emite
 * `w-auto` antes de `w-full`, entao `w-full` ganhava: os tres <select> da barra
 * de filtros viravam 100% de largura cada um, empilhados um sobre o outro em
 * cima do campo de busca, e a soma deles criava scroll horizontal na pagina.
 *
 * NAO volte para o join simples. O erro nao aparece em typecheck, nao aparece
 * em teste de DOM (as classes ESTAO todas no atributo, e o jsdom nao calcula
 * cascata) e so' se manifesta no navegador, como sobreposicao — o pior lugar
 * possivel para descobrir.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return twMerge(classes.filter(Boolean).join(' '))
}
