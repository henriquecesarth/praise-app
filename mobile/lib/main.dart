import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'core/di/injection.dart';
import 'core/theme/app_theme.dart';
import 'core/constants/app_constants.dart';
import 'features/repertoire/domain/repositories/repositories.dart';
import 'features/repertoire/presentation/bloc/song_list_bloc.dart';
import 'features/repertoire/presentation/bloc/artist_list_bloc.dart';
import 'features/repertoire/presentation/bloc/folder_list_bloc.dart';
import 'features/repertoire/presentation/bloc/classification_list_bloc.dart';
import 'features/repertoire/presentation/pages/repertoire_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait for mobile
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
  ]);

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Color(0xFF0D0D1A),
    systemNavigationBarIconBrightness: Brightness.light,
  ));

  // Initialize DI
  setupDI();

  runApp(const PraiseApp());
}

class PraiseApp extends StatelessWidget {
  const PraiseApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider<SongRepository>(
          create: (_) => getIt<SongRepository>(),
        ),
        RepositoryProvider<ArtistRepository>(
          create: (_) => getIt<ArtistRepository>(),
        ),
        RepositoryProvider<FolderRepository>(
          create: (_) => getIt<FolderRepository>(),
        ),
        RepositoryProvider<ClassificationRepository>(
          create: (_) => getIt<ClassificationRepository>(),
        ),
      ],
      child: MultiBlocProvider(
        providers: [
          BlocProvider(
            create: (context) => SongListBloc(
              songRepository: getIt<SongRepository>(),
              ministryId: ApiConstants.defaultMinistryId,
            )..add(const LoadSongs()),
          ),
          BlocProvider(
            create: (context) => ArtistListBloc(
              artistRepository: getIt<ArtistRepository>(),
              ministryId: ApiConstants.defaultMinistryId,
            )..add(const LoadArtists()),
          ),
          BlocProvider(
            create: (context) => FolderListBloc(
              folderRepository: getIt<FolderRepository>(),
              ministryId: ApiConstants.defaultMinistryId,
            )..add(const LoadFolders()),
          ),
          BlocProvider(
            create: (context) => ClassificationListBloc(
              classificationRepository: getIt<ClassificationRepository>(),
              ministryId: ApiConstants.defaultMinistryId,
            )..add(const LoadClassifications()),
          ),
        ],
        child: MaterialApp(
          title: 'Praise',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.darkTheme,
          home: const RepertoireScreen(),
        ),
      ),
    );
  }
}
