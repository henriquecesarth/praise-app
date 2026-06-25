import 'package:get_it/get_it.dart';
import '../../features/repertoire/data/datasources/remote_datasource.dart';
import '../../features/repertoire/data/repositories/repository_impl.dart';
import '../../features/repertoire/domain/repositories/repositories.dart';

final getIt = GetIt.instance;

/// Initialize all dependency injection bindings
void setupDI() {
  // ─── Data Sources ────────────────────────────────────────
  getIt.registerLazySingleton<RepertoireRemoteDataSource>(
    () => RepertoireRemoteDataSource(),
  );

  // ─── Repositories ────────────────────────────────────────
  getIt.registerLazySingleton<SongRepository>(
    () => SongRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
  );

  getIt.registerLazySingleton<ArtistRepository>(
    () => ArtistRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
  );

  getIt.registerLazySingleton<ClassificationRepository>(
    () => ClassificationRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
  );

  getIt.registerLazySingleton<FolderRepository>(
    () => FolderRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
  );

  getIt.registerLazySingleton<RepertoireCountsRepository>(
    () => RepertoireCountsRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
  );
}
