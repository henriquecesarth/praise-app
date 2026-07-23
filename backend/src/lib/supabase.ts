/**
 * @deprecated Módulo Supabase descontinuado. O projeto foi migrado para o Firebase Admin SDK (Cloud Firestore + Firebase Auth).
 * Utilize db e authAdmin de '../lib/firebase' ou a camada de Repositórios.
 */

export function getSupabaseClient(): any {
  console.warn('⚠️ getSupabaseClient() está obsoleto. O backend utiliza o Firebase Admin SDK.');
  return null;
}

export function getAuthClient(): any {
  console.warn('⚠️ getAuthClient() está obsoleto. O backend utiliza o Firebase Admin SDK.');
  return null;
}
