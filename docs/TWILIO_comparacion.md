# Twilio · comparación de la URL del webhook

> **RESUELTO · 2026-09-27 · VEREDICTO: COMPATIBLE.**
> Verificado en la consola de Twilio contra producción. El bloqueante de la
> Fase B queda cerrado. El detalle está en la [sección 5](#5-veredicto);
> las secciones 1 a 4 se conservan tal cual porque son el razonamiento que
> llevó a comprobar estos seis campos y no otros.
>
> **Webhook entrante:** `https://sea-tarragona.onrender.com/api/whatsapp/inbound`
> · `POST` · HTTPS · sin query string · sin barra final · fallback URL vacío.
>
> **No se ha cambiado nada en Twilio.** Sólo se ha leído la consola.

Es lo único que bloqueaba la Fase B, y por tanto la Fase D. **No se cambia nada
en Twilio**: solo se lee la consola y se rellena la columna que falta.

---

## 1. Por qué importa tanto acertar

El código que se desplegaría valida la firma de Twilio y, **si no cuadra,
responde `403` y no procesa nada**:

```ts
const firmaValida =
  Boolean(authToken) && Boolean(twilioSig) &&
  urls.some((u) => twilio.validateRequest(authToken, twilioSig!, u, req.body));

if (!firmaValida) {
  console.warn("[whatsapp] firma de Twilio ausente o inválida: petición rechazada.",
               ..., `URLs probadas: ${urls.join(" , ")}`);
  return res.status(403).send("Forbidden");
}
```

> **Si la URL configurada no coincide con ninguna candidata, deja de entrar
> todo el WhatsApp**: citas, recobros, captura y borradores. No es una
> degradación parcial.

Por eso este dato bloquea el despliegue y no se despliega «a ver qué pasa».

### Corrección, de paso

Sobre esas líneas había un comentario mío que describía un diseño intermedio
—«los caminos que ya existían siguen procesándose con firma inválida»— que
**se descartó**. El código rechaza la petición entera desde hace tiempo; el
comentario se quedó diciendo lo contrario. Corregido en esta misma rama.

El guard de `citasWhatsapp/cableado.test.ts` no lo detectó porque compara el
código **sin comentarios**, que es lo correcto para fijar comportamiento y
justamente lo que deja pasar una descripción equivocada.

---

## 2. Lo que hará el servidor · determinado leyendo el código

```ts
const hostLlamado = req.get("x-forwarded-host") || req.get("host");
const candidatos = [
  process.env.PUBLIC_APP_URL,
  hostLlamado ? `https://${hostLlamado}` : "",
  "https://app.mobilink.es",
  "https://sea-tarragona.onrender.com",
]
  .map((u) => String(u || "").trim().replace(/\/+$/, ""))
  .filter((u) => /^https?:\/\//i.test(u));
const urls = [...new Set(candidatos)].map((u) => `${u}/api/whatsapp/inbound`);
```

| Campo | Lo que usará el servidor |
|---|---|
| **Protocolo** | **`https`** siempre, como literal. Nunca se deduce del esquema de la petición |
| **Host** | El de `x-forwarded-host` (o `host`), más `PUBLIC_APP_URL`, `app.mobilink.es` y `sea-tarragona.onrender.com` |
| **Puerto** | Ninguno. No se añade a ninguna candidata |
| **Path** | **`/api/whatsapp/inbound`**, exacto, sin barra final |
| **Query string** | **Ninguna.** La cadena firmada nunca lleva `?…` |
| **Método** | **POST**. La ruta es `app.post(...)` y el cuerpo va `application/x-www-form-urlencoded` |

---

## 3. Lo que hay que leer en la consola de Twilio

**Messaging → Senders → el número de WhatsApp → «A message comes in».**

| # | Campo | Valor configurado |
|---|---|---|
| 1 | URL completa, tal cual, copiada sin retocar | |
| 2 | Método (`HTTP POST` / `HTTP GET`) | |
| 3 | ¿Lleva query string (`?algo=...`)? | |
| 4 | ¿Termina en barra? | |
| 5 | «Primary handler fails» / callback de respaldo, si hay | |
| 6 | Status callback URL, si hay | |

Cópiala **literal**, sin normalizar ni quitar nada: la firma se calcula sobre
la cadena exacta y un detalle que parece cosmético cambia el resultado.

---

## 4. Los cinco modos de fallo, y cuál es probable

Con la URL delante, la comparación es mecánica:

| # | Si la URL configurada… | ¿Falla la firma? | Probabilidad |
|---|---|---|---|
| 1 | **Lleva query string** (`?foo=bar`) | **Sí.** Twilio firma la URL completa, incluido el `?…`; el servidor firma sin él | La más probable |
| 2 | **Termina en `/`** (`…/inbound/`) | **Sí.** El `replace(/\/+$/,"")` recorta las barras del HOST, no del path final | Probable si se escribió a mano |
| 3 | **Usa `http://`** | **Sí.** El servidor construye `https://` siempre | Poco probable |
| 4 | **Tiene otro path** | **Sí** | Poco probable |
| 5 | **Usa GET** | **Sí**, y además la ruta es `app.post` → 404 | Poco probable |
| — | Host distinto de los tres conocidos | **No.** Se deriva de `x-forwarded-host`, que es el nombre por el que Twilio llamó | — |

El host es lo único que está cubierto por construcción. **Los otros cinco
campos hay que mirarlos.**

---

## 5. Veredicto

### 5.1 Criterio, fijado antes de mirar

| Resultado | Condición |
|---|---|
| **COMPATIBLE** | Los seis campos coinciden: `https`, host entre los candidatos, sin puerto, path `/api/whatsapp/inbound` exacto, sin query, método POST |
| **INCOMPATIBLE** | Cualquiera de los cinco modos de fallo |

### 5.2 Dato real de producción · 2026-09-27

Leído en la consola de Twilio (**Messaging → Senders → número de WhatsApp →
«A message comes in»**):

| # | Campo | Valor configurado |
|---|---|---|
| 1 | URL completa, literal | `https://sea-tarragona.onrender.com/api/whatsapp/inbound` |
| 2 | Método | `HTTP POST` |
| 3 | Query string | Ninguna |
| 4 | Barra final | No |
| 5 | «Primary handler fails» / fallback | **Vacío** |
| 6 | Status callback URL | No aplica al webhook entrante |

### 5.3 Comparación campo a campo

| Campo | Configurado en Twilio | Reconstruido por el servidor | ¿Coincide? |
|---|---|---|---|
| Protocolo | `https` | `https` literal en todas las candidatas | **Sí** |
| Host | `sea-tarragona.onrender.com` | candidata 4 de la lista fija | **Sí** |
| Puerto | Ninguno | Ninguno; no se añade | **Sí** |
| Path | `/api/whatsapp/inbound` | `/api/whatsapp/inbound` (sufijo fijo) | **Sí** |
| Query string | Ninguna | Ninguna; nunca se firma con `?…` | **Sí** |
| Método | `POST` | ruta `app.post(...)` | **Sí** |
| Barra final | Ninguna | se recortan con `replace(/\/+$/,"")` | **Sí** |

Los cinco modos de fallo de la sección 4 quedan descartados uno por uno, y el
fallback URL está vacío, así que **no hay una segunda URL que pueda divergir**.

### 5.4 VEREDICTO: **COMPATIBLE**

`twilio.validateRequest()` recibe al menos una candidata idéntica a la cadena
sobre la que Twilio calculó la firma. La firma valida y el webhook procesa.

El riesgo que quedaba abierto —que el endurecimiento a `403` dejara el WhatsApp
mudo en producción— queda **descartado por comparación de campos**, no por
suposición y no desplegando a ver qué pasa.

> Se cierra así **SEC-007** como bloqueante de la Fase B (commits `a8a9a03` y
> `f823973`). Que la firma valide no es lo mismo que decir que el diseño de la
> validación sea el definitivo: ver 5.5.

### 5.5 Observación futura, no bloqueante · estrechar la lista de candidatas

La validación es **tolerante por lista**: prueba hasta cuatro orígenes
(`PUBLIC_APP_URL`, `x-forwarded-host`, `app.mobilink.es`,
`sea-tarragona.onrender.com`). Hoy eso no es explotable —Render reescribe
`x-forwarded-host` con el nombre por el que entró la petición, y los otros tres
son fijos—, y es precisamente lo que hace que el host no pueda fallar.

Pero una lista de candidatas es más superficie que una URL: cuando el host
definitivo esté fijado, lo correcto es firmar contra **una sola** URL de
configuración y dejar de derivarla de una cabecera. Se registra como **deuda**,
con dos condiciones para poder ejecutarla:

- que el dominio definitivo esté decidido (hoy conviven `app.mobilink.es` y
  `sea-tarragona.onrender.com`);
- que el cambio vaya con su propio despliegue, porque equivocarse aquí deja el
  WhatsApp mudo exactamente igual que el fallo que esta comprobación descartó.

**No entra en la Fase B.** No se toca ahora.

## 6. Una comprobación que se puede hacer *después* de desplegar

Si se despliega y algo no cuadra, el propio código lo dice: el `console.warn`
imprime **las URLs que ha probado**. Comparar esa línea del log con la de la
consola de Twilio resuelve el problema en un minuto, sin adivinar.

Merece la pena tenerlo presente en la ventana de observación de la Fase B:
buscar `[whatsapp] firma de Twilio ausente o inválida` en los logs de Render.
