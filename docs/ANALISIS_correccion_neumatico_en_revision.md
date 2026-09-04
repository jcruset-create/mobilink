# Corrección de neumático desde la revisión — análisis previo

Fase 0 del encargo: mirar qué hay antes de escribir nada. El resultado corto es
que **una parte importante ya está construida**, y que las cinco cosas que
faltan chocan con reglas que hoy están escritas al revés. Ninguna se puede
resolver "reutilizando lo existente" sin decidir antes.

## 1. Lo que ya existe y hay que reutilizar tal cual

| Necesidad del encargo | Lo que ya hay |
|---|---|
| Corregir el neumático de una posición | `tc_corregir_montado(p_montaje, p_neumatico_correcto, p_obs)` — `security definer`, cambia `tc_montajes_actuales` y deja rastro |
| Que no sea una operación de taller | `tipo_operacion = 'correccion_montado'` con `es_fisica = false` en `tc_cat_tipos_operacion`, y la columna `operaciones_neumaticos.is_correccion` |
| Actuar sobre una rueda montada desde la revisión, sin tocarla | `tc_identificar_neumatico` (`tyrecontrol_identificar_neumatico.sql`) — el mismo patrón, y ya resuelve el permiso del técnico con `tc_operador_ve_empresa` |
| IA de visión | `server/tyrecontrol/ficha-tecnica/ocrService.ts` sobre `pedirIA` (`server/core/openaiService.ts`), con `confianza` por campo y la filosofía IA propone → persona confirma |
| Fotos | `revisiones_neumaticos_detalle.foto_url` + `enqueueFoto` / `subirFotoRevision` del APK |
| Estado para el que no aparece | `no_localizado`, `extraviado` y `pendiente_validar` YA son estados válidos de `tc_neumaticos` |
| Evitar duplicados de catálogo | `tc_marca_normalizada`, `tc_medida_normalizada` y sus disparadores |
| Montar desde catálogo | `tc_montar_desde_catalogo` |

No hace falta ni un sistema de fotos nuevo, ni otro catálogo, ni un estado
nuevo para "no sé dónde está", ni una tabla de auditoría nueva.

## 2. Los cinco choques reales

Cada uno toca una estructura central, así que ninguno se resuelve sin decisión.

### 2.1 `tc_corregir_montado` hace justo lo que el punto 11 prohíbe

```sql
-- el mal registrado vuelve a almacén (nunca estuvo realmente montado)
update tc_neumaticos set estado = 'almacen', ... where id = v_wrong.id;
```

El encargo dice lo contrario: no devolverlo al almacén, no inventar stock, y
usar el estado de ubicación desconocida. El estado `no_localizado` ya existe,
así que el cambio es de una línea — pero **cambia el comportamiento del botón
que hoy ya usa el panel** en `VehicleLayout.tsx`.

### 2.2 El técnico no puede ejecutarla

`tc_corregir_montado` exige `tc_is_admin()`. La revisión la hace el técnico en
el APK. Quien detecta la discrepancia es exactamente quien hoy no puede
corregirla. `tc_identificar_neumatico` ya resolvió esto mismo aceptando además
`tc_operador_ve_empresa`.

### 2.3 Crear una referencia de catálogo es imposible hoy

`tc_cat_marcas_neumatico`, `tc_cat_modelos_neumatico` y
`tc_referencias_neumatico` tienen todas la misma política:

```sql
for all using ( tc_is_superadmin() ) with check ( tc_is_superadmin() )
```

El punto 6 —crear la referencia desde la propia revisión— no se puede hacer sin
tocar esto. Y aquí el encargo se contradice consigo mismo: pide crear
referencias desde la revisión y a la vez no tocar estructuras centrales.

### 2.4 `is_correccion` y `es_fisica` hoy son decorativos

Ningún informe los respeta. `is_correccion` solo pinta una etiqueta naranja en
`InformeIntervencion.tsx`; `es_fisica` solo se usa para decidir si una
operación prevista se completa a mano. Ni la pantalla de Operaciones ni
`tc_informes_operaciones` ni el informe económico los excluyen.

Es decir: **una corrección hecha hoy SÍ aparece como operación**. El punto 14
no lo cumple la maquinaria existente; hay que aplicar el filtro de verdad, y
eso toca pantallas e informes que ya funcionan.

### 2.5 La revisión funciona sin cobertura

`offline_store.dart` encola `detalle`, `completar` y `foto`. La identificación
por IA necesita red. Y la corrección cambia `tc_montajes_actuales`, que no se
puede encolar a ciegas: entre que se encola y se sube, otra corrección puede
haber tocado la misma posición.

## 3. Lo que hay que decidir antes de programar

1. **Dónde va el botón "No coincide"**: APK (`tire_detail_screen.dart`) o panel
   (`RevisionVehiculo.tsx`). El encargo habla de técnico y de fotografía, que
   apunta al APK; pero la corrección ya tiene interfaz en el panel
   (`VehicleLayout.tsx`). Si es el APK, es trabajo de Flutter, no de React.
2. **El neumático que se cae**: ¿`no_localizado` (lo que pide el encargo) o
   seguir mandándolo a `almacen` (lo que hace hoy)? Y si se cambia, ¿cambia
   también para el botón que ya existe en el panel, o solo desde la revisión?
3. **Permiso del técnico**: ¿se abre `tc_corregir_montado` al operador, como
   ya se hizo con `tc_identificar_neumatico`?
4. **Crear catálogo desde la revisión**: exige tocar la RLS o una función
   `security definer` que la salte. ¿Se hace, o el técnico solo puede elegir
   entre lo que ya existe y queda pendiente para el administrador?
5. **Sin cobertura**: ¿la corrección es solo con red, o se encola?

## 4. Lo que se puede hacer sin decidir nada

Aunque las cinco de arriba estén abiertas, esto no depende de ninguna:

- Añadir `p_revision` a `tc_corregir_montado` para atar la corrección a la
  revisión en que se detectó (punto 12). Es aditivo y no rompe a quien la
  llama hoy sin ese argumento.
- Hacer que la pantalla de Operaciones y los informes respeten `is_correccion`
  / `es_fisica`, que es lo que el punto 14 pide y hoy no ocurre.
