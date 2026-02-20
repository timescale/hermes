export interface ClaudeCredentialsJson {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
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
