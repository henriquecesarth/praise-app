-- ============================================================
-- Praise App — Módulo Repertório e Músicas
-- Migration 003: Adição de Multi-Usuário
-- ============================================================

-- 1. Adicionar coluna user_id na tabela songs
ALTER TABLE songs ADD COLUMN IF NOT EXISTS user_id UUID;

-- 2. RLS e Policies para isolamento estrito de dados
-- Como habilitamos RLS na Migration 001, vamos criar a política para user_id.
-- A política temporária "Service role full access on songs" criada na migração 001 permite acesso via service_role.
-- Para usuários autenticados via JWT do Supabase, criamos esta política baseada em auth.uid():
DROP POLICY IF EXISTS "Users can manage their own songs" ON songs;
CREATE POLICY "Users can manage their own songs" ON songs
    FOR ALL 
    USING (auth.uid() = user_id) 
    WITH CHECK (auth.uid() = user_id);

-- 3. Atualizar músicas legadas com o usuário de desenvolvimento para exibição local
UPDATE songs SET user_id = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' WHERE user_id IS NULL;
