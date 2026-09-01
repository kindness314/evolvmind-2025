import { Lock, Cpu, Database, LogOut, Sparkles, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { useRef, useState, useEffect } from 'react';
import { requestKnowledgeNodeBackfill } from '../../lib/graphSearch';
import { requestBackfill } from '../../lib/search';

interface SettingsPageProps {
  onLogout?: () => void;
}

const BACKFILL_BATCH_SIZE = 5;
const BACKFILL_WAIT_SECONDS = 70;
const BACKFILL_RATE_LIMIT_WAIT_SECONDS = 90;

function wait(seconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
}

function isRateLimitError(error?: string) {
  return Boolean(error && (error.includes('RateLimitExceeded') || error.includes('qpm limit exceeded') || error.includes('429')));
}

function formatBackfillError(error?: string) {
  if (!error) return '';
  if (isRateLimitError(error)) return '模型服务限流，稍后会自动重试';
  if (error.includes('EmbeddingModelNotAllowed') || error.includes('ModelNotAllowed')) {
    return '当前服务端 Key 没有 embedding 模型权限，请配置可用的 1024 维 embedding 模型/Key 后重试';
  }
  if (error.includes('EmbeddingDimensionMismatch')) {
    return 'embedding 维度不匹配：当前数据库需要 1024 维向量，请使用兼容模型';
  }
  return error.length > 180 ? `${error.slice(0, 180)}...` : error;
}

export function SettingsPage({ onLogout }: SettingsPageProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [autoBackfilling, setAutoBackfilling] = useState(false);
  const [nodeBackfilling, setNodeBackfilling] = useState(false);
  const [nodeBackfillResult, setNodeBackfillResult] = useState<string | null>(null);
  const [autoNodeBackfilling, setAutoNodeBackfilling] = useState(false);
  const stopBackfillRef = useRef(false);
  const stopNodeBackfillRef = useRef(false);
  const supabase = createClient(
    `https://${projectId}.supabase.co`,
    publicAnonKey
  );
  const [stats, setStats] = useState<{ captures: number; nodes: number; links: number } | null>(null);
  // 演示模式：固定共享 scope，无真实 Supabase 会话
  const [isDemo] = useState(() => localStorage.getItem('demo_auth') === 'true');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  // 服务端真实模型（O4：删除 GPT/Claude/Whisper 假下拉后，能力区展示真实模型）
  const [models, setModels] = useState<{ baseUrl: string; ids: string[] } | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
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

  // 服务端真实模型列表（O4：设置页展示实际能力，不伪装）
  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const resp = await fetch('/api/models');
        const json = (await resp.json()) as { ok?: boolean; baseUrl?: string; models?: string[] };
        if (!cancelled) {
          if (json.ok && Array.isArray(json.models)) {
            setModels({ baseUrl: json.baseUrl ?? '', ids: json.models });
            setModelsError(null);
          } else {
            setModels(null);
            setModelsError('无法获取服务端模型列表');
          }
        }
      } catch {
        if (!cancelled) {
          setModels(null);
          setModelsError('模型服务不可达');
        }
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
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

  const handleBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const result = await requestBackfill(BACKFILL_BATCH_SIZE);
      const firstError = result.errors?.[0]?.error;
      setBackfillResult(`成功回填 ${result.processed}/${result.total} 条${result.errors?.length ? `，${result.errors.length} 条失败：${formatBackfillError(firstError)}` : ''}`);
    } catch (e: any) {
      setBackfillResult(`回填失败: ${e.message}`);
    } finally {
      setBackfilling(false);
    }
  };

  const handleAutoBackfill = async () => {
    if (autoBackfilling || backfilling) return;
    stopBackfillRef.current = false;
    setAutoBackfilling(true);
    setBackfillResult('自动回填已开始，每批 5 条。');

    let rounds = 0;
    let processedTotal = 0;

    try {
      while (!stopBackfillRef.current) {
        rounds++;
        const result = await requestBackfill(BACKFILL_BATCH_SIZE);
        const firstError = result.errors?.[0]?.error;
        processedTotal += result.processed;

        if (result.processed === 0 && !result.errors?.length) {
          setBackfillResult(`自动回填完成：共处理 ${processedTotal} 条。`);
          break;
        }

        const waitSeconds = isRateLimitError(firstError) ? BACKFILL_RATE_LIMIT_WAIT_SECONDS : BACKFILL_WAIT_SECONDS;
        setBackfillResult(`自动回填第 ${rounds} 轮：成功 ${result.processed}/${result.total} 条，累计 ${processedTotal} 条${result.errors?.length ? `，${result.errors.length} 条失败：${formatBackfillError(firstError)}` : ''}。${waitSeconds} 秒后继续。`);
        await wait(waitSeconds);
      }
    } catch (e: any) {
      setBackfillResult(`自动回填失败: ${e.message}`);
    } finally {
      setAutoBackfilling(false);
    }
  };

  const handleNodeBackfill = async () => {
    if (nodeBackfilling) return;
    setNodeBackfilling(true);
    setNodeBackfillResult(null);
    try {
      const result = await requestKnowledgeNodeBackfill(BACKFILL_BATCH_SIZE);
      const firstError = result.errors?.[0]?.error;
      setNodeBackfillResult(`成功回填 ${result.processed}/${result.total} 个知识节点${result.errors?.length ? `，${result.errors.length} 个失败：${formatBackfillError(firstError)}` : ''}`);
    } catch (e: any) {
      setNodeBackfillResult(`知识节点回填失败: ${e.message}`);
    } finally {
      setNodeBackfilling(false);
    }
  };

  const handleAutoNodeBackfill = async () => {
    if (autoNodeBackfilling || nodeBackfilling) return;
    stopNodeBackfillRef.current = false;
    setAutoNodeBackfilling(true);
    setNodeBackfillResult('自动回填知识节点已开始，每批 5 个。');

    let rounds = 0;
    let processedTotal = 0;

    try {
      while (!stopNodeBackfillRef.current) {
        rounds++;
        const result = await requestKnowledgeNodeBackfill(BACKFILL_BATCH_SIZE);
        const firstError = result.errors?.[0]?.error;
        processedTotal += result.processed;

        if (result.processed === 0 && !result.errors?.length) {
          setNodeBackfillResult(`知识节点自动回填完成：共处理 ${processedTotal} 个。`);
          break;
        }

        const waitSeconds = isRateLimitError(firstError) ? BACKFILL_RATE_LIMIT_WAIT_SECONDS : BACKFILL_WAIT_SECONDS;
        setNodeBackfillResult(`知识节点自动回填第 ${rounds} 轮：成功 ${result.processed}/${result.total} 个，累计 ${processedTotal} 个${result.errors?.length ? `，${result.errors.length} 个失败：${formatBackfillError(firstError)}` : ''}。${waitSeconds} 秒后继续。`);
        await wait(waitSeconds);
      }
    } catch (e: any) {
      setNodeBackfillResult(`知识节点自动回填失败: ${e.message}`);
    } finally {
      setAutoNodeBackfilling(false);
    }
  };

  const handleStopBackfill = () => {
    stopBackfillRef.current = true;
    setBackfillResult('正在停止自动回填，当前等待结束后停止。');
  };

  const handleStopNodeBackfill = () => {
    stopNodeBackfillRef.current = true;
    setNodeBackfillResult('正在停止知识节点自动回填，当前等待结束后停止。');
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
          <div className="px-4 py-3 flex items-start gap-3">
            <Database className="w-5 h-5 text-gray-500 flex-none mt-0.5" />
            <div>
              <p className="text-sm text-gray-900">未启用能力</p>
              <p className="text-xs text-gray-500">系统通知、自动备份、深色模式与 OCR/语音解析尚未实现，此处不提供无效开关。</p>
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
            <p className="text-xs text-gray-600 mb-1">文本与图谱提取（服务端）</p>
            {models ? (
              <p className="text-xs text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
                {models.ids.filter((id) => !/bge|embed/i.test(id)).slice(0, 3).join('、') || '服务端未返回模型'}
                {models.ids.filter((id) => !/bge|embed/i.test(id)).length > 3 ? ` 等 ${models.ids.filter((id) => !/bge|embed/i.test(id)).length} 个模型` : ''}
              </p>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
                {modelsError || '加载中...'}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">语义搜索嵌入</p>
            <p className="text-xs text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
              BAAI/bge-m3（1024 维）
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">未启用能力</p>
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <XCircle className="w-3.5 h-3.5 text-gray-400 flex-none" />
              图像识别 / 语音转写 / 文档解析（上传仅保存元数据）
            </p>
          </div>
        </div>
      </div>

      {/* 语义搜索 */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            语义搜索
          </h3>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">
            语义搜索基于向量相似度匹配，需要先为已有数据生成 embedding 向量。
          </p>
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">捕获内容索引</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleBackfill}
            disabled={backfilling || autoBackfilling}
            className="w-full px-4 py-2.5 bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors disabled:bg-brand/50 flex items-center justify-center gap-2 rounded-xl shadow-card"
          >
            {backfilling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                回填中...
              </>
            ) : (
              '回填 Embedding 向量'
            )}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={autoBackfilling ? handleStopBackfill : handleAutoBackfill}
            disabled={backfilling}
            className="w-full px-4 py-2.5 bg-brand-muted text-white text-sm font-medium hover:brightness-110 transition-all disabled:bg-brand-muted/50 flex items-center justify-center gap-2 rounded-xl"
          >
            {autoBackfilling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                停止自动回填
              </>
            ) : (
              '自动回填捕获内容'
            )}
          </motion.button>
          {backfillResult && (
            <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg">
              {backfillResult}
            </p>
          )}

          <div className="pt-3 border-t border-gray-100 space-y-2">
            <p className="text-xs font-medium text-gray-600">知识节点索引</p>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleNodeBackfill}
              disabled={nodeBackfilling || autoNodeBackfilling}
              className="w-full px-4 py-2.5 bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors disabled:bg-brand/50 flex items-center justify-center gap-2 rounded-xl shadow-card"
            >
              {nodeBackfilling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  回填知识节点中...
                </>
              ) : (
                '回填知识节点 Embedding'
              )}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={autoNodeBackfilling ? handleStopNodeBackfill : handleAutoNodeBackfill}
              disabled={nodeBackfilling}
              className="w-full px-4 py-2.5 bg-brand-muted text-white text-sm font-medium hover:brightness-110 transition-all disabled:bg-brand-muted/50 flex items-center justify-center gap-2 rounded-xl"
            >
              {autoNodeBackfilling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  停止知识节点自动回填
                </>
              ) : (
                '自动回填知识节点'
              )}
            </motion.button>
            {nodeBackfillResult && (
              <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg">
                {nodeBackfillResult}
              </p>
            )}
          </div>
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