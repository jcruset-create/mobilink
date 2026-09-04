# Notas para Claude Code

Se trabaja con **disco virtual y varias sesiones a la vez** sobre el mismo
repositorio, así que el estado local se queda obsoleto enseguida.

## 1. Antes de empezar cualquier tarea: pull

```bash
git fetch origin main
git pull origin <rama-de-trabajo>
```

Si la rama de trabajo se ha quedado atrás respecto a `main`, integrar `main`
(`git merge origin/main`) y resolver los conflictos **antes** de empezar a
programar, no al final. `main` se mueve a menudo y varias ramas tocan los
mismos ficheros (`flutter_app/`, `server/index.ts`, `src/`).

## 2. Antes de cada commit y de cada push: revisar versiones

Otra sesión puede haber subido la versión de la misma app mientras
trabajabas. Comprobarlo siempre, en todas las sesiones:

```bash
bash scripts/check-versions.sh
```

Compara la versión de cada `pubspec.yaml` y del `package.json` con
`origin/main` y marca:

- **OK** — esta rama no ha tocado la versión.
- **SUBIDA** — esta rama va por delante: correcto al entregar.
- **CONFLICTO** — `main` ha subido la versión por su cuenta. Hay que hacer
  `git merge origin/main` y volver a subir la versión **por encima** de la
  suya antes de commitear.

Si el script falla o no está disponible, el equivalente a mano es comparar
`git show origin/main:<app>/pubspec.yaml | head` con el fichero local.

## 3. Al resolver conflictos de versión

Se toma la versión más alta de las dos y se sube una más (tanto el nombre
como el build number). Ejemplo real: rama en `1.7.3+27`, `main` en
`1.8.0+28` → se deja `1.8.1+29`.

## 4. Al terminar: PR y merge, sin preguntar

Cuando el trabajo esté acabado y probado, **se abre el PR y se mergea en
cuanto la CI esté verde**. No hace falta pedir permiso cada vez: es la norma
de la casa.

Antes de mergear, dos comprobaciones que no se saltan:

1. **La CI verde sobre el commit de CÓDIGO.** El bump de versión que mete la
   CI lleva `[skip ci]`, así que la punta del PR sale con CERO checks. Hay que
   mirar la ejecución del commit anterior y confirmar que lo único que ha
   cambiado desde entonces es la línea `version:` del pubspec.

2. **El diff contra `main`, no solo lo que uno ha escrito.** Un merge mal
   resuelto se lleva por delante cambios ajenos sin que git diga nada. Si
   aparece un fichero que no se ha tocado, hay que mirarlo antes de mergear.

Si algo sale rojo o el diff trae algo que no debería, se para y se avisa: la
norma es mergear lo que está bien, no mergear pase lo que pase.
