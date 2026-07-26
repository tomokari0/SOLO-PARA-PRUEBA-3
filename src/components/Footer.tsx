import React from 'react';
import { Youtube, Instagram, Twitter, MessageSquare, Heart } from 'lucide-react';
import { motion } from 'motion/react';

interface FooterProps {
    onNavigate?: (tab: string) => void;
}

const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
    const currentYear = 2026;

    const socialLinks = [
        { icon: <Youtube size={20} />, href: 'https://youtube.com/@seiko-vt-08', label: 'YouTube' },
        { icon: <Instagram size={20} />, href: 'https://instagram.com/seikoyt', label: 'Instagram' },
        { icon: <Twitter size={20} />, href: 'https://x.com/Marisel84464044', label: 'Twitter' },
        { icon: <MessageSquare size={20} />, href: 'https://discord.gg/seikoyt', label: 'Discord' },
    ];

    const exploreLinks = [
        { name: 'Inicio', tab: 'home' },
        { name: 'Películas', tab: 'movies' },
        { name: 'Series Gacha', tab: 'series' },
    ];

    const supportLinks = [
        { name: 'Términos de Uso', href: '/terms' },
        { name: 'Privacidad', href: '/privacy' },
        { name: 'Contacto', href: 'mailto:contacto@seikoyt.com' },
    ];

    return (
        <footer className="relative bg-[#0a0a0a] pt-16 pb-8 border-t border-[#ff0000] shadow-[0_-4px_20px_rgba(255,0,0,0.15)] z-10">
            <div className="max-w-7xl mx-auto px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 text-center md:text-left">
                    
                    {/* Column 1: Brand */}
                    <div className="space-y-6 flex flex-col items-center md:items-start">
                        <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate?.('home')}>
                            <span className="text-2xl font-[900] tracking-tighter text-white">
                                SEIKO<span className="text-red-600">YT</span>
                            </span>
                        </div>
                        <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
                            La plataforma definitiva de entretenimiento Gacha. Contenido de calidad creado por y para la comunidad.
                        </p>
                    </div>

                    {/* Column 2: Explore */}
                    <div className="space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-[0.2em] text-white">Explora</h4>
                        <ul className="space-y-4">
                            {exploreLinks.map((link) => (
                                <li key={link.name}>
                                    <button 
                                        onClick={() => onNavigate?.(link.tab)}
                                        className="text-gray-500 hover:text-red-500 transition-colors text-sm font-medium bg-transparent border-none cursor-pointer p-0"
                                    >
                                        {link.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Column 3: Support */}
                    <div className="space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-[0.2em] text-white">Soporte</h4>
                        <ul className="space-y-4">
                            {supportLinks.map((link) => (
                                <li key={link.name}>
                                    <a 
                                        href={link.href} 
                                        target={link.href.startsWith('http') ? '_blank' : '_self'}
                                        rel="noopener noreferrer"
                                        className="text-gray-500 hover:text-red-500 transition-colors text-sm font-medium"
                                    >
                                        {link.name}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Column 4: Social */}
                    <div className="space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-[0.2em] text-white">Social</h4>
                        <div className="flex justify-center md:justify-start gap-4">
                            {socialLinks.map((social, idx) => (
                                <motion.a
                                    key={idx}
                                    href={social.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    whileHover={{ y: -3, scale: 1.1 }}
                                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-gray-400 hover:text-red-600 hover:bg-red-600/10 transition-all duration-300 border border-white/5 hover:border-red-600/50"
                                    aria-label={social.label}
                                >
                                    {social.icon}
                                </motion.a>
                            ))}
                        </div>
                        <div className="pt-4 border-t border-white/5 md:border-none">
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black italic">
                                #StayGacha
                            </p>
                        </div>
                    </div>
                </div>

                {/* Final Credits Footer */}
                <div className="mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest text-center">
                        © {currentYear} SEIKOYT. TODOS LOS DERECHOS RESERVADOS.
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-600 font-bold uppercase tracking-widest">
                        <span>Hecho con</span>
                        <Heart size={10} className="text-red-600 fill-current animate-pulse" />
                        <span>por el Team Seiko</span>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
