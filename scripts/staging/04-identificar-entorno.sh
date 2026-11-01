#!/usr/bin/env bash
#
# ¿Son de pruebas el panel, el servidor y la base? Lo único que distingue un
# entorno de otro es A DÓNDE APUNTA cada pieza, así que es lo que se mira.
#
#   PANEL_URL=https://…  SERVIDOR_URL=https://…  DESTINO_URL=postgresql://… \
#   REF_PRUEBAS=<subdominio del proyecto Supabase de pruebas> \
#   REF_PRODUCCION=<subdominio del proyecto de producción> \
#   bash scripts/staging/04-identificar-entorno.sh
#
# Las dos REF_* son identificadores de proyecto, no credenciales.
#
# NO sirven como identificación, y por eso no están aquí solas:
#   · `current_database()`: dos bases pueden llamarse igual en servidores
#     distintos, y la de pruebas se llamará «postgres» como la otra.
#   · el número de tablas: con el esquema real volcado, es el MISMO.
#   · que la URL del sitio sea la de pruebas: el panel lleva el proyecto
#     Supabase compilado DENTRO del bundle, así que un sitio de pruebas puede
#     estar hablando con producción.
set -euo pipefail

: "${REF_PRUEBAS:?Falta REF_PRUEBAS (subdominio del proyecto Supabase de pruebas)}"
: "${REF_PRODUCCION:?Falta REF_PRODUCCION (subdominio del proyecto de producción, para descartarlo)}"
FALLOS=0
ok()   { printf '  OK    %s\n' "$1"; }
mal()  { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }

echo "1. PANEL — ¿con qué proyecto Supabase habla el bundle que sirve?"
if [[ -n "${PANEL_URL:-}" ]]; then
  HTML=$(curl -fsS "$PANEL_URL" || true)
  # El bundle es el .js que cuelga del index. VITE_SUPABASE_URL va dentro.
  BUNDLES=$(printf '%s' "$HTML" | grep -oE 'src="[^"]+\.js"' | sed 's/src="//;s/"//' | head -5)
  if [[ -z "$BUNDLES" ]]; then
    mal "no encuentro el bundle en $PANEL_URL: compruébalo a mano en el navegador"
  else
    ENCONTRADO=no; PROD=no
    for b in $BUNDLES; do
      JS=$(curl -fsS "${PANEL_URL%/}/${b#/}" || true)
      printf '%s' "$JS" | grep -q "$REF_PRUEBAS"    && ENCONTRADO=si
      printf '%s' "$JS" | grep -q "$REF_PRODUCCION" && PROD=si
    done
    [[ "$PROD" == "si" ]] && mal "el bundle del panel lleva DENTRO el proyecto de PRODUCCIÓN"
    [[ "$ENCONTRADO" == "si" ]] && ok "el bundle lleva el proyecto de pruebas" \
      || mal "el bundle NO lleva el proyecto de pruebas: ¿se compiló con las variables buenas?"
  fi
else
  mal "sin PANEL_URL no se puede comprobar el panel"
fi

echo
echo "2. SERVIDOR — ¿qué commit está desplegado y en qué host?"
if [[ -n "${SERVIDOR_URL:-}" ]]; then
  SALUD=$(curl -fsS "${SERVIDOR_URL%/}/api/health" || true)
  if [[ -z "$SALUD" ]]; then
    mal "/api/health no responde en $SERVIDOR_URL"
  else
    echo "    $SALUD"
    COMMIT=$(printf '%s' "$SALUD" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit") or "")' 2>/dev/null || true)
    [[ -n "$COMMIT" ]] && ok "commit desplegado: $COMMIT (compáralo con el que quieres probar)" \
      || mal "/api/health no dice el commit: ¿falta RENDER_GIT_COMMIT?"
    if [[ -n "${COMMIT_ESPERADO:-}" ]]; then
      [[ "$COMMIT" == "${COMMIT_ESPERADO:0:8}" ]] && ok "coincide con COMMIT_ESPERADO" \
        || mal "NO coincide con COMMIT_ESPERADO (${COMMIT_ESPERADO:0:8})"
    fi
  fi
else
  mal "sin SERVIDOR_URL no se puede comprobar el servidor"
fi

echo
echo "3. BASE — ¿está marcada como de pruebas y es el proyecto de pruebas?"
if [[ -n "${DESTINO_URL:-}" ]]; then
  MARCA=$(psql "$DESTINO_URL" -At -c "select coalesce(current_setting('mobilink.entorno', true), '')" || true)
  [[ "$MARCA" == "pruebas" ]] && ok "la base se declara entorno de pruebas" \
    || mal "la base NO está marcada como pruebas (dice '${MARCA:-nada}'): no sigas"
  HOST=$(python3 -c 'import os,sys;from urllib.parse import urlsplit;print(urlsplit(os.environ["DESTINO_URL"]).hostname or "")')
  echo "    host: $HOST"
  case "$HOST" in
    *"$REF_PRODUCCION"*) mal "la cadena de conexión apunta al proyecto de PRODUCCIÓN" ;;
    *"$REF_PRUEBAS"*)    ok "la cadena de conexión apunta al proyecto de pruebas" ;;
    *) mal "el host no contiene ninguno de los dos proyectos: confírmalo a mano" ;;
  esac
  # Y que el servidor use ESA base, no otra: lo dice él.
  if [[ -n "${SERVIDOR_URL:-}" ]]; then
    echo "    (que el servidor use esta misma base se confirma importando un lote de"
    echo "     prueba y viendo la fila aquí; el servidor no publica su DATABASE_URL)"
  fi
else
  mal "sin DESTINO_URL no se puede comprobar la base"
fi

echo
if [[ "$FALLOS" -gt 0 ]]; then
  echo "$FALLOS comprobación(es) sin pasar. NO sigas con las migraciones ni con la importación." >&2
  exit 1
fi
echo "Las tres piezas son las de pruebas."
