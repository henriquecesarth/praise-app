import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import { WhatsAppConnectionSecretRecord } from '../features/whatsapp/whatsapp.types';

export interface DeleteSecretOptions {
  force?: boolean;
  overrideReason?: string;
  wabaId?: string;
}

export class WhatsAppConnectionSecretRepository {
  private readonly secretsCol = db.collection('whatsapp_connection_secrets');

  async getSecret(orgId: string, connectionId: string): Promise<WhatsAppConnectionSecretRecord | null> {
    const doc = await this.secretsCol.doc(connectionId).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as WhatsAppConnectionSecretRecord;
    // Cumulative tenancy guard
    if (data.organization_id !== orgId) {
      return null;
    }
    return { ...data, id: doc.id };
  }

  async setSecret(
    secret: WhatsAppConnectionSecretRecord,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.secretsCol.doc(secret.connection_id);
    if (tx) {
      tx.set(docRef, secret);
    } else {
      await docRef.set(secret);
    }
  }

  async deleteSecret(
    orgId: string,
    connectionId: string,
    options?: DeleteSecretOptions,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.secretsCol.doc(connectionId);

    const executeDelete = async (
      transaction: FirebaseFirestore.Transaction | null,
      secretDoc: FirebaseFirestore.DocumentSnapshot
    ) => {
      if (!secretDoc.exists) {
        return;
      }
      const data = secretDoc.data() as WhatsAppConnectionSecretRecord;
      if (data.organization_id !== orgId) {
        throw new AppError(404, 'Secret não encontrado nesta organização.');
      }

      // Check manual force-abandon override (DEC-7D-62, DEC-7D-67)
      if (options?.force === true) {
        if (!options.overrideReason || options.overrideReason.trim().length === 0) {
          throw new AppError(
            400,
            'OVERRIDE_REASON_REQUIRED: Justificativa obrigatória para force-abandon.',
            { code: 'OVERRIDE_REASON_REQUIRED' }
          );
        }
        if (options.overrideReason.trim().length < 10) {
          throw new AppError(
            400,
            'OVERRIDE_REASON_TOO_SHORT: Justificativa deve conter no mínimo 10 caracteres.',
            { code: 'OVERRIDE_REASON_TOO_SHORT' }
          );
        }
        if (transaction) {
          transaction.delete(docRef);
        } else {
          await docRef.delete();
        }
        return;
      }

      // Strict Secret Purge Invariant (P0, DEC-7D-64, DEC-7D-67):
      // Check if WABA lifecycle lock has unresolved subscribe mutations
      let wabaId = options?.wabaId;
      if (!wabaId) {
        const connRef = db.collection('whatsapp_connections').doc(connectionId);
        const connDoc = transaction ? await transaction.get(connRef) : await connRef.get();
        if (connDoc.exists) {
          wabaId = connDoc.data()?.provider_waba_id;
        }
      }

      if (wabaId) {
        const lockRef = db.collection('whatsapp_waba_lifecycle_locks').doc(`lock_meta_${wabaId}`);
        const lockDoc = transaction ? await transaction.get(lockRef) : await lockRef.get();
        if (lockDoc.exists) {
          const lockData = lockDoc.data();
          const hasUnresolvedSubscribe =
            Array.isArray(lockData?.unresolved_remote_mutations) &&
            lockData.unresolved_remote_mutations.some(
              (m: any) => m.operation === 'subscribe' && m.status === 'unknown_outcome'
            );
          if (hasUnresolvedSubscribe) {
            throw new AppError(
              409,
              'SECRET_PURGE_BLOCKED_UNDER_SUBSCRIBE_DEBT: Expurgo de segredo bloqueado pois há mutações de subscrição não resolvidas no livro-razão da WABA.',
              { code: 'SECRET_PURGE_BLOCKED_UNDER_SUBSCRIBE_DEBT' }
            );
          }
        }
      }

      if (transaction) {
        transaction.delete(docRef);
      } else {
        await docRef.delete();
      }
    };

    if (tx) {
      const doc = await tx.get(docRef);
      await executeDelete(tx, doc);
    } else {
      await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        await executeDelete(t, doc);
      });
    }
  }
}
