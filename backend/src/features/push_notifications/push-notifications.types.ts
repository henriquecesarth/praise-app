import { z } from 'zod';

export type PushPlatform = 'android' | 'ios' | 'web';

export interface PushDeviceRecord {
  id: string;
  user_id: string;
  fcm_token: string;
  platform: PushPlatform;
  app_version?: string;
  device_model?: string;
  created_at: string;
  updated_at: string;
  last_seen_at?: string;
}

export const registerPushDeviceSchema = z.object({
  fcm_token: z.string().trim().min(10, 'Token FCM inválido').max(4096),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
  app_version: z.string().trim().max(50).optional(),
  device_model: z.string().trim().max(100).optional(),
});

export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;

export const unregisterPushDeviceSchema = z
  .object({
    fcm_token: z.string().trim().min(10, 'Token FCM inválido').max(4096).optional(),
    fcmToken: z.string().trim().min(10, 'Token FCM inválido').max(4096).optional(),
  })
  .refine((data) => !!(data.fcm_token || data.fcmToken), {
    message: 'fcmToken ou fcm_token é obrigatório',
  });

export type UnregisterPushDeviceInput = z.infer<typeof unregisterPushDeviceSchema>;

export const FCM_MULTICAST_CHUNK_SIZE = 500;
export const PUSH_DEVICE_STALE_THRESHOLD_DAYS = 60;

export function isPushDeviceActive(
  device: PushDeviceRecord,
  now: Date = new Date(),
  thresholdDays: number = PUSH_DEVICE_STALE_THRESHOLD_DAYS
): boolean {
  if (!device.last_seen_at) return true;
  const lastSeenMs = new Date(device.last_seen_at).getTime();
  if (isNaN(lastSeenMs)) return true;
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return now.getTime() - lastSeenMs <= thresholdMs;
}

export type PushNotificationType = 'schedule' | 'schedule_comment' | 'announcement';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data: {
    type: PushNotificationType;
    ministryId?: string;
    resourceId?: string;
    notificationId?: string;
    [key: string]: string | undefined;
  };
}

export interface SendPushResult {
  userId: string;
  totalDevices: number;
  successCount: number;
  failureCount: number;
  invalidTokensRemoved: number;
}
