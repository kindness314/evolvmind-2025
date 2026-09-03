import { Search, ZoomIn, ZoomOut, Maximize2, Loader2, Sparkles, Plus, X, ExternalLink, Network, Layers, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
import { supabase } from '../../lib/supabase';
import { checkGraphSetup, type GraphSetupStatus } from '../../lib/graph';
import { semanticSearchKnowledgeNodes, type KnowledgeNodeSearchResult } from '../../lib/graphSearch';
import { getApiAuthHeaders } from '../../lib/apiAuth';
import { buildHierarchicalGraph, buildSemanticHierarchy, type SuperTopic, type TopicAggregate } from '../../lib/community';
import { loadNodeTopicCache, saveNodeTopicCache, type NodeTopicMap } from '../../lib/nodeTopics';
import { clusteredTopicLayout } from '../../lib/topicLayout';
import { fetchSummary } from '../../lib/summarize';
interface GraphNode {
  id: string;
  name: string;
  val: number;
  color: string;
  kind?: string;
  aliases?: string[];
  source_captured_ids?: string[];
  metadata?: Record<string, unknown>;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  created_at?: string | null;
  /** 分层聚合图：话题大节点 */
  isTopic?: boolean;
  /** 话题大节点对应的社区 id */
  communityId?: number;
  /** 弱化显示（其他知识桶） */
  isDimmed?: boolean;
  /** 下钻2 的跨话题节点（邻居话题）：介于正常和 isDimmed 之间——保留名称但适度弱化，突出本话题 */
  isCrossTopic?: boolean;
  /** 话题成员数（半径/标签布局依据） */
  memberCount?: number;
  /** 大话题节点（总览层） */
  isSuperTopic?: boolean;
}

/** 话题状况数据（"话题状况"抽屉）——让用户读懂一个主题的内容、趋势、下一步 */
interface TopicInsightData {
  /** 当前话题名（大话题/中话题） */
  topicName: string;
  topicColor: string;
  /** 关联内容数（成员/捕获） */
  memberCount: number;
  /** 关联的捕获记录总数 */
  capturedCount: number;
  /** 本周新增内容数 */
  newThisWeek: number;
  /** 关联的其他主题（名） */
  relatedTopics: string[];
  /** 代表性内容（标题 + 摘要），供用户快速回顾 */
  representativeItems: Array<{ id: string; title: string; summary: string }>;
  /** 趋势变化 */
  trends: Array<{ label: string; direction: 'up' | 'down' | 'stable'; detail: string }>;
  /** 下一步建议 */
  suggestions: string[];
}

interface GraphLink {
  id?: string;
  source: string | GraphNode;
  target: string | GraphNode;
  relation_type?: string | null;
  evidence_captured_ids?: string[];
  confidence?: number | null;
  created_at?: string | null;
}

interface CapturedSource {
  id: string;
  title: string;
  type?: string | null;
  summary?: string | null;
  content?: string | null;
  created_at?: string | null;
}

interface NodeRelation {
  id?: string;
  source: string;
  target: string;
  relation_type?: string | null;
  evidence_captured_ids?: string[];
  confidence?: number | null;
}

/** PostgREST 查询行类型（显式声明，避免泛型推断依赖 supabase-js 类型解析） */
interface KnowledgeNodeRow extends Record<string, unknown> {
  id: string;
  name: string;
  val: number | null;
  color: string | null;
  kind: string | null;
  aliases: string[] | null;
  source_captured_ids: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

interface KnowledgeLinkRow extends Record<string, unknown> {
  id: string | null;
  source: string;
  target: string;
  relation_type: string | null;
  evidence_captured_ids: string[] | null;
  confidence: number | null;
  created_at: string | null;
}


const NODE_KIND_META: Record<string, { label: string; color: string }> = {
  concept: { label: '概念', color: '#3B82F6' },
  view: { label: '观点', color: '#8B5CF6' },
  conclusion: { label: '结论', color: '#06B6D4' },
  question: { label: '问题', color: '#F59E0B' },
  todo: { label: '待办', color: '#EF4444' },
  person: { label: '人物', color: '#10B981' },
  event: { label: '事件', color: '#F97316' },
  object: { label: '对象', color: '#6366F1' },
  time: { label: '时间', color: '#84CC16' },
  location: { label: '地点', color: '#14B8A6' },
  unknown: { label: '未分类', color: '#64748B' },
};

const RELATION_TYPE_LABELS: Record<string, string> = {
  related_to: '相关',
  part_of: '属于',
  causes: '导致',
  supports: '支持',
  contradicts: '矛盾',
  example_of: '示例',
  depends_on: '依赖',
  leads_to: '导向',
  similar_to: '相似',
  opposite_of: '对立',
};

function getRelationLabel(relationType: string | null | undefined): string {
  if (relationType && RELATION_TYPE_LABELS[relationType]) {
    return RELATION_TYPE_LABELS[relationType];
  }
  return relationType || '相关内容';
}

function linkEndpointId(endpoint: string | GraphNode) {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function getNodeKind(node: GraphNode) {
  return node.kind && NODE_KIND_META[node.kind] ? node.kind : 'unknown';
}

function truncateLabel(label: string, maxLength: number) {
  return label.length > maxLength ? `${label.slice(0, maxLength)}…` : label;
}

/** 话题节点半径（px，canvas 尺度）：按成员数对数缩放。
 *  曲线刻意压平（11 + 8·log2，封顶 21px）：3 成员 ≈14px、81 成员 ≈21px，
 *  避免巨型话题（如 81 成员的社区）视觉上压倒多数小话题。 */
const TOPIC_RADIUS_MIN = 12;
const TOPIC_RADIUS_MAX = 21;
function topicRadiusPx(memberCount: number | undefined): number {
  const members = memberCount && memberCount > 0 ? memberCount : 3;
  return Math.max(TOPIC_RADIUS_MIN, Math.min(TOPIC_RADIUS_MAX, 11 + 8 * (Math.log2(members + 1) / Math.log2(45))));
}

/** 与 canvas 绘制一致的节点半径（graph 单位），供碰撞松弛/标签布局复用 */
function nodeRenderRadius(node: GraphNode): number {
  if (node.isTopic) {
    if (node.isDimmed) return TOPIC_RADIUS_MIN; // 其他知识桶：固定小尺寸弱化
    return topicRadiusPx(node.memberCount);
  }
  // 成员节点：加大到 14px 上限，让下钻2 成员更清晰可读（原 5-10 太小）
  return Math.max(7, Math.min(14, 4 + Math.sqrt(node.val || 6) * 1.9));
}


function hexagonPath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + radius * Math.cos(angle);
    const py = y + radius * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

function buildAdjacencyMap(links: GraphLink[]) {
  const adjacency = new Map<string, Set<string>>();
  links.forEach((link) => {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)!.add(target);
    adjacency.get(target)!.add(source);
  });
  return adjacency;
}

function getConnectedComponentNodeIds(startId: string, links: GraphLink[]) {
  const adjacency = buildAdjacencyMap(links);
  const component = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    adjacency.get(current)?.forEach((neighbor) => {
      if (!component.has(neighbor)) {
        component.add(neighbor);
        queue.push(neighbor);
      }
    });
  }
  return component;
}

export interface KnowledgePageProps {
  initialNodeId?: string | null;
  onNavigate?: (page: string, itemId?: string) => void;
}

interface NodeDetailState {
  node: GraphNode;
  sources: CapturedSource[];
  relations: NodeRelation[];
  loading: boolean;
  error: string | null;
}

export function KnowledgePage({ initialNodeId, onNavigate }: KnowledgePageProps) {
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const graphAreaRef = useRef<HTMLDivElement>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const sidePanelRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  /** 拖拽后不自动 fit（保持用户视图）；首次/下钻/筛选时由调用方置 true 触发适配 */
  const autoFitRef = useRef(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [setupStatus, setSetupStatus] = useState<GraphSetupStatus | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: []
  });
  const [searchResults, setSearchResults] = useState<KnowledgeNodeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeKind, setActiveKind] = useState<string>('all');
  // 侧边话题面板可折叠（2026-09）：默认折叠，让图谱占满画布不挡视线；点「话题列表」展开查看
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(true);
  // ---- 语义主题分类（2026-08-19 改向：数据生成时分类，页面只读缓存 + 表全空兜底）----
  // 权威来源是 topic_labels 数据库表（数据生成时由 graph.ts 写入）；localStorage 仅作本地镜像。
  // 页面加载只读表，不再对未分类节点逐批实时调 LLM；仅当表完全为空（从未分类过）才兜底一次。
  const topicScope = localStorage.getItem('demo_auth') === 'true' ? 'demo' : 'local';
  const DEMO_SCOPE = '00000000-0000-0000-0000-000000000000';
  const [nodeTopicMap, setNodeTopicMap] = useState<NodeTopicMap>(new Map());
  const nodeTopicRef = useRef(nodeTopicMap);
  const classifyingRef = useRef(false);
  // 当前真实 scope_id（demo 固定 UUID；真实用户挂载时确定）
  const scopeIdRef = useRef<string>(DEMO_SCOPE);
  useEffect(() => {
    nodeTopicRef.current = nodeTopicMap;
  }, [nodeTopicMap]);

  // 页面挂载：确定 scope_id 并读取 topic_labels 表；表全空（从未分类过）才触发一次全量兜底分类
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let scopeId = DEMO_SCOPE;
      if (topicScope !== 'demo') {
        const { data: ud } = await supabase.auth.getUser();
        scopeId = ud?.user?.id || scopeId;
      }
      scopeIdRef.current = scopeId;
      const { data, error } = await supabase
        .from('topic_labels')
        .select('cluster_key,name')
        .eq('scope_id', scopeId)
        .limit(5000);
      if (cancelled) return;
      if (error || !data || data.length === 0) {
        // 表全空：没有一个数据被分类过 → 才触发一次全量兜底分类
        setNodeTopicMap(new Map());
        if (graphData.nodes.length > 0 && !classifyingRef.current) {
          classifyingRef.current = true;
          const isDemo = localStorage.getItem('demo_auth') === 'true';
          const items = graphData.nodes.map((n) => ({ id: n.id, name: n.name, aliases: n.aliases || [] }));
          for (let i = 0; i < items.length; i += 200) {
            const batch = items.slice(i, i + 200);
            try {
              const resp = await fetch('/api/graph/topicize', {
                method: 'POST',
                headers: await getApiAuthHeaders(),
                body: JSON.stringify({ nodes: batch, demo: isDemo }),
              });
              if (!resp.ok) continue;
              const j = (await resp.json()) as { map?: Record<string, string> };
              if (j.map) {
                const c = new Map(nodeTopicRef.current);
                for (const [id, cat] of Object.entries(j.map)) if (cat) c.set(id, cat);
                nodeTopicRef.current = c;
                setNodeTopicMap(c);
              }
            } catch {
              // 兜底失败不阻塞图谱展示
            }
          }
          saveNodeTopicCache(topicScope, nodeTopicRef.current);
          classifyingRef.current = false;
        }
        return;
      }
      const m = new Map<string, string>();
      for (const r of data) if (r.name) m.set(r.cluster_key, r.name);
      setNodeTopicMap(m);
      saveNodeTopicCache(topicScope, m);
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicScope, graphData.nodes.length]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<'all' | '7d' | '30d'>('all');
  /** 下钻层级：当前钻入的话题 id（null=话题总览层） */
  const [drillTopicId, setDrillTopicId] = useState<number | null>(null);
  /** 下钻层级：当前钻入的大话题 id（null=总览大话题层） */
  const [drillSuperId, setDrillSuperId] = useState<number | null>(null);
  /** 节点数超过该阈值时启用分层聚合（话题大节点）视图 */
  const COMMUNITY_VIEW_THRESHOLD = 150;
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<NodeDetailState | null>(null);
  // 话题状况抽屉（下钻层点话题 → 查看该主题的概览/趋势/建议）
  const [topicInsightOpen, setTopicInsightOpen] = useState(false);
  const [topicInsight, setTopicInsight] = useState<TopicInsightData | null>(null);
  // 当前 hover 的关系连线（用于显示"为什么相关"）
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);

  // 力导向按实际渲染规模调优（见 displayGraphData 之后定义 forceTuning）
  useEffect(() => {
    fetchGraphData();
    void checkGraphSetup()
      .then(setSetupStatus)
      .catch((e) => setSetupStatus({ schemaOk: false, llmOk: false, schemaError: String(e), llmError: String(e) }));

    const graphArea = graphAreaRef.current;
    if (!graphArea) return;

    const updateDimensions = () => {
      setDimensions({
        width: graphArea.clientWidth,
        height: graphArea.clientHeight,
      });
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(graphArea);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timeout = window.setTimeout(() => {
      semanticSearchKnowledgeNodes({ query, threshold: 0.2, count: 20 })
        .then((results) => {
          if (cancelled) return;
          setSearchResults(results);
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchError(e instanceof Error ? e.message : '语义搜索失败');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  const nodeById = useMemo(() => {
    return new Map(graphData.nodes.map((node) => [node.id, node]));
  }, [graphData.nodes]);
  useEffect(() => {
    let cancelled = false;
    const loadNodeDetail = async () => {
      if (!detailNodeId) {
        setNodeDetail(null);
        return;
      }
      const node = nodeById.get(detailNodeId);
      if (!node) return;
      const relations = graphData.links
        .filter((link) => linkEndpointId(link.source) === node.id || linkEndpointId(link.target) === node.id)
        .map((link) => ({ id: link.id, source: linkEndpointId(link.source), target: linkEndpointId(link.target), relation_type: link.relation_type, evidence_captured_ids: link.evidence_captured_ids || [], confidence: link.confidence }));
      setNodeDetail({ node, sources: [], relations, loading: true, error: null });
      try {
        const nodeSourceIds = node.source_captured_ids || [];
        const relationSourceIds = relations.flatMap((relation) => relation.evidence_captured_ids || []);
        const sourceIds = Array.from(new Set([...nodeSourceIds, ...relationSourceIds])).slice(0, 8);
        const sourcesResponse = sourceIds.length
          ? await supabase.from('captured_info').select('id,title,type,summary,content,created_at').in('id', sourceIds).order('created_at', { ascending: false }).limit(8)
          : { data: [], error: null };
        if (sourcesResponse.error) throw sourcesResponse.error;
        if (!cancelled) setNodeDetail({ node, sources: (sourcesResponse.data || []) as CapturedSource[], relations, loading: false, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : '加载节点详情失败';
        if (!cancelled) {
          setNodeDetail({ node, sources: [], relations, loading: false, error: message });
          toast.error(message, { description: '图谱仍可正常操作' });
        }
      }
    };
    void loadNodeDetail();
    return () => {
      cancelled = true;
    };
  }, [detailNodeId, graphData.links, nodeById]);

  const searchResultMap = useMemo(() => {
    return new Map(searchResults.map((result) => [result.id, result]));
  }, [searchResults]);

  const categoryItems = useMemo(() => {
    const counts = new Map<string, number>();
    graphData.nodes.forEach((node) => {
      const kind = getNodeKind(node);
      counts.set(kind, (counts.get(kind) || 0) + 1);
    });

    return [
      { kind: 'all', label: '全部', color: '#111827', count: graphData.nodes.length },
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => ({
          kind,
          label: NODE_KIND_META[kind]?.label || kind,
          color: NODE_KIND_META[kind]?.color || NODE_KIND_META.unknown.color,
          count,
        })),
    ];
  }, [graphData.nodes]);


  const categoryNodeIds = useMemo(() => {
    return new Set(
      graphData.nodes
        .filter((node) => activeKind === 'all' || getNodeKind(node) === activeKind)
        .map((node) => node.id)
    );
  }, [activeKind, graphData.nodes]);

  const localMatchIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || searchResults.length > 0) return new Set<string>();

    return new Set(
      graphData.nodes
        .filter((node) => categoryNodeIds.has(node.id))
        .filter((node) => {
          const text = [node.name, node.kind, ...(node.aliases || [])].join(' ').toLowerCase();
          return text.includes(query);
        })
        .map((node) => node.id)
    );
  }, [categoryNodeIds, graphData.nodes, searchQuery, searchResults.length]);

  const matchedIds = useMemo(() => {
    if (searchResults.length > 0) {
      return new Set(searchResults.map((result) => result.id).filter((id) => categoryNodeIds.has(id)));
    }
    return localMatchIds;
  }, [categoryNodeIds, localMatchIds, searchResults]);

  const visibleSearchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];

    if (searchResults.length > 0) {
      return searchResults
        .filter((result) => categoryNodeIds.has(result.id) && nodeById.has(result.id))
        .slice(0, 16);
    }

    return Array.from(localMatchIds)
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node))
      .slice(0, 16);
  }, [categoryNodeIds, localMatchIds, nodeById, searchQuery, searchResults]);

  // 分层聚合分析（全量图）：语义主题（LLM）优先；无分类结果时回退模块度话题
  const communityAnalysis = useMemo(() => {
    if (graphData.nodes.length < COMMUNITY_VIEW_THRESHOLD) {
      return { superTopics: [] as SuperTopic[], topics: [] as TopicAggregate[], nodeToTopic: new Map<string, number>(), nodeToSuper: new Map<string, number>(), nodeCommunity: new Map<string, { id: number; name: string; color: string }>() };
    }
    const cnodes = graphData.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind }));
    const clinks = graphData.links.map((l) => ({ source: linkEndpointId(l.source), target: linkEndpointId(l.target) }));
    const useSemantic = nodeTopicMap.size > 0;
    const { superTopics, topics, nodeToTopic, nodeToSuper } = useSemantic
      ? buildSemanticHierarchy(cnodes, clinks, nodeTopicMap)
      : buildHierarchicalGraph(cnodes, clinks);
    // 兼容层：nodeId → 话题元信息（供渲染/图例）
    const nodeCommunity = new Map<string, { id: number; name: string; color: string }>();
    for (const t of topics) {
      for (const mid of t.memberIds) nodeCommunity.set(mid, { id: t.communityId, name: t.name, color: t.color });
    }
    return { superTopics, topics, nodeToTopic, nodeToSuper, nodeCommunity };
  }, [graphData.links, graphData.nodes, nodeTopicMap]);

  // 话题模型命名（2026-08-18）：社区检测给出簇后，调 /api/graph/classify-topics 用 LLM 归纳更贴切簇名
  // 只命名 ≥3 成员且非"其他知识"桶的大簇（按成员数降序取前 20，控制 LLM 成本与首屏耗时）
  const [topicNameMap, setTopicNameMap] = useState<Record<number, string>>({});
  const topicRequestedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const topics = communityAnalysis.topics;
    if (topics.length === 0) return;
    // 语义主题（细主题）下中话题名已是细主题目录，无需再 LLM 重命名
    if (nodeTopicMap.size > 0) return;
    // 分批：每次 ≤5 簇（LLM 单次生成约 30s，20 簇一次会超 60s 预算）；topicNameMap 更新后 effect 重跑取下一批
    const pending = topics
      .filter((t) => t.communityId !== -1 && t.memberIds.length >= 3)
      .sort((a, b) => b.memberIds.length - a.memberIds.length)
      .slice(0, 5)
      .filter((t) => !topicRequestedRef.current.has(t.communityId) && !topicNameMap[t.communityId]);
    if (pending.length === 0) return;
    for (const t of pending) topicRequestedRef.current.add(t.communityId);
    let cancelled = false;
    const nameFor = (id: string): string => nodeById.get(id)?.name || id;
    (async () => {
      try {
        const resp = await fetch('/api/graph/classify-topics', {
          method: 'POST',
          headers: await getApiAuthHeaders(),
          body: JSON.stringify({
            clusters: pending.map((t) => ({
              communityId: t.communityId,
              name: t.name,
              nodeIds: t.memberIds,
              memberNames: t.sampleNames.length ? t.sampleNames : t.memberIds.slice(0, 12).map(nameFor),
            })),
            demo: localStorage.getItem('demo_auth') === 'true',
          }),
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { labels?: Record<string, { name: string }> };
        const labels = data?.labels;
        if (cancelled || !labels) return;
        setTopicNameMap((prev) => {
          const next = { ...prev };
          for (const [id, lab] of Object.entries(labels)) {
            const num = Number(id);
            if (lab?.name) next[num] = lab.name;
          }
          return next;
        });
      } catch {
        // 命名失败不影响图谱展示（保持默认簇名）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communityAnalysis.topics, nodeById, topicNameMap]);
  // 大话题（总览层）模型命名：与中话题分开命名（super id 与 topic id 各占独立、可能重叠的 id 空间）
  const [superNameMap, setSuperNameMap] = useState<Record<number, string>>({});
  const superRequestedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const supers = communityAnalysis.superTopics;
    if (supers.length === 0) return;
    // 语义主题（LLM 分类）下大话题名已是清晰目录，无需再 LLM 重命名
    if (nodeTopicMap.size > 0) return;
    const memberIdsOf = (s: SuperTopic): string[] =>
      s.subTopicIds.flatMap((tid) => communityAnalysis.topics.find((t) => t.communityId === tid)?.memberIds ?? []);
    const pending = supers
      .filter((s) => !s.isOther && s.memberCount >= 3)
      .sort((a, b) => b.memberCount - a.memberCount)
      .slice(0, 5)
      .filter((s) => !superRequestedRef.current.has(s.id) && !superNameMap[s.id]);
    if (pending.length === 0) return;
    for (const s of pending) superRequestedRef.current.add(s.id);
    let cancelled = false;
    const nameFor = (id: string): string => nodeById.get(id)?.name || id;
    (async () => {
      try {
        const resp = await fetch('/api/graph/classify-topics', {
          method: 'POST',
          headers: await getApiAuthHeaders(),
          body: JSON.stringify({
            clusters: pending.map((s) => ({
              communityId: s.id,
              name: s.name,
              nodeIds: memberIdsOf(s),
              memberNames: memberIdsOf(s).slice(0, 12).map(nameFor),
            })),
            demo: localStorage.getItem('demo_auth') === 'true',
          }),
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { labels?: Record<string, { name: string }> };
        const labels = data?.labels;
        if (cancelled || !labels) return;
        setSuperNameMap((prev) => {
          const next = { ...prev };
          for (const [id, lab] of Object.entries(labels)) {
            const num = Number(id);
            if (lab?.name) next[num] = lab.name;
          }
          return next;
        });
      } catch {
        // 命名失败不影响图谱展示（保持默认簇名）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communityAnalysis.superTopics, communityAnalysis.topics, nodeById, superNameMap]);

  /** 话题显示名：模型命名优先，未加载/失败回退默认簇名 */
  const topicDisplayName = (communityId: number, fallback: string): string => topicNameMap[communityId] || fallback;
  /** 大话题显示名：语义主题下直接用目录名（不查 superNameMap，避免旧模块度 id 冲突覆盖）；否则模型命名优先 */
  const superDisplayName = (superId: number, fallback: string): string =>
    nodeTopicMap.size > 0 ? fallback : superNameMap[superId] || fallback;
  // 切到语义主题时清空旧的命名缓存：旧模块度的 topic/super id 是 0..N 小数字，会与语义主题 id 冲突
  // （实测"财务与理财/社交与人际"被旧名"知识关联/番茄工作法"覆盖）。清空后中话题会重新 LLM 命名。
  const semanticNameResetRef = useRef(false);
  useEffect(() => {
    const semantic = nodeTopicMap.size > 0;
    if (semantic && !semanticNameResetRef.current) {
      semanticNameResetRef.current = true;
      setTopicNameMap({});
      setSuperNameMap({});
      topicRequestedRef.current = new Set();
      superRequestedRef.current = new Set();
    } else if (!semantic) {
      semanticNameResetRef.current = false;
    }
  }, [nodeTopicMap]);

  /** 当前下钻话题的成员类型构成（供侧边面板展示） */
  const drillTopicMembers = useMemo(() => {
    if (drillTopicId === null) return null;
    const topic = communityAnalysis.topics.find((t) => t.communityId === drillTopicId);
    if (!topic) return null;
    const counts = new Map<string, number>();
    for (const mid of topic.memberIds) {
      const node = nodeById.get(mid);
      if (!node) continue;
      const kind = getNodeKind(node);
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return {
      name: topicDisplayName(topic.communityId, topic.name),
      color: topic.color,
      total: topic.memberIds.length,
      hidden: topic.hiddenCount,
      kinds: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([kind, count]) => ({ kind, label: NODE_KIND_META[kind]?.label || kind, count })),
    };
  }, [communityAnalysis.topics, drillTopicId, nodeById, topicDisplayName]);

  const displayGraphData = useMemo(() => {
    const centerNodeId = focusedNodeId || selectedNodeIds[0] || null;
    const cutoffDate = timeRange === 'all' ? null : new Date(Date.now() - (timeRange === '7d' ? 7 : 30) * 86400000);

    // 时间范围内产生的节点 ID
    const timeNodeIds = cutoffDate
      ? new Set(
          graphData.nodes
            .filter((node) => node.created_at && new Date(node.created_at) >= cutoffDate)
            .map((node) => node.id)
        )
      : new Set(graphData.nodes.map((node) => node.id));

    // 时间范围内产生的边 ID
    const timeLinkIds = cutoffDate
      ? new Set(
          graphData.links
            .filter((link) => link.created_at && new Date(link.created_at) >= cutoffDate)
            .map((link) => link.id || `${linkEndpointId(link.source)}-${linkEndpointId(link.target)}`)
        )
      : new Set(graphData.links.map((link) => link.id || `${linkEndpointId(link.source)}-${linkEndpointId(link.target)}`));

    // 聚合模式：无过滤（无聚焦节点/分类/搜索/时间）+ 图够大 → 话题层级视图
    const useAggregation = communityAnalysis.superTopics.length > 0
      && !centerNodeId
      && activeKind === 'all'
      && !searchQuery.trim()
      && timeRange === 'all';

    if (useAggregation) {
      // ---- 话题层级视图：总览层（话题大节点 + 跨话题聚合边）或 下钻层（成员 + 邻居） ----
      // ---- 三层话题层级视图 ----
      // 总览层（drillSuperId===null）：大话题（superTopics）大节点 + 跨大话题聚合边
      // 下钻1（drillSuperId!==null && drillTopicId===null）：该大话题下的中话题大节点 + 跨中话题聚合边
      // 下钻2（drillTopicId!==null）：中话题成员小节点 + 邻居中话题大节点
      const drillTopic = drillTopicId !== null
        ? communityAnalysis.topics.find((t) => t.communityId === drillTopicId) ?? null
        : null;

      const aggNodes: GraphNode[] = [];
      const aggLinks: Array<{ source: string; target: string; relation_type?: string | null; count?: number }> = [];
      const aggLinkKey = new Map<string, { source: string; target: string; count: number; relation_type?: string | null }>();

      const pushAggLink = (source: string, target: string, original?: GraphLink) => {
        if (source === target) return;
        const key = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
        const existing = aggLinkKey.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          aggLinkKey.set(key, { source, target, count: 1, relation_type: original?.relation_type });
          aggLinks.push({ source, target, count: 1, relation_type: original?.relation_type });
        }
      };

      if (drillSuperId !== null && drillTopicId !== null && drillTopic) {
        // ---- 下钻2：中话题成员 + 邻居中话题大节点 ----
        const drillSet = new Set(drillTopic.memberIds);
        const neighborTopicIds = new Set<number>();
        for (const link of graphData.links) {
          const s = linkEndpointId(link.source);
          const t = linkEndpointId(link.target);
          if (!timeNodeIds.has(s) || !timeNodeIds.has(t)) continue;
          const sc = communityAnalysis.nodeToTopic.get(s);
          const tc = communityAnalysis.nodeToTopic.get(t);
          if (drillSet.has(s) && tc !== undefined && tc !== drillTopicId) neighborTopicIds.add(tc);
          if (drillSet.has(t) && sc !== undefined && sc !== drillTopicId) neighborTopicIds.add(sc);
        }
        for (const mid of drillTopic.memberIds) {
          const node = nodeById.get(mid);
          if (node && timeNodeIds.has(mid)) aggNodes.push({ ...node, isTopic: false });
        }
        for (const tid of neighborTopicIds) {
          const topic = communityAnalysis.topics.find((t) => t.communityId === tid);
          if (!topic) continue;
          aggNodes.push({
            id: `topic:${tid}`,
            name: topicDisplayName(topic.communityId, topic.name),
            val: Math.max(10, Math.min(28, 8 + topic.memberIds.length * 0.6)),
            color: topic.color,
            kind: 'topic',
            isTopic: true,
            communityId: tid,
            // 跨话题节点（邻居主题）：保留名称但适度弱化（小一点/淡一点），突出本话题成员
            isCrossTopic: true,
            memberCount: topic.memberIds.length,
          });
        }
        for (const link of graphData.links) {
          const s = linkEndpointId(link.source);
          const t = linkEndpointId(link.target);
          if (!timeNodeIds.has(s) || !timeNodeIds.has(t)) continue;
          const sc = communityAnalysis.nodeToTopic.get(s);
          const tc = communityAnalysis.nodeToTopic.get(t);
          const sInDrill = drillSet.has(s);
          const tInDrill = drillSet.has(t);
          if (!sInDrill && !tInDrill) continue;
          const sEnd = sInDrill ? s : `topic:${sc}`;
          const tEnd = tInDrill ? t : `topic:${tc}`;
          pushAggLink(sEnd, tEnd, link);
        }
      } else if (drillSuperId !== null) {
        // ---- 下钻1：该大话题下的中话题大节点 + 内部跨中话题聚合边 ----
        const subTopics = communityAnalysis.topics.filter((t) => t.parentSuperId === drillSuperId);
        // 无环种子：让力导向的 charge+link force 把有边关联的中话题聚在一起（同一层按关联度排布）
        subTopics.forEach((topic) => {
          aggNodes.push({
            id: `topic:${topic.communityId}`,
            name: topicDisplayName(topic.communityId, topic.name),
            val: topic.communityId === -1 ? 8 : Math.max(10, Math.min(32, 10 + topic.memberIds.length * 0.7)),
            color: topic.color,
            kind: 'topic',
            isTopic: true,
            communityId: topic.communityId,
            isDimmed: topic.communityId === -1,
            memberCount: topic.memberIds.length,
          });
        });
        const subSet = new Set(subTopics.map((t) => t.communityId));
        for (const link of graphData.links) {
          const s = linkEndpointId(link.source);
          const t = linkEndpointId(link.target);
          if (!timeNodeIds.has(s) || !timeNodeIds.has(t)) continue;
          const sc = communityAnalysis.nodeToTopic.get(s);
          const tc = communityAnalysis.nodeToTopic.get(t);
          if (sc === undefined || tc === undefined) continue;
          if (!subSet.has(sc) || !subSet.has(tc)) continue;
          pushAggLink(`topic:${sc}`, `topic:${tc}`, link);
        }
      } else {
        // ---- 总览层：大话题大节点 + 跨大话题聚合边（按关联度聚类，非固定环序） ----
        const supers = communityAnalysis.superTopics;
        supers.forEach((sup) => {
          aggNodes.push({
            id: `topic:${sup.id}`,
            name: sup.name,
            val: sup.isOther ? 8 : Math.max(10, Math.min(32, 10 + sup.memberCount * 0.7)),
            color: sup.color,
            kind: 'topic',
            isTopic: true,
            isSuperTopic: true,
            communityId: sup.id,
            isDimmed: sup.isOther,
            memberCount: sup.memberCount,
          });
        });
        for (const link of graphData.links) {
          const s = linkEndpointId(link.source);
          const t = linkEndpointId(link.target);
          if (!timeNodeIds.has(s) || !timeNodeIds.has(t)) continue;
          const ss = communityAnalysis.nodeToSuper.get(s);
          const ts = communityAnalysis.nodeToSuper.get(t);
          const sEnd = ss !== undefined ? `topic:${ss}` : s;
          const tEnd = ts !== undefined ? `topic:${ts}` : t;
          pushAggLink(sEnd, tEnd, link);
        }
      }

      // 话题大节点大小 = 成员数 + 跨话题度
      const crossDegree = new Map<string, number>();
      aggLinks.forEach((link) => {
        crossDegree.set(link.source, (crossDegree.get(link.source) || 0) + 1);
        crossDegree.set(link.target, (crossDegree.get(link.target) || 0) + 1);
      });

      // 同一层主题按关联度聚类排布（2026-08-19）：用聚合边离线算聚类坐标作为初始位置，替代固定环序
      const topicNodeIds = aggNodes.filter((n) => n.isTopic).map((n) => n.id);
      const layoutById = new Map(clusteredTopicLayout(topicNodeIds, aggLinks).map((p) => [p.id, p]));
      // 下钻2 成员节点（非 topic，isTopic:false）同样用聚类预设小尺度初始坐标，
      // 避免 force-graph 力导向把成员散到数千单位（曾实测 bbox 3700、fit 后 zoom 0.04 缩成点）。
      const memberNodeIds = aggNodes.filter((n) => !n.isTopic).map((n) => n.id);
      const memberLayoutById = new Map(clusteredTopicLayout(memberNodeIds, aggLinks).map((p) => [p.id, p]));

      return {
        nodes: aggNodes.map((node) => {
          if (node.isTopic) {
            const topic = communityAnalysis.topics.find((t) => t.communityId === node.communityId);
            const degree = crossDegree.get(node.id) || 0;
            const memberBase = node.memberCount ?? topic?.memberIds.length ?? 0;
            const pos = layoutById.get(node.id);
            return {
              ...node,
              ...(pos ? { x: pos.x, y: pos.y } : {}),
              // "其他知识"桶：固定小尺寸弱化显示，不随成员数膨胀成最大节点
              val: node.communityId === -1
                ? 8
                : Math.max(12, Math.min(36, 10 + memberBase * 0.5 + degree * 0.8)),
              isCenterNode: false,
            };
          }
          const mpos = memberLayoutById.get(node.id);
          return { ...node, ...(mpos ? { x: mpos.x, y: mpos.y } : {}), val: Math.max(6, Math.min(14, 6 + (crossDegree.get(node.id) || 0))), isCenterNode: centerNodeId === node.id };
        }),
        links: aggLinks.map((link) => ({ source: link.source, target: link.target, relation_type: link.relation_type, count: link.count })),
        newNodeIds: timeNodeIds,
        newLinkIds: timeLinkIds,
      };
    }

    // ---- 节点级视图（过滤/聚焦/小图）：原有逻辑 ----
    let visibleIds: Set<string>;
    let visibleLinks: GraphLink[];

    if (activeKind !== 'all') {
      visibleIds = new Set([...categoryNodeIds].filter((id) => timeNodeIds.has(id)));
      visibleLinks = [];
    } else if (centerNodeId) {
      const componentIds = getConnectedComponentNodeIds(centerNodeId, graphData.links);
      const contextNodeIds = new Set([...componentIds].filter((id) => !timeNodeIds.has(id)));
      visibleIds = new Set([...componentIds].filter((id) => timeNodeIds.has(id) || contextNodeIds.has(id)));
      if (!timeNodeIds.has(centerNodeId)) {
        visibleIds = new Set([...componentIds]);
      }
      visibleLinks = graphData.links.filter(
        (link) => visibleIds.has(linkEndpointId(link.source)) && visibleIds.has(linkEndpointId(link.target))
      );
    } else {
      visibleIds = new Set(timeNodeIds);
      visibleLinks = cutoffDate
        ? graphData.links.filter(
            (link) => timeNodeIds.has(linkEndpointId(link.source)) && timeNodeIds.has(linkEndpointId(link.target))
          )
        : graphData.links;
    }

    const degreeMap = new Map<string, number>();
    visibleLinks.forEach((link) => {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      degreeMap.set(source, (degreeMap.get(source) || 0) + 1);
      degreeMap.set(target, (degreeMap.get(target) || 0) + 1);
    });

    return {
      nodes: graphData.nodes
        .filter((node) => visibleIds.has(node.id))
        .map((node) => ({
          ...node,
          val: Math.max(6, Math.min(14, 6 + (degreeMap.get(node.id) || 0))),
          isCenterNode: centerNodeId === node.id,
        })),
      links: visibleLinks.map((link) => ({
        source: linkEndpointId(link.source),
        target: linkEndpointId(link.target),
      })),
      newNodeIds: timeNodeIds,
      newLinkIds: timeLinkIds,
    };
  }, [activeKind, categoryNodeIds, drillSuperId, drillTopicId, focusedNodeId, graphData, nodeById, searchQuery, selectedNodeIds, timeRange, communityAnalysis]);

  // 力导向按实际渲染规模调优：总览层只渲染话题大节点（137），
  // 若按全量 1000 算 charge 会太弱导致节点挤成一堆
  const forceTuning = useMemo(() => {
    const n = displayGraphData.nodes.length > 0 ? displayGraphData.nodes.length : graphData.nodes.length;
    const large = n > 300;
    const medium = n > 80;
    // 下钻2 成员层（drillTopicId!==null）：节点多且小，强斥力会把成员散到数千单位（fit 后缩成点）。
    // 改用弱斥力 + 短冷却，让成员聚拢、fit 后铺满画布。注：不能按"无 topic 节点"判断，
    // 因为下钻2 的 aggNodes 里含邻居 topic 节点，用 drillTopicId 判定成员视图最准。
    const isMemberView = drillTopicId !== null;
    return {
      warmupTicks: large ? 40 : medium ? 80 : 120,
      cooldownTicks: isMemberView ? 120 : large ? 120 : medium ? 200 : 300,
      velocityDecay: large ? 0.5 : medium ? 0.4 : 0.3,
      alphaDecay: large ? 0.045 : medium ? 0.03 : 0.022,
      // charge 与节点数负相关：节点越少斥力越强，摊开防堆叠；成员层用弱斥力防散大
      chargeStrength: isMemberView ? -30 : n > 300 ? -80 : n > 80 ? -160 : -280,
    };
  }, [displayGraphData.nodes, graphData.nodes.length, drillTopicId]);

  // 新布局（下钻/筛选/聚焦/时间/搜索）产生时允许自动 fit；用户拖拽（displayGraphData 不变）不置位，保持视图
  useEffect(() => {
    autoFitRef.current = true;
  }, [displayGraphData]);

  // 按规模设置斥力强度（d3-force charge）。
  // 关键：force-graph 在 graphData 引擎重建/重启时会把 charge 重置回默认弱值（forceManyBody ≈-30），
  // 只剩 link 力主导会把节点拉成"毛线团"（斥力失效）。因此每次渲染后 + 引擎停止时都确保强度。
  const ensureChargeStrength = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || typeof fg.d3Force !== 'function') return;
    const force = fg.d3Force('charge') as unknown as { strength?: (v: number) => unknown } | null;
    if (force && typeof force.strength === 'function') {
      force.strength(forceTuning.chargeStrength);
    }
  }, [forceTuning.chargeStrength]);
  useEffect(() => {
    ensureChargeStrength();
  });



  /** 组件级聚合模式标记（供领地/渲染闭包使用，与 displayGraphData 内部判定一致） */
  const useAggregation = communityAnalysis.superTopics.length > 0
    && !focusedNodeId
    && selectedNodeIds.length === 0
    && activeKind === 'all'
    && !searchQuery.trim()
    && timeRange === 'all';

  const selectedNodes = useMemo(() => {
    return selectedNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node));
  }, [nodeById, selectedNodeIds]);

  const focusedNode = focusedNodeId ? nodeById.get(focusedNodeId) : null;
  const hasFilteredView = Boolean(focusedNodeId || drillSuperId !== null || drillTopicId !== null || selectedNodeIds.length > 0 || searchQuery.trim() || activeKind !== 'all' || timeRange !== 'all');

  const activeKeywords = useMemo(() => {
    return graphData.nodes
      .filter((node) => categoryNodeIds.has(node.id))
      .slice()
      .sort((a, b) => (b.val || 0) - (a.val || 0))
      .slice(0, 4)
      .map((node) => node.name);
  }, [categoryNodeIds, graphData.nodes]);

  const addSelectedNode = useCallback((nodeId: string) => {
    autoFitRef.current = true;
    // 单节点中心选择：进入该节点所在连通分量
    setSelectedNodeIds([nodeId]);
    setFocusedNodeId(null);
    setActiveKind('all');
  }, []);

  const removeSelectedNode = useCallback((nodeId: string) => {
    setSelectedNodeIds((current) => current.filter((id) => id !== nodeId));
    setFocusedNodeId((current) => (current === nodeId ? null : current));
  }, []);

  const handleZoomIn = useCallback(() => {
    const fg = fgRef.current;
    if (fg) {
      fg.zoom(fg.zoom() * 1.2, 400);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const fg = fgRef.current;
    if (fg) {
      fg.zoom(fg.zoom() * 0.8, 400);
    }
  }, []);

  /** 计算画布内不被侧边面板/详情面板遮挡的可用视口（相对 graphArea 左上角）。
   *  侧边面板（w-52 左侧）与详情面板（桌面右侧 / 移动底部抽屉）以 absolute 覆盖在画布上，
   *  画布仍是全尺寸 —— 视口适配若按全画布计算，节点会被面板遮住（O6 缺陷2）。
   *  实时量取 DOM rect，跟随面板开合自动变化。 */
  const computeUsableViewport = useCallback(() => {
    const graphArea = graphAreaRef.current;
    if (!graphArea) return null;
    const graphRect = graphArea.getBoundingClientRect();
    const gw = graphRect.width;
    const gh = graphRect.height;
    const EDGE = 32; // 判定 overlay 贴边的容差（面板 left-4 = 16px 也算贴左）
    const GAP = 12; // 面板与可视区保留的安全间距
    let left = 0;
    let top = 0;
    let right = gw;
    let bottom = gh;
    const overlays = [sidePanelRef.current, detailPanelRef.current].filter((el): el is HTMLElement => Boolean(el));
    for (const el of overlays) {
      const r = el.getBoundingClientRect();
      const ol = r.left - graphRect.left;
      const ot = r.top - graphRect.top;
      const or_ = r.right - graphRect.left;
      const ob = r.bottom - graphRect.top;
      const cx = (ol + or_) / 2;
      const cy = (ot + ob) / 2;
      // 全高面板（桌面详情右侧抽屉）：只收缩水平边；
      // 全宽面板（移动端底部抽屉）：只收缩垂直边。
      const fullHeight = ot <= EDGE && ob >= gh - EDGE;
      const fullWidth = ol <= EDGE && or_ >= gw - EDGE;
      // 普通面板：先按水平位置收缩左/右；垂直收缩仅限水平居中的面板
      // （否则侧边面板（贴左、内容不足全高）会被误判贴顶，把可用区域顶部压掉）
      const onLeftEdge = ol <= EDGE && cx < gw / 2;
      const onRightEdge = or_ >= gw - EDGE && cx >= gw / 2;
      if (fullHeight) {
        if (onLeftEdge) left = Math.max(left, Math.min(or_, right) + GAP);
        if (onRightEdge) right = Math.min(right, Math.max(ol, left) - GAP);
      } else if (fullWidth) {
        if (ob >= gh - EDGE && cy >= gh / 2) bottom = Math.min(bottom, Math.max(ot, top) - GAP);
        if (ot <= EDGE && cy < gh / 2) top = Math.max(top, Math.min(ob, bottom) + GAP);
      } else {
        if (onLeftEdge) left = Math.max(left, Math.min(or_, right) + GAP);
        if (onRightEdge) right = Math.min(right, Math.max(ol, left) - GAP);
        if (!onLeftEdge && !onRightEdge) {
          if (ob >= gh - EDGE && cy >= gh / 2) bottom = Math.min(bottom, Math.max(ot, top) - GAP);
          if (ot <= EDGE && cy < gh / 2) top = Math.max(top, Math.min(ob, bottom) + GAP);
        }
      }
    }
    const uw = Math.max(140, right - left);
    const uh = Math.max(100, bottom - top);
    return { left, top, gw, gh, uw, uh };
  }, []);

  /** 适配全图到可用视口（避开侧边/详情面板遮挡）。供适应视图/重置/总览校准共用。
   *  注意：不读 screen2GraphCoords —— 它在 d3 zoom 过渡期间与 graph2ScreenCoords
   *  读到不同步的变换（实测 y 偏移 162px），改用纯数学：centerAt(p) 使图坐标 p 居中，
   *  令 p = (画布中心 - 目标屏幕中心)/k + 图中心 即可把图中心放到可用区域中心。 */
  const fitAllNodes = useCallback(() => {
    const fg = fgRef.current;
    const vp = computeUsableViewport();
    if (!fg || !vp) return;
    // 下钻2 时只适配"本话题成员"（非 topic）的 bbox，排除弱化的邻居话题节点，让成员铺满画布
    const memberFilter = drillTopicId !== null ? (node: GraphNode) => !node.isTopic : undefined;
    const allBbox = fg.getGraphBbox(memberFilter as never);
    if (!allBbox || allBbox.x[0] === undefined) return;
    const { left, top, gw, gh, uw, uh } = vp;
    const spanX = Math.max(48, allBbox.x[1] - allBbox.x[0]);
    const spanY = Math.max(48, allBbox.y[1] - allBbox.y[0]);
    const padding = Math.min(64, Math.max(28, Math.min(uw, uh) * 0.1));
    // zoomToFit 同款 clamp：极小图放大到 2.5 上限，极大图缩到 0.05
    let fitScale = Math.min((uw - padding * 2) / spanX, (uh - padding * 2) / spanY);
    fitScale = Math.max(0.02, Math.min(2.5, fitScale));
    if (displayGraphData.nodes.length <= 2) fitScale = Math.min(fitScale, 1.8);
    const cx = (allBbox.x[0] + allBbox.x[1]) / 2;
    const cy = (allBbox.y[0] + allBbox.y[1]) / 2;
    const ux = left + uw / 2;
    const uy = top + uh / 2;
    fg.zoom(fitScale, 0);
    fg.centerAt((gw / 2 - ux) / fitScale + cx, (gh / 2 - uy) / fitScale + cy, 0);
  }, [computeUsableViewport, displayGraphData.nodes.length]);

  const handleFitView = useCallback(() => {
    fitAllNodes();
  }, [fitAllNodes]);

  const resetGraphView = useCallback(() => {
    autoFitRef.current = true;
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setSearchQuery('');
    setActiveKind('all');
    setTimeRange('all');
    setDrillTopicId(null);
    setDrillSuperId(null);
    window.setTimeout(() => {
      fitAllNodes();
    }, 50);
  }, [fitAllNodes]);

  /** 下钻1：进入大话题 → 该大话题下的中话题层 */
  const drillIntoSuper = useCallback((superId: number) => {
    autoFitRef.current = true;
    setDrillSuperId(superId);
    setDrillTopicId(null);
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setDetailNodeId(null);
  }, []);

  /** 下钻2：进入中话题局部视图（成员 + 邻居） */
  const drillIntoTopic = useCallback((communityId: number) => {
    autoFitRef.current = true;
    setDrillTopicId(communityId);
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setDetailNodeId(null);
  }, []);

  /** 返回：逐级上溯（中话题 → 大话题 → 总览） */
  const drillBack = useCallback(() => {
    autoFitRef.current = true;
    if (drillTopicId !== null) {
      setDrillTopicId(null);
    } else {
      setDrillSuperId(null);
    }
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    window.setTimeout(() => {
      fitAllNodes();
    }, 50);
  }, [drillTopicId, fitAllNodes]);

  const handleCategorySelect = useCallback((kind: string) => {
    autoFitRef.current = true;
    setActiveKind(kind);
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setDrillTopicId(null);
    setDrillSuperId(null);
    setDetailNodeId(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    autoFitRef.current = true;
    setFocusedNodeId(nodeId);
    setSelectedNodeIds([]);
    setActiveKind('all');
  }, []);
  const openNodeDetail = useCallback((nodeId: string) => {
    setDetailNodeId(nodeId);
    focusNode(nodeId);
  }, [focusNode]);

  /** 生成当前话题的"状况"数据（下钻层的概览/趋势/建议），并打开话题状况抽屉 */
  const loadTopicInsight = useCallback(async () => {
    // 确定当前话题：下钻2（中话题）优先，其次下钻1（大话题）
    let topicName = '';
    let topicColor = '#94A3B8';
    const memberIds: string[] = [];
    if (drillTopicId !== null) {
      const t = communityAnalysis.topics.find((x) => x.communityId === drillTopicId);
      topicName = topicDisplayName(drillTopicId, t?.name || '');
      topicColor = t?.color || topicColor;
      memberIds.push(...(t?.memberIds || []));
    } else if (drillSuperId !== null) {
      const s = communityAnalysis.superTopics.find((x) => x.id === drillSuperId);
      topicName = superDisplayName(drillSuperId, s?.name || '');
      topicColor = s?.color || topicColor;
      if (s) for (const subId of s.subTopicIds) {
        const sub = communityAnalysis.topics.find((t) => t.communityId === subId);
        if (sub) memberIds.push(...sub.memberIds);
      }
    } else {
      return; // 总览层无话题状况
    }

    // 代表性内容：成员节点名（标题）+ 别名（摘要）
    const representatives = memberIds.slice(0, 6).map((mid) => {
      const n = nodeById.get(mid);
      return { id: mid, title: n?.name || '节点', summary: n?.aliases?.slice(0, 2).join('、') || '' };
    });

    // 关联主题（邻居话题名）
    const related = new Set<string>();
    for (const mid of memberIds) {
      const sc = communityAnalysis.nodeToTopic.get(mid);
      if (sc !== undefined && sc !== drillTopicId) {
        const t = communityAnalysis.topics.find((x) => x.communityId === sc);
        if (t && t.name) related.add(topicDisplayName(sc, t.name));
      }
      const ss = communityAnalysis.nodeToSuper.get(mid);
      if (ss !== undefined && ss !== drillSuperId) {
        const s = communityAnalysis.superTopics.find((x) => x.id === ss);
        if (s && s.name) related.add(superDisplayName(ss, s.name));
      }
    }

    // 本周新增（按节点 created_at）
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    let newThisWeek = 0;
    for (const mid of memberIds) {
      const n = nodeById.get(mid);
      if (n?.created_at && new Date(n.created_at).getTime() >= weekAgo) newThisWeek++;
    }

    let trends: TopicInsightData['trends'] = [
      { label: topicName, direction: newThisWeek > 0 ? 'up' : 'stable', detail: newThisWeek > 0 ? `本周新增 ${newThisWeek} 条` : '近期没有新增内容' },
    ];
    let suggestions: string[] = memberIds.length >= 10
      ? [
          `你在这个主题记录了 ${memberIds.length} 条内容，建议回顾并整理成自己的体系`,
          ...(related.size ? [`与「${[...related][0]}」关联较强，可尝试串起来思考`] : []),
        ]
      : ['内容还比较少，建议多记录一些想法，图谱会更有价值'];

    // 接真实 summarize 洞察：匹配当前话题的趋势/建议；失败/不匹配则用上面的结构化兜底
    try {
      const sum = await fetchSummary({ period: '7d' });
      if (sum && sum.ok) {
        // 优先 themeTrends（含 name/recent/older），其次 trends（label）
        const matchedTheme = (sum.themeTrends || []).find(
          (t) => t && t.name && (t.name.includes(topicName) || topicName.includes(t.name))
        );
        const matchedTrend = matchedTheme
          || (sum.trends || []).find((t) => t && t.label && (t.label.includes(topicName) || topicName.includes(t.label)));
        if (matchedTrend) {
          const hasName = 'name' in matchedTrend;
          const label = hasName ? (matchedTrend as { name: string }).name : (matchedTrend as { label: string }).label;
          trends = [{
            label: label || topicName,
            direction: (matchedTrend.direction as 'up' | 'down' | 'stable') || 'stable',
            detail: matchedTrend.detail || '',
          }];
        }
        if (sum.nextActions && sum.nextActions.length > 0) {
          const topicActions = sum.nextActions.filter((a: string) => a.includes(topicName));
          suggestions = (topicActions.length ? topicActions : sum.nextActions).slice(0, 2);
        }
      }
    } catch {
      // summarize 失败：保留结构化兜底
    }

    setTopicInsight({
      topicName,
      topicColor,
      memberCount: memberIds.length,
      capturedCount: memberIds.length,
      newThisWeek,
      relatedTopics: [...related],
      representativeItems: representatives,
      trends,
      suggestions,
    });
    setTopicInsightOpen(true);
  }, [drillTopicId, drillSuperId, communityAnalysis, nodeById, topicDisplayName, superDisplayName]);

  useEffect(() => {
    if (!initialNodeId || loading) return;
    if (!graphData.nodes.some((node) => node.id === initialNodeId)) return;
    setDetailNodeId(null);
    focusNode(initialNodeId);
  }, [focusNode, graphData.nodes, initialNodeId, loading]);
  /** 已归一化的视图标识：同一布局只归一化一次（引擎停止时），拖拽/手动缩放不被重复重置 */
  const normalizedViewRef = useRef<string>('');
  // displayGraphData 重新计算（下钻/返回/过滤等视图切换）→ 新的力导向布局，
  // 需要重新归一化；拖拽只重热同一布局，不触发重置（guard 保持，避免重置用户拖拽）
  useEffect(() => {
    normalizedViewRef.current = '';
  }, [displayGraphData]);
  const normalizeAggregateLayout = useCallback(() => {
    const fg = fgRef.current;
    const graphArea = graphAreaRef.current;
    if (!fg || !graphArea) return;
    const nodes = displayGraphData.nodes;
    if (nodes.length < 2 || !nodes.some((n) => n.isTopic)) return;
    const key = `${drillSuperId}|${drillTopicId}|${nodes.length}|${displayGraphData.links.length}`;
    if (normalizedViewRef.current === key) return;
    const bbox = fg.getGraphBbox();
    if (!bbox || bbox.x[0] === undefined) return;
    // 关键（2026-08-18）：**不再把布局缩放压缩到画布尺度**。
    // 原逻辑 s = min((gw-2p)/spanX,…) 会对大数据把稀疏的力导向布局硬压成画布尺度的"毛线球"
    // （实测用户 4000² 一下跳到 400²）。fitAllNodes 已经在用视图 zoom 适配全貌，
    // graph 坐标应保持力导向自然尺度：放大=纯视图散开。此处 s=1 仅做质心居中。
    // 注：下钻2 成员层的散大问题已由 displayGraphData 生成时为成员节点预设小尺度聚类坐标解决。
    let s = 1;
    const cx = (bbox.x[0] + bbox.x[1]) / 2;
    const cy = (bbox.y[0] + bbox.y[1]) / 2;
    for (const n of nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
      n.x = (n.x - cx) * s;
      n.y = (n.y - cy) * s;
    }
    // 碰撞松弛：归一化后（canvas 尺度）把重叠节点推开，半径 = nodeRenderRadius 同单位。
    // 力导向只能保证 graph 尺度间距，缩放会破坏间距/半径比，必须在目标尺度下重解。
    const positioned = nodes.filter((n) => typeof n.x === 'number' && typeof n.y === 'number');
    for (let iter = 0; iter < 80; iter++) {
      let moved = 0;
      for (let i = 0; i < positioned.length; i++) {
        for (let j = i + 1; j < positioned.length; j++) {
          const a = positioned[i];
          const b = positioned[j];
          const dx = (b.x as number) - (a.x as number);
          const dy = (b.y as number) - (a.y as number);
          const dist2 = dx * dx + dy * dy;
          const minDist = (nodeRenderRadius(a) + nodeRenderRadius(b)) * 1.08;
          if (dist2 < minDist * minDist && dist2 > 1e-6) {
            const dist = Math.sqrt(dist2);
            const overlap = (minDist - dist) / dist;
            (a.x as number) -= dx * overlap * 0.5;
            (a.y as number) -= dy * overlap * 0.5;
            (b.x as number) += dx * overlap * 0.5;
            (b.y as number) += dy * overlap * 0.5;
            moved += 1;
          }
        }
      }
      if (moved === 0) break;
    }
    // 松弛后重新居中（质心归零），避免整体漂移出画布
    let sumX = 0, sumY = 0;
    for (const n of positioned) {
      sumX += n.x as number;
      sumY += n.y as number;
    }
    const meanX = sumX / positioned.length;
    const meanY = sumY / positioned.length;
    for (const n of positioned) {
      (n.x as number) -= meanX;
      (n.y as number) -= meanY;
    }
    normalizedViewRef.current = key;
  }, [displayGraphData.links.length, displayGraphData.nodes, drillSuperId, drillTopicId]);

  const positionGraphViewport = useCallback(() => {
    const fg = fgRef.current;
    const graphArea = graphAreaRef.current;
    const vp = computeUsableViewport();
    if (!fg || !graphArea || !vp || displayGraphData.nodes.length === 0 || dimensions.width <= 0 || dimensions.height <= 0) return false;

    const { left, top, gw, gh, uw, uh } = vp;
    // 目标屏幕点：可用区域中心（夹取到可用区域，防极端布局偏移）
    const targetScreenX = Math.min(left + uw, Math.max(left, gw / 2));
    const targetScreenY = Math.min(top + uh, Math.max(top, gh / 2));
    const centerNodeId = focusedNodeId || selectedNodeIds[0] || null;

    if (!centerNodeId) {
      fitAllNodes();
      return true;
    }

    // Build neighborhood: focused node + directly connected nodes
    const neighborIds = new Set<string>();
    neighborIds.add(centerNodeId);
    displayGraphData.links.forEach((link) => {
      const src = linkEndpointId(link.source);
      const tgt = linkEndpointId(link.target);
      if (src === centerNodeId) neighborIds.add(tgt);
      if (tgt === centerNodeId) neighborIds.add(src);
    });

    // Use fg.getGraphBbox() to get node positions
    const nodeBbox = fg.getGraphBbox((node) => node.id === centerNodeId);
    if (!nodeBbox || nodeBbox.x[0] === undefined) return false;
    const nodeX = (nodeBbox.x[0] + nodeBbox.x[1]) / 2;
    const nodeY = (nodeBbox.y[0] + nodeBbox.y[1]) / 2;

    // Use neighborhood bbox for zoom; fall back to all-nodes bbox if neighborhood is a single node
    const localBbox = fg.getGraphBbox((node) => neighborIds.has(node.id));
    const hasNeighborhood = neighborIds.size > 1 && localBbox && (localBbox.x[1] - localBbox.x[0]) > 10;
    const useBbox = hasNeighborhood ? localBbox : fg.getGraphBbox();

    const spanX = Math.max(48, useBbox.x[1] - useBbox.x[0]);
    const spanY = Math.max(48, useBbox.y[1] - useBbox.y[0]);
    const padding = Math.min(72, Math.max(36, uw * 0.12));
    const fitScale = Math.min((uw - padding * 2) / spanX, (uh - padding * 2) / spanY);
    // 非线性缩放（PENDING 缺陷1）：log2 压缩宽范围，
    // 小簇不再被 cap 卡在 4.0（太小），大邻域不再被 floor 卡在 1.0（太小）
    // 详情面板打开（画布被其覆盖）时：线性 fit 到保底可用区，允许 <1.0，
    // 聚焦节点完整可见在面板之外（PENDING 缺陷2）；平时保持 log2 曲线
    const targetScale = detailPanelRef.current
      ? Math.max(0.1, Math.min(4.0, fitScale))
      : Math.max(1.0, Math.min(4.0, Math.log2(fitScale + 1) * 0.85 + 1.0));

    fg.zoom(targetScale, 0);
    // 同 fitAllNodes：不读 screen2GraphCoords（过渡期不同步），
    // 用纯数学把节点 (nodeX, nodeY) 放到可用区域中心 (targetScreenX, targetScreenY)
    fg.centerAt(
      (gw / 2 - targetScreenX) / targetScale + nodeX,
      (gh / 2 - targetScreenY) / targetScale + nodeY,
      0
    );

    return true;
  }, [computeUsableViewport, dimensions.height, dimensions.width, displayGraphData.nodes, displayGraphData.links, fitAllNodes, focusedNodeId, selectedNodeIds]);

  /** 引擎停止：聚合视图先归一化布局，再校准视口（总览/下钻立即可读） */
  const handleEngineStop = useCallback(() => {
    // 引擎停止前确保斥力强度（force-graph 重置引擎可能把 charge 掉回默认弱值 → 节点被 link 拉成团）
    ensureChargeStrength();
    normalizeAggregateLayout();
    // 总览布局不再压缩/冻结（normalize 已只居中，放大纯视图；fx/fy 冻结会让节点拖不动）。
    // 适配仅在首次/下钻/筛选时（autoFitRef）执行；用户拖拽后 stop 保持视图，不强制 fit 缩小。
    if (autoFitRef.current) positionGraphViewport();
  }, [autoFitRef, ensureChargeStrength, normalizeAggregateLayout, positionGraphViewport]);
  useEffect(() => {
    // 详情面板开合时有 AnimatePresence 退出动画（220ms），面板 ref 在动画结束才卸载；
    // 帧数需覆盖动画时长，否则关闭面板后的重适配在读到的仍是旧面板 rect
    let framesRemaining = nodeDetail ? 60 : focusedNodeId || selectedNodeIds.length > 0 ? 45 : 8;
    const calibrate = () => {
      positionGraphViewport();
      framesRemaining -= 1;
      if (framesRemaining > 0) viewportFrameRef.current = window.requestAnimationFrame(calibrate);
    };
    viewportFrameRef.current = window.requestAnimationFrame(calibrate);
    return () => {
      if (viewportFrameRef.current !== null) window.cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = null;
    };
  }, [focusedNodeId, nodeDetail, positionGraphViewport, selectedNodeIds.length, sidePanelCollapsed]);

  const fetchAllPaged = async <T extends Record<string, unknown>>(fetchPage: (from: number, to: number) => PostgrestFilterBuilder<any, any, T, any, any, any>): Promise<T[]> => {
    const all: T[] = [];
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await fetchPage(from, from + PAGE - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return all;
  };

  const fetchGraphData = async () => {
    setLoading(true);
    try {
      // 列裁剪(不含 embedding 向量列): select('*') 会把 1536 维向量序列化成巨大 JSON,
      // 慢网络下 30 节点即达数百 KB, 是图谱加载慢的主因; graph.ts 等其他调用均已只选具体列
      const [nodes, links] = await Promise.all([
        fetchAllPaged<KnowledgeNodeRow>((from, to) => supabase.from('knowledge_nodes').select('id,name,val,color,kind,aliases,source_captured_ids,metadata,created_at').range(from, to)),
        fetchAllPaged<KnowledgeLinkRow>((from, to) => supabase.from('knowledge_links').select('id,source,target,relation_type,evidence_captured_ids,confidence,created_at').range(from, to)),
      ]);

      if (nodes.length === 0) {
        const demoNodes = [
          { id: '1', name: '产品设计', val: 20, color: NODE_KIND_META.concept.color, kind: 'concept', aliases: [] },
          { id: '2', name: '极简主义', val: 15, color: NODE_KIND_META.view.color, kind: 'view', aliases: [] },
          { id: '3', name: 'UI规范', val: 15, color: NODE_KIND_META.object.color, kind: 'object', aliases: [] }
        ];
        setGraphData({
          nodes: demoNodes,
          links: [
            { source: '1', target: '2' },
            { source: '1', target: '3' }
          ]
        });
      } else {
        setGraphData({
          nodes: nodes.map((node) => {
            const kind = node.kind || 'concept';
            return {
              id: node.id,
              name: node.name,
              val: node.val || 10,
              color: NODE_KIND_META[kind]?.color || node.color || NODE_KIND_META.unknown.color,
              kind,
              aliases: node.aliases || [],
              source_captured_ids: node.source_captured_ids || [],
              metadata: node.metadata || {},
              created_at: node.created_at || null,
            };
          }),
          links: links.map((link) => ({
            id: link.id ?? undefined,
            source: link.source,
            target: link.target,
            relation_type: link.relation_type,
            evidence_captured_ids: link.evidence_captured_ids || [],
            confidence: link.confidence,
            created_at: link.created_at || null,
          }))
        });
      }
    } catch (error) {
      console.error('获取知识图谱数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-white">
      <div className="flex-none px-4 py-3 border-b border-gray-200">
        {setupStatus && (!setupStatus.schemaOk || !setupStatus.llmOk) ? (
          <div className="mb-3 px-3 py-2 bg-danger-soft border border-red-200 text-xs text-danger rounded-lg">
            {!setupStatus.schemaOk ? (
              setupStatus.schemaError?.toLowerCase().includes('invalid api key') ? (
                <div>Supabase 连接配置错误：请检查 VITE_SUPABASE_PROJECT_ID / VITE_SUPABASE_ANON_KEY 并重新部署</div>
              ) : (
                <div>数据库未应用图谱迁移：请先在 Supabase 执行 20240401000006_extend_knowledge_graph.sql</div>
              )
            ) : null}
            {setupStatus.schemaOk && !setupStatus.llmOk ? <div>LLM 未配置：请在 Vercel 或本地服务端环境配置 MINIMAX_API_KEY</div> : null}
          </div>
        ) : null}

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索知识节点名称、别名或类型..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-10 py-2 bg-gray-50 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent rounded-xl"
          />
          {searching ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand animate-spin" /> : <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand" />}
        </div>

        {searchQuery.trim() ? (
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                {visibleSearchMatches.length > 0
                  ? `找到 ${visibleSearchMatches.length} 个可选节点${searchResults.length > 0 ? '（语义搜索）' : '（本地匹配）'}`
                  : '暂无匹配节点'}
              </span>
              {searchError ? <span className="text-orange-600">语义搜索不可用，已使用本地搜索</span> : null}
            </div>
            {visibleSearchMatches.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {visibleSearchMatches.map((result) => {
                  const id = result.id;
                  const name = result.name;
                  const isSelected = selectedNodeIds.includes(id);
                  const similarity = 'similarity' in result ? result.similarity : null;
                  const matchedReason = 'matchedReason' in result && typeof result.matchedReason === 'string' ? result.matchedReason : null;
                  return (
                    <div key={id} className="flex-none flex items-center gap-1 px-2.5 py-1.5 bg-white text-xs border border-gray-200 shadow-sm rounded-lg">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <button onClick={() => { setDetailNodeId(null); focusNode(id); }} className="truncate text-left text-gray-700 hover:text-blue-600 transition-colors" title={matchedReason || name}>
                          {name}{similarity !== null ? ` · ${Math.round(similarity * 100)}%` : null}
                        </button>
                        {matchedReason ? (
                          <span className="text-[10px] text-gray-400 truncate max-w-[200px]">{matchedReason}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-0.5 ml-1">
                        <button
                          onClick={() => focusNode(id)}
                          className="text-gray-400 hover:text-amber-600 transition-colors p-0.5"
                          title="在图谱中聚焦"
                          aria-label="在图谱中聚焦"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => (isSelected ? removeSelectedNode(id) : addSelectedNode(id))}
                          className={isSelected ? 'text-red-500 hover:text-red-600 p-0.5' : 'text-blue-500 hover:text-blue-600 p-0.5'}
                          aria-label={isSelected ? '移除节点' : '添加节点'}
                        >
                          {isSelected ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {focusedNode ? (
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-gray-500">当前子图</span>
            <span className="px-2 py-1 bg-warning-soft border border-amber-200 text-amber-700 rounded-lg">{focusedNode.name}</span>
            <button onClick={resetGraphView} className="text-blue-600 hover:text-blue-700">返回全部</button>
          </div>
        ) : null}

        {selectedNodes.length > 0 ? (
          <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
            <span className="flex-none text-xs text-gray-500">已选节点</span>
            {selectedNodes.map((node) => (
              <div key={node.id} className="flex-none flex items-center gap-1 px-2 py-1 bg-brand-soft border border-brand-200 text-xs text-brand-strong max-w-none rounded-lg">
                <button onClick={() => focusNode(node.id)} className="hover:text-blue-900 whitespace-nowrap">{node.name}</button>
                <button onClick={() => removeSelectedNode(node.id)} aria-label="移除已选节点">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button onClick={resetGraphView} className="flex-none text-xs text-gray-500 hover:text-gray-700">返回全部</button>
          </div>
        ) : null}

        {hasFilteredView && !focusedNode && selectedNodes.length === 0 ? (
          <div className="mb-3">
            <button onClick={resetGraphView} className="text-xs text-blue-600 hover:text-blue-700">返回全部节点</button>
          </div>
        ) : null}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {activeKeywords.map((keyword, idx) => (
            <button
              key={idx}
              onClick={() => setSearchQuery(keyword)}
              className="flex-none px-3 py-1 bg-brand-soft text-brand-strong text-xs border border-brand-200 hover:bg-brand-soft/70 transition-colors rounded-full"
            >
              {keyword}
            </button>
          ))}
        </div>

        {/* 时间范围选择器 */}
        <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
          <span className="text-[11px] text-gray-400 flex-none">时间</span>
          {(['all', '7d', '30d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => {
                setTimeRange(range);
                setFocusedNodeId(null);
              }}
              className={`px-2 py-0.5 text-[11px] transition-colors rounded-lg ${
                timeRange === range
                  ? 'bg-brand-soft text-brand-strong border border-brand-200'
                  : 'text-gray-500 hover:text-gray-700 border border-transparent'
              }`}
            >
              {range === 'all' ? '全部' : range}
            </button>
          ))}
          {timeRange !== 'all' && displayGraphData.newNodeIds && displayGraphData.nodes.length < graphData.nodes.length ? (
            <span className="text-[10px] text-ai ml-auto">
              新增 {displayGraphData.newNodeIds.size} 节点
            </span>
          ) : null}
        </div>
      </div>

      <div ref={graphAreaRef} className="flex-1 min-h-0 relative overflow-hidden bg-slate-50 touch-none">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gray-50/80">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <p className="text-sm text-gray-500">加载知识网络...</p>
          </div>
        ) : null}


        {(drillSuperId !== null || drillTopicId !== null) ? (
          <div className="absolute top-3 right-4 z-10 flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-white/95 backdrop-blur border border-gray-200 px-3 py-1.5 shadow-card rounded-2xl max-w-[calc(100%-2rem)]">            <button onClick={drillBack} className="text-[11px] text-gray-500 hover:text-indigo-600 font-medium whitespace-nowrap">
              {drillTopicId !== null ? '中话题' : '总览'}
            </button>
            {drillSuperId !== null ? (
              <>
                <span className="text-gray-300 whitespace-nowrap">›</span>
                <span className="w-2 h-2 flex-none shrink-0" style={{ borderRadius: '50%', backgroundColor: communityAnalysis.superTopics.find((s) => s.id === drillSuperId)?.color || '#94A3B8' }}></span>
                <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">{superDisplayName(drillSuperId, communityAnalysis.superTopics.find((s) => s.id === drillSuperId)?.name || '')}</span>
              </>
            ) : null}
            {drillTopicId !== null ? (
              <>
                <span className="text-gray-300 whitespace-nowrap">›</span>
                <span className="w-2 h-2 flex-none shrink-0" style={{ borderRadius: '50%', backgroundColor: communityAnalysis.topics.find((t) => t.communityId === drillTopicId)?.color || '#94A3B8' }}></span>
                <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">{topicDisplayName(drillTopicId, communityAnalysis.topics.find((t) => t.communityId === drillTopicId)?.name || '')}</span>
              </>
            ) : null}
            <span className="text-[10px] text-gray-400 whitespace-nowrap">点击节点查看详情</span>
          </div>
        ) : null}

        <ForceGraph2D
          ref={fgRef}
          graphData={displayGraphData as unknown as { nodes: GraphNode[]; links: GraphLink[] }}
          width={dimensions.width}
          height={dimensions.height}

          nodeCanvasObject={(node, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const isMatched = matchedIds.has(node.id);
            if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
            const isSelected = selectedNodeIds.includes(node.id);
            const isFocused = focusedNodeId === node.id;
            const isCenter = isFocused || isSelected;
            const isNew = displayGraphData.newNodeIds?.has(node.id) ?? false;
            const isTopic = node.isTopic === true;
            const isDimmed = node.isDimmed === true;
            const isCrossTopic = node.isCrossTopic === true;
            // 话题大节点：较大六边形 + 社区色 + 成员数徽标；成员节点：社区色小六边形
            // 跨话题节点（isCrossTopic）：保留主题色但半透明（比 isDimmed 灰色更可读），小一点
            const nodeColor = isMatched
              ? '#7C3AED'
              : isCrossTopic
                ? 'rgba(148, 163, 184, 0.4)'
                : isDimmed
                  ? 'rgba(148, 163, 184, 0.55)'
                  : isTopic
                    ? node.color
                    : node.color;
            // 话题大节点：半径按成员数对数缩放（nodeRenderRadius，10-24px）
            const baseRadius = nodeRenderRadius(node);
            const radius = baseRadius * (isCenter ? 1.15 : isMatched ? 1.1 : 1) * (isCrossTopic ? 0.88 : isDimmed ? 0.75 : 1);

            // 新增节点外圈紫色光环（仅成员节点）
            if (isNew && timeRange !== 'all' && !isCenter && !isMatched && !isTopic) {
              ctx.shadowColor = 'rgba(168, 85, 247, 0.35)';
              ctx.shadowBlur = 10 / globalScale;
              hexagonPath(ctx, node.x, node.y, radius + 2 / globalScale);
              ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
              ctx.lineWidth = 1.5 / globalScale;
              ctx.stroke();
              ctx.shadowBlur = 0;
            }

            ctx.shadowColor = isCenter ? 'rgba(37, 99, 235, 0.4)' : isTopic ? 'rgba(15, 23, 42, 0.2)' : 'rgba(15, 23, 42, 0.15)';
            ctx.shadowBlur = (isCenter ? 12 : isTopic ? 9 : 6) / globalScale;
            hexagonPath(ctx, node.x, node.y, radius);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.lineWidth = (isCenter ? 2.5 : isTopic ? 2 : isNew ? 1.8 : 1.2) / globalScale;
            ctx.strokeStyle = isFocused ? '#FBBF24' : isSelected ? '#2563EB' : isNew && timeRange !== 'all' ? '#A855F7' : 'rgba(255, 255, 255, 0.95)';
            hexagonPath(ctx, node.x, node.y, radius);
            ctx.stroke();

            // 话题大节点：名称画在节点内（白字，按宽度截断），成员数放右上角小徽标。
            // 文字都在节点上，不再有节点下方散乱标签（用户反馈"字没在节点上很乱"）
            if (isTopic) {
              const topicInfo = node.communityId !== undefined ? communityAnalysis.topics.find((t) => t.communityId === node.communityId) : undefined;
              const memberCount = node.memberCount ?? (topicInfo ? topicInfo.memberIds.length : (node.val || 0));
              if (!isDimmed) {
                // 节点内：名称（白描边保证可读）。完整名优先，字号自适应调小；
                // 只有字号过小（不可读）才按六边形宽度截断。
                const innerWidth = radius * 1.55;
                // 模型命名优先（与左侧话题栏同步）：canvas 绘制时读实时 topicNameMap（displayGraphData 不随命名重算）
                const topicName = node.communityId !== undefined ? (node.isSuperTopic ? superNameMap[node.communityId] : topicNameMap[node.communityId]) : undefined;
                const fullName = topicName || node.name;
                let label = fullName;
                let nameFont = Math.min(radius * 0.62, innerWidth / Math.max(label.length, 1));
                if (nameFont < radius * 0.36) {
                  const maxChars = Math.max(2, Math.floor(innerWidth / (radius * 0.44)));
                  label = truncateLabel(fullName, maxChars);
                  nameFont = Math.min(radius * 0.62, innerWidth / Math.max(label.length, 1));
                }
                if (nameFont * globalScale >= 5.5) {
                  ctx.font = `600 ${nameFont}px Inter, sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.lineWidth = 2.5 / globalScale;
                  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
                  ctx.strokeText(label, node.x, node.y);
                  ctx.fillStyle = '#ffffff';
                  ctx.fillText(label, node.x, node.y);
                }
                // 右上角成员数徽标（小圆 + 数字；"其他知识"桶不显示）
                const badgeR = Math.max(4.2, Math.min(6.5, radius * 0.3));
                const badgeX = node.x + radius * 0.72;
                const badgeY = node.y - radius * 0.72;
                ctx.beginPath();
                ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
                ctx.fill();
                ctx.lineWidth = 1.2 / globalScale;
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';
                ctx.stroke();
                const badgeFont = Math.max(5.5 / globalScale, badgeR * 1.1);
                ctx.font = `700 ${badgeFont}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#334155';
                ctx.fillText(String(memberCount), badgeX, badgeY);
              }
            } else {
              // 成员节点：六边形内动态文字。完整名优先，字号自适应；过小才截断
              const fullName = node.name;
              let label = fullName;
              let fontSize = Math.min(radius * 0.6, radius * 1.6 / Math.max(label.length, 1));
              if (fontSize < radius * 0.32) {
                const maxChars = isCenter || isMatched
                  ? Math.max(4, Math.round(radius * 0.8))
                  : Math.max(2, Math.round(radius * 0.5));
                label = truncateLabel(fullName, maxChars);
                fontSize = Math.min(radius * 0.6, radius * 1.6 / Math.max(label.length, 1));
              }
              if (fontSize * globalScale >= 5 || isCenter) {
                ctx.font = `600 ${fontSize}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(label, node.x, node.y);
              }
            }

            const result = searchResultMap.get(node.id);
            if (result && !isTopic) {
              ctx.fillStyle = '#6B7280';
              ctx.font = `${9 / globalScale}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${Math.round(result.similarity * 100)}%`, node.x, node.y + radius + 8 / globalScale);
            }
          }}
          nodePointerAreaPaint={(node, color: string, ctx: CanvasRenderingContext2D) => {
            const isTopic = node.isTopic === true;
            const baseRadius = isTopic
              ? Math.max(14, Math.min(30, 8 + Math.sqrt(node.val || 10) * 2.2))
              : Math.max(5, Math.min(10, 4 + Math.sqrt(node.val || 6) * 1.5));
            if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
            ctx.fillStyle = color;
            hexagonPath(ctx, node.x, node.y, Math.max(9, baseRadius * 1.4));
            ctx.fill();
          }}
          linkColor={(link: GraphLink) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            const isHighlight = matchedIds.has(source) || matchedIds.has(target) || selectedNodeIds.includes(source) || selectedNodeIds.includes(target) || source === focusedNodeId || target === focusedNodeId || source === detailNodeId || target === detailNodeId;
            // 高亮：聚焦/选中相关边用蓝色清晰显示
            if (isHighlight) return 'rgba(37, 99, 235, 0.7)';
            // 下钻2 时，连到"邻居话题节点"（topic: 端点）的跨话题边略淡（但清晰可读），突出本话题内部连线
            const isCrossTopicLink = drillTopicId !== null && (source.startsWith('topic:') || target.startsWith('topic:'));
            if (isCrossTopicLink) return 'rgba(148, 163, 184, 0.42)';
            // 其他知识桶（杂散节点汇聚）：边更淡，降低视觉噪声
            const isOther = source.includes('topic:-1') || target.includes('topic:-1');
            if (isOther) return 'rgba(148, 163, 184, 0.15)';
            // 非高亮：按关系类型语义着色，统一适中的饱和度透明度（清晰可见但不抢眼）
            const rel = (link.relation_type || 'related_to') as string;
            const relColor: Record<string, string> = {
              causes: 'rgba(239, 68, 68, 0.55)',
              leads_to: 'rgba(239, 68, 68, 0.55)',
              part_of: 'rgba(59, 130, 246, 0.5)',
              supports: 'rgba(16, 185, 129, 0.5)',
              contradicts: 'rgba(249, 115, 22, 0.52)',
              depends_on: 'rgba(139, 92, 246, 0.5)',
              related_to: 'rgba(148, 163, 184, 0.45)',
            };
            return relColor[rel] || 'rgba(148, 163, 184, 0.45)';
          }}
          onEngineStop={handleEngineStop}
          onLinkHover={(link: GraphLink | null) => setHoveredLink(link)}
          linkWidth={(link: GraphLink & { count?: number }) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            const isHighlight = matchedIds.has(source) || matchedIds.has(target) || selectedNodeIds.includes(source) || selectedNodeIds.includes(target) || source === focusedNodeId || target === focusedNodeId || source === detailNodeId || target === detailNodeId;
            // 聚合话题边：宽度随跨话题链接数加权
            if (link.count && link.count > 1) return Math.min(3.6, 1 + link.count * 0.4);
            return isHighlight ? 2.4 : 1.4;
          }}
          linkDirectionalParticles={(link: GraphLink) => {
            // 因果类关系加流动粒子，表达方向感；仅高亮时显示避免噪点
            const rel = link.relation_type || '';
            if ((rel === 'causes' || rel === 'leads_to') && (linkEndpointId(link.source) === focusedNodeId || linkEndpointId(link.target) === focusedNodeId)) {
              return 2;
            }
            return 0;
          }}
          linkDirectionalParticleWidth={1.4}
          linkDirectionalParticleColor={() => 'rgba(239, 68, 68, 0.7)'}
          backgroundColor="#F8FAFC"
          cooldownTicks={forceTuning.cooldownTicks}
          warmupTicks={forceTuning.warmupTicks}
          d3VelocityDecay={forceTuning.velocityDecay}
          d3AlphaDecay={forceTuning.alphaDecay}
          autoPauseRedraw
          onNodeDragEnd={() => {
            autoFitRef.current = false;
          }}
          onNodeClick={(node: GraphNode) => {
            // 话题层级：点击话题大节点 → 下钻局部视图；点击成员节点 → 打开详情
            if (node.isTopic && node.communityId !== undefined) {
              // 总览层点击大话题 → 下钻1；中话题层点击中话题 → 下钻2；成员 → 详情
              if (drillSuperId === null) {
                drillIntoSuper(node.communityId);
              } else {
                drillIntoTopic(node.communityId);
              }
            } else {
              openNodeDetail(node.id);
            }
          }}
          onNodeRightClick={(node: GraphNode) => {
            if (!node.isTopic) addSelectedNode(node.id);
          }}
        />

        {/* hover 连线：显示"为什么相关"（关系类型 + 方向 + 来源） */}
        {hoveredLink ? (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 max-w-[78%] bg-white/95 backdrop-blur-md border border-gray-100 shadow-card rounded-xl px-3 py-2 text-xs text-gray-600 pointer-events-none">
            {(() => {
              const s = linkEndpointId(hoveredLink.source);
              const t = linkEndpointId(hoveredLink.target);
              const sName = nodeById.get(s)?.name || s;
              const tName = nodeById.get(t)?.name || t;
              const rel = getRelationLabel(hoveredLink.relation_type);
              const evidence = hoveredLink.evidence_captured_ids?.length || 0;
              return (
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-gray-800">{sName}</span>
                  <span className="text-blue-600">→</span>
                  <span className="font-medium text-gray-800">{tName}</span>
                  <span className="text-gray-400">（{rel}{evidence ? ` · ${evidence} 条来源` : ''}）</span>
                </span>
              );
            })()}
          </div>
        ) : null}


        <AnimatePresence>
          {nodeDetail ? (
            <motion.aside
              ref={detailPanelRef}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="absolute z-30 bg-white shadow-xl flex min-h-0 flex-col overflow-hidden
                inset-x-0 bottom-0 max-h-[calc(100%_-_0.75rem)] border-t border-gray-200 rounded-t-xl
                md:inset-y-0 md:right-0 md:left-auto md:w-full md:max-w-md md:max-h-none md:border-l md:border-t-0 md:rounded-none"
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-blue-500" />
                  <h2 className="font-semibold text-gray-900">节点详情</h2>
                </div>
                <button
                  onClick={() => setDetailNodeId(null)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"
                  aria-label="关闭节点详情"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-5 touch-pan-y">
                <section>
                  <h3 className="text-lg font-semibold text-gray-900">{nodeDetail.node.name}</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    类型：{NODE_KIND_META[getNodeKind(nodeDetail.node)]?.label || '未分类'}
                  </p>
                  {nodeDetail.node.aliases?.length ? (
                    <p className="mt-2 text-xs text-gray-500">别名：{nodeDetail.node.aliases.join('、')}</p>
                  ) : null}
                </section>

                {nodeDetail.loading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在加载来源与关系...
                  </div>
                ) : null}

                {nodeDetail.error ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {nodeDetail.error}
                  </div>
                ) : null}

                {!nodeDetail.loading && !nodeDetail.error ? (
                  <>
                    <section>
                      <h4 className="text-sm font-semibold text-gray-800 mb-2">
                        来源记录 <span className="text-xs font-normal text-gray-400">（最多 8 条）</span>
                      </h4>
                      {nodeDetail.sources.length ? (
                        <div className="space-y-2">
                          {nodeDetail.sources.map((source) => (
                            <button
                              key={source.id}
                              onClick={() => onNavigate?.('item-detail', source.id)}
                              className="w-full text-left rounded-md border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50/40"
                            >
                              <span className="block text-sm font-medium text-gray-800 truncate">
                                {source.title || '未命名记录'}
                              </span>
                              <span className="mt-1 block text-xs text-gray-500 line-clamp-2">
                                {source.summary || source.content || '暂无摘要'}
                              </span>
                              <span className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600">
                                查看记录 <ExternalLink className="w-3 h-3" />
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">暂无来源内容</p>
                      )}
                    </section>

                    <section>
                      <h4 className="text-sm font-semibold text-gray-800 mb-2">邻居与关系</h4>
                      {nodeDetail.relations.length ? (
                        <div className="space-y-2">
                          {nodeDetail.relations.map((relation, index) => {
                            const outgoing = relation.source === nodeDetail.node.id;
                            const neighborId = outgoing ? relation.target : relation.source;
                            const neighbor = nodeById.get(neighborId);
                            const relationLabel = getRelationLabel(relation.relation_type);
                            const evidence = relation.evidence_captured_ids?.length
                              ? nodeDetail.sources
                                  .filter((source) => relation.evidence_captured_ids?.includes(source.id))
                                  .map((source) => source.title)
                                  .join('、')
                              : '';
                            const directionLabel = outgoing ? '出向' : '入向';
                            const arrow = outgoing
                              ? `${nodeDetail.node.name} \u2192 ${neighbor?.name || '未知节点'}`
                              : `${neighbor?.name || '未知节点'} \u2192 ${nodeDetail.node.name}`;
                            return (
                              <div
                                key={relation.id || `${relation.source}-${relation.target}-${index}`}
                                className="rounded-md border border-gray-200 p-3"
                              >
                                <button
                                  onClick={() => neighbor && openNodeDetail(neighbor.id)}
                                  className="text-sm font-medium text-blue-700 hover:underline truncate"
                                >
                                  {neighbor?.name || '未知节点'}
                                </button>
                                <p className="mt-1 text-xs text-gray-600">
                                  {directionLabel} · {relationLabel} · {arrow}
                                </p>
                                <p className="mt-1 text-xs text-gray-400">
                                  证据：{evidence || '暂无证据记录'}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">暂无邻居关系</p>
                      )}
                    </section>
                  </>
                ) : null}
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {topicInsightOpen && topicInsight ? (
            <motion.aside
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="absolute z-30 bg-white shadow-float flex min-h-0 flex-col overflow-hidden
                inset-x-0 bottom-0 max-h-[calc(100%_-_0.75rem)] border-t border-gray-100 rounded-t-2xl
                md:inset-y-0 md:right-0 md:left-auto md:w-full md:max-w-md md:max-h-none md:border-l md:border-t-0 md:rounded-none"
            >
              {/* 头部 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: topicInsight.topicColor }} />
                  <h2 className="font-semibold text-gray-900 text-base">{topicInsight.topicName} · 状况</h2>
                </div>
                <button
                  onClick={() => setTopicInsightOpen(false)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                  aria-label="关闭话题状况"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-4 touch-pan-y">
                {/* 概览卡（品牌渐变） */}
                <div
                  className="rounded-2xl p-4 border border-brand-200"
                  style={{ background: 'linear-gradient(135deg, var(--brand-soft) 0%, #f0f9ff 100%)' }}
                >
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-white rounded-md bg-brand mb-2">
                    <Sparkles className="w-3 h-3" /> 概览
                  </span>
                  <p className="text-[13px] text-gray-700 leading-relaxed">
                    这里收录了 <b className="text-brand-strong">{topicInsight.memberCount}</b> 条与「{topicInsight.topicName}」相关的内容。
                    {topicInsight.newThisWeek > 0 ? ` 本周新增了 ${topicInsight.newThisWeek} 条，最近你比较关注这个主题。` : ' 近期暂无新增。'}
                  </p>
                </div>

                {/* 指标 grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-50 rounded-xl px-2 py-2.5 text-center border border-gray-100">
                    <div className="text-lg font-bold text-gray-900">{topicInsight.memberCount}</div>
                    <div className="text-[10px] text-gray-500">内容</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-2 py-2.5 text-center border border-gray-100">
                    <div className="text-lg font-bold text-brand">{topicInsight.newThisWeek > 0 ? `+${topicInsight.newThisWeek}` : '0'}</div>
                    <div className="text-[10px] text-gray-500">本周新增</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-2 py-2.5 text-center border border-gray-100">
                    <div className="text-lg font-bold text-gray-900">{topicInsight.relatedTopics.length}</div>
                    <div className="text-[10px] text-gray-500">关联主题</div>
                  </div>
                </div>

                {/* 代表性内容 */}
                {topicInsight.representativeItems.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">这个主题下有什么</h4>
                    <div className="space-y-2">
                      {topicInsight.representativeItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => { setTopicInsightOpen(false); openNodeDetail(item.id); }}
                          className="w-full text-left rounded-xl border border-gray-100 p-3 hover:border-brand-200 hover:bg-brand-soft/30 transition-colors"
                        >
                          <span className="block text-sm font-medium text-gray-800 truncate">{item.title}</span>
                          {item.summary ? (
                            <span className="mt-0.5 block text-xs text-gray-500 line-clamp-1">{item.summary}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* 趋势 */}
                {topicInsight.trends.length > 0 && (
                  <section className="rounded-2xl border border-gray-100 p-3.5">
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">变化趋势</h4>
                    {topicInsight.trends.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className={t.direction === 'up' ? 'text-emerald-600' : 'text-gray-400'}>
                          {t.direction === 'up' ? '↑' : '→'}
                        </span>
                        <span><b className="text-gray-700">{t.label}</b> · {t.detail}</span>
                      </div>
                    ))}
                  </section>
                )}

                {/* 建议 */}
                {topicInsight.suggestions.length > 0 && (
                  <section className="rounded-2xl border border-brand-200 p-3.5" style={{ background: 'linear-gradient(135deg, var(--brand-soft) 0%, #f0f9ff 100%)' }}>
                    <h4 className="text-sm font-semibold text-brand-strong mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> 下一步建议
                    </h4>
                    <ul className="space-y-2">
                      {topicInsight.suggestions.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] text-gray-700 leading-relaxed">
                          <span className="flex-none w-4 h-4 rounded-full bg-brand text-white text-[10px] flex items-center justify-center mt-0.5">{i + 1}</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button
            onClick={handleZoomIn}
            className="w-10 h-10 bg-card border border-gray-100 shadow-card hover:bg-gray-50 transition-colors flex items-center justify-center rounded-xl"
            aria-label="放大"
          >
            <ZoomIn className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={handleZoomOut}
            className="w-10 h-10 bg-card border border-gray-100 shadow-card hover:bg-gray-50 transition-colors flex items-center justify-center rounded-xl"
            aria-label="缩小"
          >
            <ZoomOut className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={handleFitView}
            className="w-10 h-10 bg-card border border-gray-100 shadow-card hover:bg-gray-50 transition-colors flex items-center justify-center rounded-xl"
            aria-label="适应视图"
          >
            <Maximize2 className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {!sidePanelCollapsed && (
        <div ref={sidePanelRef} className="absolute top-14 left-4 w-52 bg-white/90 backdrop-blur-md border border-gray-100 p-3 shadow-card max-h-[calc(100%-4rem)] overflow-y-auto rounded-2xl">
          {/* 视图信息：总览 or 下钻 */}
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-700">
              {drillTopicMembers ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 flex-none" style={{ borderRadius: '50%', backgroundColor: drillTopicMembers.color }}></span>
                  {drillTopicMembers.name}
                </span>
              ) : drillSuperId !== null ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 flex-none" style={{ borderRadius: '50%', backgroundColor: communityAnalysis.superTopics.find((s) => s.id === drillSuperId)?.color || '#94A3B8' }}></span>
                  {superDisplayName(drillSuperId, communityAnalysis.superTopics.find((s) => s.id === drillSuperId)?.name || '')}
                </span>
              ) : (
                '知识图谱'
              )}
            </h4>
            <span className="text-[11px] text-gray-400">
              {drillTopicMembers ? `${drillTopicMembers.total} 个知识点` : drillSuperId !== null ? `${communityAnalysis.topics.filter((t) => t.parentSuperId === drillSuperId).length} 个中话题` : `${communityAnalysis.superTopics.length} 个大话题`}
            </span>
            <button
              onClick={() => setSidePanelCollapsed(true)}
              className="flex-none p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors rounded-md"
              aria-label="折叠话题面板"
              title="折叠话题面板，让图谱占满画布"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* 话题状况入口（下钻层）——并入侧栏，不再右下角悬浮遮挡节点 */}
          {drillSuperId !== null || drillTopicId !== null ? (
            <button
              onClick={loadTopicInsight}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mb-2 bg-brand text-white text-xs font-medium shadow-card hover:brightness-110 transition-all rounded-lg"
              aria-label="查看话题状况"
              title="查看这个话题的内容、趋势与建议"
            >
              <Sparkles className="w-4 h-4" />
              话题状况
            </button>
          ) : null}

          {/* 下钻时：成员类型构成（已去掉——对用户价值低，不如直接看内容；保留话题列表导航） */}

          {/* 话题列表（三层）：总览=大话题 / 下钻1=中话题 / 下钻2=中话题（供同级跳转） */}
          {communityAnalysis.superTopics.length > 0 ? (
            <div className={(drillTopicMembers || drillSuperId !== null) ? 'pt-2 border-t border-gray-100' : ''}>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-medium text-gray-700 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-gray-400" />
                  {drillSuperId !== null ? '中话题' : '大话题'}
                </h4>
                {(drillSuperId !== null || drillTopicId !== null) ? (
                  <button onClick={drillBack} className="text-[10px] text-blue-600 hover:text-blue-700">
                    返回
                  </button>
                ) : null}
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {drillSuperId !== null
                  ? communityAnalysis.topics
                      .filter((t) => t.parentSuperId === drillSuperId)
                      .slice(0, 15)
                      .map((topic) => {
                        const active = drillTopicId === topic.communityId;
                        const memberCount = topic.memberIds.length + topic.hiddenCount;
                        return (
                          <button
                            key={topic.communityId}
                            onClick={() => (active ? drillBack() : drillIntoTopic(topic.communityId))}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors rounded-lg ${active ? 'bg-brand-soft text-brand-strong' : 'text-gray-600 hover:bg-gray-50'}`}
                            title={active ? '返回中话题列表' : `进入该话题查看 ${memberCount} 个知识点`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 flex-none" style={{ borderRadius: '50%', backgroundColor: topic.color }}></span>
                              <span className="truncate">{topicDisplayName(topic.communityId, topic.name)}{topic.hiddenCount > 0 ? `（+${topic.hiddenCount}）` : ''}</span>
                            </span>
                            <span className="text-[11px] text-gray-400">{active ? '查看中' : memberCount}</span>
                          </button>
                        );
                      })
                  : communityAnalysis.superTopics.slice(0, 15).map((sup) => {
                      const active = drillSuperId === sup.id;
                      return (
                        <button
                          key={sup.id}
                          onClick={() => (active ? drillBack() : drillIntoSuper(sup.id))}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors rounded-lg ${active ? 'bg-brand-soft text-brand-strong' : 'text-gray-600 hover:bg-gray-50'}`}
                          title={active ? '返回总览' : `进入该大话题查看 ${sup.memberCount} 个知识点`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 flex-none" style={{ borderRadius: '50%', backgroundColor: sup.color }}></span>
                            <span className="truncate">{superDisplayName(sup.id, sup.name)}</span>
                          </span>
                          <span className="text-[11px] text-gray-400">{active ? '查看中' : sup.memberCount}</span>
                        </button>
                      );
                    })}
              </div>
            </div>
          ) : null}
        </div>
        )}
        {sidePanelCollapsed && (
          <button
            onClick={() => setSidePanelCollapsed(false)}
            className="absolute top-3 left-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/95 backdrop-blur border border-gray-200 shadow-card hover:bg-gray-50 transition-colors text-xs text-gray-600 rounded-xl"
            aria-label="展开话题面板"
            title="展开话题面板"
          >
            <PanelLeftOpen className="w-4 h-4" />
            话题列表
          </button>
        )}
      </div>
    </div>
  );
}
