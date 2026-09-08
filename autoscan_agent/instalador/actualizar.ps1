<#
    Actualiza el agente sin perder nada.

    Recibe la versión nueva —un .zip descargado, o una carpeta ya
    descomprimida— y hace el cambio con red debajo:

      1. prepara la nueva AL LADO, con el agente todavía funcionando,
      2. para el agente,
      3. dos renombrados: la vieja a `app.anterior`, la nueva a `app`,
      4. arranca y COMPRUEBA que responde,
      5. si no responde, deshace los dos renombrados y vuelve la anterior.

    ── Por qué la nueva se prepara ANTES de parar nada ─────────────────────

    Porque descomprimir y copiar tardan, y todo ese rato es tiempo en el que un
    corte de luz —o un Windows que decide reiniciar— deja el mostrador sin
    agente y a medio cambiar. Preparándola al lado, el agente sigue subiendo
    facturas hasta el último segundo y la ventana de peligro se queda en dos
    renombrados, que son instantáneos.

    Esto importa más de lo que parece: quien lanza esta actualización es el
    propio agente, y lo primero que hacemos es matarlo. Cuanto menos quede por
    hacer a partir de ahí, mejor.

    ── Por qué la comprobación del paso 4 ──────────────────────────────────

    Sin ella, una versión rota se instala igual y el agente se queda muerto:
    los escaneos se acumulan en Inbox y nadie se entera hasta que alguien echa
    de menos una factura, días después. El agente ya sabe decir si está vivo
    —su panel contesta— así que la actualización pregunta antes de darse por
    buena.

    ── Lo que esta actualización NO toca ───────────────────────────────────

    Ni la cola, ni las carpetas de escaneos, ni la credencial, ni el
    `config.json`. Solo se cambia `app`. Es lo que permite actualizar con
    documentos pendientes de subir: al arrancar, la versión nueva se encuentra
    la cola tal cual y sigue por donde iba.

    ── De dónde sale la versión nueva ──────────────────────────────────────

    De donde diga quien lo llama, y este guion NO descarga nada. Con `-Zip`, de
    un paquete que ya está en el disco; con `-Nueva`, de una carpeta. Quien
    descarga es el agente (`src/actualizador.ts`), que es quien puede comprobar
    que la versión es más nueva y que la dirección es de donde publica la casa.
    Aquí se confía en el fichero que llega, porque a este punto ya se ha llegado
    con permiso de administrador del PC.
#>

param(
    [string] $Zip,
    [string] $Nueva,
    [string] $Raiz = "C:\MobilinkAutoScan"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $Zip -and -not $Nueva) {
    throw "Hay que decir de donde sale la version: -Zip <paquete.zip> o -Nueva <carpeta>."
}

$tarea = "MobilinkAutoScan"
$app = Join-Path $Raiz "app"
$anterior = Join-Path $Raiz "app.anterior"
$preparada = Join-Path $Raiz "app.nueva"

function Esta-Vivo {
    # `panel.json` lo escribe el agente al arrancar y lo borra al parar, así que
    # su sola presencia no basta: se pregunta.
    $f = Join-Path $Raiz "panel.json"
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        if (-not (Test-Path $f)) { continue }
        try {
            $p = Get-Content $f -Raw | ConvertFrom-Json
            $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($p.puerto)/estado" `
                -Headers @{ "x-autoscan-panel" = $p.token } -TimeoutSec 3
            if ($null -ne $r.version) { return $r.version }
        } catch {
            # Todavía levantando.
        }
    }
    return $null
}

# ── 1. Preparar la version nueva AL LADO, sin tocar la que funciona ─────────

if (Test-Path $preparada) { Remove-Item $preparada -Recurse -Force }
New-Item -ItemType Directory -Force -Path $preparada | Out-Null

if ($Zip) {
    Write-Host "Descomprimiendo el paquete"
    $desempaquetado = Join-Path $Raiz "app.zip.tmp"
    if (Test-Path $desempaquetado) { Remove-Item $desempaquetado -Recurse -Force }
    Expand-Archive -Path $Zip -DestinationPath $desempaquetado -Force

    # El .zip puede traer el agente en la raiz o dentro de una carpeta. Se busca
    # el sitio donde esta `package.json` en vez de exigir una forma concreta:
    # equivocarse aqui deja una `app` vacia, que es de las averias mas tontas.
    $origen = $desempaquetado
    if (-not (Test-Path (Join-Path $origen "package.json"))) {
        $dentro = Get-ChildItem -Path $desempaquetado -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName "package.json") } |
            Select-Object -First 1
        if ($null -eq $dentro) {
            Remove-Item $desempaquetado -Recurse -Force
            Remove-Item $preparada -Recurse -Force
            throw "En $Zip no hay un agente: no se encuentra package.json."
        }
        $origen = $dentro.FullName
    }
} else {
    $origen = $Nueva
}

foreach ($n in @("src", "package.json")) {
    if (-not (Test-Path (Join-Path $origen $n))) {
        throw "En $origen no hay un agente: falta $n."
    }
}

Copy-Item -Path (Join-Path $origen "src") -Destination $preparada -Recurse -Force
Copy-Item -Path (Join-Path $origen "bandeja") -Destination $preparada -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $origen "instalador") -Destination $preparada -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $origen "package.json") -Destination $preparada -Force

if ($Zip) { Remove-Item (Join-Path $Raiz "app.zip.tmp") -Recurse -Force -ErrorAction SilentlyContinue }

# ── 2 y 3. Parar y cambiar. A partir de aqui, cuanto menos se haga, mejor ───

Write-Host "Parando el agente"
Stop-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (Test-Path $anterior) { Remove-Item $anterior -Recurse -Force }
if (Test-Path $app) { Move-Item $app $anterior }
Move-Item $preparada $app

# ── 4. Arrancar y preguntar ────────────────────────────────────────────────

Start-ScheduledTask -TaskName $tarea
$version = Esta-Vivo

if ($null -eq $version) {
    Write-Warning "La version nueva no responde. Se vuelve a la anterior."
    Stop-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Remove-Item $app -Recurse -Force
    Move-Item $anterior $app
    Start-ScheduledTask -TaskName $tarea

    if ($null -eq (Esta-Vivo)) {
        # Las dos muertas es el caso feo, y hay que decirlo entero: no vale
        # dejarlo en «ha fallado» cuando el mostrador se ha quedado sin agente.
        throw "Ni la version nueva ni la anterior arrancan. El agente esta PARADO: los escaneos se acumulan en Inbox sin subir. Revisa $(Join-Path $Raiz 'logs')."
    }
    throw "Actualizacion deshecha: sigue la version anterior, funcionando."
}

Remove-Item $anterior -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Actualizado a $version" -ForegroundColor Green
