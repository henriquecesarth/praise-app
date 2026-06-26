-- ============================================================
-- Praise App — Módulo Repertório e Músicas
-- Migration 002: Adição de external_links na tabela songs
-- ============================================================

ALTER TABLE songs ADD COLUMN IF NOT EXISTS external_links JSONB DEFAULT '{}'::jsonb;

-- Notas:
-- Esta coluna armazenará um mapa (chave-valor) para links adicionais
-- de outras plataformas (ex: spotify, deezer, apple_music, letras_mus, etc).
