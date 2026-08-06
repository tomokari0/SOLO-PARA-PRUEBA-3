import React, { useMemo } from 'react';
import { SubtitleCue } from '../utils/autoSubtitles';

interface AutoSubtitleOverlayProps {
  currentTime: number;
  cues: SubtitleCue[];
  isVisible: boolean;
  className?: string;
}

export const AutoSubtitleOverlay: React.FC<AutoSubtitleOverlayProps> = ({
  currentTime,
  cues,
  isVisible,
  className = ''
}) => {
  const activeCue = useMemo(() => {
    if (!isVisible || !cues || cues.length === 0) return null;
    return cues.find(c => currentTime >= c.start && currentTime <= c.end);
  }, [currentTime, cues, isVisible]);

  if (!isVisible || !activeCue) return null;

  return (
    <div className={`absolute bottom-16 sm:bottom-20 md:bottom-24 inset-x-0 z-[160] flex flex-col items-center justify-center px-4 pointer-events-none transition-all duration-300 animate-fade-in ${className}`}>
      <div className="max-w-xl md:max-w-2xl bg-black/85 backdrop-blur-md border border-white/15 px-4 py-2.5 sm:px-6 sm:py-3 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.8)] text-center flex flex-col items-center gap-1.5 select-none">
        
        {/* On-Screen Text Badge (Visual OCR / Text appearing in video) */}
        {activeCue.onScreenText && (
          <div className="inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold tracking-wide shadow-sm animate-pulse">
            <span className="text-xs">📺</span>
            <span>{activeCue.onScreenText.replace(/^\[|\]$/g, '')}</span>
          </div>
        )}

        {/* Action / Sound Effect SDH Badge */}
        {activeCue.actionTag && (
          <div className="inline-flex items-center gap-1 bg-red-600/25 text-red-400 border border-red-500/40 px-2.5 py-0.5 rounded-md text-[11px] sm:text-xs font-semibold italic">
            <span>🎬</span>
            <span>{activeCue.actionTag}</span>
          </div>
        )}

        {/* Spoken Dialogue Line */}
        {activeCue.text && (
          <p className="text-white text-sm sm:text-base md:text-lg font-medium tracking-wide leading-snug drop-shadow-md">
            {activeCue.text}
          </p>
        )}
      </div>
    </div>
  );
};

export default AutoSubtitleOverlay;
