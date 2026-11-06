// Bounded diagnostic using the product capture, in the existing debug flavor.
// No authentication, persistence, alternate WebView or musical parser.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/cifraclub_capture_screen.dart';

void main() => runApp(const ProviderScope(child: MaterialApp(home: _Probe())));

class _Probe extends ConsumerStatefulWidget {
  const _Probe();
  @override
  ConsumerState<_Probe> createState() => _ProbeState();
}

class _ProbeState extends ConsumerState<_Probe> {
  String status = 'Verificando captura interna';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => run());
  }

  Future<void> run() async {
    final watch = Stopwatch()..start();
    try {
      final html = await ref.read(cifraClubCaptureLauncherProvider)(
        context,
        'https://www.cifraclub.com.br/projeto-sola/glorificar/',
      );
      status = html == null ? 'CANCELLED' : 'CAPTURED';
      debugPrint(
        'M20_C2_CAPTURE=$status;elapsed_ms=${watch.elapsedMilliseconds};characters=${html?.length ?? 0}',
      );
    } on AppFailure catch (error) {
      status = error.code ?? 'FAILED';
      debugPrint(
        'M20_C2_CAPTURE=$status;elapsed_ms=${watch.elapsedMilliseconds}',
      );
    } catch (error) {
      status = 'FAILED';
      debugPrint('M20_C2_CAPTURE_ERROR=${error.runtimeType}');
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('M20-C2 — captura interna')),
    body: Center(child: Text(status)),
  );
}
