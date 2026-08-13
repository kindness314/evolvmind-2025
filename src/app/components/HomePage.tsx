import { motion } from 'motion/react';
import { Loader2, Plus, Sparkles, Bell, Eye, Tag, X, CalendarRange, TrendingUp, TrendingDown, Lightbulb, ArrowRight } from 'lucide-react';
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
      if (!cancelled) { setSummary(result); setSummaryLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [summaryPeriod]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setRecsLoading(true);
      const result = await fetchRecommendations({ dismissedIds: [...dismissedRecIds] });
      if (!cancelled) { setRecommendations(result.recommendations); setRecsLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [dismissedRecIds]);

  // keep-alive: 从其他页切回首页时静默刷新
  const prevActiveRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevActiveRef.current === false && active === true) {
      fetchSummary({ period: summaryPeriod }).then(setSummary);
      fetchRecommendations({ dismissedIds: [...dismissedRecIds] }).then((r) => setRecommendations(r.recommendations));
    }
    prevActiveRef.current = active;
  }, [active, summaryPeriod, dismissedRecIds]);

  const tabBase = 'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors';
  const tabActive = 'bg-white text-blue-600 shadow-sm';
  const tabIdle = 'text-gray-500 hover:text-gray-700';

  // 推荐类型配置
  const recTypeMeta: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    review: { icon: <Eye className="w-3 h-3" />, label: '回顾', color: 'bg-blue-50 text-blue-700' },
    semantic: { icon: <Sparkles className="w-3 h-3" />, label: '语义关联', color: 'bg-indigo-50 text-indigo-700' },
    graph_bridge: { icon: <Tag className="w-3 h-3" />, label: '图桥发现', color: 'bg-emerald-50 text-emerald-700' },
    forming: { icon: <TrendingUp className="w-3 h-3" />, label: '形成中', color: 'bg-purple-50 text-purple-700' },
    related: { icon: <Tag className="w-3 h-3" />, label: '关联', color: 'bg-green-50 text-green-700' },
  };

  // 趋势方向配置
  const trendMeta: Record<string, { icon: React.ReactNode; color: string }> = {
    up: { icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'text-emerald-600' },
    down: { icon: <TrendingDown className="w-3.5 h-3.5" />, color: 'text-amber-600' },
    new: { icon: <Sparkles className="w-3.5 h-3.5" />, color: 'text-blue-600' },
    stable: { icon: <ArrowRight className="w-3.5 h-3.5" />, color: 'text-gray-400' },
  };

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* 顶部模块切换 */}
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
          /* ===== 推荐卡片 ===== */
          recsLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
              <p className="text-base text-gray-400">正在生成推荐...</p>
            </div>
          ) : recommendations.length > 0 ? (
            (() => {
              const typeOrder = ['review', 'semantic', 'graph_bridge', 'forming', 'related'];
              const grouped = new Map<string, Recommendation[]>();
              for (const rec of recommendations) {
                const list = grouped.get(rec.type) || [];
                list.push(rec);
                grouped.set(rec.type, list);
              }
              const sortedGroups = typeOrder.filter((t) => grouped.has(t)).map((t) => ({ type: t, items: grouped.get(t)! }));

              return (
                <div className="space-y-4">
                  {sortedGroups.map((group) => {
                    const meta = recTypeMeta[group.type] || recTypeMeta.related;
                    return (
                      <div key={group.type} className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium ${meta.color}`} style={{ borderRadius: '3px' }}>
                            {meta.icon} {meta.label}
                          </span>
                          <span className="text-xs text-gray-400">{group.items.length} 项</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {group.items.map((rec) => (
                            <motion.button
                              key={rec.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              onClick={() => {
                                if (rec.targetType === 'node' && rec.nodeId) {
                                  onNavigate?.('knowledge', rec.nodeId);
                                } else if (rec.targetType === 'captured') {
                                  onNavigate?.('item-detail', rec.targetId);
                                }
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50/30 transition-colors group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <span className="text-sm text-gray-800 font-medium">{rec.title}</span>
                                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{rec.reason}</p>
                                  {rec.action && (
                                    <div className="flex items-start gap-1 mt-1">
                                      <Lightbulb className="w-3 h-3 text-blue-400 mt-0.5 flex-none" />
                                      <p className="text-xs text-blue-600 leading-relaxed">{rec.action}</p>
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDismissedRecIds((prev) => new Set([...prev, rec.id]));
                                  }}
                                  className="flex-none p-0.5 text-gray-300 hover:text-gray-500 transition-colors opacity-0 group-hover:opacity-100 mt-0.5"
                                  aria-label="关闭推荐"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            <div className="text-center py-12">
              <p className="text-base text-gray-400">暂无推荐</p>
            </div>
          )
        ) : (
          /* ===== 总结卡片 ===== */
          summaryLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
              <p className="text-base text-gray-400">正在生成总结...</p>
            </div>
          ) : summary && summary.ok && (summary.stats.capturedCount > 0 || summary.stats.newNodeCount > 0) ? (
            <div className="space-y-3">
              {/* 周期切换 */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">近期总结</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSummaryPeriod('7d')}
                    className={`px-2.5 py-0.5 text-xs transition-colors ${summaryPeriod === '7d' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                    style={{ borderRadius: '4px' }}
                  >
                    7 天
                  </button>
                  <button
                    onClick={() => setSummaryPeriod('30d')}
                    className={`px-2.5 py-0.5 text-xs transition-colors ${summaryPeriod === '30d' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                    style={{ borderRadius: '4px' }}
                  >
                    30 天
                  </button>
                </div>
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 text-xs text-gray-500" style={{ borderRadius: '4px' }}>
                <span><span className="font-medium text-gray-700">{summary.stats.capturedCount}</span> 条捕获</span>
                <span className="text-gray-300">|</span>
                <span><span className="font-medium text-gray-700">{summary.stats.newNodeCount}</span> 个节点</span>
                <span className="text-gray-300">|</span>
                <span><span className="font-medium text-gray-700">{summary.stats.newLinkCount}</span> 个关系</span>
              </div>

              {/* Narrative（LLM 叙事式总结） */}
              {summary.narrative && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white border border-blue-100 px-3 py-2.5"
                  style={{ borderRadius: '4px' }}
                >
                  <p className="text-sm text-gray-700 leading-relaxed">{summary.narrative}</p>
                </motion.div>
              )}

              {/* Trends（变化趋势） */}
              {summary.trends.length > 0 && (
                <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    变化趋势
                  </h4>
                  <div className="px-3 py-2 space-y-1.5">
                    {summary.trends.map((t, i) => {
                      const meta = trendMeta[t.direction] || trendMeta.stable;
                      return (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className={`mt-0.5 flex-none ${meta.color}`}>{meta.icon}</span>
                          <span className="text-gray-600">{t.detail}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Themes（卡片式） */}
              {summary.themes.length > 0 && (
                <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    关注主题
                  </h4>
                  <div className="px-3 py-2 space-y-2">
                    {summary.themes.map((t, i) => {
                      const maxCount = Math.max(...summary.themes.map((x) => x.count), 1);
                      const barWidth = Math.round((t.count / maxCount) * 100);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-sm text-gray-700 w-20 truncate flex-none">{t.name}</span>
                          <div className="flex-1 h-2 bg-gray-100 overflow-hidden" style={{ borderRadius: '2px' }}>
                            <div
                              className="h-full bg-blue-400 transition-all"
                              style={{ width: `${barWidth}%`, borderRadius: '2px' }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-6 text-right flex-none">{t.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Important nodes */}
              {summary.importantNodes.length > 0 && (
                <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    重要节点
                  </h4>
                  <div className="px-3 py-2 space-y-2">
                    {summary.importantNodes.map((n, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div
                          className="w-1.5 h-1.5 mt-1.5 rounded-full bg-blue-400 flex-none"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-800">{n.name}</span>
                            <span className="text-[11px] text-gray-400">{n.kind}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{n.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Highlights（原文摘录） */}
              {summary.highlights.length > 0 && (
                <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    代表性摘录
                  </h4>
                  <div className="px-3 py-2 space-y-1.5">
                    {summary.highlights.map((h, i) => (
                      <p key={i} className="text-xs text-gray-500 italic leading-relaxed border-l-2 border-gray-200 pl-2">
                        {h}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* New connections（折叠式） */}
              {summary.newConnections.length > 0 && (
                <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: '4px' }}>
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    新发现的关联
                  </h4>
                  <div className="px-3 py-1.5 space-y-0.5">
                    {summary.newConnections.map((c, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs text-gray-500">
                        <span className="text-gray-700">{c.from}</span>
                        <span className="text-gray-300">→</span>
                        <span className="text-gray-700">{c.to}</span>
                        <span className="text-gray-400 ml-1">({c.relationType})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next actions（高亮卡） */}
              {summary.nextActions.length > 0 && (
                <div
                  className="border border-blue-200 overflow-hidden"
                  style={{ borderRadius: '4px', background: 'linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)' }}
                >
                  <h4 className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100/50 border-b border-blue-200 flex items-center gap-1.5">
                    <Lightbulb className="w-3 h-3" />
                    建议行动
                  </h4>
                  <div className="px-3 py-2 space-y-1.5">
                    {summary.nextActions.map((a, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="text-blue-400 text-xs mt-0.5">•</span>
                        <span className="text-sm text-blue-800 leading-relaxed">{a}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : summary && !summary.ok ? (
            <div className="bg-white border border-gray-200 p-3" style={{ borderRadius: '4px' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">总结暂不可用</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setSummaryPeriod('7d')} className={`px-2 py-0.5 text-xs ${summaryPeriod === '7d' ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`} style={{ borderRadius: '4px' }}>7 天</button>
                  <button onClick={() => setSummaryPeriod('30d')} className={`px-2 py-0.5 text-xs ${summaryPeriod === '30d' ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`} style={{ borderRadius: '4px' }}>30 天</button>
                </div>
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
