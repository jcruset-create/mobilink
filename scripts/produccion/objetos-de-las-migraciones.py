#!/usr/bin/env python3
"""Qué objetos necesitan y qué redefinen las tres migraciones del histórico.

Lee los ficheros SQL y saca, en JSON:

  crea        objetos que las migraciones crean (su ausencia es NORMAL)
  redefine    funciones y vistas con «create or replace» que PUEDEN preexistir,
              con la firma EXACTA que la migración declara
  requiere    tablas, columnas y funciones que las migraciones dan por
              supuestas (su ausencia BLOQUEA)

No se conecta a ninguna base: solo lee los .sql. El que comprueba contra la
base es preflight-produccion.sh.

    python3 scripts/produccion/objetos-de-las-migraciones.py [fichero.sql ...]
"""
import json, re, sys, pathlib

RAIZ = pathlib.Path(__file__).resolve().parents[2]
POR_DEFECTO = [
    "supabase/migrations/tyrecontrol_importacion_historico.sql",
    "supabase/migrations/tyrecontrol_importacion_historico_fase2.sql",
    "supabase/migrations/tyrecontrol_importacion_historico_fase3.sql",
]
FICHEROS = [pathlib.Path(a) for a in sys.argv[1:]] or [RAIZ / p for p in POR_DEFECTO]

# ── quitar comentarios y literales, que si no ensucian todo ────────────────
def limpiar(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return sql

def sin_cuerpos(sql: str) -> str:
    """Fuera los cuerpos $$…$$: para buscar DDL de primer nivel."""
    return re.sub(r"\$([a-z_]*)\$.*?\$\1\$", " BODY ", sql, flags=re.S | re.I)

IDENT = r"[a-zA-Z_][a-zA-Z0-9_]*"
def norm(n: str) -> str:
    return n.lower().replace("public.", "").strip('"')

texto_total, limpio_total, sincuerpo_total = "", "", ""
for f in FICHEROS:
    t = f.read_text(errors="ignore")
    texto_total += "\n" + t
    limpio_total += "\n" + limpiar(t)
    sincuerpo_total += "\n" + sin_cuerpos(limpiar(t))

# ── 1. Lo que las migraciones CREAN ────────────────────────────────────────
crea = {"tablas": set(), "funciones": set(), "vistas": set(), "tipos": set(), "columnas": set()}
for m in re.finditer(rf"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?({IDENT})", sincuerpo_total, re.I):
    crea["tablas"].add(norm(m.group(1)))
for m in re.finditer(rf"create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?({IDENT})", sincuerpo_total, re.I):
    crea["vistas"].add(norm(m.group(1)))
for m in re.finditer(rf"create\s+type\s+(?:public\.)?({IDENT})", sincuerpo_total, re.I):
    crea["tipos"].add(norm(m.group(1)))
# Un solo «alter table» puede añadir varias columnas separadas por comas, así
# que se coge la sentencia entera y se buscan todos sus «add column».
for m in re.finditer(rf"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?({IDENT})(.*?);", sincuerpo_total, re.I | re.S):
    tabla = norm(m.group(1))
    for c in re.finditer(rf"\badd\s+column\s+(?:if\s+not\s+exists\s+)?({IDENT})", m.group(2), re.I):
        crea["columnas"].add(f"{tabla}.{norm(c.group(1))}")
# Y las columnas de las tablas que las propias migraciones crean.
for m in re.finditer(rf"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?({IDENT})\s*\((.*?)\n\s*\);",
                     sincuerpo_total, re.I | re.S):
    tabla = norm(m.group(1))
    for linea in m.group(2).split("\n"):
        c = re.match(rf"\s*({IDENT})\s+\S", linea)
        if c and c.group(1).lower() not in ("primary", "unique", "foreign", "constraint", "check", "exclude", "like"):
            crea["columnas"].add(f"{tabla}.{norm(c.group(1))}")

# ── 2. Lo que REDEFINEN, con la firma exacta que declaran ──────────────────
def tipos_de_argumentos(args: str):
    """De «p_a uuid, p_b text default null» saca ['uuid','text'].

    Corta por comas de primer nivel, quita el modo (in/out/inout/variadic),
    el nombre del parámetro y el valor por defecto. Devuelve None si no se
    puede leer con seguridad: más vale decirlo que inventar una firma."""
    partes, nivel, actual = [], 0, ""
    for ch in args:
        if ch == "(":
            nivel += 1
        elif ch == ")":
            nivel -= 1
        if ch == "," and nivel == 0:
            partes.append(actual); actual = ""
        else:
            actual += ch
    if actual.strip():
        partes.append(actual)
    tipos = []
    for p in partes:
        p = re.split(r"\bdefault\b|:=|(?<![:<>!])=(?!=)", p, flags=re.I)[0].strip()
        if not p:
            return None
        trozos = p.split()
        if trozos and trozos[0].lower() in ("in", "out", "inout", "variadic"):
            if trozos[0].lower() == "out":      # los OUT no cuentan en la identidad
                continue
            trozos = trozos[1:]
        if len(trozos) >= 2 and re.fullmatch(IDENT, trozos[0]):
            trozos = trozos[1:]                  # el primero era el nombre
        tipo = " ".join(trozos).strip()
        if not tipo:
            return None
        tipos.append(tipo)
    return tipos

redefine_fn, redefine_vista = [], sorted(crea["vistas"])
for m in re.finditer(rf"create\s+or\s+replace\s+function\s+(?:public\.)?({IDENT})\s*\(", sincuerpo_total, re.I):
    nombre = norm(m.group(1))
    i, nivel = m.end() - 1, 0
    while i < len(sincuerpo_total):
        if sincuerpo_total[i] == "(":
            nivel += 1
        elif sincuerpo_total[i] == ")":
            nivel -= 1
            if nivel == 0:
                break
        i += 1
    tipos = tipos_de_argumentos(sincuerpo_total[m.end():i])
    redefine_fn.append({"nombre": nombre,
                        "firma": None if tipos is None else f"public.{nombre}({', '.join(tipos)})",
                        "argumentos": tipos})
vistos, unicas = set(), []
for f in redefine_fn:
    clave = (f["nombre"], tuple(f["argumentos"] or []))
    if clave not in vistos:
        vistos.add(clave); unicas.append(f)
redefine_fn = sorted(unicas, key=lambda x: (x["nombre"], x["firma"] or ""))

# ── 3. Lo que DAN POR SUPUESTO ─────────────────────────────────────────────
#
# Tres fuentes de ruido que hay que quitar o el resultado no sirve:
#   · los nombres de CTE («with base as (…)»), que parecen tablas;
#   · los `revoke … from <rol>`, donde «from» va seguido de un rol;
#   · las funciones que devuelven filas y se llaman en el FROM
#     (jsonb_array_elements_text(…), unnest(…), tc_imp_desfase_mano_obra(…)),
#     que parecen tablas por la forma pero no lo son.
ctes = set()
for m in re.finditer(rf"(?:\bwith\s+(?:recursive\s+)?|,)\s*({IDENT})\s+as\s*\(", limpio_total, re.I):
    ctes.add(norm(m.group(1)))
sin_revokes = re.sub(r"\brevoke\b[^;]*;", " ", limpio_total, flags=re.I | re.S)

tablas_ref, columnas_ref, funciones_ref = set(), set(), set()
# En FROM y JOIN, un «(» detrás es una función que devuelve filas y un «.»
# es un prefijo de esquema o una columna cualificada: ni uno ni otro son la
# tabla que buscamos. En REFERENCES y ALTER TABLE, en cambio, el «(» es la
# lista de columnas y el nombre sí es una tabla.
for pat, mirar_siguiente in ((rf"\bfrom\s+(?:only\s+)?(?:public\.)?({IDENT})", True),
                             (rf"\bjoin\s+(?:public\.)?({IDENT})", True),
                             (rf"\binsert\s+into\s+(?:public\.)?({IDENT})", False),
                             (rf"\bupdate\s+(?:only\s+)?(?:public\.)?({IDENT})\s+set\b", False),
                             (rf"\bdelete\s+from\s+(?:public\.)?({IDENT})", False),
                             (rf"\breferences\s+(?:public\.)?({IDENT})", False),
                             (rf"\balter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?({IDENT})", False)):
    for m in re.finditer(pat, sin_revokes, re.I):
        if mirar_siguiente and sin_revokes[m.end():m.end() + 1] in ("(", "."):
            continue
        tablas_ref.add(norm(m.group(1)))
# Columnas: listas de INSERT, claves ajenas y ON CONFLICT.
for m in re.finditer(rf"insert\s+into\s+(?:public\.)?({IDENT})\s*\(([^;]*?)\)\s*(?:values|select|overriding)", limpio_total, re.I | re.S):
    t = norm(m.group(1))
    for c in m.group(2).split(","):
        c = c.strip().strip('"')
        if re.fullmatch(IDENT, c):
            columnas_ref.add(f"{t}.{c.lower()}")
for m in re.finditer(rf"references\s+(?:public\.)?({IDENT})\s*\(\s*({IDENT})\s*\)", limpio_total, re.I):
    columnas_ref.add(f"{norm(m.group(1))}.{norm(m.group(2))}")
# Funciones propias que se llaman (las del proyecto, no las de PostgreSQL).
for m in re.finditer(rf"\b((?:tc|app|adm)_{IDENT})\s*\(", sin_revokes, re.I):
    funciones_ref.add(norm(m.group(1)))

PALABRAS = {"select", "insert", "update", "delete", "values", "set", "where", "from",
            "table", "only", "public", "exists", "lateral", "new", "old", "dual"}
def es_catalogo(t):
    return t.startswith("pg_") or t.startswith("information_schema")
requiere_tablas = sorted(t for t in tablas_ref
                         if t not in crea["tablas"] and t not in crea["vistas"]
                         and t not in PALABRAS and t not in ctes and not es_catalogo(t))
requiere_columnas = sorted(c for c in columnas_ref
                           if c.split(".")[0] in requiere_tablas and c not in crea["columnas"])
nombres_redefinidos = {f["nombre"] for f in redefine_fn}
# Un nombre de tabla seguido de «(» es una lista de columnas de INSERT o un
# cast a su tipo compuesto, no una llamada a función.
requiere_funciones = sorted(f for f in funciones_ref
                            if f not in nombres_redefinidos
                            and f not in crea["tablas"] and f not in crea["vistas"]
                            and f not in tablas_ref)

salida = {
    "ficheros": [str(f.relative_to(RAIZ)) if str(f).startswith(str(RAIZ)) else str(f) for f in FICHEROS],
    "crea": {k: sorted(v) for k, v in crea.items()},
    "redefine_funciones": redefine_fn,
    "redefine_vistas": redefine_vista,
    "requiere_tablas": requiere_tablas,
    "requiere_columnas": requiere_columnas,
    "requiere_funciones": requiere_funciones,
    "ctes_ignorados": sorted(ctes),
    "catalogos": sorted(t for t in requiere_tablas if t.startswith("tc_cat_")),
}
json.dump(salida, sys.stdout, indent=1, ensure_ascii=False)
print()
