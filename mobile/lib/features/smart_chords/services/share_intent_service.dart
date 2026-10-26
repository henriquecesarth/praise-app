import 'dart:async';
import 'package:flutter/services.dart';
import '../domain/shared_import_payload.dart';

abstract class ShareIntentService {
  Future<SharedImportPayload?> getInitialShare();
  Future<void> clearInitialShare();
  Stream<SharedImportPayload> get onShareReceived;
  void dispose();
}

class PlatformShareIntentService implements ShareIntentService {
  static const MethodChannel _defaultChannel =
      MethodChannel('com.louvaio.louvaio_mobile/share_intent');

  final MethodChannel _channel;
  final StreamController<SharedImportPayload> _streamController =
      StreamController<SharedImportPayload>.broadcast();

  PlatformShareIntentService([MethodChannel? channel])
      : _channel = channel ?? _defaultChannel {
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    if (call.method == 'onShareReceived') {
      final args = call.arguments;
      if (args is Map) {
        final payload = await SharedImportPayload.fromMap(args);
        if (payload != null) {
          _streamController.add(payload);
        }
      }
    }
  }

  @override
  Future<SharedImportPayload?> getInitialShare() async {
    try {
      final result = await _channel.invokeMethod<Map>('getInitialShare');
      if (result != null) {
        return await SharedImportPayload.fromMap(result);
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
  Stream<SharedImportPayload> get onShareReceived => _streamController.stream;

  @override
  void dispose() {
    _streamController.close();
  }
}
