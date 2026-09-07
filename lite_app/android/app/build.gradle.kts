import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

// Firebase solo si hay fichero de configuración. La CI lo escribe desde un
// secret; en un clon recién hecho no está, y aplicar el plugin sin él aborta
// el build con "File google-services.json is missing". Así el proyecto compila
// en cualquier máquina y la app se queda sin push, que es justo lo que
// contempla lib/services/push.dart.
val googleServices = file("google-services.json")
if (googleServices.exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle("google-services.json no encontrado: se compila SIN notificaciones push.")
}

// Firma de la casa. El fichero lo escribe la CI a partir de los secrets y está
// en .gitignore: la clave privada nunca entra en el repositorio, que es público.
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (keyPropertiesFile.exists()) {
    keyProperties.load(FileInputStream(keyPropertiesFile))
}

android {
    // Identificador propio de Lite. Es una app nueva, así que se estrena ya con
    // el dominio de Mobilink en vez de arrastrar com.seatarragona.*: el
    // applicationId es inmutable una vez publicado en Play Store
    // (docs/PLAN_RENOMBRADO_PROFUNDO.md, B3).
    namespace = "com.mobilink.assist_lite"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "com.mobilink.assist_lite"
        // 24 (Android 7, 2016) en vez del 21 que trae Flutter: lo exige
        // local_auth_android, que es lo que abre la app con la huella o la
        // cara (flutter_secure_storage pide 23). Deja fuera Android 5 y 6,
        // que a día de hoy es menos del 1 % de los móviles en uso y ninguna
        // tablet que se compre hoy para un taller.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            keyAlias = keyProperties["keyAlias"] as String?
            keyPassword = keyProperties["keyPassword"] as String?
            storeFile = keyProperties["storeFile"]?.let { rootProject.file(it) }
            storePassword = keyProperties["storePassword"] as String?
        }
    }

    buildTypes {
        release {
            // Sin keystore se cae a la firma de depuración para que el build
            // local siga funcionando; la CI comprueba que la APK publicada NO
            // salga firmada así.
            val keystoreFile = keyProperties["storeFile"]?.let { rootProject.file(it.toString()) }
            signingConfig = if (keyPropertiesFile.exists() && keystoreFile != null && keystoreFile.exists())
                signingConfigs.getByName("release")
            else
                signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
