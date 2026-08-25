'use client'

import { useRef, useState } from 'react'
import { Botao } from '@/components/ui/botao'
import { Campo } from '@/components/ui/campo'
import type { Resultado } from '@/lib/domain/resultado'
import { chamarAcao } from '@/lib/ui/acao'
import { trocarSenha } from './acoes'
import { mensagemDeErroSenha } from './erros'
import { trocaDeSenhaSchema } from './esquemas'

type AcaoTrocar = (formData: FormData) => Promise<Resultado<void>>

/**
 * Formulario de troca de senha (Task 3). Action por prop com default, mesmo
 * padrao de nova-pipeline.tsx / disparar.tsx: testavel sem servidor.
 *
 * A validacao de "senhas diferentes" roda no CLIENTE antes de chamar a
 * action — trocaDeSenhaSchema e' o mesmo schema que a action usa (Task 2),
 * entao as duas camadas nunca divergem sobre o que conta como valido. Isso
 * poupa uma ida ao GoTrue so para descobrir algo que o proprio navegador ja
 * sabia.
 */
export function FormularioSenha({ trocar = trocarSenha }: { trocar?: AcaoTrocar }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)
  const [pendente, setPendente] = useState(false)
  /**
   * Trava do submit em curso. Ref, e NAO o `pendente` do estado — dois
   * cliques no mesmo frame leem o mesmo `false` de closure, e o
   * `disabled={pendente}` do DOM so' vale depois do re-render. So' a trava
   * sincrona por ref impede duas chamadas ao GoTrue por um clique duplo.
   * Mesmo padrao de nova-pipeline.tsx (salvandoRef) / disparar.tsx
   * (envioEmCurso).
   */
  const pendenteRef = useRef(false)

  async function acao(formData: FormData) {
    if (pendenteRef.current) return
    pendenteRef.current = true
    setPendente(true)
    setSucesso(false)
    setErro(null)

    const validado = trocaDeSenhaSchema.safeParse({
      senha: formData.get('senha'),
      confirmacao: formData.get('confirmacao'),
    })
    if (!validado.success) {
      setErro(mensagemDeErroSenha(validado.error.issues[0].message))
      pendenteRef.current = false
      setPendente(false)
      return
    }

    const r = await chamarAcao(trocar(formData))
    pendenteRef.current = false
    setPendente(false)
    if (!r.ok) {
      setErro(mensagemDeErroSenha(r.erro))
      return
    }
    setSenha('')
    setConfirmacao('')
    setSucesso(true)
  }

  return (
    <form action={acao} className="flex flex-col gap-3">
      <Campo
        type="password"
        name="senha"
        placeholder="nova senha (min. 8 caracteres)"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        required
      />
      <Campo
        type="password"
        name="confirmacao"
        placeholder="confirme a nova senha"
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
        required
      />
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {sucesso && <p className="text-sm text-success">Senha trocada ✓</p>}
      <Botao type="submit" disabled={pendente} className="self-start">
        Trocar senha
      </Botao>
    </form>
  )
}
