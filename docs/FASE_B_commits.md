# Fase B · lista exacta de commits

Rama `claude/mobilink-security-5ge9b1` sobre `origin/main` (`593ebd3`).
Generada el 2026-09-27.

El merge es **de la rama entera**: entran los 51 commits. Pero sólo **17 tocan
código que Render ejecuta**; los otros 34 son documentación, SQL preparado —que
esta fase **no** aplica— y pruebas. La distinción importa para el rollback: lo
que se puede revertir «en caliente» está en la primera tabla.

Reproducir esta lista:

```bash
git log --oneline --reverse origin/main..HEAD
```

---

## 1. Los 17 commits con código de ejecución

Son los que cambian el comportamiento en producción al desplegar.

| # | Commit | Qué | Dónde |
|---|---|---|---|
| 1 | `ada924d` | Peticiones salientes con lista blanca de hosts (anti-SSRF) | `server/` |
| 2 | `c5a7f57` | Freno de intentos de autenticación, y `trust proxy` | `server/` |
| 3 | `a8a9a03` | WhatsApp entrante: la firma de Twilio pasa a ser obligatoria | `server/` |
| 4 | `c76135f` | Reset de contraseña acotado por empresa, nunca a un superadmin | `server/` |
| 5 | `05ce493` | Licencias solo superadministrador; el historial no se fía de una cabecera | `server/` |
| 6 | `32e9c22` | Cierra los endpoints que respondían sin ninguna credencial | `server/` |
| 7 | `e1e68fd` | `exigirCredencial` en lugar de `protectWhenStrict` (modo observación) | `server/` |
| 8 | `669da6a` | Las peticiones sin credencial válida pasan a recibir 401 | `server/` |
| 9 | `e50fa0e` | Fuera «sea123»; secretos fuera de URL y logs | `server/` |
| 10 | `dab6577` | El login SSO deja de entregar contraseñas al navegador | `server/` |
| 11 | `fdea8da` | Freno en los seis logins; `files-from-url` deja de leer la red interna | `server/` |
| 12 | `0a31281` | Guardas de no regresión, y versión 1.84.0 | `server/`, `package.json` |
| 13 | `c7b2773` | Connect: un `cc_admin` ya no puede hacerse superadministrador | `server/` |
| 14 | `240b1cd` | `eliminar-auth` autoriza contra la empresa apuntada | `server/` |
| 15 | `d5f383c` | El registro de baja guarda todo lo comprobable después | `server/` |
| 16 | `7a070d3` | Corrección de un comentario engañoso sobre el webhook (**sin cambio de comportamiento**) | `server/` |
| 17 | *(este cambio)* | **Cliente Supabase único**: los tres `createClient` del front pasan a una sola instancia | **`src/`** |

Dos commits de código que **no** afectan al despliegue de Render:

| Commit | Qué | Por qué no |
|---|---|---|
| `f823973` | El guarda del webhook de citas fija la decisión nueva | Sólo pruebas |
| `a686cc2` | Edge Functions: el rol de admin no se le pregunta al interesado | Vive en `supabase/functions/`; su despliegue es la **Fase E** |

### El 17 es distinto de los demás

Los 16 primeros son backend. El 17 toca `src/`, o sea el **bundle del
navegador**. Es el único de la rama que lo hace, y por eso la Fase B pasa a
necesitar smoke tests de navegador (`RUNBOOK_seguridad_fase0.md` §B.3, apartado
4) y no sólo `curl` contra la API.

---

## 2. Los 34 restantes · documentación, SQL preparado y pruebas

No cambian nada de lo que ejecuta Render. Entran porque el merge es de la rama.

| Commit | Qué |
|---|---|
| `ffe52f8` | Migración `001` preparada y **sin aplicar** |
| `26985c7` | Revisión de la migración: cuatro defectos y SEC-067 |
| `e0e7a02` | Arnés de pruebas por HTTP contra el servidor real |
| `2e1327a`, `783e0e3` | Runbook de despliegue y su recuento de commits |
| `fc17f55`, `d4ae6a1`, `eaa913e`, `5bc5a7c` | El arnés HTTP fuera de la suite, la fuga de procesos y las mediciones |
| `fa5544f`, `100927f` | Resultado del PRECHECK y separación de los tres bloqueantes |
| `c1e7fd0`, `57fc836` | Verificación previa para el editor SQL de Supabase |
| `c690d9f`, `f8dad80` | Fotografía real de Supabase y revisión 2 de la migración (PG 17.6) |
| `9d5416a` | Vistas y roles: los dos bloqueantes de la Fase D |
| `e4e5bfa`, `db642e2`, `8a16691` | SEC-068: contención, inventario 14/14 y descripción formal |
| `96646fe`, `1ef0b9f`, `c151772` | SEC-008 ampliado, `005` sin `ALTER DEFAULT PRIVILEGES`, `007b` |
| `2bec5c0`, `f27fcd0` | Restauración mínima antes del rollback, y runbook de contenciones |
| `2dea83a`, `83b8b38` | Evidencia de `007`, la regla GRANT/policy/efectivo, y `007`+`005`+`008` aplicadas |
| `330ea51`, `5e2be8e`, `abd0c50`, `43d0343`, `e494e77`, `d3b7a21` | El diagnóstico de `adm_ot_estado`, hipótesis incluidas, hasta la causa real |

> **Las migraciones de este grupo no se aplican en la Fase B.** `001` es la Fase
> D. `007b` sigue pendiente y no autorizada. `011` está descartada con cabecera
> `NO APLICAR`. Lo que ya está en producción (`007`, `005`, `008`, `014`) se
> aplicó **antes** y por separado: ver `RUNBOOK_contenciones_urgentes.md` §6.

---

## 3. Todo o nada

No se cherry-pickea un subconjunto. Dos motivos concretos, no de principio:

1. El commit 17 cambia el front y los 1-16 el backend. Desplegar unos sin otros
   deja bundle y API en versiones que no se corresponden.
2. Los commits 1 y 2 son módulos (`core/red.ts`, `core/rateLimit.ts`) de los que
   dependen los demás. Sin ellos, los siguientes no compilan.

El orden de la tabla 1 es el orden real de la historia, y es el que hay que
respetar si alguna vez hubiera que rehacer la rama.
