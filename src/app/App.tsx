import { useState, useEffect } from 'react';
import { Home, Share2, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HomePage } from './components/HomePage';
import { CapturePage } from './components/CapturePage';
import { ProcessPage } from './components/ProcessPage';
import { KnowledgePage } from './components/KnowledgePage';
import { SettingsPage } from './components/SettingsPage';
import { LoginPage } from './components/LoginPage';
import { ItemDetailPage } from './components/ItemDetailPage';
import { supabase } from '../lib/supabase';

type Page = 'home' | 'capture' | 'process' | 'knowledge' | 'settings' | 'item-detail';

// 页面顺序索引，用于判断滑动方向
const pageOrder: Record<Page, number> = {
  home: 0,
  capture: 1,
  knowledge: 2,
  settings: 3,
  process: 4,
  'item-detail': 5
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [previousPage, setPreviousPage] = useState<Page>('home');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
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

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentPage('home');
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
    setPreviousPage(currentPage);
    setCurrentPage(newPage);
    if (itemId) {
      setSelectedItemId(itemId);
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={(page, id) => handlePageChange(page as Page, id)} />;
      case 'capture':
        return <CapturePage />;
      case 'process':
        return <ProcessPage />;
      case 'knowledge':
        return <KnowledgePage />;
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
        return <HomePage onNavigate={(page, id) => handlePageChange(page as Page, id)} />;
    }
  };

  // 判断滑动方向
  const direction = pageOrder[currentPage] > pageOrder[previousPage] ? 1 : -1;

  // 页面切换动画变体
  const pageVariants = {
    initial: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0
    }),
    animate: {
      x: 0,
      opacity: 1,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 30
      }
    },
    exit: (direction: number) => ({
      x: direction > 0 ? '-100%' : '100%',
      opacity: 0,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 30
      }
    })
  };

  return (
    <div className="h-screen flex flex-col bg-white max-w-md mx-auto relative">
      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentPage}
            custom={direction}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute inset-0"
          >
            {renderPage()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 底部导航 */}
      {currentPage !== 'item-detail' && (
        <nav className="flex-none bg-white border-t border-gray-200">
          <div className="flex items-center justify-around px-2 py-2">
            <button
              onClick={() => handlePageChange('home')}
              className={`flex flex-col items-center gap-1 px-4 py-2 transition-all duration-200 ${
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
              className={`flex flex-col items-center gap-1 px-4 py-2 transition-all duration-200 ${
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
              onClick={() => handlePageChange('knowledge')}
              className={`flex flex-col items-center gap-1 px-4 py-2 transition-all duration-200 ${
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
              className={`flex flex-col items-center gap-1 px-4 py-2 transition-all duration-200 ${
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