package com.louvaio.louvaio_mobile

import androidx.test.rule.ActivityTestRule
import dev.flutter.plugins.integration_test.FlutterTestRunner
import org.junit.Rule
import org.junit.runner.RunWith

/** Runs the Dart OCR integration entry without a network/VM-service permission. */
@RunWith(FlutterTestRunner::class)
class ImageOcrDeviceTest {
    @Rule
    @JvmField
    val rule = ActivityTestRule(MainActivity::class.java, true, false)
}
