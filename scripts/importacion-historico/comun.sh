# Compartido por los scripts de esta carpeta. Solo bases de pruebas con nombre explícito.
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-mobilink}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
comprobar_base() {
  case "$1" in banco_imp|banco_e2e|esquema_completo|esquema_completo_*) ;;
    *) echo "Base no permitida: '$1' (solo banco_imp, banco_e2e, esquema_completo*)"; exit 1;; esac
}
PSQL() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 "$@"; }
# Si hay una sesión conectada (PostgREST, un psql abierto), el drop falla. Sin
# este aviso, el script seguía adelante aplicando las migraciones ENCIMA de la
# base vieja y el recuento de «aplicadas» salía bajo sin que se supiera por qué.
recrear_base() {
  comprobar_base "$1"
  PSQL -d postgres -qc "drop database if exists $1" -c "create database $1" || {
    echo "No se ha podido recrear '$1'. Si hay sesiones conectadas (PostgREST, un psql abierto), ciérralas:" >&2
    PSQL -d postgres -At -c "select '  pid '||pid||' · '||coalesce(application_name,'?') from pg_stat_activity where datname='$1'" >&2 || true
    exit 1
  }
}
