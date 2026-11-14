package com.mobilink.taller

import io.flutter.embedding.android.FlutterFragmentActivity

/**
 * FlutterFragmentActivity, no FlutterActivity: el diálogo de huella de Android
 * (androidx.biometric, por debajo de local_auth) se dibuja como fragmento y
 * necesita una FragmentActivity que lo aloje. Con la actividad normal, pedir
 * la huella revienta en el momento en vez de enseñar el diálogo.
 */
class MainActivity : FlutterFragmentActivity()
