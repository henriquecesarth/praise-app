import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/cifraclub_capture_screen.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';

const _sourceUrl = 'https://cifraclub.com.br/artista/minha-musica/';

class _Recorder {
  final List<String?> results = [];
  final List<Object> errors = [];
  int simulatedApiCalls = 0;
}

Widget _host(_Recorder recorder) => ProviderScope(
  child: MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            key: const Key('open-capture'),
            onPressed: () async {
              final launcher = ProviderScope.containerOf(
                context,
              ).read(cifraClubCaptureLauncherProvider);
              try {
                final html = await launcher(context, _sourceUrl);
                recorder.results.add(html);
                if (html != null) recorder.simulatedApiCalls++;
              } catch (error) {
                recorder.errors.add(error);
              }
            },
            child: const Text('Open capture'),
          ),
        ),
      ),
    ),
  ),
);

class _FakeWebViewPlatform extends WebViewPlatform {
  _FakeWebViewController? controller;
  _FakeNavigationDelegate? navigationDelegate;
  int controllerCreationCount = 0;
  int sourceRequestCount = 0;
  bool finishRendererLoad = true;
  bool finishSourceLoad = false;
  final List<Object> domResults = [];
  Completer<Object>? pendingDomResult;
  int domEvaluationCount = 0;

  @override
  PlatformWebViewController createPlatformWebViewController(
    PlatformWebViewControllerCreationParams params,
  ) {
    controllerCreationCount++;
    final created = _FakeWebViewController(params, this);
    controller = created;
    return created;
  }

  @override
  PlatformNavigationDelegate createPlatformNavigationDelegate(
    PlatformNavigationDelegateCreationParams params,
  ) {
    final created = _FakeNavigationDelegate(params);
    navigationDelegate = created;
    return created;
  }

  @override
  PlatformWebViewWidget createPlatformWebViewWidget(
    PlatformWebViewWidgetCreationParams params,
  ) => _FakeWebViewWidget(params);
}

class _FakeNavigationDelegate extends PlatformNavigationDelegate {
  _FakeNavigationDelegate(PlatformNavigationDelegateCreationParams params)
    : super.implementation(params);

  NavigationRequestCallback? navigationRequest;
  PageEventCallback? pageStarted;
  PageEventCallback? pageFinished;
  WebResourceErrorCallback? webResourceError;
  HttpResponseErrorCallback? httpError;
  HttpAuthRequestCallback? httpAuthRequest;

  @override
  Future<void> setOnNavigationRequest(
    NavigationRequestCallback callback,
  ) async => navigationRequest = callback;

  @override
  Future<void> setOnPageStarted(PageEventCallback callback) async =>
      pageStarted = callback;

  @override
  Future<void> setOnPageFinished(PageEventCallback callback) async =>
      pageFinished = callback;

  @override
  Future<void> setOnHttpError(HttpResponseErrorCallback callback) async =>
      httpError = callback;

  @override
  Future<void> setOnWebResourceError(WebResourceErrorCallback callback) async =>
      webResourceError = callback;

  @override
  Future<void> setOnHttpAuthRequest(HttpAuthRequestCallback callback) async =>
      httpAuthRequest = callback;
}

class _FakeWebViewController extends PlatformWebViewController {
  _FakeWebViewController(
    PlatformWebViewControllerCreationParams params,
    this.owner,
  ) : super.implementation(params);

  final _FakeWebViewPlatform owner;
  PlatformNavigationDelegate? delegate;
  String? activeUrl;

  @override
  Future<void> setPlatformNavigationDelegate(
    PlatformNavigationDelegate handler,
  ) async => delegate = handler;

  _FakeNavigationDelegate get callbacks => owner.navigationDelegate!;

  @override
  Future<void> setJavaScriptMode(JavaScriptMode javaScriptMode) async {}

  @override
  Future<void> loadHtmlString(String html, {String? baseUrl}) async {
    if (owner.finishRendererLoad) {
      callbacks.pageFinished?.call('about:blank');
    }
  }

  @override
  Future<void> loadRequest(LoadRequestParams params) async {
    owner.sourceRequestCount++;
    activeUrl = params.uri.toString();
    callbacks.pageStarted?.call(activeUrl!);
    if (owner.finishSourceLoad) callbacks.pageFinished?.call(activeUrl!);
  }

  @override
  Future<String?> currentUrl() async => activeUrl;

  @override
  Future<Object> runJavaScriptReturningResult(String javaScript) {
    if (javaScript == '!!document.getElementById("louvaio-ready")') {
      return Future<Object>.value(true);
    }
    owner.domEvaluationCount++;
    if (owner.pendingDomResult != null) {
      return owner.pendingDomResult!.future;
    }
    if (owner.domResults.isNotEmpty) {
      return Future<Object>.value(owner.domResults.removeAt(0));
    }
    return Future<Object>.value(<String, dynamic>{'ready': false});
  }
}

class _FakeWebViewWidget extends PlatformWebViewWidget {
  _FakeWebViewWidget(PlatformWebViewWidgetCreationParams params)
    : super.implementation(params);

  @override
  Widget build(BuildContext context) =>
      Container(key: const Key('fake-renderer'), color: Colors.green);
}

void main() {
  late _FakeWebViewPlatform platform;
  WebViewPlatform? originalPlatform;

  setUp(() {
    originalPlatform = WebViewPlatform.instance;
    platform = _FakeWebViewPlatform();
    WebViewPlatform.instance = platform;
  });

  tearDown(() {
    if (originalPlatform != null) WebViewPlatform.instance = originalPlatform!;
  });

  Future<void> openCapture(WidgetTester tester, _Recorder recorder) async {
    final existingControllerCount = platform.controllerCreationCount;
    await tester.pumpWidget(_host(recorder));
    await tester.tap(find.byKey(const Key('open-capture')));
    await tester.pump();
    expect(
      platform.controllerCreationCount,
      existingControllerCount,
      reason: 'The native renderer must wait for the route transition.',
    );
    for (var frame = 0;
        frame < 20 &&
            platform.controllerCreationCount == existingControllerCount;
        frame++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.pump();
    expect(platform.controllerCreationCount, existingControllerCount + 1);
  }

  Future<void> beginSource(WidgetTester tester, _Recorder recorder) async {
    await openCapture(tester, recorder);
    platform.navigationDelegate!.pageFinished?.call('about:blank');
    await tester.pump();
    expect(recorder.errors, isEmpty, reason: '${recorder.errors}');
    expect(platform.controller?.activeUrl, _sourceUrl);
  }

  testWidgets(
    'mounts a nonzero renderer beneath opaque progress and polls DOM readiness',
    (tester) async {
      platform.domResults.addAll([
        <String, dynamic>{'ready': false},
        <String, dynamic>{'ready': true, 'html': '<pre>captured</pre>'},
      ]);
      final recorder = _Recorder();
      await beginSource(tester, recorder);

      final rendererSize = tester.getSize(
        find.byKey(const Key('fake-renderer')),
      );
      expect(rendererSize.width, greaterThan(0));
      expect(rendererSize.height, greaterThan(0));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      final overlay = tester.widget<Material>(
        find
            .ancestor(
              of: find.byType(CircularProgressIndicator),
              matching: find.byType(Material),
            )
            .first,
      );
      expect(overlay.color!.alpha, 0xff);

      platform.navigationDelegate!.pageFinished?.call(_sourceUrl);
      await tester.pump();
      expect(platform.domEvaluationCount, 1);
      expect(recorder.results, isEmpty);

      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump();
      expect(platform.domEvaluationCount, 2);
      expect(recorder.results, ['<pre>captured</pre>']);
      expect(recorder.errors, isEmpty);
    },
  );

  testWidgets(
    'renderer startup gets at most two bounded attempts and never loads source',
    (tester) async {
      platform.finishRendererLoad = false;
      final recorder = _Recorder();
      await openCapture(tester, recorder);

      for (var frame = 0;
          frame < 240 && platform.controllerCreationCount < 2;
          frame++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(platform.controllerCreationCount, 2);
      for (var frame = 0; frame < 240 && recorder.errors.isEmpty; frame++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(recorder.results, isEmpty);
      expect(recorder.errors.single, isA<AppFailure>());
      expect(
        (recorder.errors.single as AppFailure).code,
        'CIFRACLUB_RENDERER_UNAVAILABLE',
      );
      expect(platform.controller?.activeUrl, isNull);
      expect(platform.controllerCreationCount, 2);
      expect(platform.sourceRequestCount, 0);
      expect(platform.domEvaluationCount, 0);
      expect(
        find.text('Open capture'),
        findsOneWidget,
        reason:
            'The capture route should have returned after the renderer timeout.',
      );
    },
  );

  testWidgets('paused host times out without mounting or retrying renderer', (
    tester,
  ) async {
    final recorder = _Recorder();
    await tester.pumpWidget(_host(recorder));
    await tester.tap(find.byKey(const Key('open-capture')));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);

    await tester.pump(const Duration(seconds: 6));
    await tester.pump();

    expect(recorder.results, isEmpty);
    expect(recorder.errors.single, isA<AppFailure>());
    expect(
      (recorder.errors.single as AppFailure).code,
      'CIFRACLUB_HOST_NOT_READY',
    );
    expect(platform.controllerCreationCount, 0);
    expect(platform.sourceRequestCount, 0);
    expect(recorder.simulatedApiCalls, 0);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  });

  testWidgets('HTTP 403 and authentication requests fail closed', (
    tester,
  ) async {
    final recorder = _Recorder();
    await beginSource(tester, recorder);

    platform.navigationDelegate!.httpError?.call(
      HttpResponseError(
        request: WebResourceRequest(uri: Uri.parse(_sourceUrl)),
        response: WebResourceResponse(
          uri: Uri.parse(_sourceUrl),
          statusCode: 403,
        ),
      ),
    );
    await tester.pump();

    expect(recorder.results, isEmpty);
    expect(recorder.errors.single, isA<AppFailure>());
    expect(
      (recorder.errors.single as AppFailure).code,
      'CIFRACLUB_ACCESS_RESTRICTED',
    );
    expect(platform.controllerCreationCount, 1);
    expect(platform.sourceRequestCount, 1);

    await openCapture(tester, recorder);
    var cancelledAuth = false;
    platform.navigationDelegate!.httpAuthRequest?.call(
      HttpAuthRequest(
        host: 'cifraclub.com.br',
        onProceed: (_) {},
        onCancel: () => cancelledAuth = true,
      ),
    );
    await tester.pump();

    expect(cancelledAuth, isTrue);
    expect(recorder.errors, hasLength(2));
    expect(
      (recorder.errors.last as AppFailure).code,
      'CIFRACLUB_ACCESS_RESTRICTED',
    );
    expect(platform.controllerCreationCount, 2);
    expect(platform.sourceRequestCount, 2);
    expect(recorder.simulatedApiCalls, 0);
  });

  testWidgets('main-frame redirect is prevented and capture fails closed', (
    tester,
  ) async {
    final recorder = _Recorder();
    await beginSource(tester, recorder);

    final decision = await platform.navigationDelegate!.navigationRequest!(
      const NavigationRequest(
        url: 'https://example.invalid/elsewhere/',
        isMainFrame: true,
      ),
    );
    await tester.pump();

    expect(decision, NavigationDecision.prevent);
    expect(recorder.results, isEmpty);
    expect(recorder.errors.single, isA<AppFailure>());
    expect(
      (recorder.errors.single as AppFailure).code,
      'CIFRACLUB_REDIRECT_BLOCKED',
    );
    expect(platform.controllerCreationCount, 1);
    expect(platform.sourceRequestCount, 1);
    expect(recorder.simulatedApiCalls, 0);
  });

  testWidgets('cancel and back ignore late JavaScript results', (tester) async {
    final recorder = _Recorder();
    for (final useBack in [false, true]) {
      final pending = Completer<Object>();
      platform.pendingDomResult = pending;
      await beginSource(tester, recorder);
      platform.navigationDelegate!.pageFinished?.call(_sourceUrl);
      await tester.pump();
      expect(platform.domEvaluationCount, useBack ? 2 : 1);

      if (useBack) {
        await tester.binding.handlePopRoute();
      } else {
        await tester.tap(find.text('Cancelar'));
      }
      await tester.pump();
      pending.complete(<String, dynamic>{
        'ready': true,
        'html': '<pre>late result</pre>',
      });
      await tester.pump();

      expect(recorder.results, hasLength(useBack ? 2 : 1));
      expect(recorder.results.last, isNull);
      expect(recorder.simulatedApiCalls, 0);
      expect(platform.controllerCreationCount, useBack ? 2 : 1);
      expect(platform.sourceRequestCount, useBack ? 2 : 1);
    }
  });

  testWidgets('JavaScript timeout does not overlap periodic evaluations', (
    tester,
  ) async {
    final pending = Completer<Object>();
    platform.pendingDomResult = pending;
    final recorder = _Recorder();
    await beginSource(tester, recorder);
    platform.navigationDelegate!.pageFinished?.call(_sourceUrl);
    await tester.pump();

    await tester.pump(const Duration(milliseconds: 1500));
    expect(platform.domEvaluationCount, 1);
    await tester.pump(const Duration(milliseconds: 1700));
    await tester.pump();

    expect(platform.domEvaluationCount, 1);
    expect(recorder.results, isEmpty);
    expect(recorder.errors.single, isA<AppFailure>());
    expect(
      (recorder.errors.single as AppFailure).code,
      'CIFRACLUB_RENDERER_UNAVAILABLE',
    );
    expect(platform.controllerCreationCount, 1);
    expect(platform.sourceRequestCount, 1);
    pending.complete(<String, dynamic>{'ready': false});
    await tester.pump();
    expect(recorder.simulatedApiCalls, 0);
  });

  testWidgets('source deadline does not remount the renderer', (tester) async {
    final recorder = _Recorder();
    await beginSource(tester, recorder);

    await tester.pump(const Duration(seconds: 46));
    await tester.pump();

    expect(recorder.results, isEmpty);
    expect(recorder.errors.single, isA<AppFailure>());
    expect((recorder.errors.single as AppFailure).code, 'CIFRACLUB_TIMEOUT');
    expect(platform.controllerCreationCount, 1);
    expect(platform.sourceRequestCount, 1);
    expect(recorder.simulatedApiCalls, 0);
  });
}
