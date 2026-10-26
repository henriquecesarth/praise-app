import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/services/share_intent_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PlatformShareIntentService Unit Tests', () {
    const channelName = 'com.louvaio.louvaio_mobile/share_intent';
    late MethodChannel channel;
    late PlatformShareIntentService service;
    late List<MethodCall> log;

    setUp(() {
      log = <MethodCall>[];
      channel = const MethodChannel(channelName);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (MethodCall call) async {
        log.add(call);
        if (call.method == 'getInitialShare') {
          return {
            'type': 'text',
            'text': 'G | D | Em | C',
          };
        }
        if (call.method == 'clearInitialShare') {
          return null;
        }
        return null;
      });

      service = PlatformShareIntentService(channel);
    });

    tearDown(() {
      service.dispose();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });

    test('getInitialShare returns parsed payload and invokes platform channel', () async {
      final payload = await service.getInitialShare();
      expect(payload, isNotNull);
      expect(payload!.isText, isTrue);
      expect(payload.text, 'G | D | Em | C');
      expect(log.any((call) => call.method == 'getInitialShare'), isTrue);
    });

    test('clearInitialShare invokes platform channel', () async {
      await service.clearInitialShare();
      expect(log.any((call) => call.method == 'clearInitialShare'), isTrue);
    });

    test('onShareReceived emits payload when platform channel receives warm start event', () async {
      final receivedFuture = service.onShareReceived.first;

      // Simulate platform channel callback
      final binaryMessenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final encodedCall = const StandardMethodCodec().encodeMethodCall(
        const MethodCall('onShareReceived', {
          'type': 'text',
          'text': 'D A Bm G',
        }),
      );

      await binaryMessenger.handlePlatformMessage(
        channelName,
        encodedCall,
        (ByteData? data) {},
      );

      final payload = await receivedFuture;
      expect(payload.isText, isTrue);
      expect(payload.text, 'D A Bm G');
    });
  });
}
