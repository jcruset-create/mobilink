<#
    La bandeja de Windows de Mobilink AutoScan.

    Es PowerShell y no una aplicación de escritorio porque el requisito era
    Node + TypeScript, SIN Electron ni Tauri. `NotifyIcon` viene con .NET, que
    ya está en cualquier Windows: el icono no añade ni una dependencia ni un
    binario que firmar aparte.

    Este script NO sabe nada del agente. Lee `panel.json` —el puerto y el token
    que deja el agente al arrancar— y pregunta por HTTP. Toda la lógica vive en
    el proceso de Node; esto es un icono con un menú.

    Si el agente no está levantado, no hay `panel.json`: el icono se pone en
    gris y el menú lo dice. No se intenta arrancarlo desde aquí — de eso se
    encarga el arranque automático, y dos cosas lanzando el mismo agente acaban
    con dos agentes subiendo los mismos ficheros.
#>

param(
    [string] $Raiz = "C:\MobilinkAutoScan"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$fichero = Join-Path $Raiz "panel.json"

function Get-Panel {
    # Se relee en cada uso a propósito: el token cambia en cada arranque del
    # agente, así que uno guardado al abrir la bandeja dejaría de valer en
    # cuanto el agente se reinicie y el menú se quedaría muerto sin decir nada.
    if (-not (Test-Path $fichero)) { return $null }
    try { return Get-Content $fichero -Raw | ConvertFrom-Json } catch { return $null }
}

function Invoke-Panel {
    param([string] $Ruta, [string] $Metodo = "Get")
    $p = Get-Panel
    if ($null -eq $p) { return $null }
    try {
        return Invoke-RestMethod -Uri "http://127.0.0.1:$($p.puerto)$Ruta" `
            -Method $Metodo -Headers @{ "x-autoscan-panel" = $p.token } -TimeoutSec 10
    } catch {
        return $null
    }
}

$icono = New-Object System.Windows.Forms.NotifyIcon
$icono.Icon = [System.Drawing.SystemIcons]::Application
$icono.Visible = $true
$icono.Text = "Mobilink AutoScan"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$icono.ContextMenuStrip = $menu

function Add-Item {
    param([string] $Texto, [scriptblock] $Accion)
    $it = $menu.Items.Add($Texto)
    $it.add_Click($Accion)
    return $it
}

$itEstado = Add-Item "Ver estado…" {
    $p = Get-Panel
    if ($null -eq $p) {
        [System.Windows.Forms.MessageBox]::Show(
            "El agente no está en marcha.", "Mobilink AutoScan") | Out-Null
        return
    }
    # El token va en la URL porque el navegador no puede mandar cabeceras en una
    # navegación normal. Queda en el historial, y por eso el agente lo cambia en
    # cada arranque: lo que se escape deja de valer al reiniciar.
    Start-Process "http://127.0.0.1:$($p.puerto)/?t=$($p.token)"
}

Add-Item "Sincronizar ahora" { Invoke-Panel "/sincronizar" "Post" | Out-Null } | Out-Null
Add-Item "Reintentar los apartados" {
    $r = Invoke-Panel "/reintentar" "Post"
    $n = if ($null -eq $r) { 0 } else { $r.reencoladas }
    [System.Windows.Forms.MessageBox]::Show(
        "$n documento(s) vuelven a la cola.", "Mobilink AutoScan") | Out-Null
} | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

Add-Item "Abrir la carpeta de escaneos" { Start-Process (Join-Path $Raiz "Inbox") } | Out-Null
Add-Item "Abrir los apartados" { Start-Process (Join-Path $Raiz "Failed") } | Out-Null
Add-Item "Abrir los registros" { Start-Process (Join-Path $Raiz "logs") } | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Cierra el ICONO, no el agente. Se dice así en el menú a propósito: "Salir" a
# secas haría pensar que se ha parado de escanear, y el agente seguiría subiendo
# facturas sin que nadie lo viera.
Add-Item "Ocultar el icono (el agente sigue)" {
    $icono.Visible = $false
    [System.Windows.Forms.Application]::Exit()
} | Out-Null

# El texto del icono es lo que se ve al pasar el ratón, y es todo lo que la
# mayoría va a mirar nunca. Tiene que caber en 63 caracteres: Windows corta.
$reloj = New-Object System.Windows.Forms.Timer
$reloj.Interval = 5000
$reloj.add_Tick({
    $e = Invoke-Panel "/estado"
    if ($null -eq $e) {
        $icono.Text = "Mobilink AutoScan — agente parado"
        $icono.Icon = [System.Drawing.SystemIcons]::Warning
        return
    }
    if (-not $e.activado) {
        $icono.Text = "Mobilink AutoScan — sin activar"
        $icono.Icon = [System.Drawing.SystemIcons]::Warning
        return
    }
    $pend = $e.pendientes + $e.subiendo
    $icono.Text = if ($e.rechazadas -gt 0) {
        "Mobilink AutoScan — $($e.rechazadas) apartado(s), $pend en cola"
    } elseif ($pend -gt 0) {
        "Mobilink AutoScan — $pend en cola"
    } else {
        "Mobilink AutoScan — al día"
    }
    $icono.Icon = if ($e.rechazadas -gt 0) {
        [System.Drawing.SystemIcons]::Warning
    } else {
        [System.Drawing.SystemIcons]::Application
    }
})
$reloj.Start()

$icono.add_DoubleClick({ $itEstado.PerformClick() })

[System.Windows.Forms.Application]::Run()
$icono.Dispose()
