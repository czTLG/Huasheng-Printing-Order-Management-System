import React, { useState, useEffect } from 'react';
import { Package, ArrowRight, ShieldCheck, User, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { User as UserType } from '../types';
import { mockService } from '../lib/mockService';

interface LoginProps {
  onLogin: (user: UserType) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const savedUser = localStorage.getItem('savedUsername') || localStorage.getItem('lastUser');
    const savedPassword = localStorage.getItem('savedPassword') || '';
    const remember = localStorage.getItem('rememberPwd');
    if (savedUser) {
      setUsername(savedUser);
      setPassword(savedPassword);
    } else {
      setUsername('admin');
      setPassword('');
    }
    setRememberMe(remember !== '0');
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const user = await mockService.login(username.trim(), password);
      if (rememberMe) {
        localStorage.setItem('savedUsername', username.trim());
        localStorage.setItem('savedPassword', password);
        localStorage.setItem('rememberPwd', '1');
      } else {
        localStorage.removeItem('savedUsername');
        localStorage.removeItem('savedPassword');
        localStorage.setItem('rememberPwd', '0');
      }
      onLogin(user as UserType);
    } catch (err: any) {
      setError(err?.message || '登录失败，请检查账号或密码');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 md:p-10">
        
        <div className="flex flex-col items-center text-center mb-8">
           <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200 mb-4">
             <Package className="w-7 h-7 text-white" />
           </div>
           <h1 className="text-2xl font-black text-slate-900 tracking-tight">华胜印刷订单管理系统</h1>
           <p className="text-xs text-slate-500 font-medium mt-2">打通开单、生产流转、成本核算与权限管理的工厂数字大脑</p>
        </div>

        <AnimatePresence>
           {error && (
             <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-bold mb-6 border border-red-100 text-center">
               {error}
             </motion.div>
           )}
        </AnimatePresence>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
             <div className="relative flex items-center">
               <User className="absolute left-4 w-4 h-4 text-slate-400" />
               <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 text-sm font-semibold focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none text-slate-700" placeholder="请输入系统账号" />
             </div>
          </div>
          
          <div className="space-y-1.5">
             <div className="relative flex items-center">
               <ShieldCheck className="absolute left-4 w-4 h-4 text-slate-400" />
               <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 text-sm font-semibold focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none text-slate-700" placeholder="请输入系统密码" />
             </div>
          </div>

          <div className="flex items-center justify-between pt-1 pb-2">
             <button type="button" onClick={() => setRememberMe(!rememberMe)} className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 transition-colors">
                {rememberMe ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                自动登录 / 记住密码
             </button>
          </div>

          <button type="submit" disabled={isLoading} className={cn("w-full h-12 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2", isLoading ? "opacity-80 cursor-wait" : "hover:bg-indigo-700 active:scale-[0.98]")}>
            {isLoading ? (
               <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
               <>登录进入系统 <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </form>

      </div>
    </div>
  );
};

export default Login;
