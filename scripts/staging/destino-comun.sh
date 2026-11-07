#!/usr/bin/env bash
#
# Funciones compartidas por las DOS comprobaciones del destino:
#
#   00-inicializar-destino.sh  → una sola vez, con el proyecto recién creado:
#                                identifica, rechaza producción, comprueba que
#                                la base está vacía y SOLO entonces la marca.
#   00-comprobar-destino.sh    → antes de CADA restauración, migración,
#                                siembra o arranque: exige destino autorizado
#                                Y marca. Las dos cosas, no una.
#
# Por qué están separadas: la marca `mobilink.entorno = 'pruebas'` vive dentro
# de la base, así que una base nueva no la tiene todavía. Si la comprobación
# de operaciones fuera también la que la pone, bastaría con ponerla en
# cualquier sitio para que todo pasara. Por eso ponerla es un paso aparte,
# manual, que comprueba antes el destino y las condiciones de base nueva.
#
# Y al revés: la marca NO sustituye a la comprobación del destino. Las dos
# comprobaciones miran siempre DATABASE_URL y el proyecto Supabase.
#
# No se ejecuta directamente; se hace `source` desde los dos scripts.

FALLOS=0
ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }

# Parte DATABASE_URL sin conectarse. Deja HOST, PUERTO y BASE.
partir_url() {
  read -r HOST PUERTO BASE <<<"$(python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
print(u.hostname or "?", u.port or 5432, (u.path or "/").lstrip("/") or "?")
PY
)"
}

# El destino de la conexión. Devuelve 1 si no es un destino autorizado, y lo
# hace ANTES de conectarse: a producción no se le abre ni una sesión de
# lectura por error.
comprobar_destino_conexion() {
  partir_url "$DATABASE_URL"
  echo "   host=$HOST puerto=$PUERTO base=$BASE"
  case "$HOST" in
    *"$REF_PRODUCCION"*)
      mal "DATABASE_URL apunta al proyecto de PRODUCCIÓN ($REF_PRODUCCION)"; return 1 ;;
    *"$REF_PRUEBAS"*)
      ok "DATABASE_URL apunta al proyecto de pruebas autorizado ($REF_PRUEBAS)"; return 0 ;;
    127.0.0.1|localhost)
      if [[ "${PERMITIR_LOCAL:-si}" == "si" ]]; then ok "DATABASE_URL es local ($HOST)"; return 0
      else mal "DATABASE_URL es local y PERMITIR_LOCAL=no"; return 1; fi ;;
    *)
      mal "el host no es ni el proyecto de pruebas ni local: confírmalo a mano antes de seguir"
      return 1 ;;
  esac
}

# Los dos proyectos Supabase a los que va a hablar el servidor. En la
# inicialización todavía pueden no estar definidos (no hay nada servido);
# en las operaciones son obligatorios.
comprobar_proyecto_supabase() {
  local obligatorias="${1:-si}"
  for v in SUPABASE_URL VITE_SUPABASE_URL; do
    local valor="${!v:-}"
    if [[ -z "$valor" ]]; then
      if [[ "$obligatorias" == "si" ]]; then
        mal "$v no está definida: el servidor no arrancará o hablará con quien no toca"
      else
        printf '  AVISO %s\n' "$v todavía no está definida (en la inicialización puede faltar)"
      fi
      continue
    fi
    case "$valor" in
      *"$REF_PRODUCCION"*) mal "$v apunta al proyecto de PRODUCCIÓN ($valor)" ;;
      *"$REF_PRUEBAS"*)    ok "$v apunta al proyecto de pruebas" ;;
      *127.0.0.1*|*localhost*) ok "$v es local ($valor)" ;;
      *) mal "$v no es ni el de pruebas ni local: $valor" ;;
    esac
  done
}

comprobar_credenciales_externas() {
  local peligrosas=()
  for v in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET TWILIO_AUTH_TOKEN SMTP_PASS \
           OPENAI_API_KEY WEBFLEET_PASSWORD MOVERTIS_TOKEN BC_CLIENT_SECRET \
           FIREBASE_SERVICE_ACCOUNT; do
    [[ -n "${!v:-}" ]] && peligrosas+=("$v")
  done
  if [[ ${#peligrosas[@]} -eq 0 ]]; then
    ok "ninguna credencial de pagos, mensajería, correo ni ERP en el entorno"
  else
    mal "hay credenciales externas definidas: ${peligrosas[*]}"
    echo "        Si son las de producción, PARA. Si son de pruebas, déjalo escrito."
  fi
}

leer_marca() {
  psql "$DATABASE_URL" -At -c "select coalesce(current_setting('mobilink.entorno', true), '')" 2>/dev/null
}
