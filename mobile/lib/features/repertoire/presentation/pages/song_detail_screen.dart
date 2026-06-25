import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/entities/entities.dart';
import '../widgets/widgets.dart';

/// Song Detail Screen — Shows full info for a single song
class SongDetailScreen extends StatelessWidget {
  final Song song;

  const SongDetailScreen({super.key, required this.song});

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // ─── App Bar with gradient ────────────────────────
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            backgroundColor: AppColors.background,
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppColors.primary, AppColors.primaryDark, AppColors.background],
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                  ),
                ),
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 60, 24, 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text(
                          song.title,
                          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                color: Colors.white,
                              ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          song.artistName ?? 'Artista desconhecido',
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                color: Colors.white70,
                              ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),

          // ─── Content ──────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Technical info chips
                  _buildTechChips(context),
                  const SizedBox(height: 24),

                  // External links
                  if (song.hasLinks) ...[
                    _buildLinksSection(context),
                    const SizedBox(height: 24),
                  ],

                  // Lyrics
                  if (song.lyrics != null && song.lyrics!.isNotEmpty) ...[
                    _buildLyricsSection(context),
                  ],

                  const SizedBox(height: 40),
                ],
              ),
            ),
          ),
        ],
      ),

      // Bottom action bar
      bottomNavigationBar: _buildBottomBar(context),
    );
  }

  Widget _buildTechChips(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        if (song.classificationName != null)
          ClassificationBadge(
            name: song.classificationName!,
            color: song.classificationColor,
          ),
        if (song.originalKey != null)
          _InfoChip(
            icon: Icons.music_note_rounded,
            label: 'Tom: ${song.originalKey}',
          ),
        if (song.bpm != null)
          _InfoChip(
            icon: Icons.speed_rounded,
            label: '${song.bpm!.toInt()} BPM',
          ),
        if (song.duration != null && song.duration!.isNotEmpty)
          _InfoChip(
            icon: Icons.timer_rounded,
            label: song.duration!,
          ),
      ],
    );
  }

  Widget _buildLinksSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Links & Recursos', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        if (song.chordSheetUrl != null && song.chordSheetUrl!.isNotEmpty)
          _LinkTile(
            icon: Icons.description_rounded,
            title: 'Cifra',
            subtitle: 'Abrir arquivo de cifra',
            color: AppColors.success,
            onTap: () => _launchUrl(song.chordSheetUrl!),
          ),
        if (song.youtubeUrl != null && song.youtubeUrl!.isNotEmpty)
          _LinkTile(
            icon: Icons.play_circle_fill_rounded,
            title: 'Vídeo',
            subtitle: 'Assistir no YouTube',
            color: AppColors.error,
            onTap: () => _launchUrl(song.youtubeUrl!),
          ),
        if (song.audioUrl != null && song.audioUrl!.isNotEmpty)
          _LinkTile(
            icon: Icons.headphones_rounded,
            title: 'Áudio',
            subtitle: 'Ouvir áudio de referência',
            color: AppColors.secondary,
            onTap: () => _launchUrl(song.audioUrl!),
          ),
      ],
    );
  }

  Widget _buildLyricsSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Letra', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: SelectableText(
            song.lyrics!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  height: 1.8,
                  letterSpacing: 0.3,
                ),
          ),
        ),
      ],
    );
  }

  Widget _buildBottomBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  // TODO: Navigate to edit
                },
                icon: const Icon(Icons.edit_rounded, size: 18),
                label: const Text('Editar'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: () {
                  // TODO: Share or add to scale
                },
                icon: const Icon(Icons.share_rounded, size: 18),
                label: const Text('Compartilhar'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Info chip for technical details
class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

/// Link tile for external resources
class _LinkTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _LinkTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: color.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: color.withOpacity(0.2)),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, color: color, size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.open_in_new_rounded,
                  size: 16,
                  color: color.withOpacity(0.7),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
