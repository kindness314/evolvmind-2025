import { Type, Camera, Mic, FileUp, Save, X, Loader2, Play, Pause, Trash2, Sparkles, CheckCircle2, ArrowRight, Home, Share2, FileText, AlertCircle } from 'lucide-react';
import { useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { extractInformation } from '../../lib/ai';
import { buildKnowledgeGraphFromContent, checkGraphSetup } from '../../lib/graph';
import { generateEmbeddingForRow } from '../../lib/search';
import { updateProcessingFields } from '../../lib/processing';
import { motion } from 'motion/react';

type CaptureMode = 'text' | 'photo' | 'audio' | 'import' | null;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt', 'md']);

function isSupportedFile(file: File, mode: CaptureMode): boolean {
  if (mode === 'photo') return file.type.startsWith('image/');
  if (mode === 'audio') return file.type.startsWith('audio/');
  if (mode === 'import') {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    return ALLOWED_DOCUMENT_EXTENSIONS.has(extension);
  }
  return false;
}

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
}

export function CapturePage({ onNavigate }: CapturePageProps) {
  const [mode, setMode] = useState<CaptureMode>(null);
  const [textInput, setTextInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [extractedData, setExtractedData] = useState({
    title: '智能提取标题',
    keywords: ['关键词1', '关键词2', '关键词3'],
    summary: '这里显示AI提取的摘要内容...'
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // P0: 捕获结果状态
  const [savedItem, setSavedItem] = useState<SavedItem | null>(null);
  const [graphStatus, setGraphStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [graphResult, setGraphResult] = useState<GraphProcessResult | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);

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
    setPreviewUrl(url);
    setExtractedData({
      title: selectedFile.name.split('.')[0],
      keywords: [selectedFile.type.split('/')[0] || '文件', '新导入'],
      summary: `成功导入了 ${selectedFile.name}，点击下方按钮开始 AI 智能分析内容...`
    });
  };

  const handleAnalyze = async () => {
    let contentToAnalyze = '';
    
    if (mode === 'text') {
      contentToAnalyze = textInput;
    } else if (file) {
      contentToAnalyze = `文件名: ${file.name}\n文件类型: ${file.type}\n文件大小: ${file.size} bytes`;
      // 注意：这里由于没有实际的 OCR 或音频转录后端，我们只分析文件元数据。
      // 在实际项目中，应先调用 OCR/ASR 接口获取文本。
    }

    if (!contentToAnalyze) return;

    setIsAnalyzing(true);
    try {
      const result = await extractInformation(contentToAnalyze);
      setExtractedData(result);
    } catch (error) {
      console.error('AI 分析失败:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (file && (file.size > MAX_FILE_SIZE || !isSupportedFile(file, mode))) {
      alert('文件无效：大小必须不超过 10MB，且类型必须受支持');
      return;
    }
    if (!mode) return;

    setIsSaving(true);
    try {
      let finalContent = textInput;

      // Storage 路径首段必须是当前用户 scope；Demo 使用固定 scope。
      if (file) {
        const fileExt = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const { data: { user } } = await supabase.auth.getUser();
        const scopeId = user?.id || '00000000-0000-0000-0000-000000000000';
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
        const filePath = `${scopeId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('captured-files')
          .upload(filePath, file);

        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from('captured-files')
          .createSignedUrl(filePath, 60 * 60);
        if (signedUrlError || !signedUrlData?.signedUrl) throw signedUrlError || new Error('无法生成文件访问链接');
        finalContent = signedUrlData.signedUrl;

      }

      const { data, error } = await supabase
        .from('captured_info')
        .insert({
        type: mode,
        title: extractedData.title,
        content: finalContent,
        tags: extractedData.keywords,
        summary: extractedData.summary,
        processing_status: 'processing',
        embedding_status: 'pending',
        graph_status: 'pending'
        })
        .select('id')
        .single();

      if (error) throw error;

      // 记录保存结果
      const itemId = data?.id;
      setSavedItem({
        id: itemId || '',
        title: extractedData.title,
        summary: extractedData.summary,
        keywords: extractedData.keywords,
      });

      // fire-and-forget: 为新记录生成 embedding 向量
      if (itemId) {
        generateEmbeddingForRow(itemId);
      }

      // 启动知识图谱构建并追踪状态
      const contentForGraph =
        mode === 'text'
          ? textInput
          : `标题: ${extractedData.title}\n摘要: ${extractedData.summary}\n关键词: ${extractedData.keywords.join(', ')}\n资源: ${finalContent}`;

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
            await updateProcessingFields({ id: itemId, graph_status: 'error', processing_status: 'error', processing_error: msg });
            return;
          }
          if (!setup.llmOk) {
            setGraphError('LLM 未配置');
            setGraphStatus('error');
            await updateProcessingFields({ id: itemId, graph_status: 'error', processing_status: 'error', processing_error: 'LLM 未配置' });
            return;
          }
          const result = await buildKnowledgeGraphFromContent({ content: contentForGraph, capturedId: itemId });
          setGraphResult(result);
          setGraphStatus('done');
          await updateProcessingFields({ id: itemId, graph_status: 'done', processing_status: 'done', processed_at: new Date().toISOString() });
        } catch (e: any) {
          console.error('知识图谱更新失败:', e);
          const msg = e.message || '图谱构建失败';
          setGraphError(msg);
          setGraphStatus('error');
          try {
            await updateProcessingFields({ id: itemId, graph_status: 'error', processing_status: 'error', processing_error: msg });
          } catch {
            // 状态写入失败不影响页面反馈
          }
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
              <div className="w-16 h-16 bg-green-500 flex items-center justify-center mb-4" style={{ borderRadius: '4px' }}>
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
              className="mx-4 mb-4 p-4 bg-blue-50 border-l-4 border-blue-500" style={{ borderRadius: '0 4px 4px 0' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-blue-600">AI 智能摘要</span>
              </div>
              <h3 className="text-base font-medium text-gray-900 mb-2">{savedItem.title}</h3>
              <p className="text-sm text-blue-800 leading-relaxed mb-3">{savedItem.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {savedItem.keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-0.5 bg-white text-blue-600 text-xs border border-blue-200" style={{ borderRadius: '4px' }}>#{kw}</span>
                ))}
              </div>
            </motion.div>

            {/* 知识图谱处理状态 */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="mx-4 mb-4 p-4 bg-white border border-gray-200" style={{ borderRadius: '4px' }}
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
                    <div className="p-3 bg-gray-50 text-center" style={{ borderRadius: '4px' }}>
                      <p className="text-xl font-medium text-gray-900">{graphResult.nodesProcessed}</p>
                      <p className="text-xs text-gray-500">处理节点</p>
                    </div>
                    <div className="p-3 bg-gray-50 text-center" style={{ borderRadius: '4px' }}>
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
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                style={{ borderRadius: '4px' }}
              >
                <Home className="w-4 h-4" />
                返回首页
              </button>
              <button
                onClick={() => savedItem.id && onNavigate?.('item-detail', savedItem.id)}
                className="flex-1 px-4 py-2.5 bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                style={{ borderRadius: '4px' }}
              >
                <FileText className="w-4 h-4" />
                查看详情
              </button>
            </div>
            <button
              onClick={() => onNavigate?.('knowledge')}
              className="w-full px-4 py-2.5 bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors flex items-center justify-center gap-2 border border-purple-200"
              style={{ borderRadius: '4px' }}
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
                  className={`${option.color} p-8 flex flex-col items-center gap-3 border border-gray-200 transition-colors`}
                  style={{ borderRadius: '4px' }}
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
              className="p-2 hover:bg-gray-100 transition-colors"
              style={{ borderRadius: '4px' }}
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
              className="px-4 py-2 bg-blue-500 text-white text-sm hover:bg-blue-600 transition-colors flex items-center gap-2 disabled:bg-blue-300"
              style={{ borderRadius: '4px' }}
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
                className="w-full h-48 p-4 border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                style={{ borderRadius: '4px' }}
              />
            )}

            {mode === 'photo' && (
              <div className="w-full min-h-64 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center bg-gray-50 overflow-hidden"
                style={{ borderRadius: '4px' }}
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
              <div className="w-full h-64 border border-gray-200 flex flex-col items-center justify-center bg-gray-50"
                style={{ borderRadius: '4px' }}
              >
                {previewUrl ? (
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 bg-blue-500 flex items-center justify-center mb-4 cursor-pointer"
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
              <div className="w-full h-64 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center bg-gray-50 text-gray-400"
                style={{ borderRadius: '4px' }}
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
              <div className="mt-4 p-4 bg-gray-50 border border-gray-200"
                style={{ borderRadius: '4px' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-900">提取结果预览</h4>
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || (!textInput && !file)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 text-xs hover:bg-purple-200 transition-colors disabled:opacity-50"
                    style={{ borderRadius: '4px' }}
                  >
                    {isAnalyzing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {isAnalyzing ? '分析中...' : 'AI 智能提取'}
                  </button>
                </div>
                
                <div className="mb-3">
                  <label className="text-xs text-gray-600 mb-1 block">标题</label>
                  <input
                    type="text"
                    value={extractedData.title}
                    onChange={(e) => setExtractedData({...extractedData, title: e.target.value})}
                    className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ borderRadius: '4px' }}
                  />
                </div>

                <div className="mb-3">
                  <label className="text-xs text-gray-600 mb-1 block">关键词</label>
                  <div className="flex flex-wrap gap-2">
                    {extractedData.keywords.map((keyword, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-blue-100 text-blue-700 text-xs"
                        style={{ borderRadius: '4px' }}
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
