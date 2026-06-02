# Deploy en Render

Este proyecto debe desplegarse como **Web Service Node**. No debe desplegarse como Static Site, porque el backend Express sirve la API y tambien entrega el frontend compilado desde `dist`.

## Configuracion del servicio

- Runtime: `Node`
- Region recomendada: `Frankfurt`
- Plan inicial: `free` para prueba; cambiar a `starter` o superior para produccion estable
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Root Directory: vacio, raiz del repo

El repo incluye `render.yaml` para crear el servicio desde Blueprint. Las variables sensibles estan marcadas con `sync: false`, asi Render las pedira en el panel sin guardarlas en Git.

## Variables obligatorias

Usa `.env.example` como plantilla. Como minimo, antes del primer deploy deben estar:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `PUBLIC_APP_URL`
- `ADMIN_PASSWORD`
- `SUPERVISOR_PASSWORD`
- `SCREENS_PASSWORD`
- `TV75_PASSWORD`
- `BACKUP_PASSWORD`
- `OPENAI_API_KEY`

Para cobros y WhatsApp tambien hacen falta las claves de Stripe y Twilio.

## Primer deploy

1. Sube el commit a GitHub.
2. En Render, crea un Web Service desde el repo o usa el Blueprint `render.yaml`.
3. Rellena las variables de entorno con los valores reales.
4. Lanza el primer deploy.
5. Cuando Render asigne la URL `https://...onrender.com`, pon ese valor en `PUBLIC_APP_URL`.
6. Redepliega para que enlaces de cobro, seguimiento y callbacks usen la URL definitiva.

## Supabase

Render despliega solo la app web y el servidor Express. Las Edge Functions de Supabase (`supabase/functions`) se despliegan aparte desde Supabase CLI o desde el panel de Supabase.

El modulo de almacen depende de las tablas, policies, buckets y funciones ya creadas en Supabase. Ahora mismo no hay migraciones versionadas en `supabase/migrations`, asi que antes de considerar produccion cerrada conviene exportar o versionar el SQL real del proyecto.

## Comprobaciones tras deploy

- Abrir `/` y confirmar que carga el panel principal.
- Abrir `/operario/asistencias` y probar login de operario.
- Crear una asistencia y abrir `/seguimiento/:token`.
- Abrir `/almacen-neumaticos` y confirmar login/carga con Supabase.
- Probar una lectura PDF/OCR si `OPENAI_API_KEY` esta configurada.
