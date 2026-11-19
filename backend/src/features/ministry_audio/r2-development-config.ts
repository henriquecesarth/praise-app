import type { R2Promotion, R2Reader } from './r2-storage';

export function getR2DevelopmentConfig(env: NodeJS.ProcessEnv) {
  const accountId = env.MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID;
  const bucket = env.MINISTRY_AUDIO_R2_DEV_BUCKET;
  const accessKeyId = env.MINISTRY_AUDIO_R2_DEV_ACCESS_KEY_ID;
  const secretAccessKey = env.MINISTRY_AUDIO_R2_DEV_SECRET_ACCESS_KEY;
  // Optional: 'copy' promotes verified staging objects with a source-conditional CopyObject. Default 'upload'.
  const promotion = env.MINISTRY_AUDIO_R2_DEV_PROMOTION ?? 'upload';
  // Optional: 'ranged' reads objects with ordered, bounded parallel ranged GETs. Default 'stream' (one GET).
  const reader = env.MINISTRY_AUDIO_R2_DEV_READ ?? 'stream';
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId) ||
    !bucket || !/^louvaio-ministry-audio-dev(?:-[a-z0-9]+)*$/.test(bucket) ||
    !accessKeyId || !secretAccessKey ||
    (promotion !== 'upload' && promotion !== 'copy') ||
    (reader !== 'stream' && reader !== 'ranged')) {
    throw new Error('Dedicated R2 development bucket and configuration required.');
  }
  return {
    accountId, bucket, accessKeyId, secretAccessKey,
    promotion: promotion as R2Promotion,
    reader: reader as R2Reader,
  };
}
