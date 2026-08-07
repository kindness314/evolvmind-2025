import { useState, useEffect } from 'react';
import { Home, Share2, User, Database } from 'lucide-react';
import { motion } from 'motion/react';
import { HomePage } from './components/HomePage';
import { DataPage } from './components/DataPage';
import { CapturePage } from './components/CapturePage';
import { ProcessPage } from './components/ProcessPage';
import { KnowledgePage } from './components/KnowledgePage';
import { SettingsPage } from './components/SettingsPage';
import { LoginPage } from './components/LoginPage';
import { ItemDetailPage } from './components/ItemDetailPage';
import { supabase } from '../lib/supabase';

type Page = 'home' | 'capture' | 'data' | 'process' | 'knowledge' | 'settings' | 'item-detail';

// keep-alive: 常驻页面清单 — 首次访问挂载后常驻, 切换只改可见性, 不再重新请求数据
const KEEP_ALIVE_PAGES: Page[] = ['home', 'capture', 'data', 'process', 'knowledge', 'settings', 'item-detail'];

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  // keep-alive: 已访问页面集合 — 首次访问挂载后常驻
  const [visitedPages, setVisitedPages] = useState<Set<Page>>(() => new Set(['home']));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedKnowledgeNodeId, setSelectedKnowledgeNodeId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // 检查用户登录状态
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // 检查演示模式
      const demoAuth = localStorage.getItem('demo_auth');
      if (demoAuth === 'true') {
        setIsAuthenticated(true);
        setIsCheckingAuth(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    } catch (error) {
      console.error('检查认证状态失败:', error);
      setIsAuthenticated(false);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('退出登录失败:', error);
    } finally {
      localStorage.removeItem('demo_auth');
      localStorage.removeItem('supabase_session');
      setIsAuthenticated(false);
      setCurrentPage('home');
    }
  };

  // 如果正在检查认证状态，显示加载画面
  if (isCheckingAuth) {
    return (
      <div className="h-screen flex items-center justify-center bg-white max-w-md mx-auto">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-500 mx-auto animate-pulse" style={{ borderRadius: '4px' }} />
          <p className="mt-4 text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  // 如果未登录，显示登录页面
  if (!isAuthenticated) {
    return (
      <div className="h-screen bg-white max-w-md mx-auto">
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  const handlePageChange = (newPage: Page, itemId?: string) => {
    setCurrentPage(newPage);
    setVisitedPages((prev) => (prev.has(newPage) ? prev : new Set(prev).add(newPage)));
    if (newPage === 'item-detail' && itemId) {
      setSelectedItemId(itemId);
    }
    if (newPage === 'knowledge') {
      setSelectedKnowledgeNodeId(itemId || null);
    }
  };

  const renderPageFor = (page: Page) => {
    switch (page) {
      case 'data':
        return <DataPage onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'home':
        return <HomePage active={page === currentPage} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'capture':
        return <CapturePage active={page === currentPage} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'process':
        return <ProcessPage />;
      case 'knowledge':
        return <KnowledgePage initialNodeId={selectedKnowledgeNodeId} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'settings':
        return <SettingsPage onLogout={handleLogout} />;
      case 'item-detail':
        return selectedItemId ? (
          <ItemDetailPage
            itemId={selectedItemId}
            onBack={() => handlePageChange('home')}
            onUpdate={() => {
              // 触发列表刷新逻辑（如果需要的话，目前通过 useEffect 在 home 页面自动处理）
            }}
          />
        ) : null;
      default:
        return <HomePage active={page === currentPage} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
    }
  };


  return (
    <div className="h-screen flex flex-col bg-white max-w-md mx-auto relative">
      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden relative">
        {/* keep-alive: 页面首次访问挂载后常驻, 切换只改可见性, 不重新请求数据 */}
        {KEEP_ALIVE_PAGES.map((page) => {
          if (!visitedPages.has(page)) return null;
          if (page === 'item-detail' && !selectedItemId) return null;
          const active = page === currentPage;
          return (
            <motion.div
              key={page}
              initial={{ opacity: 0 }}
              animate={{ opacity: active ? 1 : 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0"
              aria-hidden={!active}
              style={active ? undefined : { visibility: 'hidden' }}
            >
              {renderPageFor(page)}
            </motion.div>
          );
        })}
      </main>

      {/* 底部导航 */}
      {currentPage !== 'item-detail' && (
        <nav className="flex-none bg-white border-t border-gray-200">
          <div className="flex items-center px-2 py-2">
            <button
              onClick={() => handlePageChange('home')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-200 ${
                currentPage === 'home' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <motion.div
                animate={{ scale: currentPage === 'home' ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Home className="w-6 h-6" />
              </motion.div>
              <span className="text-xs">首页</span>
            </button>

            <button
              onClick={() => handlePageChange('capture')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-200 ${
                currentPage === 'capture' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <motion.div
                className="w-6 h-6 flex items-center justify-center"
                animate={{ scale: currentPage === 'capture' ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <div
                  className={`w-5 h-5 border-2 ${
                    currentPage === 'capture' ? 'border-blue-500' : 'border-gray-500'
                  }`}
                  style={{ borderRadius: '4px' }}
                >
                </div>
              </motion.div>
              <span className="text-xs">捕获</span>
            </button>

            <button
              onClick={() => handlePageChange('data')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-200 ${
                currentPage === 'data' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <motion.div
                animate={{ scale: currentPage === 'data' ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Database className="w-6 h-6" />
              </motion.div>
              <span className="text-xs">数据</span>
            </button>

            <button
              onClick={() => handlePageChange('knowledge')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-200 ${
                currentPage === 'knowledge' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <motion.div
                animate={{ scale: currentPage === 'knowledge' ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Share2 className="w-6 h-6" />
              </motion.div>
              <span className="text-xs">知识网络</span>
            </button>

            <button
              onClick={() => handlePageChange('settings')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-200 ${
                currentPage === 'settings' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <motion.div
                animate={{ scale: currentPage === 'settings' ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <User className="w-6 h-6" />
              </motion.div>
              <span className="text-xs">个人中心</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}