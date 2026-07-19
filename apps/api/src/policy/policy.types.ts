export const PolicyDenialReason = {
  OPTED_OUT: "OPTED_OUT",
  CONSENT_REVOKED: "CONSENT_REVOKED",
  MESSAGING_WINDOW_CLOSED: "MESSAGING_WINDOW_CLOSED",
} as const;

export type PolicyDenialReason = (typeof PolicyDenialReason)[keyof typeof PolicyDenialReason];

export interface PolicyDecision {
  allowed: boolean;
  reasonCode: PolicyDenialReason | null;
}

/** Purpose string convention used by the Policy Engine's consent gate - see ContactsService.recordConsent. */
export const MESSAGING_CONSENT_PURPOSE = "messaging";

export const POLICY_DENIAL_MESSAGES: Record<PolicyDenialReason, string> = {
  OPTED_OUT: "Contact has opted out of messaging",
  CONSENT_REVOKED: "Contact has revoked messaging consent",
  MESSAGING_WINDOW_CLOSED: "24-hour messaging window is closed for this contact",
};
