-- ============================================================
-- Praise App — Módulo Repertório e Músicas
-- Migration 001: Criação das tabelas do Repertório
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Tabela: ministries (stub mínimo para este módulo)
-- ============================================================
CREATE TABLE IF NOT EXISTS ministries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Tabela: classifications (dinâmica — não é ENUM fixo)
--    Cada ministério pode criar suas próprias classificações.
-- ============================================================
CREATE TABLE IF NOT EXISTS classifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(7), -- Hex color code (ex: #7C3AED)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ministry_id, name)
);

CREATE INDEX idx_classifications_ministry_id ON classifications(ministry_id);

-- ============================================================
-- 3. Tabela: artists
-- ============================================================
CREATE TABLE IF NOT EXISTS artists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ministry_id, name)
);

CREATE INDEX idx_artists_ministry_id ON artists(ministry_id);

-- ============================================================
-- 4. Tabela: songs
-- ============================================================
CREATE TABLE IF NOT EXISTS songs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
    classification_id UUID REFERENCES classifications(id) ON DELETE SET NULL,
    original_key VARCHAR(5),
    bpm DECIMAL(6,2),
    duration INTERVAL,
    lyrics TEXT,
    chord_sheet_url TEXT,
    youtube_url TEXT,
    audio_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_songs_ministry_id ON songs(ministry_id);
CREATE INDEX idx_songs_artist_id ON songs(artist_id);
CREATE INDEX idx_songs_classification_id ON songs(classification_id);
CREATE INDEX idx_songs_title ON songs(ministry_id, title);

-- ============================================================
-- 5. Tabela: folders
-- ============================================================
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folders_ministry_id ON folders(ministry_id);

-- ============================================================
-- 6. Tabela: folder_songs (tabela intermediária many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS folder_songs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(folder_id, song_id)
);

CREATE INDEX idx_folder_songs_folder_id ON folder_songs(folder_id);
CREATE INDEX idx_folder_songs_song_id ON folder_songs(song_id);

-- ============================================================
-- 7. Trigger: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ministries_updated_at BEFORE UPDATE ON ministries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_classifications_updated_at BEFORE UPDATE ON classifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_artists_updated_at BEFORE UPDATE ON artists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_songs_updated_at BEFORE UPDATE ON songs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_folders_updated_at BEFORE UPDATE ON folders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 8. Row Level Security (RLS)
--    Habilitado em todas as tabelas. Policies serão criadas
--    quando o módulo de autenticação for implementado.
--    Por enquanto, o backend usa service_role que bypassa RLS.
-- ============================================================
ALTER TABLE ministries ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_songs ENABLE ROW LEVEL SECURITY;

-- Policy temporária: permite tudo via service_role (será refinada com auth)
CREATE POLICY "Service role full access on ministries" ON ministries
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on classifications" ON classifications
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on artists" ON artists
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on songs" ON songs
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on folders" ON folders
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on folder_songs" ON folder_songs
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 9. Seed Data (Dados de Exemplo)
-- ============================================================

-- Ministério de exemplo
INSERT INTO ministries (id, name) VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IBBP Música');

-- Classificações padrão (podem ser deletadas/editadas pelo admin)
INSERT INTO classifications (ministry_id, name, description, color) VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Louvor', 'Cânticos de elogio e agradecimento por feitos divinos.', '#7C3AED'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Adoração', 'Cânticos de reconhecimento estrito pelo caráter e ser de Deus.', '#06B6D4'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Contemplação', 'Músicas focadas na meditação sobre os atributos e qualidades divinas.', '#8B5CF6'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Consagração', 'Cânticos sobre santificação e dedicação de vida.', '#10B981'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Júbilo', 'Cânticos expressivos de celebração e contentamento no Senhor.', '#F59E0B'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Especiais', 'Temáticas pontuais (Casamentos, Batizados, datas comemorativas).', '#EF4444');

-- Artistas de exemplo
INSERT INTO artists (id, ministry_id, name) VALUES
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Vocal Livre'),
    ('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Diante do Trono'),
    ('b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Aline Barros'),
    ('b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Fernandinho'),
    ('b5eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Hillsong'),
    ('b6eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Elevation Worship');
