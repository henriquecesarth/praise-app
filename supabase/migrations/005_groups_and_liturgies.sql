-- ============================================================
-- Praise App — Multi-Tenant, Assinaturas, Convites e Liturgias
-- Migration 005: Grupos, Membros, Convites por Código Curto e Liturgias
-- ============================================================

-- 1. Tabela: groups (Grupos / Ministérios de Louvor)
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    owner_user_id UUID NOT NULL,
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'trialing', 'active', 'past_due', 'canceled'
    subscription_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrar grupos iniciais da tabela legada 'ministries' se existir
INSERT INTO groups (id, name, owner_user_id, subscription_status)
SELECT id, name, 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' AS owner_user_id, 'active' AS subscription_status
FROM ministries
ON CONFLICT (id) DO NOTHING;

-- 2. Tabela: group_members (Integrantes do Grupo e Papéis RBAC)
CREATE TABLE IF NOT EXISTS group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);

-- Inserir os donos dos grupos legados como admin em group_members
INSERT INTO group_members (group_id, user_id, role)
SELECT id AS group_id, owner_user_id AS user_id, 'admin' AS role
FROM groups
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 3. Tabela: group_invites (Convites por código curto)
CREATE TABLE IF NOT EXISTS group_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    created_by UUID NOT NULL,
    max_uses INTEGER, -- NULL = ilimitado
    uses_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_invites_code ON group_invites(code);

-- 4. Tabela: liturgies (Ordem do Culto / Serviço)
CREATE TABLE IF NOT EXISTS liturgies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liturgies_group_id ON liturgies(group_id);

-- 5. Tabela: liturgy_items (Itens de cada liturgia)
CREATE TABLE IF NOT EXISTS liturgy_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    liturgy_id UUID NOT NULL REFERENCES liturgies(id) ON DELETE CASCADE,
    song_id UUID REFERENCES songs(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'song' CHECK (type IN ('song', 'reading', 'prayer', 'custom')),
    title VARCHAR(255) NOT NULL,
    notes TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liturgy_items_liturgy_id ON liturgy_items(liturgy_id);

-- 6. Adicionar coluna group_id nas tabelas existentes e sincronizar com ministry_id
ALTER TABLE songs ADD COLUMN IF NOT EXISTS group_id UUID;
UPDATE songs SET group_id = ministry_id WHERE group_id IS NULL AND ministry_id IS NOT NULL;

ALTER TABLE folders ADD COLUMN IF NOT EXISTS group_id UUID;
UPDATE folders SET group_id = ministry_id WHERE group_id IS NULL AND ministry_id IS NOT NULL;

ALTER TABLE classifications ADD COLUMN IF NOT EXISTS group_id UUID;
UPDATE classifications SET group_id = ministry_id WHERE group_id IS NULL AND ministry_id IS NOT NULL;

ALTER TABLE artists ADD COLUMN IF NOT EXISTS group_id UUID;
UPDATE artists SET group_id = ministry_id WHERE group_id IS NULL AND ministry_id IS NOT NULL;

-- 7. Row Level Security (RLS)
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE liturgies ENABLE ROW LEVEL SECURITY;
ALTER TABLE liturgy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on groups" ON groups;
CREATE POLICY "Service role full access on groups" ON groups FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on group_members" ON group_members;
CREATE POLICY "Service role full access on group_members" ON group_members FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on group_invites" ON group_invites;
CREATE POLICY "Service role full access on group_invites" ON group_invites FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on liturgies" ON liturgies;
CREATE POLICY "Service role full access on liturgies" ON liturgies FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on liturgy_items" ON liturgy_items;
CREATE POLICY "Service role full access on liturgy_items" ON liturgy_items FOR ALL USING (true) WITH CHECK (true);
