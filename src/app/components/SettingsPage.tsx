import { Lock, Cpu, LogOut, Loader2, ShieldCheck, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { useRef, useState, useEffect } from 'react';
import { getCustomApiKey, setCustomApiKey, clearCustomApiKey, isCustomKeyEnabled } from '../../lib/apiKey';

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

  // 服务状态检测（2026-09：已知服务逐项，已实现才显示；进入页面自动检测一次）
  interface ServiceStatus { name: string; state: 'ok' | 'warn' | 'error' | 'pending'; detail: string; }
  const [services, setServices] = useState<ServiceStatus[]>(() => ([
    { name: '文本 AI（摘要/图谱/推荐）', state: 'pending', detail: '检测中…' },
    { name: '语义向量（embedding）', state: 'pending', detail: '检测中…' },
    { name: 'Supabase 数据库', state: 'pending', detail: '检测中…' },
    { name: '图片 OCR（浏览器本地）', state: 'pending', detail: '检测中…' },
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
        const r = await fetch('/api/extract');
        const j = await r.json().catch(() => null);
        const hasKey = j?.hasKey === true;
        results.push({ name: '文本 AI（摘要/图谱/推荐）', state: r.ok ? (hasKey ? 'ok' : 'warn') : 'error', detail: hasKey ? (j?.model ? `可用 · ${j.model}` : '可用') : '服务端未配置 Key（可用系统或自定义 Key）' });
      } catch {
        results.push({ name: '文本 AI（摘要/图谱/推荐）', state: 'error', detail: '端点不可达' });
      }
      try {
        const r = await fetch('/api/embed', { method: 'GET' });
        const j = await r.json().catch(() => null);
        const hasKey = j?.hasKey === true;
        results.push({ name: '语义向量（embedding）', state: hasKey ? 'ok' : 'warn', detail: hasKey ? 'Key 可用（BAAI/bge-m3 1024 维）' : '未配置 Key' });
      } catch {
        results.push({ name: '语义向量（embedding）', state: 'error', detail: '端点不可达' });
      }
      try {
        const { count } = await supabase.from('captured_info').select('id', { count: 'exact', head: true });
        results.push({ name: 'Supabase 数据库', state: 'ok', detail: `可访问（${count ?? 0} 条内容）` });
      } catch {
        results.push({ name: 'Supabase 数据库', state: 'error', detail: '连接失败' });
      }
      results.push({ name: '图片 OCR', state: 'warn', detail: '浏览器本地 tesseract（中文；清晰文字图识别，内容图需手动描述）' });
      const sr = typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      results.push({ name: '语音识别（录音转写）', state: sr ? 'ok' : 'warn', detail: sr ? '支持（浏览器原生）' : '当前浏览器不支持' });
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
      {/* 用户信息卡片（O4：真实 Supabase 用户；Demo 明确标注演示账户 + 共享数据） */}
      <div className="bg-white p-6 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-brand flex items-center justify-center text-white text-2xl font-medium rounded-2xl shadow-card"
          >
            {isDemo ? '演' : (userName || userEmail || 'U').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-medium text-gray-900 truncate">{isDemo ? '演示账户' : (userName || '用户')}</h3>
            <p className="text-sm text-gray-500 truncate">{isDemo ? '共享演示数据，仅供体验' : (userEmail || '加载中...')}</p>
            {isDemo ? (
              <span className="inline-block mt-1.5 text-[11px] text-amber-700 bg-warning-soft border border-amber-200 px-2 py-0.5 rounded-full">
                演示模式：数据为所有演示用户共享，操作不会影响你的真实账户
              </span>
            ) : null}
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

      {/* 数据与隐私（O4：删除无真实行为的假开关，改为如实说明） */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gray-500" />
            数据与隐私
          </h3>
        </div>
        <div className="divide-y divide-gray-200">
          <div className="px-4 py-3 flex items-start gap-3">
            <Lock className="w-5 h-5 text-gray-500 flex-none mt-0.5" />
            <div>
              <p className="text-sm text-gray-900">数据存储</p>
              <p className="text-xs text-gray-500">内容、知识图谱与文件保存在你的私有账户空间，与其他用户隔离（演示模式为共享空间）。</p>
            </div>
          </div>
          <div className="px-4 py-3 flex items-start gap-3">
            <Cpu className="w-5 h-5 text-gray-500 flex-none mt-0.5" />
            <div>
              <p className="text-sm text-gray-900">AI 处理</p>
              <p className="text-xs text-gray-500">摘要、图谱抽取与推荐调用服务端 AI 接口处理你的内容；原始内容始终保留在你的账户内。</p>
            </div>
          </div>
        </div>
      </div>

      {/* 模型与能力（O4：删除 GPT/Claude/Whisper 假下拉，显示服务端真实模型与未启用能力） */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-gray-500" />
            模型与能力
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <p className="text-xs text-gray-600 mb-1">文本 AI（摘要 / 图谱 / 推荐）</p>
            <p className="text-xs text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
              服务端文本模型已启用（MiniMax 兼容接口，可用以"服务状态检测"为准）
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">语义搜索嵌入</p>
            <p className="text-xs text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
              BAAI/bge-m3（1024 维，向量后台自动生成）
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">多模态</p>
            <p className="text-xs text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
              图片 OCR（浏览器本地）、语音识别（浏览器原生）、文档解析（pdf/docx）
            </p>
          </div>
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
                  {s.state === 'ok' ? '正常' : s.state === 'warn' ? '降级' : '异常'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 其他设置 */}
      <div className="bg-white">
        <div className="divide-y divide-gray-200">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-900">关于</span>
            <span className="text-xs text-gray-500">v1.0.0</span>
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-900">运行环境</span>
            <span className="text-xs text-gray-500">{isDemo ? '演示模式' : '个人账户'}</span>
          </div>


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
    </div>
  );
}