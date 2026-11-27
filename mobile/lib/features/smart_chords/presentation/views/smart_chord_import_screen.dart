import '../widgets/musical_progression_line.dart';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../app/providers.dart';
import '../../domain/shared_import_payload.dart';
import '../../domain/smart_chord_import.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_import_controller.dart';
import '../widgets/song_link_picker_modal.dart';
import '../widgets/chord_lyric_line.dart';
import 'cifraclub_capture_screen.dart';
import '../../../../core/errors/app_failure.dart';

class SmartChordImportScreen extends ConsumerStatefulWidget {
  final SharedImportPayload? initialPayload;

  const SmartChordImportScreen({super.key, this.initialPayload});

  @override
  ConsumerState<SmartChordImportScreen> createState() =>
      _SmartChordImportScreenState();
}

class _SmartChordImportScreenState extends ConsumerState<SmartChordImportScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // PDF Tab state
  Uint8List? _pdfBytes;
  String? _pdfFileName;
  int? _pdfSize;
  String? _fileError;

  // Text Tab state
  final _textController = TextEditingController();

  // URL Tab state
  final _urlController = TextEditingController();

  // Image Tab state
  Uint8List? _imageBytes;
  String? _imageFileName;
  int? _imageSize;
  String? _imageError;

  // Preview Form controllers
  final _titleController = TextEditingController();
  final _artistController = TextEditingController();
  final _contentController = TextEditingController();
  String _originalKey = '';
  int _previewMode = 0; // 0 = raw/edit, 1 = rendered
  late SmartChordImportNotifier _notifier;
  String? _boundUserId;
  String? _boundMinistryId;
  bool _ready = false;
  bool _abandoned = false;
  int _operation = 0;

  bool _isCurrent(int operation) =>
      mounted &&
      !_abandoned &&
      operation == _operation &&
      ref.read(authNotifierProvider).user?.id == _boundUserId &&
      ref.read(ministryContextNotifierProvider).selectedMinistry?.id ==
          _boundMinistryId;

  void _clearWorkflow() {
    _operation++;
    _notifier.reset();
    _pdfBytes = null;
    _pdfFileName = null;
    _pdfSize = null;
    _fileError = null;
    _textController.clear();
    _urlController.clear();
    _imageBytes = null;
    _imageFileName = null;
    _imageSize = null;
    _imageError = null;
    _titleController.clear();
    _artistController.clear();
    _contentController.clear();
    _originalKey = '';
    _previewMode = 0;
  }

  void _discardContext() {
    if (_abandoned) return;
    _abandoned = true;
    _clearWorkflow();
    final importRoute = ModalRoute.of(context);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || importRoute?.isActive != true) return;
      final navigator = Navigator.of(context);
      navigator.popUntil((route) => route == importRoute);
      if (navigator.canPop()) navigator.pop();
    });
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _notifier = ref.read(smartChordImportNotifierProvider.notifier);
    _boundUserId = ref.read(authNotifierProvider).user?.id;
    _boundMinistryId = ref
        .read(ministryContextNotifierProvider)
        .selectedMinistry
        ?.id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _abandoned) return;
      _clearWorkflow();
      setState(() => _ready = true);
      _handleInitialPayload();
    });
  }

  Future<void> _handleInitialPayload() async {
    final payload = widget.initialPayload;
    if (payload == null || !mounted || _abandoned) return;

    if (payload.hasError) {
      final msg =
          payload.errorMessage ??
          'Não foi possível processar o item compartilhado.';
      setState(() {
        _fileError = msg;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: Colors.red.shade800),
        );
      }
      return;
    }

    if (payload.isText) {
      final text = payload.text?.trim() ?? '';
      _tabController.index = 1;
      if (text.isEmpty) {
        setState(() {
          _fileError = 'O texto compartilhado está vazio.';
        });
        return;
      }
      if (text.length > SharedImportPayload.maxSharedTextLength) {
        setState(() {
          _fileError =
              'O texto compartilhado excede o limite de 100.000 caracteres.';
        });
        return;
      }
      if (text.startsWith('http://') || text.startsWith('https://')) {
        _tabController.index = 2;
        _urlController.text = text;
        await _extractUrl();
      } else {
        _tabController.index = 1;
        _textController.text = text;
        await _extractText();
      }
    } else if (payload.isPdf) {
      final bytes = payload.pdfBytes;
      if (bytes == null || bytes.isEmpty) {
        setState(() {
          _fileError = 'Arquivo PDF vazio ou inválido.';
        });
        return;
      }
      final size = bytes.length;
      if (size > 3 * 1024 * 1024) {
        setState(() {
          _fileError = 'Arquivo PDF excede o limite máximo permitido de 3 MB.';
          _pdfBytes = null;
          _pdfFileName = null;
          _pdfSize = null;
        });
        return;
      }
      _tabController.index = 0;
      setState(() {
        _pdfBytes = bytes;
        _pdfFileName = payload.pdfFileName ?? 'cifra_compartilhada.pdf';
        _pdfSize = size;
        _fileError = null;
      });
      await _extractPdf();
    } else if (payload.isImage) {
      _tabController.index = 3;
      final bytes = payload.imageBytes;
      if (bytes == null || bytes.isEmpty) {
        setState(() {
          _imageError = 'Arquivo de imagem vazio ou inválido.';
        });
        return;
      }
      final size = bytes.length;
      if (size > 5 * 1024 * 1024) {
        setState(() {
          _imageError =
              'Arquivo de imagem excede o limite máximo permitido de 5 MB.';
          _imageBytes = null;
          _imageFileName = null;
          _imageSize = null;
        });
        return;
      }
      if (!SharedImportPayload.isSupportedImageBytes(bytes)) {
        setState(() {
          _imageError = 'A imagem deve estar no formato PNG, JPEG ou WebP.';
        });
        return;
      }
      _tabController.index = 3;
      setState(() {
        _imageBytes = bytes;
        _imageFileName = payload.imageFileName ?? 'cifra_compartilhada.png';
        _imageSize = size;
        _imageError = null;
      });
      await _extractImage();
    }
  }

  @override
  void dispose() {
    _abandoned = true;
    _operation++;
    // autoDispose releases the notifier; pending operations also check mounted.
    _tabController.dispose();
    _textController.dispose();
    _urlController.dispose();
    _titleController.dispose();
    _artistController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _pickPdfFile() async {
    final operation = ++_operation;
    setState(() {
      _fileError = null;
    });

    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
      );

      if (!_isCurrent(operation) || result.isEmpty) return;

      final file = result.first;
      final declaredSize = await file.length();
      if (!_isCurrent(operation)) return;
      if (declaredSize != null && declaredSize > 3 * 1024 * 1024) {
        setState(() {
          _fileError = 'Arquivo PDF excede o limite máximo permitido de 3 MB.';
          _pdfBytes = null;
          _pdfFileName = null;
          _pdfSize = null;
        });
        return;
      }
      final bytes = await file.readAsBytes();
      if (!_isCurrent(operation)) return;
      final size = bytes.length;

      if (size > 3 * 1024 * 1024) {
        setState(() {
          _fileError = 'Arquivo PDF excede o limite máximo permitido de 3 MB.';
          _pdfBytes = null;
          _pdfFileName = null;
          _pdfSize = null;
        });
        return;
      }

      setState(() {
        _pdfBytes = bytes;
        _pdfFileName = file.name;
        _pdfSize = size;
        _fileError = null;
      });
    } catch (_) {
      if (!_isCurrent(operation)) return;
      setState(() {
        _fileError = 'Não foi possível selecionar o arquivo. Tente novamente.';
      });
    }
  }

  Future<void> _extractPdf() async {
    if (_pdfBytes == null || _pdfFileName == null) {
      setState(() {
        _fileError = 'Selecione um arquivo PDF válido.';
      });
      return;
    }

    final operation = ++_operation;
    await _notifier.importPdf(_pdfBytes!, _pdfFileName!);
    debugPrint('M20_EXTRACT_URL_DONE: isCurrent=${_isCurrent(operation)}');
    if (!_isCurrent(operation)) return;
    _syncDraftToControllers();
  }

  Future<void> _extractText() async {
    final text = _textController.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cole o texto da cifra antes de continuar.'),
        ),
      );
      return;
    }
    if (text.length > SharedImportPayload.maxSharedTextLength) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('O texto excede o limite de 100.000 caracteres.'),
        ),
      );
      return;
    }

    final operation = ++_operation;
    await _notifier.importText(text);
    debugPrint('M20_EXTRACT_URL_DONE: isCurrent=${_isCurrent(operation)}');
    if (!_isCurrent(operation)) return;
    _syncDraftToControllers();
  }

  Future<void> _extractUrl() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Informe a URL da cifra antes de continuar.'),
        ),
      );
      return;
    }

    FocusScope.of(context).unfocus();
    final operation = ++_operation;
    final nativeCapture = !kIsWeb &&
        defaultTargetPlatform == TargetPlatform.android &&
        ref.read(cifraClubDirectImportEnabledProvider);
    await _notifier.importUrl(url, capture: nativeCapture ? () async {
      if (!_isCurrent(operation)) return null;
      final sessionProvider = ref.read(apiClientProvider).sessionContextProvider;
      final session = sessionProvider?.call();
      final html = await ref.read(cifraClubCaptureLauncherProvider)(context, url);
      if (!_isCurrent(operation)) return null;
      if (sessionProvider != null && sessionProvider() != session) {
        throw const AppFailure(message: 'Sessão alterada durante a importação.', statusCode: 401, code: 'SESSION_CHANGED');
      }
      return html;
    } : null);
    debugPrint('M20_EXTRACT_URL_DONE: isCurrent=${_isCurrent(operation)}');
    if (!_isCurrent(operation)) return;
    _syncDraftToControllers();
  }

  Future<void> _pickImageFile() async {
    final operation = ++_operation;
    setState(() {
      _imageError = null;
    });

    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['png', 'jpg', 'jpeg', 'webp'],
      );

      if (!_isCurrent(operation) || result.isEmpty) return;

      final file = result.first;
      final declaredSize = await file.length();
      if (!_isCurrent(operation)) return;
      if (declaredSize != null && declaredSize > 5 * 1024 * 1024) {
        setState(() {
          _imageError =
              'Arquivo de imagem excede o limite máximo permitido de 5 MB.';
          _imageBytes = null;
          _imageFileName = null;
          _imageSize = null;
        });
        return;
      }
      final bytes = await file.readAsBytes();
      if (!_isCurrent(operation)) return;
      final size = bytes.length;

      if (size > 5 * 1024 * 1024) {
        setState(() {
          _imageError =
              'Arquivo de imagem excede o limite máximo permitido de 5 MB.';
          _imageBytes = null;
          _imageFileName = null;
          _imageSize = null;
        });
        return;
      }
      if (!SharedImportPayload.isSupportedImageBytes(bytes)) {
        setState(() {
          _imageError = 'A imagem deve estar no formato PNG, JPEG ou WebP.';
          _imageBytes = null;
          _imageFileName = null;
          _imageSize = null;
        });
        return;
      }

      setState(() {
        _imageBytes = bytes;
        _imageFileName = file.name;
        _imageSize = size;
        _imageError = null;
      });
    } catch (_) {
      if (!_isCurrent(operation)) return;
      setState(() {
        _imageError =
            'Não foi possível selecionar o arquivo de imagem. Tente novamente.';
      });
    }
  }

  Future<void> _extractImage() async {
    if (_imageBytes == null || _imageFileName == null) {
      setState(() {
        _imageError = 'Selecione um arquivo de imagem válido.';
      });
      return;
    }
    if (_imageBytes!.length > 5 * 1024 * 1024 ||
        !SharedImportPayload.isSupportedImageBytes(_imageBytes!)) {
      setState(() {
        _imageError = _imageBytes!.length > 5 * 1024 * 1024
            ? 'Arquivo de imagem excede o limite máximo permitido de 5 MB.'
            : 'A imagem deve estar no formato PNG, JPEG ou WebP.';
      });
      return;
    }

    final operation = ++_operation;
    await _notifier.importImage(_imageBytes!, _imageFileName!);
    debugPrint('M20_EXTRACT_URL_DONE: isCurrent=${_isCurrent(operation)}');
    if (!_isCurrent(operation)) return;
    _syncDraftToControllers();
  }

  Future<void> _pasteClipboardToText() async {
    final operation = ++_operation;
    try {
      final data = await Clipboard.getData(Clipboard.kTextPlain);
      if (!mounted || !_isCurrent(operation)) return;
      if (data?.text != null &&
          data!.text!.isNotEmpty &&
          data.text!.length <= SharedImportPayload.maxSharedTextLength) {
        setState(() {
          _textController.text = data.text!;
        });
      } else if ((data?.text?.length ?? 0) >
          SharedImportPayload.maxSharedTextLength) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('O texto excede o limite de 100.000 caracteres.'),
          ),
        );
      }
    } catch (_) {
      if (!mounted || !_isCurrent(operation)) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível acessar o clipboard.')),
      );
    }
  }

  Future<void> _pasteClipboardToUrl() async {
    final operation = ++_operation;
    try {
      final data = await Clipboard.getData(Clipboard.kTextPlain);
      if (!mounted || !_isCurrent(operation)) return;
      if (data?.text != null && data!.text!.isNotEmpty) {
        setState(() {
          _urlController.text = data.text!.trim();
        });
      }
    } catch (_) {
      if (!mounted || !_isCurrent(operation)) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível acessar o clipboard.')),
      );
    }
  }

  Future<void> _normalizeManualPaste() async {
    final text = _textController.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cole o conteúdo da cifra antes de continuar.'),
        ),
      );
      return;
    }
    if (text.length > SharedImportPayload.maxSharedTextLength) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('O texto excede o limite de 100.000 caracteres.'),
        ),
      );
      return;
    }

    final sourceDraft = ref.read(smartChordImportNotifierProvider).draft;
    if (sourceDraft == null) return;
    final editedTitle = _titleController.text.trim();
    final editedArtist = _artistController.text.trim();
    final editedOriginalKey = _originalKey;
    final operation = ++_operation;
    await _notifier.importText(text);
    if (!_isCurrent(operation)) return;

    final resultState = ref.read(smartChordImportNotifierProvider);
    if (resultState.status != ImportStatus.preview) return;
    final normalized = resultState.draft;
    if (normalized == null) return;
    final remainingWarnings = sourceDraft.warnings.where(
      (warning) =>
          warning.code != 'URL_MANUAL_PASTE_REQUIRED' &&
          warning.code != 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED',
    );
    _notifier.replaceDraft(
      SmartChordImportDraft(
        title: editedTitle,
        artistName: editedArtist.isEmpty ? null : editedArtist,
        originalKey: editedOriginalKey.isNotEmpty
            ? editedOriginalKey
            : normalized.originalKey ?? sourceDraft.originalKey,
        content: normalized.content,
        warnings: [...remainingWarnings, ...normalized.warnings],
        sourceType: sourceDraft.sourceType,
        requiresManualPaste: false,
        sourceUrl: sourceDraft.sourceUrl,
        originalText: normalized.originalText ?? text,
        displayedKey: normalized.displayedKey,
        capo: normalized.capo,
      ),
    );
    _syncDraftToControllers();
  }

  void _syncDraftToControllers() {
    final draft = ref.read(smartChordImportNotifierProvider).draft;
    if (draft != null) {
      _titleController.text = draft.title;
      _artistController.text = draft.artistName ?? '';
      _originalKey = draft.originalKey ?? '';
      _contentController.text = draft.content;
      if (mounted) setState(() {});
    }
  }

  Future<void> _openSource() async {
    final source = ref.read(smartChordImportNotifierProvider).draft?.sourceUrl;
    final uri = source == null ? null : Uri.tryParse(source);
    if (uri == null || !['http', 'https'].contains(uri.scheme)) return;
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {}
    if (!mounted || _abandoned) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Não foi possível abrir a origem. Copie o link exibido.'),
      ),
    );
  }

  Future<void> _pasteAndReviewSource() async {
    final operation = ++_operation;
    try {
      final data = await Clipboard.getData(Clipboard.kTextPlain);
      if (!mounted || !_isCurrent(operation)) return;
      final text = data?.text ?? '';
      if (text.isEmpty ||
          text.length > SharedImportPayload.maxSharedTextLength) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Copie o conteúdo da cifra (até 100.000 caracteres) e tente novamente.',
            ),
          ),
        );
        return;
      }
      _textController.text = text;
      await _normalizeManualPaste();
    } catch (_) {
      if (!mounted || !_isCurrent(operation)) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Não foi possível ler o clipboard. Cole o texto no campo abaixo.',
          ),
        ),
      );
    }
  }

  Future<void> _readSourceTextFile() async {
    final operation = ++_operation;
    try {
      final files = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['txt', 'pro', 'chordpro'],
      );
      if (!_isCurrent(operation) || files.isEmpty) return;
      final file = files.first;
      final size = await file.length();
      if (!_isCurrent(operation)) return;
      if (size == null || size > 400000) throw const FormatException();
      final bytes = await file.readAsBytes();
      if (!_isCurrent(operation)) return;
      if (bytes.length > 400000) throw const FormatException();
      final text = utf8.decode(bytes);
      if (text.length > SharedImportPayload.maxSharedTextLength) {
        throw const FormatException();
      }
      _textController.text = text;
      await _normalizeManualPaste();
    } catch (_) {
      if (!mounted || !_isCurrent(operation)) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Use um arquivo de texto UTF-8 de até 100.000 caracteres.',
          ),
        ),
      );
    }
  }

  Future<void> _readSourceImage() async {
    final source = ref.read(smartChordImportNotifierProvider).draft;
    if (source == null) return;
    final title = _titleController.text;
    final artist = _artistController.text;
    _imageBytes = null;
    _imageFileName = null;
    final pickerOperation = _operation + 1;
    await _pickImageFile();
    if (!_isCurrent(pickerOperation) ||
        _imageBytes == null ||
        _imageFileName == null) {
      return;
    }
    final operation = ++_operation;
    await _notifier.importImage(_imageBytes!, _imageFileName!);
    if (!_isCurrent(operation)) return;
    final result = ref.read(smartChordImportNotifierProvider);
    if (result.status != ImportStatus.preview || result.draft == null) return;
    _notifier.replaceDraft(
      result.draft!.copyWith(
        title: title,
        artistName: artist,
        sourceUrl: source.sourceUrl,
      ),
    );
    _syncDraftToControllers();
  }

  Future<void> _saveChord() async {
    debugPrint('M20_SAVE_CHORD_CALLED: isCurrent=${_isCurrent(_operation)}');
    if (!_isCurrent(_operation)) return;
    final state = ref.read(smartChordImportNotifierProvider);
    if (state.status == ImportStatus.saving ||
        state.status == ImportStatus.linking ||
        state.savedChord != null) {
      return;
    }
    final operation = ++_operation;
    final notifier = _notifier;
    notifier.updateDraft(
      title: _titleController.text,
      artistName: _artistController.text,
      originalKey: _originalKey,
      content: _contentController.text,
    );

    final created = await notifier.saveChord();
    if (!mounted || created == null || !_isCurrent(operation)) return;

    final ministry = ref.read(ministryContextNotifierProvider).selectedMinistry;

    if (ministry != null) {
      final shouldLink = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogCtx) => AlertDialog(
          title: const Text('Cifra Salva!'),
          content: const Text(
            'Cifra salva com sucesso na sua biblioteca pessoal!\n\n'
            'Deseja vinculá-la a uma música do repertório deste ministério? '
            '(O vínculo é privado e não expõe sua cifra a outros integrantes).',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogCtx).pop(false),
              child: const Text('Agora não'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(dialogCtx).pop(true),
              child: const Text('Vincular'),
            ),
          ],
        ),
      );

      if (!mounted || !_isCurrent(operation)) return;
      if (shouldLink == true) {
        await SongLinkPickerModal.show(
          context,
          ministryId: ministry.id,
          chordId: created.id,
          chordTitle: created.title,
        );
      }
    }

    if (mounted && _isCurrent(operation)) {
      Navigator.of(context).pop(created);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authNotifierProvider, (previous, next) {
      if (next.user?.id != _boundUserId) _discardContext();
    });
    ref.listen(ministryContextNotifierProvider, (previous, next) {
      if (next.selectedMinistry?.id != _boundMinistryId) _discardContext();
    });
    final state = ref.watch(smartChordImportNotifierProvider);
    final isMutationPending =
        state.status == ImportStatus.saving ||
        state.status == ImportStatus.linking;

    return PopScope(
      canPop: !isMutationPending,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop && !_abandoned) {
          _abandoned = true;
          _operation++;
          _notifier.reset();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Importar Cifra'),
          bottom: state.draft == null && state.status != ImportStatus.extracting
              ? TabBar(
                  controller: _tabController,
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  tabs: const [
                    Tab(
                      icon: Icon(Icons.picture_as_pdf),
                      text: 'Documento PDF',
                    ),
                    Tab(icon: Icon(Icons.text_fields), text: 'Colar Texto'),
                    Tab(icon: Icon(Icons.link), text: 'Link / URL'),
                    Tab(icon: Icon(Icons.image), text: 'Imagem'),
                  ],
                )
              : null,
        ),
        body: SafeArea(
          child: !_ready || _abandoned
              ? const SizedBox.shrink()
              : state.status == ImportStatus.extracting
              ? _buildExtractingIndicator()
              : state.draft != null
              ? _buildPreviewEditor(state)
              : Column(
                  children: [
                    if (state.errorMessage != null)
                      Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          state.errorMessage!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    Expanded(child: _buildInputTabs()),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _buildExtractingIndicator() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text(
            'Importando cifra...',
            style: TextStyle(fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _buildInputTabs() {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildPdfInputTab(),
        _buildTextInputTab(),
        _buildUrlInputTab(),
        _buildImageInputTab(),
      ],
    );
  }

  Widget _buildPdfInputTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: _pickPdfFile,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                border: Border.all(
                  color: _fileError != null
                      ? Colors.red
                      : Colors.grey.withValues(alpha: 0.4),
                  width: 2,
                ),
                borderRadius: BorderRadius.circular(12),
                color: Colors.grey.withValues(alpha: 0.05),
              ),
              child: Column(
                children: [
                  const Icon(
                    Icons.upload_file,
                    size: 54,
                    color: Colors.blueAccent,
                  ),
                  const SizedBox(height: 12),
                  if (_pdfFileName != null) ...[
                    Text(
                      _pdfFileName!,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${((_pdfSize ?? 0) / 1024).toStringAsFixed(1)} KB (Máximo 3 MB)',
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
                      ),
                    ),
                  ] else ...[
                    const Text(
                      'Toque para selecionar um arquivo PDF',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'PDF de texto digital de até 3 MB (máx. 10 páginas)',
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_fileError != null) ...[
            const SizedBox(height: 8),
            Text(
              _fileError!,
              style: const TextStyle(color: Colors.red, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _pdfBytes != null ? _extractPdf : null,
              icon: const Icon(Icons.search),
              label: const Text('Analisar e Pré-visualizar PDF'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextInputTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text(
                  'Cole a cifra (acordes acima da letra ou em colchetes):',
                  style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
                ),
              ),
              TextButton.icon(
                onPressed: _pasteClipboardToText,
                icon: const Icon(Icons.paste, size: 16),
                label: const Text('Colar', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _textController,
            maxLines: 10,
            onChanged: (_) => _operation++,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            decoration: const InputDecoration(
              hintText:
                  'G            D/F#        Em\nGraças Te dou pelo Teu amor\n\nIntro:\n||: A9 | A7M/9 | D9 | % :||',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _extractText,
              icon: const Icon(Icons.search),
              label: const Text('Analisar e Pré-visualizar Texto'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUrlInputTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text(
                  'Link da cifra no Cifra Club:',
                  style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
                ),
              ),
              TextButton.icon(
                onPressed: _pasteClipboardToUrl,
                icon: const Icon(Icons.paste, size: 16),
                label: const Text('Colar Link', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _urlController,
            onChanged: (_) => _operation++,
            decoration: const InputDecoration(
              labelText: 'URL da Cifra',
              hintText: 'https://www.cifraclub.com.br/artista/musica/',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            !kIsWeb && defaultTargetPlatform == TargetPlatform.android
                ? 'A cifra será preparada para revisão. Você confirma antes de salvar.'
                : 'O link mantém a referência da origem e sugere título/artista. Para importar a cifra completa, forneça o texto ou uma imagem no próximo passo.',
            style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _extractUrl,
              icon: const Icon(Icons.travel_explore),
              label: const Text('Continuar com o link'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildImageInputTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: _pickImageFile,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                border: Border.all(
                  color: _imageError != null
                      ? Colors.red
                      : Colors.grey.withValues(alpha: 0.4),
                  width: 2,
                ),
                borderRadius: BorderRadius.circular(12),
                color: Colors.grey.withValues(alpha: 0.05),
              ),
              child: Column(
                children: [
                  const Icon(
                    Icons.image_outlined,
                    size: 54,
                    color: Colors.blueAccent,
                  ),
                  const SizedBox(height: 12),
                  if (_imageFileName != null) ...[
                    Text(
                      _imageFileName!,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${((_imageSize ?? 0) / 1024).toStringAsFixed(1)} KB (Máximo 5 MB)',
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
                      ),
                    ),
                  ] else ...[
                    const Text(
                      'Toque para selecionar imagem da cifra',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Formatos PNG, JPEG ou WEBP de até 5 MB',
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_imageError != null) ...[
            const SizedBox(height: 8),
            Text(
              _imageError!,
              style: const TextStyle(color: Colors.red, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _imageBytes != null ? _extractImage : null,
              icon: const Icon(Icons.document_scanner),
              label: const Text('Reconhecer cifra da imagem'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreviewEditor(SmartChordImportState state) {
    final draft = state.draft!;
    final isMutationPending =
        state.status == ImportStatus.saving ||
        state.status == ImportStatus.linking;
    final canSave =
        _titleController.text.trim().isNotEmpty &&
        _contentController.text.trim().isNotEmpty &&
        _originalKey.isNotEmpty &&
        !draft.requiresManualPaste &&
        state.status != ImportStatus.saving &&
        state.status != ImportStatus.linking &&
        state.savedChord == null;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (draft.requiresManualPaste) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue.withValues(alpha: 0.15),
                border: Border.all(color: Colors.blue.shade700),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.info_outline,
                    color: Colors.blueAccent,
                    size: 20,
                  ),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Abra a origem e copie a cifra. Depois use Colar e revisar, um arquivo de texto ou uma imagem. Título e artista sugeridos pelo link podem ser corrigidos.',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.blueAccent,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (draft.sourceUrl != null)
                  OutlinedButton.icon(
                    onPressed: _openSource,
                    icon: const Icon(Icons.open_in_browser),
                    label: const Text('Abrir origem no navegador'),
                  ),
                FilledButton.icon(
                  onPressed: _pasteAndReviewSource,
                  icon: const Icon(Icons.paste),
                  label: const Text('Colar e revisar'),
                ),
                OutlinedButton.icon(
                  onPressed: _readSourceTextFile,
                  icon: const Icon(Icons.text_snippet_outlined),
                  label: const Text('Arquivo de texto'),
                ),
                OutlinedButton.icon(
                  onPressed: _readSourceImage,
                  icon: const Icon(Icons.image_outlined),
                  label: const Text('Usar imagem'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Expanded(
                  child: Text(
                    'Conteúdo copiado da página ou transcrito da imagem:',
                  ),
                ),
                TextButton.icon(
                  onPressed: _pasteClipboardToText,
                  icon: const Icon(Icons.paste, size: 16),
                  label: const Text('Colar'),
                ),
              ],
            ),
            TextField(
              controller: _textController,
              maxLines: 8,
              maxLength: SharedImportPayload.maxSharedTextLength,
              onChanged: (_) {
                _operation++;
                setState(() {});
              },
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText:
                    'Cole a cifra copiada da página ou transcreva o conteúdo da imagem.',
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: _normalizeManualPaste,
                icon: const Icon(Icons.auto_fix_high),
                label: const Text('Normalizar texto e continuar'),
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (draft.sourceUrl != null) ...[
            SelectableText(
              'Fonte: ${draft.sourceUrl}',
              style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
            ),
            const SizedBox(height: 12),
          ],
          if (draft.warnings.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.withValues(alpha: 0.15),
                border: Border.all(color: Colors.amber.shade700),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.warning_amber_rounded,
                        color: Colors.amber.shade800,
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Avisos da Importação (${draft.warnings.length}):',
                        style: TextStyle(
                          color: Colors.amber.shade900,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  ...draft.warnings.map(
                    (w) => Padding(
                      padding: const EdgeInsets.only(left: 28, top: 2),
                      child: Text(
                        '• ${w.message}',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (state.errorMessage != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.15),
                border: Border.all(color: Colors.red),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                state.errorMessage!,
                style: const TextStyle(
                  color: Colors.red,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          TextField(
            controller: _titleController,
            enabled: !isMutationPending,
            onChanged: (_) {
              _operation++;
              setState(() {});
            },
            decoration: const InputDecoration(
              labelText: 'Título da Cifra *',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _artistController,
                  enabled: !isMutationPending,
                  onChanged: (_) => _operation++,
                  decoration: const InputDecoration(
                    labelText: 'Artista / Banda',
                    hintText: 'Opcional',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  key: ValueKey('original-key-$_originalKey'),
                  isExpanded: true,
                  onChanged: isMutationPending
                      ? null
                      : (val) {
                          _operation++;
                          if (val != null) setState(() => _originalKey = val);
                        },
                  initialValue:
                      SmartChordParser.standardKeys.contains(_originalKey)
                      ? _originalKey
                      : null,
                  hint: const Text(
                    'Tom não identificado',
                    overflow: TextOverflow.ellipsis,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Tom original',
                    border: OutlineInputBorder(),
                  ),
                  items: SmartChordParser.standardKeys.map((k) {
                    return DropdownMenuItem(value: k, child: Text(k));
                  }).toList(),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (_originalKey.isEmpty) ...[
            const Text(
              'Tom não identificado. Selecione o tom original após conferir a fonte.',
            ),
            const SizedBox(height: 8),
          ],
          if (draft.displayedKey != null || draft.capo != null) ...[
            Text(
              [
                if (draft.displayedKey != null)
                  'Tom exibido na fonte: ${draft.displayedKey}',
                if (draft.capo != null) 'Capotraste: casa ${draft.capo}',
              ].join(' · '),
            ),
            const SizedBox(height: 12),
          ],
          if (draft.originalText != null) ...[
            ExpansionTile(
              title: const Text('Texto original para conferência'),
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: SelectableText(
                    draft.originalText!,
                    style: const TextStyle(fontFamily: 'monospace'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          if (draft.sourceType == 'image' && _imageBytes != null) ...[
            ExpansionTile(
              title: const Text('Imagem de origem para conferência'),
              children: [
                Image.memory(
                  _imageBytes!,
                  cacheWidth: 1000,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) =>
                      const Text('Pré-visualização da imagem indisponível.'),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 0, label: Text('Editar (Colchetes)')),
              ButtonSegment(value: 1, label: Text('Pré-visualização')),
            ],
            selected: {_previewMode},
            onSelectionChanged: (set) {
              if (isMutationPending) return;
              setState(() => _previewMode = set.first);
            },
          ),
          const SizedBox(height: 12),
          if (_previewMode == 0)
            TextField(
              controller: _contentController,
              enabled: !isMutationPending,
              onChanged: (_) {
                _operation++;
                setState(() {});
              },
              maxLines: 12,
              maxLength: SharedImportPayload.maxSharedTextLength,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: '[G]Graças Te [D]dou...',
              ),
            )
          else
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(8),
                color: Colors.grey.withValues(alpha: 0.05),
              ),
              constraints: const BoxConstraints(maxHeight: 300),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: _contentController.text.split('\n').map((rawLine) {
                    if (SmartChordParser.progressionTokens(rawLine) != null) {
                      return MusicalProgressionLine(
                        line: rawLine,
                        fontSize: 13,
                      );
                    }
                    return ChordLyricLine(line: rawLine, semitones: 0,
                      fontSize: 13, fontFamily: 'monospace',
                      fontFamilyFallback: const [], monospace: true);
                  }).toList(),
                ),
              ),
            ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: isMutationPending
                      ? null
                      : () {
                          setState(_clearWorkflow);
                        },
                  child: const Text('Voltar / Novo'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: canSave ? _saveChord : null,
                    child: state.status == ImportStatus.saving
                        ? const CircularProgressIndicator()
                        : const Text('Salvar Cifra Pessoal'),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
