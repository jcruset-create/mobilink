plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Firma de release a partir de variables de entorno (las inyecta el workflow
// build-tyrecontrol-apk.yml desde los secrets del repositorio).
//
// El keystore NUNCA se commitea: este repositorio es público y con la clave
// privada cualquiera podría firmar un APK que Android aceptaría como
// actualización legítima de Mobilink TyreControl.
// Se normaliza a String no nulo: Project.file() espera un Any no nulo y con un
// String? el script de Gradle ni siquiera compila.
val rutaKeystore: String = System.getenv("MOBILINK_KEYSTORE_PATH") ?: ""
val hayFirmaPropia = rutaKeystore.isNotBlank() && file(rutaKeystore).exists()

if (!hayFirmaPropia) {
    // Se cae a la clave de debug para que `flutter run --release` siga
    // funcionando en local. Esa clave es distinta en cada máquina y en cada
    // runner de CI, así que un APK así firmado NO se instala encima de otro:
    // Android lo rechaza con "conflicto con un paquete".
    println(
        "AVISO: se firmará el release con la clave de DEBUG. " +
        "El APK no se podrá instalar sobre una versión anterior.",
    )
}

android {
    namespace = "com.seatarragona.tyrecontrol_app"
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
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.seatarragona.tyrecontrol_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hayFirmaPropia) {
            create("mobilink") {
                storeFile = file(rutaKeystore)
                storePassword = System.getenv("MOBILINK_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MOBILINK_KEY_ALIAS") ?: "mobilink"
                // El keystore se generó con la misma contraseña para el almacén
                // y para la clave; si algún día se separan, hará falta otra
                // variable.
                keyPassword = System.getenv("MOBILINK_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(
                if (hayFirmaPropia) "mobilink" else "debug",
            )
        }
    }
}

flutter {
    source = "../.."
}
