<#
    Instalador de Mobilink AutoScan.

    Copia el agente, prepara las carpetas, lo deja arrancando solo y enciende
    la bandeja. Se ejecuta UNA vez por PC, con la sesión de la persona que va a
    usar el escáner.

    ── Por qué una TAREA PROGRAMADA y no un servicio de Windows ─────────────

    Es la decisión más importante de este fichero y no es una preferencia.

    La credencial del dispositivo se cifra con DPAPI en ámbito `CurrentUser`
    (ver src/dpapi.ts). Un servicio corre como SYSTEM o como una cuenta de
    servicio, y desde ahí la credencial cifrada por la cuenta de recepción **no
    se puede descifrar**: el agente arrancaría, no podría leer su credencial y
    pediría activarse otra vez en cada reinicio. Y el código de activación se
    gasta al usarlo.

    Además la bandeja necesita una sesión interactiva: un servicio no puede
    pintar un icono junto al reloj.

    Así que arranca al iniciar sesión, con la cuenta del usuario. La
    contrapartida es real y hay que saberla: si nadie inicia sesión en ese PC,
    el agente no corre. En un mostrador eso no pasa —el PC se usa—, y a cambio
    la credencial queda atada a la cuenta que la activó, que es exactamente lo
    que se quería.

    ── Qué NO hace ─────────────────────────────────────────────────────────

    No instala Node: comprueba que está y, si no, dice qué hace falta. Meter un
    instalador de Node dentro de otro instalador es la clase de cosa que deja
    dos versiones peleándose en el PATH.

    No pide el código de activación. Eso se hace desde la bandeja, con el
    agente ya en marcha, y así el código no queda escrito en ningún sitio.
#>

param(
    [string] $Raiz = "C:\MobilinkAutoScan",
    [Parameter(Mandatory = $true)][string] $Servidor,
    [string] $Origen = (Join-Path $PSScriptRoot "..")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "Instalando Mobilink AutoScan en $Raiz"

# ── Node ────────────────────────────────────────────────────────────────────
# Se exige 22.5 porque el agente usa `node:sqlite`, que no existe antes. Fallar
# aquí con un mensaje claro es mucho mejor que fallar al arrancar con un
# «cannot find module node:sqlite» que no le dice nada a nadie.
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    throw "No se encuentra Node.js. Instala Node 22 LTS desde https://nodejs.org y vuelve a ejecutar esto."
}
$version = (& node --version).TrimStart("v")
$partes = $version.Split(".")
if ([int]$partes[0] -lt 22 -or ([int]$partes[0] -eq 22 -and [int]$partes[1] -lt 6)) {
    # 22.6 y no 22.5: `node:sqlite` llegó en la 22.5, pero
    # `--experimental-strip-types` —con lo que se ejecuta el agente, que es
    # TypeScript sin compilar— llegó en la 22.6. Con 22.5 el agente arrancaría
    # y moriría al primer `.ts`.
    throw "Node $version es demasiado antiguo. El agente necesita 22.6 o superior."
}
Write-Host "  Node $version"

# ── Carpetas ────────────────────────────────────────────────────────────────
# `Inbox` es la que se teclea en el perfil de ScanSnap Home, y por eso la ruta
# es corta y predecible: se dicta por teléfono.
$app = Join-Path $Raiz "app"
foreach ($d in @($Raiz, $app, (Join-Path $Raiz "Inbox"), (Join-Path $Raiz "Sent"),
                 (Join-Path $Raiz "Failed"), (Join-Path $Raiz "data"), (Join-Path $Raiz "logs"))) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ── El agente ───────────────────────────────────────────────────────────────
Write-Host "  Copiando el agente"
Copy-Item -Path (Join-Path $Origen "src") -Destination $app -Recurse -Force
Copy-Item -Path (Join-Path $Origen "bandeja") -Destination $app -Recurse -Force
Copy-Item -Path (Join-Path $Origen "package.json") -Destination $app -Force

# `instalador` tambien, y no es por completitud: dentro va `actualizar.ps1`, que
# es lo que el agente busca en `app\instalador\` cuando alguien pulsa
# "Actualizar el agente" en la bandeja. Sin esta linea, la primera actualizacion
# de cada PC recien instalado falla por no encontrar el guion.
Copy-Item -Path (Join-Path $Origen "instalador") -Destination $app -Recurse -Force

# ── Configuración ───────────────────────────────────────────────────────────
# Solo lo que no es secreto. La credencial NO va aquí: la entrega el servidor al
# activar y vive cifrada con DPAPI. Un config.json en texto plano en el PC de
# recepción es justo lo que se está evitando.
$config = @{ servidor = $Servidor } | ConvertTo-Json
Set-Content -Path (Join-Path $Raiz "config.json") -Value $config -Encoding UTF8
Write-Host "  Servidor: $Servidor"

# ── Arranque automático ─────────────────────────────────────────────────────
# Al iniciar sesión, con la cuenta del usuario. Ver la explicación de arriba:
# con un servicio, DPAPI no podría descifrar la credencial.
$tarea = "MobilinkAutoScan"
$entrada = Join-Path $app "src\arrancar.ts"
$bandeja = Join-Path $app "bandeja\bandeja.ps1"

$accionAgente = New-ScheduledTaskAction -Execute $node.Source `
    -Argument "--experimental-strip-types `"$entrada`"" -WorkingDirectory $app
$accionBandeja = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$bandeja`" -Raiz `"$Raiz`""

$disparador = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Sin límite de duración: es un proceso que vive siempre. Por defecto, el
# programador de tareas mata las tareas a los 3 días, y el agente se apagaría
# solo el jueves sin que nadie entendiera por qué.
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $tarea -Force `
    -Action @($accionAgente, $accionBandeja) -Trigger $disparador -Settings $ajustes `
    -Description "Mobilink Cash AutoScan: vigila la carpeta del escaner y entrega las facturas." | Out-Null
Write-Host "  Arranque automatico registrado ($tarea)"

# ── En marcha ───────────────────────────────────────────────────────────────
Start-ScheduledTask -TaskName $tarea
Write-Host ""
Write-Host "Listo." -ForegroundColor Green
Write-Host "Queda UNA cosa, y se hace desde el icono de la bandeja:"
Write-Host "  1. Clic derecho en el icono de Mobilink AutoScan (junto al reloj)."
Write-Host "  2. «Ver estado…» y pegar el codigo de activacion del modulo de caja."
Write-Host ""
Write-Host "Y en ScanSnap Home, el perfil «Mobilink AutoScan» tiene que guardar en:"
Write-Host "  $(Join-Path $Raiz 'Inbox')" -ForegroundColor Yellow
Write-Host "en PDF, color 300 ppp o gris. Con «Excelente» un lote de pocas hojas"
Write-Host "pasa de 15 MB y el servidor lo rechaza."
