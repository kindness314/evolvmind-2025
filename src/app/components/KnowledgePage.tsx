import { Search, ZoomIn, ZoomOut, Maximize2, Loader2, Sparkles, Plus, X, ExternalLink, Network } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { supabase } from '../../lib/supabase';
import { checkGraphSetup, type GraphSetupStatus } from '../../lib/graph';
import { semanticSearchKnowledgeNodes, type KnowledgeNodeSearchResult } from '../../lib/graphSearch';

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
  created_at?: string | null;
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
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<NodeDetailState | null>(null);
  const [timeRange, setTimeRange] = useState<'all' | '7d' | '30d'>('all');
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

    let visibleIds: Set<string>;
    let visibleLinks: GraphLink[];

    if (activeKind !== 'all') {
      visibleIds = new Set([...categoryNodeIds].filter((id) => timeNodeIds.has(id)));
      visibleLinks = [];
    } else if (centerNodeId) {
      // 节点中心模式
      const componentIds = getConnectedComponentNodeIds(centerNodeId, graphData.links);
      // 上下文节点：不在时间范围内但属于连通分量的邻居
      const contextNodeIds = new Set([...componentIds].filter((id) => !timeNodeIds.has(id)));
      visibleIds = new Set([...componentIds].filter((id) => timeNodeIds.has(id) || contextNodeIds.has(id)));
      // 必要时保留聚焦节点的上下文邻居
      if (!timeNodeIds.has(centerNodeId)) {
        visibleIds = new Set([...componentIds]); // 保留整个连通分量
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
  }, [activeKind, categoryNodeIds, focusedNodeId, graphData, selectedNodeIds, timeRange]);

  const selectedNodes = useMemo(() => {
    return selectedNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node));
  }, [nodeById, selectedNodeIds]);

  const focusedNode = focusedNodeId ? nodeById.get(focusedNodeId) : null;
  const hasFilteredView = Boolean(focusedNodeId || selectedNodeIds.length > 0 || searchQuery.trim() || activeKind !== 'all' || timeRange !== 'all');

  const activeKeywords = useMemo(() => {
    return graphData.nodes
      .filter((node) => categoryNodeIds.has(node.id))
      .slice()
      .sort((a, b) => (b.val || 0) - (a.val || 0))
      .slice(0, 4)
      .map((node) => node.name);
  }, [categoryNodeIds, graphData.nodes]);

  const addSelectedNode = useCallback((nodeId: string) => {
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

  const handleFitView = useCallback(() => {
    const fg = fgRef.current;
    if (fg) {
      fg.zoomToFit(400);
    }
  }, []);

  const resetGraphView = useCallback(() => {
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setSearchQuery('');
    setActiveKind('all');
    setTimeRange('all');
    window.setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
    }, 50);
  }, []);

  const handleCategorySelect = useCallback((kind: string) => {
    setActiveKind(kind);
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setDetailNodeId(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    setFocusedNodeId(nodeId);
    setSelectedNodeIds([]);
    setActiveKind('all');
  }, []);
  const openNodeDetail = useCallback((nodeId: string) => {
    setDetailNodeId(nodeId);
    focusNode(nodeId);
  }, [focusNode]);

  useEffect(() => {
    if (!initialNodeId || loading) return;
    if (!graphData.nodes.some((node) => node.id === initialNodeId)) return;
    setDetailNodeId(null);
    focusNode(initialNodeId);
  }, [focusNode, graphData.nodes, initialNodeId, loading]);
  const positionGraphViewport = useCallback(() => {
    const fg = fgRef.current;
    const graphArea = graphAreaRef.current;
    if (!fg || !graphArea || displayGraphData.nodes.length === 0 || dimensions.width <= 0 || dimensions.height <= 0) return false;

    const graphRect = graphArea.getBoundingClientRect();
    const gw = graphRect.width;
    const gh = graphRect.height;
    const appRect = graphArea.closest('main')?.getBoundingClientRect() ?? graphRect;
    const targetScreenX = Math.min(graphRect.right, Math.max(graphRect.left, appRect.left + appRect.width / 2)) - graphRect.left;
    const targetScreenY = Math.min(graphRect.bottom, Math.max(graphRect.top, appRect.top + appRect.height / 2)) - graphRect.top;
    const centerNodeId = focusedNodeId || selectedNodeIds[0] || null;

    if (!centerNodeId) {
      fg.zoomToFit(0, Math.min(64, Math.max(28, gw * 0.1)));
      if (displayGraphData.nodes.length <= 2 && fg.zoom() > 1.8) fg.zoom(1.8, 0);
      const graphCenter = fg.centerAt();
      const canvasCenterGraph = fg.screen2GraphCoords(gw / 2, gh / 2);
      const targetGraph = fg.screen2GraphCoords(targetScreenX, targetScreenY);
      fg.centerAt(
        graphCenter.x + canvasCenterGraph.x - targetGraph.x,
        graphCenter.y + canvasCenterGraph.y - targetGraph.y,
        0
      );
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
    const padding = Math.min(72, Math.max(36, gw * 0.12));
    const fitScale = Math.min((gw - padding * 2) / spanX, (gh - padding * 2) / spanY);
    const targetScale = Math.max(1.0, Math.min(4.0, fitScale * 0.85));

    fg.centerAt(nodeX, nodeY, 0);
    fg.zoom(targetScale, 0);
    const canvasCenterGraph = fg.screen2GraphCoords(gw / 2, gh / 2);
    const targetGraph = fg.screen2GraphCoords(targetScreenX, targetScreenY);
    fg.centerAt(
      nodeX + canvasCenterGraph.x - targetGraph.x,
      nodeY + canvasCenterGraph.y - targetGraph.y,
      0
    );

    return true;
  }, [dimensions.height, dimensions.width, displayGraphData.nodes, displayGraphData.links, focusedNodeId, selectedNodeIds]);

  useEffect(() => {
    let framesRemaining = focusedNodeId || selectedNodeIds.length > 0 ? 45 : 8;
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
  }, [focusedNodeId, positionGraphViewport, selectedNodeIds.length]);

  const fetchGraphData = async () => {
    setLoading(true);
    try {
      // 列裁剪(不含 embedding 向量列): select('*') 会把 1536 维向量序列化成巨大 JSON,
      // 慢网络下 30 节点即达数百 KB, 是图谱加载慢的主因; graph.ts 等其他调用均已只选具体列
      const [nodesResponse, linksResponse] = await Promise.all([
        supabase.from('knowledge_nodes').select('id,name,val,color,kind,aliases,source_captured_ids,metadata,created_at'),
        supabase.from('knowledge_links').select('id,source,target,relation_type,evidence_captured_ids,confidence,created_at')
      ]);

      if (nodesResponse.error) throw nodesResponse.error;
      if (linksResponse.error) throw linksResponse.error;

      if (nodesResponse.data.length === 0) {
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
          nodes: nodesResponse.data.map((node) => {
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
          links: linksResponse.data.map((link) => ({
            id: link.id,
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
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-xs text-red-700" style={{ borderRadius: '4px' }}>
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
            className="w-full pl-9 pr-10 py-2 bg-gray-50 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            style={{ borderRadius: '4px' }}
          />
          {searching ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-500 animate-spin" /> : <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />}
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
                    <div key={id} className="flex-none flex items-center gap-1 px-2.5 py-1.5 bg-white text-xs border border-gray-200 shadow-sm" style={{ borderRadius: '6px' }}>
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
            <span className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700" style={{ borderRadius: '6px' }}>{focusedNode.name}</span>
            <button onClick={resetGraphView} className="text-blue-600 hover:text-blue-700">返回全部</button>
          </div>
        ) : null}

        {selectedNodes.length > 0 ? (
          <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
            <span className="flex-none text-xs text-gray-500">已选节点</span>
            {selectedNodes.map((node) => (
              <div key={node.id} className="flex-none flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 text-xs text-blue-700 max-w-none" style={{ borderRadius: '6px' }}>
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
              className="flex-none px-3 py-1 bg-blue-50 text-blue-700 text-xs border border-blue-200 hover:bg-blue-100 transition-colors"
              style={{ borderRadius: '4px' }}
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
              className={`px-2 py-0.5 text-[11px] transition-colors ${
                timeRange === range
                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                  : 'text-gray-500 hover:text-gray-700 border border-transparent'
              }`}
              style={{ borderRadius: '4px' }}
            >
              {range === 'all' ? '全部' : range}
            </button>
          ))}
          {displayGraphData.newNodeIds && displayGraphData.nodes.length < graphData.nodes.length ? (
            <span className="text-[10px] text-purple-500 ml-auto">
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
            const baseRadius = Math.max(5, Math.min(10, 4 + Math.sqrt(node.val || 6) * 1.5));
            const radius = baseRadius * (isCenter ? 1.15 : isMatched ? 1.1 : 1);

            // 新增节点外圈紫色光环
            if (isNew && timeRange !== 'all' && !isCenter && !isMatched) {
              ctx.shadowColor = 'rgba(168, 85, 247, 0.35)';
              ctx.shadowBlur = 10 / globalScale;
              hexagonPath(ctx, node.x, node.y, radius + 2 / globalScale);
              ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
              ctx.lineWidth = 1.5 / globalScale;
              ctx.stroke();
              ctx.shadowBlur = 0;
            }

            ctx.shadowColor = isCenter ? 'rgba(37, 99, 235, 0.4)' : 'rgba(15, 23, 42, 0.15)';
            ctx.shadowBlur = (isCenter ? 12 : 6) / globalScale;
            hexagonPath(ctx, node.x, node.y, radius);
            ctx.fillStyle = isMatched ? '#7C3AED' : node.color;
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.lineWidth = (isCenter ? 2.5 : isNew ? 1.8 : 1.2) / globalScale;
            ctx.strokeStyle = isFocused ? '#FBBF24' : isSelected ? '#2563EB' : isNew && timeRange !== 'all' ? '#A855F7' : 'rgba(255, 255, 255, 0.95)';
            hexagonPath(ctx, node.x, node.y, radius);
            ctx.stroke();

            // 六边形内动态文字
            const maxChars = isCenter || isMatched
              ? Math.max(4, Math.round(radius * 0.8))
              : Math.max(2, Math.round(radius * 0.5));
            const label = truncateLabel(node.name, maxChars);
            const innerWidth = radius * 1.6;
            const fontSize = Math.min(radius * 0.6, innerWidth / Math.max(label.length, 1));
            if (fontSize * globalScale >= 5 || isCenter) {
              ctx.font = `600 ${fontSize}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = '#ffffff';
              ctx.fillText(label, node.x, node.y);
            }

            const result = searchResultMap.get(node.id);
            if (result) {
              ctx.fillStyle = '#6B7280';
              ctx.font = `${9 / globalScale}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${Math.round(result.similarity * 100)}%`, node.x, node.y + radius + 8 / globalScale);
            }
          }}
          nodePointerAreaPaint={(node, color: string, ctx: CanvasRenderingContext2D) => {
            const baseRadius = Math.max(5, Math.min(10, 4 + Math.sqrt(node.val || 6) * 1.5));
            if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
            ctx.fillStyle = color;
            hexagonPath(ctx, node.x, node.y, Math.max(9, baseRadius * 1.4));
            ctx.fill();
          }}
          linkColor={(link: GraphLink) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            return matchedIds.has(source) || matchedIds.has(target) || selectedNodeIds.includes(source) || selectedNodeIds.includes(target) || source === focusedNodeId || target === focusedNodeId
              ? 'rgba(37, 99, 235, 0.62)'
              : 'rgba(148, 163, 184, 0.28)';
          }}
          onEngineStop={positionGraphViewport}
          linkWidth={(link: GraphLink) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            return matchedIds.has(source) || matchedIds.has(target) || selectedNodeIds.includes(source) || selectedNodeIds.includes(target) || source === focusedNodeId || target === focusedNodeId ? 2.6 : 1.2;
          }}
          backgroundColor="#F8FAFC"
          cooldownTicks={100}
          onNodeClick={(node: GraphNode) => openNodeDetail(node.id)}
          onNodeRightClick={(node: GraphNode) => addSelectedNode(node.id)}
        />


        <AnimatePresence>
          {nodeDetail ? (
            <motion.aside
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
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button
            onClick={handleZoomIn}
            className="w-10 h-10 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors flex items-center justify-center"
            style={{ borderRadius: '4px' }}
            aria-label="放大"
          >
            <ZoomIn className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={handleZoomOut}
            className="w-10 h-10 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors flex items-center justify-center"
            style={{ borderRadius: '4px' }}
            aria-label="缩小"
          >
            <ZoomOut className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={handleFitView}
            className="w-10 h-10 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors flex items-center justify-center"
            style={{ borderRadius: '4px' }}
            aria-label="适应视图"
          >
            <Maximize2 className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <div className="absolute top-4 left-4 w-44 bg-white/95 backdrop-blur border border-gray-200 p-3 shadow-sm" style={{ borderRadius: '8px' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-700">分类</h4>
            <span className="text-[11px] text-gray-400">{displayGraphData.nodes.length}/{graphData.nodes.length}</span>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {categoryItems.map((item) => (
              <button
                key={item.kind}
                onClick={() => handleCategorySelect(item.kind)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors ${activeKind === item.kind ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                style={{ borderRadius: '6px' }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 flex-none" style={{ borderRadius: '50%', backgroundColor: item.color }}></span>
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="text-[11px] text-gray-400">{item.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
