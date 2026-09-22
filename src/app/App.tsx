import { useState, useEffect, lazy, Suspense } from 'react';
import { Home, Share2, User, Database, Loader2, PenSquare } from 'lucide-react';
import { motion } from 'motion/react';
import { HomePage } from './components/HomePage';
import { DataPage } from './components/DataPage';
import { CapturePage } from './components/CapturePage';
import { SettingsPage } from './components/SettingsPage';
import { LoginPage } from './components/LoginPage';
import { ItemDetailPage } from './components/ItemDetailPage';
import { supabase } from '../lib/supabase';

// O6: KnowledgePage 懒加载 —— 它独占 react-force-graph-2d 依赖，
// 静态 import 会把 ~890KB 的 force-graph 打进主 chunk（影响首屏）。
// keep-alive 机制下懒加载组件挂载后常驻，切换页面不会重新加载。
const KnowledgePage = lazy(() =>
  import('./components/KnowledgePage').then((module) => ({ default: module.KnowledgePage }))
);

function KnowledgePageFallback() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-50">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
      <p className="text-sm text-gray-500">加载知识网络...</p>
    </div>
  );
}

type Page = 'home' | 'capture' | 'data' | 'knowledge' | 'settings' | 'item-detail';

// keep-alive: 常驻页面清单 — 首次访问挂载后常驻, 切换只改可见性, 不再重新请求数据
const KEEP_ALIVE_PAGES: Page[] = ['home', 'capture', 'data', 'knowledge', 'settings', 'item-detail'];

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

  // 底部导航项定义（统一渲染，iOS/Material 胶囊高亮）
  const navItems: { page: Page; label: string; icon: typeof Home }[] = [
    { page: 'home', label: '首页', icon: Home },
    { page: 'capture', label: '捕获', icon: PenSquare },
    { page: 'data', label: '数据', icon: Database },
    { page: 'knowledge', label: '知识网络', icon: Share2 },
    { page: 'settings', label: '个人中心', icon: User },
  ];

  const renderPageFor = (page: Page) => {
    switch (page) {
      case 'data':
        return <DataPage onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'home':
        return <HomePage active={page === currentPage} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'capture':
        return <CapturePage active={page === currentPage} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
      case 'knowledge':
        return (
          <Suspense fallback={<KnowledgePageFallback />}>
            <KnowledgePage initialNodeId={selectedKnowledgeNodeId} onNavigate={(p, id) => handlePageChange(p as Page, id)} />
          </Suspense>
        );
      case 'settings':
        return <SettingsPage onLogout={handleLogout} />;
      case 'item-detail':
        return selectedItemId ? (
          <ItemDetailPage
            itemId={selectedItemId}
            onBack={() => handlePageChange('home')}
            onUpdate={() => {
              // 删除/编辑/置顶后通知数据页与首页立即增量同步（DataPage 监听 evolvmind:data-changed）
              window.dispatchEvent(new CustomEvent('evolvmind:data-changed'));
            }}
          />
        ) : null;
      default:
        return <HomePage active={page === currentPage} onNavigate={(p, id) => handlePageChange(p as Page, id)} />;
    }
  };


  return (
    <div className={`h-screen flex flex-col bg-white max-w-md mx-auto relative ${currentPage === 'knowledge' ? 'md:max-w-4xl' : ''}`}>
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
        <nav className="flex-none border-t border-gray-100 bg-white/80 backdrop-blur-xl">
          <div className="flex items-center px-3 pt-1.5 pb-2 max-w-md mx-auto">
            {navItems.map((item) => {
              const active = currentPage === item.page;
              const Icon = item.icon;
              return (
                <button
                  key={item.page}
                  onClick={() => handlePageChange(item.page)}
                  className="flex-1 flex flex-col items-center gap-0.5 py-1.5 relative"
                  aria-label={item.label}
                >
                  <motion.div
                    className={`flex items-center justify-center w-12 h-7 transition-colors duration-200 ${
                      active ? 'text-white bg-brand shadow-card' : 'text-gray-400'
                    }`}
                    style={{ borderRadius: active ? 999 : 8, boxShadow: active ? '0 3px 9px rgba(10,132,255,0.35)' : undefined }}
                    animate={{ scale: active ? 1.08 : 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.4 : 2} />
                  </motion.div>
                  <span className={`text-[11px] leading-none transition-colors duration-200 ${
                    active ? 'text-brand font-medium' : 'text-gray-400'
                  }`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}