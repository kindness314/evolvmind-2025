import { Lock, LogOut, Loader2, ShieldCheck, RefreshCw, Pencil, Check, X, FileJson, FileText, HardDrive, Upload, KeyRound, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { useRef, useState, useEffect } from 'react';
import { getCustomApiKey, setCustomApiKey, clearCustomApiKey, isCustomKeyEnabled, getVisionApiKey, setVisionApiKey } from '../../lib/apiKey';
import { exportJsonBackup, exportMarkdownArchive, fetchStorageUsage, formatBytes, parseBackup, importJsonBackup, wipeAllData, type BackupData } from '../../lib/export';
import { getApiAuthHeaders } from '../../lib/apiAuth';

interface SettingsPageProps {
  onLogout?: () => void;
}

export function SettingsPage({ onLogout }: SettingsPageProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const supabase = createClient(
    `https://${projectId}.supabase.co`,
    publicAnonKey
  );
  const [stats, setStats] = useState<{ captures: number; nodes: number; links: number } | null>(null);
  // 演示模式：固定共享 scope，无真实 Supabase 会话
  const [isDemo] = useState(() => localStorage.getItem('demo_auth') === 'true');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  // 自定义资料（本地存储：Demo 无会话也可编辑；真实用户同样可用，后续可同步 user_metadata）
  const [profileName, setProfileName] = useState(() => localStorage.getItem('profile_name') || '');
  const [profileAvatar, setProfileAvatar] = useState(() => localStorage.getItem('profile_avatar') || '');
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(profileName);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const displayName = profileName || (isDemo ? '演示账户' : (userName || '用户'));
  const saveProfile = () => {
    const name = nameDraft.trim();
    setProfileName(name);
    if (name) localStorage.setItem('profile_name', name);
    else localStorage.removeItem('profile_name');
    setEditingProfile(false);
  };
  const onAvatarPicked = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('只支持图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('头像图片不能超过 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setProfileAvatar(url);
      localStorage.setItem('profile_avatar', url);
    };
    reader.readAsDataURL(file);
  };
  const removeAvatar = () => { setProfileAvatar(''); localStorage.removeItem('profile_avatar'); };
  // 数据统计：真实计数（此前为硬编码 342/28/156 假数据）
  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        const [captures, nodes, links] = await Promise.all([
          supabase.from('captured_info').select('id', { count: 'exact', head: true }),
          supabase.from('knowledge_nodes').select('id', { count: 'exact', head: true }),
          supabase.from('knowledge_links').select('id', { count: 'exact', head: true }),
        ]);
        if (cancelled) return;
        setStats({
          captures: captures.count ?? 0,
          nodes: nodes.count ?? 0,
          links: links.count ?? 0,
        });
      } catch {
        // 统计加载失败不阻塞页面
      }
    };
    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // 真实用户信息（Demo 模式无会话，显示演示账户）
  useEffect(() => {
    let cancelled = false;
    const loadUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!cancelled && user) {
          const meta = user.user_metadata as Record<string, unknown> | undefined;
          setUserEmail(user.email ?? null);
          setUserName(typeof meta?.full_name === 'string' ? meta.full_name : typeof meta?.name === 'string' ? meta.name : null);
        }
      } catch {
        // 未登录/会话失效：保持默认显示
      }
    };
    if (!isDemo) void loadUser();
    return () => {
      cancelled = true;
    };
  }, [isDemo, supabase]);


  // 数据管理：真实存储用量 + 导出
  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null);
  const [exporting, setExporting] = useState<'json' | 'md' | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchStorageUsage().then((u) => { if (!cancelled) setUsage(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const doExport = async (kind: 'json' | 'md') => {
    if (exporting) return;
    setExporting(kind);
    try {
      if (kind === 'json') {
        const c = await exportJsonBackup();
        toast.success(`已导出完整备份：${c.captures} 条捕获、${c.nodes} 节点、${c.links} 条关联、${c.attachments} 个附件${c.skippedLarge ? `（${c.skippedLarge} 个超限/失败文件未含）` : ''}`);
      } else {
        const n = await exportMarkdownArchive();
        toast.success(`已导出 Markdown 存档：${n} 条`);
      }
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setExporting(null);
    }
  };

  // 导入备份：选文件 -> 解析预览 -> 确认后写入（已存在的 id 跳过，不覆盖）
  const importInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<BackupData | null>(null);
  const [importing, setImporting] = useState(false);
  const onImportPicked = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPendingImport(parseBackup(await file.text()));
    } catch (e) {
      toast.error(`无法导入：${e instanceof Error ? e.message : '文件解析失败'}`);
    }
  };
  const confirmImport = async () => {
    if (!pendingImport || importing) return;
    setImporting(true);
    try {
      const r = await importJsonBackup(pendingImport);
      const skippedTotal = r.skipped.captures + r.skipped.nodes + r.skipped.links;
      toast.success(`导入完成：新增 ${r.inserted.captures} 条捕获、${r.inserted.nodes} 节点、${r.inserted.links} 条关联、${r.inserted.attachments} 个附件${skippedTotal ? `；跳过已存在 ${skippedTotal} 条` : ''}`);
      if (r.inserted.nodes > 0) toast.info('导入的节点没有向量，进入知识网络后会自动后台补齐语义索引', { duration: 5000 });
      setPendingImport(null);
      window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setImporting(false);
    }
  };

  // 账号管理（仅真实账户）：改邮箱 / 改密码 / 注销
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');
  const changeEmail = async () => {
    const email = newEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast.error('邮箱格式不正确'); return; }
    setAccountBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      toast.success('验证邮件已发送到新邮箱，点击邮件链接后生效');
      setNewEmail('');
    } catch (e) { toast.error(`修改失败：${e instanceof Error ? e.message : '未知错误'}`); }
    finally { setAccountBusy(false); }
  };
  const changePassword = async () => {
    if (newPassword.length < 6) { toast.error('密码至少 6 位'); return; }
    setAccountBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('密码已更新');
      setNewPassword('');
    } catch (e) { toast.error(`修改失败：${e instanceof Error ? e.message : '未知错误'}`); }
    finally { setAccountBusy(false); }
  };
  const deleteAccount = async () => {
    if (confirmDeleteText !== '注销') { toast.error('请输入「注销」确认'); return; }
    setAccountBusy(true);
    try {
      const headers = await getApiAuthHeaders();
      const resp = await fetch('/api/account', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' }),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(j?.error || `状态 ${resp.status}`);
      toast.success('账户已注销');
      await supabase.auth.signOut();
      localStorage.removeItem('supabase_session');
      localStorage.removeItem('demo_auth');
      onLogout?.();
    } catch (e) { toast.error(`注销失败：${e instanceof Error ? e.message : '未知错误'}`); }
    finally { setAccountBusy(false); }
  };

  // 危险区：清空全部数据（输入「清空」确认）
  const [confirmWipeText, setConfirmWipeText] = useState('');
  const [wiping, setWiping] = useState(false);
  const wipeAll = async () => {
    if (confirmWipeText !== '清空') { toast.error('请输入「清空」确认'); return; }
    setWiping(true);
    try {
      const r = await wipeAllData();
      toast.success(`已清空：${r.captures} 条捕获、${r.nodes} 节点、${r.links} 条关联、${r.files} 个文件`);
      setConfirmWipeText('');
      setStats({ captures: 0, nodes: 0, links: 0 });
      setUsage({ bytes: 0, files: 0 });
      window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));
    } catch (e) { toast.error(`清空失败：${e instanceof Error ? e.message : '未知错误'}`); }
    finally { setWiping(false); }
  };

  // 自定义 API Key（2026-09：真正生效，本地混淆存储，请求带 X-Api-Key 头）
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [customEnabled, setCustomEnabled] = useState(() => isCustomKeyEnabled());
  const [keySaved, setKeySaved] = useState(false);
  const saveCustomKey = () => {
    if (apiKeyInput.trim()) setCustomApiKey(apiKeyInput);
    else clearCustomApiKey();
    setCustomEnabled(isCustomKeyEnabled());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  // 图片语义识别（vision）专用 Key（可选：留空回退上方主 Key / 系统 Key）
  const [visionKeyInput, setVisionKeyInput] = useState('');
  const [visionEnabled, setVisionEnabled] = useState(() => Boolean(getVisionApiKey()));
  const [visionSaved, setVisionSaved] = useState(false);
  const saveVisionKey = () => {
    setVisionApiKey(visionKeyInput);
    setVisionEnabled(Boolean(getVisionApiKey()));
    setVisionKeyInput('');
    setVisionSaved(true);
    setTimeout(() => setVisionSaved(false), 2000);
  };

  // 服务状态检测（2026-09：已知服务逐项，已实现才显示；进入页面自动检测一次）
  interface ServiceStatus { name: string; state: 'ok' | 'warn' | 'error' | 'pending'; detail: string; }
  const [services, setServices] = useState<ServiceStatus[]>(() => ([
    { name: '文本 AI（摘要/图谱/推荐）', state: 'pending', detail: '检测中…' },
    { name: '语义向量（embedding）', state: 'pending', detail: '检测中…' },
    { name: 'Supabase 数据库', state: 'pending', detail: '检测中…' },
    { name: '图片 OCR（浏览器本地）', state: 'pending', detail: '检测中…' },
    { name: '图片语义识别（vision）', state: 'pending', detail: '检测中…' },
    { name: '语音识别（录音转写）', state: 'pending', detail: '检测中…' },
    { name: '文档解析（pdf/docx）', state: 'pending', detail: '检测中…' },
  ]));
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const runServiceChecks = async () => {
    setChecking(true);
    const results: ServiceStatus[] = [];
    try {
      try {
        const r = await fetch('/api/extract', { headers: await getApiAuthHeaders().catch(() => ({})) });
        const j = await r.json().catch(() => null);
        const hasKey = j?.hasKey === true;
        results.push({ name: '文本 AI（摘要/图谱/推荐）', state: r.ok ? (hasKey ? 'ok' : 'warn') : 'error', detail: hasKey ? (j?.model ? `可用 · ${j.model}` : '可用') : '服务端未配置 Key（可用系统或自定义 Key）' });
      } catch {
        results.push({ name: '文本 AI（摘要/图谱/推荐）', state: 'error', detail: '端点不可达' });
      }
      try {
        const r = await fetch('/api/embed', { method: 'GET', headers: await getApiAuthHeaders().catch(() => ({})) });
        const j = await r.json().catch(() => null);
        const hasKey = j?.hasKey === true;
        results.push({ name: '语义向量（embedding）', state: hasKey ? 'ok' : 'warn', detail: hasKey ? 'Key 可用（BAAI/bge-m3 1024 维，无权限时自动回退系统 Key）' : '未配置 Key' });
      } catch {
        results.push({ name: '语义向量（embedding）', state: 'error', detail: '端点不可达' });
      }
      try {
        const { count } = await supabase.from('captured_info').select('id', { count: 'exact', head: true });
        results.push({ name: 'Supabase 数据库', state: 'ok', detail: `可访问（${count ?? 0} 条内容）` });
      } catch {
        results.push({ name: 'Supabase 数据库', state: 'error', detail: '连接失败' });
      }
      results.push({ name: '图片 OCR', state: 'ok', detail: '浏览器本地 tesseract 中文文字识别，不消耗云端额度' });
      try {
        const r = await fetch('/api/documents/extract?deep=1', { method: 'GET', headers: await getApiAuthHeaders().catch(() => ({})) });
        const j = await r.json().catch(() => null);
        const hasVision = j?.hasVision === true;
        const hasKey = j?.hasKey === true;
        results.push({ name: '图片语义识别（vision）', state: hasVision ? 'ok' : 'warn', detail: hasVision ? '可用（GLM-4.5V）' : hasKey ? '当前 Key 无 vision 模型权限，可在上方填专用 Key' : '未配置 Key（可在上方填入 vision Key）' });
      } catch {
        results.push({ name: '图片语义识别（vision）', state: 'error', detail: '端点不可达' });
      }
      const sr = typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      results.push({ name: '语音识别（录音转写）', state: sr ? 'ok' : 'warn', detail: sr ? '浏览器原生转写' : '当前浏览器不支持，可手动输入' });
      try {
        const r = await fetch('/api/documents/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_path: '', demo: true }) });
        results.push({ name: '文档解析（pdf/docx）', state: r.status === 400 ? 'ok' : 'warn', detail: r.status === 400 ? '后端可用（不含云 vision/ASR）' : `状态 ${r.status}` });
      } catch {
        results.push({ name: '文档解析（pdf/docx）', state: 'error', detail: '端点不可达' });
      }
    } finally {
      setServices(results);
      setLastCheckedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      setChecking(false);
    }
  };

  // 进入页面自动检测一次（不要求手动点按钮）
  useEffect(() => {
    void runServiceChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      localStorage.removeItem('supabase_session');
      localStorage.removeItem('demo_auth'); // 清除演示模式标识
      if (onLogout) {
        onLogout();
      }
    } catch (error) {
      console.error('退出登录失败:', error);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 pb-20">
      {/* 用户信息卡片（可编辑名字与头像，本地保存） */}
      <div className="bg-white p-6 mb-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => editingProfile && avatarInputRef.current?.click()}
            title={editingProfile ? '点击更换头像' : undefined}
            className={`relative w-16 h-16 flex-none bg-brand flex items-center justify-center text-white text-2xl font-medium rounded-2xl shadow-card overflow-hidden ${editingProfile ? 'cursor-pointer' : 'cursor-default'}`}
          >
            {profileAvatar
              ? <img src={profileAvatar} alt="头像" className="w-full h-full object-cover" />
              : (displayName || 'U').slice(0, 1).toUpperCase()}
            {editingProfile && (
              <span className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-[10px] py-0.5 text-center">更换</span>
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { onAvatarPicked(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div className="flex-1 min-w-0">
            {editingProfile ? (
              <div className="flex items-center gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveProfile(); if (e.key === 'Escape') { setNameDraft(profileName); setEditingProfile(false); } }}
                  placeholder="输入你的名字"
                  maxLength={24}
                  autoFocus
                  className="flex-1 min-w-0 px-2.5 py-1.5 border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                />
                <button onClick={saveProfile} aria-label="保存" className="p-1.5 text-white bg-brand hover:bg-brand-strong rounded-lg"><Check className="w-4 h-4" /></button>
                <button onClick={() => { setNameDraft(profileName); setEditingProfile(false); }} aria-label="取消" className="p-1.5 text-gray-500 border border-gray-200 hover:bg-gray-50 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-base font-medium text-gray-900 truncate">{displayName}</h3>
                <button onClick={() => { setNameDraft(profileName); setEditingProfile(true); }} aria-label="编辑资料" className="p-1 text-gray-400 hover:text-brand transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <p className="text-sm text-gray-500 truncate">{isDemo ? '共享演示数据，仅供体验' : (userEmail || '加载中...')}</p>
            {isDemo ? (
              <span className="inline-block mt-1.5 text-[11px] text-amber-700 bg-warning-soft border border-amber-200 px-2 py-0.5 rounded-full">
                演示模式：数据为所有演示用户共享，操作不会影响你的真实账户
              </span>
            ) : null}
            {editingProfile && profileAvatar && (
              <button onClick={removeAvatar} className="mt-1.5 text-[11px] text-gray-400 hover:text-red-500 transition-colors">移除头像，恢复默认</button>
            )}
          </div>
        </div>
      </div>

      {/* 数据统计卡片 */}
      <div className="bg-white p-4 mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">数据统计</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-medium text-gray-900">{stats ? stats.captures : '—'}</p>
            <p className="text-xs text-gray-500 mt-1">已捕获</p>
          </div>
          <div className="text-center border-l border-r border-gray-200">
            <p className="text-2xl font-medium text-gray-900">{stats ? stats.nodes : '—'}</p>
            <p className="text-xs text-gray-500 mt-1">知识节点</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-medium text-gray-900">{stats ? stats.links : '—'}</p>
            <p className="text-xs text-gray-500 mt-1">关联关系</p>
          </div>
        </div>
      </div>

      {/* 数据管理：真实存储用量 + 导出备份 */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-gray-500" />
            数据管理
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-900">文件存储用量</span>
            <span className="text-xs text-gray-500">
              {usage ? `${formatBytes(usage.bytes)} · ${usage.files} 个文件` : '统计中…'}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void doExport('json')}
              disabled={exporting !== null}
              className="flex-1 px-3 py-2 border border-gray-200 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 rounded-xl"
            >
              {exporting === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4 text-gray-500" />}
              导出完整备份 (JSON)
            </button>
            <button
              onClick={() => void doExport('md')}
              disabled={exporting !== null}
              className="flex-1 px-3 py-2 border border-gray-200 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 rounded-xl"
            >
              {exporting === 'md' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-gray-500" />}
              导出可读存档 (Markdown)
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              className="flex-1 px-3 py-2 border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 rounded-xl"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-gray-500" />}
              导入备份 (JSON)
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { void onImportPicked(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>
          {pendingImport && (
            <div className="border border-amber-200 bg-warning-soft rounded-xl p-3 space-y-2">
              <p className="text-xs text-gray-800 font-medium">确认导入这份备份？</p>
              <p className="text-[11px] text-gray-600">
                {pendingImport.captures.length} 条捕获 · {pendingImport.nodes.length} 节点 · {pendingImport.links.length} 条关联 · {pendingImport.attachments.length} 个附件
                {pendingImport.exportedAt ? `（导出于 ${new Date(pendingImport.exportedAt).toLocaleString('zh-CN')}）` : ''}
              </p>
              <p className="text-[11px] text-gray-500">已存在的相同 id 会跳过，不会覆盖你现在的数据；附件会重新上传到你当前的存储空间。</p>
              <div className="flex gap-2">
                <button
                  onClick={() => void confirmImport()}
                  disabled={importing}
                  className="flex-1 px-3 py-1.5 bg-brand text-white text-xs font-medium hover:bg-brand-strong disabled:opacity-50 transition-colors rounded-lg"
                >
                  {importing ? '导入中…' : '确认导入'}
                </button>
                <button
                  onClick={() => setPendingImport(null)}
                  disabled={importing}
                  className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors rounded-lg"
                >
                  取消
                </button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-400">
            JSON 含捕获、图谱节点、关联与文件附件（单文件 ≤10MiB），自包含可用于备份/跨项目迁移；Markdown 为逐条可读存档。导出范围受账户隔离限制，只含你自己的数据（演示模式为共享演示数据）。
          </p>
        </div>
      </div>

      {/* 我的 API Key */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-500" />
            我的 API Key
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">
            输入你自己的服务 Key（如 MiniMax/DeepSeek），启用后所有 AI 调用优先使用它；只保存在本设备（混淆存储，不明文落盘、不上传）。
          </p>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={customEnabled ? '已启用自定义 Key（输入可替换）' : '粘贴你的 Key（留空则用系统 Key）'}
            autoComplete="off"
            className="w-full px-3 py-2 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent rounded-lg"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={saveCustomKey}
              className="flex-1 px-4 py-2 bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors rounded-xl"
            >
              {keySaved ? '已保存 ✓' : (customEnabled ? '保存 / 更新 Key' : '启用我的 Key')}
            </button>
            {customEnabled && (
              <button
                onClick={() => { clearCustomApiKey(); setCustomEnabled(false); setApiKeyInput(''); }}
                className="px-4 py-2 text-sm text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors rounded-xl"
              >
                改用系统 Key
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">
            当前状态：{customEnabled ? '使用你自己的 Key' : '使用系统提供的 Key'}
          </p>
          <div className="pt-3 mt-1 border-t border-gray-100 space-y-2">
            <p className="text-xs text-gray-500">
              图片语义识别专用 Key（可选）：仅用于图片内容理解（vision 模型）；留空则回退上方 Key / 系统 Key。
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={visionKeyInput}
                onChange={(e) => setVisionKeyInput(e.target.value)}
                placeholder={visionEnabled ? '已设置 vision Key（输入可替换）' : '粘贴 vision Key（可选）'}
                autoComplete="off"
                className="flex-1 min-w-0 px-3 py-2 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
              />
              <button
                onClick={saveVisionKey}
                className="px-4 py-2 bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors rounded-xl"
              >
                {visionSaved ? '已保存 ✓' : '保存'}
              </button>
              {visionEnabled && (
                <button
                  onClick={() => { setVisionApiKey(''); setVisionEnabled(false); }}
                  className="px-3 py-2 text-sm text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors rounded-xl"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 服务状态检测 */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gray-500" />
            服务状态检测
          </h3>
          <button
            onClick={runServiceChecks}
            disabled={checking}
            className="px-3 py-1.5 text-xs text-brand border border-brand/30 hover:bg-brand-soft disabled:opacity-50 transition-colors flex items-center gap-1 rounded-lg"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {checking ? '检测中...' : '重新检测'}
          </button>
        </div>
        <div className="px-4 py-2 bg-gray-50/60 border-b border-gray-50">
          <p className="text-[11px] text-gray-400">上次检测：{lastCheckedAt ? lastCheckedAt : '进入本页自动检测'}</p>
        </div>
        <div className="divide-y divide-gray-50">
          {services.map((s) => (
            <div key={s.name} className="px-4 py-2.5 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-gray-800">{s.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.detail}</p>
              </div>
              {s.state === 'pending' ? (
                <span className="flex-none text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-full">检测中</span>
              ) : (
                <span className={`flex-none text-xs font-medium px-2 py-1 rounded-full ${s.state === 'ok' ? 'bg-success-soft text-success' : s.state === 'warn' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger'}`}>
                  {s.state === 'ok' ? '正常' : s.state === 'warn' ? '提示' : '异常'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 账号管理（仅真实账户） */}
      {!isDemo && (
        <div className="bg-white mb-4">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-gray-500" />
              账号管理
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <p className="text-xs text-gray-600 mb-1.5">修改邮箱（验证邮件确认后生效）</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="新邮箱"
                  autoComplete="off"
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                />
                <button onClick={() => void changeEmail()} disabled={accountBusy || !newEmail.trim()} className="px-4 py-2 bg-brand text-white text-sm font-medium hover:bg-brand-strong disabled:opacity-50 transition-colors rounded-xl">修改</button>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1.5">设置 / 修改密码</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新密码（至少 6 位）"
                  autoComplete="new-password"
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                />
                <button onClick={() => void changePassword()} disabled={accountBusy || !newPassword} className="px-4 py-2 bg-brand text-white text-sm font-medium hover:bg-brand-strong disabled:opacity-50 transition-colors rounded-xl">保存</button>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-600 mb-1.5">注销账户（删除全部数据与账户，不可恢复）</p>
              <div className="flex gap-2">
                <input
                  value={confirmDeleteText}
                  onChange={(e) => setConfirmDeleteText(e.target.value)}
                  placeholder='输入「注销」确认'
                  className="flex-1 min-w-0 px-3 py-2 border border-red-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 rounded-lg"
                />
                <button onClick={() => void deleteAccount()} disabled={accountBusy || confirmDeleteText !== '注销'} className="px-4 py-2 bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors rounded-xl">注销账户</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 危险区：清空全部数据 */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-red-600 flex items-center gap-2">
            <TriangleAlert className="w-4 h-4" />
            危险区
          </h3>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-xs text-gray-500">清空当前{isDemo ? '演示空间' : '账户'}的全部捕获、图谱、关联与文件，不可恢复。建议先导出备份。</p>
          <div className="flex gap-2">
            <input
              value={confirmWipeText}
              onChange={(e) => setConfirmWipeText(e.target.value)}
              placeholder='输入「清空」确认'
              className="flex-1 min-w-0 px-3 py-2 border border-red-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 rounded-lg"
            />
            <button
              onClick={() => void wipeAll()}
              disabled={wiping || confirmWipeText !== '清空'}
              className="px-4 py-2 bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center gap-2 rounded-xl"
            >
              {wiping && <Loader2 className="w-4 h-4 animate-spin" />}
              清空全部数据
            </button>
          </div>
        </div>
      </div>

      {/* 退出登录 */}
      <div className="bg-white">
        <button 
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loggingOut ? (
              <>
                <div className="w-4 h-4 border-2 border-red-500 border-t-transparent animate-spin" style={{ borderRadius: '50%' }} />
                退出中...
              </>
            ) : (
              <>
                <LogOut className="w-4 h-4" />
                退出登录
              </>
            )}
          </button>
      </div>
    </div>
  );
}