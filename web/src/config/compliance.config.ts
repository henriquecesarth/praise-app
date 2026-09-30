export interface ComplianceConfig {
  publicSupportEmail: string;
  privacyContactEmail: string;
  controllerDisplayName: string;
  firebaseWebApiKey: string;
  accountDeletionWebUrl: string;
}

export interface ResolveComplianceConfigOptions {
  env?: Record<string, string | undefined>;
  mode?: string;
  isProd?: boolean;
}

export const CANONICAL_ACCOUNT_DELETION_WEB_URL =
  'https://praise-app-m7tn.vercel.app/exclusao-conta';

export function resolveComplianceConfig(
  options?: ResolveComplianceConfigOptions
): ComplianceConfig {
  const envSource = options?.env ?? ((import.meta as any).env || {});
  const getVal = (key: string): string | undefined => envSource[key]?.trim() || undefined;

  const mode = options?.mode ?? envSource.MODE;
  const isTest = mode === 'test' || envSource.NODE_ENV === 'test';
  const isProd = options?.isProd ?? (!isTest && (mode === 'production' || envSource.PROD === true));

  const publicSupportEmail = getVal('VITE_PUBLIC_SUPPORT_EMAIL');
  const privacyContactEmail = getVal('VITE_PRIVACY_CONTACT_EMAIL') || publicSupportEmail;
  const controllerDisplayName = getVal('VITE_CONTROLLER_DISPLAY_NAME');
  const firebaseWebApiKey =
    getVal('VITE_FIREBASE_API_KEY') || 'AIzaSyC4Fbmri7h8V5lhmiOTKcUJvQQeqo2BuwU';
  const accountDeletionWebUrl =
    getVal('VITE_ACCOUNT_DELETION_WEB_URL') || CANONICAL_ACCOUNT_DELETION_WEB_URL;

  if (isProd) {
    const missing: string[] = [];
    if (!publicSupportEmail) missing.push('VITE_PUBLIC_SUPPORT_EMAIL');
    if (!privacyContactEmail) missing.push('VITE_PRIVACY_CONTACT_EMAIL');
    if (!controllerDisplayName) missing.push('VITE_CONTROLLER_DISPLAY_NAME');

    if (missing.length > 0) {
      throw new Error(
        `[ComplianceConfig] Missing mandatory production compliance configuration: ${missing.join(', ')}. ` +
        `Fabricated production defaults are prohibited. Define these variables in your deployment environment.`
      );
    }

    return {
      publicSupportEmail: publicSupportEmail!,
      privacyContactEmail: privacyContactEmail!,
      controllerDisplayName: controllerDisplayName!,
      firebaseWebApiKey,
      accountDeletionWebUrl,
    };
  }

  // Development / Test configuration: explicit test values, never fabricated production legal entity names
  return {
    publicSupportEmail: publicSupportEmail || 'test-support@louvaio.test',
    privacyContactEmail: privacyContactEmail || 'test-privacy@louvaio.test',
    controllerDisplayName: controllerDisplayName || 'LouvAIO Test Controller',
    firebaseWebApiKey,
    accountDeletionWebUrl,
  };
}

export const COMPLIANCE_CONFIG: ComplianceConfig = resolveComplianceConfig();
