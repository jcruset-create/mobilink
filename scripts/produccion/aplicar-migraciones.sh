#!/usr/bin/env bash
#
# Las tres migraciones del histórico, en orden y cada una EN SU TRANSACCIÓN.
#
#   DATABASE_URL='postgresql://…' bash scripts/produccion/aplicar-migraciones.sh
#
# Ninguna lleva `begin`/`commit` dentro y ninguna hace nada que impida una
# transacción (ni `concurrently`, ni `vacuum`), así que `psql -1` envuelve
# cada fichero entero: o entra del todo o no entra nada.
#
# Si una falla, el script PARA y sale con código de error. No sigue con la
# siguiente y no termina diciendo que todo ha ido bien.
#
# Entre una y otra comprueba que los datos protegidos no se han movido: una
# migración de esquema no debe cambiar ni una fila. Para eso hace falta una
# fotografía previa, la del preflight:
#
#   FOTO_ANTES=<dir>/fotografia-antes DATABASE_URL=… bash ...
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$AQUI/../.." && pwd)"
: "${DATABASE_URL:?Falta DATABASE_URL}"
FOTO_ANTES="${FOTO_ANTES:-}"
REGISTRO="${REGISTRO:-./migraciones-$(date +%Y%m%d-%H%M).log}"

MIGRACIONES=(
  tyrecontrol_importacion_historico
  tyrecontrol_importacion_historico_fase2
  tyrecontrol_importacion_historico_fase3
)

: > "$REGISTRO"
apunta() { printf '%s\n' "$1" | tee -a "$REGISTRO"; }

if [[ -n "$FOTO_ANTES" && ! -d "$FOTO_ANTES/filas" ]]; then
  echo "FOTO_ANTES='$FOTO_ANTES' no parece una fotografía (no tiene filas/)." >&2
  exit 1
fi
if [[ -z "$FOTO_ANTES" ]]; then
  echo "AVISO: sin FOTO_ANTES no se puede comprobar que las migraciones no mueven datos." >&2
  echo "       Pásala si tienes la del preflight; si sigues sin ella, es a ciegas." >&2
fi

apunta "Migraciones del histórico · $(date -Is)"
apunta "base: $(psql "$DATABASE_URL" -X -q -At -c 'select current_database()' 2>&1)"
apunta ""

for m in "${MIGRACIONES[@]}"; do
  f="$REPO/supabase/migrations/$m.sql"
  [[ -f "$f" ]] || { apunta "FALTA el fichero $f"; exit 1; }
  apunta "── $m"
  inicio=$(date +%s)
  if ! psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -1 -f "$f" >>"$REGISTRO" 2>&1; then
    apunta "FALLA: $m no se ha aplicado. La transacción se ha deshecho entera."
    apunta "Las siguientes NO se aplican. Mira $REGISTRO."
    exit 1
  fi
  apunta "   aplicada en $(( $(date +%s) - inicio ))s"

  # Después de cada una: los datos protegidos no se han movido.
  if [[ -n "$FOTO_ANTES" ]]; then
    tmp=$(mktemp -d)
    if ! DATABASE_URL="$DATABASE_URL" bash "$AQUI/preflight-produccion.sh" \
         --fotografia "$tmp" "$FOTO_ANTES" >/dev/null 2>>"$REGISTRO"; then
      apunta "FALLA: no se ha podido tomar la fotografía después de $m."
      rm -rf "$tmp"; exit 1
    fi
    cambios=$(bash "$AQUI/preflight-produccion.sh" --comparar "$FOTO_ANTES" "$tmp" 2>&1)
    echo "$cambios" >> "$REGISTRO"
    if grep -qE "filas (nuevas|cambiadas|DESAPARECIDAS)" <<<"$cambios"; then
      apunta "FALLA: $m ha movido datos. Una migración de esquema no debe cambiar ninguna fila."
      grep -E "^[a-z_]+ |filas (nuevas|cambiadas|DESAPARECIDAS)" <<<"$cambios" | head -20 | sed 's/^/      /' | tee -a "$REGISTRO"
      apunta "Las siguientes NO se aplican. La vuelta atrás está en el preflight."
      rm -rf "$tmp"; exit 1
    fi
    apunta "   datos protegidos: sin cambios"
    rm -rf "$tmp"
  fi
done

apunta ""
apunta "Las tres migraciones aplicadas. Registro en $REGISTRO"
