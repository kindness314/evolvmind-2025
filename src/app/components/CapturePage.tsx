import { Type, Camera, Mic, FileUp, Save, X, Loader2, Play, Pause, Trash2, Sparkles, CheckCircle2, ArrowRight, Home, Share2, FileText, AlertCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { extractInformation } from '../../lib/ai';
import { buildKnowledgeGraphFromContent, checkGraphSetup, stringifyError } from '../../lib/graph';
import { generateEmbeddingForRow } from '../../lib/search';
import { analyzeAndPersist } from '../../lib/process';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { MAX_FILE_SIZE, isSupportedFile, type CaptureMode } from '../../lib/uploadValidation';


interface GraphProcessResult {
  nodesProcessed: number;
  linksProcessed: number;
  linksInserted: number;
  linksUpdated: number;
}

interface SavedItem {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
}

interface CapturePageProps {
  onNavigate?: (page: string, itemId?: string) => void;
  /** 捕获页当前是否可见: 处理完成自动回数据页时, 用户已离开则不再跳转 */
  active?: boolean;
}

export function CapturePage({ onNavigate, active }: CapturePageProps) {
  const [mode, setMode] = useState<CaptureMode>(null);
  const [textInput, setTextInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [extractedData, setExtractedData] = useState({
    title: '',
    keywords: [] as string[],
    summary: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // P0: 捕获结果状态
  const [savedItem, setSavedItem] = useState<SavedItem | null>(null);
  const [graphStatus, setGraphStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [graphResult, setGraphResult] = useState<GraphProcessResult | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const persistGraphStatus = async (itemId: string, status: 'completed' | 'failed', errorMessage?: string) => {
    if (!itemId) return;
    if (status === 'completed') {
      const patch: Record<string, unknown> = { graph_status: 'completed', processed_at: new Date().toISOString() };
      // O1: 成功只更新 graph_status; 若 embedding 也已 completed 则整体完成,
      // 避免 processing_status 永远停在 'processing'
      const { data: cur } = await supabase
        .from('captured_info')
        .select('embedding_status, processing_status')
        .eq('id', itemId)
        .single();
      if (cur && cur.embedding_status === 'completed') {
        patch.processing_status = 'completed';
      }
      await supabase.from('captured_info').update(patch).eq('id', itemId);
      return;
    }
    const patch: Record<string, string | null> = {
      graph_status: 'failed',
      processing_status: 'failed',
    };
    if (errorMessage) {
      patch.processing_error = `graph: ${errorMessage.slice(0, 500)}`;
    }
    await supabase.from('captured_info').update(patch).eq('id', itemId);
  };

  // 处理完成追踪: 图谱与向量均结束且无失败时, 若用户仍在捕获页, 自动回到首页
  const graphSettledRef = useRef(false);
  const embedSettledRef = useRef(false);
  const graphFailedRef = useRef(false);
  const embedFailedRef = useRef(false);
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = !!active;
  }, [active]);

  const tryAutoReturnData = () => {
    if (!graphSettledRef.current || !embedSettledRef.current) return;
    if (graphFailedRef.current || embedFailedRef.current) return;
    if (!activeRef.current) return;
    // 短暂停留让用户看到"处理完成"面板, 再自动回数据页; 并重置捕获页便于下次使用
    window.setTimeout(() => {
      onNavigate?.('data');
      setSavedItem(null);
      setGraphStatus('idle');
      setGraphResult(null);
      setGraphError(null);
      setMode(null);
      setTextInput('');
      setFile(null);
      setPreviewUrl(null);
      setExtractedData({ title: '', keywords: [], summary: '' });
    }, 800);
  };


  const captureOptions = [
    { id: 'text', icon: Type, label: '文字', color: 'bg-blue-50 hover:bg-blue-100', accept: '' },
    { id: 'photo', icon: Camera, label: '拍照', color: 'bg-green-50 hover:bg-green-100', accept: 'image/*' },
    { id: 'audio', icon: Mic, label: '录音', color: 'bg-purple-50 hover:bg-purple-100', accept: 'audio/*' },
    { id: 'import', icon: FileUp, label: '导入', color: 'bg-orange-50 hover:bg-orange-100', accept: '.pdf,.doc,.docx,.txt,.md' }
  ];

  const handleCapture = (captureMode: CaptureMode) => {
    setMode(captureMode);
    if (captureMode !== 'text' && captureMode !== null) {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 100);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    if (selectedFile.size > MAX_FILE_SIZE) {
      alert('文件大小不能超过 10MB');
      e.target.value = '';
      return;
    }
    if (!isSupportedFile(selectedFile, mode)) {
      alert('不支持的文件类型');
      e.target.value = '';
      return;
    }
    if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setAnalyzeError(null);
    setPreviewUrl(url);
    setExtractedData({
      title: selectedFile.name.split('.')[0],
      keywords: [selectedFile.type.split('/')[0] || '文件', '新导入'],
      summary: `成功导入了 ${selectedFile.name}，保存时将自动提取标题、关键词与摘要。`
    });
  };

  // O1: 标题/关键词/摘要提取已改为保存时自动执行(见 handleSave -> analyzeAndPersist), 不再手动触发
  const handleSave = async () => {
    if (file && (file.size > MAX_FILE_SIZE || !isSupportedFile(file, mode))) {
      alert('文件无效：大小必须不超过 10MB，且类型必须受支持');
      return;
    }
    if (!mode) return;

    setIsSaving(true);
    try {
      let finalContent = textInput;
      let storageMeta: { storage_path?: string; file_name?: string; mime_type?: string | null; file_size?: number } = {};

      // Storage 路径首段必须是当前用户 scope；Demo 使用固定 scope。
      // O3: content 不再存临时 signed URL（60 分钟过期后不可访问），
      // 改存 storage_path 元数据，展示时动态生成 signed URL；存量旧行 content 仍是 URL（读取侧兼容）。
      if (file) {
        const fileExt = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const { data: { user } } = await supabase.auth.getUser();
        const scopeId = user?.id || '00000000-0000-0000-0000-000000000000';
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
        const filePath = `${scopeId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('captured-files')
          .upload(filePath, file);
        if (uploadError) throw uploadError;

        finalContent = `文件名: ${file.name}\n文件类型: ${file.type || '未知'}\n文件大小: ${file.size} bytes`;
        storageMeta = {
          storage_path: filePath,
          file_name: file.name,
          mime_type: file.type || null,
          file_size: file.size,
        };
      }
      // O1: 初始状态: 子步骤 pending, 保存后自动分析再推进; 原文先保存(不变量)
      const initialTitle = file
        ? file.name.split('.')[0]
        : (textInput.trim().slice(0, 30) || '未命名');
      const { data, error } = await supabase
        .from('captured_info')
        .insert({
          type: mode,
          title: extractedData.title.trim() || initialTitle,
          content: finalContent,
          tags: [],
          summary: '',
          processing_status: 'processing',
          graph_status: 'pending',
          embedding_status: 'pending',
          ...storageMeta,
        })
        .select('id')
        .single();

      if (error) throw error;
      const itemId = data?.id;
      if (!itemId) throw new Error('保存失败: 未返回记录 ID');
      // 通知数据页立即增量同步, 避免新数据等 30s 轮询才出现
      window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));

      // O1: 保存后自动提取标题/关键词/摘要(不再手动触发), 成败并入处理状态
      const contentToAnalyze =
        mode === 'text'
          ? textInput
          : `文件名: ${file?.name || ''}\n文件类型: ${file?.type || ''}\n文件大小: ${file?.size || 0} bytes`;
      setAnalyzeError(null);
      const outcome = await analyzeAndPersist(itemId, contentToAnalyze);
      if (!outcome.ok) {
        const msg = outcome.error || '内容分析失败';
        setAnalyzeError(msg);
        toast.error('内容分析失败', { description: msg });
        // 内容已安全保存; 分析失败 -> 行已标 failed, 首页/详情页可"重试"重跑提取
        setSavedItem({
          id: itemId,
          title: extractedData.title.trim() || initialTitle,
          summary: '内容已保存, 但自动提取标题/摘要失败。可在首页对该记录点击"重试"重新提取。',
          keywords: [],
        });
        setGraphError(msg);
        setGraphStatus('error');
        return;
      }

      // 分析成功: 更新预览与结果卡
      setExtractedData({ title: outcome.title, keywords: outcome.keywords, summary: outcome.summary });
      setSavedItem({
        id: itemId,
        title: outcome.title,
        summary: outcome.summary,
        keywords: outcome.keywords,
      });

      // fire-and-forget: 为新记录生成 embedding 向量; 失败已在函数内落 failed;
      // 无论成败都通知数据页增量刷新, 并参与"全部完成自动回数据页"判定
      void generateEmbeddingForRow(itemId)
        .then(() => {
          embedSettledRef.current = true;
          embedFailedRef.current = false;
          window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));
          tryAutoReturnData();
        })
        .catch(() => {
          embedSettledRef.current = true;
          embedFailedRef.current = true;
          toast.error('向量生成失败，可在数据页重试');
          window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));
        });

      // 启动知识图谱构建并追踪状态
      const contentForGraph =
        mode === 'text'
          ? textInput
          : `标题: ${outcome.title}\n摘要: ${outcome.summary}\n关键词: ${outcome.keywords.join(', ')}\n资源: ${finalContent}`;

      setGraphStatus('processing');

      (async () => {
        try {
          const setup = await checkGraphSetup();
          if (!setup.schemaOk) {
            const msg = setup.schemaError?.toLowerCase().includes('invalid api key')
              ? 'Supabase 连接配置错误'
              : '数据库未应用图谱迁移';
            setGraphError(msg);
            setGraphStatus('error');
            await persistGraphStatus(itemId, 'failed', msg);
            graphFailedRef.current = true;
            return;
          }
          if (!setup.llmOk) {
            const msg = 'LLM 未配置';
            setGraphError(msg);
            setGraphStatus('error');
            await persistGraphStatus(itemId, 'failed', msg);
            graphFailedRef.current = true;
            return;
          }
          const result = await buildKnowledgeGraphFromContent({ content: contentForGraph, capturedId: itemId });
          setGraphResult(result);
          setGraphStatus('done');
          await persistGraphStatus(itemId, 'completed');
          graphSettledRef.current = true;
          graphFailedRef.current = false;
        } catch (e: unknown) {
          console.error('知识图谱更新失败:', e);
          const msg = stringifyError(e);
          setGraphError(msg);
          setGraphStatus('error');
          await persistGraphStatus(itemId, 'failed', msg);
          graphSettledRef.current = true;
          graphFailedRef.current = true;
        } finally {
          // 无论成功失败: 通知数据页增量刷新, 并尝试自动回数据页
          window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));
          tryAutoReturnData();
        }
      })();
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setMode(null);
    setTextInput('');
    setFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    // 重置 P0 结果状态
    setSavedItem(null);
    setGraphStatus('idle');
    setGraphResult(null);
    setGraphError(null);
    setAnalyzeError(null);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {savedItem ? (
        // P0: 捕获完成结果卡片
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {/* 成功标识 */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
              className="flex flex-col items-center pt-10 pb-6"
            >
              <div className="w-16 h-16 bg-success flex items-center justify-center mb-4 rounded-2xl shadow-card">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-lg font-medium text-gray-900">保存成功</h2>
              <p className="text-sm text-gray-500 mt-1">内容已保存，正在构建知识图谱...</p>
            </motion.div>

            {/* AI 提取结果摘要 */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mx-4 mb-4 p-4 bg-brand-soft border-l-4 border-brand rounded-r-xl"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-brand" />
                <span className="text-xs font-bold text-brand-strong">AI 智能摘要</span>
              </div>
              <h3 className="text-base font-medium text-gray-900 mb-2">{savedItem.title}</h3>
              <p className="text-sm text-brand-strong leading-relaxed mb-3">{savedItem.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {savedItem.keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-0.5 bg-white text-brand-strong text-xs border border-brand-200 rounded-lg">#{kw}</span>
                ))}
              </div>
            </motion.div>

            {/* 知识图谱处理状态 */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="mx-4 mb-4 p-4 bg-card border border-gray-100 rounded-xl shadow-card"
            >
              <div className="flex items-center gap-2 mb-3">
                <Share2 className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-medium text-gray-700">知识图谱</span>
              </div>

              {graphStatus === 'processing' && (
                <div className="flex items-center gap-2 text-sm text-purple-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在分析内容并构建知识节点与关系...</span>
                </div>
              )}

              {graphStatus === 'done' && graphResult && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>知识图谱更新完成</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-gray-50 text-center rounded-lg">
                      <p className="text-xl font-medium text-gray-900">{graphResult.nodesProcessed}</p>
                      <p className="text-xs text-gray-500">处理节点</p>
                    </div>
                    <div className="p-3 bg-gray-50 text-center rounded-lg">
                      <p className="text-xl font-medium text-gray-900">{graphResult.linksInserted}</p>
                      <p className="text-xs text-gray-500">新增关系</p>
                    </div>
                  </div>
                </div>
              )}

              {graphStatus === 'error' && (
                <div className="flex items-start gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-none mt-0.5" />
                  <div>
                    <p className="text-amber-700 font-medium">图谱构建未完成</p>
                    <p className="text-amber-600 text-xs mt-0.5">{graphError || '未知错误'}</p>
                    <p className="text-gray-500 text-xs mt-1">内容已安全保存，图谱可在之后重新生成。</p>
                  </div>
                </div>
              )}

              {graphStatus === 'idle' && (
                <p className="text-sm text-gray-400">等待图谱构建...</p>
              )}
            </motion.div>
          </div>

          {/* 底部操作按钮 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="flex-none px-4 py-4 border-t border-gray-200 space-y-2"
          >
            <div className="flex gap-2">
              <button
                onClick={() => onNavigate?.('home')}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 rounded-lg"
              >
                <Home className="w-4 h-4" />
                返回首页
              </button>
              <button
                onClick={() => savedItem.id && onNavigate?.('item-detail', savedItem.id)}
                className="flex-1 px-4 py-2.5 bg-brand text-white text-sm font-medium hover:bg-brand-strong transition-colors flex items-center justify-center gap-2 rounded-lg shadow-card"
              >
                <FileText className="w-4 h-4" />
                查看详情
              </button>
            </div>
            <button
              onClick={() => onNavigate?.('knowledge')}
              className="w-full px-4 py-2.5 bg-ai-soft text-ai text-sm font-medium hover:brightness-95 transition-all flex items-center justify-center gap-2 border border-ai/20 rounded-lg"
            >
              <Share2 className="w-4 h-4" />
              查看知识图谱
            </button>
          </motion.div>
        </div>
      ) : mode === null ? (
        // 选择捕获模式
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <h2 className="text-xl font-medium text-gray-900 mb-8">选择捕获方式</h2>
          <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
            {captureOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  onClick={() => handleCapture(option.id as CaptureMode)}
                  className={`${option.color} p-8 flex flex-col items-center gap-3 border border-gray-100 transition-all hover:-translate-y-0.5 hover:shadow-card rounded-2xl`}
                >
                  <Icon className="w-8 h-8 text-gray-700" />
                  <span className="text-sm font-medium text-gray-700">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        // 捕获界面
        <div className="flex-1 flex flex-col">
          {/* 顶部操作栏 */}
          <div className="flex-none px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-100 transition-colors rounded-lg"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
            <h3 className="text-sm font-medium text-gray-900">
              {mode === 'text' && '文字输入'}
              {mode === 'photo' && '拍照识别'}
              {mode === 'audio' && '录音转写'}
              {mode === 'import' && '导入文件'}
            </h3>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-brand text-white text-sm hover:bg-brand-strong transition-colors flex items-center gap-2 disabled:bg-blue-300 rounded-lg"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </div>

          {/* 输入区域 */}
          <div className="flex-1 overflow-y-auto p-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept={captureOptions.find(o => o.id === mode)?.accept}
              className="hidden"
            />

            {mode === 'text' && (
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="输入或粘贴文本内容..."
                className="w-full h-48 p-4 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent rounded-xl"
              />
            )}

            {mode === 'photo' && (
              <div className="w-full min-h-64 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center bg-gray-50 overflow-hidden rounded-2xl"
                onClick={() => fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" className="w-full h-auto object-contain max-h-96" />
                ) : (
                  <>
                    <Camera className="w-12 h-12 mb-2 text-gray-400" />
                    <p className="text-sm text-gray-400">点击上传照片</p>
                  </>
                )}
              </div>
            )}

            {mode === 'audio' && (
              <div className="w-full h-64 border border-gray-200 flex flex-col items-center justify-center bg-gray-50 rounded-2xl"
              >
                {previewUrl ? (
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 bg-brand flex items-center justify-center mb-4 cursor-pointer"
                      style={{ borderRadius: '50%' }}
                    >
                      <Play className="w-8 h-8 text-white" />
                    </div>
                    <p className="text-sm text-gray-600">音频已就绪: {file?.name}</p>
                    <button 
                      onClick={() => { setFile(null); setPreviewUrl(null); }}
                      className="mt-4 text-xs text-red-500 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> 重新录制
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-red-500 flex items-center justify-center mb-4 animate-pulse cursor-pointer"
                      style={{ borderRadius: '50%' }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Mic className="w-8 h-8 text-white" />
                    </div>
                    <p className="text-sm text-gray-600">点击上传录音文件</p>
                  </>
                )}
              </div>
            )}

            {mode === 'import' && (
              <div className="w-full h-64 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center bg-gray-50 text-gray-400 rounded-2xl"
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div className="text-center p-4">
                    <FileUp className="w-12 h-12 mb-2 mx-auto text-blue-500" />
                    <p className="text-sm text-gray-900 font-medium">{file.name}</p>
                    <p className="text-xs mt-1">文件大小: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <>
                    <FileUp className="w-12 h-12 mb-2" />
                    <p className="text-sm">点击或拖拽文件到此处</p>
                    <p className="text-xs mt-1">支持 PDF, DOC, TXT, MD 等格式</p>
                  </>
                )}
              </div>
            )}

            {/* 实时预览提取结果 */}
            {(textInput || file) && (
              <div className="mt-4 p-4 bg-gray-50 border border-gray-100 rounded-xl"
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-900">提取结果预览</h4>
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-ai-soft text-ai text-xs rounded-full">
                    <Sparkles className="w-3 h-3" />
                    保存时自动提取
                  </span>
                </div>
                
                <div className="mb-3">
                  <label className="text-xs text-gray-600 mb-1 block">标题</label>
                  <input
                    type="text"
                    value={extractedData.title}
                    onChange={(e) => setExtractedData({...extractedData, title: e.target.value})}
                    className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                  />
                </div>

                <div className="mb-3">
                  <label className="text-xs text-gray-600 mb-1 block">关键词</label>
                  <div className="flex flex-wrap gap-2">
                    {extractedData.keywords.map((keyword, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-brand-soft text-brand-strong text-xs rounded-lg"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-600 mb-1 block">摘要</label>
                  <p className="text-sm text-gray-700">{extractedData.summary}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
