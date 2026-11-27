plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "io.github.mightyx3n.korie"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "io.github.mightyx3n.korie"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Korie's own key, the same one the earlier Korie releases used, so new
    // builds install over old ones. The key file is not in git; set
    // KORIE_KEYSTORE (path) or put it at android/korie.keystore.
    signingConfigs {
        create("korie") {
            storeFile = file(System.getenv("KORIE_KEYSTORE") ?: "../korie.keystore")
            storePassword = System.getenv("KORIE_KEYSTORE_PASS") ?: "android"
            keyAlias = System.getenv("KORIE_KEY_ALIAS") ?: "debug"
            keyPassword = System.getenv("KORIE_KEY_PASS") ?: "android"
        }
    }

    buildTypes {
        release {
            signingConfig = if (file(System.getenv("KORIE_KEYSTORE") ?: "../korie.keystore").exists())
                signingConfigs.getByName("korie") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
