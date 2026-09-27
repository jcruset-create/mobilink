# Deuda arquitectónica · credencial descargada al navegador

> `anon key` → `SELECT` de la credencial → comparación en el cliente

No es un fallo de configuración que se arregle con una política mejor. Es un
modelo de autenticación que no puede funcionar, porque **el secreto contra el
que se compara viaja al mismo sitio donde está el atacante**.

Ninguna política de RLS arregla esto. Si el cliente tiene que comparar, el
cliente tiene que poder leer; y si puede leer, puede leerlo todo.

---

## 1. Corrección de lo que dije el 2026-09-26

Describí la exposición de `sea_employees` como **lectura**. Es incorrecto: es
**lectura y escritura**. La tabla tiene dos políticas para `anon`:

| Política | Cmd | Predicado |
|---|---|---|
| `portal_anon_employees` | SELECT | `activo = true` |
| **`sea_anon_all`** | **ALL** | **`using (true)` / `with check (true)`** |

Y no es solo esa tabla. **Diez tablas del módulo de Safety tienen `ALL` para
`anon` con predicado siempre cierto:**

`sea_employees` · `sea_companies` · `sea_work_centers` · `sea_authorizations` ·
`sea_competencies` · `sea_employee_authorizations` ·
`sea_employee_certifications` · `sea_employee_clothing` ·
`sea_employee_competencies` · `sea_training_records`

Con la clave publicable que va dentro de los APK se puede **leer, modificar y
borrar** el módulo de Safety entero, incluido el fichero de personal.

Sobre `sea_employees`, cuyas 28 columnas están confirmadas, eso significa poder
leer y también alterar:

`dni_nie` · `num_seguridad_social` · `direccion`, `codigo_postal`, `poblacion`,
`provincia` · `telefono`, `email` · `pin_hash` · `codigo_operario` ·
`fecha_alta`, `fecha_baja`, `cargo`, `departamento`

Es una brecha de datos personales de categoría alta **y** una vía para alterar
registros de formación, certificaciones y autorizaciones de seguridad, que son
los que acreditan que un trabajador puede hacer una tarea de riesgo.

---

## 2. Dónde está el patrón

| # | Sitio | Identidad | Qué descarga | Qué compara |
|---|---|---|---|---|
| 1 | `src/pages/PortalLogin.tsx:41` | `anon` | `codigo_operario` de `sea_employees` | `data.codigo_operario !== codigo.trim()` en JavaScript (línea 46) |
| 2 | `almacen_app/lib/screens/traspaso_detalle_screen.dart:115` | `anon` (la APK no hace login) | `codigo_operario` de `perfiles_usuario` | la fila existe o no, filtrando por el código |
| 3 | `src/modules/almacen-neumaticos/pages/UsuariosAlmacen.tsx:704` | autenticada | `codigo_operario` | `usuario.codigo_operario === codigoLimpio` |
| 4 | `src/pages/RoadsideOperatorPage.tsx:404` | por confirmar | `codigo_operario` | por confirmar |

Y el reflejo del patrón en los datos, donde queda la credencial una vez usada:

| Objeto | Expone | A quién |
|---|---|---|
| `perfiles_usuario` (`anon_read_activos`) | `codigo_operario`, nombre, email, móvil, rol, ubicación | `anon`, todas las filas activas |
| `sea_employees` (`portal_anon_employees` + `sea_anon_all`) | las 28 columnas, **con escritura** | `anon` |
| `traspasos_auditoria` (`anon_read_auditoria`) | `codigo_personal` de cada acción registrada | `anon` |
| `traspasos_auditoria_detalle` (vista) | lo mismo, además saltándose la RLS | `anon` |

Los tres códigos son el mismo valor: `codigo_operario` es lo que se valida, y
`codigo_personal` es ese mismo valor escrito en la traza.

---

## 3. Por qué no se arregla con una política

La tentación es acotar `anon_read_activos` por columnas o por empresa. No sirve:

- **Por columnas** no se puede en RLS: las políticas filtran filas, no columnas.
  Haría falta una vista o `column privileges`, y la app necesita precisamente la
  columna del código para comparar.
- **Por empresa** tampoco: `anon` no tiene empresa. No tiene nada. `auth.uid()`
  es nulo.
- **Por el propio código**, con una política del tipo «solo la fila cuyo código
  coincida», convertiría la política en el oráculo: se prueban códigos hasta
  que una devuelva fila. Es un ataque de fuerza bruta sin límite ni registro.

El problema no es qué filas se dejan ver. Es que **la comparación ocurre en el
lado del atacante**.

---

## 4. La solución, y dónde encaja

El servidor ya tiene el patrón correcto montado para Presencia:
`/api/presencia-operator/login` valida contra la base con la clave de servicio y
devuelve una sesión; `requirePresenciaEmployee` la exige después. Nada baja al
cliente.

Lo que falta es aplicarlo a los otros tres casos:

1. **Portal del empleado** → endpoint de login que reciba el código y devuelva
   una sesión firmada; retirar el `select` de `sea_employees` a `anon`.
2. **`almacen_app`** → endpoint que valide el código de operario y devuelva la
   autorización del traspaso; retirar `anon_read_activos`.
3. **Auditoría de almacén** → endpoint que devuelva la traza ya filtrada;
   retirar `anon_read_auditoria` y la vista.

Es **Fase 1/3**, y no se puede adelantar a la Fase 0: son endpoints nuevos, un
modelo de sesión para el empleado y una versión nueva de la APK.

---

## 5. Lo que sí se puede hacer antes, y lo que no

**Se puede, hoy, sin romper nada:** retirar `sea_anon_all` y las otras nueve
políticas `ALL` de `anon` del módulo de Safety, **dejando el `SELECT`**. Los
consumidores identificados (`PortalLogin`, `PortalFicha`) solo leen de
`sea_employees`; lo único que escriben con `anon` es
`sm_document_acknowledgements`, que tiene sus propias políticas.

Eso no cierra la brecha de lectura —que es la grave—, pero **quita la escritura
anónima sobre el fichero de personal y sobre los registros de formación**, que
es la parte que ahora mismo permite alterar la evidencia.

**No se puede, sin cambio de código:** quitar el `SELECT`. Deja sin servicio el
portal del empleado y `almacen_app`.

Esa migración **no está escrita**: antes hay que comprobar que ninguna de las
ocho apps escribe en esas diez tablas con `anon`, y eso requiere una revisión
que no se ha hecho. Se propone, no se entrega.

---

## 6. Prioridad

Por encima de SEC-002 y por encima de SEC-068. SEC-068 permite escribir en
cuatro tablas de negocio; esto permite leer y escribir el fichero de personal
con DNI, número de la Seguridad Social y domicilio.

No requiere explotar nada. Es una consulta con una clave que está dentro de una
aplicación publicada.
