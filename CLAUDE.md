# Notas para Claude Code

## Antes de empezar cualquier tarea

Hacer siempre `git pull` antes de tocar nada:

```bash
git fetch origin main
git pull origin <rama-de-trabajo>
```

`main` se mueve a menudo y varias ramas tocan los mismos ficheros
(`flutter_app/`, `server/index.ts`, `src/`). Si la rama de trabajo se ha
quedado atrás, integrar `main` (merge) y resolver los conflictos **antes**
de empezar a programar, no al final.

Ojo con `flutter_app/pubspec.yaml` y los demás `pubspec.yaml`: la versión
se sube en casi cada entrega, así que casi siempre entra en conflicto. Se
resuelve tomando la versión más alta y subiéndola una más.
