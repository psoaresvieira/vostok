import { FormularioSenha } from './formulario'

/**
 * /senha (Task 3): troca de senha do proprio usuario logado, qualquer papel.
 * SEM guarda de papel aqui — o middleware ja exige sessao, e a action
 * (trocarSenha) revalida sozinha. Tambem sem resolverContaAtiva: a senha e'
 * do usuario, nao da conta ativa.
 */
export default function SenhaPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-[26px] font-semibold">Trocar senha</h1>
      <FormularioSenha />
    </div>
  )
}
