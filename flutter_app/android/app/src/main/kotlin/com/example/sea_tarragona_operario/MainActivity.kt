package com.example.sea_tarragona_operario

import io.flutter.embedding.android.FlutterFragmentActivity

// FlutterFragmentActivity, no FlutterActivity, y no es un capricho: el
// BiometricPrompt de Android se muestra como fragmento, así que local_auth
// necesita una FragmentActivity debajo. Con FlutterActivity a secas compila y
// arranca igual, pero al pedir la huella revienta en tiempo de ejecución con
// «local_auth requires a FragmentActivity». Es un fallo que sólo aparece al
// pulsar el botón, en el móvil, y nunca en compilación.
class MainActivity : FlutterFragmentActivity()
