pluginManagement {
    val flutterSdkPath = run {
        val properties = java.util.Properties()
        file("local.properties").inputStream().use { properties.load(it) }
        val flutterSdkPath = properties.getProperty("flutter.sdk")
        require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
        flutterSdkPath
    }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

// Flutter 3.47 exige Gradle >= 8.14.0, AGP >= 8.11.1 y Kotlin >= 2.2.20: por
// debajo de cualquiera de las tres, el plugin dev.flutter.flutter-gradle-plugin
// aborta el build. Las tres van juntas — el plugin las valida de una en una, y
// subir solo una deja el build fallando en el control siguiente.
plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}

include(":app")
