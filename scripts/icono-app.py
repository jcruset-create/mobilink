#!/usr/bin/env python3
"""
Prepara el logo de Mobilink Assist como icono de la APK.

    python3 scripts/icono-app.py <origen.png> [--app flutter_app]

── Los tres problemas del logo original ────────────────────────────────────────

 1. **Trae un margen blanco.** El PNG es un cuadrado blanco con el logo redondo
    dentro. En el lanzador de Android eso se ve como un icono más pequeño que
    los de al lado, flotando en un recuadro claro.

 2. **Las esquinas también son blancas.** El logo tiene las esquinas
    redondeadas, así que fuera del radio queda blanco. Android ya recorta el
    icono con la forma que tenga el móvil (círculo, cuadrado redondeado,
    gota…), y al recortar sobre blanco aparece un borde claro que no debería
    estar.

    Se quita con un relleno por inundación DESDE LAS CUATRO ESQUINAS: solo se
    sustituye el blanco conectado con el borde. El blanco de dentro —la «M»,
    el furgón, las letras— no se toca, que es justo lo que un recorte por
    umbral se cargaría.

 3. **El icono adaptativo se recorta por fuera.** Android garantiza que se vea
    el 66 % central del primer plano; el resto puede desaparecer según el
    móvil. Pasarle el logo a sangre —como estaba— significa perder el anillo
    exterior. Por eso se genera un primer plano APARTE, con el logo reducido
    dentro de la zona segura y el fondo en un color plano.

Genera:
  assets/icon_app.png             el logo a sangre, sin blancos (iOS y legacy)
  assets/icon_app_foreground.png  el mismo, dentro de la zona segura (Android)
y dice por consola qué color poner en `adaptive_icon_background`.
"""

import sys
from collections import deque
from pathlib import Path

from PIL import Image

# Cuánto se puede alejar del blanco puro un píxel y seguir siendo «margen».
# 30 deja pasar el antialias del borde redondeado sin comerse el blanco del logo.
TOLERANCIA = 30
# Zona segura del icono adaptativo de Android: se garantiza el 66 % central.
# 0.62 deja un poco de aire para que el recorte circular no roce el logo.
ZONA_SEGURA = 0.62
LADO = 1024


def casi_blanco(p) -> bool:
    return p[0] >= 255 - TOLERANCIA and p[1] >= 255 - TOLERANCIA and p[2] >= 255 - TOLERANCIA


def transparente(p) -> bool:
    return len(p) > 3 and p[3] < 16


def recortar_margen(img: Image.Image) -> Image.Image:
    """Quita el marco blanco o transparente que rodea al logo."""
    px = img.load()
    an, al = img.size

    def fila_vacia(y):
        return all(casi_blanco(px[x, y]) or transparente(px[x, y]) for x in range(an))

    def col_vacia(x):
        return all(casi_blanco(px[x, y]) or transparente(px[x, y]) for y in range(al))

    arriba, abajo, izq, der = 0, al - 1, 0, an - 1
    while arriba < abajo and fila_vacia(arriba):
        arriba += 1
    while abajo > arriba and fila_vacia(abajo):
        abajo -= 1
    while izq < der and col_vacia(izq):
        izq += 1
    while der > izq and col_vacia(der):
        der -= 1
    return img.crop((izq, arriba, der + 1, abajo + 1))


def color_de_fondo(img: Image.Image) -> tuple:
    """
    El color del propio logo, tomado del centro de cada borde.

    Se mira el borde y no una esquina porque la esquina es justo lo que está
    fuera del radio: sería el blanco que queremos quitar.
    """
    px = img.load()
    an, al = img.size
    candidatos = [px[an // 2, 2], px[an // 2, al - 3], px[2, al // 2], px[an - 3, al // 2]]
    solidos = [c for c in candidatos if not casi_blanco(c) and not transparente(c)]
    if not solidos:
        return (13, 27, 46, 255)  # el azul noche del logo, por si acaso
    # El más repetido; con empate, el primero.
    return max(solidos, key=lambda c: sum(1 for o in solidos if o[:3] == c[:3]))


def rellenar_esquinas(img: Image.Image, fondo: tuple) -> Image.Image:
    """
    Sustituye por `fondo` el blanco/transparente CONECTADO con el borde.

    Inundación desde las cuatro esquinas: lo de dentro del logo no se toca.
    """
    img = img.convert("RGBA")
    px = img.load()
    an, al = img.size
    visto = bytearray(an * al)
    cola = deque()

    def encolar(x, y):
        if 0 <= x < an and 0 <= y < al and not visto[y * an + x]:
            p = px[x, y]
            if casi_blanco(p) or transparente(p):
                visto[y * an + x] = 1
                cola.append((x, y))

    for x in range(an):
        encolar(x, 0)
        encolar(x, al - 1)
    for y in range(al):
        encolar(0, y)
        encolar(an - 1, y)

    while cola:
        x, y = cola.popleft()
        px[x, y] = fondo
        encolar(x + 1, y)
        encolar(x - 1, y)
        encolar(x, y + 1)
        encolar(x, y - 1)
    return img


def cuadrar(img: Image.Image, fondo: tuple) -> Image.Image:
    an, al = img.size
    if an == al:
        return img
    lado = max(an, al)
    lienzo = Image.new("RGBA", (lado, lado), fondo)
    lienzo.paste(img, ((lado - an) // 2, (lado - al) // 2), img)
    return lienzo


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    origen = Path(sys.argv[1])
    app = "flutter_app"
    if "--app" in sys.argv:
        app = sys.argv[sys.argv.index("--app") + 1]
    destino = Path(app) / "assets"
    if not destino.is_dir():
        print(f"No existe {destino}")
        return 1

    img = Image.open(origen).convert("RGBA")
    print(f"origen: {img.size[0]}×{img.size[1]}")

    img = recortar_margen(img)
    print(f"sin margen: {img.size[0]}×{img.size[1]}")

    fondo = color_de_fondo(img)
    hex_fondo = "#{:02X}{:02X}{:02X}".format(*fondo[:3])
    print(f"fondo del logo: {hex_fondo}")

    img = rellenar_esquinas(img, fondo)
    img = cuadrar(img, fondo)

    # 1 · A sangre, para iOS y para los Android antiguos sin icono adaptativo.
    sangre = img.resize((LADO, LADO), Image.LANCZOS)
    sangre.convert("RGB").save(destino / "icon_app.png")

    # 2 · Primer plano del icono adaptativo, dentro de la zona segura.
    lado_util = int(LADO * ZONA_SEGURA)
    primer_plano = Image.new("RGBA", (LADO, LADO), (0, 0, 0, 0))
    borde = (LADO - lado_util) // 2
    primer_plano.paste(img.resize((lado_util, lado_util), Image.LANCZOS), (borde, borde))
    primer_plano.save(destino / "icon_app_foreground.png")

    print(f"\nescrito {destino}/icon_app.png y {destino}/icon_app_foreground.png")
    print(f"pon en pubspec.yaml:  adaptive_icon_background: \"{hex_fondo}\"")
    print(f"                      background_color_ios: \"{hex_fondo}\"")
    print("\nluego:  cd " + app + " && flutter pub get && dart run flutter_launcher_icons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
