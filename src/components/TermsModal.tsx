import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { ShieldCheck, Scroll, AlertCircle, Sparkles } from 'lucide-react';

export const TermsModal: React.FC = () => {
    const { acceptTermsAndCreateProfile, user } = useAuth();
    const [hasReadToBottom, setHasReadToBottom] = useState(false);
    const [checked, setChecked] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const handleScroll = () => {
        const container = scrollContainerRef.current;
        if (!container) return;

        // Check if user has scrolled to the bottom (with a threshold of 8px for cross-browser reliability)
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 8;
        if (isAtBottom) {
            setHasReadToBottom(true);
        }
    };

    // Fallback: If content doesn't require scrolling on extremely tall displays, enable automatically
    useEffect(() => {
        const checkScrollable = () => {
            const container = scrollContainerRef.current;
            if (container) {
                const isScrollable = container.scrollHeight > container.clientHeight;
                if (!isScrollable) {
                    setHasReadToBottom(true);
                }
            }
        };

        const timer = setTimeout(checkScrollable, 300);
        window.addEventListener('resize', checkScrollable);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', checkScrollable);
        };
    }, []);

    const handleAccept = async () => {
        if (!hasReadToBottom || !checked || isSaving) return;
        setIsSaving(true);
        try {
            await acceptTermsAndCreateProfile();
        } catch (error) {
            console.error("Error accepting terms:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const logout = () => {
        import('../../firebaseConfig').then(({ auth }) => auth.signOut());
    };

    return (
        <div id="terms-modal-overlay" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md p-0 sm:p-4 overflow-y-auto">
            <div 
                id="terms-modal-container" 
                className="relative w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-2xl bg-[#080808] border-t-2 sm:border border-red-600 shadow-[0_0_40px_rgba(255,0,0,0.25)] flex flex-col text-white overflow-hidden sm:rounded-2xl animate-fade-in"
            >
                {/* Visual Neon Border Glow Accent */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-600 shadow-[0_0_15px_#ff0000]" />

                {/* Header */}
                <div className="p-6 border-b border-white/5 bg-gradient-to-b from-red-950/20 to-transparent flex flex-col items-center text-center relative shrink-0">
                    <div className="w-12 h-12 rounded-full bg-red-950/30 border border-red-500/30 flex items-center justify-center mb-3 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                        <ShieldCheck className="w-6 h-6 text-red-500" />
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bebas tracking-widest text-white uppercase drop-shadow-[0_0_8px_rgba(255,0,0,0.4)]">
                        Términos de Uso de SeikoYT
                    </h2>
                    <p className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-[0.2em] mt-1 font-bold">
                        Aceptación obligatoria de registro y uso de la plataforma
                    </p>
                </div>

                {/* Scrollable Terms Document Body */}
                <div 
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="flex-grow overflow-y-auto p-6 sm:p-8 space-y-6 text-sm text-gray-300 leading-relaxed font-sans select-none scrollbar-thin scrollbar-thumb-red-600 scrollbar-track-black"
                >
                    <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-1">
                            <p className="font-bold text-red-400 uppercase tracking-wider">Aviso Legal Importante</p>
                            <p className="text-gray-400">
                                Para proteger a nuestra comunidad de creadores, moderar contenidos y resguardar la propiedad intelectual, todos los usuarios de SeikoYT deben leer y aceptar de forma íntegra este reglamento antes de acceder al catálogo de videos y al selector de perfiles.
                            </p>
                        </div>
                    </div>

                    {/* Section 1 */}
                    <section className="space-y-2">
                        <h3 className="text-red-500 font-bold uppercase tracking-wider flex items-center gap-2 text-xs border-b border-white/5 pb-1">
                            <span className="text-red-600 font-mono">01.</span> Aceptación de los Términos de Uso
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-400">
                            El ingreso, registro, suscripción o cualquier forma de uso directo o indirecto de la plataforma <strong className="text-white">SeikoYT</strong> implica el consentimiento libre, expreso, total y vinculante de estas cláusulas. Si usted no está de acuerdo con alguna sección o condición de este reglamento legal, deberá abstenerse inmediatamente de interactuar en la plataforma, cerrar esta sesión y desinstalar la aplicación.
                        </p>
                    </section>

                    {/* Section 2 */}
                    <section className="space-y-2">
                        <h3 className="text-red-500 font-bold uppercase tracking-wider flex items-center gap-2 text-xs border-b border-white/5 pb-1">
                            <span className="text-red-600 font-mono">02.</span> Gestión de Cuentas, Credenciales y Perfiles
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-400">
                            Cada usuario registrado es el único responsable legal, civil y administrativo del resguardo de sus credenciales de acceso (correo electrónico, contraseñas, y tokens vinculados). Las cuentas son individuales, personales e intransferibles. Queda terminantemente prohibido ceder, arrendar o transferir de cualquier forma el acceso a la sub-colección de perfiles de usuario. Toda interacción que ocurra bajo su cuenta de acceso se presumirá de su autoría exclusiva.
                        </p>
                    </section>

                    {/* Section 3 */}
                    <section className="space-y-4">
                        <h3 className="text-red-500 font-bold uppercase tracking-wider flex items-center gap-2 text-xs border-b border-white/5 pb-1">
                            <span className="text-red-600 font-mono">03.</span> Contenido Generado por el Usuario (UGC - Apartado Comunidad)
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-400">
                            En el espacio interactivo y de redes sociales ("Comunidad"), los usuarios pueden publicar comentarios, imágenes, videos y enlaces relacionados. La interacción en este espacio se rige bajo los siguientes estatutos:
                        </p>
                        <ul className="list-disc list-inside pl-2 space-y-2 text-xs text-gray-400">
                            <li>
                                <strong className="text-white">Licencia no exclusiva de reproducción:</strong> Al subir, publicar o transmitir contenido multimedia en la sección de Comunidad de SeikoYT, usted otorga de manera gratuita, perpetua, irrevocable y global una licencia no exclusiva para que SeikoYT reproduzca, distribuya, adapte, transmita públicamente y muestre dicho contenido dentro de la plataforma y en sus redes promocionales oficiales.
                            </li>
                            <li>
                                <strong className="text-white">Prohibición absoluta de Derechos de Autor de Terceros:</strong> Queda rigurosamente prohibido subir cualquier tipo de material protegido por copyright o propiedad intelectual ajena. <span className="text-red-400 font-semibold">Se exceptúan únicamente activos permitidos</span> procedentes de entornos comunitarios gacha (como <em className="text-white">Gacha Club</em>, <em className="text-white">Gacha Life</em> y recursos libres equivalentes), siempre que sean combinados con aportes creativos genuinos del usuario.
                            </li>
                            <li>
                                <strong className="text-white">Reglas éticas de Contenido:</strong> No se tolerará la publicación de contenido explícito o pornográfico, apología de la violencia, discursos de odio, difamación, discriminación racial, religiosa, de género, ni conductas de ciberacoso contra otros usuarios.
                            </li>
                            <li>
                                <strong className="text-red-400 font-bold uppercase flex items-center gap-1.5 mt-2">
                                    <Sparkles className="w-3.5 h-3.5 text-red-500" /> Cláusula de Moderación IA (Gemini Vision)
                                </strong>
                                <span className="block mt-1">
                                    Para salvaguardar la integridad de nuestra comunidad de menores de edad, el usuario acepta de manera transparente que todo video, imagen y texto que decida cargar en los servidores de la sección Comunidad es pre-analizado de forma automatizada por un sistema de Inteligencia Artificial integrado (<strong className="text-white">Gemini Vision API</strong>). Este sistema verifica en tiempo real la idoneidad del archivo y bloquea automáticamente publicaciones infractoras antes de que sean de acceso público.
                                </span>
                            </li>
                        </ul>
                    </section>

                    {/* Section 4 */}
                    <section className="space-y-2">
                        <h3 className="text-red-500 font-bold uppercase tracking-wider flex items-center gap-2 text-xs border-b border-white/5 pb-1">
                            <span className="text-red-600 font-mono">04.</span> Propiedad Intelectual de SeikoYT
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-400">
                            Toda obra audiovisual original alojada en el catálogo oficial de la plataforma, incluyendo de manera enunciativa mas no limitativa la serie insignia original <strong className="text-white">"After you, it's me"</strong>, marcas registradas, imagotipos de SeikoYT, diseños tipográficos, pistas de audio de doblajes aficionados (<em className="text-white">FanDub</em>), interpretaciones de voz de nuestros actores afiliados, código fuente de la aplicación, estilos visuales y la interfaz en general, son propiedad exclusiva de sus respectivos autores originales y del equipo gestor de SeikoYT. Se prohíbe terminantemente su copia, extracción de archivos multimedia, retransmisión no autorizada o ingeniería inversa.
                        </p>
                    </section>

                    {/* Section 5 */}
                    <section className="space-y-2">
                        <h3 className="text-red-500 font-bold uppercase tracking-wider flex items-center gap-2 text-xs border-b border-white/5 pb-1">
                            <span className="text-red-600 font-mono">05.</span> Sanciones, Suspensión y Cierre de Cuentas
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-400">
                            La violación de cualquiera de las obligaciones establecidas en estos Términos faculta a SeikoYT para aplicar medidas sancionatorias inmediatas. Estas incluyen, de forma discrecional, la advertencia formal, la eliminación directa de la publicación infractora, el bloqueo temporal de los privilegios comunitarios, o la expulsión indefinida con eliminación total de la cuenta en Firebase Auth, sin derecho a indemnización ni resarcimiento material de ninguna índole.
                        </p>
                    </section>

                    {/* End Indicator */}
                    <div className="pt-4 text-center border-t border-white/5">
                        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-full">
                            Fin de las Cláusulas de SeikoYT v1.2
                        </span>
                    </div>
                </div>

                {/* Footer Controls */}
                <div className="p-6 border-t border-white/5 bg-[#0a0a0a] flex flex-col gap-4 shrink-0">
                    {/* Read Prompt Banner */}
                    {!hasReadToBottom && (
                        <div className="flex items-center gap-2 justify-center py-2 px-3 bg-white/5 rounded-lg text-[11px] text-gray-400 font-semibold animate-pulse uppercase tracking-wider">
                            <Scroll className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            <span>Desplázate hacia abajo hasta el final para desbloquear la aceptación</span>
                        </div>
                    )}

                    {/* Checkbox and Agreement */}
                    <div className="flex items-start gap-3">
                        <label className={`relative flex items-center p-0.5 rounded-md cursor-pointer ${!hasReadToBottom ? 'opacity-40 cursor-not-allowed' : ''}`}>
                            <input 
                                type="checkbox"
                                checked={checked}
                                disabled={!hasReadToBottom}
                                onChange={(e) => setChecked(e.target.checked)}
                                className={`w-5 h-5 rounded border bg-transparent text-red-600 focus:ring-0 transition-all ${
                                    checked 
                                        ? 'border-red-600 bg-red-600/20' 
                                        : hasReadToBottom 
                                            ? 'border-red-500 hover:border-red-600' 
                                            : 'border-gray-700'
                                } cursor-pointer`}
                            />
                        </label>
                        <div className="text-xs select-none">
                            <p className={`font-bold ${checked ? 'text-red-500' : 'text-gray-300'} transition-colors`}>
                                Acepto los Términos y Condiciones de Uso de SeikoYT
                            </p>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                                Declaro tener la capacidad legal suficiente y acepto todas las cláusulas de responsabilidad y propiedad intelectual descritas.
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 mt-1 sm:mt-2">
                        {/* Decline/Cancel */}
                        <button 
                            type="button"
                            onClick={logout}
                            className="flex-1 py-3 px-4 bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-widest text-gray-400 rounded-xl hover:bg-white/10 hover:text-white hover:border-white/20 transition-all duration-200"
                        >
                            Rechazar y Salir
                        </button>

                        {/* Accept & Register */}
                        <button 
                            type="button"
                            disabled={!hasReadToBottom || !checked || isSaving}
                            onClick={handleAccept}
                            className={`flex-[1.5] py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 relative flex items-center justify-center gap-2 ${
                                hasReadToBottom && checked && !isSaving
                                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_20px_#ff0000] active:scale-95 cursor-pointer'
                                    : 'bg-gray-800 text-gray-500 border border-transparent cursor-not-allowed'
                            }`}
                        >
                            {isSaving ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>Guardando...</span>
                                </>
                            ) : (
                                <span>Aceptar y Registrarme</span>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
