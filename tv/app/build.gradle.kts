plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "app.korie.tv"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.korie.tv"
        minSdk = 23
        targetSdk = 35
        // GitHub Actions sets these (the run number), so every release is newer than the one before
        versionCode = (System.getenv("KORIE_TV_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("KORIE_TV_VERSION") ?: "0.2.0-dev"
        // where the app looks for its updates (another address only for testing)
        buildConfigField("String", "UPDATES", "\"" + (System.getenv("KORIE_TV_UPDATES") ?: "https://github.com/MightyX3N/Korie/releases/latest/download/") + "\"")
    }
    // Korie's own signing key (KORIE_TV_KEYSTORE, a file, and KORIE_TV_KEYSTORE_PASSWORD), the same for
    // every build, so a new version installs over the old one. Without it: the debug key (local tests only).
    val keystore = System.getenv("KORIE_TV_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (keystore != null) create("korie") {
            storeFile = keystore
            storePassword = System.getenv("KORIE_TV_KEYSTORE_PASSWORD")
            keyAlias = "korie"
            keyPassword = System.getenv("KORIE_TV_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("korie") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.tv:tv-material:1.0.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
