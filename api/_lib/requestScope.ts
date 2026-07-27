import type { VercelRequest } from './embedding.js';

const DEMO_SCOPE_ID = '00000000-0000-0000-0000-000000000000';

interface SupabaseUserResponse {
  id?: unknown;
}

export interface RequestScope {
  scopeId: string;
  accessToken?: string;
  isDemo: boolean;
}

function readBearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] || null;
}

export async function resolveRequestScope(params: {
  req: VercelRequest;
  supabaseUrl: string;
  anonKey: string;
}): Promise<RequestScope> {
  const demoHeader = params.req.headers['x-evolvmind-demo'];
  const isDemoHeader = Array.isArray(demoHeader) ? demoHeader[0] === 'true' : demoHeader === 'true';
  if (isDemoHeader || params.req.body?.demo === true) {
    return { scopeId: DEMO_SCOPE_ID, isDemo: true };
  }

  const accessToken = readBearerToken(params.req);
  if (!accessToken) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`${params.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: params.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Invalid authentication token');
  }

  const user = (await response.json()) as SupabaseUserResponse;
  if (typeof user.id !== 'string' || !user.id) {
    throw new Error('Authenticated user has no id');
  }

  return { scopeId: user.id, accessToken, isDemo: false };
}
