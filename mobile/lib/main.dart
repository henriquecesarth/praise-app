import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'core/di/injection.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_cubit.dart';
import 'core/constants/app_constants.dart';
import 'core/network/api_client.dart';
import 'core/theme/app_colors.dart';
import 'features/repertoire/domain/repositories/repositories.dart';
import 'features/repertoire/presentation/bloc/song_list_bloc.dart';
import 'features/repertoire/presentation/bloc/artist_list_bloc.dart';
import 'features/repertoire/presentation/bloc/folder_list_bloc.dart';
import 'features/repertoire/presentation/bloc/classification_list_bloc.dart';
import 'features/auth/presentation/pages/login_screen.dart';
import 'features/smart_chords/presentation/pages/main_navigation_screen.dart';

void main() {
  // Override ErrorWidget to show details on screen instead of white blank screen
  ErrorWidget.builder = (FlutterErrorDetails details) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: const Color(0xFF131614),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '⚠️ Erro de Renderização no App',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: Colors.redAccent,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${details.exception}',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '${details.stack}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: Colors.grey,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  };

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('FlutterError: ${details.exception}');
  };

  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('PlatformDispatcher Error: $error');
    return true;
  };

  WidgetsFlutterBinding.ensureInitialized();

  // Guard SystemChrome calls for web compatibility
  if (!kIsWeb) {
    try {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.portraitUp,
      ]);
      SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: Color(0xFF131614),
        systemNavigationBarIconBrightness: Brightness.light,
      ));
    } catch (_) {}
  }

  // Initialize Dependency Injection
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
            create: (_) => ThemeCubit(),
          ),
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
        child: BlocBuilder<ThemeCubit, ThemeMode>(
          builder: (context, themeMode) {
            return MaterialApp(
              title: 'Praise App',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.lightTheme,
              darkTheme: AppTheme.darkTheme,
              themeMode: themeMode,
              home: const RootAuthDecider(),
            );
          },
        ),
      ),
    );
  }
}

class RootAuthDecider extends StatefulWidget {
  const RootAuthDecider({super.key});

  @override
  State<RootAuthDecider> createState() => _RootAuthDeciderState();
}

class _RootAuthDeciderState extends State<RootAuthDecider> {
  late Future<bool> _isLoggedInFuture;

  @override
  void initState() {
    super.initState();
    _isLoggedInFuture = getIt<ApiClient>().isLoggedIn();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _isLoggedInFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            backgroundColor: Color(0xFF131614),
            body: Center(
              child: CircularProgressIndicator(color: AppColors.accent),
            ),
          );
        }
        if (snapshot.data == true) {
          return const MainNavigationScreen();
        }
        return const LoginScreen();
      },
    );
  }
}
