/**
 * src/lib/apiKey.ts — 用户自定义 API Key（2026-09）
 *
 * 个人中心可输入自己的 Key 并切换"用我自己的 / 用系统提供的"。
 * 存储：仅本设备 localStorage，做轻量混淆（base64 + 简单位移），避免明文直读；
 * 浏览器无真正安全存储，此混淆只是"不明文落盘"，非强加密。
 * 生效：请求统一经 getApiAuthHeaders 带上 `X-Api-Key` 头，后端 resolveApiKey 优先使用。
 */

const STORAGE_ENABLED_KEY = 'evolvmind_custom_key_enabled';
const STORAGE_KEY_VALUE = 'evolvmind_custom_key_value';

/** 轻量混淆（base64 + 每字符 +2 位移），避免直接明文读 localStorage */
function obfuscate(value: string): string {
  return btoa(
    Array.from(value)
      .map((ch) => String.fromCharCode(ch.charCodeAt(0) + 2))
      .join(''),
  );
}
function deobfuscate(value: string): string {
  try {
    return Array.from(atob(value))
      .map((ch) => String.fromCharCode(ch.charCodeAt(0) - 2))
      .join('');
  } catch {
    return '';
  }
}

/** 当前是否启用"用我自己的 Key" */
export function isCustomKeyEnabled(): boolean {
  return localStorage.getItem(STORAGE_ENABLED_KEY) === 'true';
}

/** 读取自定义 key（混淆还原）；未启用或空返回 '' */
export function getCustomApiKey(): string {
  if (!isCustomKeyEnabled()) return '';
  const raw = localStorage.getItem(STORAGE_KEY_VALUE);
  return raw ? deobfuscate(raw) : '';
}

/** 设置自定义 key（混淆存储）并启用 */
export function setCustomApiKey(value: string): void {
  const cleaned = value.trim();
  if (cleaned) {
    localStorage.setItem(STORAGE_KEY_VALUE, obfuscate(cleaned));
    localStorage.setItem(STORAGE_ENABLED_KEY, 'true');
  } else {
    clearCustomApiKey();
  }
}

/** 清除自定义 key 并停用 */
export function clearCustomApiKey(): void {
  localStorage.removeItem(STORAGE_KEY_VALUE);
  localStorage.setItem(STORAGE_ENABLED_KEY, 'false');
}