# PROMPT — Cuadros de mando a medida con IA, estilo Power BI (TyreControl)

> Prompt listo para implementar en `jcruset-create/mobilink`. Añade al módulo
> **Informes** de TyreControl un **constructor visual de cuadros de mando** al
> estilo Power BI: lienzo con varias visualizaciones, lista de campos a la
> izquierda, arrastrar y soltar a zonas (Ejes / Valores / Filtros) y filtrado
> cruzado entre gráficos.
>
> La diferencia con Power BI: **la IA construye el cuadro de mando por ti**. El
> usuario escribe "quiero ver el gasto de neumáticos por delegación este año" y
> aparece la visualización montada, lista para ajustar a mano.

---

## Principio rector

**La IA propone; Postgres decide.** El modelo NUNCA ejecuta SQL libre ni recibe
datos de clientes. Su único trabajo es convertir una frase en una **especificación
JSON** que el backend valida contra una lista blanca; si la especificación no
encaja, se rechaza. Todo lo que se ejecuta pasa por la RLS del usuario, así que
un informe mal formado puede fallar, pero **nunca puede filtrar datos de otro
cliente**.

Los 11 informes actuales **no cambian**. Esto es una pestaña más.

---

## Contexto ya construido (reutilizar, no reinventar)

### Panel web (`src/modules/tyrecontrol/`)
- `pages/informes/InformesLayout.tsx`: pestañas + `FiltroBarInformes` (empresa,
  desde, hasta) compartidos por todos los informes vía contexto
  `useInformesFiltros()`. **La pestaña nueva se cuelga aquí**, respetando esos
  filtros globales.
- `pages/informes/Informe*.tsx` (11): patrón a imitar — hook de datos, tabla,
  botón de exportar.
- `services/informes.ts`: todas las llamadas son `supabase.rpc("tc_informes_*")`.
  **La agregación vive en Postgres, no en el navegador.** Mantener esa regla.
- `types/informes.ts`: `FiltrosInformes { empresaId, desde, hasta }`.
- `utils/exportar.ts`: `descargarCSV(nombre, cabeceras, filas)` (separador `;` y
  BOM, para Excel en ES). **Reutilizar tal cual.**

### Backend (`server/index.ts`)
- Cliente `openai` ya instanciado y en uso (informes de intervención con IA,
  OCR de matrículas). Modelo actual `gpt-4o-mini`.
- Patrón de endpoint TyreControl: `authenticate` + `requireModule("tyrecontrol")`.
- ⚠️ El fichero tiene ~15.600 líneas. **Crear `server/tyrecontrol/informesIa.ts`**
  y montarlo desde `index.ts` con una sola línea, como se hizo con
  `server/connect/`. No engordar más el monolito.

### Base de datos (Supabase)
- RLS por empresa: `tc_puede_ver_empresa(empresa_id)`; los operarios ven sus
  empresas vía `tc_operador_empresas`. Helpers `tc_is_superadmin()`, `tc_is_admin()`.
- Tablas núcleo: `tc_vehiculos`, `tc_neumaticos`, `tc_montajes_actuales`,
  `revisiones_vehiculo`, `revisiones_neumaticos_detalle`, `operaciones_neumaticos`,
  `tc_incidencias`, `tc_intervenciones`, `tc_empresas`, `tc_delegaciones`,
  `tc_usuarios`, `tc_tipos_vehiculo`, `tc_pausas_trabajo`.
- Ya existen RPCs de agregación `tc_informes_*` y `tc_prod_*` (analítica de
  productividad, con tiempos y pausas).

---

## Alcance

### Lo que SÍ hace
1. **Lienzo de cuadro de mando**: varias visualizaciones (tarjeta KPI, barras,
   líneas, donut, tabla) colocadas en una rejilla, redimensionables y movibles.
2. **Panel de campos** a la izquierda con las dimensiones y métricas
   disponibles; se **arrastran** a las zonas *Ejes*, *Valores* y *Filtros* de la
   visualización seleccionada — como Power BI.
3. **Filtrado cruzado**: al pulsar una barra (p. ej. la delegación "Tarragona"),
   el resto de visualizaciones del lienzo se filtran por ese valor. Un segundo
   clic lo quita.
4. **La IA monta la visualización**: el usuario describe lo que quiere y aparece
   ya configurada en el lienzo; después se ajusta a mano sin volver a preguntar.
5. **Guardar y compartir** el cuadro de mando completo (los datos se recalculan
   siempre al abrirlo; no se congelan).
6. **Exportar a CSV** cada visualización.
7. La IA redacta un **resumen ejecutivo** del cuadro de mando.

### Lo que NO hace (explícito)
- ❌ No genera SQL libre ni acepta SQL del usuario.
- ❌ No envía filas de datos del cliente a OpenAI para construir la consulta.
- ❌ No permite escrituras: solo lectura.
- ❌ No inventa métricas que no estén en el catálogo.
- ❌ No cruza empresas: el `empresa_id` lo pone el servidor, nunca la IA.

---

## Diseño

### 1. Catálogo de datos (la lista blanca)

Nueva tabla `tc_informes_catalogo` con lo que se puede consultar. Es la **única**
fuente de verdad de lo que la IA puede pedir, y lo que se le manda como contexto.

```sql
create table if not exists tc_informes_catalogo (
  clave          text primary key,        -- 'vehiculo.matricula'
  entidad        text not null,           -- 'vehiculo' | 'neumatico' | 'revision' | 'operacion' | 'incidencia'
  etiqueta       text not null,           -- 'Matrícula'
  tipo           text not null check (tipo in ('dimension','metrica','fecha')),
  sql_expr       text not null,           -- expresión SQL (la escribimos NOSOTROS)
  agregacion     text,                    -- 'sum' | 'avg' | 'count' | 'min' | 'max' (solo métricas)
  unidad         text,                    -- 'mm', 'bar', '€', 'km', 'min'
  descripcion    text,                    -- ayuda para la IA
  activo         boolean not null default true
);
```

`sql_expr` lo escribimos nosotros en la migración; **nunca lo genera la IA**.
Poblar como mínimo con:

- **Dimensiones**: matrícula, cliente, delegación/base, tipo de vehículo, técnico,
  marca, modelo, medida, posición, eje, tipo de operación, tipo de incidencia,
  origen del neumático (stock / sin control de stock), mes.
- **Métricas**: nº de revisiones, nº de operaciones, nº de incidencias, neumáticos
  montados, profundidad media/mín, presión media, coste material, coste mano de
  obra, km recorridos, duración media de revisión, tiempo efectivo, % inactividad,
  nº de pausas.
- **Fechas**: fecha de revisión, fecha de operación, fecha de incidencia.

### 2. Especificación (contrato IA → backend)

Una **visualización** es la unidad; un **cuadro de mando** es una lista de ellas
con su posición en la rejilla.

```ts
type Visualizacion = {
  id: string;
  titulo: string;
  tipo: 'kpi' | 'barras' | 'lineas' | 'donut' | 'tabla';
  entidad: 'vehiculo' | 'neumatico' | 'revision' | 'operacion' | 'incidencia';
  ejes: string[];                     // dimensiones (claves del catálogo), máx. 3
  valores: { clave: string; agregacion: 'sum'|'avg'|'count'|'min'|'max' }[]; // máx. 5
  filtros: { clave: string; op: '='|'!='|'>'|'<'|'>='|'<='|'in'|'entre'; valor: unknown }[];
  orden?: { clave: string; dir: 'asc'|'desc' };
  limite?: number;                    // por defecto 100, tope 1000
  pos: { x: number; y: number; w: number; h: number }; // rejilla de 12 columnas
};

type CuadroDeMando = {
  titulo: string;
  visualizaciones: Visualizacion[];   // máx. 12 por lienzo
  filtrosGlobales: Visualizacion['filtros'];  // se aplican a todas
};
```

El modelo se llama con **JSON Schema estricto** (`response_format` de tipo
`json_schema` con `strict: true`) para que no pueda devolver texto libre. La IA
devuelve **una visualización** por petición (no cuadros enteros): es más fiable y
el usuario la va añadiendo al lienzo. El `pos` lo calcula el frontend buscando el
primer hueco libre, no la IA.

**Filtrado cruzado**: al pulsar un valor en una visualización, el frontend añade
ese filtro a `filtrosGlobales` en memoria y reejecuta las demás. No se guarda en
la definición del cuadro de mando — es estado de la sesión.

### 3. Validación en el backend (la barrera de seguridad)

Antes de tocar la base de datos:

1. Toda `clave` existe en `tc_informes_catalogo` y está activa. Si no → 400 con
   el motivo en claro.
2. La `agregacion` es una de las cinco permitidas y coincide con el tipo.
3. `limite` se acota a 1000; se aplica `statement_timeout` de 10 s.
4. El SQL se compone **solo** a partir de `sql_expr` del catálogo; los valores de
   los filtros van **siempre parametrizados** (`$1, $2…`), nunca interpolados.
5. El `empresa_id` lo inyecta el servidor desde la sesión. Si el usuario no es
   superadmin, se fuerza; la IA no puede tocarlo.

> Regla de oro: si la especificación no valida, **se muestra al usuario qué campo
> falló y se le ofrece reformular**. Nunca se ejecuta "lo más parecido".

### 4. Ejecución

RPC `tc_informes_ejecutar(p_spec jsonb)` en PL/pgSQL, `security invoker` para que
**mande la RLS del usuario**. Compone el SELECT con las expresiones del catálogo,
agrupa por las dimensiones y devuelve `jsonb` con `{ columnas, filas, total }`.

### 5. Guardado

```sql
create table if not exists tc_informes_guardados (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references tc_empresas(id) on delete cascade,
  usuario_id   uuid references tc_usuarios(id) on delete set null,
  nombre       text not null,
  peticion     text,          -- lo que escribió el usuario, para reeditarlo
  spec         jsonb not null,  -- CuadroDeMando completo (con posiciones)
  compartido   boolean not null default false,  -- visible para toda la empresa
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```
RLS: SELECT con `tc_puede_ver_empresa(empresa_id)` y (`usuario_id = auth.uid()`
o `compartido`); escritura solo del propietario o admin.

### 6. Resumen ejecutivo con IA

Segunda llamada al modelo, **después** de tener los datos: se le pasan los
resultados **ya agregados** (nunca filas crudas) y devuelve 3-5 frases en
español: qué destaca, qué llama la atención y qué conviene revisar. Si la llamada
falla, el informe se muestra igual sin resumen — **nunca bloquea**.

---

## Endpoints

```
POST /api/tyrecontrol/informes-ia/interpretar   { peticion }        → { spec, avisos[] }
POST /api/tyrecontrol/informes-ia/ejecutar      { spec }            → { columnas, filas, total }
POST /api/tyrecontrol/informes-ia/resumen       { spec, resultado } → { resumen }
GET  /api/tyrecontrol/informes-ia/catalogo                          → catálogo (para la UI)
```
Todos con `authenticate` + `requireModule("tyrecontrol")`. Guardar/listar
informes va directo por Supabase con RLS (no hace falta backend).

---

## Interfaz — pestaña "Cuadros de mando"

Disposición de tres columnas, como Power BI:

```
┌──────────────┬────────────────────────────────────┬──────────────┐
│ CAMPOS       │  LIENZO (rejilla de 12 columnas)   │ VISUALIZAR   │
│              │                                    │              │
│ ▼ Vehículo   │  ┌────────┐ ┌────────┐ ┌────────┐  │ [KPI][Barr]  │
│   Matrícula  │  │  KPI   │ │  KPI   │ │  KPI   │  │ [Líne][Donut]│
│   Cliente    │  └────────┘ └────────┘ └────────┘  │ [Tabla]      │
│   Base       │  ┌──────────────────┐ ┌─────────┐  │              │
│ ▼ Neumático  │  │     Barras       │ │  Donut  │  │ Ejes         │
│   Marca      │  │                  │ │         │  │  [Base    ✕] │
│   Medida     │  └──────────────────┘ └─────────┘  │ Valores      │
│ ▼ Métricas   │                                    │  [Coste ✕]   │
│   Σ Coste    │                                    │ Filtros      │
│   Ø Profund. │                                    │  [2026    ✕] │
└──────────────┴────────────────────────────────────┴──────────────┘
        ⌨ "Enséñame el gasto por delegación este año"     [Crear con IA]
```

1. **Panel de campos** (izquierda): el catálogo agrupado por entidad. Cada campo
   se **arrastra** al lienzo (crea una visualización nueva) o a las zonas del
   panel derecho (lo añade a la seleccionada).
2. **Lienzo** (centro): rejilla de 12 columnas. Las visualizaciones se **mueven y
   redimensionan** arrastrando. Un clic en una barra/porción **filtra el resto**
   (filtrado cruzado) y aparece una píldora "Filtrado por: Base = Tarragona ✕".
3. **Panel de visualización** (derecha): tipo de gráfico y las zonas *Ejes*,
   *Valores* y *Filtros* con los campos como chips reordenables y eliminables.
4. **Barra de IA** (abajo, siempre visible): caja de texto + botón. Ejemplos
   clicables la primera vez:
   - "Vehículos con más incidencias este trimestre"
   - "Profundidad media por eje de la flota de ENCATRANS"
   - "Coste de neumáticos por delegación este año"
   - "Técnicos ordenados por tiempo medio de revisión"

   Lo que devuelva la IA **se añade como una visualización más**, y se puede
   ajustar a mano como cualquier otra. Esto es lo que hace la herramienta
   fiable: la IA no es una caja negra, es un atajo para no montar el gráfico a
   mano.
5. **Barra superior**: nombre del cuadro de mando, Guardar, Compartir, Duplicar,
   Exportar CSV (por visualización) y el `FiltroBarInformes` global existente
   (empresa / desde / hasta).
6. **Mis cuadros de mando**: lista lateral desplegable con los guardados, propios
   y compartidos por la empresa.

### Decisiones técnicas de la UI
- **Rejilla**: implementación propia con CSS Grid + `pointer events` (12
  columnas, alto en filas de 80 px). **No** meter `react-grid-layout` ni
  dependencias nuevas si se puede evitar: el proyecto no las tiene y el
  comportamiento necesario es acotado.
- **Arrastrar y soltar**: HTML5 drag & drop nativo, suficiente para campos y
  reordenación de chips.
- **Gráficos**: reutilizar los componentes ya existentes en el módulo. Sin
  librerías nuevas.
- **Estilo**: Tailwind, mismo lenguaje visual que el resto del panel.
- **Rendimiento**: cada visualización pide sus datos por separado y cachea por
  hash de su spec; al filtrar en cruzado solo se reejecutan las que cambian.

---

## Criterios de aceptación

**Constructor visual**
- [ ] Se puede montar un cuadro de mando **sin usar la IA**: arrastrando campos
      desde el panel izquierdo. La IA es un atajo, no un requisito.
- [ ] Las visualizaciones se mueven y redimensionan, y la disposición se guarda.
- [ ] El filtrado cruzado funciona: al pulsar una barra, el resto del lienzo se
      filtra; al volver a pulsar, se quita.
- [ ] Un cuadro guardado se reabre igual (mismas visualizaciones y posiciones) y
      con **datos recalculados**, no congelados.

**IA**
- [ ] Los 4 ejemplos producen una visualización válida y correcta.
- [ ] Lo que devuelve la IA es **editable a mano** después, como cualquier otra.
- [ ] Una petición imposible ("dame los datos de otro cliente", "borra los
      neumáticos") se **rechaza con un mensaje claro**, sin ejecutar nada.
- [ ] Sin `OPENAI_API_KEY`, la barra de IA se desactiva con un aviso y **el
      constructor manual sigue funcionando entero**.

**Seguridad y rendimiento**
- [ ] Un usuario de empresa A **nunca** ve datos de empresa B, aunque manipule la
      spec desde el navegador (probar editándola a mano en las DevTools).
- [ ] Ninguna consulta supera 10 s ni devuelve más de 1000 filas.
- [ ] Un lienzo con 12 visualizaciones carga sin bloquear la interfaz.

**No romper nada**
- [ ] Los 11 informes existentes siguen funcionando igual.
- [ ] `tsc --noEmit` limpio.

---

## Riesgos y decisiones

| Riesgo | Decisión |
|---|---|
| Inyección SQL vía IA | La IA no escribe SQL: solo elige claves de un catálogo cerrado. Valores siempre parametrizados. |
| Fuga entre clientes | `empresa_id` lo pone el servidor; el RPC es `security invoker` → manda la RLS. |
| Consultas que tumban la BD | Tope de 1000 filas, `statement_timeout` 10 s, máx. 3 dimensiones y 5 métricas. |
| La IA "acierta a medias" | La spec se muestra y se puede corregir a mano antes de ejecutar. |
| Coste de OpenAI | Solo 2 llamadas por informe (interpretar + resumen), con `gpt-4o-mini`. El resumen es opcional. |
| Datos sensibles a OpenAI | Al interpretar solo viaja la frase + el catálogo (metadatos). Al resumir, solo agregados. Nunca filas crudas ni matrículas de terceros. |
| Reimplementar Power BI entero | Alcance acotado a 5 tipos de visualización, 12 por lienzo y una rejilla propia. Nada de medidas calculadas, jerarquías ni DAX. |

---

## Orden de implementación sugerido

Cada fase deja algo utilizable; no hace falta terminar todo para empezar a usarlo.

1. **Catálogo + RPC de ejecución + validación.** Sin UI: se prueba con curl.
   Es la base de seguridad, y donde hay que ser estricto.
2. **Lienzo y panel de campos** (arrastrar y soltar, una sola visualización).
   Ya es usable sin IA.
3. **Varias visualizaciones, mover/redimensionar y guardar.**
4. **Filtrado cruzado.**
5. **Barra de IA** (interpretar → añadir visualización).
6. **Resumen ejecutivo con IA.**

---

## Fuera de alcance (fase 2)

- Envío programado por email/WhatsApp de cuadros de mando.
- Exportación a PDF con la marca del cliente.
- Acceso desde la APK (esto es panel web).
- Medidas calculadas por el usuario (fórmulas propias).
- Cruce de varias entidades en una misma visualización.
