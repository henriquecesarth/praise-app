import { config } from './unifiedConfig';

export const env = {
  supabaseUrl: '',
  supabasePublishableKey: '',
  supabaseSecretKey: '',
  port: config.port,
  nodeEnv: config.nodeEnv,
  defaultMinistryId: config.defaultMinistryId,
};
