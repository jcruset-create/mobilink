-- ============================================================
-- Cron diario: enviar email de alertas a las 8:00h (UTC+1 = 7:00 UTC)
-- Requiere extensiones pg_cron y pg_net habilitadas en Supabase
-- (Dashboard → Database → Extensions → pg_cron + pg_net)
-- ============================================================

-- Activar extensión pg_cron (si no está activa)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Eliminar cron anterior si existe
SELECT cron.unschedule('sea-alertas-email-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sea-alertas-email-diario'
);

-- Programar: cada día a las 07:00 UTC (08:00 España, hora peninsular)
SELECT cron.schedule(
  'sea-alertas-email-diario',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/alertas-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
