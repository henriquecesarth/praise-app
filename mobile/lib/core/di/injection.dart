import 'package:get_it/get_it.dart';
import '../network/api_client.dart';
import '../../features/repertoire/data/datasources/remote_datasource.dart';
import '../../features/repertoire/data/repositories/repository_impl.dart';
import '../../features/repertoire/domain/repositories/repositories.dart';

final getIt = GetIt.instance;

/// Initialize all dependency injection bindings safely
void setupDI() {
  if (!getIt.isRegistered<ApiClient>()) {
    getIt.registerLazySingleton<ApiClient>(
      () => ApiClient(),
    );
  }

  if (!getIt.isRegistered<RepertoireRemoteDataSource>()) {
    getIt.registerLazySingleton<RepertoireRemoteDataSource>(
      () => RepertoireRemoteDataSource(),
    );
  }

  if (!getIt.isRegistered<SongRepository>()) {
    getIt.registerLazySingleton<SongRepository>(
      () => SongRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
    );
  }

  if (!getIt.isRegistered<ArtistRepository>()) {
    getIt.registerLazySingleton<ArtistRepository>(
      () => ArtistRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
    );
  }

  if (!getIt.isRegistered<ClassificationRepository>()) {
    getIt.registerLazySingleton<ClassificationRepository>(
      () => ClassificationRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
    );
  }

  if (!getIt.isRegistered<FolderRepository>()) {
    getIt.registerLazySingleton<FolderRepository>(
      () => FolderRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
    );
  }

  if (!getIt.isRegistered<RepertoireCountsRepository>()) {
    getIt.registerLazySingleton<RepertoireCountsRepository>(
      () => RepertoireCountsRepositoryImpl(getIt<RepertoireRemoteDataSource>()),
    );
  }
}
