import { Type, Camera, Mic, FileUp, Save, X, Loader2, Play, Pause, Trash2, Sparkles } from 'lucide-react';
import { useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { extractInformation } from '../../lib/ai';
import { buildKnowledgeGraphFromContent, checkGraphSetup } from '../../lib/graph';
import { generateEmbeddingForRow } from '../../lib/search';

type CaptureMode = 'text' | 'photo' | 'audio' | 'import' | null;

export function CapturePage() {
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

  const captureOptions = [
    { id: 'text', icon: Type, label: '文字', color: 'bg-blue-50 hover:bg-blue-100', accept: '' },
    { id: 'photo', icon: Camera, label: '拍照', color: 'bg-green-50 hover:bg-green-100', accept: 'image/*' },
    { id: 'audio', icon: Mic, label: '录音', color: 'bg-purple-50 hover:bg-purple-100', accept: 'audio/*' },
    { id: 'import', icon: FileUp, label: '导入', color: 'bg-orange-50 hover:bg-orange-100', accept: '.pdf,.doc,.docx,.txt,.md' }
  ];

  const handleCapture = (captureMode: CaptureMode) => {
    setMode(captureMode);
    if (captureMode !== 'text' && captureMode !== null) {
      // 延迟触发，确保 DOM 更新
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 100);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      
      // 预设基础信息，等待 AI 分析
      setExtractedData({
        title: selectedFile.name.split('.')[0],
        keywords: [selectedFile.type.split('/')[0], '新导入'],
        summary: `成功导入了 ${selectedFile.name}，点击下方按钮开始 AI 智能分析内容...`
      });
    }
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
    if (!mode) return;
    
    setIsSaving(true);
    try {
      let finalContent = textInput;
      
      // 如果有文件，上传到 Supabase Storage
      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
        const filePath = `uploads/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('captured-files')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 获取公网访问地址
        const { data: { publicUrl } } = supabase.storage
          .from('captured-files')
          .getPublicUrl(filePath);
          
        finalContent = publicUrl;
      }

      const { data, error } = await supabase
        .from('captured_info')
        .insert({
        type: mode,
        title: extractedData.title,
        content: finalContent,
        tags: extractedData.keywords,
        summary: extractedData.summary
        })
        .select('id')
        .single();

      if (error) throw error;

      // fire-and-forget: 为新记录生成 embedding 向量
      if (data?.id) {
        generateEmbeddingForRow(data.id);
      }

      const contentForGraph =
        mode === 'text'
          ? textInput
          : `标题: ${extractedData.title}\n摘要: ${extractedData.summary}\n关键词: ${extractedData.keywords.join(', ')}\n资源: ${finalContent}`;

      void (async () => {
        const setup = await checkGraphSetup();
        if (!setup.schemaOk) {
          if (setup.schemaError?.toLowerCase().includes('invalid api key')) {
            alert('知识图谱未更新：Supabase 连接配置错误（请检查 VITE_SUPABASE_PROJECT_ID / VITE_SUPABASE_ANON_KEY 并重新部署）。');
          } else {
            alert('知识图谱未更新：数据库未应用图谱迁移（请在 Supabase 执行 20240401000006_extend_knowledge_graph.sql）。');
          }
          console.error('知识图谱 schema 检查失败:', setup.schemaError);
          return;
        }
        if (!setup.llmOk) {
          alert('知识图谱未更新：LLM 未配置（请在 Vercel 或本地服务端环境配置 MINIMAX_API_KEY）。');
          console.error('知识图谱 LLM 检查失败:', setup.llmError);
          return;
        }
        await buildKnowledgeGraphFromContent({ content: contentForGraph, capturedId: data?.id });
      })().catch((e) => {
        console.error('知识图谱更新失败:', e);
      });

      handleCancel(); // 重置状态
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
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {mode === null ? (
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
