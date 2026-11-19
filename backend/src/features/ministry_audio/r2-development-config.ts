export function getR2DevelopmentConfig(env: NodeJS.ProcessEnv) {
  const accountId = env.MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID;
  const bucket = env.MINISTRY_AUDIO_R2_DEV_BUCKET;
  const accessKeyId = env.MINISTRY_AUDIO_R2_DEV_ACCESS_KEY_ID;
  const secretAccessKey = env.MINISTRY_AUDIO_R2_DEV_SECRET_ACCESS_KEY;
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId) ||
    !bucket || !/^louvaio-ministry-audio-dev(?:-[a-z0-9]+)*$/.test(bucket) ||
    !accessKeyId || !secretAccessKey) {
    throw new Error('Dedicated R2 development bucket and configuration required.');
  }
  return { accountId, bucket, accessKeyId, secretAccessKey };
}
