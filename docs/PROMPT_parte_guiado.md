# Parte de servicio guiado desde la tablet

Prompt previo. **No hay código todavía**: hay tres decisiones que no puedo
tomar yo, y una de ellas toca una estructura central de Mobilink.

---

## Lo que se pide

Una pestaña nueva en Operaciones con el parte de servicio, para que el
operario lo rellene **siguiendo los pasos del propio formulario** desde la
tablet. Si la matrícula está en TyreControl, se traen todos los datos que ya
hay. Si no está, se hace una parametrización pequeña la primera vez y el
vehículo **se da de alta en TyreControl**.

---

## Lo que he comprobado en el código antes de escribir esto

### 1. Un técnico HOY NO PUEDE dar de alta un vehículo

`supabase/migrations/tyrecontrol_fase3.sql:75-78`

```sql
create policy tc_vehiculos_write on tc_vehiculos for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );
```

El operador no está. La APK tampoco tiene ningún camino para crear vehículos
(`supabase_service.dart` solo tiene `buscarVehiculos`, ninguna alta). Así que
«si la matrícula no está, que se añada a TyreControl» **no se puede hacer sin
abrir una puerta que hoy está cerrada**.

Esto es exactamente una estructura central, así que me paro aquí y lo explico
antes de tocarlo. → **Decisión 1**.

### 2. «Una parametrización pequeña» no es tan pequeña

Para que un vehículo sirva de algo en TyreControl hacen falta:

| Campo | Para qué | ¿Se puede dejar para luego? |
|---|---|---|
| `empresa_id` | De quién es. Sin esto no hay permisos ni RLS | **No** |
| `matricula` | Identificarlo | **No** |
| `tipo_vehiculo_id` | **Genera las posiciones** (`generarPosicionesDeTipo`) | **No** |
| `config_ejes_id` | El plano y el «2x2x2» | **No** |
| `medida_id` | Qué goma monta | **No** |
| `tipo_llanta_id` | Llanta | Sí |
| marca, modelo, nº de unidad, delegación | Ficha | Sí |

Sin tipo de vehículo **no hay posiciones**, y sin posiciones el parte no puede
decir de qué rueda salió cada neumático: se quedaría en una lista de gomas sin
sitio, que es justo lo que el parte tiene que evitar. → **Decisión 2**.

### 3. Ya hay dos maneras de hacer un parte, y no pueden competir

Acabamos de meter el parte por fotografías. Si ahora aparece un flujo guiado
al lado, el operario tiene dos botones que hacen lo mismo de dos maneras
distintas, y eso siempre acaba en que la mitad de los partes se hacen de una
forma y la otra mitad de otra. → **Decisión 3**.

---

## Cómo lo haría

### El flujo, en el orden del formulario

Una sola pantalla con pasos, como la de fotos, porque el operario está de pie
al lado del camión y necesita ver dónde está y volver atrás sin perder nada.

**Paso 0 · La matrícula.** Se teclea, se escanea con la cámara (el OCR ya
existe: `ocr_service.dart`) o se elige de los vehículos recientes.

- **Está en TyreControl** → se traen empresa, flota, tipo, configuración de
  ejes, medida, km conocidos y **el plano con las ruedas que hay montadas
  ahora**. El operario no teclea nada de eso.
- **No está** → salta la parametrización (abajo).

**Paso 1 · Cabecera.** Flota, matrícula, km, fecha, orden de flota y lugar del
servicio (taller / instalaciones de la flota / carretera). Todo relleno de
antemano salvo km, orden y lugar.

**Paso 2 · Las ruedas.** El plano del vehículo, con sus posiciones reales. Se
toca una rueda y se dice qué le pasa: se desmonta, se monta, se permuta, se
repara. **Aquí está la diferencia que importa**: el formulario en papel tiene
una tabla de desmontados y otra de montados, pero rellenarlas como dos listas
sueltas produce filas sin posición. Se rellenan tocando la rueda, y las dos
tablas del PDF salen solas de ahí.

**Paso 3 · Neumáticos nuevos.** Los que se han montado, agrupados por marca,
medida y modelo. Sale ya calculado del paso 2; solo se revisa.

**Paso 4 · Servicios.** Los doce del catálogo con su cantidad.

**Paso 5 · Alineación**, si la hubo.

**Paso 6 · Firmas.** Cliente (nombre y DNI) y técnico, con el dedo.

**Paso 7 · Hecho.** PDF.

Nada se guarda hasta el paso 7, igual que en el de fotos.

### La parametrización, cuando la matrícula no existe

Cuatro preguntas, no un formulario de alta completo:

1. **¿De qué flota es?** — De las empresas que el operario tenga asignadas. Si
   solo tiene una, ni se pregunta.
2. **¿Cómo son los ejes?** — Las seis configuraciones que ya existen
   (`2x2`, `2x4`, `2x2x2`, `2x2x4`, `2x4x4`, `2x2x2x2`), **en dibujos, no en
   una lista de códigos**. El operario reconoce el camión de un vistazo; «2x2x4»
   no lo dice nadie en un taller.
3. **¿Qué medida lleva?** — Del catálogo, con las más usadas de esa flota
   primero.
4. **Matrícula y nº de unidad** — la matrícula ya viene del paso 0.

El tipo de vehículo se deduce de la configuración de ejes, que es lo que de
verdad determina las posiciones. Marca, modelo, delegación y tipo de llanta
**no se preguntan**: se rellenan después desde el panel.

El vehículo nace marcado **pendiente de validar**, igual que las referencias
provisionales del catálogo (`tc_crear_referencia_provisional`): un
administrador lo repasa, le pone marca y modelo, o lo fusiona si resulta que ya
estaba dado de alta con la matrícula escrita de otra manera.

---

## Las tres decisiones

### Decisión 1 · Quién puede dar de alta un vehículo desde la tablet

| Opción | Qué implica |
|---|---|
| **A. Abrir `tc_vehiculos` a los operadores** | Una línea de RLS. Pero abre la tabla entera: un operador podría crear, editar y borrar cualquier vehículo de su empresa desde cualquier sitio, no solo desde el parte. |
| **B. Una función acotada** `tc_alta_vehiculo_desde_parte(...)` **(recomendada)** | `security definer`, crea el vehículo con exactamente esos cuatro campos, lo marca pendiente de validar y genera sus posiciones. El operador no gana permiso sobre la tabla: gana permiso para **una** operación concreta. Es el patrón que ya aprobaste para el catálogo. |
| **C. No crear nada** | El parte guarda la matrícula como texto y ya lo dará de alta un administrador. Rechazada: un parte que no cuelga de un vehículo no alimenta el histórico, y alimentar lo que ya hay era el punto de partida. |

**Recomiendo B.** Una puerta estrecha, no la pared entera.

### Decisión 2 · ¿Bastan esas cuatro preguntas?

Empresa, configuración de ejes, medida y matrícula. Marca, modelo, delegación
y llanta se dejan para el panel.

El riesgo de pedir menos: un vehículo a medias que alguien tiene que arreglar
después. El riesgo de pedir más: el operario abandona a mitad y hace el parte
en papel, que es lo que hace hoy.

### Decisión 3 · Qué pasa con la pantalla de fotos

| Opción | Qué implica |
|---|---|
| **A. Fundirla dentro del flujo guiado (recomendada)** | En el paso 0 aparece «rellenar con fotos». La IA propone y el operario sigue por los mismos pasos. Un solo camino, con un atajo dentro. |
| **B. Dejar las dos** | Dos botones que hacen lo mismo. Acaba en partes hechos de dos maneras y en dos pantallas que mantener. |

**Recomiendo A.**

---

## Preguntas menores, pero que cambian el trabajo

1. **¿Tractora y remolque en el mismo recorrido?** Ya decidimos que son dos
   partes. En un flujo guiado eso significa preguntar al principio «¿lleva
   remolque?» y encadenar el segundo parte al terminar el primero. ¿Se hace, o
   se dejan como dos partes independientes?

2. **¿Sin cobertura?** Propongo: el borrador se guarda en la tablet y no se
   pierde nada, pero **finalizar necesita red**, y el alta de vehículo también.
   Encolar un alta de vehículo sin saber si otro lo dio de alta mientras tanto
   fabrica matrículas duplicadas, que es peor que esperar.

3. **¿Pestaña abajo o azulejo en Inicio?** La barra de abajo tiene cinco
   (Inicio, Revisiones, Herramientas, Sincronización, Perfil) y una sexta la
   aprieta. Propongo azulejo en Inicio, junto a «Operaciones».

4. **¿Puede el operario cerrar el parte de una intervención que abrió otro?**
   Hoy la intervención no tiene dueño. Si el parte se firma, conviene que sí lo
   tenga.

---

## Lo que NO haría

- **No** una tabla nueva de partes. El parte es la intervención, y ya lo es.
- **No** un catálogo de vehículos paralelo para los dados de alta desde la
  tablet.
- **No** rellenar las tablas de desmontados y montados como listas de texto.
  Sin posición, el parte deja de servir para el histórico.
- **No** dar de alta el vehículo antes de que el operario termine el paso 0:
  una matrícula mal tecleada crearía un vehículo fantasma cada vez.

---

## Cuánto es

Cuatro capas, como el parte por fotos:

1. **Base de datos** — `tc_alta_vehiculo_desde_parte`, `pendiente_validar` en
   `tc_vehiculos`, y el dueño de la intervención si se decide que sí.
2. **Panel** — la pantalla donde el administrador valida los vehículos que han
   nacido en la tablet.
3. **APK** — el flujo guiado, que es el grueso.
4. **Manual** — actualizar el que ya hay.

Las capas 1 y 2 se pueden hacer sin tocar la 3, y la 3 sin la 4.
