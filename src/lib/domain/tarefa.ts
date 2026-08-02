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

/**
 * Le os campos de calendario de um instante NO FUSO dado e os reempacota como
 * se fossem UTC. A diferenca entre o numero devolvido e o timestamp original e
 * exatamente o deslocamento do fuso naquele momento — e o mesmo truque de
 * diaCivil (resolver fuso via Intl), so que com a hora junto.
 */
function camposComoUTC(data: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data)
  const campo = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value)
  return Date.UTC(
    campo('year'),
    campo('month') - 1,
    campo('day'),
    campo('hour'),
    campo('minute'),
    campo('second'),
  )
}

const FORMATO_DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Converte a string naive de um <input type="datetime-local">
 * ('2026-08-10T14:30', sem fuso nenhum) para o instante ISO correspondente
 * NO FUSO RECEBIDO POR PARAMETRO — nunca no fuso da maquina.
 *
 * `new Date('2026-08-10T14:30')` resolveria essa string no fuso do browser de
 * quem digitou, enquanto a exibicao e a classificacao (classificar acima) leem
 * de volta em America/Sao_Paulo: um usuario em Manaus digitaria 09:00, o banco
 * guardaria 13:00Z e a tela devolveria 10:00. Alem de mentir no round-trip,
 * isso desloca a fronteira de dia civil que decide 'atrasada'/'hoje'.
 *
 * Devolve `null` — nunca lanca — para entrada vazia ou malformada. Quem chama
 * e componente cliente: um RangeError na construcao do argumento acontece
 * FORA do try do chamarAcao e deixa a tela muda (botao preso em disabled).
 * Erro aqui e valor de retorno, nao excecao.
 */
export function instanteDeDatetimeLocal(naive: string, fuso: string): string | null {
  const casou = FORMATO_DATETIME_LOCAL.exec(naive.trim())
  if (!casou) return null

  const [, ano, mes, dia, hora, minuto, segundo] = casou
  const alvo = Date.UTC(+ano, +mes - 1, +dia, +hora, +minuto, segundo ? +segundo : 0)

  // Date.UTC nao rejeita campo fora de faixa, ele transborda: '2026-02-31'
  // vira 3 de marco e '10:99' vira 11:39. Conferir os campos de volta e o que
  // separa data invalida de data valida — o regex sozinho so ve o formato.
  const provisorio = new Date(alvo)
  if (
    Number.isNaN(alvo) ||
    provisorio.getUTCFullYear() !== +ano ||
    provisorio.getUTCMonth() !== +mes - 1 ||
    provisorio.getUTCDate() !== +dia ||
    provisorio.getUTCHours() !== +hora ||
    provisorio.getUTCMinutes() !== +minuto
  ) {
    return null
  }

  // Duas passadas: a primeira usa o deslocamento medido no palpite (o naive
  // lido como se fosse UTC), a segunda corrige o caso em que esse palpite caiu
  // do outro lado de uma mudanca de horario de verao e por isso mediu o
  // deslocamento errado. America/Sao_Paulo nao tem mais DST, mas a funcao
  // recebe o fuso por parametro e nao pode assumir isso.
  const primeira = alvo - (camposComoUTC(provisorio, fuso) - alvo)
  const segunda = alvo - (camposComoUTC(new Date(primeira), fuso) - primeira)

  const instante = new Date(segunda)
  if (Number.isNaN(instante.getTime())) return null
  return instante.toISOString()
}

/** Conta quantas tarefas caem em 'atrasada' ou 'hoje'. Alimenta o badge. */
export function contarUrgentes(venceEm: Date[], agora: Date, fuso: string): number {
  return venceEm.filter((v) => {
    const balde = classificar(v, agora, fuso)
    return balde === 'atrasada' || balde === 'hoje'
  }).length
}
