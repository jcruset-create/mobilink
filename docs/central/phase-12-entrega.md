# Fase 12 — Entrega: API canónica, acceso máquina-a-máquina y webhooks

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.36`
- Cierra **R8 (HIGH)** y decide **R13**.

## R8: no existía forma de que un programa hablara con Mobilink

Toda la API exigía el Bearer de una sesión de Supabase, o sea, **un usuario con su contraseña**. Un
proceso desatendido —el conector de una ERP, un cuadro de mando, un script nocturno— tenía que usar
la cuenta de una persona. Eso hereda todos sus permisos, y el día que esa persona se va, la
integración deja de funcionar sin que nadie sepa por qué.

## Qué es y qué no es «OAuth2» aquí

Se implementa **`client_credentials`**, que es el único flujo de OAuth2 con sentido sin usuario
delante: un cliente cambia su identificador y su secreto por un testigo de vida corta. **No hay
servidor de autorización**, ni códigos, ni refresco, ni consentimiento — porque no hay a quién
pedírselo. Llamarlo «OAuth2» a secas sería prometer de más.

Lo que sí se respeta es **la forma de petición y respuesta del estándar** (`grant_type`,
`access_token`, `expires_in`, `scope`, y errores como `invalid_client` o `insufficient_scope`), para
que cualquier cliente lo entienda sin documentación especial.

## Decisiones de seguridad

**Los secretos no se guardan.** Ni el del cliente ni el testigo: de los dos solo queda su huella. Una
copia de la base de datos no da acceso a nada. El secreto se enseña **una sola vez**, al crearlo; si
se pierde, se genera otro. No hay forma de recuperarlo, y esa es exactamente la propiedad que se
busca.

**Revocar corta en el momento.** Desactivar un cliente **borra además sus testigos vivos**. Sin eso,
seguiría entrando hasta una hora más: justo el rato en el que a alguien le urge cortarle el acceso.
Hay una prueba para ello.

**Un fallo indistinguible** para «cliente que no existe» y «secreto incorrecto». Distinguirlos
permitiría enumerar clientes válidos.

**Comparación en tiempo constante.** Con `===`, el tiempo de respuesta filtra cuántos caracteres van
bien, y con suficientes intentos eso es adivinar el secreto carácter a carácter.

**La API va versionada desde el primer día** (`/api/central/v1`). Un integrador que no controlas no
se actualiza cuando tú quieres, así que la primera vez que cambie la forma de una respuesta habrá que
servir las dos a la vez. Ponerlo ahora no cuesta nada; después, obliga a romper a quien ya integraba.

**Dos perímetros separados.** `/api/central/v1/*` se autentica con testigo de cliente; el resto, con
la sesión del usuario. No comparten middleware: mezclarlos es como se cuelan los permisos de un lado
al otro.

## Webhooks

Misma cola y mismos reintentos que los avisos por correo, porque el problema es el mismo: **un destino
caído no puede tumbar lo que generó el evento**.

Lo que cambia es la firma. Cada envío lleva un HMAC del cuerpo — sin ella, cualquiera que averiguara
la URL podría inventarse un cierre de caja de 40.000 € y el receptor no tendría forma de
distinguirlo. **La marca de tiempo entra en la firma**, no solo el cuerpo, para que un envío legítimo
capturado no se pueda reenviar para siempre.

El formato es `t=<ms>,v1=<hmac>`, el mismo de Stripe y GitHub: quien haya integrado uno de esos ya
sabe verificarlo.

**Solo HTTPS**: por ahí viajan cierres de caja e importes. Y **la firma vive en su propio módulo sin
base de datos** (`api/signature.ts`) — es la parte que un integrador implementa del otro lado, así
que tiene que poder probarse sola. Cuando estaba junto al envío no se podía ni importar sin
`DATABASE_URL`.

## R13: qué mecanismo es el canónico

La auditoría señaló dos mecanismos de integración conviviendo. La decisión, y **no se ha añadido un
tercero**:

- **Hacia dentro** (programas que consultan Mobilink): la API de MC Central, `/api/central/v1`. Es lo
  que se ha construido aquí.
- **Hacia fuera, por evento**: los webhooks de esta fase.
- **Hacia fuera, contra una ERP concreta**: sigue siendo `ICashErpConnector` con su outbox, que ya
  está probado y en producción. La fase 13 escribe el primero real.
- **`server/integration-hub/`** se queda como está, con sus propios conectores. No se toca en esta
  fase, pero **no debería crecer para cubrir lo de caja**: eso ya tiene sitio.

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1187 / 1187** en las dos |
| Firma de webhooks (unitarias, sin BD) | 5 / 5 |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | `server/central` sin ningún aviso |

Siete pruebas de integración: el secreto no se guarda en claro; un secreto equivocado no da testigo;
**revocar invalida los testigos en el momento**; un testigo caducado deja de valer; el webhook no se
duplica; solo llega lo suscrito; y sin HTTPS se rechaza.

## Lo que queda

- **Pantalla de integraciones**: la API está (`/integrations`, `/api-clients`, `/webhooks`); falta
  dónde pulsarla, y tiene que enseñar el secreto una sola vez con ese aviso.
- **Webhooks de entrada** (`invoice.created`…): el modelo los admite desde la fase 1 del módulo de
  caja, pero no hay endpoint de recepción.
- **Más eventos**: hoy sale `incident.opened`. Cierres y cuadres son los siguientes candidatos.
