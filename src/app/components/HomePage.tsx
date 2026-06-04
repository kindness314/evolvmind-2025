import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Loader2, FileText, Image as ImageIcon, Mic, File, Pin, CheckSquare, Trash2, Check, X, Sparkles } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { semanticSearch, type SearchResult } from '../../lib/search';

interface InfoCard {
  id: string;
  type: 'text' | 'photo' | 'audio' | 'import';
  title: string;
  content: string;
  timestamp: string;
  tags: string[];
  is_pinned: boolean;
}

interface HomePageProps {
  onNavigate?: (page: string, itemId?: string) => void;
}

const typeIcons = {
  text: <FileText className="w-5 h-5 text-blue-500" />,
  photo: <ImageIcon className="w-5 h-5 text-green-500" />,
  audio: <Mic className="w-5 h-5 text-purple-500" />,
  import: <File className="w-5 h-5 text-orange-500" />
};

export function HomePage({ onNavigate }: HomePageProps) {
  const [data, setData] = useState<InfoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActing, setIsBulkActing] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  useEffect(() => {
    fetchData();
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSemanticSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, searchMode, doSemanticSearch]);

  const exitMultiSelect = () => {
    setIsMultiSelect(false);
    setSelectedIds(new Set());
    setShowBulkDeleteConfirm(false);
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: capturedInfo, error } = await supabase
        .from('captured_info')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (capturedInfo) {
        const formattedData: InfoCard[] = capturedInfo.map(item => ({
          id: item.id,
          type: item.type as any,
          title: item.title,
          content: item.content || item.summary || '',
          timestamp: new Date(item.created_at).toLocaleString(),
          tags: item.tags || [],
          is_pinned: item.is_pinned || false
        }));
        setData(formattedData);
      }
    } catch (error) {
      console.error('获取数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = searchMode === 'keyword'
    ? data.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : data; // semantic mode uses semanticResults instead

  // 语义模式下，将 SearchResult 转为展示格式
  const displayData: Array<InfoCard & { similarity?: number }> = searchMode === 'semantic' && searchQuery.trim()
    ? semanticResults.map(r => ({
        id: r.id,
        type: r.type as InfoCard['type'],
        title: r.title,
        content: r.content || r.summary || '',
        timestamp: new Date(r.created_at).toLocaleString(),
        tags: r.tags || [],
        is_pinned: r.is_pinned || false,
        similarity: r.similarity,
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
        .map(url => url.split('captured-files/')[1])
        .filter(Boolean)
        .map(p => p.split('?')[0]);

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
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <p className="text-sm text-gray-500">正在加载数据...</p>
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
                      {item.similarity != null && (
                        <span className="flex-none px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium" style={{ borderRadius: '4px' }}>
                          {Math.round(item.similarity * 100)}%
                        </span>
                      )}
                    </div>
                    
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
