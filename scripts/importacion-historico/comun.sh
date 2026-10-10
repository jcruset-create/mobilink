# Compartido por los scripts de esta carpeta. Solo bases de pruebas con nombre explícito.
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-mobilink}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
comprobar_base() {
  case "$1" in banco_imp|banco_e2e|esquema_completo|esquema_completo_*) ;;
    *) echo "Base no permitida: '$1' (solo banco_imp, banco_e2e, esquema_completo*)"; exit 1;; esac
}
PSQL() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 "$@"; }
recrear_base() { comprobar_base "$1"; PSQL -d postgres -qc "drop database if exists $1" -c "create database $1"; }
