import path from 'path'
import os from 'os'
import fs from 'fs'
import net from 'net'
import tls from 'tls'
import { app, ipcMain, clipboard, BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { exec, execFile } from 'child_process'
import Store from 'electron-store'
import { createWindow } from './helpers/create-window'

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

// Armazenamento persistente para cache de certificados
const certCacheStore = new Store<Record<string, string>>({
  name: 'rdp-certificate-cache',
})

// ============================================================================
// Tipos
// ============================================================================

export interface RdpConnectionData {
  dns: string
  host: string
  port: number
  displayName: string
  certName: string | null
  username: string
  password?: string
  hasSavedPassword?: boolean
}

export interface RdpDeviceOptions {
  smartcards: boolean
  webauthn: boolean
  ports: boolean
  drives: boolean
  videoCapture: boolean
  pnpDevices: boolean
}

export interface ConnectParams {
  target: string
  username?: string
  password?: string
  options?: Partial<RdpDeviceOptions>
}

// ============================================================================
// Localização de Arquivos Auxiliares (Ícone e Script de Senhas)
// ============================================================================

function getAppIconPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'resources', 'icon.ico'),
    path.join(app.getAppPath(), 'icone', 'ico.ico'),
    path.join(process.cwd(), 'resources', 'icon.ico'),
    path.join(process.cwd(), 'icone', 'ico.ico'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return path.resolve('icone/ico.ico')
}

function getCredentialsScriptPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'resources', 'get-credentials.ps1'),
    path.join(app.getAppPath(), 'main', 'helpers', 'get-credentials.ps1'),
    path.join(process.cwd(), 'resources', 'get-credentials.ps1'),
    path.join(process.cwd(), 'main', 'helpers', 'get-credentials.ps1'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return path.resolve('resources/get-credentials.ps1')
}

// ============================================================================
// Leitura de Senhas do Windows Credential Manager
// ============================================================================

function obterSenhasSalvas(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const scriptPath = getCredentialsScriptPath()
    if (!fs.existsSync(scriptPath)) {
      return resolve({})
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { encoding: 'utf-8', timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve({})
        }
        try {
          const parsed = JSON.parse(stdout.trim())
          resolve(parsed || {})
        } catch {
          resolve({})
        }
      }
    )
  })
}

// ============================================================================
// Resolução de Certificado RDP (TLS Handshake)
// ============================================================================

const RDP_NEG_REQ = Buffer.from([
  0x03, 0x00, 0x00, 0x13, // TPKT Header (19 bytes)
  0x0e,                   // X.224 Length Indicator
  0xe0,                   // X.224 Connection Request
  0x00, 0x00,             // Dest Ref
  0x00, 0x00,             // Src Ref
  0x00,                   // Class & Options
  0x01, 0x00, 0x08, 0x00, // RDP Neg Req (Type 0x01, Len 0x0008)
  0x03, 0x00, 0x00, 0x00  // Protocols: PROTOCOL_SSL (0x01) | PROTOCOL_HYBRID (0x02)
])

function probeRdpCertificate(host: string, port: number, timeoutMs = 2500): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false
    const finish = (result: string | null) => {
      if (!resolved) {
        resolved = true
        resolve(result)
      }
    }

    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.write(RDP_NEG_REQ)
    })

    socket.once('data', () => {
      const tlsSocket = tls.connect(
        {
          socket,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        () => {
          try {
            const cert = tlsSocket.getPeerCertificate()
            let cn: string | null = null
            if (cert && cert.subject?.CN) {
              cn = Array.isArray(cert.subject.CN) ? cert.subject.CN[0] : cert.subject.CN
            }
            tlsSocket.end()
            finish(cn || null)
          } catch {
            tlsSocket.destroy()
            finish(null)
          }
        }
      )

      tlsSocket.on('error', () => {
        tlsSocket.destroy()
        finish(null)
      })

      tlsSocket.on('timeout', () => {
        tlsSocket.destroy()
        finish(null)
      })
    })

    socket.on('error', () => {
      socket.destroy()
      finish(null)
    })

    socket.on('timeout', () => {
      socket.destroy()
      finish(null)
    })
  })
}

// ============================================================================
// Leitura do Registro do Windows e Credenciais Salvas
// ============================================================================

async function lerHistoricoRegistro(): Promise<RdpConnectionData[]> {
  const senhasMap = await obterSenhasSalvas()

  return new Promise((resolve) => {
    exec('reg query "HKCU\\Software\\Microsoft\\Terminal Server Client\\Default"', { encoding: 'utf-8' }, (errDefault, stdoutDefault) => {
      if (errDefault || !stdoutDefault) {
        return resolve([])
      }

      const mruList: string[] = []
      const lines = stdoutDefault.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('MRU')) {
          const parts = trimmed.split(/\s+/)
          if (parts.length >= 3) {
            const val = parts.slice(2).join(' ').trim()
            if (val) mruList.push(val)
          }
        }
      }

      exec('reg query "HKCU\\Software\\Microsoft\\Terminal Server Client\\Servers" /s', { encoding: 'utf-8' }, (errServers, stdoutServers) => {
        const userMap: Record<string, string> = {}
        if (!errServers && stdoutServers) {
          const sections = stdoutServers.split(/HKEY_CURRENT_USER\\Software\\Microsoft\\Terminal Server Client\\Servers\\/i)
          for (const sec of sections) {
            const sLines = sec.split(/\r?\n/)
            const sName = sLines[0]?.trim()?.toLowerCase()
            if (!sName) continue

            for (const sl of sLines) {
              if (sl.includes('UsernameHint')) {
                const parts = sl.trim().split(/\s+/)
                if (parts.length >= 3) {
                  userMap[sName] = parts.slice(2).join(' ').trim()
                }
              }
            }
          }
        }

        const conexoes: RdpConnectionData[] = mruList.map((dns) => {
          let host = dns
          let port = 3389

          if (dns.includes(':')) {
            const lastColon = dns.lastIndexOf(':')
            host = dns.substring(0, lastColon)
            const p = parseInt(dns.substring(lastColon + 1), 10)
            if (!isNaN(p)) port = p
          }

          const savedUser = userMap[host.toLowerCase()] || ''
          const cachedCert = certCacheStore.get(dns) || certCacheStore.get(host) || null

          // Recupera senha salva no Gerenciador de Credenciais
          const savedPass = senhasMap[dns] || senhasMap[host] || ''

          let fallbackName = dns
          if (cachedCert) {
            fallbackName = cachedCert
          } else if (savedUser && savedUser.includes('\\')) {
            const domainPart = savedUser.split('\\')[0].trim()
            if (domainPart) fallbackName = domainPart
          }

          return {
            dns,
            host,
            port,
            displayName: fallbackName,
            certName: cachedCert,
            username: savedUser,
            password: savedPass,
            hasSavedPassword: !!savedPass,
          }
        })

        resolve(conexoes)
      })
    })
  })
}

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('get-conexoes-rdp', async (): Promise<RdpConnectionData[]> => {
  return await lerHistoricoRegistro()
})

ipcMain.handle('resolver-certificado', async (_event, dns: string): Promise<string | null> => {
  if (!dns) return null

  let host = dns
  let port = 3389

  if (dns.includes(':')) {
    const lastColon = dns.lastIndexOf(':')
    host = dns.substring(0, lastColon)
    const p = parseInt(dns.substring(lastColon + 1), 10)
    if (!isNaN(p)) port = p
  }

  const certName = await probeRdpCertificate(host, port)
  if (certName) {
    certCacheStore.set(dns, certName)
    certCacheStore.set(host, certName)
  }

  return certName
})

/**
 * Conecta via mstsc.exe:
 * 1. prompt for credentials:i:0 (NÃO solicita a senha novamente se já estiver salva).
 * 2. Registra o usuário e senha no Windows Credential Manager (cmdkey) para garantir login automático.
 * 3. Habilita nativamente todos os dispositivos e recursos locais solicitados.
 */
function promoverMru(target: string) {
  exec('reg query "HKCU\\Software\\Microsoft\\Terminal Server Client\\Default"', { encoding: 'utf-8' }, (err, stdout) => {
    const lista: string[] = [target]
    if (!err && stdout) {
      const lines = stdout.split(/\r?\n/)
      for (const l of lines) {
        const trimmed = l.trim()
        if (trimmed.startsWith('MRU')) {
          const parts = trimmed.split(/\s+/)
          if (parts.length >= 3) {
            const val = parts.slice(2).join(' ').trim()
            if (val && val.toLowerCase() !== target.toLowerCase()) {
              lista.push(val)
            }
          }
        }
      }
    }
    const max = Math.min(lista.length, 10)
    for (let i = 0; i < max; i++) {
      exec(`reg add "HKCU\\Software\\Microsoft\\Terminal Server Client\\Default" /v MRU${i} /t REG_SZ /d "${lista[i]}" /f`, () => {})
    }
  })
}

ipcMain.on('conectar-rdp', (_event, params: ConnectParams) => {
  const { target, username, password, options } = params || {}
  if (!target || typeof target !== 'string') return

  const sanitizedTarget = target.trim().replace(/[^a-zA-Z0-9.\-_:\[\]]/g, '')
  const sanitizedUser = username ? username.trim().replace(/[\r\n"']/g, '') : ''
  const sanitizedPass = password ? password.trim().replace(/[\r\n]/g, '') : ''

  if (!sanitizedTarget) return

  let host = sanitizedTarget
  if (host.includes(':')) host = host.substring(0, host.lastIndexOf(':'))

  // Se houver senha, sincroniza no Windows Credential Manager para evitar que o Windows peça a senha
  if (sanitizedUser && sanitizedPass) {
    const safePass = sanitizedPass.replace(/"/g, '\\"')
    // Sincroniza tanto para o host com porta quanto sem porta
    exec(`cmdkey /generic:TERMSRV/${sanitizedTarget} /user:"${sanitizedUser}" /pass:"${safePass}"`, () => {})
    if (host !== sanitizedTarget) {
      exec(`cmdkey /generic:TERMSRV/${host} /user:"${sanitizedUser}" /pass:"${safePass}"`, () => {})
    }
  }

  const opts = {
    smartcards: options?.smartcards ?? true,
    webauthn: options?.webauthn ?? true,
    ports: options?.ports ?? true,
    drives: options?.drives ?? false,
    videoCapture: options?.videoCapture ?? true,
    pnpDevices: options?.pnpDevices ?? true,
  }

  try {
    const tempDir = os.tmpdir()
    const rdpFilePath = path.join(tempDir, `conexao_${Date.now()}.rdp`)

    const rdpLines = [
      `full address:s:${sanitizedTarget}`,
      sanitizedUser ? `username:s:${sanitizedUser}` : '',
      // IMPORTANTE: prompt for credentials = 0 permite que o Windows use as senhas salvas sem pedir de novo!
      'prompt for credentials:i:0',
      'promptcredentialonce:i:1',
      'screen mode id:i:2',
      'use multimon:i:0',
      'authentication level:i:2',
      // Recursos e Dispositivos Locais Marcados Nativamente:
      `redirectsmartcards:i:${opts.smartcards ? 1 : 0}`,
      `redirectwebauthn:i:${opts.webauthn ? 1 : 0}`,
      `redirectcomports:i:${opts.ports ? 1 : 0}`,
      `redirectposdevices:i:${opts.pnpDevices ? 1 : 0}`,
      opts.videoCapture ? 'camerastoredirect:s:*' : 'camerastoredirect:s:',
      opts.pnpDevices ? 'devicestoredirect:s:*' : 'devicestoredirect:s:',
      opts.drives ? 'drivestoredirect:s:*' : 'drivestoredirect:s:',
      'redirectclipboard:i:1',
      'redirectprinters:i:1',
    ].filter(Boolean)

    fs.writeFileSync(rdpFilePath, rdpLines.join('\r\n'), 'utf-8')

    exec(`mstsc.exe "${rdpFilePath}"`, (error) => {
      if (error) {
        console.error('Erro ao executar mstsc:', error.message)
      }
      setTimeout(() => {
        try {
          if (fs.existsSync(rdpFilePath)) fs.unlinkSync(rdpFilePath)
        } catch {}
      }, 15000)
    })

    // Promove para o topo do histórico MRU do Windows para ficar salvo
    promoverMru(sanitizedTarget)

    // Atualiza registro do Windows com o usuário
    if (sanitizedUser) {
      const regCmdUser = `reg add "HKCU\\Software\\Microsoft\\Terminal Server Client\\Servers\\${host}" /v UsernameHint /t REG_SZ /d "${sanitizedUser}" /f`
      exec(regCmdUser, () => {})
    }

    const localDevicesMask = 0x86f
    const regCmdDevices = `reg add "HKCU\\Software\\Microsoft\\Terminal Server Client\\LocalDevices" /v "${host}" /t REG_DWORD /d ${localDevicesMask} /f`
    exec(regCmdDevices, () => {})
  } catch (err) {
    console.error('Falha ao preparar conexão RDP:', err)
    exec(`mstsc.exe /v:${sanitizedTarget}`)
  }
})

ipcMain.handle('copiar-clipboard', (_event, texto: string) => {
  if (texto) {
    clipboard.writeText(texto)
    return true
  }
  return false
})

let mainWindowInstance: BrowserWindow | null = null

ipcMain.on('redimensionar-janela', (_event, expandir: boolean) => {
  if (mainWindowInstance) {
    mainWindowInstance.setSize(500, expandir ? 580 : 470)
  }
})

ipcMain.on('fechar-app', () => {
  app.quit()
})

// ============================================================================
// Criação da Janela
// ============================================================================

;(async () => {
  await app.whenReady()

  const appIcon = getAppIconPath()

  const mainWindow = createWindow('main', {
    width: 500,
    height: 470,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
    },
  })

  mainWindowInstance = mainWindow
  mainWindow.setTitle('Conexão de Área de Trabalho Remota')

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
  }
})()

app.on('window-all-closed', () => {
  app.quit()
})
