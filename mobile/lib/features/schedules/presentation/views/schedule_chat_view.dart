import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../controllers/schedule_detail_controller.dart';

// Each conversation belongs to a schedule AND authenticated user. Disposal
// invalidates pending replies; global detail/count state is never used as chat data.
final scheduleChatProvider = StateNotifierProvider.autoDispose.family<
    CommentsNotifier, CommentsState, (String, String, String)>((ref, key) {
  return CommentsNotifier(repository: ref.watch(scheduleRepositoryProvider));
});

class ScheduleChatView extends ConsumerStatefulWidget {
  final String ministryId;
  final String scheduleId;
  final String userId;
  const ScheduleChatView({super.key, required this.ministryId,
    required this.scheduleId, required this.userId});

  @override
  ConsumerState<ScheduleChatView> createState() => _ScheduleChatViewState();
}

class _ScheduleChatViewState extends ConsumerState<ScheduleChatView> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  bool _closed = false;
  (String, String, String) get _key =>
      (widget.ministryId, widget.scheduleId, widget.userId);
  bool get _active => !_closed && widget.userId.isNotEmpty &&
      ref.read(authNotifierProvider).user?.id == widget.userId &&
      ref.read(ministryContextNotifierProvider).selectedMinistry?.id == widget.ministryId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _active) _refresh();
    });
  }

  Future<void> _refresh() async {
    if (!_active || ref.read(scheduleChatProvider(_key)).isPosting) return;
    await ref.read(scheduleChatProvider(_key).notifier)
        .load(widget.ministryId, widget.scheduleId);
    if (mounted && _active) _latest();
  }

  void _latest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send() async {
    if (!_active || _input.text.trim().isEmpty) return;
    final text = _input.text;
    final success = await ref.read(scheduleChatProvider(_key).notifier)
        .postComment(widget.ministryId, widget.scheduleId, text);
    if (!mounted || !_active) return;
    if (success) {
      if (_input.text == text) _input.clear();
      await _refresh();
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(authNotifierProvider);
    ref.watch(ministryContextNotifierProvider);
    if (!_active) {
      if (!_closed) {
        _closed = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.of(context).maybePop();
        });
      }
      return const Scaffold(body: SizedBox.shrink());
    }
    final state = ref.watch(scheduleChatProvider(_key));
    final messages = [...state.comments]..sort((a, b) =>
      a.createdAt.compareTo(b.createdAt));
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Chat da Escala'), actions: [
        IconButton(tooltip: 'Atualizar conversa',
          onPressed: state.isPosting || state.isLoading ? null : _refresh,
          icon: const Icon(Icons.refresh)),
      ]),
      body: SafeArea(child: Column(children: [
        if (state.error != null || state.postError != null)
          MaterialBanner(
            content: Text(state.postError ?? state.error!),
            actions: [TextButton(onPressed: _refresh, child: const Text('Tentar novamente'))],
          ),
        if (state.isCommerciallyRestricted)
          const Padding(padding: EdgeInsets.all(12),
            child: Text('O envio de comentários está temporariamente indisponível. A leitura continua disponível.')),
        Expanded(child: state.isLoading && messages.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : messages.isEmpty
            ? const Center(child: Text('Nenhum comentário ainda. Seja o primeiro!'))
            : ListView.builder(
                key: const ValueKey('schedule_chat_messages'),
                controller: _scroll, padding: const EdgeInsets.all(16),
                itemCount: messages.length,
                itemBuilder: (context, index) {
                  final message = messages[index];
                  final mine = message.userId == widget.userId;
                  return Align(
                    key: ValueKey('chat_message_${message.id}'),
                    alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: FractionallySizedBox(widthFactor: 0.88,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: mine ? theme.colorScheme.primaryContainer
                              : theme.colorScheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(16)),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(message.userName, style: theme.textTheme.labelLarge),
                          const SizedBox(height: 6),
                          Text(message.content),
                          const SizedBox(height: 6),
                          Text(message.formattedDate == message.formattedTime
                              ? message.formattedTime
                              : '${message.formattedDate} • ${message.formattedTime}',
                            style: theme.textTheme.labelSmall),
                        ]),
                      )),
                  );
                })),
        Padding(
          key: const ValueKey('schedule_chat_composer'),
          padding: const EdgeInsets.all(12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(child: TextField(
              key: const ValueKey('schedule_chat_input'),
              controller: _input, minLines: 1, maxLines: 4, maxLength: 1000,
              enabled: !state.isPosting && !state.isCommerciallyRestricted,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(hintText: 'Escreva um comentário...',
                counterText: '', border: OutlineInputBorder()),
            )),
            IconButton(tooltip: 'Enviar comentário',
              onPressed: state.isPosting || state.isCommerciallyRestricted ||
                  _input.text.trim().isEmpty ? null : _send,
              icon: state.isPosting
                ? const SizedBox(width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.send_rounded)),
          ])),
      ])),
    );
  }
}
