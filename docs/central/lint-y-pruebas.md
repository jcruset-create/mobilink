# Herramientas: ESLint y pruebas contra PostgreSQL

Dos cosas que el repositorio daba por supuestas y no lo estaban.

## ESLint: estaba configurado pero no instalado

`eslint.config.js` existía y el código tiene `eslint-disable` puestos a mano, así que en algún
momento se usó. Pero **ninguna de sus dependencias estaba en `package.json`**, de modo que
`npx eslint` moría con `Cannot find package '@eslint/js'`. Ya está arreglado: las seis dependencias
son `devDependencies` y hay un script.

```bash
npm run lint
```

### El estado real: 1.889 avisos heredados

Ejecutarlo por primera vez deja un número incómodo, y conviene mirarlo antes de decidir nada:

| Regla | Cuántos |
|---|---|
| `@typescript-eslint/no-explicit-any` | 1.428 |
| `react-hooks/set-state-in-effect` | 164 |
| `@typescript-eslint/no-unused-vars` | 87 |
| `react-hooks/exhaustive-deps` | 63 |
| `react-refresh/only-export-components` | 31 |
| Resto | ~116 |

Por carpeta: `src` 1.027 · `server` 855 · `supabase` 5 · `scripts` 2.

**No se ha tocado ni una regla para bajar ese número**, y es deliberado: apagar
`no-explicit-any` dejaría el lint en verde sin haber arreglado nada, y el verde falso es peor que el
rojo honesto, porque el rojo al menos se ve.

Tres cuartas partes son un solo patrón, `any` en el mapeo de filas de la base de datos, que es
justamente donde el proyecto ya pone `eslint-disable` cuando se acuerda. Ordenarlo es un trabajo
propio, no el peaje de una fase de MC Central.

**Lo que sí se comprobó:** los once ficheros que toca la fase 1 no añaden **ni un solo aviso nuevo**.
Los ocho que salen en ellos están idénticos en `origin/main`, con otro número de línea.

## Las pruebas contra PostgreSQL sí se pueden ejecutar

`RUN_DB_TESTS=1` aparece en catorce ficheros de pruebas, y son las que de verdad comprueban el
dinero: concurrencia sobre la última pieza, arqueo, cierre, ingresos bancarios.

El servidor **está instalado** en el entorno de trabajo, pero el clúster arranca parado y los
binarios no están en el `PATH` —`which postgres` no encuentra nada—, que es lo que lleva a concluir
que no hay base de datos. Sí la hay:

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE ROLE mobilink LOGIN PASSWORD 'mobilink' SUPERUSER\""
su postgres -c "createdb -O mobilink mobilink_test"

RUN_DB_TESTS=1 \
DATABASE_URL="postgres://mobilink:mobilink@127.0.0.1:5432/mobilink_test" \
SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY=test SUPABASE_ANON_KEY=test \
npm test
```

Las tres variables de Supabase no se usan para nada real: tres ficheros de `server/connect/`
importan `server/supabase.ts`, que **revienta al importarse** si faltan (`server/supabase.ts:10`), y
sin ellas esos tres ficheros fallan enteros aunque sus pruebas queden omitidas. `SUPABASE_URL` tiene
que tener forma de URL: con un valor cualquiera, el cliente falla al construirse.

Conviene ejecutarlas **en dos bases distintas**, porque no comprueban lo mismo:

- **Recién creada**, sin la fundación SaaS: es como arranca una instalación nueva.
- **Migrada**, con `app_empresas`, `app_centros` y las claves ajenas puestas: es producción.

En la fase 1 esa distinción cazó una prueba que pasaba solo en la primera, porque usaba
identificadores de taller inventados que la base sin clave ajena aceptaba de mil amores.
