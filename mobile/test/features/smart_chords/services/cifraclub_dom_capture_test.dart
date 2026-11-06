import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/services/cifraclub_dom_capture.dart';

void main() {
  group('validateCifraClubCaptureUrl', () {
    test('accepts the two supported HTTPS hostnames and artist/song paths', () {
      expect(
        validateCifraClubCaptureUrl(
          'https://www.cifraclub.com.br/artista/minha-musica/',
        ).host,
        'www.cifraclub.com.br',
      );
      expect(
        validateCifraClubCaptureUrl(
          'https://cifraclub.com.br/artista/minha-musica/',
        ).host,
        'cifraclub.com.br',
      );
    });

    test('rejects non HTTPS, lookalike hosts, and URL authority extras', () {
      final invalidUrls = [
        'http://cifraclub.com.br/artista/musica/',
        'https://cifraclub.com.br.example.invalid/artista/musica/',
        'https://user@cifraclub.com.br/artista/musica/',
        'https://cifraclub.com.br:8443/artista/musica/',
        'https://cifraclub.com.br/artista/musica/?x=1',
        'https://cifraclub.com.br/artista/musica/#verse',
        'https://cifraclub.com.br/artista/musica',
        'https://cifraclub.com.br/artista/musica/extra/',
        'https://evil.invalid/artista/musica/',
      ];

      for (final url in invalidUrls) {
        expect(
          () => validateCifraClubCaptureUrl(url),
          throwsA(
            isA<AppFailure>().having(
              (failure) => failure.code,
              'code',
              'CIFRACLUB_INVALID_URL',
            ),
          ),
          reason: url,
        );
      }
    });

    test('rejects oversized URLs before creating a renderer', () {
      final url = 'https://cifraclub.com.br/${'a' * 1001}';

      expect(
        () => validateCifraClubCaptureUrl(url),
        throwsA(isA<AppFailure>()),
      );
    });
  });

  test('DOM projection is constrained to the supported musical region', () {
    expect(cifraClubMusicalDomScript, contains('article pre'));
    expect(
      cifraClubMusicalDomScript,
      contains("document.querySelectorAll('h1')"),
    );
    expect(cifraClubMusicalDomScript, contains("{ready:false}"));
    expect(cifraClubMusicalDomScript, contains("{blocked:true}"));
  });
}
