
import React, { useState } from 'react';
import { auth } from './firebaseConfig';
import { 
    signInWithPopup, 
    GoogleAuthProvider, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    sendPasswordResetEmail
} from 'firebase/auth';

const Login: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [termsChecked, setTermsChecked] = useState(false);

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            if (onClose) onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        
        if (isRegistering && !termsChecked) {
            setError("Debes marcar la casilla de verificación 'Acepto los Términos de Uso' para registrarte.");
            setLoading(false);
            return;
        }

        try {
            if (isRegistering) {
                await createUserWithEmailAndPassword(auth, email, password);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            if (onClose) onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async () => {
        if (!email) {
            setError("Ingresa tu correo para restablecer la contraseña.");
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            alert("Correo de restablecimiento enviado.");
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div className="fixed inset-0 bg-black flex items-center justify-center p-4 z-[300]">
            <div className="bg-[#121212] w-full max-w-md p-8 rounded-2xl border border-white/10 shadow-2xl">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bebas text-red-600 tracking-widest mb-2">SeikoTV</h1>
                    <p className="text-gray-400 text-sm">
                        {isRegistering ? 'Crea tu cuenta para empezar' : 'Inicia sesión para continuar'}
                    </p>
                </div>

                {error && (
                    <div className="bg-red-600/20 border border-red-600/50 p-3 rounded-lg mb-6 animate-shake">
                        <p className="text-red-500 text-xs text-center font-bold">{error}</p>
                    </div>
                )}

                <form onSubmit={handleEmailAuth} className="space-y-4">
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1 block">Correo Electrónico</label>
                        <input 
                            type="email"
                            className="w-full bg-white/5 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-red-600 transition-all"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1 block">Contraseña</label>
                        <input 
                            type="password"
                            className="w-full bg-white/5 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-red-600 transition-all"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {isRegistering && (
                        <div className="flex items-start gap-2.5 my-4">
                            <input 
                                type="checkbox" 
                                id="login-terms-checkbox"
                                checked={termsChecked} 
                                onChange={(e) => setTermsChecked(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-white/20 bg-transparent text-red-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-red-600"
                            />
                            <label htmlFor="login-terms-checkbox" className="text-xs text-gray-400 select-none cursor-pointer leading-tight">
                                Acepto los <span className="text-red-500 font-bold underline">Términos de Uso</span> de SeikoYT (incluye análisis de videos por IA mediante Gemini Vision).
                            </label>
                        </div>
                    )}

                    <button 
                        type="submit"
                        disabled={loading}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-xl transition-all active:scale-95 disabled:opacity-50 uppercase tracking-widest"
                    >
                        {loading ? 'Procesando...' : isRegistering ? 'Registrarse' : 'Entrar'}
                    </button>
                </form>

                <div className="relative my-8">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-white/10"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-[#121212] px-2 text-gray-500 font-bold">O continúa con</span>
                    </div>
                </div>

                <button 
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full bg-white text-black font-black py-3 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 uppercase tracking-widest text-sm"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Google
                </button>

                <div className="mt-8 text-center space-y-4">
                    <button 
                        onClick={() => setIsRegistering(!isRegistering)}
                        className="text-xs text-gray-500 hover:text-white transition-colors block w-full"
                    >
                        {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
                    </button>
                    
                    {onClose && (
                        <button 
                            onClick={onClose}
                            className="w-full border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white py-3 rounded-xl transition-all text-[10px] font-black uppercase tracking-[0.2em]"
                        >
                            Continuar como Invitado
                        </button>
                    )}

                    {!isRegistering && (
                        <button 
                            onClick={handleResetPassword}
                            className="text-[10px] text-gray-600 hover:text-red-500 transition-colors block w-full uppercase tracking-tighter"
                        >
                            ¿Olvidaste tu contraseña?
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Login;
