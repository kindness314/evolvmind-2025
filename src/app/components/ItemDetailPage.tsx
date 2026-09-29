import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Pin, Trash2, FileText, Image as ImageIcon, Mic, File, Sparkles, Loader2, AlertTriangle, Pencil, Save, X, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { cleanupCaptureRefs } from '../../lib/captureRefs';
import { retryCapturedItem } from '../../lib/process';

interface ItemDetailPageProps {
  itemId: string;
  onBack: () => void;
  onUpdate?: () => void;
}

interface ItemDetail {
  id: string;
  /** 'note' 为 O1 前的存量文字记录类型，与 'text' 同义展示 */
  type: 'text' | 'photo' | 'audio' | 'import' | 'note';
  title: string;
  content: string;
  summary: string;
  note: string | null;
  tags: string[];
  is_pinned: boolean;
  created_at: string;
  processing_status?: string;
  embedding_status?: string;
  graph_status?: string;
  processing_error?: string;
  /** O3: 文件生命周期 —— 存储对象路径与元数据；旧数据无此列时从 content 推导/回退 */
  storage_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
}

const typeIcons = {
  text: <FileText className="w-5 h-5 text-blue-500" />,
  note: <FileText className="w-5 h-5 text-blue-500" />,
  photo: <ImageIcon className="w-5 h-5 text-green-500" />,
  audio: <Mic className="w-5 h-5 text-purple-500" />,
  import: <File className="w-5 h-5 text-orange-500" />
};

const typeLabels = {
  text: '文字记录',
  note: '文字记录',
  photo: '拍照提取',
  audio: '录音转写',
  import: '导入文件'
};

export function ItemDetailPage({ itemId, onBack, onUpdate }: ItemDetailPageProps) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPinning, setIsPinning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // O3: 按 storage_path 动态生成 signed URL（60 分钟窗口，过期后重进详情会重新生成）；
  // 旧数据无 storage_path 时 content 本身就是旧 URL，直接回退使用
  const [fileUrl, setFileUrl] = useState<string | null>(null);
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
        .select('id,type,title,content,summary,note,tags,is_pinned,created_at,processing_status,graph_status,embedding_status,processing_error,storage_path,file_name,mime_type,file_size')
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

  useEffect(() => {
    let cancelled = false;
    const loadFileUrl = async () => {
      if (!item?.storage_path) {
        setFileUrl(null);
        return;
      }
      try {
        const { data, error } = await supabase.storage
          .from('captured-files')
          .createSignedUrl(item.storage_path, 60 * 60);
        if (!cancelled && !error && data?.signedUrl) setFileUrl(data.signedUrl);
      } catch {
        if (!cancelled) setFileUrl(null);
      }
    };
    void loadFileUrl();
    return () => {
      cancelled = true;
    };
  }, [item?.storage_path]);

  const handleRetryProcessing = async () => {
    if (!item) return;
    // O1: 统一重试入口 — 分析失败先重跑提取, 再补做图谱/向量
    try {
      await retryCapturedItem(item.id);
    } catch (e: unknown) {
      console.error('处理失败:', e);
      toast.error('处理失败，请稍后再试');
    }
    await fetchItemDetail();
  };

  const handleSaveEdit = async () => {
    if (!item || isSavingEdit) return;
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      toast.error('标题不能为空');
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
      toast.error('保存失败，请稍后重试');
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
      // O3: 删除优先使用 storage_path（content 已不再存 URL）；旧数据回退到 content 推导
      const legacyFilePath = item.content.startsWith('http')
        ? item.content.split('captured-files/')[1]?.split('?')[0]
        : null;
      const filePath = item.storage_path || legacyFilePath;
      if (filePath) {
        await supabase.storage.from('captured-files').remove([filePath]);
      }

      // 2. 删除数据库记录
      const { error } = await supabase
        .from('captured_info')
        .delete()
        .eq('id', item.id);

      if (error) throw error;
      // 同步清理节点/关系里的捕获 id 引用, 防止计数虚高(悬空引用)
      await cleanupCaptureRefs([item.id]);
      onUpdate?.();
      onBack();
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败，请稍后重试');
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
          className="px-6 py-2 bg-brand text-white text-sm rounded-lg"
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
          className="p-2 hover:bg-gray-100 transition-colors rounded-lg"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </motion.button>
        
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleTogglePin}
            disabled={isPinning}
            className={`p-2 transition-all ${item.is_pinned ? 'text-brand bg-brand-soft' : 'text-gray-400 hover:bg-gray-100'} rounded-lg`}
            title={item.is_pinned ? '取消置顶' : '置顶'}
          >
            {isPinning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Pin className={`w-5 h-5 ${item.is_pinned ? 'fill-brand' : ''}`} />}
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setDraftTitle(item.title || '');
              setDraftNote(item.note || '');
              setShowEdit(true);
            }}
            disabled={isDeleting || isSavingEdit}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all rounded-lg"
            title="编辑"
          >
            <Pencil className="w-5 h-5" />
          </motion.button>
          
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
            className="p-2 text-gray-400 hover:text-danger hover:bg-red-50 transition-all rounded-lg"
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
              <div className="mt-3 p-3 bg-card border border-gray-100 flex items-center gap-2 flex-wrap rounded-xl shadow-card">
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
                        <AlertTriangle className="w-4 h-4 text-danger" />
                        <span className="text-xs text-danger">处理失败</span>
                        {item.processing_error && (
                          <span className="text-[11px] text-danger/80 break-all flex-1 min-w-0">{item.processing_error}</span>
                        )}
                        {showAction && (
                          <button
                            onClick={handleRetryProcessing}
                            className="flex-none px-2 py-1 bg-danger text-white text-xs hover:bg-danger/90 transition-colors rounded-lg"
                          >
                            重试
                          </button>
                        )}
                        {!showAction && recoverOnly && (
                          <button
                            onClick={handleRetryProcessing}
                            className="flex-none px-2 py-1 bg-warning text-white text-xs hover:bg-warning/90 transition-colors rounded-lg"
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
                        <Loader2 className="w-4 h-4 text-brand animate-spin" />
                        <span className="text-xs text-brand-strong">处理中</span>
                        {showAction && (
                          <button
                            onClick={handleRetryProcessing}
                            className="flex-none px-2 py-1 bg-brand text-white text-xs hover:bg-brand-strong transition-colors rounded-lg"
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
                        <Check className="w-4 h-4 text-success" />
                        <span className="text-xs text-success">已完成</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <span className="text-xs text-gray-500">待处理</span>
                      <button
                        onClick={handleRetryProcessing}
                        className="flex-none px-2 py-1 bg-gray-600 text-white text-xs hover:bg-gray-700 transition-colors rounded-lg"
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
          {item.type === 'photo' && (fileUrl || item.content.startsWith('http')) && (
            <div className="mb-6 rounded overflow-hidden border border-gray-100 shadow-sm bg-gray-50">
              <img src={fileUrl ?? item.content} alt={item.title} className="w-full h-auto object-contain max-h-96 mx-auto" />
            </div>
          )}
          
          {item.type === 'audio' && (fileUrl || item.content.startsWith('http')) && (
            <div className="mb-6 p-4 bg-gray-50 border border-gray-100 rounded-xl">
              <audio controls className="w-full h-10">
                <source src={fileUrl ?? item.content} />
                <span className="text-xs text-gray-500">音频文件：{item.file_name || '播放中...'}</span>
              </audio>
            </div>
          )}

          {/* AI 摘要 */}
          {item.summary && (
            <div className="mb-8 p-4 bg-brand-soft border-l-4 border-brand rounded-r-xl">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-brand" />
                <span className="text-xs font-bold text-brand-strong uppercase tracking-wider">AI 智能摘要</span>
              </div>
              <p className="text-sm text-brand-strong leading-relaxed">{item.summary}</p>
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
              {item.type === 'text' || item.type === 'note'
                ? item.content
                : `[${typeLabels[item.type]}] ${item.file_name || item.content.split('/').pop()?.split('?')[0]}`}
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
                    className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full"
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
              className="relative w-full max-w-xs bg-white p-6 shadow-float rounded-2xl"
            >
              <div className="flex items-center gap-3 mb-4 text-danger">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="text-lg font-bold">确认删除</h3>
              </div>
              <p className="text-sm text-gray-600 mb-6">
                您确定要永久删除这条信息吗？相关的云端文件也将被同步移除。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    handleDelete();
                  }}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 bg-danger text-white text-sm font-medium hover:bg-danger/90 transition-colors flex items-center justify-center gap-2 rounded-lg"
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
              className="relative w-full max-w-sm bg-white p-6 shadow-float rounded-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Pencil className="w-5 h-5 text-brand" />
                  <h3 className="text-base font-bold text-gray-900">编辑信息</h3>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowEdit(false)}
                  className="p-2 hover:bg-gray-100 transition-colors rounded-lg"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </motion.button>
              </div>

              <div className="mb-4">
                <label className="block text-xs text-gray-600 mb-1">标题</label>
                <input
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                />
              </div>

              <div className="mb-6">
                <label className="block text-xs text-gray-600 mb-1">备注</label>
                <textarea
                  value={draftNote}
                  onChange={e => setDraftNote(e.target.value)}
                  rows={4}
                  placeholder="添加你的备注..."
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowEdit(false)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="flex-1 px-4 py-2.5 bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors flex items-center justify-center gap-2 disabled:bg-blue-300 rounded-lg"
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
