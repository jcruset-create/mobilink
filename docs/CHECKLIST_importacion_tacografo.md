# Importar el informe de tacógrafo de Plana · resultados y checklist

Documento para **antes** de la importación real. La primera parte son los
resultados de las pruebas; la segunda, los pasos de producción con sus
comprobaciones y su marcha atrás.

Medido el **5 de noviembre de 2026** contra producción
(`qhbtpebfkckzmtdcutvv`) y el fichero `REVISIONES TACOGRAFO PLANA.xlsx`
(3.333.413 bytes). Plana es `a51c9662-4b6f-4681-8e2b-599e109659eb`.

> **Los números de la simulación se mueven, y es normal.** Dependen de lo que
> haya en TyreControl en ese momento: dar de alta un vehículo o ponerle la
> medida a mano cambia el reparto. Entre la auditoría del 4 de noviembre y
> esta medición, las discrepancias pasaron de 19 a 20 y los vehículos de Plana
> de 723 a 807. **Lo que vale es la simulación del día**, no esta tabla: por
> eso el primer paso del checklist es volver a simular.

---

## 1 · Resultados de las pruebas

### 1.1 · Las pruebas automáticas

| Fichero | Pruebas | Qué fija |
|---|---:|---|
| `medidas.test.ts` | 59 | Las 48 representaciones del fichero → 20 medidas. Una prueba por representación |
| `parser.test.ts` | 26 | Cabecera buscada por contenido, columnas por nombre, una columna intrusa no descoloca nada |
| `vencimiento.test.ts` | 18 | 24 meses, aviso a 60 días, qué reinicia el plazo y qué no |
| `simular.test.ts` | 31 | Qué pasaría: enlaces, duplicados, propuestas, km que bajan |
| `importar.test.ts` | 22 | Qué se graba, qué se salta y qué se bloquea, con su motivo |
| `deshacer.test.ts` | 12 | Cuándo un lote se puede revertir y cuándo no |
| `control.test.ts` | 25 | El cálculo de la pantalla y de la ficha, **y que son el mismo** |
| `propuestas.test.ts` | 29 | Qué se puede aceptar, con qué medida y qué no entra en bloque |
| `lotes.integration.test.ts` | 9 | Contra PostgreSQL: idempotencia y deshacer de verdad |
| `propuestas.integration.test.ts` | 18 | Contra PostgreSQL: índice único parcial, compara-y-cambia, triggers |
| **Suite completa del repositorio** | **7.066** | 38 omitidas, 0 fallos |

`npx tsc -b`, `npx tsc -p tsconfig.server.json --noEmit`, `npx vite build` y
`bash scripts/check-versions.sh`: limpios.

### 1.2 · Lectura del fichero real

| | |
|---|---:|
| Filas leídas | **1.744** |
| Problemas de lectura | **0** |
| Columnas aprovechadas | **52 de 52** |
| `id_origen` únicos | 1.744 |
| Matrículas distintas | 723 |
| Tiempo de la simulación | 16 ms |

### 1.3 · Simulación contra producción (5/11/2026)

Vehículos de Plana en TyreControl: **807**. Intervenciones ya importadas: **0**.

| | |
|---|---:|
| Se insertarían | **1.694** |
| Duplicadas (ya estaban) | 0 |
| Filas sin vehículo (se guardan sin vincular) | **50** |
| Vehículos alcanzados | **684** · de ellos **83 dados de baja** |
| Matrículas sin vehículo en TyreControl | **39** |
| Conflictos de bastidor | **0** |
| Lecturas de cuentakilómetros que bajan | **8** |

Vencimientos que quedarían, con la regla de 24 meses:

| Vigente | Vence pronto | Vencido | Sin datos |
|---:|---:|---:|---:|
| 557 | 43 | **123** | 0 |

Nombres de cliente del fichero, que se conservan fila a fila:

| Filas | Cliente |
|---:|---|
| 1.624 | TERESA Y JOSE PLANA EMPRESA PLANA S.L. |
| 108 | CINTOI BUS S.L |
| 8 | AUTOCARES MEG-BUS S.L. |
| 4 | AUTOCARES MEG BUS S.L. |

Todas se importan bajo **Plana**, como se acordó, conservando el nombre
original de cada fila.

### 1.4 · Propuestas de medida que quedarían

| Caso | Nº | Cómo se resuelve |
|---|---:|---|
| **Falta la medida** | **43** | Individual **y en bloque** |
| **No coinciden** | **20** | **Solo individual** |
| Solo el marcado (la C) | 35 | Individual. Aceptar no cambia el dato, solo cierra el aviso |
| Sin vehículo | 39 | No se pueden aceptar hasta enlazar la matrícula |
| **Total** | **137** | De ellas **43 entran en el «aceptar todo»** |

Las 20 discrepancias reales, para mirarlas una a una:

| Matrícula | Dice el tacógrafo | Tiene TyreControl | Fecha |
|---|---|---|---|
| 1188HNM | 305/70R19.5 | 295/80R22.5 | 16/04/2026 |
| 0578JGV | 305/70R19.5 | 305/70R22.5 | 19/12/2024 |
| 0174KLT | 315/80R22.5 | 295/80R22.5 | 30/01/2025 |
| 2966JMJ | 265/70R19.5 | 295/80R22.5 | 19/02/2026 |
| 9359HKG | 275/70R22.5 | 295/80R22.5 | 17/04/2026 |
| 6152HKW | 295/80R22.5 | 315/80R22.7 | 08/09/2025 |
| 3820JNX | 295/80R22.5 | 315/80R22.5 | 26/06/2025 |
| 2907HFR | 295/80R22.5 | 315/80R22.5 | 12/07/2025 |
| 0072JFY | 295/80R22.5 | 315/80R22.5 | 01/09/2025 |
| 3817KMZ | 295/80R22.5 | 315/80R22.5 | 18/12/2025 |
| 3428KMZ | 295/80R22.5 | 315/80R22.5 | 09/02/2026 |
| 3430KMZ | 295/80R22.5 | 315/80R22.5 | 21/03/2026 |
| 3823KMZ | 295/80R22.5 | 315/80R22.5 | 14/05/2026 |
| 4322JYJ | 295/80R22.5 | 315/80R22.5 | 14/05/2026 |
| 3429KMZ | 295/80R22.5 | 315/80R22.5 | 18/05/2026 |
| 0152JFY | 295/80R22.5 | 315/80R22.5 | 25/05/2026 |
| 3833KMZ | 295/80R22.5 | 315/80R22.5 | 27/08/2026 |
| 3417MSK | 315/80R22.5 | 295/80R22.5 | 09/06/2026 |
| 5331KLN | 275/70R22.5 | 315/80R22.5 | 17/06/2026 |
| 5324KLN | 275/70R22.5 | 295/80R22.5 | 15/07/2026 |

Dos cosas que salen a la vista y conviene decidir antes de aceptar nada:

- **`6152HKW` tiene en TyreControl `315/80R22.7`**, que no es una medida de
  llanta que exista: 22.7 no es un diámetro normalizado. Es casi seguro un
  error de teclado por `315/80R22.5`. No lo arregla esta importación, pero
  está ahí.
- **Nueve de las veinte** son el mismo par (`295/80R22.5` contra
  `315/80R22.5`), y siete de ellas son matrículas consecutivas de la serie
  `KMZ`. Huele a un lote de autobuses dados de alta con la medida de otro
  modelo, no a veinte errores independientes. Si es eso, se arregla mejor
  mirando el lote entero que aceptando propuestas una a una.

---

## 2 · Antes de importar

- [ ] **Aplicar la migración pendiente**
      `supabase/migrations/tyrecontrol_tacografo_propuestas.sql`
      (117 líneas, `md5 17e18a0b2c119fb3e0bfc374953a5c4f`).
      Las otras dos ya están aplicadas:
      `tyrecontrol_tacografo.sql` (`8df1a5bf6ace34c054900d795d79d674`) y
      `tyrecontrol_tacografo_lotes.sql` (`3972025641e11e32d4cbeb654e457fd4`).

      Comprobar el MD5 antes de pegarla:
      ```bash
      md5sum supabase/migrations/tyrecontrol_tacografo_propuestas.sql
      ```
      Va envuelta en `begin … commit`: entra entera o no entra. Al final del
      fichero están las comprobaciones de después, listas para pegar.

- [ ] **Dar de alta la regla de Plana** en `tc_tacografo_regla`. Sin fila se
      usa el valor por defecto del código, que es el mismo, pero conviene que
      esté escrito y sea editable sin tocar código:
      ```sql
      insert into tc_tacografo_regla (empresa_id, meses, aviso_dias)
      values ('a51c9662-4b6f-4681-8e2b-599e109659eb', 24, 60)
      on conflict (empresa_id) do nothing;
      ```

- [ ] **Dejar constancia del punto de partida.** Son los números con los que
      se compara después, y sin ellos no hay forma de decir si algo se movió:
      ```sql
      select
        (select count(*) from tc_tacografo_intervenciones)                     as intervenciones,
        (select count(*) from tc_tacografo_lotes)                              as lotes,
        (select count(*) from tc_tacografo_medida_propuesta)                    as propuestas,
        (select count(*) from tc_vehiculos where empresa_id='a51c9662-4b6f-4681-8e2b-599e109659eb') as vehiculos,
        (select count(*) from tc_vehiculos
          where empresa_id='a51c9662-4b6f-4681-8e2b-599e109659eb' and medida_id is not null)        as con_medida,
        (select coalesce(sum(km_actual),0) from tc_vehiculos
          where empresa_id='a51c9662-4b6f-4681-8e2b-599e109659eb')             as suma_km,
        (select count(*) from tc_montajes_actuales)                            as montajes,
        (select count(*) from tc_neumaticos)                                   as neumaticos;
      ```
      Hoy: intervenciones **0**, lotes **0**, propuestas **0**.
      `suma_km`, `montajes` y `neumaticos` están ahí para comprobar después que
      **no se han movido**, no porque la importación los use. Guardar el número
      exacto de `suma_km`: es la forma de comprobar el kilometraje, porque
      `tc_vehiculos` no guarda cuándo se actualizó.

- [ ] **Simular de nuevo, con el fichero que se va a importar.** En
      «Importar → Tacógrafo», el botón de simular no escribe nada. Comparar
      con la tabla 1.3: si los números bailan mucho, entender por qué antes
      de seguir. Es normal que se muevan unos pocos; que se muevan cientos no
      lo es.

- [ ] **Confirmar la empresa elegida.** Todo entra bajo Plana, CINTOI y
      MEG-BUS incluidas. Si eso cambia, la importación es otra conversación.

---

## 3 · Importar

- [ ] **Una sola persona, una sola vez.** La clave única
      `(empresa_id, sistema_origen, id_origen)` impide duplicar aunque se
      importe dos veces, pero dos importaciones a la vez crean dos lotes y la
      lectura de «qué pasó» se vuelve confusa sin necesidad.

- [ ] **Apuntar el `loteId` que devuelve.** Es lo único que hace falta para
      deshacerlo.

- [ ] **Comprobar los números del lote** en «Importar → lotes»:
      ```sql
      select id, archivo_nombre, archivo_filas, filas_empresa, importadas,
             duplicadas, sin_vehiculo, bloqueadas, estado, created_at
        from tc_tacografo_lotes order by created_at desc limit 1;
      ```
      Esperado hoy: `importadas ≈ 1.694`, `bloqueadas 0`, `estado 'aplicado'`.

- [ ] **Mirar las bloqueadas, si hay alguna.** Cada una trae su número de fila
      y su motivo. Un recuento de «bloqueadas: 7» no sirve para arreglar nada;
      la lista sí:
      ```sql
      select fila_origen, matricula, motivo, valor
        from tc_tacografo_bloqueados where lote_id = '<loteId>'
        order by fila_origen;
      ```

---

## 4 · Después de importar: que nada ajeno se haya movido

Es la parte que no hay que saltarse. La promesa del encargo era que esto no
toca los montajes, los neumáticos, los ejes ni el kilometraje, y aquí se
comprueba en vez de darse por hecha.

- [ ] **Los recuentos de la tabla de arriba**, otra vez. `montajes` y
      `neumaticos` tienen que salir **exactamente iguales**.

- [ ] **Ni un kilometraje tocado.** El informe trae 1.546 lecturas fechadas,
      y ninguna debe haber entrado en `tc_vehiculos.km_actual`. La suma tiene
      que salir **idéntica** a la de antes, al kilómetro:
      ```sql
      select coalesce(sum(km_actual),0) as suma_km, count(km_actual) as con_km
        from tc_vehiculos where empresa_id='a51c9662-4b6f-4681-8e2b-599e109659eb';
      ```
      (Si entre una cosa y otra ha entrado telemática, la suma sube por su
      cuenta. En ese caso, comprobarlo sobre los 684 vehículos del informe
      comparando contra una copia previa de `id, km_actual`, que es lo único
      que distingue «lo movió la telemática» de «lo movió la importación».)

- [ ] **Las medidas de los vehículos, intactas.** La importación **no** escribe
      medidas: eso pasa solo al aceptar una propuesta, y eso es el paso 5.
      `con_medida` tiene que salir igual que antes.

- [ ] **Las 39 matrículas sin vehículo, guardadas y sin vincular**, que es lo
      acordado — y **ningún vehículo creado**:
      ```sql
      select count(*) from tc_tacografo_intervenciones where vehiculo_id is null;
      -- esperado: unas 50 filas, de 39 matrículas distintas
      ```

- [ ] **Las 8 lecturas que bajan, marcadas y no descartadas:**
      ```sql
      select count(*) from tc_tacografo_intervenciones where km_sospechoso;
      -- esperado: 8
      ```

- [ ] **Abrir dos o tres fichas** de vehículos del informe y ver la sección
      Tacógrafo: estado, última, próxima y el histórico. Y la pantalla
      «Control de tacógrafos», que tiene que decir los mismos 557 / 43 / 123.

### Si algo no cuadra: deshacer

El lote se revierte entero y **solo borra lo que ese lote escribió**:

```
POST /api/tyrecontrol/tacografo/lotes/<loteId>/deshacer?empresa=<plana>
```
Con `&comprobar=1` solo dice si se puede, sin borrar. **No se puede deshacer
si ya se ha aceptado alguna propuesta de medida de ese lote**: aceptar escribió
en `tc_vehiculos`, y borrar la intervención no desharía eso. En ese caso lo
dice con su motivo en vez de dejar el sistema a medias.

El lote no se borra: queda en `estado='deshecho'`. Que alguien importara 1.744
filas y las deshiciera media hora después es historia que explica cosas.

---

## 5 · Las propuestas de medida: otro día, y despacio

**No es parte de la importación.** Importar deja las propuestas *pendientes* y
no escribe ni una medida. Aceptarlas es una decisión aparte, y conviene
tomarla con la lista delante y sin prisa.

- [ ] **Antes de aceptar nada**, apuntar cuántos vehículos tienen medida:
      es el único número que el paso 5 puede mover.
      ```sql
      select count(*) from tc_vehiculos
       where empresa_id='a51c9662-4b6f-4681-8e2b-599e109659eb' and medida_id is not null;
      ```

- [ ] **Las 43 que faltan**, en bloque. El botón dice sobre cuántas actúa
      antes de pulsarlo. Después, ese recuento tiene que haber subido en
      exactamente las que diga «aceptadas».

- [ ] **Las 20 que no coinciden**, una a una — y antes, mirar lo del lote
      `KMZ` y el `315/80R22.7` del apartado 1.4. Puede que no sean veinte
      decisiones sino dos.

- [ ] **Las 35 de «solo el marcado»** pueden esperar: el vehículo ya tiene esa
      medida y el tacógrafo solo la escribe con la C. Aceptarlas no cambia el
      dato, solo quita el aviso.

- [ ] **Las 39 sin vehículo** no se pueden aceptar hasta que la matrícula esté
      enlazada. Hace falta la pantalla de enlazar, que no está hecha.

- [ ] **Si una propuesta dice «no está en el catálogo»**, darla de alta en
      «Medidas de neumáticos» y volver. La importación **no** añade medidas al
      catálogo a propósito: así es como se acaba con `295/80R22,5` con coma y
      `295/80 R22.5` con espacio conviviendo en la misma lista.

---

## 6 · Lo que esto no hace, dicho otra vez

No escribe en `tc_montajes_actuales`, `tc_neumaticos`, `tc_vehiculo_ejes`,
`config_ejes_id` ni `tc_vehiculos.km_actual`. No crea vehículos. No añade
medidas al catálogo. Lo único que escribe fuera de sus propias tablas es
`tc_vehiculos.medida_id`, y solo cuando una persona acepta una propuesta.
