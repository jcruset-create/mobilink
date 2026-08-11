import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

// Firma de la casa. El fichero lo escribe la CI a partir de los secrets y está
// en .gitignore: la clave privada nunca entra en el repositorio, que es público.
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (keyPropertiesFile.exists()) {
    keyProperties.load(FileInputStream(keyPropertiesFile))
}

android {
    // El applicationId es INMUTABLE una vez publicado (Play Store y también las
    // actualizaciones instaladas a mano): cambiarlo obligaría a desinstalar la
    // app de cada tablet. Se estrena con el dominio de Mobilink.
    namespace = "com.mobilink.taller"
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
        applicationId = "com.mobilink.taller"
        minSdk = flutter.minSdkVersion
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
