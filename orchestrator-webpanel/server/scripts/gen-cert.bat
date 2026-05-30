@echo off
REM ─────────────────────────────────────────────────────────────────────────
REM  Generate a self-signed TLS certificate for HTTPS=true mode.
REM
REM  Output:
REM    <WORK_DIR>\certs\server.crt
REM    <WORK_DIR>\certs\server.key
REM
REM  Defaults WORK_DIR to the repo root when ORCHESTRATOR_WORK_DIR is unset.
REM  Tries OpenSSL first; falls back to PowerShell New-SelfSignedCertificate.
REM ─────────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion

if "%ORCHESTRATOR_WORK_DIR%"=="" (
  set "WORK_DIR=%~dp0..\..\.."
) else (
  set "WORK_DIR=%ORCHESTRATOR_WORK_DIR%"
)
set "CERT_DIR=%WORK_DIR%\certs"
set "CRT=%CERT_DIR%\server.crt"
set "KEY=%CERT_DIR%\server.key"
set "CN=%~1"
if "%CN%"=="" set "CN=localhost"

if not exist "%CERT_DIR%" mkdir "%CERT_DIR%"

REM Try OpenSSL.
where openssl >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [gen-cert] Using OpenSSL for CN=%CN%
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 ^
    -keyout "%KEY%" -out "%CRT%" ^
    -subj "/CN=%CN%" ^
    -addext "subjectAltName=DNS:%CN%,DNS:localhost,IP:127.0.0.1"
  if %ERRORLEVEL%==0 goto :done
  echo [gen-cert] OpenSSL failed, falling back to PowerShell.
)

echo [gen-cert] Using PowerShell New-SelfSignedCertificate for CN=%CN%
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$cert = New-SelfSignedCertificate -DnsName '%CN%','localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(10) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048;" ^
  "$pwd = ConvertTo-SecureString -String 'orchestrator' -Force -AsPlainText;" ^
  "$pfx = Join-Path '%CERT_DIR%' 'server.pfx';" ^
  "Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null;" ^
  "Remove-Item ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -Force;"

if not exist "%CERT_DIR%\server.pfx" (
  echo [gen-cert] PowerShell generation failed.
  exit /b 1
)

REM Convert PFX → PEM (crt + key) using Node + node-forge if available,
REM otherwise instruct the user to install OpenSSL.
where openssl >nul 2>nul
if %ERRORLEVEL%==0 (
  openssl pkcs12 -in "%CERT_DIR%\server.pfx" -clcerts -nokeys -out "%CRT%" -passin pass:orchestrator
  openssl pkcs12 -in "%CERT_DIR%\server.pfx" -nocerts -nodes  -out "%KEY%" -passin pass:orchestrator
  del "%CERT_DIR%\server.pfx"
) else (
  echo.
  echo [gen-cert] PFX generated at %CERT_DIR%\server.pfx but OpenSSL not on PATH.
  echo            Install OpenSSL or convert the PFX manually to server.crt + server.key.
  exit /b 1
)

:done
echo.
echo [gen-cert] Cert: %CRT%
echo [gen-cert] Key:  %KEY%
echo [gen-cert] Set HTTPS=true in .env to enable TLS.
endlocal
