# AutoScan — la prueba en un Windows de verdad

> **PENDIENTE.** Esto no se ha hecho todavía: hace falta un PC del mostrador
> delante. Es **el trabajo que queda** de AutoScan — el código está entregado y
> en producción, pero nada de lo que toca Windows se ha ejecutado nunca.
>
> Mientras esta prueba no se pase, AutoScan no se despliega en más de un PC.

Guion para llevar al mostrador. Cada paso dice **qué tiene que pasar** y **qué
mirar si no pasa**, porque quien lo ejecute puede no ser quien lo escribió.

**Hazlo en UN solo PC.** El primero es el que descubre los fallos; en veinte a
la vez, los descubre veinte veces.

---

## Antes de ir

**Node 22.6 o superior** en el PC del mostrador:

```powershell
node --version
```

Si falta, Node 22 LTS desde nodejs.org. El instalador **no** instala Node:
comprueba y se para con un mensaje claro.

Ojo con el número: hacen falta **22.6**, no 22.5. `node:sqlite` llegó en la
22.5 pero `--experimental-strip-types` —con lo que se ejecuta el agente, que es
TypeScript sin compilar— llegó en la 22.6. Con la 22.5 el agente arranca y
muere al primer `.ts`.

**Permisos**: rol `responsable` o `admin` en el módulo de caja, que es lo que
deja ver Configuración → Escáneres.

**El paquete**, descargado en ese PC desde la última release `autoscan-v*`:

https://github.com/jcruset-create/mobilink/releases

---

## 1. Instalar

PowerShell **como administrador**, en la carpeta descomprimida:

```powershell
cd C:\temp\mobilink-autoscan\instalador
.\instalar.ps1 -Servidor "https://sea-tarragona.onrender.com"
```

**Tiene que decir:** `Node 22.x`, `Servidor: …`, `Arranque automatico
registrado (MobilinkAutoScan)` y `Listo.` en verde.

**Y tiene que aparecer el icono** junto al reloj. Si el guion termina bien pero
no hay icono, el fallo es de la bandeja y no del agente: son cosas distintas y
conviene no mezclarlas al contarlo.

---

## 2. Arrancar SIN activar

Antes de activar nada: clic derecho en el icono → **Ver estado…**

**Tiene que decir «Sin activar»** y ofrecer pegar el código. Eso es correcto, no
un error: un agente recién instalado no tiene credencial, y salir con error
dejaría al técnico sin bandeja donde escribirlo.

Si el agente se ha muerto: `C:\MobilinkAutoScan\logs\`.

---

## 3. Activar

En Mobilink: **Configuración → Escáneres** → generar código para el centro.

El código se enseña **una vez y no se vuelve a pedir**: mientras vive es una
credencial. Pégalo en la bandeja.

**Tiene que pasar a «Activado · \<centro\>».**

Si falla, el código importa: **401** es código malo o caducado; **403
`LICENCIA_CADUCADA`** es que falta la licencia del módulo, y entonces el código
es bueno.

---

## 4. El escáner

En ScanSnap Home, perfil «Mobilink AutoScan», guardar en:

```
C:\MobilinkAutoScan\Inbox
```

**PDF, color 300 ppp o gris.** Con calidad «Excelente» un lote de pocas hojas
pasa de 15 MB y el servidor lo rechaza con un 400.

Escanea una factura de verdad. En menos de un minuto tiene que:

- desaparecer de `Inbox\` y aparecer en `Sent\`;
- salir en la **bandeja de Cobros** en Mobilink.

Si se queda en `Inbox\`, el agente no lo ve o no lo da por terminado. Si acaba
en `Failed\`, el servidor lo rechazó y el motivo está en la bandeja.

---

## 5. Reiniciar el PC

Reinicia e inicia sesión. El agente tiene que volver **solo** y seguir diciendo
«Activado».

Este paso es el que comprueba **DPAPI** de verdad. Si al volver dice «Sin
activar» o «credencial ilegible», el cifrado no se comporta como esperamos y hay
que arreglarlo antes de seguir: cada reactivación gasta un código.

**Y de paso, la cola:** antes de reiniciar, desconecta la red, escanea un papel,
reinicia con la red aún caída y vuelve a conectarla. El documento tiene que
subir solo, sin que nadie toque nada.

---

## 6. La actualización — el paso que de verdad decide

Necesita que haya publicada una versión **más nueva** que la instalada. Si la
bandeja dice «Ya tienes la última versión», hay que publicar una: cualquier
cambio en `autoscan_agent/` dispara la CI, que sube el número y publica sola.

Entonces: clic derecho → **Actualizar el agente** → «Sí».

**Tiene que pasar:** el agente desaparece unos segundos y vuelve solo con el
número nuevo. La cola y la credencial, intactas.

**Es el punto más incierto de todo AutoScan.** El agente lanza PowerShell y acto
seguido el guion lo mata a él. Se lanza `detached` para que sobreviva, pero
nadie ha comprobado si Windows se lleva el hijo por delante.

Si el agente no vuelve en un minuto:

```powershell
dir C:\MobilinkAutoScan
```

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| `app.anterior` y **no** `app` | Se quedó a medias: el hijo murió con el padre | Renombrar `app.anterior` a `app` y `Start-ScheduledTask -TaskName MobilinkAutoScan` |
| `app` **y** `app.anterior` | La vuelta atrás funcionó; sigues en la versión anterior | Nada. Es el comportamiento correcto ante una versión mala |
| Solo `app` y el agente responde | Fue bien | Nada |

---

## Dar marcha atrás

```powershell
.\desinstalar.ps1
```

---

## Qué anotar cuando algo falle

1. En qué paso.
2. El texto exacto del error.
3. El fichero del día de `C:\MobilinkAutoScan\logs\`.
4. Qué hay en `Inbox\`, `Sent\` y `Failed\`.

Con eso se arregla con el dato delante. Sin eso, adivinando.
