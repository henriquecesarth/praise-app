export interface ComplianceConfig {
  publicSupportEmail: string;
  privacyContactEmail: string;
  controllerDisplayName: string;
  firebaseWebApiKey: string;
  accountDeletionWebUrl: string;
}

const getEnv = (key: string): string | undefined => {
  return ((import.meta as any).env?.[key] as string | undefined)?.trim();
};

export const COMPLIANCE_CONFIG: ComplianceConfig = {
  publicSupportEmail: getEnv('VITE_PUBLIC_SUPPORT_EMAIL') || 'contato@louvaio.com.br',
  privacyContactEmail:
    getEnv('VITE_PRIVACY_CONTACT_EMAIL') ||
    getEnv('VITE_PUBLIC_SUPPORT_EMAIL') ||
    'contato@louvaio.com.br',
  controllerDisplayName: getEnv('VITE_CONTROLLER_DISPLAY_NAME') || 'LouvAIO',
  firebaseWebApiKey: getEnv('VITE_FIREBASE_API_KEY') || 'AIzaSyC4Fbmri7h8V5lhmiOTKcUJvQQeqo2BuwU',
  accountDeletionWebUrl:
    getEnv('VITE_ACCOUNT_DELETION_WEB_URL') || 'https://praise-app-m7tn.vercel.app/exclusao-conta',
};
