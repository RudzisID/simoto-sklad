# generate-cert.ps1
# Generates a self-signed TLS certificate for local HTTPS (camera access from phone/tablet)
param(
    [string]$CertDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "cert"),
    [string]$DnsName = "localhost"
)

$KeyFile = Join-Path $CertDir "key.pem"
$CertFile = Join-Path $CertDir "cert.pem"

# Check if cert already exists
if ((Test-Path $KeyFile) -and (Test-Path $CertFile)) {
    Write-Output "OK: Сертификат уже существует"
    exit 0
}

# Create cert directory
New-Item -ItemType Directory -Path $CertDir -Force | Out-Null

try {
    # Generate self-signed certificate
    Write-Output "Генерация сертификата для $DnsName..."
    $cert = New-SelfSignedCertificate `
        -DnsName $DnsName `
        -CertStoreLocation "cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(10) `
        -KeySpec Signature `
        -ErrorAction Stop

    # Export certificate (public key only) as PEM
    $certBase64 = [Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert), 'InsertLineBreaks')
    @"
-----BEGIN CERTIFICATE-----
$certBase64
-----END CERTIFICATE-----
"@ | Out-File -FilePath $CertFile -Encoding ascii

    # Export private key as PKCS#8 PEM (try different methods for compatibility)
    $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    $keyBytes = $null
    
    # Try ExportPkcs8PrivateKey on the RSA object (NET Core 2.0+)
    try {
        $keyBytes = $rsa.ExportPkcs8PrivateKey()
    } catch {
        # Fallback: ExportEncryptedPkcs8PrivateKey with empty password (NET Core 3.0+)
        try {
            $keyBytes = $rsa.ExportEncryptedPkcs8PrivateKey('', 1)
        } catch {
            # Last resort: use cert.Export as PFX and extract via MemoryStream
            $pfxBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, 'simoto')
            [System.IO.File]::WriteAllBytes($CertDir + '\temp.pfx', $pfxBytes)
            Write-Output "WARN: PKCS8 export failed, PFX saved as temp.pfx. Install OpenSSL to convert."
        }
    }
    
    if ($keyBytes -and $keyBytes.Length -gt 0) {
        $keyBase64 = [Convert]::ToBase64String($keyBytes, 'InsertLineBreaks')
        @"
-----BEGIN PRIVATE KEY-----
$keyBase64
-----END PRIVATE KEY-----
"@ | Out-File -FilePath $KeyFile -Encoding ascii
    }

    # Remove from cert store (no longer needed)
    Remove-Item "cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue

    if ((Test-Path $KeyFile) -and (Test-Path $CertFile)) {
        Write-Output "OK: Сертификат создан: $CertFile"
        exit 0
    } else {
        Write-Output "FAIL: Файлы сертификата не найдены после генерации"
        exit 1
    }
} catch {
    Write-Output "FAIL: $_"
    exit 1
}
