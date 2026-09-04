#!/bin/bash
# Deja el entorno listo para trabajar: dependencias de Node y, sobre todo,
# Flutter.
#
# POR QUÉ FLUTTER. Siete de las aplicaciones de este repositorio son Flutter y
# sin el SDK aquí el Dart no se compila: los fallos se descubren en la CI, seis
# minutos más tarde y con un commit ya empujado. Ha pasado más de una vez
# ("Undefined name 'SupabaseService'", "Illegal character '241'" por una ñ en
# un identificador). Con el SDK instalado, `flutter analyze` los caza antes.
#
# NO se instala el SDK de Android: son varios gigas más y `flutter build apk`
# ya lo hace la CI. Lo que aporta aquí es el análisis y las pruebas, que es
# donde están los fallos que se escapan.
set -euo pipefail

# Solo en el entorno remoto: en local cada uno tiene sus herramientas.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

FLUTTER_VERSION=3.35.4   # la misma que .github/workflows/build-*-apk.yml
FLUTTER_DIR=/opt/flutter

echo "→ Dependencias de Node"
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
npm install --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund

# Idempotente: si ya está la versión buena, no se vuelve a bajar 1,4 GB.
if [ -x "$FLUTTER_DIR/bin/flutter" ] \
   && "$FLUTTER_DIR/bin/flutter" --version 2>/dev/null | grep -q "$FLUTTER_VERSION"; then
  echo "→ Flutter $FLUTTER_VERSION ya está"
else
  echo "→ Instalando Flutter $FLUTTER_VERSION (1,4 GB, tarda un par de minutos)"
  rm -rf "$FLUTTER_DIR" /tmp/flutter.tar.xz
  curl -fsSL --max-time 900 -o /tmp/flutter.tar.xz \
    "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
  tar xf /tmp/flutter.tar.xz -C /opt
  rm -f /tmp/flutter.tar.xz
fi

# El SDK es un repositorio git y flutter se queja si no es "seguro".
git config --global --add safe.directory "$FLUTTER_DIR" 2>/dev/null || true

export PATH="$FLUTTER_DIR/bin:$PATH"
echo "export PATH=\"$FLUTTER_DIR/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"

# Las siete aplicaciones comparten caché de paquetes, así que resolver una
# deja casi todo bajado para las demás.
for app in tyrecontrol_app flutter_app taller_app lite_app safety_app almacen_app toolcontrol_app presencia_app; do
  if [ -f "$app/pubspec.yaml" ]; then
    echo "→ pub get en $app"
    (cd "$app" && flutter pub get >/dev/null 2>&1) || echo "  (falló; se verá al analizar)"
  fi
done

echo "✔ Listo. flutter analyze y flutter test ya funcionan."
