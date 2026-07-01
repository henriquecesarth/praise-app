-- ============================================================
-- Praise App — Cifrador Inteligente Standalone
-- Migration 004: Criação da tabela smart_chords
-- ============================================================

CREATE TABLE IF NOT EXISTS smart_chords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
    song_id UUID REFERENCES songs(id) ON DELETE SET NULL,
    original_key VARCHAR(10) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ativar RLS
ALTER TABLE smart_chords ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
DROP POLICY IF EXISTS "Users can manage their own smart chords" ON smart_chords;
CREATE POLICY "Users can manage their own smart chords" ON smart_chords
    FOR ALL 
    USING (auth.uid() = user_id) 
    WITH CHECK (auth.uid() = user_id);

-- Permitir acesso total do service_role para desenvolvimento/serviço Node
DROP POLICY IF EXISTS "Service role full access on smart_chords" ON smart_chords;
CREATE POLICY "Service role full access on smart_chords" ON smart_chords
    FOR ALL 
    TO service_role
    USING (true)
    WITH CHECK (true);
