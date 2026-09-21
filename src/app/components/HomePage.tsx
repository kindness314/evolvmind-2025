import { motion } from 'motion/react';
import { Loader2, Plus, Sparkles, Bell, Eye, Tag, X, CalendarRange, TrendingUp, TrendingDown, Lightbulb, ArrowRight, Layers, BookOpen } from 'lucide-react';
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
  const [clickedRecIds, setClickedRecIds] = useState<Set<string>>(new Set());
  const [expandedRecId, setExpandedRecId] = useState<string | null>(null);
  const [summaryDetailExpanded, setSummaryDetailExpanded] = useState(false);

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
      const result = await fetchRecommendations({ dismissedIds: [...dismissedRecIds], clickedIds: [...clickedRecIds] });
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
      fetchRecommendations({ dismissedIds: [...dismissedRecIds], clickedIds: [...clickedRecIds] }).then((r) => setRecommendations(r.recommendations));
    }
  }, [active, summaryPeriod, dismissedRecIds, clickedRecIds]);

  const tabBase = 'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all';
  const tabActive = 'bg-white text-brand shadow-card';
  const tabIdle = 'text-gray-500 hover:text-gray-700';

  // 推荐类型配置
  const recTypeMeta: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    knowledge_topic: { icon: <Layers className="w-3 h-3" />, label: '主题推荐', color: 'bg-amber-50 text-amber-700' },
    knowledge_node: { icon: <BookOpen className="w-3 h-3" />, label: '知识回顾', color: 'bg-violet-50 text-violet-700' },
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
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setHomeTab('recs')}
            className={`${tabBase} ${homeTab === 'recs' ? tabActive : tabIdle}`}
            style={{ borderRadius: 8 }}
          >
            <Sparkles className="w-4 h-4" />
            为你推荐
          </button>
          <button
            onClick={() => setHomeTab('summary')}
            className={`${tabBase} ${homeTab === 'summary' ? tabActive : tabIdle}`}
            style={{ borderRadius: 8 }}
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
              <Loader2 className="w-8 h-8 text-brand animate-spin mb-2" />
              <p className="text-base text-gray-400">正在生成推荐...</p>
            </div>
          ) : recommendations.length > 0 ? (
            (() => {
              const typeOrder = ['knowledge_topic', 'knowledge_node', 'review', 'semantic', 'graph_bridge', 'forming', 'related'];
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
                      <div key={group.type} className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/70 border-b border-gray-100">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium ${meta.color}`} style={{ borderRadius: 6 }}>
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
                                // P5 点击正反馈：记录点击的推荐，下次请求上报（服务端 +0.5）
                                setClickedRecIds((prev) => (prev.has(rec.id) ? prev : new Set([...prev, rec.id])));
                                if (rec.targetType === 'node' && rec.nodeId) {
                                  onNavigate?.('knowledge', rec.nodeId);
                                } else if (rec.targetType === 'captured') {
                                  onNavigate?.('item-detail', rec.targetId);
                                }
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-brand-soft/50 transition-colors group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <span className="text-sm text-gray-800 font-medium">{rec.title}</span>
                                  {rec.action && (
                                    <div className="flex items-start gap-1 mt-1">
                                      <Lightbulb className="w-3 h-3 text-brand mt-0.5 flex-none" />
                                      <p className="text-xs text-brand-strong leading-relaxed">{rec.action}</p>
                                    </div>
                                  )}
                                  {(rec.evidence && rec.evidence.length > 0) ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedRecId((prev) => (prev === rec.id ? null : rec.id));
                                      }}
                                      className="mt-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                      {expandedRecId === rec.id ? '收起依据' : '查看依据'}
                                    </button>
                                  ) : null}
                                  {expandedRecId === rec.id && (
                                    <>
                                      {rec.reason ? (
                                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{rec.reason}</p>
                                      ) : null}
                                      {rec.evidence && rec.evidence.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                          {rec.evidence.map((ev) => (
                                            <span
                                              key={`${ev.type}-${ev.id}`}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-50 border border-gray-100 text-[11px] text-gray-500 max-w-full"
                                              style={{ borderRadius: 6 }}
                                            >
                                              {ev.type === 'node'
                                                ? <Tag className="w-2.5 h-2.5 flex-none" />
                                                : <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-none" />}
                                              <span className="truncate">{ev.title}</span>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </>
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
              <Loader2 className="w-8 h-8 text-brand animate-spin mb-2" />
              <p className="text-base text-gray-400">正在生成总结...</p>
            </div>
          ) : summary && summary.ok && (summary.stats.capturedCount > 0 || summary.stats.newNodeCount > 0) ? (
            <div className="space-y-3">
              {/* 周期切换 */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">近期总结</span>
                <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                  <button
                    onClick={() => setSummaryPeriod('7d')}
                    className={`px-2.5 py-0.5 text-xs transition-all ${summaryPeriod === '7d' ? 'bg-white text-brand font-medium shadow-sm rounded-md' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    7 天
                  </button>
                  <button
                    onClick={() => setSummaryPeriod('30d')}
                    className={`px-2.5 py-0.5 text-xs transition-all ${summaryPeriod === '30d' ? 'bg-white text-brand font-medium shadow-sm rounded-md' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    30 天
                  </button>
                </div>
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 text-xs text-gray-500 rounded-lg">
                <span><span className="font-medium text-gray-700">{summary.stats.capturedCount}</span> 条捕获</span>
                <span className="text-gray-300">|</span>
                <span><span className="font-medium text-gray-700">{summary.stats.newNodeCount}</span> 个节点</span>
                <span className="text-gray-300">|</span>
                <span><span className="font-medium text-gray-700">{summary.stats.newLinkCount}</span> 个关系</span>
              </div>

              {/* 本期新增（表格，替代原长叙事段落，2026-09-19 用户要求） */}
              {((summary.newThemes && summary.newThemes.length > 0) || (summary.newNodes && summary.newNodes.length > 0)) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border border-brand-100 overflow-hidden rounded-xl shadow-card"
                  style={{ background: 'linear-gradient(135deg, var(--brand-soft) 0%, #ffffff 55%)' }}
                >
                  <h4 className="px-3 py-1.5 text-xs font-medium text-brand bg-brand-soft/60 border-b border-brand-100 flex items-center gap-1.5">
                    <CalendarRange className="w-3 h-3" />
                    本期新增
                  </h4>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-100">
                        <th className="px-3 py-1.5 font-medium w-12">类型</th>
                        <th className="px-1 py-1.5 font-medium">名称</th>
                        <th className="px-3 py-1.5 font-medium text-right w-20">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(summary.newThemes || []).map((t, i) => (
                        <tr key={`theme-${i}`} className="border-b border-gray-50 last:border-0">
                          <td className="px-3 py-1.5 text-emerald-600">主题</td>
                          <td className="px-1 py-1.5 text-gray-700">{t.name}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400">新出现 ×{t.recent}</td>
                        </tr>
                      ))}
                      {(summary.newNodes || []).map((n, i) => (
                        <tr key={`node-${i}`} className="border-b border-gray-50 last:border-0">
                          <td className="px-3 py-1.5 text-brand">节点</td>
                          <td className="px-1 py-1.5 text-gray-700">{n.name}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400">{n.kind}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </motion.div>
              )}

              {/* Trends（变化趋势） */}
              {summary.trends.length > 0 && (
                <div className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
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

              {/* 主题动态（确定性方向信号） */}
              {summary.themeTrends && summary.themeTrends.length > 0 && (
                <div className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    主题动态
                  </h4>
                  <div className="px-3 py-2 flex flex-wrap gap-1.5">
                    {summary.themeTrends.map((t, i) => {
                      const m = trendMeta[t.direction] || trendMeta.stable;
                      const chipCls =
                        t.direction === 'up' || t.direction === 'new'
                          ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                          : t.direction === 'down'
                            ? 'border-amber-100 bg-amber-50 text-amber-700'
                            : 'border-gray-100 bg-gray-50 text-gray-500';
                      return (
                        <span
                          key={i}
                          title={t.detail}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border ${chipCls}`}
                          style={{ borderRadius: 6 }}
                        >
                          <span className={m.color}>{m.icon}</span>
                          {t.name}
                          <span className="opacity-70">{t.recent}↔{t.older}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 话题分点总结（替代条形图卡片，2026-09-19 用户要求） */}
              {summary.themes.length > 0 && (
                <div className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    话题总结
                  </h4>
                  <ul className="px-3 py-2 space-y-1.5 list-none">
                    {summary.themes.map((t, i) => {
                      const tMeta = trendMeta[t.direction || 'stable'] || trendMeta.stable;
                      const text = t.insight || t.detail || '';
                      return (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand flex-none" />
                          <span className="text-gray-600 leading-relaxed">
                            <span className="font-medium text-gray-800">{t.name}</span>
                            <span className="text-gray-400">（{t.count} 条）</span>
                            {t.direction && t.direction !== 'stable' && (
                              <span className={`inline-flex items-center ml-1 ${tMeta.color}`}>{tMeta.icon}</span>
                            )}
                            {text && <span>：{text}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Important nodes */}
              {summary.importantNodes.length > 0 && (
                <div className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    重要节点
                  </h4>
                  <div className="px-3 py-2 space-y-2">
                    {summary.importantNodes.map((n, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div
                          className="w-1.5 h-1.5 mt-1.5 rounded-full bg-brand flex-none"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-800">{n.name}</span>
                            <span className="text-[11px] text-gray-400">{n.kind}</span>
                          </div>
                          {summaryDetailExpanded && <p className="text-xs text-gray-500 mt-0.5">{n.reason}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Highlights（原文摘录） */}
              {summaryDetailExpanded && summary.highlights.length > 0 && (
                <div className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
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
                <div className="bg-card border border-gray-100 overflow-hidden rounded-xl shadow-card">
                  <h4 className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                    新发现的关联
                  </h4>
                  <div className="px-3 py-1.5 space-y-0.5">
                    {summary.newConnections.map((c, i) => (
                      <div key={i} className="py-1">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <span className="text-gray-700">{c.from}</span>
                          <span className="text-gray-300">→</span>
                          <span className="text-gray-700">{c.to}</span>
                          <span className="text-gray-400 ml-1">({c.relationType})</span>
                        </div>
                        {c.significance && (
                          <p className="text-[11px] text-gray-400 mt-0.5 flex items-start gap-1">
                            <Lightbulb className="w-2.5 h-2.5 text-amber-400 mt-0.5 flex-none" />
                            {c.significance}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next actions（高亮卡） */}
              {summary.nextActions.length > 0 && (
                <div
                  className="border border-brand-200 overflow-hidden rounded-xl shadow-card"
                  style={{ background: 'linear-gradient(135deg, var(--brand-soft) 0%, #f0f9ff 100%)' }}
                >
                  <h4 className="px-3 py-1.5 text-xs font-medium text-brand bg-brand-soft/80 border-b border-brand-200 flex items-center gap-1.5">
                    <Lightbulb className="w-3 h-3" />
                    建议行动
                  </h4>
                  <div className="px-3 py-2 space-y-1.5">
                    {summary.nextActions.map((a, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="flex-none w-4 h-4 rounded-full bg-brand text-white text-[11px] flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-brand-strong leading-relaxed">{a}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : summary && !summary.ok ? (
            <div className="bg-card border border-gray-100 p-3 rounded-xl shadow-card">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">总结暂不可用</span>
                <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                  <button onClick={() => setSummaryPeriod('7d')} className={`px-2 py-0.5 text-xs ${summaryPeriod === '7d' ? 'bg-white text-brand font-medium rounded-md shadow-sm' : 'text-gray-500'}`}>7 天</button>
                  <button onClick={() => setSummaryPeriod('30d')} className={`px-2 py-0.5 text-xs ${summaryPeriod === '30d' ? 'bg-white text-brand font-medium rounded-md shadow-sm' : 'text-gray-500'}`}>30 天</button>
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
        whileTap={{ scale: 0.92 }}
        onClick={() => onNavigate?.('capture')}
        className="absolute right-4 bottom-36 w-14 h-14 bg-brand text-white shadow-float hover:brightness-110 transition-all flex items-center justify-center z-10 rounded-full"
        aria-label="捕获信息"
      >
        <Plus className="w-6 h-6" strokeWidth={2.4} />
      </motion.button>
    </div>
  );
}
