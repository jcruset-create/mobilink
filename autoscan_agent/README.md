# Agente de Mobilink Cash AutoScan

Vigila la carpeta donde el escáner deja los PDF y los entrega a la bandeja de
AutoScan del módulo de caja. Corre en el PC de recepción, en Windows.

## Instalar

Con la sesión de Windows **de la persona que va a usar el escáner** — no con
otra cuenta, y no como administrador de dominio (ver más abajo por qué):

```powershell
cd autoscan_agent\instalador
.\instalar.ps1 -Servidor https://sea-tarragona.onrender.com
```

Hace falta **Node 22.6 o superior**. El instalador lo comprueba y se para con
un mensaje claro si no está: no lo instala él, porque un instalador de Node
dentro de otro instalador acaba dejando dos versiones peleándose en el PATH.

Después, **una sola cosa más**, desde el icono de la bandeja: clic derecho →
«Ver estado…» → pegar el código de activación que da el módulo de caja
(Configuración → Dispositivos de AutoScan). El código no se escribe en ningún
fichero ni se pide durante la instalación.

## ScanSnap Home

El perfil «Mobilink AutoScan» del iX1500 tiene que guardar en:

```
C:\MobilinkAutoScan\Inbox
```

en **PDF**, y en **color 300 ppp o gris**. Con la calidad «Excelente» un lote
de pocas hojas pasa de 15 MB, que es el tope del servidor: el agente lo aparta
a `Failed` y lo dice, pero hay que volver a escanearlo.

## Las carpetas

| Carpeta   | Qué hay                                                         |
|-----------|-----------------------------------------------------------------|
| `Inbox`   | Lo que deja el escáner. Es la única que se vigila.              |
| `Sent`    | Lo que el servidor ya tiene. **No se borra nunca.**             |
| `Failed`  | Lo que el servidor rechazó por lo que es (tamaño, formato).     |
| `data`    | La cola (SQLite). Sobrevive a los reinicios y a los cortes.     |
| `logs`    | Un fichero por día. Se borran solos al mes.                     |

El agente **no borra ningún documento, nunca**. Si el módulo perdiera un
escaneo, el papel sigue en el PC del taller.

## Arranca al iniciar sesión, y no es un servicio

Es una tarea programada que arranca con la cuenta del usuario, y la razón no es
la comodidad: la credencial del dispositivo se cifra con **DPAPI en ámbito de
usuario**. Un servicio corre como SYSTEM y desde ahí esa credencial **no se
puede descifrar** — el agente pediría activarse otra vez en cada reinicio, y
cada activación gasta un código.

La contrapartida, que conviene saber: **si nadie inicia sesión en ese PC, el
agente no corre**. En un mostrador no pasa. Y por eso importa instalarlo con la
cuenta que se usa a diario: la credencial queda atada a ella.

## Actualizar

```powershell
.\actualizar.ps1 -Nueva C:\ruta\a\la\version\nueva
```

Para, cambia, arranca y **comprueba que el agente responde**. Si la versión
nueva no levanta, vuelve sola a la anterior. No toca la cola, ni los escaneos,
ni la credencial: se puede actualizar con documentos pendientes de subir.

No descarga nada. El canal de publicación —dónde se cuelgan las versiones y
cómo se firman— **está sin decidir**; lo que está resuelto aquí es el cambio
en sí, que es la parte que puede dejar un mostrador sin agente.

## Desinstalar

```powershell
.\desinstalar.ps1
```

Quita el arranque automático y el programa. **Deja** los escaneos, la cola, los
registros y la credencial: quien desinstala casi nunca es quien decide si esas
facturas se pueden tirar, y reinstalar en la misma cuenta reaprovecha la
credencial sin gastar otro código. Para borrarlo todo, `-TodoFuera`, que avisa
de cuántos ficheros quedan sin subir y pide confirmación.

## Si algo va mal

El icono de la bandeja ya lo dice: en gris si el agente no está, con aviso si
hay documentos apartados. «Ver estado…» abre la pantalla con la cuenta de lo
que hay en cola, lo entregado y lo apartado, y dos botones: sincronizar ahora y
reintentar lo apartado.

Para pedir ayuda, el registro del día: `C:\MobilinkAutoScan\logs\agente-AAAA-MM-DD.log`.
Se puede mandar sin miedo — **no lleva credenciales**: lo que huele a secreto se
tapa antes de escribirlo.
