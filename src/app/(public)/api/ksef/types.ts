export interface KSeFChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp?: string;
}

export interface KSeFExceptionResponse {
  exceptionCode?: number | string;
  exceptionDescription?: string;
  details?: unknown;
}

export interface KSeFChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp?: string;
}

export interface KSeFTokenAuthPrepareResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  tokenPlainToEncrypt: string;
  tokenLength: number;
  companyId: string;
  nip: string;
  environment: "test" | "production";
}

export interface KSeFCredentialsRow {
  id: string;
  my_company_id: string;
  nip: string;
  token: string;
  is_test_environment: boolean;
  is_active?: boolean;
}

export interface KSeFChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp?: string;
}

export interface KSeFCredentialsRow {
  id: string;
  my_company_id: string;
  nip: string;
  token: string;
  is_test_environment: boolean;
  is_active?: boolean;
}

export interface KSeFPublicKeyCertificate {
  certificate: string; // base64 DER certyfikatu X.509
  validFrom: string;
  validTo: string;
  usage: string[];
}

export interface KSeFTokenAuthResponse {
  referenceNumber: string;
  authenticationToken: {
    token: string;
    validUntil: string;
  };
}

export interface KSeFAuthStatusResponse {
  startDate?: string;
  authenticationMethod?: string;
  authenticationMethodInfo?: {
    category?: string;
    code?: string;
    displayName?: string;
  };
  status?: {
    code?: number;
    description?: string;
    details?: string[];
  };
}

export interface KSeFRedeemTokensResponse {
  accessToken: {
    token: string;
    validUntil: string;
  };
  refreshToken: {
    token: string;
    validUntil: string;
  };
}