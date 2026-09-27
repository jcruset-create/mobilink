# SEC-008 · ampliación con evidencia de producción

> **Formulación anterior.** Políticas permisivas en el módulo Safety exponen
> datos de empleados a la clave publicable.
>
> **Formulación ampliada (2026-09-27).** Diez tablas del módulo Safety conceden
> a `anon` una política `ALL using (true) with check (true)`. La clave
> publicable embebida en las APK no solo **lee** el fichero de personal: puede
> **modificarlo y borrarlo**, junto con los registros de formación,
> certificaciones y autorizaciones para trabajos de riesgo.

**No se abre un SEC nuevo.** Es exactamente la superficie que SEC-008 ya
cubría: las políticas permisivas de `sea_*`. Lo que cambia es que la auditoría
la describió como exposición de lectura, y la evidencia de producción demuestra
que también es de escritura.

**Severidad revisada: CRÍTICA.** Y por impacto es la prioridad número uno, por
delante de SEC-068 y de SEC-002.

---

## 1. Por qué el impacto real es mayor que una fuga

Una fuga de datos es grave y se notifica. Esto además permite **alterar la
evidencia de habilitación del personal**:

| Tabla | Qué acredita | Qué permite hacer hoy `anon` |
|---|---|---|
| `sea_employee_authorizations` | Que un trabajador está autorizado a una tarea de riesgo | Crear, modificar y borrar autorizaciones |
| `sea_employee_certifications` | Certificaciones en vigor | Igual |
| `sea_training_records` | Formación recibida | Igual |
| `sea_employee_competencies` | Competencias reconocidas | Igual |
| `sea_employees` | La ficha de la persona | Modificar DNI, NSS, domicilio, `pin_hash`, `codigo_operario`, fecha de baja |

Sin dejar rastro de quién lo hizo: no hay identidad detrás de `anon`.

---

## 2. Matriz de uso · las ocho apps y el panel

Barrido estático de `src/`, los ocho `*_app/lib`, `server/` y
`supabase/functions/`, buscando `.from('<tabla>')` y la operación encadenada.

| Tabla | Cliente | SELECT anon | INSERT | UPDATE | DELETE | Vía |
|---|---|---|---|---|---|---|
| `sea_employees` | portal anónimo | **sí** | no | no | no | directa |
| `sea_employees` | panel autenticado | n/a | sí | sí | no | directa |
| `sea_employees` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_companies` | panel autenticado | n/a | sí | sí | no | directa |
| `sea_companies` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_work_centers` | panel autenticado | n/a | sí | sí | no | directa |
| `sea_work_centers` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_authorizations` | panel autenticado | n/a | sí | sí | no | directa |
| `sea_authorizations` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_competencies` | panel autenticado | n/a | sí | sí | no | directa |
| `sea_competencies` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_employee_authorizations` | portal anónimo | **sí** | no | no | no | directa |
| `sea_employee_authorizations` | panel autenticado | n/a | sí | no | sí | directa |
| `sea_employee_authorizations` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_employee_certifications` | portal anónimo | **sí** | no | no | no | directa |
| `sea_employee_certifications` | panel autenticado | n/a | sí | no | sí | directa |
| `sea_employee_certifications` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_employee_clothing` | portal anónimo | **sí** | no | no | no | directa |
| `sea_employee_clothing` | panel autenticado | n/a | sí | sí | no | directa |
| `sea_employee_clothing` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_employee_competencies` | portal anónimo | **sí** | no | no | no | directa |
| `sea_employee_competencies` | panel autenticado | n/a | sí | no | sí | directa |
| `sea_employee_competencies` | **las 8 APK** | **ninguna** | no | no | no | — |
| `sea_training_records` | portal anónimo | **sí** | no | no | no | directa |
| `sea_training_records` | panel autenticado | n/a | sí | no | sí | directa |
| `sea_training_records` | **las 8 APK** | **ninguna** | no | no | no | — |

### 2.1 Lo que dice la matriz, en una línea

**Ninguna de las ocho APK toca estas diez tablas**, ni siquiera para leer.

Los únicos clientes son:

| Quién | Identidad | Qué hace |
|---|---|---|
| `src/pages/PortalLogin.tsx` | **`anon`** | `select` de `sea_employees` |
| `src/pages/PortalFicha.tsx` | **`anon`** | `select` de 6 de las 10, con embebidos de `sea_companies` y `sea_work_centers` |
| `src/pages/SeaHub.tsx` (ruta pública `/sea`) | **`anon`** | `select` de 3 de las 10 |
| Páginas de `sea-core`, `safety`, `presencia`, `administracion` | autenticada | lectura y escritura |
| `supabase/functions/alertas-email` | `service_role` | `select` |
| `server/index.ts` | `service_role` | `select` |

### 2.2 Vías indirectas · comprobadas y descartadas

| Vía | Resultado |
|---|---|
| **RPC que escriba** | **Ninguna.** No hay `insert/update/delete` sobre `sea_*` en ninguna función de `supabase/migrations/`, y ningún cliente llama a una RPC de Safety |
| **Escritura por vista** | **Ninguna.** Ninguna de las 14 vistas de `public` tiene una tabla `sea_*` como base |
| `upsert` | No aparece sobre estas tablas en ningún cliente |

**Conclusión: ningún cliente legítimo escribe con `anon`.** La contención de
escritura es segura.

---

## 3. `sea_employees` · inventario de columnas sensibles

Las 28 columnas, confirmadas en producción. Clasificadas:

| Clasificación | Columnas |
|---|---|
| **Documento de identidad** | `dni_nie` |
| **Seguridad Social** | `num_seguridad_social` |
| **Domicilio** | `direccion`, `codigo_postal`, `poblacion`, `provincia` |
| **Material de autenticación** | `pin_hash`, `codigo_operario` |
| **Identificadores internos** | `id`, `user_id` (enlace a `auth.users`), `work_center_id` |
| **Empresa** | `company_id` |
| Contacto personal | `telefono`, `email` |
| Laborales | `cargo`, `departamento`, `rol`, `fecha_alta`, `fecha_baja`, `activo`, `roadside_capable`, `observaciones` |
| Otros | `nombre`, `apellidos`, `foto_url`, `ultimo_acceso`, `created_at`, `updated_at` |

Certificados y autorizaciones no están en esta tabla: viven en
`sea_employee_certifications` y `sea_employee_authorizations`, enlazadas por
`employee_id`, y las dos están entre las diez.

### 3.1 `pin_hash` y `codigo_operario` · lo que la contención NO resuelve

La contención de escritura **no toca la lectura**, y eso hay que decirlo sin
adornos:

> Después de aplicar la contención, `anon` sigue pudiendo leer el DNI, el
> número de la Seguridad Social, el domicilio, el `pin_hash` y el
> `codigo_operario` de cada empleado activo.

Queda **EXPRESAMENTE ABIERTO** hasta migrar el login a identidad de servidor.
No se cierra ahora porque `/portal` y `/portal/mi-ficha` dependen de esa
lectura y no tienen otra forma de identificar al empleado.

Sobre `pin_hash`: que sea un hash reduce el daño, no lo elimina. Un hash
expuesto se ataca sin límite de intentos ni registro, y si el PIN es de cuatro
o seis dígitos el espacio de búsqueda es trivial. Se trata como material de
autenticación expuesto, no como un dato técnico inocuo.

---

## 4. La contención propuesta · mínima

`supabase/migraciones-preparadas/007_contencion_safety.sql`. **Sin aplicar.**

| Qué hace | Qué NO hace |
|---|---|
| Retira las 10 políticas `ALL` de `anon` | No toca la lectura |
| Crea 2 políticas de solo lectura, para `sea_companies` y `sea_work_centers`, que no tenían otra | No toca `sea_auth_all`, de la que depende el panel |
| Retira los grants de `insert`, `update` y `delete` a `anon` y a `PUBLIC` | No toca las 8 apps, que no usan estas tablas |

Las dos políticas nuevas no son adorno: `PortalFicha.tsx:103` hace
`.select("*, sea_companies(nombre), sea_work_centers(nombre)")`, y un embebido
de PostgREST exige permiso de RLS sobre la tabla embebida. Sin ellas, la ficha
del empleado deja de cargar. Es el tipo de rotura que no se ve leyendo la
política, solo mirando quién la usa.

### 4.1 Un cambio de comportamiento, declarado

Hoy `sea_anon_all` (`using (true)`) deja a `anon` leer también a los empleados
**dados de baja**. Al retirarla, la lectura queda en `portal_anon_employees`,
que es `activo = true`.

`anon` deja de poder leer la ficha de un ex-empleado. Los dos consumidores ya
filtran por activo, así que no rompe nada, y está comprobado en el banco de
pruebas. Si se prefiere no cambiar ni eso, la alternativa está indicada en el
fichero.

---

## 5. Resultado en PostgreSQL 17.6

`bash scripts/probar-contenciones-pg17.sh` — instancia local y efímera.

| | Antes | Después |
|---|---|---|
| `anon` modifica el fichero de personal | **sí** | **denegado** |
| `anon` borra registros de formación | **sí** | **denegado** |
| `anon` inserta autorizaciones de riesgo | **sí** | **denegado** |
| El portal lee al empleado | sí | **sigue** |
| Embebido de empresa y centro | sí | **sigue** |
| SeaHub lee formación | sí | **sigue** |
| El panel autenticado escribe | sí | **sigue** |
| `anon` lee el `pin_hash` | sí | **sigue — abierto a propósito** |
| `anon` lee a un empleado de baja | sí | **no** (cambio declarado) |

Doble aplicación sin error, y vuelta atrás comprobada: restaura la escritura.

---

## 6. Lo que queda abierto después de esto

| | Estado |
|---|---|
| Escritura anónima sobre Safety | **cerrada** por 007 |
| **Lectura anónima de DNI, NSS, domicilio, `pin_hash`** | **ABIERTA.** Requiere el cambio de login. Fase 1/3 |
| `sea_auth_all` (`ALL to authenticated using (true)`) | **ABIERTA.** Cualquier autenticado del proyecto escribe estas diez tablas. Mismo patrón que `pres_auth_all` y `sm_auth_all`, y misma solución: acotar por empresa. Va con SEC-010 |
