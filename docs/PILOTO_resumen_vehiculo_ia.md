# Piloto manual del resumen IA de vehículo

**Estado: preparado, SIN EJECUTAR.** Ejecutarlo implica llamadas reales de
pago a OpenAI y activar la funcionalidad para una empresa. Las dos cosas
necesitan una autorización explícita que a fecha de este documento no se ha
dado.

Este documento es el guion: qué vehículos, qué se mide, qué se apunta y qué
se considera un resultado malo. Está escrito para que lo ejecute una persona
con acceso a producción en una sesión de una tarde.

---

## 1. Qué se quiere saber

Cuatro cosas, en este orden de importancia:

1. **Exactitud frente a las evidencias.** Cada hecho del resumen enlaza a un
   registro. ¿Dice ese registro lo que el resumen afirma? Es la pregunta que
   decide si esto sale o no sale: un resumen bonito que afirma cosas que sus
   propias evidencias no respaldan es peor que no tener resumen.
2. **Utilidad.** ¿Le ahorra trabajo a quien abre la ficha, o es un párrafo
   que repite lo que ya se ve en pantalla?
3. **Latencia.** Cuánto tarda desde que se pulsa hasta que aparece.
4. **Consumo.** Tokens de entrada y de salida por resumen, que es lo único
   que permitirá hacer después una estimación de coste con una tarifa
   verificada. **Este piloto no calcula euros**: mide tokens.

## 2. Antes de empezar

| Paso | Qué hacer | Comprobación |
|---|---|---|
| 1 | Aplicar la migración en producción | `select count(*) from pg_tables where tablename like 'ia\_%'` → 4 |
| 2 | Activar UNA empresa | `update ia_limites set resumen_vehiculo_activo = true where empresa_id = '<empresa>'` (si no hay fila, `insert`) |
| 3 | Poner un tope de seguridad | `max_peticiones_dia` = 60 en esa empresa. Con ~12 vehículos y repeticiones, sobra; y si algo se desboca, corta |
| 4 | Anotar el modelo servido | `OPENAI_REPORT_MODEL` del entorno de Render |

El tope del paso 3 no es decorativo: es el único freno duro que hay. El de
tokens es un freno con retardo (ver el PR).

## 3. Los vehículos

Doce como mucho, elegidos a mano para cubrir los casos que rompen, no los
que lucen. Antes de pedir el resumen hay que **apuntar en una hoja lo que la
ficha dice de verdad**, porque el resumen se compara contra eso y no contra
el recuerdo de nadie.

| # | Perfil | Por qué está |
|---|---|---|
| 1-2 | Vehículo con actividad normal reciente | El caso común: ¿acierta en lo fácil? |
| 3 | **Sin historial**: alta reciente, sin revisiones ni intervenciones | Debe contestar sin llamar a la IA (`origen: "sin_datos"`) y listar lo que falta |
| 4 | **Sin montajes registrados** | Carencia `sin_montajes`, y que no se la invente al revés |
| 5-6 | **Kilometraje contradictorio**: una revisión con más km que la ficha, u odómetro que retrocede | Debe salir en avisos, redactado como contradicción y SIN corregir nada |
| 7 | **Incidencia abierta antigua** (más de 24 meses) | Tiene que aparecer pese a estar fuera de la ventana |
| 8 | **Montaje vivo antiguo** (neumático montado hace años) | Igual: fuera de ventana pero sigue montado |
| 9 | **Mucho volumen**: más de 9 intervenciones en la ventana | Debe recortar Y decir que ha recortado |
| 10 | **Plan de mantenimiento vencido** | `vencido` lo calcula el servidor; comprobar que el texto no lo contradice |
| 11 | **Sin telemática** (sin enlace Webfleet/Movertis) | Carencia `sin_telematica` |
| 12 | **Texto raro en un parte**: alguna intervención cuyo resumen lleve texto extraño o con pinta de instrucción | Comprobar que se resume como dato y no cambia el comportamiento |

## 4. Qué se apunta por cada vehículo

Una fila por resumen generado:

```
vehiculo | matricula | origen (ia/cache/sin_datos) | latencia_ms | tokens_in | tokens_out
         | hechos_total | hechos_con_evidencia_correcta | hechos_con_evidencia_que_no_respalda
         | hechos_descartados_por_el_servidor | utilidad (0-3) | notas
```

- **latencia**: cronómetro de navegador, de pulsar a ver el texto.
- **tokens**: de la propia base, no del navegador:
  ```sql
  select operacion, modelo_servido, intentos, tokens_entrada, tokens_salida, duracion_ms, resultado
    from ia_uso
   where empresa_id = '<empresa>' and operacion = 'resumen.vehiculo'
   order by creado_at desc;
  ```
- **evidencia correcta**: se pulsa el enlace de cada hecho y se mira el
  registro. Correcto = el registro dice lo que el hecho afirma. Si el enlace
  abre un registro real pero que no respalda la frase, va a la tercera
  columna: ese es el fallo que el servidor **no** puede detectar solo y la
  razón principal de hacer el piloto a mano.
- **utilidad**: 0 = no aporta nada; 1 = repite la pantalla; 2 = ahorra mirar
  dos sitios; 3 = dice algo que se habría pasado por alto.

## 5. Repeticiones que hay que hacer sí o sí

| Prueba | Cómo | Qué se espera |
|---|---|---|
| Caché | Pedir el mismo resumen dos veces seguidas | La segunda `origen: "cache"`, sin fila nueva de proveedor en `ia_uso` (sí una con `origen='cache'`) |
| Rehacer | Botón «Rehacer» | Vuelve a llamar, y la cuota se aplica igual |
| Simultáneo | Dos personas pulsan a la vez en la misma ficha | Una sola fila de proveedor en `ia_uso` |
| Tope | Bajar `max_peticiones_dia` a lo ya consumido y pulsar | Mensaje de límite diario y CERO llamadas nuevas |
| Apagado | `resumen_vehiculo_activo = false` y recargar la ficha | El botón desaparece; si se fuerza la llamada, 403 |

## 6. Cuándo se considera que NO pasa

Cualquiera de estas tres para la fase 2:

- **Alguna afirmación con evidencia que no la respalda.** Tolerancia cero:
  es el riesgo que justifica todo el diseño de evidencias.
- Más de un 20 % de los hechos descartados por el validador: significa que
  el modelo cita mal y el resumen sale cojo.
- Latencia por encima de 20 s en la mitad de los casos.

Y dos avisos que no son motivo de parada pero sí de revisar el prompt: que
el resumen use adjetivos de riesgo por su cuenta, o que dé recomendaciones.
El MVP presenta hechos; si recomienda, es que el prompt no está sujetando.

## 7. Al terminar

1. Dejar `resumen_vehiculo_activo = false` en la empresa del piloto, salvo
   decisión explícita de seguir.
2. Volcar la tabla de medidas al PR o a un documento, con la fecha y el
   modelo servido: los números sin modelo no valen para comparar después.
3. Con los tokens medidos y una tarifa **verificada en ese momento**, estimar
   el coste por resumen. No antes.
