import { Search, ZoomIn, ZoomOut, Maximize2, Loader2 } from 'lucide-react';
import { useRef, useCallback, useState, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { supabase } from '../../lib/supabase';

interface GraphNode {
  id: string;
  name: string;
  val: number;
  color: string;
}

interface GraphLink {
  source: string;
  target: string;
}

export function KnowledgePage() {
  const fgRef = useRef<any>();
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: []
  });

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    fetchGraphData();
    
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

  const fetchGraphData = async () => {
    setLoading(true);
    try {
      const [nodesResponse, linksResponse] = await Promise.all([
        supabase.from('knowledge_nodes').select('*'),
        supabase.from('knowledge_links').select('*')
      ]);

      if (nodesResponse.error) throw nodesResponse.error;
      if (linksResponse.error) throw linksResponse.error;

      // 如果数据库为空，我们可以插入一些初始演示数据或者保持为空
      if (nodesResponse.data.length === 0) {
        // 演示数据
        const demoNodes = [
          { id: '1', name: '产品设计', val: 20, color: '#3B82F6' },
          { id: '2', name: '极简主义', val: 15, color: '#6366F1' },
          { id: '3', name: 'UI规范', val: 15, color: '#8B5CF6' }
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
            color: node.color || '#3B82F6'
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
      {/* 顶部搜索和筛选 */}
      <div className="flex-none px-4 py-3 border-b border-gray-200">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索知识节点..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            style={{ borderRadius: '4px' }}
          />
        </div>

        {/* 关键词筛选 */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {activeKeywords.map((keyword, idx) => (
            <button
              key={idx}
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

      {/* 知识图谱 */}
      <div className="flex-1 relative bg-gray-50">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gray-50/80">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <p className="text-sm text-gray-500">加载知识网络...</p>
          </div>
        ) : null}
        
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel="name"
          nodeAutoColorBy="color"
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.name;
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Inter, sans-serif`;
            
            // 绘制节点圆形
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.val / 2, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            
            // 绘制文字
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, node.x, node.y);
          }}
          linkColor={() => '#E5E7EB'}
          linkWidth={2}
          backgroundColor="#F9FAFB"
          cooldownTicks={100}
          onNodeClick={(node) => {
            console.log('Clicked node:', node);
          }}
        />

        {/* 控制按钮 */}
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

        {/* 图例 */}
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
