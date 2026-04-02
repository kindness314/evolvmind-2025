import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, ArrowLeft, Loader2 } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './ui/input-otp';
import { supabase } from '../../lib/supabase';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

type Step = 'phone' | 'code';

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  // 倒计时效果
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 验证手机号格式
  const validatePhone = (phone: string) => {
    return /^1[3-9]\d{9}$/.test(phone);
  };

  // 发送验证码
  const handleSendCode = async () => {
    if (!validatePhone(phone)) {
      setError('请输入有效的手机号');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 注意：Supabase需要配置SMS提供商（如Twilio）才能发送短信验证码
      // 这里使用phone作为标识符，实际项目中需要在Supabase后台配置SMS服务
      const { error } = await supabase.auth.signInWithOtp({
        phone: `+86${phone}`,
      });

      if (error) {
        // 如果SMS未配置，这里会报错，我们提供友好提示
        console.error('发送验证码失败:', error);
        setError('验证码发送失败，请检查短信服务配置');
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

  // 验证验证码
  const handleVerifyCode = async () => {
    if (code.length !== 6) {
      setError('请输入完整的验证码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: `+86${phone}`,
        token: code,
        type: 'sms',
      });

      if (error) {
        console.error('验证码验证失败:', error);
        setError('验证码错误，请重试');
        setLoading(false);
      } else if (data.session) {
        // 验证成功，保存session
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        setLoginSuccess(true);
        // 显示成功动画后跳转
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

  // 重新发送验证码
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
                className="w-20 h-20 bg-green-500 mx-auto flex items-center justify-center"
                style={{ borderRadius: '4px' }}
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
        {step === 'phone' ? (
          <motion.div
            key="phone"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col"
          >
            {/* 顶部装饰 */}
            <div className="pt-16 pb-8 px-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="w-16 h-16 bg-blue-500 mx-auto flex items-center justify-center"
                style={{ borderRadius: '4px' }}
              >
                <Phone className="w-8 h-8 text-white" />
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
                请输入手机号登录或注册
              </motion.p>
            </div>

            {/* 输入区域 */}
            <div className="flex-1 px-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
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
                    className="w-full pl-14 pr-4 py-3 bg-gray-50 border-0 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    style={{ borderRadius: '4px' }}
                    maxLength={11}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                  />
                </div>

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
                  disabled={loading || phone.length !== 11}
                  className="w-full mt-6 py-3 bg-blue-500 text-white font-medium disabled:bg-gray-300 disabled:cursor-not-allowed transition-all hover:bg-blue-600 active:scale-98"
                  style={{ borderRadius: '4px' }}
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

            {/* 开发提示 */}
            <div className="px-6 pb-6">
              <div className="bg-blue-50 p-3 text-xs text-blue-600" style={{ borderRadius: '4px' }}>
                <strong>开发提示：</strong> 手机验证码登录需要在Supabase后台配置SMS服务提供商（如Twilio）。
              </div>
              
              {/* 开发模式快速登录 */}
              <div className="mt-3">
                <button
                  onClick={() => {
                    // 演示模式：直接标记为已登录
                    localStorage.setItem('demo_auth', 'true');
                    onLoginSuccess();
                  }}
                  className="w-full py-2 bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
                  style={{ borderRadius: '4px' }}
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
                  setStep('phone');
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
                className="w-16 h-16 bg-blue-500 mx-auto flex items-center justify-center"
                style={{ borderRadius: '4px' }}
              >
                <Phone className="w-8 h-8 text-white" />
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
                已发送至 +86 {phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1****$3')}
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
                    // 自动验证
                    if (value.length === 6) {
                      setTimeout(() => {
                        handleVerifyCode();
                      }, 300);
                    }
                  }}
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="w-12 h-14 text-xl font-medium border-2 border-gray-200 focus:border-blue-500 transition-colors"
                        style={{ borderRadius: '4px' }}
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
                  className="mt-6 text-sm text-blue-500 disabled:text-gray-400 transition-colors"
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