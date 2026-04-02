const MINIMAX_API_KEY = import.meta.env.VITE_MINIMAX_API_KEY;
const MINIMAX_BASE_URL = import.meta.env.VITE_MINIMAX_BASE_URL || 'https://api.edgefn.net/v1';
const MINIMAX_MODEL = import.meta.env.VITE_MINIMAX_MODEL;

export interface ExtractedInfo {
  title: string;
  keywords: string[];
  summary: string;
}

export async function extractInformation(content: string): Promise<ExtractedInfo> {
  try {
    const useClientKey = Boolean(MINIMAX_API_KEY);

    if (useClientKey) {
      const modelName = MINIMAX_MODEL || 'abab6.5s-chat';
      const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MINIMAX_API_KEY}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: '你是一个专业的信息提取助手。请分析用户提供的内容，提取出一个简短的标题、3-5个关键词以及一段精简的摘要。请务必只返回严格的 JSON：{"title":"...","keywords":["..."],"summary":"..."}。不要输出 Markdown。'
            },
            {
              role: 'user',
              content: content
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      let contentStr = data.choices?.[0]?.message?.content || '';
      contentStr = contentStr.replace(/```json\n?/i, '').replace(/\n?```/i, '').trim();
      const result = JSON.parse(contentStr);

      return {
        title: result.title || '无标题',
        keywords: result.keywords || [],
        summary: result.summary || '无摘要'
      };
    }

    if (import.meta.env.DEV) {
      throw new Error('AI API error: 404 /api/extract (本地开发请使用线上地址或使用 vercel dev 运行以启用 /api 路由)');
    }

    const resp = await fetch('/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`AI API error: ${resp.status} ${errorText}`);
    }

    const payload = await resp.json();
    const result = payload.data;
    
    return {
      title: result.title || '无标题',
      keywords: result.keywords || [],
      summary: result.summary || '无摘要'
    };
  } catch (error) {
    console.error('提取信息失败:', error);
    return {
      title: '提取失败',
      keywords: ['错误'],
      summary: '调用 AI 提取信息时发生错误，请检查网络或 API 配置。'
    };
  }
}
