import { db } from '../src/lib/firebase';

async function fixOwnership() {
  const ministryId = '5kL2qssw4PCi2irzC25X';
  const targetUserId = 'XnpmlGGY6PZCRT90U0hYlLrEwjf2';
  const wrongUserId = 'M6zNUvylOOPylVOdzjzJS18VIJl1';

  console.log(`=== CORRIGINDO OWNERSHIP E MEMBERSHIP DO MINISTÉRIO ${ministryId} ===\n`);

  const minRef = db.collection('ministries').doc(ministryId);
  const minDoc = await minRef.get();
  if (!minDoc.exists) {
    throw new Error('Ministério não encontrado!');
  }

  const minData = minDoc.data()!;
  console.log(`Owner anterior: ${minData.owner_user_id} -> Novo owner: ${targetUserId}`);

  const batch = db.batch();

  // 1. Atualizar owner_user_id do ministério preservando demais campos
  batch.update(minRef, {
    owner_user_id: targetUserId,
    updated_at: new Date().toISOString(),
  });

  // 2. Remover membership do usuário incorreto tXyeDfvYURmpgLCfpyyr
  const wrongMembersSnap = await db
    .collection('ministry_members')
    .where('ministry_id', '==', ministryId)
    .where('user_id', '==', wrongUserId)
    .get();

  wrongMembersSnap.forEach((doc) => {
    console.log(`Removendo membership incorreto: Doc ID ${doc.id} (user_id: ${wrongUserId})`);
    batch.delete(doc.ref);
  });

  // 3. Criar membership oficial para o usuário correto
  const newMemberRef = db.collection('ministry_members').doc();
  const newMemberData = {
    id: newMemberRef.id,
    ministry_id: ministryId,
    user_id: targetUserId,
    role: 'admin',
    joined_at: minData.created_at || new Date().toISOString(),
  };
  console.log(`Criando novo membership: Doc ID ${newMemberRef.id} para ${targetUserId} como admin`);
  batch.set(newMemberRef, newMemberData);

  await batch.commit();
  console.log('\n✅ Ownership e membership atualizados com sucesso no Firestore!');
}

fixOwnership().catch(console.error);
