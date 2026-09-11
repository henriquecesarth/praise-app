import { z } from 'zod';

export type OrganizationRole = 'owner' | 'admin';

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string | null;
  owner_user_id: string;
  billing_anchor_ministry_id: string;
  default_whatsapp_connection_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMemberRecord {
  id: string; // `${organization_id}_${user_id}`
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  invited_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export type BillingAccessMode = 'normal' | 'grace' | 'suspended';

export interface OrganizationWhatsAppCapacity {
  organizationId: string;
  billingAnchorMinistryId: string;
  enabled: boolean;
  includedConnections: number;
  additionalConnections: number;
  totalAllowedConnections: number;
  billingAccessMode: BillingAccessMode;
}

export const addOrganizationMemberSchema = z.object({
  userId: z.string().min(1, 'ID do usuário é obrigatório.'),
  role: z.string().refine((val) => val === 'admin', {
    message: 'CANNOT_ASSIGN_OWNER_VIA_MEMBER_API',
  }),
});

export type AddOrganizationMemberInput = z.infer<typeof addOrganizationMemberSchema>;
