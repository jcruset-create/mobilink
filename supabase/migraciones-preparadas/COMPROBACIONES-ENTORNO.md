# Comprobaciones del entorno real, antes de cerrar la Fase 0

Este documento existe porque **no se pueden hacer desde la sesión de trabajo**.
El contenedor donde se ha escrito la Fase 0 no tiene ninguna credencial del
proyecto —no hay `.env`, no hay variables de entorno— y la política de red del
entorno bloquea el host de Supabase: `https://<proyecto>.supabase.co` responde
con fallo de conexión, mientras que `https://sea-tarragona.onrender.com` sí
responde. Así que todo lo que hay aquí lo tiene que ejecutar alguien con acceso.

Las tres primeras secciones son de **solo lectura**. No modifican nada.

---

## 1. Estado real de la base de datos

Ejecutar `verificacion-previa.sql` (en esta misma carpeta) contra la base de
producción, con un rol que pueda leer los catálogos. Devuelve trece bloques:

| # | Qué contesta | Para qué se usa |
|---|---|---|
| 1 | Todas las tablas de `public` sin RLS | La lista REAL. El repositorio solo conoce 88, las creadas en migraciones; hay tablas creadas a mano en el dashboard —`clientes`, `empresas`, `movimientos_stock`, `traspasos`, `perfiles_usuario`, `solicitudes_reposicion`, `productos_neumaticos`, `incidencias`, `inventarios`, `stock_minimos`…— cuyo estado no se puede saber leyendo el código |
| 2 | Qué puede hacer hoy `anon`/`authenticated` sobre ellas | Es exactamente lo que se cierra |
| 3 | Políticas con `USING (true)` o `WITH CHECK (true)` | Dimensiona la Fase 3 (SEC-008) |
| 4 | Políticas abiertas a `anon` | Las que retira la migración (SEC-010) |
| 5 | Cuántas funciones puede ejecutar `anon` | Antes y después |
| 6 | Cuántos superadministradores hay, y cuántos sin email de recuperación | **Decide el diseño de la recuperación de Fase 1C.** Si sale 1, la doble aprobación no se puede montar y hace falta el sobre sellado |
| 7 | Colisiones de nombre de usuario con la normalización fuerte | Adelanto de la Fase 1A. No renombra nada |
| 8 | Recuento de tablas de `public`: total, con RLS y sin RLS | La cifra que pides para distinguir repositorio de producción |
| 9 | Privilegios concedidos a `PUBLIC` | El caso que se nos colaba: `revoke ... from anon` no quita lo de PUBLIC |
| 10 | Funciones por rol, `SECURITY DEFINER`, y cuántas sin `pg_temp` | Dimensiona el hallazgo del `search_path` |
| 11 | Las `SECURITY DEFINER` suplantables por tabla temporal | La lista a barrer en Fase 3 |
| 12 | Buckets de Storage y su visibilidad | SEC-023. Si el rol no ve el esquema `storage`, se mira en el panel de Storage |
| 13 | Si `authenticated` puede crear tablas temporales | Precondición del ataque por `search_path`. Si es falso, el riesgo baja mucho |

**Tablas en producción que no están en migraciones.** No hay consulta directa
que lo diga; se obtiene comparando la salida de la consulta 8 con la lista del
repositorio:

```bash
# En el repositorio, la lista de tablas creadas en migraciones:
grep -rhoiE 'create table (if not exists )?(public\.)?"?[a-z0-9_]+' supabase/migrations/*.sql \
  | sed -E 's/.*(if not exists )?(public\.)?"?//' | sort -u > /tmp/repo.txt
# Y en producción:
psql "$DATABASE_URL" -At -c \
  "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1" | sort -u > /tmp/prod.txt
comm -13 /tmp/repo.txt /tmp/prod.txt   # en producción y NO en el repositorio
comm -23 /tmp/repo.txt /tmp/prod.txt   # en el repositorio y NO en producción
```

La primera lista es la que importa: son tablas cuyo estado de RLS nadie ha
revisado nunca, porque no hay migración que las mencione.

---

## 2. Configuración de Supabase Auth

En el dashboard, **Authentication → Providers / Policies / Settings**. Todo es
lectura; no cambiar nada todavía.

| Qué mirar | Dónde | Por qué importa |
|---|---|---|
| ¿Registro público activo? (`Allow new users to sign up`) | Authentication → Providers → Email | **Si está activo, SEC-008 sube a crítico inmediato**: cualquiera se crea una cuenta y las políticas `USING (true)` le dan los datos de empleados con sus `pin_hash`. Es la comprobación más urgente de esta lista |
| Longitud mínima de contraseña | Authentication → Policies | Hoy el hub sortea el mínimo con el sufijo `#SEA`, así que la entropía real es la del PIN (SEC-064) |
| Protección de contraseñas filtradas | Authentication → Policies | Contención parcial de SEC-064 |
| Límites de intentos de Auth | Authentication → Rate limits | El login del hub va hoy DIRECTO a GoTrue, así que el freno del servidor no lo ve |
| MFA / TOTP disponible o activado | Authentication → Multi-Factor | Requisito de la Fase 1C |
| TTL del access token | Authentication → Sessions (`JWT expiry`) | Es lo que hace viable la Alternativa A: 15 minutos |
| Método de firma del JWT | Authentication → JWT Keys (o Settings → API) | Decide si `server/core/jwt.ts` verifica con JWKS asimétrico o con secreto compartido |
| Disponibilidad de JWKS | `curl https://<proyecto>.supabase.co/auth/v1/.well-known/jwks.json` | Si responde con claves, se verifica en local sin llamar a GoTrue en cada petición |

**Claims reales de un JWT.** Es el dato que bloquea el diseño de la Fase 1A, y
se obtiene sin tocar nada: iniciar sesión en el hub, y en la consola del
navegador

```js
JSON.parse(atob((await supabase.auth.getSession()).data.session.access_token.split('.')[1]))
```

Lo que hay que confirmar que aparece: **`aal`**, **`amr`** (con `method` y
`timestamp` por factor) y **`session_id`**. Si falta alguno, el diseño de MFA de
la Fase 1C cambia, porque el backend no podría distinguir «ha pasado el segundo
factor» de «solo ha puesto la contraseña». Conviene repetirlo después de
completar un TOTP, para ver `aal2` y el `amr` con el factor añadido.

---

## 3. Twilio: la URL del webhook

Esto es lo único que hay que comprobar **antes de mergear** el código de la Fase
0, porque la firma pasa a ser obligatoria.

**Lo que ya se sabe, sin tocar Twilio:**

- El servidor calcula la firma sobre una lista de URLs candidatas
  (`server/index.ts`, en el webhook): `PUBLIC_APP_URL`, `https://` + el host que
  llegó en `x-forwarded-host` o `host`, `https://app.mobilink.es` y
  `https://sea-tarragona.onrender.com`. A cada una le añade
  `/api/whatsapp/inbound`, **sin cadena de consulta**.
- Como una de las candidatas se deriva del host de la propia petición, la firma
  cuadra con el nombre por el que Twilio llame de verdad. Eso quita casi todo el
  riesgo.
- `sea-tarragona.onrender.com` responde 200 y sale por Cloudflare delante de
  Render (`x-render-origin-server: Render`). `app.mobilink.es` resuelve a
  134.0.10.115, que **no es la IP de Render** (216.24.57.18) y no contestó al
  health check. Es decir: si el webhook estuviera configurado en
  `app.mobilink.es`, las peticiones no llegarían a este servicio. Como WhatsApp
  entrante funciona hoy, lo esperable es que Twilio apunte al nombre de Render o
  a otro que sí llega.

**Lo que hay que mirar en la consola de Twilio** (Messaging → tu número o el
Sender de WhatsApp → *A message comes in*):

| Comprobar | Debe ser | Si no |
|---|---|---|
| URL exacta | `https://<host>/api/whatsapp/inbound` | — |
| Esquema | `https` | Con `http` la cadena firmada no coincide: el servidor siempre construye `https` |
| **Cadena de consulta** | ninguna | Twilio firma la URL COMPLETA, con el `?…`. El servidor construye la URL sin él, así que un `?x=1` invalida la firma. Es el riesgo real que queda |
| Path | sin barra final ni prefijos | Una barra final cambia la cadena firmada |
| Método | POST | — |
| Callback de estado | `…/api/whatsapp/status` | Ese sigue sin firma (SEC-038, Fase 4) |

Conviene anotar también si hay más de un Sender o número apuntando al mismo
webhook: todos tienen que cumplir lo de arriba.

---

## 4. Qué hacer con los resultados

- Consulta 1 con tablas que no están en la lista de la migración → decidir sobre
  ellas ANTES de aplicarla, y añadirlas si procede.
- Consulta 6 con un solo superadministrador → hay que diseñar el sobre sellado
  antes de activar el MFA obligatorio (Fase 1C).
- Consulta 7 con colisiones → decidir qué cuenta se renombra antes de la Fase 1A.
- Registro público activo → SEC-008 pasa a lo más urgente, por delante del resto
  de la Fase 3.
- Consulta 13 en falso → el hallazgo del `search_path` baja de prioridad.
- Twilio con cadena de consulta en la URL → **no mergear** hasta arreglarlo, o el
  webhook empezará a devolver 403 a Twilio.
