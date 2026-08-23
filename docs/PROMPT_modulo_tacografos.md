# PROMPT — Módulo Tacógrafos (documentación legal de sustituciones)

> Estado: **diseño previo a programar**. Decisión tomada: es un **módulo propio**,
> no una sección del área de taller.
> Fases 0 y 1 completadas: ver [`ANALISIS_excel_tacografos.md`](./ANALISIS_excel_tacografos.md).
> **Alcance acotado:** el módulo cubre los certificados de transferibilidad e intransferibilidad
> y los documentos que los envuelven. El anexo II del RD 125/2017 (el informe/certificado oficial
> de 27 campos) lo emite la **extranet de VDO** y queda fuera. La custodia de los archivos
> transferidos y su destrucción al año **sí son del centro** y entran en el módulo.
> Especificación funcional y documental completa en
> [`PROMPT_excel_tacografos_documentacion.md`](./PROMPT_excel_tacografos_documentacion.md).

---

## 1. Qué es

Un centro técnico de tacógrafos debe emitir, cada vez que sustituye un tacógrafo
digital, documentación legal firmada por el cliente y, en algunos casos,
comunicarla a la Generalitat de Catalunya. Hoy eso vive en una hoja de cálculo
donde los mismos datos se reescriben varias veces.

El módulo `tacografos` convierte ese proceso en un expediente: se introducen los
datos una vez y de ahí salen los documentos, las firmas y el registro de qué se
entregó, a quién y cuándo.

Dos flujos, excluyentes por expediente:

- **Transferencia correcta** → justificante de transferencia de datos, firmado por
  el cliente, que autoriza la descarga de la memoria interna, la transferencia de
  los ficheros y la modalidad de entrega elegida.
- **Intransferibilidad** → certificado de intransferibilidad, acuse de recibo del
  cliente y comunicación a la administración.

## 2. Por qué módulo propio y no una sección de taller

Se licencia por separado: el destinatario es cualquier centro técnico de
tacógrafos, no sólo el taller de COMERCIAL SEA. Eso obliga a clave de licencia
propia, permisos propios y un ciclo de vida documental (emisión, firma,
conservación, presentación ante la administración) que no encaja dentro del
histórico de operaciones de taller.

Consecuencia asumida: el expediente **no depende** de que exista una intervención
en `tc_intervenciones`. Cuando exista, se enlaza y autorrellena; cuando no, el
expediente se crea suelto. Esto es deliberado — un centro que compre sólo este
módulo no tiene taller en Mobilink.

## 3. Encaje técnico

El repo ya tiene el patrón exacto que hay que seguir. No se inventa nada.

### Servidor — copiar la forma de `server/cash/`

```
server/tacografos/
  index.ts        initTacografos / mountTacografos  (igual que server/cash/index.ts:18)
  schema.ts       CREATE TABLE IF NOT EXISTS idempotente (patrón server/licenses/schema.ts)
  router.ts       createTacografosRouter() → app.use("/api/tacografos", …)
  repository.ts   acceso a datos + errores tipados
  service.ts      reglas de negocio
  permissions.ts  derivados del rol en app_usuario_modulos (patrón server/cash/permissions.ts)
  documents.ts    generación de PDF con pdf-lib (ya es dependencia del proyecto)
  templates/      textos legales versionados
  storage.ts      bucket privado + enlaces firmados (patrón server/cash/storage.ts)
```

Montaje en `server/index.ts`: tres llamadas, como `initCash`/`mountCash`
(`server/index.ts:23`). Todas las rutas detrás de
`authenticate, requireModule("tacografos")` (`server/core/auth.ts:140`).

La clave de módulo no es un enum en código: `licenciaActiva()` consulta
`app_licencia_activa(empresaId, modulo)` en base de datos
(`server/core/auth.ts:129`). Basta con dar de alta `tacografos` como módulo
licenciable y añadirlo a `licenses.modules`.

### Frontend — copiar la forma de `src/modules/safety/` y `toolcontrol/`

```
src/modules/tacografos/
  pages/       TacografosDashboard · NuevoExpediente · Expediente · Comunicaciones · ConfiguracionCentro
  components/  FormularioDatos · VistaDocumento · CapturaFirma
  services/    api.ts
  types/       index.ts
```

Rutas en `src/App.tsx` bajo `/tacografos/*`, envueltas en `<Protegida>`, con el
mismo estilo que las de `/safety` y `/toolcontrol` (`src/App.tsx:314`).

## 4. Modelo de datos

Prefijo `tac_`. Migraciones idempotentes.

| Tabla | Contenido |
|---|---|
| `tac_centros` | Datos fijos del centro técnico por empresa: razón social, nº de centro (`E943009`), dirección, ciudad, email, URL del trámite. Sustituye a la hoja CONFIG del Excel. |
| `tac_expedientes` | Empresa cliente · persona autorizada · DNI/NIF · matrícula · marca/modelo/nº serie del tacógrafo retirado · nº de informe · fecha informe · fecha entrega · tipo (`transferencia`\|`intransferibilidad`) · modalidad de entrega · entrega física del aparato sí/no · achatarramiento sí/no · estado · `intervencion_id` opcional. |
| `tac_plantillas` | Textos legales **versionados**. Un cambio normativo futuro crea una versión nueva; los documentos ya emitidos siguen apuntando a la suya. |
| `tac_documentos` | Un PDF emitido: expediente, tipo (`justificante`\|`acuse_cliente`\|`comunicacion_admin`), versión de plantilla, ruta en storage, hash, firmante, fecha de firma. |
| `tac_comunicaciones` | Presentación ante la administración: fecha, referencia/registro devuelto, quién la presentó, justificante adjunto. |

Regla dura: **un documento firmado es inmutable.** Se guarda con su hash; corregir
un dato no reescribe el PDF, emite uno nuevo y deja el anterior anulado con motivo.
Es documentación legal, no un borrador.

## 5. Permisos

Derivados del rol en `app_usuario_modulos`, sin tabla de permisos paralela —
exactamente el razonamiento de `server/cash/permissions.ts`:

`tacografos.view` · `.expediente.create` · `.expediente.edit` · `.documento.generate` ·
`.documento.sign` · `.documento.annul` · `.comunicacion.register` · `.config.edit`

## 6. Pantallas

1. **Dashboard** — expedientes abiertos, pendientes de firma y pendientes de
   comunicar a la administración. Ésta es la ganancia real frente al Excel: hoy
   nada avisa de que falta presentar un trámite.
2. **Nuevo expediente** — formulario único, equivalente a la hoja DATOS: cliente,
   vehículo, tacógrafo, intervención, entrega de datos, tacógrafo averiado.
   Desplegables, matrícula en mayúsculas, fechas `dd/mm/aaaa`, campos obligatorios
   condicionados al tipo de operación.
3. **Expediente** — vista previa de los documentos que le corresponden, generación
   de PDF, captura de firma, registro de entrega.
4. **Comunicaciones** — cola de trámites pendientes, texto copiable para el
   formulario de la Generalitat, enlace al trámite, registro de la referencia.
5. **Configuración del centro** — `tac_centros`.

## 7. Documentos

- Generación en servidor con `pdf-lib`.
- Textos jurídicos desde `tac_plantillas`, **nunca dentro del código**.
- Firma capturada en canvas y embebida en el PDF, como el justificante de
  `src/modules/cash/components/JustificantePrevio.tsx`.
- Almacenamiento en bucket **privado** con enlaces firmados caducables, no público:
  contienen NIF de personas físicas. Mismo criterio y mismos motivos que
  `server/cash/storage.ts`.
- Exportación `.xlsx` del expediente como salida secundaria (`xlsx` ya es
  dependencia del frontend, `vite.config.ts:66`), para respaldo offline.

## 8. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Análisis del Excel original y transcripción literal de los textos legales | **hecha** — ver `ANALISIS_excel_tacografos.md` |
| 1 | Excel mejorado, entregable e independiente del despliegue | **hecho** — `plantillas/TACOGRAFOS_documentacion.xlsx` |
| 2 | `server/tacografos/` (schema, router, repository, permissions), tablas `tac_*`, alta como módulo licenciable y formulario único de expediente | **hecha** |
| 3 | Los tres PDF con `pdf-lib` desde plantillas versionadas, bucket privado, documento inmutable con hash | **hecha** |
| 4 | Firma en pantalla (cliente, receptor y técnico) y registro de entrega | **hecha** |
| 5 | Custodia: plazo de un año, aviso de pendientes de destruir y documento de destrucción con sus siete campos; cola de comunicaciones a la Generalitat; conservación cinco años de las copias emitidas | |
| 6 | Enlace con `tc_intervenciones` para autorrellenar y exportación `.xlsx` del expediente | **hecha** |

Las fases 0 y 1 no son trabajo tirado: el Excel funciona desde el primer día, sin
esperar al despliegue, y es la fuente de la que salen los textos legales de
`tac_plantillas`.

## 8.1 Pruebas contra PostgreSQL

`server/tacografos/tacografos.integration.test.ts` cubre lo que no se puede
probar en memoria: el índice único parcial que impide dos documentos vigentes
del mismo tipo, el choque del nº de informe, el aislamiento entre empresas, las
transiciones de estado y el viaje de las fechas a `DATE` y vuelta.

```bash
export DATABASE_URL="postgres://usuario:clave@127.0.0.1:5432/base_desechable"
export PGSSLMODE=disable RUN_DB_TESTS=1
npx vitest run server/tacografos/
```

La primera ejecución destapó un fallo que habría llegado a producción: `pg`
construye la fecha de una columna `DATE` a medianoche **local**, así que en
`Europe/Madrid` un `2025-03-10` volvía como `2025-03-09` y **el certificado
habría salido fechado un día antes en toda España** — junto con el plazo de
custodia de un año. La prueba fija ahora `TZ=Europe/Madrid` para que el fallo
no pueda volver aunque la CI corra en UTC.

## 8.2 Supuesto del autorrelleno desde el taller

Las tablas `tc_*` de TyreControl **no llevan columna de inquilino**: su
`empresa_id` apunta a `tc_empresas`, que es la empresa de transportes cliente,
no el centro que usa Mobilink. El aislamiento allí lo hace RLS contra
`tc_usuarios`, un mecanismo distinto del `app_usuario_modulos` de este módulo,
así que **no hay forma de filtrar `tc_intervenciones` por el `empresaId` de la
sesión**.

Por eso el autorrelleno sólo se ofrece a quien tiene **licencia de
`tyrecontrol`** vigente y las tablas presentes: si el centro tiene TyreControl
contratado, esos datos ya son suyos y los ve en su propio módulo. Sin esa
licencia no se consulta nada.

Si algún día el despliegue deja de ser de un solo centro técnico, esto hay que
revisarlo antes que ninguna otra cosa.

## 9. Decisiones abiertas

- **Nombre comercial** del módulo (el resto son Mobilink Cash, Safety, ToolControl…).
- **Idioma** de la comunicación a la Generalitat: catalán, castellano o ambos.
- **Nº de informe**: ¿serie autogenerada por el módulo o tecleada por el técnico? Ojo: si el
  número lo asigna la extranet al emitir el anexo II, aquí sólo se copia.
  Si se autogenera, hay que decidir si comparte contador con el nº de operación
  de taller (`PROMPT_numero_de_operacion.md`) o lleva serie propia.
- **Alcance**: ¿sólo web, o también pantalla en la APK de técnicos para firmar en
  el vehículo?
- **Conservación**: cuántos años deben guardarse los documentos emitidos.
