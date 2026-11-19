-- ─────────────────────────────────────────────────────────────────────────────
-- TyreControl · Seguridad, fase 0.3 · Fotos: quién lista y quién sube
--
-- Dos almacenes de ficheros de TyreControl:
--
--   tc-revisiones-fotos   fotos de partes, matrículas, firmas, etiquetas e
--                         incidencias
--   tc-operaciones        adjuntos de las operaciones
--
-- Los dos son públicos: una foto se abre con su enlace, que es largo y no se
-- puede adivinar. Eso NO se toca aquí; los enlaces ya guardados siguen
-- abriéndose igual en el panel, en la tablet y en los PDF.
--
-- Lo que sí estaba abierto de más:
--
--   · En tc-operaciones, la lista de ficheros la podía pedir cualquiera, sin
--     iniciar sesión siquiera. Y con la lista, los enlaces de todas las
--     empresas.
--   · En los dos, cualquier usuario con sesión podía listar, subir y —en
--     tc-operaciones— sobrescribir ficheros. Un usuario de cliente incluido.
--
-- Lo que queda: listar, subir y sobrescribir, solo quien tiene sesión y NO es
-- de rol cliente. Es decir, técnicos y administradores, igual que hasta ahora.
--
-- Por qué a los técnicos se les deja LEER: la tablet sube las fotos y las
-- firmas en modo «sustituir si ya existe» (upsert), y para eso el almacén
-- exige poder leer el fichero además de escribirlo. Quitárselo rompería la
-- subida de firmas.
--
-- No se cambia ni el tipo ni los roles de ninguna política: solo su condición.
-- Se puede pegar entera en el editor SQL de Supabase y repetir sin miedo.
-- ─────────────────────────────────────────────────────────────────────────────

do $migracion$
declare
  -- nombre, tipo, almacén
  v_politicas constant text[][] := array[
    ['tc_revisiones_fotos_read',  'SELECT', 'tc-revisiones-fotos'],
    ['tc_revisiones_fotos_write', 'INSERT', 'tc-revisiones-fotos'],
    ['tc_operaciones_read',       'SELECT', 'tc-operaciones'],
    ['tc_operaciones_write',      'INSERT', 'tc-operaciones'],
    ['tc_operaciones_update',     'UPDATE', 'tc-operaciones']
  ];
  v_cond  text;
  v_mal   text;
  i       int;
begin
  -- La condición llama a tc_is_cliente(). Si a alguien le faltara el permiso
  -- de ejecutarla, en vez de «no ves nada» recibiría un error al listar o al
  -- subir. Se comprueba antes de tocar nada.
  if not has_function_privilege('authenticated', 'public.tc_is_cliente()', 'execute')
     or not has_function_privilege('anon', 'public.tc_is_cliente()', 'execute') then
    raise exception 'Fase 0.3: anon o authenticated no pueden ejecutar tc_is_cliente(). No se toca nada.';
  end if;

  -- Tienen que estar las cinco, y con el tipo que se espera: si alguien las
  -- ha rehecho de otra forma, mejor mirarlo que pisarlo.
  select string_agg(v_politicas[n][1], ', ') into v_mal
    from generate_subscripts(v_politicas, 1) n
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects'
        and p.policyname = v_politicas[n][1] and p.cmd = v_politicas[n][2]);
  if v_mal is not null then
    raise exception 'Fase 0.3: estas políticas no existen o no son del tipo esperado: %. No se toca nada.', v_mal;
  end if;

  for i in 1 .. array_length(v_politicas, 1) loop
    v_cond := format(
      '(bucket_id = %L and auth.uid() is not null and not public.tc_is_cliente())',
      v_politicas[i][3]);
    if v_politicas[i][2] = 'INSERT' then
      execute format('alter policy %I on storage.objects with check %s', v_politicas[i][1], v_cond);
    else
      -- SELECT y UPDATE: qué filas se alcanzan. En UPDATE, sin `with check`
      -- propio, Postgres aplica esta misma condición a la fila resultante.
      execute format('alter policy %I on storage.objects using %s', v_politicas[i][1], v_cond);
    end if;
  end loop;

  -- ── Comprobar ─────────────────────────────────────────────────────────────
  select string_agg(p.policyname, ', ') into v_mal
    from pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects'
     and p.policyname = any (array(select v_politicas[n][1] from generate_subscripts(v_politicas, 1) n))
     and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ 'tc_is_cliente'
       or coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ 'uid\(\) IS NOT NULL');
  if v_mal is not null then
    raise exception 'Fase 0.3: estas políticas no han quedado con la condición nueva: %', v_mal;
  end if;

  raise notice 'Fase 0.3 · fotos: 5 políticas al día. Listar, subir y sobrescribir: solo con sesión y sin rol cliente.';
end
$migracion$;
