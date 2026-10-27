import 'dart:async';
import 'package:flutter/services.dart';
import '../domain/shared_import_payload.dart';

abstract class ShareIntentService {
  Future<SharedImportPayload?> getInitialShare();
  Future<void> clearInitialShare();
  Stream<String> get onShareStarted;
  Stream<SharedImportPayload> get onShareReceived;
  void dispose();
}

class PlatformShareIntentService implements ShareIntentService {
  static const MethodChannel _defaultChannel =
      MethodChannel('com.louvaio.louvaio_mobile/share_intent');

  final MethodChannel _channel;
  final StreamController<SharedImportPayload> _streamController =
      StreamController<SharedImportPayload>.broadcast();
  final StreamController<String> _startedController =
      StreamController<String>.broadcast();
  final List<SharedImportPayload> _earlyReceived = [];
  final List<String> _earlyStarted = [];
  Future<void> _decodeTail = Future<void>.value();

  PlatformShareIntentService([MethodChannel? channel])
      : _channel = channel ?? _defaultChannel {
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    final args = call.arguments;
    if (call.method == 'onShareStarted') {
      if (args is Map && args['requestId'] is String) {
        final requestId = args['requestId'] as String;
        if (_startedController.hasListener) {
          _startedController.add(requestId);
        } else {
          _earlyStarted.add(requestId);
        }
      }
      return;
    }

    if (call.method == 'onShareReceived' && args is Map) {
      final requestId = args['requestId'] as String?;
      final decode = _decodeTail.then((_) async {
        try {
          final payload = await SharedImportPayload.fromMap(args);
          if (payload != null) {
            final correlatedPayload = payload.withRequestId(requestId);
            if (_streamController.hasListener) {
              _streamController.add(correlatedPayload);
            } else {
              _earlyReceived.add(correlatedPayload);
            }
          }
        } catch (_) {
          // Malformed platform payloads are discarded without breaking later shares.
        }
      });
      _decodeTail = decode;
      await decode;
    }
  }

  @override
  Future<SharedImportPayload?> getInitialShare() async {
    try {
      final result = await _channel.invokeMethod<Map>('getInitialShare');
      if (result != null) {
        final payload = await SharedImportPayload.fromMap(result);
        return payload?.withRequestId(result['requestId'] as String?);
      }
    } catch (_) {
      // Platform channel failure or not implemented on current platform
    }
    return null;
  }

  @override
  Future<void> clearInitialShare() async {
    try {
      await _channel.invokeMethod<void>('clearInitialShare');
    } catch (_) {}
  }

  @override
  Stream<SharedImportPayload> get onShareReceived =>
      Stream<SharedImportPayload>.multi((controller) {
        final early = List<SharedImportPayload>.from(_earlyReceived);
        _earlyReceived.clear();
        for (final payload in early) {
          controller.add(payload);
        }
        final subscription = _streamController.stream.listen(
          controller.add,
          onError: controller.addError,
          onDone: controller.close,
        );
        controller.onCancel = subscription.cancel;
      });

  @override
  Stream<String> get onShareStarted => Stream<String>.multi((controller) {
        final early = List<String>.from(_earlyStarted);
        _earlyStarted.clear();
        for (final requestId in early) {
          controller.add(requestId);
        }
        final subscription = _startedController.stream.listen(
          controller.add,
          onError: controller.addError,
          onDone: controller.close,
        );
        controller.onCancel = subscription.cancel;
      });

  @override
  void dispose() {
    _streamController.close();
    _startedController.close();
  }
}
