import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}

android {
    namespace = "com.louvaio.louvaio_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.louvaio.app"
        minSdk = maxOf(flutter.minSdkVersion, 23)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "environment"
    productFlavors {
        create("production") {
            dimension = "environment"
            applicationId = "com.louvaio.app"
        }
        create("preview") {
            dimension = "environment"
            applicationId = "com.louvaio.app.preview"
        }
        create("staging") {
            dimension = "environment"
            applicationId = "com.louvaio.app.staging"
        }
        create("qa") {
            dimension = "environment"
            applicationId = "com.louvaio.app.qa"
        }
        create("cifraProbe") {
            dimension = "environment"
            applicationId = "com.louvaio.app.cifraprobe"
        }
        create("vocal") {
            dimension = "environment"
            applicationId = "com.louvaio.app.m21vocal"
        }
    }


    signingConfigs {
        create("release") {
            val keyAliasProp = keystoreProperties.getProperty("keyAlias")
            val keyPasswordProp = keystoreProperties.getProperty("keyPassword")
            val storeFileProp = keystoreProperties.getProperty("storeFile")
            val storePasswordProp = keystoreProperties.getProperty("storePassword")

            if (keyAliasProp != null && keyPasswordProp != null && storeFileProp != null && storePasswordProp != null) {
                keyAlias = keyAliasProp
                keyPassword = keyPasswordProp
                storeFile = file(storeFileProp)
                storePassword = storePasswordProp
            }
        }
    }

    buildTypes {
        release {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null && releaseSigning.storeFile!!.exists()) {
                signingConfig = releaseSigning
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

// Local WebView investigation and dart-define-configured staging/qa flavors
// allow building without a flavor-specific google-services.json when absent.
tasks.configureEach {
    if ((name.startsWith("processCifraProbe") || name.startsWith("processVocal")) && name.endsWith("GoogleServices")) {
        enabled = false
    }
    if (name.startsWith("processStaging") && name.endsWith("GoogleServices")) {
        enabled = file("src/staging/google-services.json").exists()
    }
}

gradle.taskGraph.whenReady {
    val isReleaseBuild = allTasks.any { task ->
        val name = task.name.lowercase()
        name.contains("release") && (name.contains("assemble") || name.contains("bundle") || name.contains("package"))
    }
    if (isReleaseBuild) {
        val releaseSigning = android.signingConfigs.getByName("release")
        if (releaseSigning.storeFile == null || !releaseSigning.storeFile!!.exists()) {
            throw GradleException(
                "Release build failed: Missing or incomplete release signing configuration in android/key.properties. " +
                "Ensure storeFile, storePassword, keyAlias, and keyPassword are properly specified and the keystore exists."
            )
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

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013")
    // Match integration_test's runtime versions (AGP consistent resolution).
    androidTestImplementation("androidx.test:runner:1.3.0")
    androidTestImplementation("androidx.test:rules:1.2.0")
}
