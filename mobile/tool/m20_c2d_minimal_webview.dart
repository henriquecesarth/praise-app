import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MaterialApp(home: MinimalWebViewProbe()));
}

class MinimalWebViewProbe extends StatefulWidget {
  const MinimalWebViewProbe({super.key});

  @override
  State<MinimalWebViewProbe> createState() => _MinimalWebViewProbeState();
}

class _MinimalWebViewProbeState extends State<MinimalWebViewProbe> {
  late final WebViewController _controller;
  String _currentStep = 'INIT';
  String _status = 'Starting minimal webview probe...';
  final List<String> _logs = [];

  void _log(String msg) {
    final line = '[MINIMAL_WV] $msg';
    if (kDebugMode) {
      debugPrint(line);
    }
    setState(() {
      _logs.add(msg);
      _status = msg;
    });
  }

  @override
  void initState() {
    super.initState();
    _initController();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _runSequence();
    });
  }

  void _initController() {
    _controller = WebViewController();
    _controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    _controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) {
          _log('onNavigationRequest: ${request.url}');
          return NavigationDecision.navigate;
        },
        onPageStarted: (url) {
          _log('onPageStarted: $url');
        },
        onPageFinished: (url) {
          _log('onPageFinished: $url');
        },
        onWebResourceError: (error) {
          _log('onWebResourceError: code=${error.errorCode}, desc=${error.description}, url=${error.url}');
        },
        onHttpError: (error) {
          _log('onHttpError: status=${error.response?.statusCode}, uri=${error.request?.uri}');
        },
      ),
    );
  }

  Future<void> _runSequence() async {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    _log('TEST_B_START');

    // STEP 1: Simple Local HTML
    _currentStep = 'STEP 1: LOCAL HTML';
    _log('STEP 1: Loading simple local HTML...');
    final step1Success = await _testLocalHtml();
    _log('STEP 1 RESULT: ${step1Success ? "PASS" : "FAIL"}');

    if (!step1Success) {
      _log('TEST_B_ABORTED: Step 1 failed, will not proceed to step 2 or 3');
      _log('TEST_B_SUMMARY: STEP1=FAIL;STEP2=SKIPPED;STEP3=SKIPPED');
      return;
    }

    // STEP 2: example.com
    _currentStep = 'STEP 2: example.com';
    _log('STEP 2: Loading https://example.com/ ...');
    final step2Success = await _testExampleCom();
    _log('STEP 2 RESULT: ${step2Success ? "PASS" : "FAIL"}');

    if (!step2Success) {
      _log('TEST_B_ABORTED: Step 2 failed, will not proceed to step 3');
      _log('TEST_B_SUMMARY: STEP1=PASS;STEP2=FAIL;STEP3=SKIPPED');
      return;
    }

    // STEP 3: Reference page (only if controls succeed)
    _currentStep = 'STEP 3: REFERENCE PAGE';
    _log('STEP 3: Loading reference page...');
    final step3Success = await _testReferencePage();
    _log('STEP 3 RESULT: ${step3Success ? "PASS" : "FAIL"}');
    _log('TEST_B_SUMMARY: STEP1=PASS;STEP2=PASS;STEP3=${step3Success ? "PASS" : "FAIL"}');
  }

  Future<bool> _testLocalHtml() async {
    final completer = Completer<bool>();
    final timer = Timer(const Duration(seconds: 10), () {
      if (!completer.isCompleted) {
        _log('STEP 1 TIMEOUT: Local HTML did not finish within 10s');
        completer.complete(false);
      }
    });

    try {
      const html = '<!doctype html><html><body><h1 id="heading">Hello LouvAIO</h1></body></html>';
      await _controller.loadHtmlString(html);

      // Wait a bit and attempt JS execution
      for (var i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        try {
          final res = await _controller.runJavaScriptReturningResult('document.getElementById("heading")?.innerText ?? "null"');
          _log('STEP 1 JS eval: $res');
          if (res.toString().contains('Hello LouvAIO')) {
            timer.cancel();
            if (!completer.isCompleted) completer.complete(true);
            return true;
          }
        } catch (e) {
          _log('STEP 1 JS eval attempt $i failed: $e');
        }
      }
    } catch (e) {
      _log('STEP 1 EXCEPTION: $e');
    } finally {
      timer.cancel();
    }
    return completer.isCompleted ? await completer.future : false;
  }

  Future<bool> _testExampleCom() async {
    final completer = Completer<bool>();
    final timer = Timer(const Duration(seconds: 15), () {
      if (!completer.isCompleted) {
        _log('STEP 2 TIMEOUT: example.com did not finish within 15s');
        completer.complete(false);
      }
    });

    try {
      await _controller.loadRequest(Uri.parse('https://example.com/'));

      for (var i = 0; i < 30; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        try {
          final res = await _controller.runJavaScriptReturningResult('document.title');
          _log('STEP 2 JS eval title: $res');
          if (res.toString().toLowerCase().contains('example')) {
            timer.cancel();
            if (!completer.isCompleted) completer.complete(true);
            return true;
          }
        } catch (e) {
          _log('STEP 2 JS eval attempt $i failed: $e');
        }
      }
    } catch (e) {
      _log('STEP 2 EXCEPTION: $e');
    } finally {
      timer.cancel();
    }
    return completer.isCompleted ? await completer.future : false;
  }

  Future<bool> _testReferencePage() async {
    final completer = Completer<bool>();
    final timer = Timer(const Duration(seconds: 25), () {
      if (!completer.isCompleted) {
        _log('STEP 3 TIMEOUT: Reference page did not finish within 25s');
        completer.complete(false);
      }
    });

    try {
      await _controller.loadRequest(Uri.parse('https://www.cifraclub.com.br/projeto-sola/glorificar/'));

      for (var i = 0; i < 50; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        try {
          final res = await _controller.runJavaScriptReturningResult('document.querySelector("pre") ? "HAS_PRE" : (document.title || "NO_PRE")');
          _log('STEP 3 JS eval: $res');
          if (res.toString().contains('HAS_PRE')) {
            timer.cancel();
            if (!completer.isCompleted) completer.complete(true);
            return true;
          }
        } catch (e) {
          _log('STEP 3 JS eval attempt $i failed: $e');
        }
      }
    } catch (e) {
      _log('STEP 3 EXCEPTION: $e');
    } finally {
      timer.cancel();
    }
    return completer.isCompleted ? await completer.future : false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Test B: $_currentStep'),
      ),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            color: Colors.black12,
            width: double.infinity,
            child: Text(
              _status,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          SizedBox(
            height: 200,
            child: WebViewWidget.fromPlatformCreationParams(
              params: AndroidWebViewWidgetCreationParams(
                controller: _controller.platform,
                displayWithHybridComposition: true,
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: _logs.length,
              itemBuilder: (context, index) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                child: Text(
                  _logs[index],
                  style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
