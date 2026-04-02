import { Sparkles, Link2, Save } from 'lucide-react';
import { useState } from 'react';

export function ProcessPage() {
  const [selectedItem, setSelectedItem] = useState('item1');

  const items = [
    { id: 'item1', title: '产品会议要点', type: '文本' },
    { id: 'item2', title: '设计草图', type: '图片' },
    { id: 'item3', title: '客户访谈', type: '音频' }
  ];

  const currentItem = items.find(item => item.id === selectedItem);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 顶部工具栏 */}
      <div className="flex-none px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-base font-medium text-gray-900">信息处理</h2>
        <button
          className="px-3 py-1.5 bg-blue-500 text-white text-sm hover:bg-blue-600 transition-colors flex items-center gap-1.5"
          style={{ borderRadius: '4px' }}
        >
          <Save className="w-4 h-4" />
          保存
        </button>
      </div>

      {/* 项目选择器 */}
      <div className="flex-none px-4 py-3 border-b border-gray-200">
        <div className="flex gap-2 overflow-x-auto">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedItem(item.id)}
              className={`flex-none px-3 py-1.5 text-sm transition-colors ${
                selectedItem === item.id
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              style={{ borderRadius: '4px' }}
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {/* 主内容区 - 左右分栏 */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex flex-col md:flex-row">
          {/* 左侧：原始内容 */}
          <div className="flex-1 overflow-y-auto p-4 border-b md:border-b-0 md:border-r border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
              <span>原始内容</span>
              <span className="text-xs text-gray-500">({currentItem?.type})</span>
            </h3>
            
            <div className="bg-gray-50 p-4 border border-gray-200" style={{ borderRadius: '4px' }}>
              <p className="text-sm text-gray-700 leading-relaxed">
                今天的产品会议主要讨论了以下几点：
                <br /><br />
                1. 新功能的设计方向确定采用极简风格，去除冗余元素，重点突出内容
                <br /><br />
                2. 使用中性色调作为主色系，灰白为主，品牌蓝作为点缀色
                <br /><br />
                3. 保持充足的留白空间，减少用户的视觉压力
                <br /><br />
                4. 统一使用4px圆角设计，保持界面的一致性
                <br /><br />
                预计下周完成原型设计，后续进入开发阶段。
              </p>
            </div>
          </div>

          {/* 右侧：结构化结果 */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">结构化结果</h3>
              <button
                className="px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                style={{ borderRadius: '4px' }}
              >
                <Sparkles className="w-4 h-4" />
                一键优化
              </button>
            </div>

            <div className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block">标题</label>
                <input
                  type="text"
                  value="产品会议要点 - 设计规范讨论"
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ borderRadius: '4px' }}
                />
              </div>

              {/* 分类 */}
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block">分类</label>
                <select
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ borderRadius: '4px' }}
                >
                  <option>会议记录</option>
                  <option>产品设计</option>
                  <option>技术文档</option>
                  <option>其他</option>
                </select>
              </div>

              {/* 关键词 */}
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block">关键词</label>
                <div className="flex flex-wrap gap-2">
                  {['产品会议', '极简设计', '设计规范', '4px圆角'].map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-white border border-gray-200 text-sm text-gray-700"
                      style={{ borderRadius: '4px' }}
                    >
                      {tag}
                    </span>
                  ))}
                  <button
                    className="px-2.5 py-1 border border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400"
                    style={{ borderRadius: '4px' }}
                  >
                    + 添加
                  </button>
                </div>
              </div>

              {/* 摘要 */}
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block">摘要</label>
                <textarea
                  value="本次会议确定了产品的设计方向：采用极简风格，中性色调配合品牌蓝，统一4px圆角，注重留白和内容呈现。"
                  className="w-full px-3 py-2 bg-white border border-gray-200 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  style={{ borderRadius: '4px' }}
                />
              </div>

              {/* 关联项 */}
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  关联信息
                </label>
                <div className="space-y-2">
                  <div className="p-3 bg-white border border-gray-200 flex items-center justify-between"
                    style={{ borderRadius: '4px' }}
                  >
                    <div className="flex-1">
                      <p className="text-sm text-gray-900">设计草图</p>
                      <p className="text-xs text-gray-500">图片 · 5小时前</p>
                    </div>
                    <button className="text-xs text-red-500 hover:text-red-600">移除</button>
                  </div>
                  <button
                    className="w-full p-3 border border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400"
                    style={{ borderRadius: '4px' }}
                  >
                    + 添加关联
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
