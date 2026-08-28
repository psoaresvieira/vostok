import type { StageTipo } from './tipos'

export type CorDeEtapa = { fundo: string; texto: string }

/**
 * Seis familias de cor para etapas abertas, ciclando por `ordem % 6` — a
 * setima etapa de uma pipeline volta a cor da primeira. `ganho` e `perdido`
 * ignoram `ordem`: sao sempre a mesma cor, porque so' existe (no maximo) uma
 * etapa de cada tipo por pipeline e o significado (venda fechada / perdida)
 * e' fixo.
 *
 * Classes Tailwind literais e completas — nunca `bg-${cor}-200` — porque o
 * Tailwind escaneia o codigo-fonte em busca de strings de classe inteiras;
 * uma classe montada em runtime nao aparece no CSS gerado.
 */
const CORES_ABERTA: CorDeEtapa[] = [
  { fundo: 'bg-sky-200 dark:bg-sky-900/60', texto: 'text-sky-950 dark:text-sky-100' },
  { fundo: 'bg-amber-200 dark:bg-amber-900/60', texto: 'text-amber-950 dark:text-amber-100' },
  { fundo: 'bg-orange-200 dark:bg-orange-900/60', texto: 'text-orange-950 dark:text-orange-100' },
  { fundo: 'bg-teal-200 dark:bg-teal-900/60', texto: 'text-teal-950 dark:text-teal-100' },
  { fundo: 'bg-violet-200 dark:bg-violet-900/60', texto: 'text-violet-950 dark:text-violet-100' },
  { fundo: 'bg-pink-200 dark:bg-pink-900/60', texto: 'text-pink-950 dark:text-pink-100' },
]

const COR_GANHO: CorDeEtapa = { fundo: 'bg-emerald-200 dark:bg-emerald-900/60', texto: 'text-emerald-950 dark:text-emerald-100' }
const COR_PERDIDO: CorDeEtapa = { fundo: 'bg-zinc-200 dark:bg-zinc-800', texto: 'text-zinc-950 dark:text-zinc-100' }

export function corDaEtapa(ordem: number, tipo: StageTipo): CorDeEtapa {
  if (tipo === 'ganho') return COR_GANHO
  if (tipo === 'perdido') return COR_PERDIDO
  return CORES_ABERTA[ordem % CORES_ABERTA.length]
}
