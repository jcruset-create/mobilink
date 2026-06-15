-- Añade columna fcmToken a techs para notificaciones push
ALTER TABLE techs ADD COLUMN IF NOT EXISTS "fcmToken" TEXT DEFAULT NULL;
