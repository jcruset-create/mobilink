# Twilio · comparación de la URL del webhook

Es lo único que bloquea la Fase B, y por tanto la Fase D. **No se cambia nada
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

| Resultado | Condición |
|---|---|
| **COMPATIBLE** | Los seis campos coinciden: `https`, host entre los candidatos, sin puerto, path `/api/whatsapp/inbound` exacto, sin query, método POST |
| **INCOMPATIBLE** | Cualquiera de los cinco modos de fallo |

Si sale **INCOMPATIBLE**, hay dos salidas y la decisión es tuya:

1. **Cambiar la URL en Twilio** para que case. Es un cambio externo y no está
   autorizado todavía.
2. **Adaptar el servidor** para que firme también la variante configurada. Es
   código, o sea otra vuelta de Fase B.

No propongo ninguna hasta ver el dato.

---

## 6. Una comprobación que se puede hacer *después* de desplegar

Si se despliega y algo no cuadra, el propio código lo dice: el `console.warn`
imprime **las URLs que ha probado**. Comparar esa línea del log con la de la
consola de Twilio resuelve el problema en un minuto, sin adivinar.

Merece la pena tenerlo presente en la ventana de observación de la Fase B:
buscar `[whatsapp] firma de Twilio ausente o inválida` en los logs de Render.
