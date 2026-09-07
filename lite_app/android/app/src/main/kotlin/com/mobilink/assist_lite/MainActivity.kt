package com.mobilink.assist_lite

import io.flutter.embedding.android.FlutterFragmentActivity

/**
 * FlutterFragmentActivity, no FlutterActivity: el diálogo de huella de Android
 * (androidx.biometric, por debajo de local_auth) se dibuja como fragmento y
 * necesita una FragmentActivity que lo aloje. Con la actividad normal, pedir
 * la huella revienta en el momento en vez de enseñar el diálogo.
 *
 * Es un cambio de la clase base, no del comportamiento: la app arranca igual.
 */
class MainActivity : FlutterFragmentActivity()
