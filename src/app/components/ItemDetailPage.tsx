import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Pin, Trash2, FileText, Image as ImageIcon, Mic, File, Sparkles, Loader2, AlertTriangle, Pencil, Save, X, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { retryCapturedItem } from '../../lib/process';

interface ItemDetailPageProps {
  itemId: string;
  onBack: () => void;
  onUpdate?: () => void;
}

interface ItemDetail {
  id: string;
  type: 'text' | 'photo' | 'audio' | 'import';
  title: string;
  content: string;
  tags: string[];
  summary: string;
  note: string | null;
  created_at: string;
  is_pinned: boolean;
  /** O1 处理状态; 存量数据为 undefined */
  processing_status?: string;
  embedding_status?: string;
  graph_status?: string;
  processing_error?: string;
}

const typeIcons = {
  text: <FileText className="w-5 h-5 text-blue-500" />,
  photo: <ImageIcon className="w-5 h-5 text-green-500" />,
  audio: <Mic className="w-5 h-5 text-purple-500" />,
  import: <File className="w-5 h-5 text-orange-500" />
};

const typeLabels = {
  text: '文字记录',
  photo: '拍照提取',
  audio: '录音转写',
  import: '导入文件'
};

export function ItemDetailPage({ itemId, onBack, onUpdate }: ItemDetailPageProps) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPinning, setIsPinning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    fetchItemDetail();
  }, [itemId]);

  const fetchItemDetail = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('captured_info')
        .select('*')
        .eq('id', itemId)
        .single();

      if (error) throw error;
      // O1 自愈: 子步骤全部 completed 但主状态仍 processing(旧代码遗留)→ 推进为 completed
      if (data && data.processing_status === 'processing' && data.graph_status === 'completed' && data.embedding_status === 'completed') {
        supabase
          .from('captured_info')
          .update({ processing_status: 'completed' })
          .eq('id', data.id)
          .then(() => {});
        data.processing_status = 'completed';
      }
      setItem(data);
      setDraftTitle(data.title || '');
      setDraftNote(data.note || '');
    } catch (error) {
      console.error('获取详情失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryProcessing = async () => {
    if (!item) return;
    // O1: 统一重试入口 — 分析失败先重跑提取, 再补做图谱/向量
    try {
      await retryCapturedItem(item.id);
    } catch (e: unknown) {
      console.error('处理失败:', e);
      alert('处理失败，请稍后再试');
    }
    await fetchItemDetail();
  };

  const handleSaveEdit = async () => {
    if (!item || isSavingEdit) return;
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      alert('标题不能为空');
      return;
    }
    setIsSavingEdit(true);
    try {
      const { error } = await supabase
        .from('captured_info')
        .update({ title: nextTitle, note: draftNote.trim() || null })
        .eq('id', item.id);

      if (error) throw error;
      setItem({ ...item, title: nextTitle, note: draftNote.trim() || null });
      setShowEdit(false);
      onUpdate?.();
    } catch (error) {
      console.error('保存编辑失败:', error);
      alert('保存失败，请稍后重试');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleTogglePin = async () => {
    if (!item || isPinning) return;
    setIsPinning(true);
    try {
      const newPinStatus = !item.is_pinned;
      const { error } = await supabase
        .from('captured_info')
        .update({ is_pinned: newPinStatus })
        .eq('id', item.id);

      if (error) throw error;
      setItem({ ...item, is_pinned: newPinStatus });
      onUpdate?.();
    } catch (error) {
      console.error('更新置顶状态失败:', error);
    } finally {
      setIsPinning(false);
    }
  };

  const handleDelete = async () => {
    if (!item || isDeleting) return;
    
    setIsDeleting(true);
    try {
      // 1. 如果是云端存储的文件，尝试从 Storage 删除 (可选，这里为简化主要删除数据库记录)
      if (item.content.startsWith('http')) {
        const filePath = item.content.split('captured-files/')[1]?.split('?')[0];
        if (filePath) {
          await supabase.storage.from('captured-files').remove([filePath]);
        }
      }

      // 2. 删除数据库记录
      const { error } = await supabase
        .from('captured_info')
        .delete()
        .eq('id', item.id);

      if (error) throw error;
      onUpdate?.();
      onBack();
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除失败，请稍后重试');
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
        <p className="text-sm text-gray-500">正在加载详情...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-white p-6 text-center">
        <p className="text-gray-500 mb-4">未找到该信息或已被删除</p>
        <button
          onClick={onBack}
          className="px-6 py-2 bg-blue-500 text-white text-sm"
          style={{ borderRadius: '4px' }}
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* 顶部操作栏 */}
      <header className="flex-none px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-white z-10">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onBack}
          className="p-2 hover:bg-gray-100 transition-colors"
          style={{ borderRadius: '4px' }}
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </motion.button>
        
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleTogglePin}
            disabled={isPinning}
            className={`p-2 transition-all ${item.is_pinned ? 'text-blue-500 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}
            style={{ borderRadius: '4px' }}
            title={item.is_pinned ? '取消置顶' : '置顶'}
          >
            {isPinning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Pin className={`w-5 h-5 ${item.is_pinned ? 'fill-blue-500' : ''}`} />}
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setDraftTitle(item.title || '');
              setDraftNote(item.note || '');
              setShowEdit(true);
            }}
            disabled={isDeleting || isSavingEdit}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
            style={{ borderRadius: '4px' }}
            title="编辑"
          >
            <Pencil className="w-5 h-5" />
          </motion.button>
          
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
            style={{ borderRadius: '4px' }}
            title="删除"
          >
            <Trash2 className="w-5 h-5" />
          </motion.button>
        </div>
      </header>

      {/* 详情内容区域 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* 标题和元数据 */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex-none">{typeIcons[item.type]}</span>
              <span className="text-xs text-gray-500">{typeLabels[item.type]}</span>
              <span className="text-xs text-gray-400 ml-auto">{new Date(item.created_at).toLocaleString()}</span>
            </div>
            {(item.processing_status || item.graph_status || item.embedding_status) && (
              <div className="mt-3 p-3 bg-gray-50 border border-gray-200 flex items-center gap-2 flex-wrap" style={{ borderRadius: '4px' }}>
                {(() => {
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
                    (!anyFailed && !anyProcessing && !allDone) ||
                    (anyProcessing && (graphActionable || embedActionable));
                  if (anyFailed) {
                    // 子步骤全 completed 但整体卡 failed(历史死锁行)→ 提供"恢复"入口
                    const recoverOnly = !graphActionable && !embedActionable;
                    return (
                      <>
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        <span className="text-xs text-red-700">处理失败</span>
                        {item.processing_error && (
                          <span className="text-[11px] text-red-500 break-all flex-1 min-w-0">{item.processing_error}</span>
                        )}
                        {showAction && (
                          <button
                            onClick={handleRetryProcessing}
                            className="flex-none px-2 py-1 bg-red-600 text-white text-xs hover:bg-red-700 transition-colors"
                            style={{ borderRadius: '4px' }}
                          >
                            重试
                          </button>
                        )}
                        {!showAction && recoverOnly && (
                          <button
                            onClick={handleRetryProcessing}
                            className="flex-none px-2 py-1 bg-amber-600 text-white text-xs hover:bg-amber-700 transition-colors"
                            style={{ borderRadius: '4px' }}
                          >
                            恢复
                          </button>
                        )}
                      </>
                    );
                  }
                  if (anyProcessing) {
                    return (
                      <>
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                        <span className="text-xs text-blue-700">处理中</span>
                        {showAction && (
                          <button
                            onClick={handleRetryProcessing}
                            className="flex-none px-2 py-1 bg-blue-600 text-white text-xs hover:bg-blue-700 transition-colors"
                            style={{ borderRadius: '4px' }}
                          >
                            补做
                          </button>
                        )}
                      </>
                    );
                  }
                  if (allDone) {
                    return (
                      <>
                        <Check className="w-4 h-4 text-green-600" />
                        <span className="text-xs text-green-700">已完成</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <span className="text-xs text-gray-500">待处理</span>
                      <button
                        onClick={handleRetryProcessing}
                        className="flex-none px-2 py-1 bg-gray-600 text-white text-xs hover:bg-gray-700 transition-colors"
                        style={{ borderRadius: '4px' }}
                      >
                        处理
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* 媒体预览 */}
          {item.type === 'photo' && item.content.startsWith('http') && (
            <div className="mb-6 rounded overflow-hidden border border-gray-100 shadow-sm bg-gray-50">
              <img src={item.content} alt={item.title} className="w-full h-auto object-contain max-h-96 mx-auto" />
            </div>
          )}
          
          {item.type === 'audio' && item.content.startsWith('http') && (
            <div className="mb-6 p-4 bg-gray-50 border border-gray-200" style={{ borderRadius: '4px' }}>
              <audio controls className="w-full h-10">
                <source src={item.content} />
                您的浏览器不支持音频播放。
              </audio>
            </div>
          )}

          {/* AI 摘要 */}
          {item.summary && (
            <div className="mb-8 p-4 bg-blue-50 border-l-4 border-blue-500" style={{ borderRadius: '0 4px 4px 0' }}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">AI 智能摘要</span>
              </div>
              <p className="text-sm text-blue-800 leading-relaxed">{item.summary}</p>
            </div>
          )}

          {/* 备注 */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-gray-900 mb-3 border-b border-gray-100 pb-2">备注</h3>
            <div className={`text-base leading-relaxed whitespace-pre-wrap ${item.note ? 'text-gray-700' : 'text-gray-400'}`}>
              {item.note ? item.note : '暂无备注'}
            </div>
          </div>

          {/* 正文内容 */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-gray-900 mb-3 border-b border-gray-100 pb-2">原始内容</h3>
            <div className="text-base text-gray-700 leading-relaxed whitespace-pre-wrap">
              {item.type === 'text' ? item.content : `[${typeLabels[item.type]}] ${item.content.split('/').pop()?.split('?')[0]}`}
            </div>
          </div>

          {/* 关键词标签 */}
          {item.tags && item.tags.length > 0 && (
            <div className="mb-10">
              <h3 className="text-sm font-bold text-gray-900 mb-3">知识关键词</h3>
              <div className="flex flex-wrap gap-2">
                {item.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium"
                    style={{ borderRadius: '4px' }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* 删除确认弹窗 */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xs bg-white p-6 shadow-2xl"
              style={{ borderRadius: '4px' }}
            >
              <div className="flex items-center gap-3 mb-4 text-red-500">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="text-lg font-bold">确认删除</h3>
              </div>
              <p className="text-sm text-gray-600 mb-6">
                您确定要永久删除这条信息吗？相关的云端文件也将被同步移除。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    handleDelete();
                  }}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                  style={{ borderRadius: '4px' }}
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  确认删除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 编辑弹窗 */}
      <AnimatePresence>
        {showEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEdit(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white p-6 shadow-2xl"
              style={{ borderRadius: '4px' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Pencil className="w-5 h-5 text-blue-500" />
                  <h3 className="text-base font-bold text-gray-900">编辑信息</h3>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowEdit(false)}
                  className="p-2 hover:bg-gray-100 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  <X className="w-4 h-4 text-gray-600" />
                </motion.button>
              </div>

              <div className="mb-4">
                <label className="block text-xs text-gray-600 mb-1">标题</label>
                <input
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ borderRadius: '4px' }}
                />
              </div>

              <div className="mb-6">
                <label className="block text-xs text-gray-600 mb-1">备注</label>
                <textarea
                  value={draftNote}
                  onChange={e => setDraftNote(e.target.value)}
                  rows={4}
                  placeholder="添加你的备注..."
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ borderRadius: '4px' }}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowEdit(false)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                  style={{ borderRadius: '4px' }}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="flex-1 px-4 py-2.5 bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 disabled:bg-blue-300"
                  style={{ borderRadius: '4px' }}
                >
                  {isSavingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
