import { Search, ZoomIn, ZoomOut, Maximize2, Loader2, Sparkles, Plus, X } from 'lucide-react';
import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
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
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
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

export function KnowledgePage() {
  const fgRef = useRef<any>();
  const graphAreaRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    fetchGraphData();
    void checkGraphSetup()
      .then(setSetupStatus)
      .catch((e) => setSetupStatus({ schemaOk: false, llmOk: false, schemaError: String(e), llmError: String(e) }));

    const updateDimensions = () => {
      const graphArea = graphAreaRef.current;
      setDimensions({
        width: graphArea?.clientWidth || Math.min(window.innerWidth, 448),
        height: graphArea?.clientHeight || window.innerHeight - 180
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
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
        .catch((e: any) => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchError(e.message || '语义搜索失败');
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

    let visibleIds: Set<string>;
    let visibleLinks: GraphLink[];

    if (activeKind !== 'all') {
      // 分类模式：只显示该分类节点，不显示关系边和邻居
      visibleIds = new Set(categoryNodeIds);
      visibleLinks = [];
    } else if (centerNodeId) {
      // 节点中心模式：显示该节点所在完整连通分量及分量内部所有边
      visibleIds = getConnectedComponentNodeIds(centerNodeId, graphData.links);
      visibleLinks = graphData.links.filter(
        (link) => visibleIds.has(linkEndpointId(link.source)) && visibleIds.has(linkEndpointId(link.target))
      );
    } else {
      // 默认模式：全部节点和全部边；搜索只高亮，不收缩图
      visibleIds = new Set(graphData.nodes.map((node) => node.id));
      visibleLinks = graphData.links;
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
    };
  }, [activeKind, categoryNodeIds, focusedNodeId, graphData, selectedNodeIds]);

  const selectedNodes = useMemo(() => {
    return selectedNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node));
  }, [nodeById, selectedNodeIds]);

  const focusedNode = focusedNodeId ? nodeById.get(focusedNodeId) : null;
  const hasFilteredView = Boolean(focusedNodeId || selectedNodeIds.length > 0 || searchQuery.trim() || activeKind !== 'all');

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
    window.setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
    }, 50);
  }, []);

  const handleCategorySelect = useCallback((kind: string) => {
    setActiveKind(kind);
    setFocusedNodeId(null);
    setSelectedNodeIds([]);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    window.setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
    }, 120);
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    setFocusedNodeId(nodeId);
    setSelectedNodeIds([]);
    setActiveKind('all');
  }, []);

  useEffect(() => {
    const centerNodeId = focusedNodeId || selectedNodeIds[0];
    if (!centerNodeId) return;

    const centerFocusedNode = () => {
      const node = displayGraphData.nodes.find((n) => n.id === centerNodeId);
      const fg = fgRef.current;
      const graphArea = graphAreaRef.current;
      if (!node || !fg || !graphArea || typeof node.x !== 'number' || typeof node.y !== 'number') return false;

      const zoom = 1.45;
      const graphBounds = graphArea.getBoundingClientRect();
      const targetScreenX = graphBounds.width / 2;
      const targetScreenY = graphBounds.height / 2;
      const currentScreen = fg.graph2ScreenCoords(node.x, node.y);
      const screenCenter = fg.screen2GraphCoords(targetScreenX, targetScreenY);
      const nodeAtTarget = fg.screen2GraphCoords(
        targetScreenX + (currentScreen.x - targetScreenX),
        targetScreenY + (currentScreen.y - targetScreenY)
      );
      const offsetX = nodeAtTarget.x - screenCenter.x;
      const offsetY = nodeAtTarget.y - screenCenter.y;

      fg.zoom(zoom, 300);
      fg.centerAt(node.x + offsetX, node.y + offsetY, 500);
      return true;
    };

    const timeouts = [80, 220, 520, 900].map((delay) =>
      window.setTimeout(() => {
        centerFocusedNode();
      }, delay)
    );

    return () => {
      timeouts.forEach(window.clearTimeout);
    };
  }, [displayGraphData.nodes, focusedNodeId, selectedNodeIds]);

  const fetchGraphData = async () => {
    setLoading(true);
    try {
      const [nodesResponse, linksResponse] = await Promise.all([
        supabase.from('knowledge_nodes').select('*'),
        supabase.from('knowledge_links').select('*')
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
          nodes: nodesResponse.data.map(node => {
            const kind = node.kind || 'concept';
            return {
              id: node.id,
              name: node.name,
              val: node.val || 10,
              color: NODE_KIND_META[kind]?.color || node.color || NODE_KIND_META.unknown.color,
              kind,
              aliases: node.aliases || []
            };
          }),
          links: linksResponse.data.map(link => ({
            source: link.source,
            target: link.target
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
    <div className="h-full flex flex-col bg-white">
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
              <span>{visibleSearchMatches.length > 0 ? `找到 ${visibleSearchMatches.length} 个可选节点` : '暂无匹配节点'}</span>
              {searchError ? <span className="text-orange-600">语义搜索不可用，已使用本地搜索</span> : null}
            </div>
            {visibleSearchMatches.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {visibleSearchMatches.map((result) => {
                  const id = 'similarity' in result ? result.id : result.id;
                  const name = 'similarity' in result ? result.name : result.name;
                  const isSelected = selectedNodeIds.includes(id);
                  const similarity = 'similarity' in result ? result.similarity : null;

                  return (
                    <div
                      key={id}
                      className="flex-none flex items-center gap-2 px-2.5 py-1 bg-white text-xs border border-gray-200 shadow-sm max-w-[280px]"
                      style={{ borderRadius: '6px' }}
                    >
                      <button onClick={() => focusNode(id)} className="min-w-0 truncate text-gray-700 hover:text-blue-600 transition-colors" title={name}>
                        {name}{similarity !== null ? ` · ${Math.round(similarity * 100)}%` : null}
                      </button>
                      <button
                        onClick={() => (isSelected ? removeSelectedNode(id) : addSelectedNode(id))}
                        className={isSelected ? 'text-red-500 hover:text-red-600' : 'text-blue-500 hover:text-blue-600'}
                        aria-label={isSelected ? '移除节点' : '添加节点'}
                      >
                        {isSelected ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
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
      </div>

      <div ref={graphAreaRef} className="flex-1 relative bg-slate-50">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gray-50/80">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <p className="text-sm text-gray-500">加载知识网络...</p>
          </div>
        ) : null}

        <ForceGraph2D
          ref={fgRef}
          graphData={displayGraphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel={(node: any) => `${node.name}${node.kind ? `｜${NODE_KIND_META[getNodeKind(node)]?.label || node.kind}` : ''}`}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const isMatched = matchedIds.has(node.id);
            const isSelected = selectedNodeIds.includes(node.id);
            const isFocused = focusedNodeId === node.id;
            const isCenter = isFocused || isSelected;
            const baseRadius = Math.max(5, Math.min(10, 4 + Math.sqrt(node.val || 6) * 1.5));
            const radius = baseRadius * (isCenter ? 1.15 : isMatched ? 1.1 : 1);

            ctx.shadowColor = isCenter ? 'rgba(37, 99, 235, 0.4)' : 'rgba(15, 23, 42, 0.15)';
            ctx.shadowBlur = (isCenter ? 12 : 6) / globalScale;
            hexagonPath(ctx, node.x, node.y, radius);
            ctx.fillStyle = isMatched ? '#7C3AED' : node.color;
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.lineWidth = (isCenter ? 2.5 : 1.2) / globalScale;
            ctx.strokeStyle = isFocused ? '#FBBF24' : isSelected ? '#2563EB' : 'rgba(255, 255, 255, 0.95)';
            hexagonPath(ctx, node.x, node.y, radius);
            ctx.stroke();

            // 六边形内动态文字：大小和字符数随节点大小与缩放变化
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
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            const baseRadius = Math.max(5, Math.min(10, 4 + Math.sqrt(node.val || 6) * 1.5));
            ctx.fillStyle = color;
            hexagonPath(ctx, node.x, node.y, Math.max(9, baseRadius * 1.4));
            ctx.fill();
          }}
          linkColor={(link: any) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            return matchedIds.has(source) || matchedIds.has(target) || selectedNodeIds.includes(source) || selectedNodeIds.includes(target) || source === focusedNodeId || target === focusedNodeId
              ? 'rgba(37, 99, 235, 0.62)'
              : 'rgba(148, 163, 184, 0.28)';
          }}
          linkWidth={(link: any) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            return matchedIds.has(source) || matchedIds.has(target) || selectedNodeIds.includes(source) || selectedNodeIds.includes(target) || source === focusedNodeId || target === focusedNodeId ? 2.6 : 1.2;
          }}
          backgroundColor="#F8FAFC"
          cooldownTicks={100}
          onNodeClick={(node: any) => focusNode(node.id)}
          onNodeRightClick={(node: any) => addSelectedNode(node.id)}
        />

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
