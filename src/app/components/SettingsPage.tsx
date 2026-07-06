import { Bell, Lock, Palette, Cpu, Database, ChevronRight, LogOut, Sparkles, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Switch } from './ui/switch';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { useRef, useState } from 'react';
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
      {/* 用户信息卡片 */}
      <div className="bg-white p-6 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-500 flex items-center justify-center text-white text-2xl font-medium"
            style={{ borderRadius: '4px' }}
          >
            U
          </div>
          <div className="flex-1">
            <h3 className="text-base font-medium text-gray-900">用户名称</h3>
            <p className="text-sm text-gray-500">user@example.com</p>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* 数据统计卡片 */}
      <div className="bg-white p-4 mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">数据统计</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-medium text-gray-900">342</p>
            <p className="text-xs text-gray-500 mt-1">已捕获</p>
          </div>
          <div className="text-center border-l border-r border-gray-200">
            <p className="text-2xl font-medium text-gray-900">28</p>
            <p className="text-xs text-gray-500 mt-1">知识节点</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-medium text-gray-900">156</p>
            <p className="text-xs text-gray-500 mt-1">关联关系</p>
          </div>
        </div>
      </div>

      {/* 功能设置 */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700">功能设置</h3>
        </div>
        
        <div className="divide-y divide-gray-200">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-900">消息通知</p>
                <p className="text-xs text-gray-500">接收处理完成通知</p>
              </div>
            </div>
            <Switch defaultChecked />
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-900">自动同步</p>
                <p className="text-xs text-gray-500">自动备份到云端</p>
              </div>
            </div>
            <Switch defaultChecked />
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Lock className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-900">隐私保护</p>
                <p className="text-xs text-gray-500">本地处理敏感信息</p>
              </div>
            </div>
            <Switch />
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Palette className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-900">深色模式</p>
                <p className="text-xs text-gray-500">切换界面主题</p>
              </div>
            </div>
            <Switch />
          </div>
        </div>
      </div>

      {/* 模型偏好 */}
      <div className="bg-white mb-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700">模型偏好</h3>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-gray-600 mb-2 block flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              文本提取模型
            </label>
            <select
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderRadius: '4px' }}
            >
              <option>GPT-4 (推荐)</option>
              <option>GPT-3.5 Turbo</option>
              <option>Claude 3</option>
              <option>本地模型</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-2 block">图像识别模型</label>
            <select
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderRadius: '4px' }}
            >
              <option>GPT-4 Vision (推荐)</option>
              <option>Claude 3 Vision</option>
              <option>Gemini Vision</option>
              <option>本地模型</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-2 block">语音转写模型</label>
            <select
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderRadius: '4px' }}
            >
              <option>Whisper (推荐)</option>
              <option>Azure Speech</option>
              <option>Google Speech</option>
              <option>本地模型</option>
            </select>
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
            className="w-full px-4 py-2.5 bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 transition-colors disabled:bg-purple-300 flex items-center justify-center gap-2"
            style={{ borderRadius: '4px' }}
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
            className="w-full px-4 py-2.5 bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors disabled:bg-indigo-300 flex items-center justify-center gap-2"
            style={{ borderRadius: '4px' }}
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
            <p className="text-xs text-gray-600 bg-gray-50 p-2" style={{ borderRadius: '4px' }}>
              {backfillResult}
            </p>
          )}

          <div className="pt-3 border-t border-gray-100 space-y-2">
            <p className="text-xs font-medium text-gray-600">知识节点索引</p>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleNodeBackfill}
              disabled={nodeBackfilling || autoNodeBackfilling}
              className="w-full px-4 py-2.5 bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:bg-blue-300 flex items-center justify-center gap-2"
              style={{ borderRadius: '4px' }}
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
              className="w-full px-4 py-2.5 bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600 transition-colors disabled:bg-cyan-300 flex items-center justify-center gap-2"
              style={{ borderRadius: '4px' }}
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
              <p className="text-xs text-gray-600 bg-gray-50 p-2" style={{ borderRadius: '4px' }}>
                {nodeBackfillResult}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 其他设置 */}
      <div className="bg-white">
        <div className="divide-y divide-gray-200">
          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <span className="text-sm text-gray-900">存储管理</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">2.3 GB / 10 GB</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
          </button>

          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <span className="text-sm text-gray-900">导出数据</span>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>

          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <span className="text-sm text-gray-900">帮助与反馈</span>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>

          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <span className="text-sm text-gray-900">关于</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">v1.0.0</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
          </button>

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