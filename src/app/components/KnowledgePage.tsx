import { Search, ZoomIn, ZoomOut, Maximize2, Loader2, Sparkles } from 'lucide-react';
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

function linkEndpointId(endpoint: string | GraphNode) {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

export function KnowledgePage() {
  const fgRef = useRef<any>();
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

  useEffect(() => {
    fetchGraphData();
    void checkGraphSetup()
      .then(setSetupStatus)
      .catch((e) => setSetupStatus({ schemaOk: false, llmOk: false, schemaError: String(e), llmError: String(e) }));

    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 180
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

  const searchResultMap = useMemo(() => {
    return new Map(searchResults.map((result) => [result.id, result]));
  }, [searchResults]);

  const localMatchIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || searchResults.length > 0) return new Set<string>();
    return new Set(
      graphData.nodes
        .filter((node) => {
          const text = [node.name, node.kind, ...(node.aliases || [])].join(' ').toLowerCase();
          return text.includes(query);
        })
        .map((node) => node.id)
    );
  }, [graphData.nodes, searchQuery, searchResults.length]);

  const matchedIds = useMemo(() => {
    if (searchResults.length > 0) return new Set(searchResults.map((result) => result.id));
    return localMatchIds;
  }, [localMatchIds, searchResults]);

  const displayGraphData = useMemo(() => {
    if (!searchQuery.trim() || matchedIds.size === 0) return graphData;

    const visibleIds = new Set(matchedIds);
    const visibleLinks = graphData.links.filter((link) => {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      const touchesMatch = matchedIds.has(source) || matchedIds.has(target);
      if (touchesMatch) {
        visibleIds.add(source);
        visibleIds.add(target);
      }
      return touchesMatch;
    });

    return {
      nodes: graphData.nodes.filter((node) => visibleIds.has(node.id)),
      links: visibleLinks,
    };
  }, [graphData, matchedIds, searchQuery]);

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

  const focusNode = useCallback((nodeId: string) => {
    const node = displayGraphData.nodes.find((n) => n.id === nodeId);
    const fg = fgRef.current;
    if (!node || !fg || typeof node.x !== 'number' || typeof node.y !== 'number') return;
    fg.centerAt(node.x, node.y, 500);
    fg.zoom(3, 500);
  }, [displayGraphData.nodes]);

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
          { id: '1', name: '产品设计', val: 20, color: '#3B82F6', kind: 'concept', aliases: [] },
          { id: '2', name: '极简主义', val: 15, color: '#6366F1', kind: 'concept', aliases: [] },
          { id: '3', name: 'UI规范', val: 15, color: '#8B5CF6', kind: 'concept', aliases: [] }
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
          nodes: nodesResponse.data.map(node => ({
            id: node.id,
            name: node.name,
            val: node.val || 10,
            color: node.color || '#3B82F6',
            kind: node.kind || 'concept',
            aliases: node.aliases || []
          })),
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

  const activeKeywords = Array.from(new Set(graphData.nodes.map(n => n.name))).slice(0, 4);

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
            placeholder="语义搜索知识节点..."
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
              <span>{searchResults.length > 0 ? `找到 ${searchResults.length} 个语义匹配节点` : localMatchIds.size > 0 ? `本地匹配 ${localMatchIds.size} 个节点` : '暂无匹配节点'}</span>
              {searchError ? <span className="text-orange-600">已降级为本地搜索</span> : null}
            </div>
            {searchResults.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {searchResults.slice(0, 8).map((result) => (
                  <button
                    key={result.id}
                    onClick={() => focusNode(result.id)}
                    className="flex-none px-3 py-1 bg-purple-50 text-purple-700 text-xs border border-purple-200 hover:bg-purple-100 transition-colors"
                    style={{ borderRadius: '4px' }}
                  >
                    {result.name} · {Math.round(result.similarity * 100)}%
                  </button>
                ))}
              </div>
            ) : null}
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
          <button
            className="flex-none px-3 py-1 bg-gray-100 text-gray-600 text-xs border border-gray-200 hover:bg-gray-200 transition-colors"
            style={{ borderRadius: '4px' }}
          >
            + 添加
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-gray-50">
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
          nodeLabel="name"
          nodeAutoColorBy="color"
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.name;
            const isMatched = matchedIds.has(node.id);
            const result = searchResultMap.get(node.id);
            const radius = (node.val / 2) * (isMatched ? 1.35 : 1);
            const fontSize = (isMatched ? 13 : 12) / globalScale;
            ctx.font = `${fontSize}px Inter, sans-serif`;

            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isMatched ? '#7C3AED' : node.color;
            ctx.fill();

            if (isMatched) {
              ctx.lineWidth = 3 / globalScale;
              ctx.strokeStyle = '#FBBF24';
              ctx.stroke();
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, node.x, node.y);

            if (result) {
              ctx.fillStyle = '#4B5563';
              ctx.font = `${10 / globalScale}px Inter, sans-serif`;
              ctx.fillText(`${Math.round(result.similarity * 100)}%`, node.x, node.y + radius + 10 / globalScale);
            }
          }}
          linkColor={() => '#E5E7EB'}
          linkWidth={(link: any) => {
            const source = linkEndpointId(link.source);
            const target = linkEndpointId(link.target);
            return matchedIds.has(source) || matchedIds.has(target) ? 3 : 2;
          }}
          backgroundColor="#F9FAFB"
          cooldownTicks={100}
          onNodeClick={(node: any) => focusNode(node.id)}
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

        <div className="absolute top-4 left-4 bg-white border border-gray-200 p-3 shadow-sm" style={{ borderRadius: '4px' }}>
          <h4 className="text-xs font-medium text-gray-700 mb-2">分类</h4>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500" style={{ borderRadius: '50%' }}></div>
              <span className="text-xs text-gray-600">产品设计</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500" style={{ borderRadius: '50%' }}></div>
              <span className="text-xs text-gray-600">用户研究</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-500" style={{ borderRadius: '50%' }}></div>
              <span className="text-xs text-gray-600">会议记录</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-pink-500" style={{ borderRadius: '50%' }}></div>
              <span className="text-xs text-gray-600">设计资源</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
