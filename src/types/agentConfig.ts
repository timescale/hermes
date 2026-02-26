export interface ClaudeOAuthAccount {
  accountUuid?: string;
  emailAddress?: string;
  organizationUuid?: string;
  hasExtraUsageEnabled?: boolean;
  billingType?: string;
  accountCreatedAt?: string;
  subscriptionCreatedAt?: string;
  displayName?: string;
  organizationRole?: string;
  workspaceRole?: string | null;
  organizationName?: string;
}

export interface ClaudeCredentialsJson {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  /** Paired from the host's .claude.json oauthAccount field */
  oauthAccount?: ClaudeOAuthAccount | null;
}

interface ApiKeyAuth {
  type: 'api';
  key: string;
}

interface OAuthAuth {
  type: 'oauth';
  access: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
}

export type AuthEntry = ApiKeyAuth | OAuthAuth;
export type OpencodeAuthJson = Partial<Record<string, AuthEntry>>;
