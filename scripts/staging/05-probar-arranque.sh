#!/usr/bin/env bash
#
# ¿Arranca el servidor con las variables mínimas, y responde el endpoint real
# del PDF? Esto se comprueba AQUÍ, en local, antes de pedir que nadie cree
# nada: dejar una variable sin definir no demuestra que el servidor levante
# sin ella.
#
#   BASE_DB=esquema_completo CLAVES=<ruta>/claves.json SUPABASE_STUB=http://127.0.0.1:3002 \
#   bash scripts/staging/05-probar-arranque.sh
#
# Necesita el stack local de pruebas (PostgREST + stub de auth) y una base de
# pruebas con el histórico importado. No toca producción ni sale a internet:
# todas las integraciones externas se quedan sin credencial a propósito.
set -uo pipefail

BASE_DB="${BASE_DB:-esquema_completo}"
CLAVES="${CLAVES:-rest/claves.json}"
STUB="${SUPABASE_STUB:-http://127.0.0.1:3002}"
PUERTO="${PUERTO:-4010}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-mobilink}"

case "$BASE_DB" in banco_*|esquema_completo*) ;;
  *) echo "Base no permitida: '$BASE_DB'. Solo bases de pruebas." >&2; exit 1;; esac
[[ -f "$CLAVES" ]] || { echo "No encuentro $CLAVES (los JWT del PostgREST local)" >&2; exit 1; }

SERVICE=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['service'])" "$CLAVES")
ADMIN=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['admin'])" "$CLAVES")
ENV_FILE=$(mktemp); LOG=$(mktemp); PDF=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT

# ── LAS VARIABLES MÍNIMAS ─────────────────────────────────────────────────
# Esta es la lista completa con la que el servidor arranca. Todo lo demás
# —Stripe, Twilio, SMTP, los buzones IMAP, OpenAI, Webfleet, Movertis,
# Business Central, Firebase, Google Maps— se queda SIN DEFINIR: sin
# credencial, cada integración se apaga sola y no puede salir al mundo.
cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgresql://$PGUSER@$PGHOST:$PGPORT/$BASE_DB
PGSSLMODE=disable
SUPABASE_URL=$STUB
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
VITE_SUPABASE_URL=$STUB
VITE_SUPABASE_ANON_KEY=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['anon'])" "$CLAVES")
NODE_ENV=production
PORT=$PUERTO
TZ=Europe/Madrid
PUBLIC_APP_URL=http://127.0.0.1:$PUERTO
TYRE_CONTROL_WRITE_ENABLED=false
TYRE_CONTROL_REPAIR_SYNC_ENABLED=false
TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED=false
TYRE_CONTROL_SYNC_COMPANIES=
CASH_STORAGE_LOCAL=1
RECEPCIONES_STORAGE_LOCAL=1
OR_MANUALES_STORAGE_LOCAL=1
TACOGRAFOS_STORAGE_LOCAL=1
THEREFORE_STORAGE_LOCAL=1
SELF_STORAGE_STORAGE_LOCAL=1
ENV

FALLOS=0
ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }

# ── ANTES de arrancar: el destino ─────────────────────────────────────────
#
# Arrancar el servidor ejecuta DDL sobre DATABASE_URL. Comprobar el entorno
# DESPUÉS del despliegue llega tarde: para entonces la base ya está tocada.
# Así que no se arranca sin que 00-comprobar-destino.sh dé el visto bueno.
echo "0. Comprobación del destino, antes de arrancar nada"
if ! ( set -a; . "$ENV_FILE"; set +a
       REF_PRUEBAS="${REF_PRUEBAS:-127.0.0.1}" REF_PRODUCCION="${REF_PRODUCCION:-qhbtpebfkckzmtdcutvv}" \
       bash "$(dirname "${BASH_SOURCE[0]}")/00-comprobar-destino.sh" ) ; then
  echo "El destino no está confirmado: NO se arranca el servidor." >&2
  exit 1
fi

echo "Arrancando el servidor con $(grep -c '=' "$ENV_FILE") variables, contra $BASE_DB"
( cd "$RAIZ" && set -a && . "$ENV_FILE" && set +a && exec npx tsx server/index.ts ) > "$LOG" 2>&1 &
SRV=$!
for _ in $(seq 1 40); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/api/health")" == "200" ]] && break
  kill -0 "$SRV" 2>/dev/null || break
  sleep 3
done

if ! kill -0 "$SRV" 2>/dev/null; then
  mal "el servidor se ha caído al arrancar"
  echo "--- últimas líneas ---"; tail -20 "$LOG"
  exit 1
fi
ok "el servidor arranca y escucha en $PUERTO"
curl -s "http://127.0.0.1:$PUERTO/api/health" | head -c 200; echo

# Lo que importa tanto como que arranque: que NO haya encendido nada externo.
echo
echo "Integraciones externas, según el propio arranque:"
grep -iE "apagad|faltan las credenciales|no disponible|sin credencial" "$LOG" | sed 's/^/  /' | head -12
if grep -qiE "stripe|twilio|smtp" <(grep -iE "conectad|activo con" "$LOG"); then
  mal "algo externo parece configurado: revísalo"
else
  ok "ni pagos, ni mensajería, ni correo: sin credencial no se encienden"
fi

# ── EL ENDPOINT REAL DEL PDF ──────────────────────────────────────────────
IV=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$BASE_DB" -At -c \
  "select id from tc_intervenciones where importacion_lote_id is not null order by fecha desc limit 1")
if [[ -z "$IV" ]]; then
  echo "  (sin intervenciones importadas en $BASE_DB: no se puede probar el PDF)"
else
  echo
  echo "PDF del parte $IV por el endpoint real:"
  C=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/api/tyrecontrol/parte/$IV/pdf")
  [[ "$C" == "401" ]] && ok "sin token: 401 (falta sesión)" || mal "sin token debería dar 401 y ha dado $C"
  C=$(curl -s -o "$PDF" -w '%{http_code}' -H "Authorization: Bearer $ADMIN" \
        "http://127.0.0.1:$PUERTO/api/tyrecontrol/parte/$IV/pdf")
  TAM=$(stat -c %s "$PDF" 2>/dev/null || echo 0)
  if [[ "$C" == "200" && "$(head -c 4 "$PDF")" == "%PDF" ]]; then
    ok "con sesión de admin: 200 y un PDF de $TAM bytes"
  else
    mal "con sesión de admin ha dado $C ($TAM bytes)"; head -c 200 "$PDF"; echo
  fi
fi

kill "$SRV" 2>/dev/null
echo
if [[ "$FALLOS" -gt 0 ]]; then echo "$FALLOS comprobación(es) sin pasar"; exit 1; fi
echo "El servidor arranca con las variables mínimas y el endpoint del PDF responde."
