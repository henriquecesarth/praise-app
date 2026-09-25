import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('LouvAioApp renders foundation shell and navigates via router',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final storage = SharedPreferencesStorage(prefs);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
        ],
        child: const LouvAioApp(),
      ),
    );

    await tester.pumpAndSettle();

    // Verify Brand title and foundation shell
    expect(find.text('LouvAIO'), findsOneWidget);
    expect(find.text('DEVELOPMENT'), findsOneWidget);
    expect(find.text('Fundação Mobile Pronta'), findsOneWidget);
    expect(find.text('Ir para Acesso / Login'), findsOneWidget);

    // Navigate to Login placeholder
    await tester.tap(find.text('Ir para Acesso / Login'));
    await tester.pumpAndSettle();

    // Verify Login placeholder screen rendered
    expect(find.text('Acesso LouvAIO'), findsOneWidget);
    expect(find.text('Voltar ao Início'), findsOneWidget);

    // Navigate back to AppShell
    await tester.tap(find.text('Voltar ao Início'));
    await tester.pumpAndSettle();

    // Verify back on AppShell
    expect(find.text('Fundação Mobile Pronta'), findsOneWidget);
  });
}
