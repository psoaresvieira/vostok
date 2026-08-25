'use client'

import { useState } from 'react'
import type { Resultado } from '@/lib/domain/resultado'
import type { ConexaoWhatsApp } from '@/lib/data/whatsapp'
import { conectarWhatsAppAction, desconectarWhatsAppAction } from './acoes-whatsapp'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from './erros'

type AcaoConectar = (d: {
  token: string
  phoneNumberId: string
  wabaId: string
}) => Promise<Resultado<void>>
type AcaoDesconectar = (id: string) => Promise<Resultado<void>>

/**
 * Bloco WhatsApp da tela de Integracoes. Actions por prop com default, mesmo
 * padrao de Etapas (etapas.tsx): testavel sem servidor.
 *
 * Estado desconectado: tres campos (token, phoneNumberId, wabaId) e
 * "Conectar". Estado conectado: card com o que o Graph devolveu — nunca o
 * token, que ConexaoWhatsApp nem carrega — e "Desconectar" com confirmacao
 * inline antes de chamar, mesmo desenho do dialogo de exclusao de etapas.tsx.
 */
export function WhatsApp({
  conexao,
  conectar = conectarWhatsAppAction,
  desconectar = desconectarWhatsAppAction,
}: {
  conexao: ConexaoWhatsApp | null
  conectar?: AcaoConectar
  desconectar?: AcaoDesconectar
}) {
  const [token, setToken] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [pendente, setPendente] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [desconectando, setDesconectando] = useState(false)

  async function conectarClique() {
    if (pendente) return
    setPendente(true)
    setErro(null)
    const r = await chamarAcao(conectar({ token, phoneNumberId, wabaId }))
    setPendente(false)
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
      return
    }
    setToken('')
    setPhoneNumberId('')
    setWabaId('')
  }

  async function confirmarDesconexao() {
    if (!conexao || desconectando) return
    setDesconectando(true)
    const r = await chamarAcao(desconectar(conexao.id))
    setDesconectando(false)
    setConfirmando(false)
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
    } else {
      setErro(null)
    }
  }

  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-5">
      <h2 className="font-medium">WhatsApp</h2>

      {conexao ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-medium">Número:</span> {conexao.numeroExibicao}
          </p>
          <p>
            <span className="font-medium">Nome verificado:</span> {conexao.nomeVerificado}
          </p>
          <p>
            <span className="font-medium">WABA:</span> {conexao.wabaId}
          </p>

          {!confirmando ? (
            <button
              type="button"
              onClick={() => {
                // Mesma disciplina de reportarErro em etapas.tsx: um erro de
                // uma tentativa de desconexao anterior nao pode sobreviver a
                // abertura de um dialogo novo, como se fizesse parte dele.
                setErro(null)
                setConfirmando(true)
              }}
              className="w-fit pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl border border-border px-4 text-sm hover:bg-accent"
            >
              Desconectar
            </button>
          ) : (
            <div
              role="dialog"
              aria-label="Desconectar WhatsApp"
              className="surface flex flex-col gap-2 rounded-2xl p-4 text-sm"
            >
              <p>Desconectar este número do WhatsApp?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmarDesconexao()}
                  disabled={desconectando}
                  aria-label="Confirmar desconexão"
                  className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-destructive px-4 text-sm text-destructive-foreground shadow-sm hover:brightness-110"
                >
                  Confirmar desconexão
                </button>
                {/* autoFocus no Cancelar: mesmo motivo de
                    template-whatsapp.tsx — foco entra no dialogo, na acao
                    menos destrutiva. */}
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    setErro(null)
                    setConfirmando(false)
                  }}
                  aria-label="Cancelar desconexão"
                  className="pressable inline-flex shrink-0 items-center justify-center font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background h-10 rounded-xl border border-border px-4 text-sm hover:bg-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Encontre esses valores no painel do Meta → WhatsApp → Configuração da API — use um
            token permanente de System User, não o de 24h (ver README).
          </p>
          <label className="flex flex-col text-sm">
            Token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
            />
          </label>
          <label className="flex flex-col text-sm">
            ID do número
            <input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
            />
          </label>
          <label className="flex flex-col text-sm">
            ID da WABA
            <input
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
            />
          </label>
          <button
            type="button"
            onClick={() => void conectarClique()}
            disabled={pendente}
            className="w-fit pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground shadow-sm hover:brightness-110"
          >
            Conectar
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </section>
  )
}
