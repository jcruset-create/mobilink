#!/usr/bin/env bash
#
# ANTES de restaurar, de migrar y de arrancar Express. Obligatorio.
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
# código 1 a la primera que falle: está hecho para ponerlo delante de
# cualquier cosa que escriba.
set -uo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL: no se puede comprobar el destino}"
: "${REF_PRUEBAS:?Falta REF_PRUEBAS (subdominio del proyecto Supabase de pruebas)}"
: "${REF_PRODUCCION:?Falta REF_PRODUCCION (subdominio del de producción, para descartarlo)}"

FALLOS=0
ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }

echo "1. DATABASE_URL — a qué base se va a escribir"
read -r HOST PUERTO BASE <<<"$(python3 - "$DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
print(u.hostname or "?", u.port or 5432, (u.path or "/").lstrip("/") or "?")
PY
)"
echo "   host=$HOST puerto=$PUERTO base=$BASE"
case "$HOST" in
  *"$REF_PRODUCCION"*) mal "DATABASE_URL apunta al proyecto de PRODUCCIÓN" ;;
  *"$REF_PRUEBAS"*)    ok "DATABASE_URL apunta al proyecto de pruebas" ;;
  127.0.0.1|localhost) ok "DATABASE_URL es local ($HOST)" ;;
  *) mal "el host no es ni el de pruebas ni local: confírmalo a mano antes de seguir" ;;
esac

echo "2. La marca de la base — lo único que no se puede confundir"
MARCA=$(psql "$DATABASE_URL" -At -c "select coalesce(current_setting('mobilink.entorno', true), '')" 2>/dev/null)
if [[ "$MARCA" == "pruebas" ]]; then
  ok "la base se declara entorno de pruebas"
else
  mal "la base NO está marcada como pruebas (dice '${MARCA:-nada}')"
  echo "        La pone 03-levantar-staging.sh:"
  echo "        alter database \"<base>\" set mobilink.entorno = 'pruebas';"
  echo "        Producción no la tiene y no se le pone."
fi

echo "3. El proyecto Supabase al que va a hablar el servidor"
for v in SUPABASE_URL VITE_SUPABASE_URL; do
  valor="${!v:-}"
  if [[ -z "$valor" ]]; then
    mal "$v no está definida: el servidor no arrancará o hablará con quien no toca"
    continue
  fi
  case "$valor" in
    *"$REF_PRODUCCION"*) mal "$v apunta al proyecto de PRODUCCIÓN ($valor)" ;;
    *"$REF_PRUEBAS"*)    ok "$v apunta al proyecto de pruebas" ;;
    *127.0.0.1*|*localhost*) ok "$v es local ($valor)" ;;
    *) mal "$v no es ni el de pruebas ni local: $valor" ;;
  esac
done

echo "4. Lo que NO debería estar definido en un entorno de pruebas"
PELIGROSAS=()
for v in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET TWILIO_AUTH_TOKEN SMTP_PASS \
         OPENAI_API_KEY WEBFLEET_PASSWORD MOVERTIS_TOKEN BC_CLIENT_SECRET \
         FIREBASE_SERVICE_ACCOUNT; do
  [[ -n "${!v:-}" ]] && PELIGROSAS+=("$v")
done
if [[ ${#PELIGROSAS[@]} -eq 0 ]]; then
  ok "ninguna credencial de pagos, mensajería, correo ni ERP en el entorno"
else
  mal "hay credenciales externas definidas: ${PELIGROSAS[*]}"
  echo "        Si son las de producción, PARA. Si son de pruebas, déjalo escrito."
fi

echo
if [[ "$FALLOS" -gt 0 ]]; then
  echo "$FALLOS comprobación(es) sin pasar. NO restaures, NO migres y NO arranques el servidor." >&2
  exit 1
fi
echo "Destino comprobado. Se puede restaurar, migrar o arrancar contra esta base."
