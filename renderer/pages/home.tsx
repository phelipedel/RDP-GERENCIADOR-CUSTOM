import { useEffect, useState } from 'react'
import Head from 'next/head'

interface RdpConnection {
  dns: string
  host: string
  port: number
  displayName: string
  certName: string | null
  username: string
  password?: string
  hasSavedPassword?: boolean
}

interface DeviceOptions {
  smartcards: boolean
  webauthn: boolean
  ports: boolean
  drives: boolean
  videoCapture: boolean
  pnpDevices: boolean
}

export default function HomePage() {
  const [conexoes, setConexoes] = useState<RdpConnection[]>([])
  const [dnsSelecionado, setDnsSelecionado] = useState<string>('')
  const [modoNovo, setModoNovo] = useState<boolean>(false)
  const [novoEndereco, setNovoEndereco] = useState<string>('')
  const [usuario, setUsuario] = useState<string>('')
  const [senha, setSenha] = useState<string>('')
  const [mostrarSenha, setMostrarSenha] = useState<boolean>(false)
  const [copiado, setCopiado] = useState<boolean>(false)
  const [carregando, setCarregando] = useState<boolean>(true)
  const [resolvendoCert, setResolvendoCert] = useState<boolean>(false)
  const [certNovo, setCertNovo] = useState<string | null>(null)
  const [mostrarOpcoes, setMostrarOpcoes] = useState<boolean>(false)

  // Opções nativas de dispositivos e recursos locais (já vem marcadas conforme solicitado)
  const [deviceOptions, setDeviceOptions] = useState<DeviceOptions>({
    smartcards: true,
    webauthn: true,
    ports: true,
    drives: false,
    videoCapture: true,
    pnpDevices: true,
  })

  const conexaoAtual = conexoes.find((c) => c.dns === dnsSelecionado) || null

  useEffect(() => {
    async function carregarDados() {
      try {
        if (typeof window !== 'undefined' && window.ipc?.invoke) {
          const lista: RdpConnection[] = await window.ipc.invoke('get-conexoes-rdp')
          setConexoes(lista)

          if (lista && lista.length > 0) {
            const primeira = lista[0]
            setDnsSelecionado(primeira.dns)
            setUsuario(primeira.username || '')
            setSenha(primeira.password || '')

            resolverCertificadosEmBackground(lista)
          } else {
            // Se não houver conexões salvas, abre direto no modo novo
            setModoNovo(true)
          }
        }
      } catch (err) {
        console.error('Erro ao carregar conexões RDP:', err)
      } finally {
        setCarregando(false)
      }
    }

    carregarDados()
  }, [])

  const handleSelecionarComputador = (valor: string) => {
    if (valor === '__novo__') {
      ativarModoNovo()
      return
    }

    setModoNovo(false)
    setDnsSelecionado(valor)
    const encontrada = conexoes.find((c) => c.dns === valor)
    if (encontrada) {
      setUsuario(encontrada.username || '')
      setSenha(encontrada.password || '')

      if (!encontrada.certName) {
        tentarResolverIndividual(encontrada.dns)
      }
    }
  }

  const ativarModoNovo = () => {
    setModoNovo(true)
    setNovoEndereco('')
    setUsuario('')
    setSenha('')
    setCertNovo(null)
  }

  const voltarParaSalvos = () => {
    setModoNovo(false)
    if (conexaoAtual) {
      setUsuario(conexaoAtual.username || '')
      setSenha(conexaoAtual.password || '')
    } else if (conexoes.length > 0) {
      setDnsSelecionado(conexoes[0].dns)
      setUsuario(conexoes[0].username || '')
      setSenha(conexoes[0].password || '')
    }
  }

  const resolverCertificadosEmBackground = async (lista: RdpConnection[]) => {
    for (const item of lista) {
      if (!item.certName) {
        try {
          const nomeCert: string | null = await window.ipc.invoke('resolver-certificado', item.dns)
          if (nomeCert) {
            setConexoes((prev) =>
              prev.map((c) =>
                c.dns === item.dns
                  ? { ...c, displayName: nomeCert, certName: nomeCert }
                  : c
              )
            )
          }
        } catch {}
      }
    }
  }

  const tentarResolverIndividual = async (dns: string) => {
    setResolvendoCert(true)
    try {
      const nomeCert: string | null = await window.ipc.invoke('resolver-certificado', dns)
      if (nomeCert) {
        setConexoes((prev) =>
          prev.map((c) =>
            c.dns === dns ? { ...c, displayName: nomeCert, certName: nomeCert } : c
          )
        )
      }
    } catch {} finally {
      setResolvendoCert(false)
    }
  }

  const testarCertificadoNovo = async () => {
    if (!novoEndereco.trim()) return
    setResolvendoCert(true)
    try {
      const nomeCert: string | null = await window.ipc.invoke('resolver-certificado', novoEndereco.trim())
      setCertNovo(nomeCert || 'Não foi possível ler o certificado TLS')
    } catch {
      setCertNovo('Erro ao conectar')
    } finally {
      setResolvendoCert(false)
    }
  }

  const handleCopiarDns = async () => {
    const alvo = modoNovo ? novoEndereco : conexaoAtual?.dns
    if (!alvo) return

    try {
      if (window.ipc?.invoke) {
        await window.ipc.invoke('copiar-clipboard', alvo)
      } else if (navigator?.clipboard) {
        await navigator.clipboard.writeText(alvo)
      }
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch (err) {
      console.error('Falha ao copiar:', err)
    }
  }

  const toggleMostrarOpcoes = () => {
    const proximo = !mostrarOpcoes
    setMostrarOpcoes(proximo)
    window.ipc?.send('redimensionar-janela', proximo)
  }

  const toggleDeviceOption = (key: keyof DeviceOptions) => {
    setDeviceOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const handleConectar = () => {
    const alvoFinal = modoNovo ? novoEndereco.trim() : conexaoAtual?.dns
    if (!alvoFinal) return

    window.ipc?.send('conectar-rdp', {
      target: alvoFinal,
      username: usuario.trim(),
      password: senha,
      options: deviceOptions,
    })
  }

  const handleCancelar = () => {
    window.ipc?.send('fechar-app')
  }

  const targetValido = modoNovo ? novoEndereco.trim().length > 0 : !!dnsSelecionado

  return (
    <>
      <Head>
        <title>Conexão de Área de Trabalho Remota</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="w-full h-screen bg-[#F0F0F0] text-[#1E1E1E] flex flex-col justify-between p-3 select-none font-sans text-[12px]">
        {/* Cabeçalho */}
        <div className="flex items-start gap-2.5 pb-1 flex-shrink-0">
          <img
            src="/favicon.ico"
            alt="Ícone RDP"
            className="w-8 h-8 object-contain flex-shrink-0 mt-0.5"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />

          <div>
            <h1 className="text-[13px] font-semibold text-gray-800 leading-tight">
              Conexão de Área de Trabalho Remota
            </h1>
            <p className="text-gray-500 text-[11px] mt-0.5">
              Gerenciador de computadores remotos com certificados e credenciais
            </p>
          </div>
        </div>

        {/* Card Central Branco */}
        <div className="bg-white border border-[#D9D9D9] p-3 rounded-[2px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex-1 flex flex-col justify-start space-y-2 overflow-y-auto">
          {/* Seção Computador: Alternador entre Salvos e Nova Conexão */}
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-gray-700 font-medium text-[11.5px]">
                {modoNovo ? 'Novo Computador (IP ou DNS):' : 'Computador (Nome no Certificado):'}
              </label>

              {/* Botão de Alternância de Modo */}
              {modoNovo ? (
                <button
                  type="button"
                  onClick={voltarParaSalvos}
                  className="text-[11px] text-[#0067B8] hover:underline flex items-center gap-1 font-medium"
                >
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
                  </svg>
                  <span>Voltar aos salvos</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={ativarModoNovo}
                  className="text-[11px] text-[#0067B8] hover:underline flex items-center gap-1 font-medium"
                >
                  <span className="font-bold">+</span>
                  <span>Nova Conexão</span>
                </button>
              )}
            </div>

            {/* Modo 1: Lista de Salvos (Dropdown) */}
            {!modoNovo ? (
              <div className="relative">
                <select
                  id="rdp-select"
                  value={dnsSelecionado}
                  onChange={(e) => handleSelecionarComputador(e.target.value)}
                  disabled={carregando}
                  className="w-full h-[28px] px-2.5 pr-8 bg-white border border-[#7A7A7A] focus:border-[#0078D7] focus:outline-none focus:ring-1 focus:ring-[#0078D7] rounded-[2px] text-[12px] text-gray-900 appearance-none disabled:bg-gray-100 disabled:text-gray-400 cursor-pointer font-medium"
                >
                  <option value="__novo__">➕ Digitar novo endereço...</option>
                  {carregando ? (
                    <option value="">Carregando conexões salvas...</option>
                  ) : conexoes.length === 0 ? (
                    <option value="">Nenhum computador encontrado no histórico</option>
                  ) : (
                    conexoes.map((c, idx) => (
                      <option key={idx} value={c.dns}>
                        {c.displayName || c.dns}
                      </option>
                    ))
                  )}
                </select>

                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600">
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </div>
              </div>
            ) : (
              /* Modo 2: Nova Conexão (Campo de Texto Livre) */
              <div className="space-y-1">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={novoEndereco}
                    onChange={(e) => setNovoEndereco(e.target.value)}
                    placeholder="Ex: 192.168.1.100 ou srv.empresa.com:3389"
                    autoFocus
                    className="flex-1 h-[28px] px-2.5 bg-white border border-[#7A7A7A] focus:border-[#0078D7] focus:outline-none focus:ring-1 focus:ring-[#0078D7] rounded-[2px] text-[12px] text-gray-900 font-mono"
                  />
                  <button
                    type="button"
                    onClick={testarCertificadoNovo}
                    disabled={!novoEndereco.trim() || resolvendoCert}
                    className="h-[28px] px-2.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-[2px] text-[11px] text-gray-700 disabled:opacity-50"
                  >
                    {resolvendoCert ? 'Testando...' : 'Verificar Certificado'}
                  </button>
                </div>

                {certNovo && (
                  <p className="text-[10.5px] text-blue-700 font-medium">
                    {certNovo.startsWith('Não') || certNovo.startsWith('Erro') ? '⚠️ ' : '🛡️ Certificado: '}
                    {certNovo}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Link DNS Real com Botão Copiar */}
          {!modoNovo && conexaoAtual && (
            <div className="flex items-center justify-between bg-[#F8F9FA] border border-gray-200 px-2.5 py-1 rounded-[2px]">
              <div className="flex items-center gap-1.5 truncate pr-2">
                <span className="text-[11px] text-gray-500 font-medium">Link DNS:</span>
                <span className="text-[11px] text-gray-800 font-mono select-all truncate" title={conexaoAtual.dns}>
                  {conexaoAtual.dns}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCopiarDns}
                title="Copiar endereço DNS completo"
                className="flex items-center gap-1 text-[11px] text-[#0067B8] hover:text-[#005293] bg-white hover:bg-gray-50 border border-gray-300 px-2 py-0.5 rounded-[2px] transition-colors flex-shrink-0 active:scale-95"
              >
                {copiado ? (
                  <>
                    <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-green-600 font-semibold">Copiado!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3 fill-current" viewBox="0 0 16 16">
                      <path d="M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z" />
                    </svg>
                    <span>Copiar DNS</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Nome de Usuário */}
          <div className="flex flex-col space-y-0.5">
            <div className="flex items-center justify-between">
              <label htmlFor="user-input" className="text-gray-700 font-medium text-[11.5px]">
                Nome de usuário:
              </label>
              <span className="text-[10px] text-gray-400">
                {modoNovo ? 'Digite o usuário da máquina' : 'Altere para conectar com outra conta'}
              </span>
            </div>

            <input
              id="user-input"
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ex: Administrador ou DOMINIO\usuario"
              className="w-full h-[28px] px-2.5 bg-white border border-[#7A7A7A] focus:border-[#0078D7] focus:outline-none focus:ring-1 focus:ring-[#0078D7] rounded-[2px] text-[12px] text-gray-900"
            />
          </div>

          {/* Senha */}
          <div className="flex flex-col space-y-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label htmlFor="pass-input" className="text-gray-700 font-medium text-[11.5px]">
                  Senha:
                </label>
                {!modoNovo && senha && (
                  <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.2 rounded font-medium flex items-center gap-1">
                    <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 16 16">
                      <path d="M8 1a3 3 0 0 0-3 3v2H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1V4a3 3 0 0 0-3-3zm1 5V4a1 1 0 0 0-2 0v2h2z" />
                    </svg>
                    Salva no Windows
                  </span>
                )}
              </div>

              <span className="text-[10px] text-gray-400">
                {modoNovo ? 'Salvará no Windows ao conectar' : senha ? 'Login automático ativado' : 'Digite se quiser salvar'}
              </span>
            </div>

            <div className="relative">
              <input
                id="pass-input"
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder={modoNovo ? 'Digite a senha (será salva para futuros acessos)' : 'Senha armazenada no Gerenciador de Credenciais'}
                className="w-full h-[28px] px-2.5 pr-8 bg-white border border-[#7A7A7A] focus:border-[#0078D7] focus:outline-none focus:ring-1 focus:ring-[#0078D7] rounded-[2px] text-[12px] text-gray-900"
              />

              <button
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                title={mostrarSenha ? 'Ocultar senha' : 'Exibir senha'}
                className="absolute inset-y-0 right-0 px-2 flex items-center text-gray-500 hover:text-gray-800"
              >
                {mostrarSenha ? (
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                    <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Painel de Dispositivos e Recursos Locais (Foto) */}
          {mostrarOpcoes && (
            <div className="border border-[#7A7A7A] bg-[#FAFAFA] p-2.5 rounded-[2px] space-y-1.5 animate-fadeIn">
              <div className="space-y-0.5">
                <h3 className="font-semibold text-gray-800 text-[11.5px]">
                  Dispositivos e recursos locais
                </h3>
                <p className="text-gray-600 text-[10.5px]">
                  Escolha os dispositivos e recursos deste computador que deseja usar na sessão remota.
                </p>
              </div>

              <div className="bg-white border border-[#A0A0A0] p-2 rounded-[1px] space-y-1 text-[11.5px] text-gray-800">
                <label className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded-[1px]">
                  <input
                    type="checkbox"
                    checked={deviceOptions.smartcards}
                    onChange={() => toggleDeviceOption('smartcards')}
                    className="w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                  />
                  <span>Cartões inteligentes ou Windows Hello para Empresas</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded-[1px]">
                  <input
                    type="checkbox"
                    checked={deviceOptions.webauthn}
                    onChange={() => toggleDeviceOption('webauthn')}
                    className="w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                  />
                  <span>WebAuthn (Windows Hello ou chaves de segurança)</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded-[1px]">
                  <input
                    type="checkbox"
                    checked={deviceOptions.ports}
                    onChange={() => toggleDeviceOption('ports')}
                    className="w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                  />
                  <span>Portas</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded-[1px]">
                  <span className="text-gray-400 font-mono text-[10px] w-3 text-center">+</span>
                  <input
                    type="checkbox"
                    checked={deviceOptions.drives}
                    onChange={() => toggleDeviceOption('drives')}
                    className="w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                  />
                  <span>Unidades</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded-[1px]">
                  <span className="text-gray-400 font-mono text-[10px] w-3 text-center">+</span>
                  <input
                    type="checkbox"
                    checked={deviceOptions.videoCapture}
                    onChange={() => toggleDeviceOption('videoCapture')}
                    className="w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                  />
                  <span>Dispositivos de captura de vídeo</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded-[1px]">
                  <span className="text-gray-400 font-mono text-[10px] w-3 text-center">+</span>
                  <input
                    type="checkbox"
                    checked={deviceOptions.pnpDevices}
                    onChange={() => toggleDeviceOption('pnpDevices')}
                    className="w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                  />
                  <span>Outros dispositivos Plug and Play (PnP) com suporte</span>
                </label>
              </div>
            </div>
          )}

          {/* Aviso padrão */}
          {!mostrarOpcoes && (
            <div className="pt-1 border-t border-gray-100 flex items-start gap-1.5">
              <svg
                className="w-3.5 h-3.5 text-blue-600 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <path strokeWidth="2" d="M12 16v-4m0-4h.01" />
              </svg>
              <p className="text-gray-600 text-[10.5px] leading-relaxed">
                {modoNovo
                  ? 'Ao conectar, este novo computador e credenciais serão salvos automaticamente no histórico do Windows.'
                  : 'As credenciais salvas no Windows são aplicadas automaticamente para conexão direta sem solicitação repetida de senha.'}
              </p>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="pt-2 flex items-center justify-between flex-shrink-0">
          <button
            type="button"
            onClick={toggleMostrarOpcoes}
            className="flex items-center gap-1 text-gray-700 hover:text-black hover:underline focus:outline-none focus:ring-1 focus:ring-blue-400 px-1 py-0.5 rounded-[2px]"
          >
            <span>{mostrarOpcoes ? 'Ocultar Opções' : 'Mostrar Opções'}</span>
            <svg
              className={`w-3 h-3 fill-current transform transition-transform duration-150 ${
                mostrarOpcoes ? 'rotate-180' : ''
              }`}
              viewBox="0 0 20 20"
            >
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
            </svg>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleConectar}
              disabled={!targetValido}
              className="h-[28px] min-w-[85px] px-4 rounded-[2px] text-[12px] font-normal transition-colors bg-[#0067B8] hover:bg-[#005DA6] active:bg-[#005293] text-white border border-[#0067B8] disabled:bg-gray-300 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#0078D7] focus:ring-offset-1"
            >
              Conectar
            </button>

            <button
              type="button"
              onClick={handleCancelar}
              className="h-[28px] min-w-[85px] px-4 rounded-[2px] text-[12px] font-normal transition-colors bg-[#E1E1E1] hover:bg-[#E5F1FB] hover:border-[#0078D7] active:bg-[#CCE4F7] text-gray-800 border border-[#ADADAD] focus:outline-none focus:ring-2 focus:ring-[#0078D7] focus:ring-offset-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
