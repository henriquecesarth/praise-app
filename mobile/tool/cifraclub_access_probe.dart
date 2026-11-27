import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() => runApp(const MaterialApp(home: CifraClubAccessProbe()));

class CifraClubAccessProbe extends StatefulWidget {
  const CifraClubAccessProbe({super.key});
  @override
  State<CifraClubAccessProbe> createState() => _ProbeState();
}

class _ProbeState extends State<CifraClubAccessProbe> {
  static const control = 'https://example.com/';
  static const cifra = 'https://www.cifraclub.com.br/projeto-sola/glorificar/';
  late final WebViewController controller;
  final results = <Map<String, Object?>>[];
  Map<String, Object?>? active;
  Completer<void>? completion;
  bool initialized = false;
  bool widgetMounted = false;
  String status = 'Creating controller';
  String expected = 'about:blank';
  @override
  void initState() {
    super.initState();
    controller = WebViewController();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widgetMounted = mounted;
      unawaited(run());
    });
  }

  void phase(String value) {
    debugPrint('CIFRA_PROBE_PHASE=$value');
    if (mounted) setState(() => status = value);
  }

  void complete() {
    if (completion?.isCompleted == false) completion!.complete();
  }

  String safeUrl(String? value) {
    if (value == 'about:blank' || value == control || value == cifra) {
      return value!;
    }
    if (value?.startsWith('data:text/html') == true) {
      return 'data:text/html (local)';
    }
    return value == null ? 'Unknown / Not yet verified' : 'UNEXPECTED_URL';
  }

  Future<void> run() async {
    try {
      phase('configuring_javascript');
      await controller
          .setJavaScriptMode(JavaScriptMode.unrestricted)
          .timeout(const Duration(seconds: 10));
      phase('configuring_delegate');
      await controller
          .setNavigationDelegate(
            NavigationDelegate(
              onNavigationRequest: (request) {
                final allowed = expected == 'about:blank'
                    ? request.url == 'about:blank' ||
                          request.url.startsWith('data:text/html')
                    : request.url == expected;
                (active?['navigation_requests'] as List<Object?>?)?.add({
                  'url': safeUrl(request.url),
                  'main_frame': request.isMainFrame,
                  'decision': allowed ? 'navigate' : 'prevent',
                });
                if (request.isMainFrame && !allowed) {
                  active?['blocked_navigation'] = true;
                  complete();
                }
                return allowed || !request.isMainFrame
                    ? NavigationDecision.navigate
                    : NavigationDecision.prevent;
              },
              onPageStarted: (url) {
                active?['page_started'] = safeUrl(url);
              },
              onProgress: (value) {
                final values = active?['progress'] as List<int>?;
                if (values != null &&
                    (values.isEmpty || values.last != value)) {
                  values.add(value);
                }
              },
              onPageFinished: (url) {
                active?['page_finished'] = safeUrl(url);
                complete();
              },
              onUrlChange: (change) {
                active?['url_change'] = safeUrl(change.url);
              },
              onHttpError: (error) {
                if (error.request?.uri.toString() == expected) {
                  active?['http_status'] = error.response?.statusCode;
                  complete();
                }
              },
              onHttpAuthRequest: (request) {
                request.onCancel();
                active?['authentication_required'] = true;
                complete();
              },
              onWebResourceError: (error) {
                if (error.isForMainFrame == true) {
                  active?['main_error'] = {
                    'code': error.errorCode,
                    'type': error.errorType?.name,
                    'net_error': RegExp(
                      r'net::ERR_[A-Z_]+',
                    ).firstMatch(error.description)?.group(0),
                  };
                  complete();
                }
              },
            ),
          )
          .timeout(const Duration(seconds: 10));
      initialized = true;
      phase('controller_ready_widget_mounted');
      const only = String.fromEnvironment('CIFRA_PROBE_CASE');
      for (final scenario in ['A_LOCAL_HTML', 'B_CONTROL_URL', 'C_CIFRACLUB']) {
        if (only.isNotEmpty && !scenario.startsWith(only)) continue;
        if (!mounted) return;
        await navigate(scenario);
      }
    } catch (error) {
      phase('initialization_failed');
      debugPrint(
        'CIFRA_PROBE_INITIALIZATION=${jsonEncode({'initialized': initialized, 'widget_mounted': widgetMounted, 'error_type': error.runtimeType.toString()})}',
      );
    }
    active = null;
    phase('sequence_finished');
    debugPrint('CIFRA_PROBE_RESULTS=${jsonEncode(results)}');
  }

  Future<void> navigate(String scenario) async {
    expected = scenario.startsWith('A')
        ? 'about:blank'
        : scenario.startsWith('B')
        ? control
        : cifra;
    final watch = Stopwatch()..start();
    final record = <String, Object?>{
      'scenario': scenario,
      'initialized': initialized,
      'widget_mounted': widgetMounted,
      'requested_url': expected,
      'navigation_requests': <Object?>[],
      'progress': <int>[],
      'page_started': null,
      'page_finished': null,
      'http_status': scenario.startsWith('A')
          ? 'NOT_APPLICABLE_LOCAL_HTML'
          : 'Unknown / Not yet verified',
      'load_called': false,
      'load_returned': false,
      'timeout': false,
    };
    active = record;
    completion = Completer<void>();
    phase('${scenario}_load');
    try {
      record['load_called'] = true;
      if (scenario.startsWith('A')) {
        await controller
            .loadHtmlString(
              '<!doctype html><html><head><title>LouvAIO local</title></head><body><h1 id="probe-local">LOCAL_HTML_OK</h1></body></html>',
            )
            .timeout(const Duration(seconds: 10));
      } else {
        await controller
            .loadRequest(Uri.parse(expected))
            .timeout(const Duration(seconds: 10));
      }
      record['load_returned'] = true;
      await completion!.future.timeout(const Duration(seconds: 45));
    } on TimeoutException {
      record['timeout'] = true;
    } catch (error) {
      record['exception_type'] = error.runtimeType.toString();
    }
    record['elapsed_ms'] = watch.elapsedMilliseconds;
    try {
      record['final_url'] = safeUrl(
        await controller.currentUrl().timeout(const Duration(seconds: 3)),
      );
      final raw = await controller
          .runJavaScriptReturningResult(r'''JSON.stringify((() => {
        const restricted = !!document.querySelector('#challenge-form, .g-recaptcha, iframe[src*="captcha"]') ||
          /access denied|just a moment|verify you are human|captcha|403 forbidden/i.test(document.title);
        const pre = document.querySelectorAll('.cifra_cnt pre, pre.js-tab-content');
        return {ready_state:document.readyState, title:document.title.slice(0,160),
          local_marker:!!document.querySelector('#probe-local'),
          response_status:performance.getEntriesByType('navigation')[0]?.responseStatus || null,
          access_restricted:restricted, all_pre_count:document.querySelectorAll('pre').length,
          musical_pre_count:pre.length, music_characters:!restricted && pre.length===1 ? pre[0].textContent.length : 0,
          chord_nodes:!restricted && pre.length===1 ? pre[0].querySelectorAll('b').length : 0,
          song_title:document.querySelector('h1.t1')?.textContent.trim() || null,
          artist:document.querySelector('h2.t3')?.textContent.trim() || null,
          explicit_key:document.querySelector('#cifra_tom')?.textContent.trim() || null};
      })())''')
          .timeout(const Duration(seconds: 3));
      final decoded = raw is String ? jsonDecode(raw) : raw;
      final dom = decoded is String ? jsonDecode(decoded) : decoded;
      record['state_after_navigation'] = dom;
      if (!scenario.startsWith('A') &&
          dom is Map &&
          dom['response_status'] is int) {
        record['http_status'] = dom['response_status'];
      }
    } catch (error) {
      record['state_error_type'] = error.runtimeType.toString();
    }
    results.add(record);
    debugPrint('CIFRA_PROBE_CASE=${jsonEncode(record)}');
    if (record['timeout'] == true) {
      try {
        await controller
            .runJavaScript('window.stop()')
            .timeout(const Duration(seconds: 2));
      } catch (_) {
        /* Already recorded. */
      }
    }
    active = null;
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('LouvAIO — $status')),
    body: WebViewWidget(controller: controller),
  );
}
