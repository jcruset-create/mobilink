-- ============================================================================
-- Mobilink TyreControl — Marcas de neumático que no son marcas
--
-- EL SÍNTOMA
--
-- El informe mensual cuenta como marcas distintas cosas que no lo son:
-- `Hankau04+`, `AH51`, `OMIROYAL`, `H`. Son 47 neumáticos repartidos entre
-- diez marcas fantasma, y cada uno le resta a la marca de verdad:
--
--     Hankau04+ 18 · AH51 6 · Hankra30 6 · Michagilcc113/111r 4
--     Michagils3 4 · Hankoah35 2 · OMIROYAL 2 · X-MULTI Z 2 · H 2 · AH31 1
--
-- (Más `R.CORDOBA`, 3, que este script NO toca. Ver abajo.)
--
-- `tc_neumaticos.marca` es TEXTO LIBRE sin clave ajena al catálogo —la única
-- que apunta ahí es `tc_cat_modelos_neumatico.marca_id`—, así que nada impide
-- escribir lo que sea.
--
-- DOS CAUSAS DISTINTAS, Y SE VEN POR LA FECHA
--
-- · 10-11/08/2026, alta masiva, `origen` vacío. El MODELO acabó en la casilla
--   de la marca: `AH51`, `AH31`, `X-MULTI Z`. Más dos dedazos: `OMIROYAL` por
--   Uniroyal y `H` por Hankook.
--
-- · 03/11/2026, `origen = importacion_excel`. La marca y el modelo venían
--   PEGADOS en el albarán —«HANKAU04+»— y el importador se tragaba el token
--   entero como marca. Ese fallo está arreglado en
--   `src/modules/tyrecontrol/services/importHistorico.ts` (función
--   `partirMarca`), así que esto no vuelve en la próxima importación.
--   Sin ese arreglo, este script habría que pasarlo todos los meses.
--
-- DE DÓNDE SALE CADA EQUIVALENCIA
--
-- No de adivinar: del propio informe del centro técnico, que lleva la columna
-- MODELO debajo de cada marca y dice, con volumen,
--
--     HANKOOK → AH31 (1.490 veces) · AH51 (34) · AH35 (68) · AU04 (76)
--     UNIROYAL → FH40 (583)
--     MICHELIN → X-MULTI · Z
--
-- Y para los dos modelos que no salen en ese informe, de la ficha del
-- fabricante, que además cuadra con el índice de carga que quedó en el campo
-- `modelo`:
--
--     Hankook SmartCity AU04+  275/70R22.5  152/149J  ← el campo dice 152J149
--     Hankook Vantra ST AS2 RA30  205/75R16C  110/108R ← el campo dice 110R108
--     Michelin Agilis CrossClimate 205/75R16C 113/111R
--     Michelin Agilis 3  215/75R16C  116/114R
--
-- QUÉ HACE
--
-- Arregla `marca`, y además recupera el MODELO allí donde lo que hay en esa
-- casilla es el índice de carga. `indice_carga` e `indice_velocidad` están
-- vacíos en las 47 filas, así que no se pisa ningún dato.
--
-- LO QUE NO TOCA
--
-- `R.CORDOBA` (3 neumáticos, modelo «CASCO MICHELIN»). Es un recauchutado
-- hecho sobre un casco Michelin, y R. Córdoba será el recauchutador. No lo
-- paso a Michelin: la goma la terminó otro, igual que un Insa es un Insa y no
-- el casco que lleve debajo. Y no lo doy de alta como marca porque no he
-- podido confirmar que esa empresa exista con ese nombre. Lo mira el taller.
--
-- Idempotente: a la segunda pasada no encuentra ninguna fila.
-- ============================================================================

-- ── ANTES: pegar esto y guardar lo que salga ────────────────────────────────
--
--   select marca, coalesce(modelo,'·') modelo, count(*) n
--     from tc_neumaticos
--    where marca in ('Hankau04+','Hankra30','Hankoah35','AH51','AH31','H',
--                    'Michagilcc113/111r','Michagils3','X-MULTI Z','OMIROYAL')
--    group by 1,2 order by 3 desc;
--   -- esperado: 47 neumáticos en total

begin;

-- ── 1 · El modelo que acabó en la casilla de la marca ──────────────────────
update tc_neumaticos set marca = 'Hankook', modelo = coalesce(modelo, 'AH31'), updated_at = now()
 where marca = 'AH31';

update tc_neumaticos set marca = 'Hankook', modelo = coalesce(modelo, 'AH51'), updated_at = now()
 where marca = 'AH51';

update tc_neumaticos set marca = 'Michelin', modelo = coalesce(modelo, 'X-MULTI Z'), updated_at = now()
 where marca = 'X-MULTI Z';

-- ── 2 · Los dos dedazos ────────────────────────────────────────────────────
-- `H` lleva ya el modelo bien puesto (AH51); solo le falta la marca entera.
update tc_neumaticos set marca = 'Hankook', updated_at = now()
 where marca = 'H' and modelo = 'AH51';

-- OMIROYAL por UNIROYAL, y lo confirma el modelo: FH40 es un Uniroyal.
update tc_neumaticos set marca = 'Uniroyal', updated_at = now()
 where marca = 'OMIROYAL' and modelo = 'FH40';

-- ── 3 · Marca y modelo pegados en el albarán ───────────────────────────────
-- Aquí el campo `modelo` tiene el índice de carga, no el modelo. Se pone el
-- modelo de verdad y el índice pasa a su columna, que estaba vacía.
update tc_neumaticos
   set marca = 'Hankook', modelo = 'SmartCity AU04+',
       indice_carga = coalesce(indice_carga, '152/149'),
       indice_velocidad = coalesce(indice_velocidad, 'J'),
       updated_at = now()
 where marca = 'Hankau04+';

update tc_neumaticos
   set marca = 'Hankook', modelo = 'AH35',
       indice_carga = coalesce(indice_carga, '140/138'),
       indice_velocidad = coalesce(indice_velocidad, 'M'),
       updated_at = now()
 where marca = 'Hankoah35';

update tc_neumaticos
   set marca = 'Hankook', modelo = 'Vantra ST AS2 RA30',
       indice_carga = coalesce(indice_carga, '110/108'),
       indice_velocidad = coalesce(indice_velocidad, 'R'),
       updated_at = now()
 where marca = 'Hankra30';

update tc_neumaticos
   set marca = 'Michelin', modelo = 'Agilis CrossClimate',
       indice_carga = coalesce(indice_carga, '113/111'),
       indice_velocidad = coalesce(indice_velocidad, 'R'),
       updated_at = now()
 where marca = 'Michagilcc113/111r';

-- Agilis 3 viene en dos medidas con índices distintos, así que van aparte.
update tc_neumaticos
   set marca = 'Michelin', modelo = 'Agilis 3',
       indice_carga = coalesce(indice_carga, '113/111'),
       indice_velocidad = coalesce(indice_velocidad, 'R'),
       updated_at = now()
 where marca = 'Michagils3' and modelo = '113/111R';

update tc_neumaticos
   set marca = 'Michelin', modelo = 'Agilis 3',
       indice_carga = coalesce(indice_carga, '116/114'),
       indice_velocidad = coalesce(indice_velocidad, 'R'),
       updated_at = now()
 where marca = 'Michagils3' and modelo = '116/114R';

commit;

-- ── DESPUÉS: las cuatro comprobaciones ──────────────────────────────────────
--
--   -- 1 · No queda ninguna de las diez marcas fantasma
--   select count(*) from tc_neumaticos
--    where marca in ('Hankau04+','Hankra30','Hankoah35','AH51','AH31','H',
--                    'Michagilcc113/111r','Michagils3','X-MULTI Z','OMIROYAL');
--   -- esperado: 0
--
--   -- 2 · Han ido a parar donde debían
--   select marca, count(*) from tc_neumaticos
--    where marca in ('Hankook','Michelin','Uniroyal') group by 1 order by 2 desc;
--   -- esperado: Hankook +35, Michelin +10, Uniroyal +2
--
--   -- 3 · El total de neumáticos no se ha movido: esto renombra, no borra
--   select count(*) from tc_neumaticos;
--
--   -- 4 · Lo único que debería quedar fuera del catálogo es R.CORDOBA
--   select n.marca, count(*) from tc_neumaticos n
--    where n.marca is not null and btrim(n.marca) <> ''
--      and not exists (select 1 from tc_cat_marcas_neumatico c
--                       where upper(btrim(c.nombre)) = upper(btrim(n.marca)))
--    group by 1;
--   -- esperado: solo R.CORDOBA (3)
-- ============================================================================
