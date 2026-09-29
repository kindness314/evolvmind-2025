import { supabase } from './supabase';
import { getCustomApiKey, getVisionApiKey } from './apiKey';

export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // 用户自定义 Key（个人中心配置）：带 X-Api-Key 头，后端 resolveApiKey 优先使用
  const customKey = getCustomApiKey();
  if (customKey) headers['X-Api-Key'] = customKey;
  // 图片语义识别专用 Key（可选，空则后端回退 X-Api-Key / 系统 Key）
  const visionKey = getVisionApiKey();
  if (visionKey) headers['X-Vision-Key'] = visionKey;

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
