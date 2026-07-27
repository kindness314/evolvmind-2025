import { supabase } from './supabase';

export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (localStorage.getItem('demo_auth') === 'true') {
    headers['X-EvolvMind-Demo'] = 'true';
    return headers;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('登录状态已失效，请重新登录');
  headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}
