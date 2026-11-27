import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import '../../../../core/errors/app_failure.dart';
import '../../services/cifraclub_dom_capture.dart';

typedef CifraClubCaptureLauncher =
    Future<String?> Function(BuildContext, String);
// Experimental until repeated real-device imports are reliable.
final cifraClubDirectImportEnabledProvider = Provider<bool>((ref) => false);
final cifraClubCaptureLauncherProvider = Provider<CifraClubCaptureLauncher>((
  ref,
) {
  return (context, url) async {
    final uri = validateCifraClubCaptureUrl(url);
    for (var attempt = 0; attempt < 2; attempt++) {
      if (!context.mounted) return null;
      Future<bool>? released;
      final route = MaterialPageRoute<_CaptureOutcome>(
        builder: (_) => CifraClubCaptureScreen(
          url: uri,
          onRelease: (future) => released = future,
        ),
      );
      final result = await Navigator.of(context).push<_CaptureOutcome>(route);
      if (attempt == 0 && result?.retryableRendererStartup == true) {
        // Recreate only a renderer that never became ready. Await disposal of
        // its platform view; never retry source navigation or access denials.
        try {
          await route.completed.timeout(const Duration(seconds: 2));
          if (!await (released ?? Future.value(false))) {
            throw result!.error!;
          }
        } on TimeoutException {
          throw result!.error!;
        }
        if (!context.mounted || !(ModalRoute.of(context)?.isCurrent ?? false)) {
          return null;
        }
        if (kDebugMode) debugPrint('CIFRACLUB_RENDERER_STARTUP_RETRY=1');
        continue;
      }
      if (result?.error != null) throw result!.error!;
      return result?.html;
    }
    return null;
  };
});

class _CaptureOutcome {
  final String? html;
  final AppFailure? error;
  final bool retryableRendererStartup;
  const _CaptureOutcome({
    this.html,
    this.error,
    this.retryableRendererStartup = false,
  });
}

/// A real, full-size platform view is rendered underneath an opaque application
/// surface. Neither pointer input nor semantics expose the source website.
class CifraClubCaptureScreen extends StatefulWidget {
  final Uri url;
  final void Function(Future<bool>)? onRelease;
  const CifraClubCaptureScreen({super.key, required this.url, this.onRelease});
  @override
  State<CifraClubCaptureScreen> createState() => _CaptureState();
}

class _CaptureState extends State<CifraClubCaptureScreen> {
  late final WebViewController controller;
  Timer? poll;
  Timer? deadline;
  Completer<void>? rendererReady;
  bool ended = false;
  bool loadingSource = false;
  bool sourceStarted = false;
  bool evaluating = false;
  bool viewReady = false;

  @override
  void initState() {
    super.initState();
    validateCifraClubCaptureUrl(widget.url.toString());
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(start()));
  }

  bool get current =>
      mounted && !ended && (ModalRoute.of(context)?.isCurrent ?? false);
  void stop() {
    ended = true;
    poll?.cancel();
    deadline?.cancel();
  }

  void cancel() {
    if (!current) return;
    stop();
    Navigator.of(context).pop();
  }

  void finish({
    String? html,
    String? message,
    String code = 'CIFRACLUB_CAPTURE_FAILED',
  }) {
    if (!current) return;
    if (kDebugMode && message != null) {
      debugPrint('CIFRACLUB_CAPTURE_ERROR=$code');
    }
    stop();
    Navigator.of(context).pop(
      _CaptureOutcome(
        html: html,
        retryableRendererStartup:
            !loadingSource && code == 'CIFRACLUB_RENDERER_UNAVAILABLE',
        error: message == null
            ? null
            : AppFailure(message: message, code: code),
      ),
    );
  }

  Future<void> start() async {
    if (!current) return;
    // The first Flutter frame can precede Android's nonzero viewport. Do not
    // construct a native WebView or start its timer while the host is unready.
    deadline = Timer(
      const Duration(seconds: 5),
      () => finish(
        message: 'A tela de importação não ficou pronta. Tente novamente.',
        code: 'CIFRACLUB_HOST_NOT_READY',
      ),
    );
    while (current) {
      if (!mounted) return;
      final box = context.findRenderObject();
      final lifecycle = WidgetsBinding.instance.lifecycleState;
      final animation = ModalRoute.of(context)?.animation;
      if (box is RenderBox &&
          box.hasSize &&
          box.size.width > 0 &&
          box.size.height > 0 &&
          (lifecycle == null || lifecycle == AppLifecycleState.resumed) &&
          (animation == null || animation.isCompleted)) {
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    if (!current) return;
    deadline?.cancel();
    deadline = Timer(
      const Duration(seconds: 15),
      () => finish(
        message: 'O componente de importação não respondeu. Tente novamente.',
        code: 'CIFRACLUB_RENDERER_UNAVAILABLE',
      ),
    );
    try {
      controller = WebViewController();
      setState(() => viewReady = true);
      await WidgetsBinding.instance.endOfFrame.timeout(
        const Duration(seconds: 2),
      );
      if (!mounted || !current) return;
      if (kDebugMode) {
        final box = context.findRenderObject();
        if (box is RenderBox && box.hasSize) {
          debugPrint(
            'CIFRACLUB_RENDERER_VIEWPORT=${box.size.width}x${box.size.height}',
          );
        }
      }
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      if (!current) return;
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (!current) return NavigationDecision.prevent;
            final allowed = loadingSource
                ? request.url == widget.url.toString()
                : request.url == 'about:blank' ||
                      request.url.startsWith('data:text/html');
            if (!allowed && request.isMainFrame) {
              finish(
                message:
                    'A origem solicitou outro endereço; importação interrompida.',
                code: 'CIFRACLUB_REDIRECT_BLOCKED',
              );
            }
            return allowed
                ? NavigationDecision.navigate
                : NavigationDecision.prevent;
          },
          onPageFinished: (url) {
            if (!current) return;
            if (!loadingSource &&
                (url == 'about:blank' || url.startsWith('data:text/html'))) {
              if (rendererReady?.isCompleted == false) {
                rendererReady!.complete();
              }
            } else if (loadingSource && url == widget.url.toString()) {
              sourceStarted = true;
              unawaited(capture());
            }
          },
          onPageStarted: (url) {
            if (kDebugMode && current) {
              debugPrint(
                'CIFRACLUB_PAGE_STARTED=${loadingSource ? "source" : "local"}',
              );
            }
            if (current && loadingSource && url == widget.url.toString()) {
              sourceStarted = true;
            }
          },
          onHttpError: (error) {
            if (current &&
                error.request?.uri.toString() == widget.url.toString()) {
              finish(
                message:
                    'A origem respondeu HTTP ${error.response?.statusCode ?? "desconhecido"}. Importação interrompida.',
                code: 'CIFRACLUB_ACCESS_RESTRICTED',
              );
            }
          },
          onHttpAuthRequest: (request) {
            request.onCancel();
            finish(
              message: 'A origem exige autenticação. Importação interrompida.',
              code: 'CIFRACLUB_ACCESS_RESTRICTED',
            );
          },
          onWebResourceError: (error) {
            if (current && error.isForMainFrame == true) {
              finish(
                message:
                    'Não foi possível carregar a cifra. Verifique sua conexão e tente novamente.',
                code: 'CIFRACLUB_NETWORK_ERROR',
              );
            }
          },
        ),
      );
      if (!current) return;
      rendererReady = Completer<void>();
      await controller.loadHtmlString(
        '<!doctype html><html><body style="background:#ffffff"><span id="louvaio-ready" style="display:none">ready</span></body></html>',
      );
      await rendererReady!.future.timeout(const Duration(seconds: 8));
      if (!current) return;
      final ready = await controller
          .runJavaScriptReturningResult(
            '!!document.getElementById("louvaio-ready")',
          )
          .timeout(const Duration(seconds: 2));
      if (ready != true) throw StateError('Renderer not ready');
      if (kDebugMode) debugPrint('CIFRACLUB_RENDERER_READY=true');
      deadline?.cancel();
      // Permit the native renderer's first draw on a blank local document.
      // Only then install the opaque cover, before any source navigation.
      setState(() => loadingSource = true);
      await WidgetsBinding.instance.endOfFrame.timeout(
        const Duration(seconds: 2),
      );
      if (!current) return;
      deadline = Timer(
        const Duration(seconds: 45),
        () => finish(
          message: 'A cifra não ficou disponível a tempo. Tente novamente.',
          code: 'CIFRACLUB_TIMEOUT',
        ),
      );
      await controller.loadRequest(widget.url);
      if (!current) return;
      poll = Timer.periodic(
        const Duration(milliseconds: 500),
        (_) => unawaited(capture()),
      );
    } on TimeoutException {
      finish(
        message: 'O componente de importação não respondeu. Tente novamente.',
        code: 'CIFRACLUB_RENDERER_UNAVAILABLE',
      );
    } catch (error) {
      if (kDebugMode) debugPrint('CIFRACLUB_SETUP_ERROR=${error.runtimeType}');
      finish(
        message: 'Não foi possível preparar a importação. Tente novamente.',
      );
    }
  }

  Future<void> capture() async {
    if (!current || !loadingSource || !sourceStarted || evaluating) return;
    evaluating = true;
    try {
      final url = await controller.currentUrl().timeout(
        const Duration(seconds: 2),
      );
      if (!current) return;
      if (url != widget.url.toString()) {
        finish(
          message: 'A página mudou de endereço. Importação interrompida.',
          code: 'CIFRACLUB_REDIRECT_BLOCKED',
        );
        return;
      }
      final value = await controller
          .runJavaScriptReturningResult(cifraClubMusicalDomScript)
          .timeout(const Duration(seconds: 3));
      if (!current) return;
      final decoded = value is String ? jsonDecode(value) : value;
      final data =
          (decoded is String ? jsonDecode(decoded) : decoded)
              as Map<String, dynamic>;
      if (data['blocked'] == true) {
        finish(
          message:
              'A origem restringiu o acesso ou exige verificação. Importação interrompida.',
          code: 'CIFRACLUB_ACCESS_RESTRICTED',
        );
      } else if (data['unsupported'] == true || data['oversized'] == true) {
        finish(message: 'O formato ou tamanho desta cifra não é suportado.');
      } else if (data['ready'] == true && data['html'] is String) {
        finish(html: data['html'] as String);
      }
    } on TimeoutException {
      finish(
        message: 'O componente de leitura não respondeu. Tente novamente.',
        code: 'CIFRACLUB_RENDERER_UNAVAILABLE',
      );
    } catch (error) {
      if (kDebugMode) debugPrint('CIFRACLUB_DOM_ERROR=${error.runtimeType}');
      finish(message: 'Não foi possível ler o conteúdo musical desta página.');
    } finally {
      evaluating = false;
    }
  }

  @override
  void dispose() {
    stop();
    final released = releaseNativeView();
    widget.onRelease?.call(released);
    // No global provider restart, cookie transfer or device reboot.
    super.dispose();
  }

  Future<bool> releaseNativeView() async {
    if (!viewReady || controller.platform is! AndroidWebViewController) {
      return true;
    }
    try {
      final platform = controller.platform as AndroidWebViewController;
      final released =
          await const MethodChannel('com.louvaio.louvaio_mobile/share_intent')
              .invokeMethod<bool>('releaseCapturedWebView', {
                'identifier': platform.webViewIdentifier,
              })
              .timeout(const Duration(seconds: 2));
      if (kDebugMode) debugPrint('CIFRACLUB_NATIVE_VIEW_RELEASED=$released');
      return released == true;
    } catch (error) {
      if (kDebugMode) {
        debugPrint('CIFRACLUB_NATIVE_RELEASE_ERROR=${error.runtimeType}');
      }
      return false;
    }
  }

  @override
  Widget build(BuildContext context) => PopScope<_CaptureOutcome>(
    onPopInvokedWithResult: (didPop, result) {
      if (didPop) stop();
    },
    child: Scaffold(
      appBar: AppBar(title: const Text('Importando cifra...')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (viewReady)
            ExcludeSemantics(
              child: IgnorePointer(
                child: WebViewWidget.fromPlatformCreationParams(
                  params: AndroidWebViewWidgetCreationParams(
                    controller: controller.platform,
                    displayWithHybridComposition: true,
                  ),
                ),
              ),
            ),
          Positioned.fill(
            child: Material(
              color: loadingSource
                  ? Theme.of(context).scaffoldBackgroundColor
                  : Colors.transparent,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 16),
                    const Text('Importando cifra...'),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: cancel,
                      child: const Text('Cancelar'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
