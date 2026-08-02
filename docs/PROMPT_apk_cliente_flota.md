# PROMPT — APK para el cliente de flota (consulta de su flota en el móvil)

> Documento de diseño para implementar DESPUÉS de aprobarlo. Antes de escribir
> código hay que decidir la pregunta de la sección "La decisión de fondo": si
> se resuelve mal, se mantiene una app entera para algo que ya funcionaba.

## Objetivo

Que el responsable de flota de un cliente (ENCATRANS, Autocares Plana…) pueda
consultar desde el móvil **lo mismo que ya ve en el panel**: el informe
ejecutivo con el banco de goma, las alertas, sus vehículos con el plano del
chasis y las profundidades, y el asistente. Solo consulta: **no escribe nada**.

---

## La decisión de fondo: ¿hace falta una APK?

Hay que responder esto antes de nada, porque el panel **ya funciona en el
móvil**: se comprobó a 390 px durante la fase 3 del acceso de cliente y no
desborda; las tablas anchas scrollean dentro de su contenedor y el informe
ejecutivo se lee bien.

Lo que una APK aporta que el panel no:

| Ventaja | ¿Real? |
|---|---|
| Icono en la pantalla de inicio, sin recordar una URL | Sí, y pesa más de lo que parece para un directivo |
| Notificaciones push ("2 neumáticos bajo mínimo en tu flota") | Sí, pero **hoy no hay infraestructura de push**: no hay Firebase ni FCM en el proyecto |
| Consulta sin cobertura | Marginal: consultar la flota es algo que se hace en la oficina o con datos |
| Lector de matrículas por cámara | Interesante, pero es funcionalidad nueva, no "lo mismo que el panel" |

**Recomendación honesta**: antes de una APK nativa, valorar dos caminos más
baratos que cubren la mayor parte del valor:

1. **PWA** — el panel actual con manifiesto e icono instalable. El cliente
   añade "Mobilink TyreControl" a su pantalla de inicio y se abre a pantalla
   completa, sin barra del navegador. Coste: horas, no días. No requiere
   mantener una app aparte ni publicar versiones.
2. **Avisos por WhatsApp o email** — el servidor ya tiene Twilio y nodemailer
   integrados. Un aviso mensual con el resumen de su flota, o inmediato si
   aparece un neumático bajo mínimo, resuelve el "quiero enterarme sin entrar"
   sin necesidad de push nativo.

Si aun así se quiere la APK (presencia de marca, sensación de producto propio,
push nativo), el resto de este documento la especifica. **Pero conviene
decidirlo a sabiendas**: una app más son actualizaciones, firma, releases y
otro sitio donde corregir cada cambio.

---

## Si se hace: app NUEVA, no un modo dentro de la APK del técnico

`tyrecontrol_app` es la APK del técnico: 22 pantallas, sonda Bluetooth
(`flutter_blue_plus`), RFID, OCR, almacén offline con Hive y cola de
sincronización, y login por **nombre + PIN de 4 dígitos**. Meter ahí un modo
cliente sería un error:

- Obligaría al cliente a instalar ~58 MB y aceptar permisos de Bluetooth,
  cámara y ubicación que su uso no necesita.
- Mezclaría dos autenticaciones distintas (PIN de operario vs. email del
  cliente) en la misma pantalla de entrada.
- Cada cambio del flujo del técnico arriesgaría romper el del cliente.

Va una app nueva y pequeña, `tyrecontrol_cliente_app`. El repositorio ya tiene
ocho apps Flutter (`lite_app`, `presencia_app`, `taller_app`…), así que es el
patrón de la casa. `lite_app` sirve de base por sus dependencias mínimas.

---

## Qué existe ya y NO hay que rehacer

| Pieza | Dónde |
|---|---|
| Aislamiento por empresa | RLS de Supabase (`tc_puede_ver_empresa`) y RPC `security invoker` |
| Informe ejecutivo completo | RPC `tc_informe_ejecutivo(empresa, desde, hasta)` — devuelve TODO en un jsonb |
| Alertas | RPC `tc_informes_alertas` |
| Asistente IA acotado al cliente | `POST /api/tyrecontrol/asistente/preguntar` |
| Usuarios cliente, invitación por enlace, permisos por pantalla | Panel, fases 1-4 de `PROMPT_acceso_cliente_flota.md` |

La app **no calcula nada**: pide la RPC y pinta. Si una cifra hay que
cambiarla, se cambia en la migración y cambia a la vez en el panel y en la app.

---

## Reglas que no se negocian

1. **Solo lectura.** La app no tiene ni una pantalla que escriba. Ningún
   `insert`, `update` ni `delete`. Si algún día hace falta, se replantea el
   documento; no se cuela por una esquina.
2. **El aislamiento lo decide el servidor.** La app usa la clave `anon` y la
   sesión del usuario: la RLS hace el resto. Nunca se manda `empresa_id` desde
   el móvil como si fuera de fiar.
3. **Nada interno.** Ni costes, ni productividad de técnicos, ni datos de otros
   clientes. Mismas exclusiones que el panel (fase 1).
4. **Sin permisos que no se usen.** Nada de Bluetooth, ubicación ni cámara
   mientras no haya una función que los necesite. Una app de consulta que pide
   la ubicación al instalarse genera desconfianza con razón.
5. **Nada "para ENCATRANS".** Todo sale de la sesión.

---

## Fases

### Fase 1 — Entrar

El panel usa enlace mágico por email. En móvil hay dos opciones y conviene
elegir la segunda:

- Enlace por email + deep link de vuelta a la app: requiere `intent-filter`,
  App Links verificados y una URL de retorno en la lista de Supabase. Frágil.
- **Código de un solo uso por email (OTP de 6 dígitos)**: `signInWithOtp` y
  `verifyOTP` con `type: 'email'`. El cliente escribe su email, recibe el
  código y lo teclea. Sin deep links, sin dominios verificados, y funciona
  igual en Android y iOS.

Además: sesión persistente (que no pida el código cada vez) y botón de salir.

### Fase 2 — Las tres pantallas que importan

1. **Inicio / Estado de mi flota** — lo mismo que la portada del informe
   ejecutivo: vehículos, % revisado, neumáticos medidos, bajo mínimo,
   profundidad media, y **la tarta del banco de goma con sus colores**. Es la
   pantalla que justifica la app.
2. **Mis vehículos** — lista con buscador; al tocar uno, su ficha: plano del
   chasis con los recuadros pintados por estado y las profundidades y
   presiones por posición. Es lo que más impresiona en una demo y lo que un
   jefe de flota mira de verdad.
3. **Alertas** — neumáticos bajo mínimo y vehículos sin revisar, ordenados por
   urgencia, con la matrícula bien grande.

### Fase 3 — Asistente

Reutilizar `POST /api/tyrecontrol/asistente/preguntar` tal cual: ya resuelve el
alcance por sesión en el servidor. Chat sencillo con las mismas sugerencias del
panel. Si el servidor responde que no hay IA configurada, la pestaña no
aparece.

### Fase 4 — Avisos (solo si se decidió APK por el push)

Si se llega aquí, esto es lo que motivaba la app, así que no se puede quedar a
medias: hace falta Firebase/FCM, tabla de tokens por usuario, y un disparador
en el servidor cuando aparece un neumático bajo mínimo o al cerrar el informe
del mes. **Si no se va a hacer la fase 4, revisar si la APK sigue teniendo
sentido frente a una PWA.**

---

## Qué NO entra

- Escribir nada: ni incidencias, ni fotos, ni firmas.
- Sonda Bluetooth, RFID, OCR: son del técnico.
- Uso sin conexión más allá de recordar la última respuesta ya cargada.
- Marca blanca por cliente (logo y colores propios de ENCATRANS): otro proyecto.

## Criterios de aceptación

1. Un usuario cliente entra con su email y un código de 6 dígitos, y al
   reabrir la app sigue dentro.
2. Ve el estado de su flota y la tarta del banco de goma con las mismas cifras
   que el panel para el mismo periodo.
3. Abre un vehículo y ve el plano con los colores y las profundidades.
4. No existe ningún botón que escriba.
5. Con la sesión de un cliente, un `update` forzado contra Supabase → lo
   rechaza la RLS.
6. La app no declara permisos de Bluetooth, ubicación ni cámara.
7. Instalar la versión siguiente encima de la anterior no pide desinstalar
   (firma estable desde el primer día: reutilizar el keystore y el workflow de
   `build-tyrecontrol-apk.yml`, que ya verifica el certificado con apksigner).
