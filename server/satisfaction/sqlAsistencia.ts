/**
 * Cómo se une una encuesta o un caso de calidad con su asistencia.
 *
 * Existe por un fallo que tumbaba el módulo entero. `assistanceId` es TEXT
 * —tiene que serlo: el mismo campo guarda ids de sistemas que no son Assist— y
 * `roadside_assistances.id` es un SERIAL, así que la unión pasaba por un
 * `::integer` a pelo:
 *
 *     LEFT JOIN roadside_assistances a ON a.id = i."assistanceId"::integer
 *
 * Basta UNA fila cuyo `assistanceId` no sea un número para que PostgreSQL
 * aborte la consulta con `invalid input syntax for type integer`. Y no falla
 * esa fila: falla la consulta, así que el worker de envíos deja de mandar
 * encuestas —todas, de todas las empresas— hasta que alguien mire el log.
 *
 * El `CASE` es la parte que importa. En una condición de JOIN, PostgreSQL no
 * garantiza que un `AND` se evalúe de izquierda a derecha, así que poner el
 * `~ '^[0-9]+$'` delante del cast NO basta: el planificador puede castear
 * primero. `CASE` sí garantiza el orden, y devuelve NULL —que en un LEFT JOIN
 * es «sin asistencia», exactamente lo que toca— en vez de reventar.
 *
 * Una definición y no nueve copias: eran nueve consultas con el mismo cast, y
 * arreglar la que falla dejando las otras ocho es dejar el fallo puesto.
 */

/**
 * Condición de unión con `roadside_assistances`, a prueba de ids que no son
 * números.
 *
 * @param alias  Alias de la tabla que tiene `assistanceId` (`i`, `q`, …).
 * @param soloAssist Si además hay que exigir `sourceSystem = 'assist'`. Solo lo
 *   piden las tablas que lo tienen; `quality_cases` se une sin esa condición,
 *   igual que antes.
 */
export function unirAsistencia(alias: string, soloAssist = false): string {
  const id = `${alias}."assistanceId"`;
  const condicion = soloAssist ? `${alias}."sourceSystem" = 'assist' AND ` : "";
  return `ON a.id = CASE WHEN ${condicion}${id} ~ '^[0-9]+$' THEN ${id}::integer END`;
}
