#!/usr/bin/env python3
"""Quita del catálogo de iconos de Mobilink Assist las entradas de iPad.

Mobilink Assist es iPhone only —«TARGETED_DEVICE_FAMILY = 1»— desde que Apple
rechazó la primera subida con el error 90474. Pero el icono lo genera
«flutter_launcher_icons» a partir de assets/icon_app.png, y ese generador
reescribe el Contents.json entero con TODOS los idioms, iPad incluido. O sea
que cada vez que alguien cambia el icono, el catálogo vuelve solo a declarar
un iPad que la app ya no soporta.

Limpiarlo a mano no sirve: al siguiente cambio de icono vuelve. Por eso esto
es un script y lo llama la CI justo después de generar.

Es idempotente: si no hay nada de iPad, no toca nada y sale con 0.
"""
import json
import os
import sys

CATALOGO = "flutter_app/ios/Runner/Assets.xcassets/AppIcon.appiconset"
CONTENTS = os.path.join(CATALOGO, "Contents.json")


def main() -> int:
    if not os.path.exists(CONTENTS):
        print(f"No existe {CONTENTS}", file=sys.stderr)
        return 1

    with open(CONTENTS, encoding="utf-8") as f:
        catalogo = json.load(f)

    imagenes = catalogo.get("images", [])
    de_ipad = [i for i in imagenes if i.get("idiom") == "ipad"]
    if not de_ipad:
        print("El catálogo ya está limpio: ninguna entrada de iPad.")
        return 0

    catalogo["images"] = [i for i in imagenes if i.get("idiom") != "ipad"]

    with open(CONTENTS, "w", encoding="utf-8") as f:
        json.dump(catalogo, f, separators=(",", ":"))

    # Y fuera los PNG que ya no referencia nadie. Se comprueba contra las
    # entradas que QUEDAN, no contra las borradas: varios tamaños los comparten
    # el iPhone y el iPad, y borrar uno de esos dejaría el catálogo roto.
    referenciados = {i["filename"] for i in catalogo["images"] if "filename" in i}
    huerfanos = sorted(
        {i["filename"] for i in de_ipad if "filename" in i} - referenciados
    )
    for nombre in huerfanos:
        ruta = os.path.join(CATALOGO, nombre)
        if os.path.exists(ruta):
            os.remove(ruta)

    print(f"Quitadas {len(de_ipad)} entradas de iPad; quedan {len(catalogo['images'])}.")
    print(f"Borrados {len(huerfanos)} PNG sin referenciar: {', '.join(huerfanos) or 'ninguno'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
