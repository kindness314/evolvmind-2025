import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Phone, ArrowLeft, Loader2 } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './ui/input-otp';
import { supabase } from '../../lib/supabase';
interface LoginPageProps {
  onLoginSuccess: () => void;
}

type AuthMethod = 'email' | 'phone';
type Step = 'input' | 'code';

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [step, setStep] = useState<Step>('input');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  // 倒计时效果
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const validatePhone = (phone: string) => /^1[3-9]\d{9}$/.test(phone);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSendCode = async () => {
    if (authMethod === 'phone') {
      if (!validatePhone(phone)) {
        setError('请输入有效的手机号');
        return;
      }
    } else {
      if (!validateEmail(email)) {
        setError('请输入有效的邮箱地址');
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      const otpParams = authMethod === 'phone'
        ? { phone: `+86${phone}` }
        : { email };

      const { error } = await supabase.auth.signInWithOtp(otpParams);

      if (error) {
        console.error('发送验证码失败:', error);
        const msg = error.message || '';
        if (error.status === 429 || error.code === 'over_email_send_rate_limit' || msg.toLowerCase().includes('rate limit')) {
          setError('发送过于频繁，请稍后再试');
        } else if (authMethod === 'phone') {
          setError('验证码发送失败，中国大陆短信暂不可用，请使用邮箱登录');
        } else {
          setError('验证码发送失败，请检查邮箱地址是否正确');
        }
      } else {
        setStep('code');
        setCountdown(60);
      }
    } catch (err) {
      console.error('发送验证码异常:', err);
      setError('发送验证码时发生错误');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (token: string) => {
    if (token.length !== 6) {
      setError('请输入完整的验证码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const verifyParams = authMethod === 'phone'
        ? { phone: `+86${phone}`, token, type: 'sms' as const }
        : { email, token, type: 'email' as const };

      const { data, error } = await supabase.auth.verifyOtp(verifyParams);

      if (error) {
        console.error('验证码验证失败:', error);
        setError('验证码错误，请重试');
        setLoading(false);
      } else if (data.session) {
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        setLoginSuccess(true);
        setTimeout(() => {
          onLoginSuccess();
        }, 1000);
      }
    } catch (err) {
      console.error('验证码验证异常:', err);
      setError('验证时发生错误');
      setLoading(false);
    }
  };

  const handleResendCode = () => {
    if (countdown > 0) return;
    handleSendCode();
  };

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* 登录成功覆盖层 */}
      <AnimatePresence>
        {loginSuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white z-50 flex items-center justify-center"
          >
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                className="w-20 h-20 bg-success mx-auto flex items-center justify-center rounded-full"
              >
                <motion.svg
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                  className="w-12 h-12 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <motion.path d="M20 6L9 17l-5-5" />
                </motion.svg>
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-4 text-lg font-medium text-gray-900"
              >
                登录成功
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {step === 'input' ? (
          <motion.div
            key="input"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col"
          >
            {/* 认证方式选择 */}
            <div className="pt-8 pb-4 px-6">
              <div className="flex bg-gray-100 p-1 rounded-xl">
                <button
                  onClick={() => { setAuthMethod('email'); setError(''); }}
                  className={`flex-1 py-2 text-sm font-medium transition-all ${authMethod === 'email' ? 'bg-white text-gray-900 shadow-card rounded-lg' : 'text-gray-500'}`}
                >
                  <Mail className="w-4 h-4 inline mr-1.5" />
                  邮箱
                </button>
                <button
                  onClick={() => { setAuthMethod('phone'); setError(''); }}
                  className={`flex-1 py-2 text-sm font-medium transition-all ${authMethod === 'phone' ? 'bg-white text-gray-900 shadow-card rounded-lg' : 'text-gray-500'}`}
                >
                  <Phone className="w-4 h-4 inline mr-1.5" />
                  手机号
                </button>
              </div>
            </div>

            {/* 顶部装饰 */}
            <div className="pb-6 px-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="w-16 h-16 bg-brand mx-auto flex items-center justify-center rounded-2xl shadow-card"
              >
                {authMethod === 'email' ? (
                  <Mail className="w-8 h-8 text-white" />
                ) : (
                  <Phone className="w-8 h-8 text-white" />
                )}
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-2xl font-medium text-center mt-6 text-gray-900"
              >
                欢迎使用
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-gray-500 text-center mt-2"
              >
                {authMethod === 'email' ? '请输入邮箱登录或注册' : '请输入手机号登录或注册'}
              </motion.p>
            </div>

            {/* 输入区域 */}
            <div className="flex-1 px-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                {authMethod === 'email' ? (
                  <>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      邮箱地址
                    </label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value.trim());
                          setError('');
                        }}
                        placeholder="请输入邮箱地址"
                        className="w-full pl-11 pr-4 py-3 bg-gray-100 border-0 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand transition-all rounded-xl"
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      手机号
                    </label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                        +86
                      </div>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value.replace(/\D/g, '').slice(0, 11));
                          setError('');
                        }}
                        placeholder="请输入手机号"
                        className="w-full pl-14 pr-4 py-3 bg-gray-100 border-0 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand transition-all rounded-xl"
                        maxLength={11}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                      />
                    </div>
                    <div className="bg-warning-soft p-3 mt-3 text-xs text-amber-700 rounded-xl">
                      中国大陆短信验证暂不可用，请使用邮箱登录。
                    </div>
                  </>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-2 text-sm text-red-500"
                  >
                    {error}
                  </motion.div>
                )}

                <button
                  onClick={handleSendCode}
                  disabled={loading || (authMethod === 'email' ? !validateEmail(email) : phone.length !== 11)}
                  className="w-full mt-6 py-3 bg-brand text-white font-medium disabled:bg-gray-300 disabled:cursor-not-allowed transition-all hover:bg-brand-strong active:scale-[0.98] rounded-xl shadow-card"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      发送中...
                    </span>
                  ) : (
                    '获取验证码'
                  )}
                </button>

                <p className="text-xs text-gray-400 text-center mt-4">
                  登录即表示同意服务条款和隐私政策
                </p>
              </motion.div>
            </div>

            {/* 演示模式登录 */}
            <div className="px-6 pb-6">
              <div className="mt-3">
                <button
                  onClick={() => {
                    localStorage.setItem('demo_auth', 'true');
                    onLoginSuccess();
                  }}
                  className="w-full py-2 bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors rounded-xl"
                >
                  🚀 演示模式登录（开发使用）
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col"
          >
            {/* 返回按钮 */}
            <div className="pt-4 px-6">
              <button
                onClick={() => {
                  setStep('input');
                  setCode('');
                  setError('');
                }}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm">返回</span>
              </button>
            </div>

            {/* 验证码输入 */}
            <div className="pt-12 pb-8 px-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                className="w-16 h-16 bg-brand mx-auto flex items-center justify-center rounded-2xl shadow-card"
              >
                {authMethod === 'email' ? (
                  <Mail className="w-8 h-8 text-white" />
                ) : (
                  <Phone className="w-8 h-8 text-white" />
                )}
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-2xl font-medium text-center mt-6 text-gray-900"
              >
                输入验证码
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-sm text-gray-500 text-center mt-2"
              >
                {authMethod === 'email'
                  ? `已发送至 ${email}`
                  : `已发送至 +86 ${phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1****$3')}`}
              </motion.p>
            </div>

            <div className="flex-1 px-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="flex flex-col items-center"
              >
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    setError('');
                  }}
                  onComplete={handleVerifyCode}
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="w-12 h-14 text-xl font-medium border-2 border-gray-200 focus:border-brand transition-colors rounded-lg"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-4 text-sm text-red-500"
                  >
                    {error}
                  </motion.div>
                )}

                <button
                  onClick={handleResendCode}
                  disabled={countdown > 0}
                  className="mt-6 text-sm text-brand disabled:text-gray-400 transition-colors"
                >
                  {countdown > 0 ? `${countdown}秒后重新发送` : '重新发送验证码'}
                </button>

                {loading && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4 flex items-center gap-2 text-sm text-gray-500"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    验证中...
                  </motion.div>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}