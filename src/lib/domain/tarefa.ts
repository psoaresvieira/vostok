export const FUSO_PADRAO = 'America/Sao_Paulo'

export type Balde = 'atrasada' | 'hoje' | 'proximos7' | 'depois'

/**
 * 'YYYY-MM-DD' no fuso dado. Locale 'en-CA' e o unico embutido no Intl que
 * formata data nesse formato, que ordena e compara lexicograficamente igual
 * a uma data real — sem isso precisariamos parsear o formato pt-BR de volta.
 */
function diaCivil(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(data)
}

/**
 * Soma dias de calendario a um dia civil 'YYYY-MM-DD', sem tocar em fuso:
 * constroi e reformata tudo em UTC, entao o fuso da maquina que roda o
 * codigo nunca entra na conta.
 */
function somarDias(diaCivilBase: string, dias: number): string {
  const [ano, mes, dia] = diaCivilBase.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, dia))
  data.setUTCDate(data.getUTCDate() + dias)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(data)
}

/**
 * Classifica uma tarefa pelo prazo, comparando dias civis no fuso informado
 * -- nunca instantes. A ordem das regras importa: (1) vencer no relogio
 * sempre vence, mesmo que o dia civil ainda seja hoje.
 */
export function classificar(venceEm: Date, agora: Date, fuso: string): Balde {
  if (venceEm.getTime() < agora.getTime()) return 'atrasada'

  const diaAgora = diaCivil(agora, fuso)
  const diaVence = diaCivil(venceEm, fuso)
  if (diaVence === diaAgora) return 'hoje'

  const amanha = somarDias(diaAgora, 1)
  const amanhaMais6 = somarDias(diaAgora, 7)
  if (diaVence >= amanha && diaVence <= amanhaMais6) return 'proximos7'

  return 'depois'
}

/** Conta quantas tarefas caem em 'atrasada' ou 'hoje'. Alimenta o badge. */
export function contarUrgentes(venceEm: Date[], agora: Date, fuso: string): number {
  return venceEm.filter((v) => {
    const balde = classificar(v, agora, fuso)
    return balde === 'atrasada' || balde === 'hoje'
  }).length
}
