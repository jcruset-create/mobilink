<#
    Actualiza el agente sin perder nada.

    Recibe una carpeta con la versión nueva (la que trae `src`, `bandeja` y
    `package.json`) y hace el cambio con red debajo:

      1. para el agente,
      2. aparta la versión actual a `app.anterior`,
      3. copia la nueva,
      4. arranca y COMPRUEBA que responde,
      5. si no responde, deja la anterior donde estaba.

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

    De una carpeta, y punto. NO descarga nada: el canal de publicación (dónde
    se cuelgan las versiones, cómo se firman, cómo se avisa) todavía no está
    decidido, y montar aquí una descarga contra una URL inventada sería peor
    que no tenerla. Lo mecánico —parar, cambiar, comprobar, deshacer— es lo que
    cuesta hacer bien, y es lo que está aquí; enganchar una descarga delante,
    cuando se decida, son cuatro líneas.
#>

param(
    [Parameter(Mandatory = $true)][string] $Nueva,
    [string] $Raiz = "C:\MobilinkAutoScan"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$tarea = "MobilinkAutoScan"
$app = Join-Path $Raiz "app"
$anterior = Join-Path $Raiz "app.anterior"

foreach ($n in @("src", "package.json")) {
    if (-not (Test-Path (Join-Path $Nueva $n))) {
        throw "En $Nueva no hay un agente: falta $n."
    }
}

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

Write-Host "Parando el agente"
Stop-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (Test-Path $anterior) { Remove-Item $anterior -Recurse -Force }
if (Test-Path $app) { Move-Item $app $anterior }

Write-Host "Copiando la version nueva"
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -Path (Join-Path $Nueva "src") -Destination $app -Recurse -Force
Copy-Item -Path (Join-Path $Nueva "bandeja") -Destination $app -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $Nueva "package.json") -Destination $app -Force

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
