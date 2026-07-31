# PROMPT — Unificación de datos duplicados en Mobilink

> Documento de encargo. **No es código.** Léelo entero antes de tocar nada.
> Fase de estudio y decisión: al final hay que **aprobar el modelo objetivo** antes de programar.

---

## 0. Lo primero que hay que entender

Esto **ya se ha intentado once veces**. Las migraciones lo dicen solas:

```
administracion_fase3_unificar_clientes.sql
administracion_fase11_usuarios_unificados.sql
tyrecontrol_fase12_unificar_producto_almacen.sql
tyrecontrol_fase24_sync_clientes_empresas.sql
tyrecontrol_fase25_sync_bidireccional_empresas_clientes.sql
tyrecontrol_fase26_codigo_cliente_empresa.sql
tyrecontrol_fase32_sync_clientes_relink.sql
almacen_fase4_autoenlazar_productos_al_crecer_catalogo.sql
almacen_fase5_sincronizar_catalogo_completo.sql
tyrecontrol_fase5a_enlace_almacen.sql
tyrecontrol_fase5b_enlace_producto.sql
```

Y el patrón siempre fue el mismo: **sincronizar copias en vez de eliminarlas**. Hoy
`clientes` y `tc_empresas` se sincronizan **en las dos direcciones** con triggers que necesitan
`pg_trigger_depth() < 2` para no entrar en bucle infinito, y aun así hizo falta una
`fase32_sync_clientes_relink` porque aparecieron duplicados reales en producción — el propio
fichero cita *"ENCATRANS por triplicado"*.

**La conclusión operativa: este encargo NO es "añadir otra capa de sincronización".** Si la
propuesta que salga de aquí incluye un trigger nuevo que copie datos de una tabla a otra, está
mal y se rechaza. El objetivo es que cada dato viva en un sitio y los demás lo referencien.

---

## 1. Inventario medido

### 1.1 Tres bases de datos que no se conocen

| Base | Qué contiene | Tipo de clave |
|---|---|---|
| **Supabase** | módulos SEA, TyreControl, Almacén, Administración, SaaS | `uuid` |
| **Postgres del servidor Node** (`server/db.ts`, `connect/schema.ts`) | taller/core, ConnectPro, licencias | `SERIAL` (entero) |
| **Postgres del Integration Hub** (`integration-hub/infrastructure/schema.ts`) | referencias externas, ofertas de proveedor | `SERIAL` |

**Ninguna clave foránea cruza entre las tres.** Cualquier vínculo entre ellas es hoy un string
suelto (`coreWorkshopId`, `licenseUuid`, `mobilink_product_id`, `workshopId`).

### 1.2 Matriz de duplicación

| Entidad | Copias | Dónde |
|---|---|---|
| Cliente / empresa | **10** | `clientes`, `adm_customers`, `tc_empresas`, `empresas` (almacén), `sea_companies`, `app_empresas`, `companies` (`db.ts:494`), `connect_clients`, `connect_partners`, `connect_provider_companies` |
| Vehículo | **4** + 11 matrículas sueltas | `vehiculos`, `tc_vehiculos`, `roadside_vehicles`, `connect_mobile_units` |
| Producto / artículo | **5** | `productos_neumaticos`, `tc_referencias_neumatico`, `tc_tools` + `tc_machines`, `sm_epis`, `external_product_references` |
| Catálogo de marca/medida | **4** | `tc_cat_marcas_neumatico`, `tc_cat_fabricantes`, `tc_cat_medidas_neumatico`, `tyre_sizes` |
| Proveedor | **3** | `sea_suppliers`, texto libre en TyreControl, string de conector en el Hub |
| Centro / taller / ubicación | **6** | `sea_work_centers`, `app_centros`, `tc_delegaciones`, `connect_workshops`, `connect_branches`, `WORKSHOPS` hardcodeado en `src/modules/workshops.ts` |
| Operario / usuario | **5** | ver `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md` |

Siete pantallas distintas dan de alta un cliente. Cuatro dan de alta un vehículo.

---

## 2. Qué es duplicación de verdad y qué no

**Este es el apartado más importante del documento.** Fusionar a ciegas todo lo que se llama
parecido rompería cosas que hoy funcionan bien. Hay que separar tres casos.

### 2.1 Duplicación real — el mismo objeto del mundo real, en varias tablas

| Concepto | Copias que SÍ deben fundirse | Nota |
|---|---|---|
| **Cliente** (empresa a la que facturamos) | `clientes` ← maestra declarada · `adm_customers` (ya es 1:1 con PK compartida) · `tc_empresas` (sincronizada bidireccionalmente) · `companies` (`db.ts`) | Es el caso más grave y el que más ha sangrado |
| **Vehículo del cliente** | `vehiculos` (almacén) · `tc_vehiculos` (TyreControl) | Sus *clientes* ya están enlazados, pero **sus vehículos no**: es el hueco simétrico que `fase5a` resolvió para clientes y nunca se hizo para flota |
| **Tenant** (empresa dueña de los datos) | `sea_companies` · `app_empresas` | Dos modelos de multiempresa en paralelo que no se conocen |
| **Marca / medida de neumático** | `tc_cat_marcas_neumatico` vs `tc_cat_fabricantes` · `tc_cat_medidas_neumatico` vs `tyre_sizes` | Duplicación interna del propio TyreControl |

### 2.2 Falsos duplicados — NO tocar

- **`tc_neumaticos` frente a `productos_neumaticos`.** No son lo mismo: uno es la **unidad
  física** (número de serie, RFID, DOT, montada en una posición) y el otro es el **artículo de
  catálogo**. La relación correcta es unidad → artículo, no fusión. Ya existe
  (`almacen_producto_id`), aunque sin FK real: eso sí hay que arreglarlo.
- **`tc_tools` (herramienta) frente a `sm_epis` (EPI).** Ciclos de vida distintos —
  calibración y mantenimiento frente a caducidad y entrega firmada. Comparten "artículo con
  stock", pero fusionarlos no aporta nada y complica dos módulos que hoy funcionan.
- **Proveedor de recambios frente a proveedor de servicio de ConnectPro.** `sea_suppliers`
  suministra material; `connect_provider_companies` presta asistencias. Distintos.
- **Cliente frente a tenant.** `clientes` es a quien facturamos; `app_empresas`/`sea_companies`
  es de quién son los datos. Que en la práctica coincidan hoy (una sola empresa usando la
  plataforma) no los hace el mismo concepto — fusionarlos rompería el SaaS multiempresa.

### 2.3 Duplicación por mal etiquetado — arreglar el nombre, no fusionar

- **`empresas` del almacén no son empresas: son centros/almacenes.** La pantalla se llama
  "Centros / empresas" y el alta (`CentrosAlmacen.tsx:48`) escribe **solo `nombre`**. Y esa
  tabla es el `empresa_id` de todo el stock. Sin clave natural, los duplicados están
  garantizados.
- **`WORKSHOPS` hardcodeado** (`src/modules/workshops.ts:1-28`): el maestro de talleres del
  core es un array literal en TypeScript.

---

## 3. Riesgo bloqueante: hay esquema sin versionar

**`clientes`, `empresas` y `productos_neumaticos` no tienen `CREATE TABLE` en el repositorio.**
Existen solo dentro de Supabase, creadas a mano. Son, respectivamente, la maestra de clientes,
el ámbito de todo el stock y el catálogo de productos: **las tres piezas centrales de esta
unificación**, y nadie puede leer su definición real desde el código.

**Tarea 0, bloqueante:** volcar el esquema real de esas tres tablas (y de `movimientos_stock`,
`traspasos`, `inventarios`, `cliente_contactos`) a una migración de referencia en
`supabase/migrations/`. Sin esto, cualquier plan de migración es una suposición.

```
Comando orientativo: pg_dump --schema-only, o desde el SQL Editor de Supabase.
Entregable: 000_esquema_existente.sql, solo documentativo, idempotente, sin DROP.
```

---

## 4. Modelo objetivo propuesto

Un único maestro por concepto, con clave natural obligatoria, y el resto **referenciando por
clave foránea** — nunca copiando.

```
TENANT            app_empresas  (uno solo; sea_companies se funde en él)
                        │
CENTRO/UBICACIÓN  app_centros   (absorbe sea_work_centers, empresas-del-almacén,
                        │        tc_delegaciones, tc_locations)
                        │
CLIENTE           clientes      (maestra; NIF único obligatorio + código de cliente)
                        │        adm_customers sigue siendo su ficha económica 1:1
                        │        tc_empresas pasa a ser VISTA, no tabla
                        │
VEHÍCULO          vehiculos     (maestra; UNIQUE(cliente_id, matricula))
                        │        tc_vehiculos pasa a referenciarla, no a duplicarla
                        │
ARTÍCULO          productos     (catálogo; referencia/EAN único)
                        └─ unidades físicas: tc_neumaticos, tc_tools, sm_epis (FK al artículo)

PROVEEDOR         sea_suppliers (CIF único; con pantalla de mantenimiento, hoy no existe)
```

Reglas del modelo:

1. **Toda tabla maestra tiene clave natural con `UNIQUE`.** Hoy `sea_suppliers.cif`,
   `companies.nif`, `connect_*.taxId` y `vehiculos.matricula` no la tienen: por eso hay
   triplicados.
2. **Prohibido el trigger de copia.** Un dato, un sitio. Lo demás son FK o vistas.
3. **Los identificadores externos van en `integration_mappings`** (ya existe en el Hub,
   `UNIQUE(tenant_id, entity_type, system, external_code)`), que es el sitio correcto para
   `coreWorkshopId`, `licenseUuid`, códigos de ERP y de proveedor. Nada de punteros de texto
   sueltos por el esquema.
4. **El puente entre las tres bases es explícito**, no adivinado por nombre: mientras el core
   siga en el Postgres del servidor, cada tabla que apunte a Supabase lleva una columna `uuid`
   documentada y un proceso de reconciliación, no un `LIKE` sobre el nombre.

---

## 5. Plan por fases

Orden por riesgo creciente. **Cada fase es desplegable y reversible por separado**, y ninguna
borra una tabla hasta que la fase siguiente demuestre que nadie la lee.

### Fase 0 — Volcar el esquema no versionado (bloqueante)
Ver §3. Sin esto no empieza nada.

### Fase 1 — Claves naturales y detección de duplicados (no destructiva)
- Añadir índices `UNIQUE` donde falten: `sea_suppliers.cif`, `companies.nif`,
  `vehiculos (cliente_id, matricula)`, `productos` (referencia).
- **Antes de añadirlos**, un informe de duplicados existentes por cada tabla: los `UNIQUE`
  fallarán si ya hay repetidos, y ese informe es la lista de trabajo manual.
- Entregable: informe de duplicados reales, por tabla y con la fila que se propone conservar.

### Fase 2 — Vehículos: cerrar el hueco simétrico
`tc_vehiculos.vehiculo_almacen_id → vehiculos(id)`, casando por `(cliente, matrícula)` con los
clientes ya enlazados. Informe de no-casados. **Sin trigger de sincronización**: TyreControl
pasa a leer los datos de identidad del vehículo de la maestra y conserva solo lo suyo (ejes,
configuración, revisiones).

### Fase 3 — Cliente: de sincronización bidireccional a fuente única
- `tc_empresas` deja de ser tabla y pasa a **vista** sobre `clientes` + sus campos propios en
  una tabla satélite `tc_empresa_config` (lo que es de TyreControl y no del cliente).
- Se **eliminan los triggers** de las fases 24/25/26/32 y su guarda anti-bucle.
- `companies` (`server/db.ts`) recibe `cliente_uuid` y deja de ser un alta paralela.
- Es la fase más delicada: `tc_empresas` es padre de usuarios, vehículos, delegaciones y
  neumáticos de TyreControl.

### Fase 4 — Centros y ubicaciones
Unificar `empresas`(almacén) / `sea_work_centers` / `tc_delegaciones` / `tc_locations` bajo
`app_centros`, y sustituir el array `WORKSHOPS` hardcodeado por datos.

### Fase 5 — Tenants
Fundir `sea_companies` en `app_empresas`. Va tarde a propósito: es la que menos duele hoy
(una sola empresa real) y la que más FK arrastra.

### Fase 6 — Catálogo de producto
Fusionar los cuatro catálogos de marca/medida, poner FK real en
`tc_neumaticos.almacen_producto_id` y dar de alta la pantalla de mantenimiento de
`sea_suppliers`, que hoy no existe pese a que cinco tablas la referencian.

### Fase 7 — Prefijo `tc_` compartido
ToolControl (`tc_tools`, `tc_locations`, …) y TyreControl (`tc_empresas`, `tc_neumaticos`, …)
comparten prefijo en el mismo esquema `public`. Renombrar uno de los dos (propuesta:
ToolControl → `tl_`) es puro riesgo sin beneficio funcional inmediato, así que va el último y
**puede quedarse sin hacer**; lo que no puede es olvidarse, porque el día que alguien cree una
tabla `tc_algo` para el módulo equivocado el error será silencioso.

---

## 6. Riesgos

1. **Esquema no versionado** (§3): el mayor. Se mitiga con la Fase 0.
2. **Duplicados reales ya en producción** — "ENCATRANS por triplicado" no es hipotético. Fundir
   filas exige decidir cuál se conserva y reapuntar su histórico; es trabajo manual y de
   negocio, no automatizable del todo.
3. **`tc_empresas` como padre de medio TyreControl**: convertirla en vista toca usuarios,
   vehículos, delegaciones y neumáticos. Es la fase que más necesita un entorno de pruebas.
4. **Dos espacios de claves** (uuid frente a SERIAL): mientras el core siga en el Postgres del
   servidor, la unificación total no es posible; lo alcanzable es un puente explícito y
   documentado.
5. **Sin red de tests**: 4 ficheros de test para 126.000 líneas. Ver
   `PROMPT_MODULARIZACION_MOBILINK.md` §2 — la red de seguridad debería ir antes que la Fase 3.
6. **RLS de Supabase**: convertir tablas en vistas cambia cómo aplican las políticas. Hay que
   revisar la RLS de cada tabla afectada **antes** de sustituirla.

---

## 7. Cómo ejecutar este encargo

1. **Ningún trigger de copia nuevo.** Si la solución propuesta sincroniza dos tablas, está mal.
2. **Fase 0 primero.** No se planifica sobre un esquema que no se puede leer.
3. **Nada se borra hasta que se demuestra que nadie lo lee** (vista de compatibilidad primero,
   `DROP` en una fase posterior).
4. **Migraciones SQL = scripts para ejecución manual del usuario** (pauta del proyecto). Ninguna
   se ejecuta desde la sesión de programación.
5. **Una fase, un commit**, con typecheck y build en verde antes y después.
6. **Informe de duplicados antes de cada fusión**, con la fila superviviente propuesta y a la
   espera de decisión del usuario. Fusionar clientes es una decisión de negocio, no técnica.
7. **Presentar el alcance y esperar confirmación antes de empezar cada fase.**

---

## 8. Decisiones que necesito de ti antes de empezar

1. **¿`clientes` sigue siendo la maestra**, o prefieres que el maestro de cliente pase a
   Administración (`adm_customers`), que es donde está la ficha económica?
2. **¿ConnectPro entra o queda fuera?** Sus `connect_clients` / `connect_partners` /
   `connect_provider_companies` son de un producto distinto (red de talleres colaboradores).
   Mi recomendación: **fuera de alcance por ahora**, salvo el vínculo explícito por `uuid`.
3. **¿Se unifican los tenants** (`sea_companies` + `app_empresas`) o se asume que son dos
   modelos y se documenta la frontera?
4. **¿Hay entorno de pruebas de Supabase**, o todo se ejecuta contra producción? La Fase 3 sin
   entorno de pruebas es jugársela.
