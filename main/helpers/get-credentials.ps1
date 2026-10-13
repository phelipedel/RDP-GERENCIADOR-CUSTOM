$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinCred {
    [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr credentialPtr);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public static string GetPassword(string target) {
        IntPtr credPtr;
        for (int type = 1; type <= 2; type++) {
            if (CredRead(target, type, 0, out credPtr)) {
                try {
                    CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
                    if (cred.CredentialBlob != IntPtr.Zero && cred.CredentialBlobSize > 0) {
                        byte[] blob = new byte[cred.CredentialBlobSize];
                        Marshal.Copy(cred.CredentialBlob, blob, 0, cred.CredentialBlobSize);
                        string p = Encoding.Unicode.GetString(blob);
                        int nullIdx = p.IndexOf('\0');
                        if (nullIdx >= 0) p = p.Substring(0, nullIdx);
                        return p;
                    }
                } finally {
                    CredFree(credPtr);
                }
            }
        }
        return "";
    }
}
'@

Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue

$results = @{}
$cmdkeyOut = cmdkey /list
$lines = $cmdkeyOut -split "`r?`n"
foreach ($line in $lines) {
    if ($line -match "TERMSRV/([^\s]+)") {
        $t = $matches[1].Trim()
        $pass = [WinCred]::GetPassword("TERMSRV/$t")
        if ($pass) {
            $results[$t] = $pass
        }
    }
}

$results | ConvertTo-Json -Compress

