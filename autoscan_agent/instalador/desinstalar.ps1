<#
    Quita el agente de este PC.

    Lo que se lleva: la tarea programada y la carpeta `app`.

    Lo que NO se lleva, y es a propósito:

    · **Inbox, Sent y Failed.** Son los papeles escaneados del taller. Que un
      desinstalador borre facturas es impensable, y quien desinstala casi nunca
      es quien decide si eso se puede tirar.

    · **La cola** (`data\agent.db`). Puede tener documentos pendientes de subir.
      Borrarla los perdería sin decir nada; dejándola, reinstalar los recupera.

    · **Los registros.** Si se desinstala porque algo iba mal, son justo lo que
      hace falta para saber qué pasaba.

    · **La credencial cifrada.** Se deja porque reinstalar en la misma cuenta la
      reaprovecha y no hace falta gastar otro código de activación. Para irse de
      verdad, `-TodoFuera` la borra — y entonces sí hay que reactivar.

    Con `-TodoFuera` se borra la carpeta entera. Lo dice antes y pide confirmar.
#>

param(
    [string] $Raiz = "C:\MobilinkAutoScan",
    [switch] $TodoFuera
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$tarea = "MobilinkAutoScan"

if (Get-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $tarea -Confirm:$false
    Write-Host "Arranque automatico quitado."
}

# El proceso puede seguir vivo aunque la tarea ya no exista.
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($Raiz, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue

$app = Join-Path $Raiz "app"
if (Test-Path $app) {
    Remove-Item -Path $app -Recurse -Force
    Write-Host "Agente borrado de $app"
}

if ($TodoFuera) {
    $pendientes = @(Get-ChildItem -Path (Join-Path $Raiz "Inbox") -File -ErrorAction SilentlyContinue).Count
    Write-Host ""
    Write-Warning "Se va a borrar TODO en $Raiz, incluidos los escaneos y la credencial."
    if ($pendientes -gt 0) {
        Write-Warning "Hay $pendientes fichero(s) en Inbox SIN SUBIR. Se perderian."
    }
    $r = Read-Host "Escribe BORRAR para confirmar"
    if ($r -ne "BORRAR") {
        Write-Host "No se ha borrado nada mas."
        return
    }
    Remove-Item -Path $Raiz -Recurse -Force
    Write-Host "Borrado $Raiz"
} else {
    Write-Host ""
    Write-Host "Se han dejado los escaneos, la cola, los registros y la credencial en $Raiz"
    Write-Host "Para borrarlo todo: .\desinstalar.ps1 -TodoFuera"
}
