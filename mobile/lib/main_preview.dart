import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/providers.dart';
import 'app/theme/app_theme.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/domain/auth_user.dart';
import 'features/auth/presentation/controllers/auth_controller.dart';
import 'features/ministry_context/data/ministry_repository.dart';
import 'features/ministry_context/domain/ministry.dart';
import 'features/ministry_context/domain/ministry_onboarding.dart';
import 'features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'features/repertoire/data/repertoire_repository.dart';
import 'features/repertoire/domain/artist.dart';
import 'features/repertoire/domain/classification.dart';
import 'features/repertoire/domain/paginated_songs.dart';
import 'features/repertoire/domain/song_detail.dart';
import 'features/repertoire/domain/song_form_data.dart';
import 'features/repertoire/domain/song_summary.dart';
import 'features/repertoire/presentation/views/song_detail_view.dart';
import 'features/repertoire/presentation/views/song_form_screen.dart';
import 'features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'features/smart_chords/data/smart_chord_repository.dart';
import 'features/smart_chords/domain/smart_chord.dart';
import 'features/smart_chords/domain/smart_chord_import.dart';
import 'features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'features/smart_chords/presentation/views/smart_chord_reader_screen.dart';

// =============================================================================
// SAFE VISUAL PREVIEW FIXTURES (R3-B)
// =============================================================================

const mockUser = AuthUser(
  id: 'preview-user-1',
  email: 'tester@louvaio.app',
  name: 'Visual Tester (R3-B)',
  chordFontFamily: 'monospace',
);

const mockMinistry = Ministry(
  id: 'preview-ministry-1',
  name: 'Ministério LouvAIO (Preview)',
  role: 'admin',
);

final mockArtists = <Artist>[
  const Artist(
    id: 'artist-1',
    ministryId: 'preview-ministry-1',
    name: 'Adhemar de Campos',
  ),
  const Artist(
    id: 'artist-2',
    ministryId: 'preview-ministry-1',
    name: 'Soraya Moraes',
  ),
];

final mockClassifications = <Classification>[
  const Classification(
    id: 'class-1',
    ministryId: 'preview-ministry-1',
    name: 'Celebração',
    color: '#10B981',
  ),
  const Classification(
    id: 'class-2',
    ministryId: 'preview-ministry-1',
    name: 'Adoração',
    color: '#6366F1',
  ),
];

final mockSongVersions = <SongVersion>[
  const SongVersion(
    id: 'v_1',
    name: 'Original / Tom G',
    key: 'G',
    bpm: 110,
    duration: '04:30',
    notes: 'Arranjo padrão oficial. Entrada suave com violão e teclado, banda completa no refrão.',
    classificationIds: ['class-1'],
  ),
  const SongVersion(
    id: 'v_2',
    name: 'Versão Acústica',
    key: 'E',
    bpm: 92,
    duration: '05:15',
    notes: 'Arranjo intimista sem bateria. Apenas violão dedilhado, cajón e vozes.',
    classificationIds: ['class-2'],
  ),
  const SongVersion(
    id: 'v_3',
    name: 'Versão Rápida / Medley',
    key: 'A',
    bpm: 130,
    duration: '03:45',
    notes: 'Arranjo dinâmico e acelerado, conectando diretamente com Cantai ao Senhor.',
    classificationIds: ['class-1'],
  ),
];

SongDetail buildInitialMockSong() {
  return SongDetail(
    id: 'preview-song-1',
    ministryId: 'preview-ministry-1',
    title: 'Grande é o Senhor',
    artistId: 'artist-1',
    artistName: 'Adhemar de Campos',
    classificationId: 'class-1',
    classification: const SongClassificationRef(
      id: 'class-1',
      name: 'Celebração',
      color: '#10B981',
    ),
    originalKey: 'G',
    bpm: 110,
    duration: '04:30',
    lyrics: 'Grande é o Senhor e mui digno de louvor\n'
        'Na cidade do nosso Deus, seu santo monte\n'
        'Alegria de toda a terra\n\n'
        'Grande é o Senhor em quem nós temos a vitória\n'
        'E que nos ajuda contra o inimigo\n'
        'Por isso diante dele nos prostramos\n\n'
        'Queremos o teu nome engrandecer\n'
        'E agradecer-te por tua obra em nossas vidas\n'
        'Confiamos em teu infinito amor\n'
        'Pois só tu és o Deus eterno\n'
        'Sobre toda a terra e céu!',
    notes: 'Música clássica de celebração e louvor comunitário.',
    versions: mockSongVersions,
  );
}

const mockChord = SmartChord(
  id: 'preview-chord-1',
  userId: 'preview-user-1',
  title: 'Quão Grande É o Meu Deus',
  artistName: 'Soraya Moraes',
  originalKey: 'C',
  content: 'Tom: C\n\n'
      'Intro: [C] [Am7] [F] [G]\n\n'
      '[C]                    [Am7]\n'
      '  O esplendor de um Rei vestido de majestade\n'
      '[F]                       [G]\n'
      '  A terra se alegrará, a terra se alegrará\n\n'
      '[C]                   [Am7]\n'
      '  Ele resplandece a luz, as trevas vão fugir\n'
      '[F]                     [G]\n'
      '  Tremer à Sua voz, tremer à Sua voz\n\n'
      'Refrão:\n'
      '[C]                      [Am7]\n'
      '  Quão grande é o meu Deus, cantarei quão grande\n'
      '       [F]              [G]             [C]\n'
      'É o meu Deus e todos hão de ver quão grande é o meu Deus',
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  songId: 'preview-song-1',
  songTitle: 'Grande é o Senhor',
);

const mockRepertoireLink = SmartChordRepertoireLink(
  link: SmartChordSongLink(
    id: 'preview-link-1',
    userId: 'preview-user-1',
    smartChordId: 'preview-chord-1',
    ministryId: 'preview-ministry-1',
    songId: 'preview-song-1',
  ),
  song: SmartChordSongSummary(
    id: 'preview-song-1',
    ministryId: 'preview-ministry-1',
    title: 'Grande é o Senhor',
    artistName: 'Adhemar de Campos',
    originalKey: 'G',
  ),
);

// =============================================================================
// SAFE OFFLINE IN-MEMORY REPOSITORIES
// =============================================================================

class PreviewAuthRepository implements AuthRepository, ChordFontPreferenceUpdater {
  AuthUser _user;
  final StreamController<User?> _streamController = StreamController<User?>.broadcast();

  PreviewAuthRepository({required AuthUser initialUser}) : _user = initialUser;

  @override
  Stream<User?> authStateChanges() => _streamController.stream;

  @override
  User? get currentFirebaseUser => null;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    throw UnsupportedError('Preview mode is strictly offline and does not permit Firebase authentication.');
  }

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    throw UnsupportedError('Preview mode is strictly offline.');
  }

  @override
  Future<AuthUser> getMe() async => _user;

  @override
  Future<void> signOut() async {}

  @override
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) async {
    _user = _user.copyWith(chordFontFamily: chordFontFamily);
    return chordFontFamily;
  }
}

class PreviewMinistryRepository implements MinistryRepository {
  final Ministry ministry;
  PreviewMinistryRepository({required this.ministry});

  @override
  Future<List<Ministry>> getMyMinistries() async => [ministry];

  @override
  Future<Ministry> createMinistry({required String name}) async => ministry;

  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) async =>
      JoinMinistryResult(
        ministry: ministry,
        message: 'Entrou no ministério com sucesso',
        role: 'admin',
      );


  @override
  Future<MinistryInvite> createInviteCode(String ministryId, {int expiresInDays = 7}) async =>
      MinistryInvite(
        id: 'preview-inv-1',
        ministryId: ministryId,
        code: 'PR-PREVIEW',
        expiresAt: DateTime.now().add(Duration(days: expiresInDays)),
      );
}

class PreviewRepertoireRepository implements RepertoireRepository {
  SongDetail _song;
  final List<Artist> _artists;
  final List<Classification> _classifications;

  PreviewRepertoireRepository({
    required SongDetail initialSong,
    required List<Artist> artists,
    required List<Classification> classifications,
  })  : _song = initialSong,
        _artists = List.from(artists),
        _classifications = List.from(classifications);

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    final summary = SongSummary(
      id: _song.id,
      ministryId: _song.ministryId,
      title: _song.title,
      artistName: _song.artistName,
      classification: _song.classification,
      originalKey: _song.originalKey,
      bpm: _song.bpm,
      duration: _song.duration,
      versions: _song.versions,
    );
    return PaginatedSongs(songs: [summary], total: 1);
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    return _song;
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async {
    return _classifications;
  }

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async {
    if (search != null && search.trim().isNotEmpty) {
      final q = search.trim().toLowerCase();
      return _artists.where((a) => a.name.toLowerCase().contains(q)).toList();
    }
    return _artists;
  }

  @override
  Future<Artist> createArtist(String ministryId, String name) async {
    final newArtist = Artist(
      id: 'artist-${_artists.length + 1}',
      ministryId: ministryId,
      name: name,
    );
    _artists.add(newArtist);
    return newArtist;
  }

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async {
    return updateSong(ministryId, 'preview-song-${DateTime.now().millisecondsSinceEpoch}', data);
  }

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async {
    final artistName = _artists
        .cast<Artist?>()
        .firstWhere((a) => a?.id == data.artistId, orElse: () => null)
        ?.name;

    final classificationRef = _classifications
        .cast<Classification?>()
        .firstWhere((c) => c?.id == data.classificationId, orElse: () => null);

    _song = SongDetail(
      id: songId,
      ministryId: ministryId,
      title: data.title,
      artistId: data.artistId,
      artistName: artistName,
      classificationId: data.classificationId,
      classification: classificationRef != null
          ? SongClassificationRef(
              id: classificationRef.id,
              name: classificationRef.name,
              color: classificationRef.color,
            )
          : null,
      originalKey: data.originalKey,
      bpm: data.bpm,
      duration: data.duration,
      youtubeUrl: data.youtubeUrl,
      audioUrl: data.audioUrl,
      lyrics: data.lyrics,
      chordSheetUrl: data.chordSheetUrl,
      notes: data.notes,
      versions: data.versions ?? const [],
    );

    return _song;
  }

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}
}

class PreviewSmartChordRepository implements SmartChordRepository {
  SmartChord _chord;

  PreviewSmartChordRepository({required SmartChord initialChord}) : _chord = initialChord;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async {
    return [_chord];
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async {
    return [_chord];
  }

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    return _chord;
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    _chord = SmartChord.fromJson(payload);
    return _chord;
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async {
    final merged = Map<String, dynamic>.from(_chord.toJson())..addAll(payload);
    _chord = SmartChord.fromJson(merged);
    return _chord;
  }

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    return SmartChordImportDraft(
      title: filename.replaceAll('.pdf', ''),
      content: '',
      warnings: const [],
      sourceType: 'pdf',
    );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    return SmartChordImportDraft(
      title: 'Nova Cifra Importada',
      content: text,
      warnings: const [],
      sourceType: 'text',
    );
  }

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) async {
    return const SmartChordImportDraft(
      title: 'Cifra URL',
      content: '',
      warnings: [],
      sourceType: 'url',
    );
  }

  @override
  Future<SmartChordImportDraft> importCapturedUrlDraft(
      String url, String musicalHtml) async {
    return importUrlDraft(url);
  }

  @override
  Future<SmartChordImportDraft> importImageDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Cifra Imagem',
      content: '',
      warnings: [],
      sourceType: 'image',
    );
  }
}

class PreviewSmartChordLinkRepository implements SmartChordRepertoireLinkRepository {
  SmartChordRepertoireLink _link;
  final SmartChord _chord;

  PreviewSmartChordLinkRepository({
    required SmartChordRepertoireLink initialLink,
    required SmartChord chord,
  })  : _link = initialLink,
        _chord = chord;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    return _link;
  }

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async {
    _link = mockRepertoireLink;
    return _link;
  }

  @override
  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    _link = const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async {
    return [_chord];
  }
}

class PreviewAuthNotifier extends AuthNotifier {
  PreviewAuthNotifier(super.repository, AuthUser user) {
    state = AuthState.authenticated(user);
  }
}

class PreviewMinistryContextNotifier extends MinistryContextNotifier {
  PreviewMinistryContextNotifier({
    required super.repository,
    required super.preferencesStorage,
    required Ministry ministry,
  }) {
    state = MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      availableMinistries: [ministry],
      selectedMinistry: ministry,
    );
  }
}

// =============================================================================
// MAIN ENTRYPOINT & WIDGET TREE
// =============================================================================

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final initialSong = buildInitialMockSong();
  final authRepo = PreviewAuthRepository(initialUser: mockUser);
  final ministryRepo = PreviewMinistryRepository(ministry: mockMinistry);
  final repertoireRepo = PreviewRepertoireRepository(
    initialSong: initialSong,
    artists: mockArtists,
    classifications: mockClassifications,
  );
  final chordRepo = PreviewSmartChordRepository(initialChord: mockChord);
  final linkRepo = PreviewSmartChordLinkRepository(
    initialLink: mockRepertoireLink,
    chord: mockChord,
  );
  final inMemoryPrefs = InMemoryPreferencesStorage();

  runApp(
    ProviderScope(
      overrides: [
        preferencesStorageProvider.overrideWithValue(inMemoryPrefs),
        authRepositoryProvider.overrideWithValue(authRepo),
        authNotifierProvider.overrideWith(
          (ref) => PreviewAuthNotifier(authRepo, mockUser),
        ),
        ministryRepositoryProvider.overrideWithValue(ministryRepo),
        ministryContextNotifierProvider.overrideWith(
          (ref) => PreviewMinistryContextNotifier(
            repository: ministryRepo,
            preferencesStorage: inMemoryPrefs,
            ministry: mockMinistry,
          ),
        ),
        repertoireRepositoryProvider.overrideWithValue(repertoireRepo),
        smartChordRepositoryProvider.overrideWithValue(chordRepo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
        chordFontPreferenceProvider.overrideWith((ref) {
          final auth = ref.watch(authNotifierProvider);
          return auth.chordFontFamily;
        }),
      ],
      child: const SafeVisualPreviewApp(),
    ),
  );
}


class SafeVisualPreviewApp extends StatelessWidget {
  const SafeVisualPreviewApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LouvAIO R3-B Safe Preview',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      home: const SafeVisualPreviewHubScreen(),
    );
  }
}

// =============================================================================
// SAFE VISUAL PREVIEW HUB SCREEN
// =============================================================================

class SafeVisualPreviewHubScreen extends ConsumerWidget {
  const SafeVisualPreviewHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'LouvAIO • R3-B',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            Text(
              'Safe Visual Preview (Offline)',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.terracotta.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.terracotta),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.shield_outlined, size: 14, color: AppColors.terracotta),
                SizedBox(width: 4),
                Text(
                  'SAFE MOCK',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: AppColors.terracotta,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Security badge / network safety banner
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: theme.colorScheme.outline.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.cloud_off,
                    color: AppColors.terracotta,
                    size: 28,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Modo de Visualização Isolado',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: theme.colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Nenhuma requisição de rede é enviada. Firebase Auth, Firestore, FCM e backend estão 100% desconectados.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.75),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            Text(
              'Cenários de Validação R3-B',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 12),

            // Scenario 1: SongDetailView with Versions & BPM
            _ScenarioCard(
              icon: Icons.library_music_outlined,
              title: '1. Detalhes de Música (Versões & BPM)',
              description:
                  'Exibe a música "Grande é o Senhor" com 3 versões (Original 110 BPM, Acústica 92 BPM, Medley 130 BPM), chips de versões, badges de BPM e cifra vinculada.',
              badgeText: 'SongDetailView',
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const SongDetailView(
                      ministryId: 'preview-ministry-1',
                      songId: 'preview-song-1',
                    ),
                  ),
                );
              },
            ),

            const SizedBox(height: 12),

            // Scenario 2: SongFormScreen (Edit with versions)
            _ScenarioCard(
              icon: Icons.edit_note_outlined,
              title: '2. Edição de Música (Gerenciador de Versões & BPM)',
              description:
                  'Formulário populado com a música "Grande é o Senhor" para testar adição/remoção de versões, definição de versão padrão e edição de BPM (1..999).',
              badgeText: 'SongFormScreen',
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => SongFormScreen(
                      ministryId: 'preview-ministry-1',
                      initialSong: buildInitialMockSong(),
                    ),
                  ),
                );
              },
            ),

            const SizedBox(height: 12),

            // Scenario 3: SongFormScreen (Create from scratch)
            _ScenarioCard(
              icon: Icons.add_circle_outline,
              title: '3. Nova Música em Branco (Criação do Zero)',
              description:
                  'Formulário vazio com versão inicial "Original" auto-sintetizada, campo de BPM e validação de descarte de alterações não salvas.',
              badgeText: 'SongFormScreen (Novo)',
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const SongFormScreen(
                      ministryId: 'preview-ministry-1',
                    ),
                  ),
                );
              },
            ),

            const SizedBox(height: 12),

            // Scenario 4: SmartChordReaderScreen (Universal Fonts & Transpose)
            _ScenarioCard(
              icon: Icons.music_note_outlined,
              title: '4. Leitor de Cifras Inteligentes (Smart Chords)',
              description:
                  'Cifra "Quão Grande É o Meu Deus" para testar transposição em semitons (-11..+11), seletor de fontes universais (monospace, Arial, serif, etc.) e escala de fonte.',
              badgeText: 'SmartChordReaderScreen',
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const SmartChordReaderScreen(
                      chordId: 'preview-chord-1',
                      initialChord: mockChord,
                    ),
                  ),
                );
              },
            ),

            const SizedBox(height: 24),

            // Environment info footer
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: theme.colorScheme.outlineVariant.withValues(alpha: 0.5),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Informações do Build:',
                    style: theme.textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '• Target: lib/main_preview.dart\n'
                    '• Mode: Android Debug APK (R3-B)\n'
                    '• Toolchain: Flutter 3.47.7 / Dart 3.13.5\n'
                    '• Network Authority: Disconnected Mock',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScenarioCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final String badgeText;
  final VoidCallback onTap;

  const _ScenarioCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.badgeText,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.green.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(icon, color: AppColors.green, size: 24),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primaryContainer.withValues(alpha: 0.5),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            badgeText,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Colors.grey),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                description,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.75),
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
