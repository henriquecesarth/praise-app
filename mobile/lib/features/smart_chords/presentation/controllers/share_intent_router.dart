import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../app/providers.dart';
import '../../../../core/logging/app_logger.dart';
import '../../domain/shared_import_payload.dart';
import '../../services/share_intent_service.dart';
import '../views/smart_chord_import_screen.dart';

class _ShareRequestContext {
  final int epoch;
  final String? userId;
  final String? ministryId;

  const _ShareRequestContext({
    required this.epoch,
    required this.userId,
    required this.ministryId,
  });
}

class ShareIntentRouter {
  final dynamic _ref;
  final GlobalKey<NavigatorState> navigatorKey;
  final ShareIntentService _service;
  final AppLogger _logger;

  SharedImportPayload? _pendingPayload;
  _ShareRequestContext? _pendingRequestContext;
  final Map<String, _ShareRequestContext> _startedRequests = {};
  final Set<String> _dispatchedRequestIds = {};
  StreamSubscription<SharedImportPayload>? _receivedSubscription;
  StreamSubscription<String>? _startedSubscription;
  bool _isInitialized = false;
  bool _isNavigating = false;
  int _sessionEpoch = 0;
  int _coldCheckSequence = 0;

  ShareIntentRouter({
    required dynamic ref,
    required this.navigatorKey,
    required ShareIntentService service,
    required AppLogger logger,
  })  : _ref = ref,
        _service = service,
        _logger = logger;

  SharedImportPayload? get pendingPayload => _pendingPayload;

  void clearPendingPayload() {
    _sessionEpoch++;
    _coldCheckSequence++;
    _pendingPayload = null;
    _pendingRequestContext = null;
    _startedRequests.clear();
    _dispatchedRequestIds.clear();
  }

  void initialize() {
    if (_isInitialized) return;
    _isInitialized = true;

    _startedSubscription = _service.onShareStarted.listen((requestId) {
      _startedRequests[requestId] = _captureRequestContext();
    });

    _receivedSubscription = _service.onShareReceived.listen((payload) {
      _logger.debug('Warm start share intent received: ${payload.type}');
      _handleWarmPayload(payload);
    });

    checkInitialShare();
  }

  Future<void> checkInitialShare() async {
    final requestContext = _captureRequestContext();
    final checkSequence = ++_coldCheckSequence;
    try {
      final payload = await _service.getInitialShare();
      if (payload != null &&
          checkSequence == _coldCheckSequence &&
          _isRequestContextCurrent(requestContext)) {
        _logger.debug('Cold start share intent retrieved: ${payload.type}');
        await _handlePayload(payload, requestContext: requestContext);
      } else if (payload != null) {
        _logger.debug('Discarded stale cold-start share intent.');
      }
    } catch (e) {
      _logger.error('Failed to retrieve initial share intent: $e');
    }
  }

  Future<void> handlePayload(SharedImportPayload payload,
      [BuildContext? context]) async {
    await _handlePayload(
      payload,
      context: context,
      requestContext: _captureRequestContext(),
    );
  }

  Future<void> _handleWarmPayload(SharedImportPayload payload) async {
    final requestId = payload.requestId;
    final requestContext =
        requestId == null ? null : _startedRequests.remove(requestId);
    if (requestContext == null || !_isRequestContextCurrent(requestContext)) {
      _logger
          .debug('Discarded share completion without a current start request.');
      return;
    }
    await _handlePayload(payload, requestContext: requestContext);
  }

  _ShareRequestContext _captureRequestContext() {
    final authState = _ref.read(authNotifierProvider);
    final ministryState = _ref.read(ministryContextNotifierProvider);
    return _ShareRequestContext(
      epoch: _sessionEpoch,
      userId: authState.user?.id,
      ministryId:
          authState.isAuthenticated ? ministryState.selectedMinistry?.id : null,
    );
  }

  bool _isRequestContextCurrent(_ShareRequestContext requestContext) {
    if (requestContext.epoch != _sessionEpoch) return false;
    final authState = _ref.read(authNotifierProvider);
    final ministryState = _ref.read(ministryContextNotifierProvider);
    if (requestContext.userId != null &&
        authState.user?.id != requestContext.userId) {
      return false;
    }
    if (requestContext.ministryId != null &&
        ministryState.selectedMinistry?.id != requestContext.ministryId) {
      return false;
    }
    return true;
  }

  Future<void> _handlePayload(
    SharedImportPayload payload, {
    BuildContext? context,
    required _ShareRequestContext requestContext,
  }) async {
    final requestId = payload.requestId;
    if (requestId != null && _dispatchedRequestIds.contains(requestId)) {
      _logger.debug('Discarded duplicate share request: $requestId');
      return;
    }
    if (!_isRequestContextCurrent(requestContext)) {
      _logger
          .debug('Discarded share intent after its session context changed.');
      return;
    }
    final authState = _ref.read(authNotifierProvider);

    // 1. Session verification: If not authenticated, store payload pending login.
    if (!authState.isAuthenticated) {
      _logger.debug(
          'User unauthenticated; holding share intent payload pending login.');
      _pendingPayload = payload;
      _pendingRequestContext = requestContext;
      return;
    }

    final ministryState = _ref.read(ministryContextNotifierProvider);

    // 2. Ministry context verification: If ministry context is not yet ready, hold payload.
    if (!ministryState.isReady) {
      _logger
          .debug('Ministry context not ready; holding share intent payload.');
      _pendingPayload = payload;
      _pendingRequestContext = requestContext;
      return;
    }

    // 3. Authenticated & Ready: Navigate safely to the Smart Chords Import Hub
    _navigateToImportScreen(payload, requestContext, context);
  }

  void _navigateToImportScreen(
    SharedImportPayload payload,
    _ShareRequestContext requestContext, [
    BuildContext? context,
  ]) {
    final ctx = context ?? navigatorKey.currentContext;
    final nav =
        navigatorKey.currentState ?? (ctx != null ? Navigator.of(ctx) : null);

    if (nav == null) {
      _logger.warning('Cannot navigate to import hub: NavigatorState is null.');
      _pendingPayload = payload;
      _pendingRequestContext = requestContext;
      return;
    }

    if (_isNavigating) {
      _logger.debug('Navigation already in progress, skipping duplicate.');
      return;
    }

    _isNavigating = true;
    try {
      // Pop open modal sheets/dialogs back to shell before navigating
      nav.popUntil((route) => route.isFirst);

      nav.push(
        MaterialPageRoute(
          builder: (_) => SmartChordImportScreen(
            initialPayload: payload,
          ),
        ),
      );
      final requestId = payload.requestId;
      if (requestId != null) {
        _dispatchedRequestIds.add(requestId);
        if (_dispatchedRequestIds.length > 64) {
          _dispatchedRequestIds.remove(_dispatchedRequestIds.first);
        }
      }
    } catch (e) {
      _logger.error('Failed to navigate to SmartChordImportScreen: $e');
    } finally {
      _isNavigating = false;
    }
  }

  Future<void> dispatchPendingIfReady([BuildContext? context]) async {
    if (_pendingPayload == null) return;

    final requestContext = _pendingRequestContext;
    if (requestContext == null || !_isRequestContextCurrent(requestContext)) {
      clearPendingPayload();
      return;
    }

    final authState = _ref.read(authNotifierProvider);
    final ministryState = _ref.read(ministryContextNotifierProvider);

    if (authState.isAuthenticated && ministryState.isReady) {
      _logger.debug(
          'Dispatching pending share intent payload after authentication: $_pendingPayload');
      final payload = _pendingPayload!;
      _pendingPayload = null;
      _pendingRequestContext = null;
      await _handlePayload(
        payload,
        context: context,
        requestContext: requestContext,
      );
    }
  }

  void dispose() {
    _receivedSubscription?.cancel();
    _startedSubscription?.cancel();
    _service.dispose();
  }
}
