import { motion } from 'motion/react';
import { Loader2, Plus, Sparkles, Bell, Eye, Tag, X, CalendarRange } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { fetchSummary, type SummaryResponse, type SummaryPeriod } from '../../lib/summarize';
import { fetchRecommendations, type Recommendation } from '../../lib/recommend';

type HomeDestination = 'capture' | 'knowledge' | 'item-detail';

interface HomePageProps {
  onNavigate?: (page: HomeDestination, itemId?: string) => void;
  /** keep-alive: 页面是否可见; 从其他页切回时静默刷新, 避免展示过期数据 */
  active?: boolean;
}

/** 首页双模块切换: 推荐 / 总结 */
type HomeTab = 'recs' | 'summary';

export function HomePage({ onNavigate, active }: HomePageProps) {
  const [homeTab, setHomeTab] = useState<HomeTab>('recs');
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>('7d');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [dismissedRecIds, setDismissedRecIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSummaryLoading(true);
      const result = await fetchSummary({ period: summaryPeriod });
      if (!cancelled) {
        setSummary(result);
        setSummaryLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [summaryPeriod]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setRecsLoading(true);
      const result = await fetchRecommendations({ dismissedIds: [...dismissedRecIds] });
      if (!cancelled) {
        setRecommendations(result.recommendations);
        setRecsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [dismissedRecIds]);
  // keep-alive: 从其他页切回首页时静默刷新(不闪 loading), 避免展示过期推荐/总结
  const prevActiveRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (active && prevActiveRef.current === false) {
      void fetchSummary({ period: summaryPeriod }).then((r) => {
        if (r.ok) setSummary(r);
      });
      void fetchRecommendations({ dismissedIds: [...dismissedRecIds] }).then((r) => {
        if (r.ok) setRecommendations(r.recommendations);
      });
    }
    prevActiveRef.current = active;
  }, [active, summaryPeriod, dismissedRecIds]);

  const tabBase = 'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors';
  const tabActive = 'bg-white text-blue-600 shadow-sm';
  const tabIdle = 'text-gray-500 hover:text-gray-700';

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* 顶部模块切换: 推荐 ⟷ 总结, 互斥不并列 */}
      <div className="flex-none px-4 pt-4 pb-3">
        <div className="flex items-center gap-1 bg-gray-100 p-1" style={{ borderRadius: '4px' }}>
          <button
            onClick={() => setHomeTab('recs')}
            className={`${tabBase} ${homeTab === 'recs' ? tabActive : tabIdle}`}
            style={{ borderRadius: '3px' }}
          >
            <Sparkles className="w-4 h-4" />
            为你推荐
          </button>
          <button
            onClick={() => setHomeTab('summary')}
            className={`${tabBase} ${homeTab === 'summary' ? tabActive : tabIdle}`}
            style={{ borderRadius: '3px' }}
          >
            <CalendarRange className="w-4 h-4" />
            近期总结
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-20">
        {homeTab === 'recs' ? (
          /* 主动推荐卡片 */
          recsLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
              <p className="text-base text-gray-400">正在生成推荐...</p>
            </div>
          ) : recommendations.length > 0 ? (
            <div className="bg-white border border-amber-200 overflow-hidden" style={{ borderRadius: '4px' }}>
              <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-200">
                <div className="flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-lg font-medium text-amber-800">为你推荐</span>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {recommendations.map((rec) => {
                  const typeIcon = rec.type === 'review' ? <Eye className="w-3 h-3" /> : rec.type === 'related' ? <Tag className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />;
                  const typeLabel = rec.type === 'review' ? '回顾' : rec.type === 'related' ? '关联' : '形成中';
                  const typeColor = rec.type === 'review' ? 'bg-blue-50 text-blue-700' : rec.type === 'related' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700';
                  return (
                    <div key={rec.id} className="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors group">
                      <button
                        onClick={() => {
                          if (rec.targetType === 'node' && rec.nodeId) {
                            onNavigate?.('knowledge', rec.nodeId);
                          } else if (rec.targetType === 'captured') {
                            onNavigate?.('item-detail', rec.targetId);
                          }
                        }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium ${typeColor}`} style={{ borderRadius: '3px' }}>
                            {typeIcon} {typeLabel}
                          </span>
                          <span className="text-base text-gray-800 font-medium truncate">{rec.title}</span>
                        </div>
                        <p className="text-sm text-gray-500 truncate">{rec.reason}</p>
                      </button>
                      <button
                        onClick={() => setDismissedRecIds((prev) => new Set([...prev, rec.id]))}
                        className="flex-none p-0.5 text-gray-300 hover:text-gray-500 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="关闭推荐"
                        title="不再推荐"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-base text-gray-400">暂无推荐</p>
            </div>
          )
        ) : (
          /* 近期总结卡片 */
          summaryLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
              <p className="text-base text-gray-400">正在生成总结...</p>
            </div>
          ) : summary && summary.ok && (summary.stats.capturedCount > 0 || summary.stats.newNodeCount > 0) ? (
            <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-lg font-medium text-gray-700">近期总结</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSummaryPeriod('7d')}
                    className={`px-2 py-0.5 text-xs transition-colors ${summaryPeriod === '7d' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                    style={{ borderRadius: '4px' }}
                  >
                    7天
                  </button>
                  <button
                    onClick={() => setSummaryPeriod('30d')}
                    className={`px-2 py-0.5 text-xs transition-colors ${summaryPeriod === '30d' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                    style={{ borderRadius: '4px' }}
                  >
                    30天
                  </button>
                </div>
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-4 px-3 py-2 text-base text-gray-500 border-b border-gray-100">
                <span>{summary.stats.capturedCount} 条捕获</span>
                <span>{summary.stats.newNodeCount} 个节点</span>
                <span>{summary.stats.newLinkCount} 个关系</span>
              </div>

              {/* Content */}
              <div className="px-3 py-2 space-y-2">
                {summary.themes.length > 0 && (
                  <div>
                    <h4 className="text-base font-medium text-gray-500 mb-1">主题</h4>
                    <div className="flex gap-1.5 flex-wrap">
                      {summary.themes.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-base" style={{ borderRadius: '4px' }}>
                          {t.name} <span className="text-blue-400">{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {summary.importantNodes.length > 0 && (
                  <div>
                    <h4 className="text-base font-medium text-gray-500 mb-1">重要节点</h4>
                    <div className="space-y-1">
                      {summary.importantNodes.map((n, i) => (
                        <div key={i} className="flex items-center gap-2 text-base">
                          <span className="text-gray-800 font-medium">{n.name}</span>
                          <span className="text-gray-400">{n.kind}</span>
                          <span className="text-gray-400 text-sm">— {n.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {summary.newConnections.length > 0 && (
                  <div>
                    <h4 className="text-base font-medium text-gray-500 mb-1">新关系</h4>
                    <div className="space-y-0.5">
                      {summary.newConnections.map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-base text-gray-600">
                          <span>{c.from}</span>
                          <span className="text-gray-300">→</span>
                          <span>{c.to}</span>
                          <span className="text-gray-400 text-sm">({c.relationType})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {summary.nextActions.length > 0 && (
                  <div>
                    <h4 className="text-base font-medium text-gray-500 mb-1">建议</h4>
                    <ul className="space-y-0.5">
                      {summary.nextActions.map((a, i) => (
                        <li key={i} className="text-base text-gray-600 flex items-start gap-1">
                          <span className="text-blue-400 mt-0.5">•</span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : summary && !summary.ok ? (
            <div className="bg-white border border-gray-200 p-3 flex items-center justify-between" style={{ borderRadius: '4px' }}>
              <div className="flex items-center gap-2">
                <span className="text-base text-gray-400">总结暂不可用</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSummaryPeriod('7d')}
                  className={`px-2 py-0.5 text-xs transition-colors ${summaryPeriod === '7d' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                  style={{ borderRadius: '4px' }}
                >
                  7天
                </button>
                <button
                  onClick={() => setSummaryPeriod('30d')}
                  className={`px-2 py-0.5 text-xs transition-colors ${summaryPeriod === '30d' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                  style={{ borderRadius: '4px' }}
                >
                  30天
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-base text-gray-400">暂无数据可总结</p>
            </div>
          )
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
    </div>
  );
}
