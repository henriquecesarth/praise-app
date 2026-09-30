import crypto from 'crypto';
import { db } from '../lib/firebase';
import {
  PushDeviceRecord,
  RegisterPushDeviceInput,
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
   * If the token was previously registered by another user (e.g. device handover or relogin),
   * ownership is safely updated to the current authenticated user.
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
      const updatedRecord: PushDeviceRecord = {
        ...data,
        user_id: userId,
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
   */
  async getDevicesByUserId(userId: string): Promise<PushDeviceRecord[]> {
    const snap = await this.collection.where('user_id', '==', userId).get();
    return snap.docs.map((doc) => doc.data() as PushDeviceRecord);
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
