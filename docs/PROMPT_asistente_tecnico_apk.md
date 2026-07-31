# PROMPT — Asistente del técnico en la APK (TyreControl)

> Prompt listo para implementar en `jcruset-create/mobilink`. Añade a
> `tyrecontrol_app` un **asistente conversacional para el técnico en campo**:
> resuelve dudas sobre el vehículo que tiene delante, el stock y el histórico,
> sin obligarle a navegar por cinco pantallas con las manos sucias.

---

## Principio rector

**Es una herramienta de taller, no un chatbot.** El técnico está de pie, con
guantes, con sol de cara y a veces sin cobertura. De ahí todo lo demás:

1. **Sabe dónde está.** Si el técnico tiene abierto el 6133LXF, *"¿cómo está?"*
   se refiere a ese vehículo. No hay que dictar la matrícula.
2. **Responde en dos líneas.** Nada de párrafos: un dato y la acción.
3. **Sin cobertura, avisa y no miente.** Si no hay red, lo dice y ofrece lo que
   tenga cacheado, marcándolo como "puede estar desactualizado".
4. **No decide por el técnico.** Informa; la responsabilidad de montar,
   desmontar o descartar sigue siendo suya.

> Comparte backend con `PROMPT_asistente_virtual_ia.md` (asistente del cliente):
> **el mismo endpoint y el mismo motor de herramientas**, cambiando el conjunto
> de herramientas y el system prompt. **Implementar aquel primero** y este sale
> casi gratis. No duplicar el bucle de function calling.

---

## Diferencias con el asistente del cliente

| | Cliente (panel web) | **Técnico (APK)** |
|---|---|---|
| Pregunta por | su flota entera | **el vehículo que tiene delante** |
| Contexto | ninguno | **pantalla y vehículo actuales** |
| Alcance | su empresa | **el cliente activo de la sesión** |
| Tono | ejecutivo | **operativo, telegráfico** |
| Red | siempre | **puede no haber** |
| Herramientas clave | KPIs, costes | **stock, catálogo, histórico de la rueda** |

---

## Contexto ya construido (reutilizar, no reinventar)

### APK (`tyrecontrol_app/lib/`)
- **Cliente activo**: `TyreControlApi.clienteActivo` (`ClienteActivo`), con
  `empresaActivaId`. **Todo lo que responda el asistente debe ceñirse a él.**
- **Offline**: `OfflineStore` (Hive) con cachés (`cacheJson`/`cachedJson`),
  `OfflineStore.offline` (ValueNotifier) y cola de subida. **El asistente lee
  `offline` para saber si puede consultar.**
- Pantallas donde vive el contexto: `review_screen` (revisión en curso),
  `cambio_neumatico_screen` (posición seleccionada), `vehiculo_ficha_screen`,
  `incidencias_screen`, `catalogo_screen`.
- `services/supabase_service.dart`: llamadas al backend con
  `Authorization: Bearer $currentSessionToken` (ver `conduccionWebfleet`).
- Tema: `AppColors` (fondo casi negro, alto contraste) y `AppSizes` con **modo
  exterior** (fuentes grandes para sol directo y guantes). **Usarlo.**

### Backend
- `server/tyrecontrol/asistente.ts` (del prompt del cliente): bucle de function
  calling, validación y registro. **Reutilizar; añadir solo el perfil `tecnico`.**

---

## Herramientas del técnico

Además de las del cliente (`estado_flota`, `alertas_activas`, …), estas propias:

| Herramienta | Devuelve | Responde a |
|---|---|---|
| `vehiculo_actual` | última revisión, mm y bar por posición, incidencias abiertas, km | *"¿cómo está?"* |
| `historial_posicion` | qué se montó/desmontó en esa posición y cuándo | *"¿cuándo se cambió esta rueda?"* |
| `stock_medida` | stock del cliente para la medida del vehículo (nuevos/usados) | *"¿qué tengo para esta medida?"* |
| `catalogo_referencia` | ficha del catálogo: dibujo, presión máx., carga | *"¿cuántos mm trae este modelo nuevo?"* |
| `umbral_medida` | mínimo legal y de aviso aplicables | *"¿por dónde está el corte?"* |
| `presion_objetivo` | presión recomendada por eje del vehículo | *"¿a cuánto lo inflo?"* |
| `mis_revisiones` | revisiones del técnico hoy / pendientes | *"¿qué me queda hoy?"* |
| `proximas_revisiones` | vehículos del cliente que tocan pronto | *"¿qué hay para mañana?"* |

**Reglas** (heredadas): `empresa_id` lo pone el servidor desde el cliente activo;
solo lectura; máx. 3 herramientas por pregunta; 50 filas y 8 s por herramienta.

---

## Contexto automático (lo que hace que sea útil de verdad)

En cada pregunta, la app envía junto al texto:

```json
{
  "pregunta": "¿cómo está?",
  "contexto": {
    "pantalla": "cambio_neumatico",
    "vehiculo_id": "…", "matricula": "6133LXF",
    "posicion_id": "…",  "posicion": "E2_IZQ",
    "medidas_vehiculo": ["385/65R22.5"],
    "revision_en_curso": true
  }
}
```

El backend lo inyecta en el system prompt: *"El técnico está en la pantalla de
cambio del 6133LXF, posición E2_IZQ"*. Así funcionan las preguntas cortas —
*"¿y esta?"*, *"¿cuánto le queda?"*— que son las que realmente se hacen en el
taller.

> Sin esto, el asistente es un buscador lento. Con esto, ahorra pasos de verdad.

---

## Comportamiento sin cobertura

El técnico trabaja en naves y polígonos: la app ya está diseñada para funcionar
offline y **el asistente no puede ser la excepción que rompa esa confianza**.

1. `OfflineStore.offline == true` → el botón sigue visible, pero al preguntar
   responde: *"Sin conexión. No puedo consultar ahora."*
2. **Preguntas respondibles en local se responden igual**, con los datos que la
   pantalla ya tiene cargados (mm y bar de la revisión en curso, stock cargado al
   abrir, umbrales): se resuelven **en el dispositivo, sin IA**, con un vistazo a
   los datos en memoria.
3. Nunca se encola una pregunta para responder más tarde: una respuesta que llega
   media hora después no sirve de nada y confunde.

**Decisión:** un conjunto pequeño de preguntas frecuentes se resuelve **siempre
en local aunque haya red** (más rápido y gratis): *"¿cuánto le queda a esta?"*,
*"¿a cuánto la inflo?"*, *"¿está por debajo del mínimo?"*.

---

## Interfaz

- **Botón flotante** (icono de chat) en Inicio, ficha de vehículo, revisión y
  cambio. En revisión y cambio **no debe tapar** el plano ni los botones de
  acción: esquina inferior izquierda, semitransparente.
- **Hoja inferior** (bottom sheet) al pulsarlo, ocupando media pantalla: el
  técnico sigue viendo el vehículo detrás.
- **Chips de pregunta rápida** según la pantalla:
  - En cambio: *"¿Qué stock tengo de esta medida?"*, *"¿Cuándo se cambió esta rueda?"*, *"¿A cuánto la inflo?"*
  - En revisión: *"¿Está bajo mínimo?"*, *"¿Cuánto llevo hoy?"*
  - En Inicio: *"¿Qué me queda hoy?"*, *"¿Qué hay para mañana?"*
- **Respuestas de 2-3 líneas**, cifras en negrita, tipografía `AppSizes` (modo
  exterior). Nada de tablas.

### Dictado por voz (botón de micrófono)

Es **la entrada natural** para alguien con guantes y las manos sucias: escribir
en una tablet en esas condiciones es justo lo que hace que una herramienta no se
use. Va junto a la caja de texto, no la sustituye.

**Cómo:** paquete `speech_to_text` (Flutter). Usa el reconocedor **del propio
sistema** — `SpeechRecognizer` en Android, framework Speech en iOS —, así que no
se sube audio a ningún servidor nuestro ni de OpenAI.

**Lo que hay que tocar:**
- `pubspec.yaml`: añadir `speech_to_text` (dependencia nueva, la primera de
  audio del proyecto).
- `AndroidManifest.xml`: **falta `RECORD_AUDIO`** (hoy solo hay INTERNET, CAMERA,
  BLUETOOTH_* y ACCESS_FINE_LOCATION) y, en Android 11+, la entrada `<queries>`
  con `android.speech.RecognitionService` — sin ella el reconocedor no se
  encuentra y falla en silencio.
- `permission_handler` ya está en el proyecto: se reutiliza para pedir el
  permiso, con el mismo patrón que Bluetooth.
- iOS: `NSSpeechRecognitionUsageDescription` y `NSMicrophoneUsageDescription` en
  el `Info.plist`.

**Comportamiento:**
1. Mantener pulsado el micro → escucha; soltar → transcribe y envía.
   Mantener pulsado evita disparos accidentales, que en un bolsillo o con la
   tablet apoyada serían constantes.
2. **La transcripción se muestra antes de enviarse** y es editable. En un taller
   se va a equivocar: el técnico debe poder corregir sin repetir todo.
3. Si el permiso se deniega o no hay reconocedor, el botón se oculta y queda la
   caja de texto. Nunca bloquea.
4. Idioma fijado a `es_ES`.

**Aviso honesto sobre el ruido:** un taller con compresor o pistola de impacto
es un entorno malo para el reconocimiento de voz. El dictado del sistema
funciona bien en el patio o en cabina, y regular al lado de una máquina. No se
debe vender como infalible, y **por eso la caja de texto no desaparece nunca**.

**Sin conexión:** el reconocimiento de Android puede funcionar offline **solo si
el técnico tiene descargado el paquete de voz en español** (Ajustes → Idiomas →
Reconocimiento de voz sin conexión). Conviene dejarlo hecho al preparar las
tablets. Si no está, sin red no hay dictado.

**Alternativa descartada:** grabar audio y transcribir con Whisper en el backend
daría mejor precisión con ruido, pero exige red siempre, añade coste por
minuto, sube voz del técnico a un tercero y mete latencia. Para frases de cinco
palabras no compensa. Si el ruido resulta ser un problema serio en campo, se
reconsidera.

---

## Criterios de aceptación

**Útil en taller**
- [ ] Con el 6133LXF abierto, *"¿cómo está?"* responde de **ese** vehículo sin
      decir la matrícula.
- [ ] En la pantalla de cambio con E2_IZQ seleccionada, *"¿cuándo se cambió
      esta?"* responde de **esa posición**.
- [ ] *"¿Qué stock tengo de esta medida?"* devuelve el stock del **cliente
      activo** y la medida del vehículo, sin más datos.
- [ ] Las respuestas caben en pantalla sin desplazar.

**Seguro**
- [ ] Solo datos del **cliente activo**: cambiar de cliente cambia lo que
      responde; nunca mezcla.
- [ ] No modifica nada: ninguna herramienta escribe.
- [ ] No inventa cifras. Sin dato → lo dice.
- [ ] Ante un neumático bajo mínimo legal, **recomienda sustituir sin matices**.

**Robusto**
- [ ] Sin cobertura: avisa con claridad y responde igual las preguntas locales.
- [ ] Sin `OPENAI_API_KEY` en el server: el botón no aparece; la APK, intacta.
- [ ] El botón no tapa el plano ni los botones de Finalizar/Deshacer.
- [ ] `flutter analyze` limpio.

**Voz**
- [ ] Mantener pulsado el micro dicta; la transcripción se puede **corregir**
      antes de enviar.
- [ ] Denegar el permiso de micrófono **no rompe nada**: el botón desaparece y
      queda la caja de texto.
- [ ] Funciona con guantes puestos (zona táctil del botón ≥ 56 px).

---

## Riesgos y decisiones

| Riesgo | Decisión |
|---|---|
| **Que estorbe** — es lo más probable | Botón discreto, hoja inferior, y **medir uso real**: si en un mes no se usa, se quita. Mejor retirarlo que dejar ruido en la pantalla del técnico. |
| Que el técnico se fíe de un dato viejo | Todo lo servido de caché va marcado como tal, con la fecha. |
| Consejo técnico equivocado | El asistente informa; no decide. Bajo mínimo → sustituir, sin matices. |
| Coste de OpenAI por técnico | Preguntas frecuentes resueltas en local sin IA; `gpt-4o-mini`; máx. 3 herramientas. |
| Datos sensibles saliendo del taller | Al modelo solo van la pregunta, el contexto (matrícula y posición) y agregados. Nunca la base de datos. |

---

## Orden de implementación

1. **Preguntas locales sin IA** (mm de esta rueda, presión objetivo, bajo
   mínimo) con la hoja inferior y los chips. **Funciona sin cobertura y sin
   coste** — y ya resuelve las tres preguntas más repetidas del taller.
2. **Conexión al backend** del asistente del cliente, con perfil `tecnico` y
   contexto de pantalla.
3. **Herramientas propias** (stock, historial de posición, catálogo).
4. **Dictado por voz.** Va aquí y no al final: con guantes es lo que hace que el
   asistente se use o no, y sin él la fase 5 mediría un uso falsamente bajo.
5. **Medir uso.** Si se usa, seguir; si no, retirar el botón.

> Empezar por la 1 tiene truco a propósito: entrega valor **sin depender de la
> IA ni de la red**, y sirve para saber si el técnico va a usar esto antes de
> gastar en lo demás.

---

## Fuera de alcance

- Acciones de escritura desde el asistente (montar, cerrar incidencias).
- Voz (fase 2).
- Asistente sin conexión con modelo local en el dispositivo.
- Formación técnica general ("cómo se equilibra una rueda"): esto responde sobre
  **datos**, no es un manual.
