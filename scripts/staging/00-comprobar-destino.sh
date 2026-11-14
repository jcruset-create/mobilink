#!/usr/bin/env bash
#
# COMPROBACIÓN DE OPERACIONES. Antes de restaurar, de migrar, de sembrar y de
# arrancar Express. Obligatoria, y todas las veces.
#
# Exige DOS cosas, no una:
#   · el destino autorizado (DATABASE_URL y el proyecto Supabase), y
#   · la marca `mobilink.entorno = 'pruebas'` dentro de la base.
#
# La marca por sí sola no vale: una marca se puede poner en cualquier base, y
# por eso no sustituye a mirar a dónde apunta la conexión. Y el destino por sí
# solo tampoco: el proyecto de pruebas correcto puede tener una base que no es
# la que se preparó. La pone 00-inicializar-destino.sh, una sola vez, sobre
# una base nueva y vacía; este script nunca la pone.
#
# El arranque del servidor ejecuta DDL sobre `DATABASE_URL` (prepararEsquema,
# en server/index.ts): `npm start` con el `.env` equivocado delante MODIFICA
# la base antes de que nadie haya pedido ninguna migración, y para entonces ya
# da igual lo bien que se identifique el entorno después. Así que el destino
# se comprueba ANTES, y si no cuadra no se arranca.
#
#   DATABASE_URL=…  SUPABASE_URL=…  VITE_SUPABASE_URL=… \
#   REF_PRUEBAS=<subdominio del proyecto de pruebas> \
#   REF_PRODUCCION=<subdominio del de producción> \
#   bash scripts/staging/00-comprobar-destino.sh
#
# Las dos REF_* son identificadores de proyecto, no credenciales. Sale con
# código 1 en cuanto algo no cuadra: está hecho para ponerlo delante de
# cualquier cosa que escriba.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/destino-comun.sh"

: "${DATABASE_URL:?Falta DATABASE_URL: no se puede comprobar el destino}"
: "${REF_PRUEBAS:?Falta REF_PRUEBAS (subdominio del proyecto Supabase de pruebas)}"
: "${REF_PRODUCCION:?Falta REF_PRODUCCION (subdominio del de producción, para descartarlo)}"

echo "1. DATABASE_URL — a qué base se va a escribir"
if ! comprobar_destino_conexion; then
  echo
  echo "Destino no autorizado. NO restaures, NO migres, NO siembres y NO arranques." >&2
  echo "Ni siquiera se ha abierto conexión con esa base." >&2
  exit 1
fi

echo "2. La marca de la base — la segunda llave, no la única"
MARCA=$(leer_marca)
if [[ "$MARCA" == "pruebas" ]]; then
  ok "la base se declara entorno de pruebas"
else
  mal "la base NO está marcada como pruebas (dice '${MARCA:-nada}')"
  echo "        Si es un proyecto nuevo, la marca la pone la inicialización,"
  echo "        que antes comprueba que la base está vacía:"
  echo "          bash scripts/staging/00-inicializar-destino.sh"
  echo "        No la pongas a mano para que pase este control."
fi

echo "3. El proyecto Supabase al que va a hablar el servidor"
comprobar_proyecto_supabase si

echo "4. Lo que NO debería estar definido en un entorno de pruebas"
comprobar_credenciales_externas

echo
if [[ "$FALLOS" -gt 0 ]]; then
  echo "$FALLOS comprobación(es) sin pasar. NO restaures, NO migres, NO siembres y NO arranques el servidor." >&2
  exit 1
fi
echo "Destino comprobado. Se puede restaurar, migrar, sembrar o arrancar contra esta base."
