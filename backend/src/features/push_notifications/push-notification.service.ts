import { messagingAdmin } from '../../lib/firebase';
import { PushDeviceRepository } from '../../repositories/PushDeviceRepository';
import {
  PushNotificationPayload,
  SendPushResult,
} from './push-notifications.types';

export class PushNotificationService {
  constructor(
    private readonly pushDeviceRepo: PushDeviceRepository = new PushDeviceRepository(),
    private readonly messagingClient: any = messagingAdmin
  ) {}

  /**
   * Resolves active registered devices for a user and dispatches FCM multicast notification.
   * Invalid or unregistered tokens are automatically pruned from Firestore.
   */
  async sendToUser(
    userId: string,
    payload: PushNotificationPayload
  ): Promise<SendPushResult> {
    const devices = await this.pushDeviceRepo.getDevicesByUserId(userId);

    if (devices.length === 0) {
      return {
        userId,
        totalDevices: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokensRemoved: 0,
      };
    }

    const tokens = devices.map((d) => d.fcm_token);
    let successCount = 0;
    let failureCount = 0;
    let invalidTokensRemoved = 0;

    try {
      const multicastMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      };

      const response = await this.messagingClient.sendEachForMulticast(
        multicastMessage
      );

      for (let i = 0; i < response.responses.length; i++) {
        const res = response.responses[i];
        const device = devices[i];

        if (res.success) {
          successCount++;
        } else {
          failureCount++;
          const errCode = res.error?.code;

          if (
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/registration-token-not-registered'
          ) {
            try {
              await this.pushDeviceRepo.deleteDeviceById(device.id);
              invalidTokensRemoved++;
            } catch {
              // Non-fatal cleanup failure
            }
          }
        }
      }
    } catch {
      // Entire provider multicast failed (e.g. network/credentials error); record as failures without corrupting registrations
      failureCount = devices.length;
    }

    return {
      userId,
      totalDevices: devices.length,
      successCount,
      failureCount,
      invalidTokensRemoved,
    };
  }
}
