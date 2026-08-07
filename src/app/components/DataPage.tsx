import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Loader2, FileText, Image as ImageIcon, Mic, File, Pin, CheckSquare, Trash2, Check, X, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { semanticSearch, type SearchResult } from '../../lib/search';
import { retryCapturedItem } from '../../lib/process';

interface InfoCard {
  id: string;
  type: 'text' | 'photo' | 'audio' | 'import';
  title: string;
  content: string;
  timestamp: string;
  tags: string[];
  is_pinned: boolean;
  /** O1 处理状态; 存量数据为 undefined */
  processing_status?: string;
  embedding_status?: string;
  graph_status?: string;
  processing_error?: string;
  /** 原始 ISO 时间戳, 供增量合并排序; 展示仍用 timestamp */
  created_at_raw?: string;
}

type DataDestination = 'capture' | 'knowledge' | 'item-detail';

interface DataPageProps {
  onNavigate?: (page: DataDestination, itemId?: string) => void;
}


function ProcessingBadge({ item, onRetry }: { item: InfoCard; onRetry: (item: InfoCard) => void }) {
  const badgeBase = 'flex-none inline-flex items-center gap-1 px-1.5 py-0.5 text-xs';
  // O1: 聚合子状态判断整体; 任一子步骤失败即失败, 避免被部分成功掩盖
  const statuses = [item.graph_status, item.embedding_status].filter(Boolean);
  const anyFailed = item.processing_status === 'failed' || statuses.some((s) => s === 'failed');
  const anyProcessing =
    !anyFailed && (item.processing_status === 'processing' || statuses.some((s) => s === 'processing'));
  const allDone = !anyFailed && !anyProcessing && statuses.length > 0 && statuses.every((s) => s === 'completed');
  const graphActionable = !item.graph_status || item.graph_status === 'failed' || item.graph_status === 'pending';
  const embedActionable = !item.embedding_status || item.embedding_status === 'failed' || item.embedding_status === 'pending';
  const showAction =
    (anyFailed && (graphActionable || embedActionable)) ||
    (!anyFailed && !anyProcessing && !allDone);
  if (anyFailed) {
    // 子步骤全 completed 但整体卡 failed(历史死锁行)→ 提供"恢复"入口, 而非无按钮
    const recoverOnly = !graphActionable && !embedActionable;
    return (
      <span className={`${badgeBase} bg-red-50 text-red-700`} style={{ borderRadius: '4px' }} title={item.processing_error || ''}>
        <AlertTriangle className="w-3 h-3" />
        处理失败
        {showAction && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(item); }}
            className="px-1 py-0.5 bg-red-600 text-white text-[10px] hover:bg-red-700 transition-colors"
            style={{ borderRadius: '3px' }}
          >
            重试
          </button>
        )}
        {!showAction && recoverOnly && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(item); }}
            className="px-1 py-0.5 bg-amber-600 text-white text-[10px] hover:bg-amber-700 transition-colors"
            style={{ borderRadius: '3px' }}
          >
            恢复
          </button>
        )}
      </span>
    );
  }
  if (anyProcessing) {
    return (
      <span className={`${badgeBase} bg-blue-50 text-blue-700`} style={{ borderRadius: '4px' }}>
        <Loader2 className="w-3 h-3 animate-spin" />
        处理中
      </span>
    );
  }
  if (allDone) {
    return (
      <span className={`${badgeBase} bg-green-50 text-green-700`} style={{ borderRadius: '4px' }}>
        <Check className="w-3 h-3" />
        已完成
      </span>
    );
  }
  return (
    <span className={`${badgeBase} bg-gray-100 text-gray-500`} style={{ borderRadius: '4px' }}>
      待处理
      <button
        onClick={(e) => { e.stopPropagation(); onRetry(item); }}
        className="px-1 py-0.5 bg-gray-600 text-white text-[10px] hover:bg-gray-700 transition-colors"
        style={{ borderRadius: '3px' }}
      >
        处理
      </button>
    </span>
  );
}
const typeIcons = {
  text: <FileText className="w-5 h-5 text-blue-500" />,
  photo: <ImageIcon className="w-5 h-5 text-green-500" />,
  audio: <Mic className="w-5 h-5 text-purple-500" />,
  import: <File className="w-5 h-5 text-orange-500" />
};

// 与 ProcessingBadge.showAction 同一判定; 处理中不视为可补做(正在跑就不该有补做入口)
function isActionable(item: InfoCard): boolean {
  const statuses = [item.graph_status, item.embedding_status].filter(Boolean);
  const anyFailed = item.processing_status === 'failed' || statuses.some((s) => s === 'failed');
  const anyProcessing =
    !anyFailed && (item.processing_status === 'processing' || statuses.some((s) => s === 'processing'));
  const allDone = !anyFailed && !anyProcessing && statuses.length > 0 && statuses.every((s) => s === 'completed');
  const graphActionable = !item.graph_status || item.graph_status === 'failed' || item.graph_status === 'pending';
  const embedActionable = !item.embedding_status || item.embedding_status === 'failed' || item.embedding_status === 'pending';
  return (
    (anyFailed && (graphActionable || embedActionable)) ||
    (!anyFailed && !anyProcessing && !allDone)
  );
}
type InfoRow = Record<string, any>;

// 状态修复(全量与增量共用): 处理超时 >3min -> failed; 子步骤全 completed 但主状态仍 processing -> completed
const reconcileStatuses = (rows: InfoRow[]): Set<string> => {
  const staleGraphProcessing = rows.filter((i) => {
    if (i.processing_status !== 'processing' || i.graph_status !== 'processing') return false;
    const t = new Date(i.processed_at || i.created_at).getTime();
    return Number.isFinite(t) && Date.now() - t > 3 * 60 * 1000;
  });
  if (staleGraphProcessing.length > 0) {
    supabase
      .from('captured_info')
      .update({ graph_status: 'failed', processing_status: 'failed', processing_error: 'graph: 处理超时(>3分钟), 请重试' })
      .in('id', staleGraphProcessing.map((i) => i.id))
      .then(() => {});
  }
  const staleCompleted = rows.filter((i) => {
    if (i.processing_status !== 'processing') return false;
    return i.graph_status === 'completed' && i.embedding_status === 'completed';
  });
  const staleCompletedIds = new Set(staleCompleted.map((i) => i.id));
  if (staleCompletedIds.size > 0) {
    supabase
      .from('captured_info')
      .update({ processing_status: 'completed' })
      .in('id', Array.from(staleCompletedIds))
      .then(() => {});
  }
  return staleCompletedIds;
};

// 行 -> 卡片映射, 全量/增量路径共用, 保证两种路径展示一致
const formatInfoRow = (item: InfoRow, staleCompletedIds: Set<string>): InfoCard => ({
  id: item.id,
  type: item.type as InfoCard['type'],
  title: item.title,
  content: item.content || item.summary || '',
  timestamp: new Date(item.created_at).toLocaleString(),
  created_at_raw: item.created_at || undefined,
  tags: item.tags || [],
  is_pinned: item.is_pinned || false,
  processing_status: staleCompletedIds.has(item.id) ? 'completed' : (item.processing_status || undefined),
  embedding_status: item.embedding_status || undefined,
  graph_status: item.graph_status || undefined,
  processing_error: item.processing_error || undefined,
});

const maxCreatedAt = (rows: InfoRow[]): string | null => {
  let max: string | null = null;
  for (const r of rows) {
    if (r.created_at && (!max || r.created_at > max)) max = r.created_at;
  }
  return max;
};

// 按 id 合并增量数据, 保持"置顶优先 + 时间倒序"的既有排序(ISO 字符串字典序 == 时间序)
const mergeByKey = (prev: InfoCard[], incoming: InfoCard[]): InfoCard[] => {
  if (incoming.length === 0) return prev;
  const map = new Map(prev.map((it) => [it.id, it]));
  for (const it of incoming) map.set(it.id, it);
  return Array.from(map.values()).sort(
    (a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || (b.created_at_raw || b.timestamp).localeCompare(a.created_at_raw || a.timestamp)
  );
};

interface RetryAllState {
  done: number;
  total: number;
  failed: number;
  running: boolean;
}

export function DataPage({ onNavigate }: DataPageProps) {
  const [data, setData] = useState<InfoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActing, setIsBulkActing] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [retryAll, setRetryAll] = useState<RetryAllState | null>(null);
  // 增量同步水位线: 最近一次成功同步见过的最大 created_at; null = 尚未建立基线
  const lastSyncRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  // 观察集: 已知非 completed 的 id; 行状态完成后会退出 neq 查询, 若不观察, UI 停留在旧"处理中"快照
  const watchRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchData();
    // 30s 静默轮询: 多数轮次只做增量(新增行 + 状态未完成行), 每 6 次(~3min)全量对账一次,
    // 兜底捕获删除/置顶等增量查询感知不到的变化
    const timer = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current % 6 === 0) {
        void fetchData(false);
      } else {
        void syncData();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const selectedCount = selectedIds.size;

  // 语义搜索 debounce
  const doSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSemanticResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await semanticSearch({ query, threshold: 0.2, count: 30 });
      setSemanticResults(results);
    } catch {
      setSemanticResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchMode !== 'semantic') {
      setSemanticResults([]);
      return;
    }
    clearTimeout(debounceRef.current ?? undefined);
    debounceRef.current = setTimeout(() => {
      doSemanticSearch(searchQuery);
    }, 300);
    return () => {
      clearTimeout(debounceRef.current ?? undefined);
    };
  }, [searchQuery, searchMode, doSemanticSearch]);

  const exitMultiSelect = () => {
    setIsMultiSelect(false);
    setSelectedIds(new Set());
    setShowBulkDeleteConfirm(false);
  };


  const handleRetry = async (item: InfoCard) => {
    if (!item.id) return;
    // O1: 统一重试入口 — 分析失败先重跑提取, 再补做图谱/向量
    // 乐观更新: 点击立即显示"处理中", 避免 45-60s 重试期间 UI 停留旧状态; 完成/失败后增量同步收敛
    setData((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? { ...it, processing_status: 'processing', graph_status: 'processing', embedding_status: 'processing', processing_error: undefined }
          : it
      )
    );
    try {
      await retryCapturedItem(item.id);
    } catch (e) {
      console.error('处理失败:', e);
      toast.error('处理失败，请稍后再试');
    } finally {
      await syncData();
    }
  };

  const handleRetryAll = async () => {
    if (retryAll?.running) return;
    const targets = displayData.filter(isActionable);
    if (targets.length === 0) {
      toast('没有需要处理的内容');
      return;
    }
    setRetryAll({ done: 0, total: targets.length, failed: 0, running: true });
    // 乐观更新: 批量重试目标立即显示"处理中"
    const targetIds = new Set(targets.map((t) => t.id));
    setData((prev) =>
      prev.map((it) =>
        targetIds.has(it.id)
          ? { ...it, processing_status: 'processing', graph_status: 'processing', embedding_status: 'processing', processing_error: undefined }
          : it
      )
    );
    let failed = 0;
    // 串行处理 + 项间限速: 每项消耗 2-3 个 LLM 请求(graph chat + embedding),
    // 上游 QPM 为分钟级配额, 连续打必然 429; 服务端已有 2s/4s/8s 退避, 前端仍需限速兜底
    const sleep = (ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    };
    for (let i = 0; i < targets.length; i += 1) {
      try {
        await retryCapturedItem(targets[i].id);
      } catch (e) {
        failed += 1;
        console.error('一键处理失败:', targets[i].id, e);
      }
      setRetryAll({ done: i + 1, total: targets.length, failed, running: true });
      if (i < targets.length - 1) {
        await sleep(8000); // 项间 8s: 给 QPM 配额留恢复窗口
      }
    }
    setRetryAll({ done: targets.length, total: targets.length, failed, running: false });
    await syncData();
    if (failed === 0) {
      toast.success(`全部处理完成（${targets.length} 项）`);
    } else {
      toast.error(`处理完成，${failed}/${targets.length} 项失败`, { description: '失败项可在列表中单独重试' });
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const fetchData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    // 15s 超时: 直连 supabase.co 可能长时间挂起, 不能让页面停在"正在加载数据..."
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const { data: capturedInfo, error } = await supabase
        .from('captured_info')
        .select('*')
        .abortSignal(controller.signal)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (capturedInfo) {
        const staleCompletedIds = reconcileStatuses(capturedInfo);
        const formattedData: InfoCard[] = capturedInfo.map((item) => formatInfoRow(item, staleCompletedIds));
        setData(formattedData);
        setLoadError(null);
        lastSyncRef.current = maxCreatedAt(capturedInfo);
        // 重建观察集: 全量快照中任一状态为非空且非 completed 的行进入观察, 供增量同步捕获"完成/失败瞬间"
        // (与增量查询 or(...neq.completed) 语义一致: neq 对 NULL 不生效, 存量 NULL 行是静态的, 无需观察)
        watchRef.current = new Set(
          capturedInfo
            .filter((item) =>
              [item.processing_status, item.graph_status, item.embedding_status].some((s) => s !== null && s !== 'completed'),
            )
            .map((item) => item.id),
        );
      }
    } catch (error) {
      console.error('获取数据失败:', error);
      if (showLoading) {
        const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
        setLoadError(aborted ? '加载超时（15 秒），请检查网络后重试' : '加载失败，请检查网络后重试');
      }
    } finally {
      clearTimeout(timer);
      if (showLoading) setLoading(false);
    }
  };
  // 增量同步: 只拉新增行 + 状态未完成行, 按 id 合并进现有列表; 轮询/捕获事件/重试收敛共用
  const syncData = useCallback(async () => {
    const watermark = lastSyncRef.current;
    if (!watermark) {
      // 尚无基线(如捕获事件先于首次拉取完成): 走全量拉取建立水位线
      await fetchData(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      // 1.5s 回看窗口: 水位线同一秒内新增的行不遗漏; 重复行由按 id 合并去重
      const watermarkIso = new Date(new Date(watermark).getTime() - 1500).toISOString();
      const [newRes, changedRes] = await Promise.all([
        supabase.from('captured_info').select('*').gt('created_at', watermarkIso).abortSignal(controller.signal),
        supabase.from('captured_info')
          .select('*')
          .or('processing_status.neq.completed,graph_status.neq.completed,embedding_status.neq.completed')
          .abortSignal(controller.signal),
      ]);
      if (newRes.error) throw newRes.error;
      if (changedRes.error) throw changedRes.error;
      const incoming: InfoRow[] = [...(newRes.data || []), ...(changedRes.data || [])];
      // 观察集: 记录所有仍非 completed 的行; 曾观察但已退出非完成集合的 id = 刚完成/失败, 补拉最终状态
      const changedIds = new Set((changedRes.data || []).map((row) => row.id));
      for (const id of changedIds) watchRef.current.add(id);
      const resolved = Array.from(watchRef.current).filter((id) => !changedIds.has(id));
      if (resolved.length > 0) {
        const { data: settled, error: settledError } = await supabase
          .from('captured_info')
          .select('*')
          .in('id', resolved)
          .abortSignal(controller.signal);
        if (settledError) throw settledError;
        if (settled && settled.length > 0) incoming.push(...settled);
        for (const id of resolved) watchRef.current.delete(id);
      }
      if (incoming.length > 0) {
        const staleCompletedIds = reconcileStatuses(incoming);
        setData((prev) => mergeByKey(prev, incoming.map((item) => formatInfoRow(item, staleCompletedIds))));
        const max = maxCreatedAt(incoming);
        if (max && (!lastSyncRef.current || max > lastSyncRef.current)) lastSyncRef.current = max;
      }
      setLoadError(null);
    } catch (error) {
      console.error('增量同步失败:', error);
      // 静默失败: 下轮轮询/全量对账兜底, 不打断页面
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // 捕获页保存成功后即时增量同步, 不必等下一轮 30s 轮询
  useEffect(() => {
    const onDataChanged = () => {
      void syncData();
    };
    window.addEventListener('evolvmind:data-changed', onDataChanged);
    return () => window.removeEventListener('evolvmind:data-changed', onDataChanged);
  }, [syncData]);

  const filteredData = searchMode === 'keyword'
    ? data.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : data; // semantic mode uses semanticResults instead

  // 语义模式下，将 SearchResult 转为展示格式
  const displayData: Array<InfoCard & { similarity?: number; matchedReason?: string; sourcePreviews?: string[] }> = searchMode === 'semantic' && searchQuery.trim()
    ? semanticResults.map(r => ({
        id: r.id,
        type: r.type as InfoCard['type'],
        title: r.title,
        content: r.content || r.summary || '',
        timestamp: new Date(r.created_at).toLocaleString(),
        tags: r.tags || [],
        is_pinned: r.is_pinned || false,
        similarity: r.similarity,
        matchedReason: r.matchedReason,
        sourcePreviews: r.sourcePreviews,
      }))
    : filteredData;

  const handleBulkPin = async () => {
    if (selectedCount === 0 || isBulkActing) return;
    setIsBulkActing(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from('captured_info')
        .update({ is_pinned: true })
        .in('id', ids);

      if (error) throw error;
      await fetchData();
      exitMultiSelect();
    } catch (error) {
      console.error('批量置顶失败:', error);
      alert('批量置顶失败，请稍后重试');
    } finally {
      setIsBulkActing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0 || isBulkActing) return;
    setIsBulkActing(true);
    try {
      const ids = Array.from(selectedIds);
      const selectedItems = data.filter(i => selectedIds.has(i.id));
      const filePaths = selectedItems
        .map(i => i.content)
        .filter(url => url.startsWith('http') && url.includes('/storage/v1/object/public/captured-files/'))
        .map(url => url.split('captured-files/')[1]?.split('?')[0])
        .filter(Boolean);

      if (filePaths.length > 0) {
        await supabase.storage.from('captured-files').remove(filePaths);
      }

      const { error } = await supabase
        .from('captured_info')
        .delete()
        .in('id', ids);

      if (error) throw error;
      await fetchData();
      exitMultiSelect();
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败，请稍后重试');
    } finally {
      setIsBulkActing(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* 顶部搜索栏 */}
      <div className="flex-none px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder={searchMode === 'semantic' ? '语义搜索...' : '搜索信息...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ borderRadius: '4px' }}
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
            )}
          </div>

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setSearchMode(searchMode === 'keyword' ? 'semantic' : 'keyword')}
            className={`w-11 h-11 border transition-colors flex items-center justify-center ${searchMode === 'semantic' ? 'bg-purple-50 border-purple-300 text-purple-600' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-purple-300'}`}
            style={{ borderRadius: '4px' }}
            aria-label={searchMode === 'semantic' ? '切换到关键词搜索' : '切换到语义搜索'}
            title={searchMode === 'semantic' ? '语义搜索中' : '关键词搜索中'}
          >
            <Sparkles className="w-5 h-5" />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (isMultiSelect) {
                exitMultiSelect();
                return;
              }
              setIsMultiSelect(true);
            }}
            className={`w-11 h-11 bg-gray-50 border border-gray-200 hover:border-blue-300 transition-colors flex items-center justify-center ${isMultiSelect ? 'text-blue-500' : 'text-gray-600'}`}
            style={{ borderRadius: '4px' }}
            aria-label="多选"
            title={isMultiSelect ? '退出多选' : '多选'}
          >
            {isMultiSelect ? <X className="w-5 h-5" /> : <CheckSquare className="w-5 h-5" />}
          </motion.button>
        </div>
      </div>

      {/* 一键处理/重试条 */}
      {!isMultiSelect && (retryAll?.running || displayData.some(isActionable)) && (
        <div className="flex-none px-4 pb-3">
          <button
            onClick={() => void handleRetryAll()}
            disabled={retryAll?.running}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors bg-blue-500 text-white hover:bg-blue-600 ${
              retryAll?.running ? 'opacity-80 cursor-not-allowed' : ''
            }`}
            style={{ borderRadius: '4px' }}
          >
            {retryAll?.running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                正在处理 {retryAll.done}/{retryAll.total}...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                一键处理 {displayData.filter(isActionable).length} 项待处理内容
              </>
            )}
          </button>
        </div>
      )}

      <AnimatePresence>
        {isMultiSelect && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex-none px-4 pb-3"
          >
            <div className="bg-white border border-gray-200 px-3 py-2 flex items-center justify-between"
              style={{ borderRadius: '4px' }}
            >
              <div className="text-sm text-gray-700">
                已选择 <span className="font-medium text-gray-900">{selectedCount}</span> 项
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleBulkPin}
                  disabled={selectedCount === 0 || isBulkActing}
                  className="px-3 py-1.5 bg-blue-500 text-white text-xs font-medium disabled:bg-blue-300 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  置顶
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  disabled={selectedCount === 0 || isBulkActing}
                  className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium disabled:bg-red-300 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  删除
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 时间线卡片流 */}
      <div className="flex-1 overflow-y-auto px-4 pb-20">
        {loading && !loadError ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <p className="text-sm text-gray-500">正在加载数据...</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="w-8 h-8 text-red-500 mb-2" />
            <p className="text-sm text-gray-600 mb-3">{loadError}</p>
            <button
              onClick={() => fetchData()}
              className="px-4 py-2 bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors"
              style={{ borderRadius: '4px' }}
            >
              重试
            </button>
          </div>
        ) : displayData.length > 0 ? (
          <div className="space-y-3">
            {displayData.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (isMultiSelect) {
                    toggleSelect(item.id);
                    return;
                  }
                  onNavigate?.('item-detail', item.id);
                }}
                className={`bg-white border ${item.is_pinned ? 'border-blue-200' : 'border-gray-200'} p-4 cursor-pointer hover:border-blue-300 transition-colors overflow-hidden relative`}
                style={{ borderRadius: '4px' }}
              >
                {item.is_pinned && (
                  <div className="absolute top-0 right-0 p-1 bg-blue-500 rounded-bl" style={{ borderBottomLeftRadius: '4px' }}>
                    <Pin className="w-3 h-3 text-white fill-white" />
                  </div>
                )}
                <div className="flex items-start gap-3">
                  {isMultiSelect && (
                    <div className="flex-none pt-1">
                      <div
                        className={`w-5 h-5 border flex items-center justify-center ${selectedIds.has(item.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}
                        style={{ borderRadius: '4px' }}
                      >
                        {selectedIds.has(item.id) ? <Check className="w-3.5 h-3.5 text-white" /> : null}
                      </div>
                    </div>
                  )}
                  <div className="w-10 h-10 bg-gray-50 flex items-center justify-center flex-none" style={{ borderRadius: '4px' }}>
                    {typeIcons[item.type as keyof typeof typeIcons]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
                      <ProcessingBadge item={item} onRetry={handleRetry} />
                      {item.similarity != null && (
                        <span className="flex-none px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium" style={{ borderRadius: '4px' }}>
                          {Math.round(item.similarity * 100)}%
                        </span>
                      )}
                    </div>

                    {item.matchedReason ? (
                      <p className="text-[11px] text-purple-500 mb-1 line-clamp-1">{item.matchedReason}</p>
                    ) : null}

                    {item.sourcePreviews && item.sourcePreviews.length > 0 ? (
                      <div className="mb-2 text-[11px] text-gray-400 space-y-0.5">
                        {item.sourcePreviews.slice(0, 2).map((preview, i) => (
                          <p key={i} className="line-clamp-1 italic">{preview}</p>
                        ))}
                      </div>
                    ) : null}
                    
                    {/* 根据类型展示预览 */}
                    {item.type === 'photo' && (item.content.startsWith('blob:') || item.content.startsWith('http')) && (
                      <div className="mb-2 rounded overflow-hidden border border-gray-100 max-h-32">
                        <img src={item.content} alt="Preview" className="w-full h-auto object-cover" />
                      </div>
                    )}
                    
                    <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                      {item.type === 'text' ? item.content : `[${item.type === 'photo' ? '图片' : item.type === 'audio' ? '音频' : '文件'}] ${item.content.split('/').pop()?.split('?')[0]}`}
                    </p>
                    
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-block px-2 py-0.5 bg-gray-100 text-xs text-gray-600"
                          style={{ borderRadius: '4px' }}
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="text-xs text-gray-400 ml-auto">{item.timestamp}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-gray-500">暂无数据</p>
          </div>
        )}
      </div>

      {/* 浮动捕获按钮 */}
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => onNavigate?.('capture')}
        className="absolute right-4 bottom-36 w-14 h-14 bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-colors flex items-center justify-center z-10"
        style={{ borderRadius: '4px' }}
        aria-label="捕获信息"
      >
        <Plus className="w-6 h-6" />
      </motion.button>

      {/* 批量删除确认 */}
      <AnimatePresence>
        {showBulkDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBulkDeleteConfirm(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xs bg-white p-6 shadow-2xl"
              style={{ borderRadius: '4px' }}
            >
              <div className="flex items-center gap-2 mb-3 text-gray-900">
                <Trash2 className="w-5 h-5 text-red-500" />
                <h3 className="text-base font-bold">确认删除</h3>
              </div>
              <p className="text-sm text-gray-600 mb-6">将删除已选择的 {selectedCount} 条信息，且相关云端文件会尝试同步移除。</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowBulkDeleteConfirm(false);
                    handleBulkDelete();
                  }}
                  disabled={isBulkActing}
                  className="flex-1 px-4 py-2.5 bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
