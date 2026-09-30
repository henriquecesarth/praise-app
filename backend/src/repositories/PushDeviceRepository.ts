import crypto from 'crypto';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  PushDeviceRecord,
  RegisterPushDeviceInput,
  isPushDeviceActive,
} from '../features/push_notifications/push-notifications.types';

export class PushDeviceRepository {
  private readonly collection = db.collection('push_devices');

  public static generateDeviceId(fcmToken: string): string {
    const hash = crypto.createHash('sha256').update(fcmToken).digest('hex');
    return `dev_${hash}`;
  }

  public static redactToken(token: string): string {
    if (!token || token.length < 12) return '***';
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }

  /**
   * Idempotently upserts a device registration for a user.
   * If the token was previously registered by another user, rejects with 409 PUSH_TOKEN_CONFLICT.
   * Cross-user token hijacking is forbidden; normal account switching relies on logout token invalidation.
   */
  async upsertDevice(
    userId: string,
    input: RegisterPushDeviceInput
  ): Promise<PushDeviceRecord> {
    const docId = PushDeviceRepository.generateDeviceId(input.fcm_token);
    const docRef = this.collection.doc(docId);
    const now = new Date().toISOString();

    const existingSnap = await docRef.get();
    if (existingSnap.exists) {
      const data = existingSnap.data() as PushDeviceRecord;
      if (data.user_id !== userId) {
        throw new AppError(
          409,
          'Este token FCM já está associado a outro usuário. O usuário anterior deve invalidar o token ao sair.',
          'PUSH_TOKEN_CONFLICT'
        );
      }

      const updatedRecord: PushDeviceRecord = {
        ...data,
        platform: input.platform,
        app_version: input.app_version ?? data.app_version,
        device_model: input.device_model ?? data.device_model,
        updated_at: now,
        last_seen_at: now,
      };
      await docRef.set(updatedRecord, { merge: true });
      return updatedRecord;
    }

    const newRecord: PushDeviceRecord = {
      id: docId,
      user_id: userId,
      fcm_token: input.fcm_token,
      platform: input.platform,
      app_version: input.app_version,
      device_model: input.device_model,
      created_at: now,
      updated_at: now,
      last_seen_at: now,
    };

    await docRef.set(newRecord);
    return newRecord;
  }

  /**
   * Deletes a device registration by token, ensuring it belongs to the authenticated user.
   * Returns true if deleted, false if not found or belongs to another user.
   */
  async deleteDeviceByToken(userId: string, fcmToken: string): Promise<boolean> {
    const docId = PushDeviceRepository.generateDeviceId(fcmToken);
    const docRef = this.collection.doc(docId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return false;
    }

    const data = snap.data() as PushDeviceRecord;
    if (data.user_id !== userId) {
      // Security: Prevent cross-user deletion.
      return false;
    }

    await docRef.delete();
    return true;
  }

  /**
   * Deletes a device document directly by its doc ID (used for pruning invalid FCM tokens).
   */
  async deleteDeviceById(docId: string): Promise<void> {
    await this.collection.doc(docId).delete();
  }

  /**
   * Retrieves all registered devices for a specific user.
   * If onlyActive is true, devices inactive beyond the lease threshold are omitted.
   */
  async getDevicesByUserId(
    userId: string,
    options?: { onlyActive?: boolean; now?: Date }
  ): Promise<PushDeviceRecord[]> {
    const snap = await this.collection.where('user_id', '==', userId).get();
    const records = snap.docs.map((doc) => doc.data() as PushDeviceRecord);
    if (options?.onlyActive) {
      return records.filter((r) => isPushDeviceActive(r, options.now));
    }
    return records;
  }

  /**
   * Retrieves a device by its FCM token.
   */
  async getDeviceByToken(fcmToken: string): Promise<PushDeviceRecord | null> {
    const docId = PushDeviceRepository.generateDeviceId(fcmToken);
    const snap = await this.collection.doc(docId).get();
    if (!snap.exists) return null;
    return snap.data() as PushDeviceRecord;
  }
}
