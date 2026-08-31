import { db } from '../src/lib/firebase';

async function auditMinistry() {
  const ministryId = '5kL2qssw4PCi2irzC25X';
  console.log(`=== AUDITORIA DO MINISTÉRIO ${ministryId} ===\n`);

  const minDoc = await db.collection('ministries').doc(ministryId).get();
  if (!minDoc.exists) {
    console.error('Ministério não encontrado!');
    return;
  }

  const minData = minDoc.data()!;
  console.log('Documento ministries/5kL2qssw4PCi2irzC25X:');
  console.log({
    id: minDoc.id,
    name: minData.name,
    slug: minData.slug,
    owner_user_id: minData.owner_user_id,
    subscription_status: minData.subscription_status,
    created_at: minData.created_at,
    updated_at: minData.updated_at,
  });

  console.log('\nDocumentos em ministry_members para este ministério:');
  const membersSnap = await db.collection('ministry_members').where('ministry_id', '==', ministryId).get();
  if (membersSnap.empty) {
    console.log('Nenhum membro encontrado.');
  } else {
    membersSnap.forEach((doc: any) => {
      console.log(`Doc ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  }
}

auditMinistry().catch(console.error);
