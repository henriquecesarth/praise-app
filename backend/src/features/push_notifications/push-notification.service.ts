import { messagingAdmin } from '../../lib/firebase';
import { PushDeviceRepository } from '../../repositories/PushDeviceRepository';
import {
  PushNotificationPayload,
  SendPushResult,
  FCM_MULTICAST_CHUNK_SIZE,
} from './push-notifications.types';

export class PushNotificationService {
  constructor(
    private readonly pushDeviceRepo: PushDeviceRepository = new PushDeviceRepository(),
    private readonly messagingClient: any = messagingAdmin
  ) {}

  /**
   * Resolves active registered devices for a user and dispatches FCM multicast notifications.
   * Devices inactive beyond the activity lease threshold (60 days) are excluded.
   * Dispatches are chunked to <= 500 tokens per provider call (FCM limit).
   * Unregistered or permanently invalid tokens are automatically pruned.
   * Transient provider errors never prune valid tokens.
   */
  async sendToUser(
    userId: string,
    payload: PushNotificationPayload,
    options?: { now?: Date }
  ): Promise<SendPushResult> {
    const devices = await this.pushDeviceRepo.getDevicesByUserId(userId, {
      onlyActive: true,
      now: options?.now,
    });

    if (devices.length === 0) {
      return {
        userId,
        totalDevices: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokensRemoved: 0,
      };
    }

    let successCount = 0;
    let failureCount = 0;
    let invalidTokensRemoved = 0;

    // Chunk sends to <= 500 tokens per call per FCM specification
    for (let i = 0; i < devices.length; i += FCM_MULTICAST_CHUNK_SIZE) {
      const chunkDevices = devices.slice(i, i + FCM_MULTICAST_CHUNK_SIZE);
      const chunkTokens = chunkDevices.map((d) => d.fcm_token);

      try {
        const multicastMessage = {
          tokens: chunkTokens,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data,
        };

        const response = await this.messagingClient.sendEachForMulticast(
          multicastMessage
        );

        for (let j = 0; j < response.responses.length; j++) {
          const res = response.responses[j];
          const device = chunkDevices[j];

          if (res.success) {
            successCount++;
          } else {
            failureCount++;
            const errCode = res.error?.code;

            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered' ||
              errCode === 'messaging/invalid-argument'
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
        // Entire provider call failed due to transient/network error; record failures without pruning registrations
        failureCount += chunkDevices.length;
      }
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
