-- =====================================================================
-- OPCIONAL (recomendado): libera las retenciones vencidas cada minuto,
-- aunque nadie esté usando la app en ese momento.
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 001_guardias.sql.
-- =====================================================================
create extension if not exists pg_cron;

select cron.schedule(
  'liberar-guardias-vencidas',
  '* * * * *',
  $$ select public.cleanup_expired() $$
);
