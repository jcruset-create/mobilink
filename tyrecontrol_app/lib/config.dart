// Mismo proyecto Supabase que usa el panel web de TyreControl (RLS
// compartida: un tecnico con acceso_apk=true en tc_usuarios ve
// exactamente lo que sus politicas RLS le permiten, igual que en la web).
const String kSupabaseUrl = 'https://qhbtpebfkckzmtdcutvv.supabase.co';
const String kSupabaseAnonKey = 'sb_publishable_byCj39mPoGMOKWkjkYZxwA_HfX7PMek';

// Backend Node (server/) — solo se usa para el reconocimiento de
// matricula por foto (requiere la clave de OpenAI, que debe quedarse
// en servidor). El resto de la app habla directo con Supabase.
const String kBackendUrl = 'https://sea-tarragona.onrender.com';
