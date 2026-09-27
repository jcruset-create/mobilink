# Runbook · aplicación de las tres contenciones urgentes

**Autorizado el 2026-09-27.** Secuencial, con parada obligatoria entre cada
una. Nada de esto está aplicado en el momento de escribir este documento.

---

## 0. Quién ejecuta

**Yo no puedo.** Este contenedor no alcanza Supabase: el proxy devuelve 403 a
`*.supabase.co`, y así ha sido toda la intervención. Las tres migraciones, la
fotografía previa y los postchecks los ejecutas tú en el editor SQL, igual que
las consultas de lectura anteriores.

Lo que aporto es que cada paso sea mecánico: qué pegar, qué tiene que salir, y
cuándo parar.

---

## 1. PASO 0 · Fotografía previa, en lectura

Antes de tocar nada:

```
supabase/migraciones-preparadas/009_fotografia_previa.sql
```

Una sola sentencia. **Guarda la salida con fecha y hora**: es la fuente de
verdad de la vuelta atrás.

### Por qué no basta el rollback ya escrito

Tu punto 7 destapó un hueco real. Los rollbacks de 005, 007 y 008 devuelven
`select, insert, update, delete`. Pero las migraciones hacen `revoke all`, y
«all» incluye además **`TRUNCATE`, `REFERENCES`, `TRIGGER` y `MAINTAIN`**.

Las fotografías del 26 y del 27 solo capturaron las cuatro primeras, así que
**no se sabía** si `anon` tenía alguna de las otras. En el laboratorio, con los
privilegios por defecto de Supabase reproducidos, **sí las tiene**: una vista
creada después de `alter default privileges ... grant all` nace con las siete.

Por eso `009` no solo mide: **genera el SQL de restauración exacto**, línea a
línea, a partir de lo que hay de verdad. Esos campos son:

| Campo de la salida | Para qué |
|---|---|
| `rollback_generado_grants` | Los `grant` exactos, con todos los tipos de privilegio |
| `rollback_generado_politicas` | Las diez políticas de Safety recreadas idénticas, con su predicado |
| `rollback_generado_reloptions` | El estado de `security_invoker` de `adm_ot_estado` |

**Usa ese texto generado, no el rollback escrito en los ficheros.** El de los
ficheros queda como referencia de intención; el generado es el que no concede
ni de más ni de menos.

---

## 2. PASO 1 · Aplicar 007 · Safety

```
supabase/migraciones-preparadas/007_contencion_safety.sql
```

Cierra la capacidad anónima de **modificar y borrar** personal, formación,
certificaciones, competencias y autorizaciones para trabajos de riesgo.
Conserva las lecturas que hoy necesitan el portal y SeaHub.

### Postcheck

Bloque «POSTCHECK DE 007» de `010_postchecks.sql`. **Diez filas, las diez OK.**
Un solo FALLO y se para.

| # | Qué comprueba | Esperado |
|---|---|---|
| 1 | Policies de escritura de `anon` sobre `sea_*` | 0 |
| 2 | Policies de `anon` con `WITH CHECK` | 0 |
| 3-5 | Tablas donde `anon` puede INSERT / UPDATE / DELETE | 0, 0, 0 |
| 6-8 | Lectura conservada en `sea_employees`, `sea_companies`, `sea_work_centers` | true |
| 9 | Policies de `authenticated` intactas | 10 |
| 10 | `authenticated` conserva la escritura | 10 |

### Smoke tests · funcionales, sin DML artificial

| Pantalla | Qué mirar |
|---|---|
| `/portal` | La lista de empleados carga y el código de operario valida |
| `/portal/mi-ficha` | **La ficha carga entera**: competencias, certificaciones, autorizaciones, formación, vestuario. Y el bloque de empresa y centro de trabajo, que es el embebido de PostgREST |
| `/sea` (SeaHub) | Los tres listados cargan |
| Safety autenticada | Documentos, entregas, formación, inspecciones |
| Presencia autenticada | Fichajes y panel |
| **Escritura legítima** | Editar un empleado desde `sea-core`, y guardar |

El embebido de `/portal/mi-ficha` es el punto más delicado: las dos políticas
nuevas de `sea_companies` y `sea_work_centers` existen exactamente para eso.

### Si falla

**No ejecutes el rollback completo.** El orden es:

1. Identificar qué permiso legítimo falta: qué pantalla, qué operación, qué
   tabla. El error de PostgREST nombra la tabla.
2. Restaurar solo ese acceso mínimo. Casi siempre:
   `create policy <nombre>_lectura on <tabla> for select to anon using (<el predicado que tenía>);`
   o `grant select on public.<tabla> to anon;`
3. Anotarlo. Un permiso que hizo falta restaurar es un consumidor que el
   barrido estático no encontró, y hay que entender por qué.

El rollback completo solo si hay indisponibilidad grave sin corrección mínima
inmediata, y usando el texto generado por `009`.

### PARADA OBLIGATORIA

No se sigue a 005 sin confirmar 007.

---

## 3. PASO 2 · Aplicar 005 · las cuatro vistas demostradas

```
supabase/migraciones-preparadas/005_contencion_vistas.sql
```

### Postcheck

Bloque «POSTCHECK DE 005». **Cuatro filas, las cuatro OK.**

### Smoke tests

| Pantalla | Vista |
|---|---|
| Estado de OTs (`administracion`) | `adm_ot_estado` |
| TyreControl · clientes | `tc_clientes_almacen` |
| TyreControl · productos | `tc_productos_almacen` |
| TyreControl · marcas | `tc_marcas_contadores` |

### Atención especial a `adm_ot_estado`

Es la única de las tres migraciones que **cambia el modelo de autorización de
lectura**, no solo los permisos. Al pasar a `security_invoker`, la vista deja
de correr como `postgres` y queda sujeta a las políticas de `adm_work_orders` y
`adm_customers`, que son `to public using (adm_can_read())`.

En el laboratorio, un usuario que pasa `adm_can_read()` sigue viendo la misma
fila. **Pero `adm_can_read()` es una función real cuyo cuerpo no he leído**: si
en producción devuelve algo distinto de lo que supone el laboratorio, la
pantalla puede quedarse vacía.

Si eso ocurre: **para antes de 008** y restaura solo eso:

```sql
alter view public.adm_ot_estado reset (security_invoker);
```

Eso deshace el cambio de modelo **sin devolverle el acceso a `anon`**, que es
la mitad que sí interesa conservar. El resto de 005 se queda puesto.

### PARADA OBLIGATORIA

---

## 4. PASO 3 · Aplicar 008 · las nueve sin consumidor

```
supabase/migraciones-preparadas/008_contencion_vistas_resto.sql
```

### Postcheck

Bloque «POSTCHECK DE 008». **Cinco filas, las cinco OK**, incluida la que
confirma que `traspasos_auditoria_detalle` **no** se ha tocado.

### Observación de logs

Estas nueve no tienen consumidor localizado, y «no localizado» no es
«inexistente». Durante un rato, en los logs de PostgREST y del servidor, buscar:

```
permission denied for view kpis_traspasos
permission denied for view movimientos_stock_detalle
permission denied for view stock_actual
permission denied for view stock_actual_detalle
permission denied for view tc_modelos_aplicacion_sin_clasificar
permission denied for view tc_tipos_plano_descuadrado
permission denied for view traspasos_detalle
permission denied for view traspasos_lineas_detalle
permission denied for view traspasos_resumen_lineas
```

y cualquier 401/403 asociado a esos nombres. Si aparece alguno, la restauración
mínima es una línea: `grant select on public.<vista> to authenticated;`

---

## 5. Estado de los hallazgos al terminar

Ninguno se marca cerrado.

**SEC-008 — escritura anónima contenida; exposición de lectura todavía abierta.**

Siguen accesibles anónimamente, entre otros: DNI/NIE, número de Seguridad
Social, domicilio y `pin_hash`. La corrección siguiente reduce las columnas
accesibles y después retira el modelo de descargar la credencial al cliente.

**SEC-068 — escritura/bypass de las vistas contenidas corregido; una superficie
pendiente de decisión funcional.**

13 de 14 contenidas. `traspasos_auditoria_detalle` sigue fuera y mantiene la
exposición de `codigo_personal`, que además sale también por la política
`anon_read_auditoria` de la tabla.

---

## 6. Evidencia de cierre · a rellenar durante la intervención

| Migración | Hora UTC | Aplicada | Postcheck | Smoke test | Incidencias |
|---|---|---|---|---|---|
| 009 fotografía previa | — | **NO ejecutada antes de 007** | n/a | n/a | No hizo falta: 007 no lleva `revoke all`. **Sí es obligatoria antes de 005** |
| **007 Safety** | 2026-09-27 | **SÍ** | ver abajo | pendiente de reporte | 9 tablas `sea_*` adicionales detectadas |
| 007b resto | — | no | — | — | Defensa en profundidad, no urgente |
| 005 vistas | — | no | — | — | Autorizada, pendiente de 009 |
| 008 vistas resto | — | no | — | — | Sin autorizar |

### Resultado de 007

**Escritura anónima efectiva sobre Safety: de 10 tablas a 0.**

El postcheck original marcó FALLO en cinco filas. Dos causas, las dos mías:

1. Las filas 9 y 10 asumían **10** tablas `sea_*`; producción tiene **19**.
2. Las filas 3-5 medían `has_table_privilege`, que es **el grant**, y no la
   capacidad de escribir.

Las nueve tablas adicionales tienen RLS activa y ninguna política para `anon`,
así que **no eran escribibles**: el `INSERT` lo rechaza la RLS y el `UPDATE` y
el `DELETE` afectan a cero filas. Verificado en 17.6.

El postcheck está reescrito (`010`), sin números fijos y separando GRANT de
EFECTIVO. **La fila 7 es la referencia de «escritura anónima efectiva».**

### Regla que queda fijada

Toda verificación futura distingue tres cosas, y no usa `has_table_privilege()`
como sinónimo de explotabilidad:

| | Qué es |
|---|---|
| **GRANT** | Lo que el catálogo concede |
| **Policy RLS** | Lo que la política permite por fila |
| **Acceso efectivo** | El resultado de las dos, que es lo único que importa |

Y además:

1. Resultados completos de cada postcheck.
2. Cualquier permiso restaurado a mano, con su motivo.
3. Cualquier divergencia entre producción y laboratorio.
4. Errores observados en logs.

---

## 7. Lo que sigue sin autorizar

`001_seguridad_fase0.sql` · Fase B · merge · deploy · Twilio · Render · Auth ·
Edge Functions · Fase 1A/1C.
