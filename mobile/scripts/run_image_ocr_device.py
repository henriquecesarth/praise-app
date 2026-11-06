"""Build the OCR test entry and run one device scenario with hard deadlines.

Uses only the offline preview package. This is not authenticated app acceptance.
Logs are local, under mobile/build/ocr-device/<scenario>/.
"""
import argparse
import base64
from pathlib import Path
import os
import subprocess
import sys


def run(command, cwd, output, timeout):
    with output.open('w', encoding='utf-8') as log:
        process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               capture_output=True, timeout=15)
            else:
                process.kill()
            process.wait(timeout=15)
            raise RuntimeError(f'Timeout after {timeout}s: {output}')
    if code:
        raise RuntimeError(f'Exit {code}: {output}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    parser.add_argument('--scenario', required=True,
                        choices=['large dark', 'compact dark', 'compact light', 'dense dark'])
    args = parser.parse_args()
    mobile = Path(__file__).resolve().parents[1]
    output = mobile / 'build' / 'ocr-device' / args.scenario.replace(' ', '-')
    output.mkdir(parents=True, exist_ok=True)
    adb = ['adb', '-s', args.serial]
    define = base64.b64encode(f'OCR_SCENARIO={args.scenario}'.encode()).decode()
    gradle = str(mobile / 'android' / ('gradlew.bat' if os.name == 'nt' else 'gradlew'))
    # Both APKs must use this target. Installing lib/main.dart then running the
    # integration runner leaves it waiting for a result that main never sends.
    run([gradle, 'app:assemblePreviewDebug', 'app:assemblePreviewDebugAndroidTest',
         '-Ptarget=integration_test/image_ocr_device_test.dart',
         f'-Pdart-defines={define}', '--console=plain'],
        mobile / 'android', output / 'build.log', 300)
    for name, apk in [
        ('app', 'apk/preview/debug/app-preview-debug.apk'),
        ('test', 'apk/androidTest/preview/debug/app-preview-debug-androidTest.apk'),
    ]:
        run(adb + ['install', '-r', str(mobile / 'build/app/outputs' / apk)],
            mobile, output / f'install-{name}.log', 60)
    run(adb + ['shell', 'am', 'force-stop', 'com.louvaio.app.preview'],
        mobile, output / 'stop.log', 15)
    try:
        run(adb + ['shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
                   'com.louvaio.louvaio_mobile.ImageOcrDeviceTest',
                   'com.louvaio.app.preview.test/androidx.test.runner.AndroidJUnitRunner'],
            mobile, output / 'instrumentation.log', 120)
    finally:
        try:
            run(adb + ['logcat', '-d', '-t', '2000', '-s',
                       'flutter', 'AndroidRuntime', 'TestRunner', 'FlutterTestRunner'],
                mobile, output / 'device.log', 20)
        finally:
            run(adb + ['shell', 'am', 'force-stop', 'com.louvaio.app.preview'],
                mobile, output / 'stop-after.log', 15)
        # Optional artifact capture must not prevent runner log collection.
        try:
            fixture = subprocess.run(adb + ['exec-out', 'run-as', 'com.louvaio.app.preview',
                                           'cat', f'code_cache/m20-{args.scenario.replace(" ", "-")}.png'],
                                     capture_output=True, timeout=20)
            if fixture.returncode == 0 and fixture.stdout.startswith(b'\x89PNG'):
                (output / 'fixture.png').write_bytes(fixture.stdout)
        except (OSError, subprocess.TimeoutExpired):
            (output / 'fixture-status.log').write_text('NOT_CAPTURED', encoding='utf-8')
    result = (output / 'instrumentation.log').read_text(encoding='utf-8')
    if ('OK (1 test)' not in result or 'FAILURES' in result
            or f'test=real bundled ML Kit OCR: {args.scenario}' not in result):
        raise RuntimeError(f'No successful device assertion: {output}')
    print(f'PASS: {args.scenario}; evidence: {output}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
