# Mobilink

Aplicacion interna de gestion para taller Mobilink (antes SEA Tarragona). Incluye panel operativo, agenda, pantallas de operarios, cobros, asistencias en carretera y modulo de almacen de neumaticos.

## Desarrollo

```bash
npm install
npm run server
npm run dev
```

El servidor local escucha en `http://localhost:4000` y Vite en `http://localhost:5174`.

## Build

```bash
npm run build
```

El build compila TypeScript y genera el frontend en `dist`. En produccion, Express sirve esa carpeta y mantiene la API en el mismo servicio.

## Deploy

El despliegue recomendado es Render como Web Service Node:

```txt
Build Command: npm ci && npm run build
Start Command: npm start
```

El repo incluye:

- `.node-version` para fijar Node `24.14.1`.
- `render.yaml` con la configuracion base del servicio.
- `.env.example` con las variables necesarias.
- `docs/render-deploy.md` con el checklist de despliegue.

No subas `.env`, bases de datos locales, backups, `dist`, `node_modules` ni `server/uploads`.
