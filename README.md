# 🖥️ Gerenciador de Conexões RDP (Windows)

Uma interface moderna e nativa para gerenciar e iniciar conexões de **Área de Trabalho Remota (RDP)** no Windows. O aplicativo atua como uma casca inteligente sobre o cliente nativo do Windows (`mstsc.exe`), lendo o histórico de conexões do Registro, recuperando senhas do Gerenciador de Credenciais, identificando o nome real das máquinas via certificados TLS e aplicando redirecionamento de dispositivos locais por padrão.

---

## 📸 Demonstração da Interface

<p align="center">
  <img src="https://i.postimg.cc/0rgnRpt0/image.png" alt="Tela Principal do Gerenciador RDP" width="480" />
</p>
<p align="center">
  <img src="https://i.postimg.cc/02xZfCw8/image.png" alt="Dispositivos e Recursos Locais Avançados" width="480" />
</p>

---

## 🚀 Principais Funcionalidades

- **Identificação pelo Certificado TLS do Computador**: 
  Ao invés de exibir apenas links de túneis ou DNS complexos (ex: `servidor-vpn.ddns.net:45210` ou `tunnel-proxy.exemplo.com:18450`), o aplicativo realiza uma sonda de rede em segundo plano (handshake RDP/TLS) para descobrir e exibir o **nome real da máquina no certificado** (ex: `SRV-SISTEMAS-01`, `DESKTOP-FINANCEIRO`). Os nomes são mantidos em cache local para carregamento instantâneo.
- **Login Automático sem Pedir Senha**:
  Recupera as senhas descriptografadas diretamente do **Gerenciador de Credenciais do Windows** (`Advapi32.dll::CredRead`) e gera arquivos `.rdp` configurados com `prompt for credentials:i:0`, permitindo conectar com 1 clique sem digitar a senha repetidamente.
- **Leitura do Histórico do Windows**:
  Lê automaticamente as conexões recentes salvas no Registro do Windows (`HKCU\Software\Microsoft\Terminal Server Client\Default`).
- **Troca Rápida de Usuário e Senha**:
  Exibe o usuário salvo para cada conexão e permite alterá-lo diretamente pela interface, com botão para visualizar/ocultar a senha.
- **Adicionar Novas Conexões**:
  Permite alternar para o modo **Nova Conexão** para digitar qualquer IP, DNS ou porta manualmente, com botão para testar o certificado antes de conectar e salvamento automático no histórico do Windows (`MRU0`).
- **Copiar Link DNS**:
  Botão dedicado para copiar o endereço DNS original completo com a porta para a Área de Transferência.
- **Dispositivos e Recursos Locais Pré-Configurados**:
  Já vem com suporte nativo ativado para:
  - ✅ Cartões inteligentes ou Windows Hello para Empresas
  - ✅ WebAuthn (Chaves de segurança FIDO2 / Windows Hello)
  - ✅ Portas seriais/COM
  - ✅ Dispositivos de captura de vídeo (Webcam)
  - ✅ Outros dispositivos Plug and Play (PnP) com suporte
  - ✅ Área de transferência e impressoras
- **Visual Win32 Modernizado**:
  Interface inspirada na tela clássica do `mstsc.exe` do Windows, refinada com Tailwind CSS, botões no padrão Windows 10/11 e fonte `Segoe UI`.

---

## 🛠️ Stack Tecnológico

- **[Nextron](https://github.com/saltyshiomix/nextron)**: Integração robusta entre Next.js e Electron.
- **[Next.js](https://nextjs.org/)** (React 19 + TypeScript): Renderização e lógica da interface.
- **[Tailwind CSS](https://tailwindcss.com/)**: Estilização moderna e componentes com estética do Windows.
- **Node.js (`net`, `tls`, `child_process`, `fs`)**: Conexões de rede para handshake TLS, leitura de registro e disparo do `mstsc.exe`.
- **APIs Nativas do Windows**:
  - `Advapi32.dll` (`CredRead`): Extração segura de senhas do Credential Manager.
  - `reg.exe`: Consulta e persistência das chaves MRU e UsernameHint.
  - `cmdkey.exe`: Sincronização de credenciais para alvos com porta customizada.
  - `mstsc.exe`: Cliente nativo de Conexão de Área de Trabalho Remota da Microsoft.

---

## ⚙️ Como Funciona por Baixo dos Panos

```
┌────────────────────────────────────────────────────────┐
│                      Frontend                          │
│               Next.js + Tailwind CSS                   │
└──────────────────────────┬─────────────────────────────┘
                           │ IPC (ContextBridge)
┌──────────────────────────▼─────────────────────────────┐
│                 Processo Electron                      │
│                  (main/main.ts)                        │
├──────────────────────────┬─────────────────────────────┤
│ Handshake TLS RDP        │ Windows Registry            │
│ Sonda X.224 + TLS        │ reg query HKCU\...\Default  │
│ Extrai CN do Certificado │ reg query HKCU\...\Servers  │
├──────────────────────────┼─────────────────────────────┤
│ Windows Credential Mgr   │ Execução Nativa             │
│ Advapi32.dll (CredRead)  │ Gera conexao_<timestamp>.rdp│
│ Sincroniza via cmdkey    │ Executa mstsc.exe           │
└──────────────────────────┴─────────────────────────────┘
```

1. **Leitura Inicial**: Ao abrir o aplicativo, o processo principal consulta o Registro do Windows para listar as conexões recentes (`MRU*`) e busca no Gerenciador de Credenciais do Windows as senhas salvas para cada servidor (`TERMSRV/<host>`).
2. **Sonda de Certificado**: Uma conexão TCP é iniciada na porta RDP enviando o pacote de negociação `X.224 Connection Request` (`PROTOCOL_SSL`). Quando o servidor responde, a conexão é elevada para TLS e o campo `Subject.CN` do certificado X.509 é extraído e gravado em cache (`electron-store`).
3. **Início da Sessão**: Ao clicar em **Conectar**:
   - Um arquivo temporário `.rdp` é gerado contendo todas as diretivas de recursos locais (`redirectsmartcards`, `camerastoredirect`, `devicestoredirect`, etc.) e `prompt for credentials:i:0`.
   - Se houver credencial, ela é vinculada ao endereço exato via `cmdkey`.
   - O comando `mstsc.exe "<arquivo.rdp>"` é disparado, iniciando a sessão de forma direta e sem confirmação repetida de senha.

---

## 📂 Estrutura do Projeto

```
meu-gerenciador-rdp/
├── icone/
│   └── ico.ico                 # Ícone oficial do aplicativo
├── main/
│   ├── background.ts           # Ponto de entrada do Electron (IPC Handlers)
│   ├── main.ts                 # Código principal do processo Electron
│   ├── preload.ts              # ContextBridge seguro (window.ipc)
│   └── helpers/
│       ├── create-window.ts    # Gerenciamento de estado da janela
│       └── get-credentials.ps1 # Script de integração com Advapi32.dll
├── renderer/
│   ├── pages/
│   │   ├── _app.tsx            # Configuração global do Next.js
│   │   └── home.tsx            # Interface principal (Win32 / Tailwind)
│   ├── public/
│   │   └── favicon.ico         # Ícone da janela do renderer
│   └── styles/
│       └── globals.css         # Estilização base e Segoe UI
├── electron-builder.yml        # Configurações de compilação e empacotamento NSIS
├── package.json
└── tsconfig.json
```

---

## 🚀 Como Executar Localmente

### Pré-requisitos
- **Windows 10 ou 11**
- **Node.js** (v18 ou superior recomendado)
- **npm** ou **yarn**

### Instalação

```powershell
# Clone o repositório
git clone https://github.com/seu-usuario/gerenciador-rdp-windows.git
cd gerenciador-rdp-windows

# Instale as dependências
npm install
```

### Modo de Desenvolvimento

```powershell
npm run dev
```

---

## 📦 Como Compilar o Executável (.exe)

Para gerar o executável final com o instalador do Windows:

```powershell
npm run build
```

Os arquivos prontos serão gerados na pasta `dist/`:
- **Executável portátil (sem instalação):** `dist/win-unpacked/Conexao de Area de Trabalho Remota.exe`
- **Instalador oficial do Windows (NSIS):** `dist/Conexao de Area de Trabalho Remota Setup 1.0.0.exe`

---

## 🔒 Segurança

- **Proteção contra Injeção de Comandos**: Todos os hosts, usuários e senhas passam por sanitização rigorosa antes de serem passados a comandos do sistema ou gravados no arquivo `.rdp`.
- **Isolamento de Contexto do Electron**: `nodeIntegration` é desabilitado e `contextIsolation` é mantido ativo, com comunicação estrita através de `contextBridge`.
- **Arquivos Temporários Seguros**: Os arquivos `.rdp` temporários são gerados no diretório temporário do usuário autenticado (`os.tmpdir()`) e excluídos automaticamente após o início da sessão.

---

## 📄 Licença

Este projeto é distribuído sob a licença **MIT**. Consulte o arquivo `LICENSE` para mais detalhes.
