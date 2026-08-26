#!/usr/bin/env bash
# Compara la versión de cada app (pubspec.yaml + package.json) entre la rama
# actual y origin/main. Pensado para trabajar con varias sesiones sobre el
# mismo disco virtual: se ejecuta ANTES de commitear o subir.
#
#   OK       -> misma versión que main (esta rama no la ha tocado)
#   SUBIDA   -> esta rama sube la versión (lo normal al entregar)
#   CONFLICTO-> main ha subido la versión por su cuenta: hay que integrar main
#               y volver a subir la versión por encima de la suya
#
# Uso: bash scripts/check-versions.sh
set -uo pipefail

git fetch -q origin main || { echo "No se pudo hacer fetch de origin/main"; exit 1; }

ver() { grep -m1 -E '^[[:space:]]*"?version"?:' | tr -d ' ",' | sed 's/^version://'; }

# Devuelve 0 si $1 es mayor que $2 comparando 1.8.1+29 como 1 8 1 29
mayor() {
  local a="${1//+/.}" b="${2//+/.}"
  [ "$a" = "$b" ] && return 1
  [ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -1)" = "$a" ]
}

estado=0
for f in $(git ls-files | grep -E 'pubspec\.yaml$|^package\.json$'); do
  mia=$(ver < "$f")
  suya=$(git show origin/main:"$f" 2>/dev/null | ver)
  if [ -z "$suya" ]; then
    etiqueta="NUEVO"
  elif [ "$mia" = "$suya" ]; then
    etiqueta="OK"
  elif mayor "$mia" "$suya"; then
    etiqueta="SUBIDA"
  else
    etiqueta="CONFLICTO"
    estado=1
  fi
  printf '%-40s rama=%-16s main=%-16s %s\n' "$f" "$mia" "$suya" "$etiqueta"
done

if [ "$estado" -ne 0 ]; then
  echo
  echo "Hay versiones por debajo de main: integra main (git merge origin/main)"
  echo "y sube la versión por encima de la suya antes de commitear."
fi
exit "$estado"
