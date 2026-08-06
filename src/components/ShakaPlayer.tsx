import React, { useEffect, useRef, useState } from 'react';
import shaka from 'shaka-player';

interface ShakaPlayerProps {
  src: string;
  className?: string;
  onClose?: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  subtitles?: { label: string; src: string }[];
}

const ShakaPlayer: React.FC<ShakaPlayerProps> = ({ src, className, onClose, videoRef, subtitles }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<shaka.Player | null>(null);

  useEffect(() => {
    const handleFullScreenChange = () => {
      if (document.fullscreenElement === containerRef.current) {
        // Entrando a pantalla completa
        if (screen.orientation && (screen.orientation as any).lock) {
          (screen.orientation as any).lock('landscape').catch((err: any) => {
            console.warn('Could not lock orientation:', err);
          });
        }
      } else {
        // Saliendo de pantalla completa
        if (screen.orientation && (screen.orientation as any).unlock) {
          (screen.orientation as any).unlock();
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let activePlayer: shaka.Player | null = null;

    const initPlayer = async () => {
      if (!videoRef.current) return;

      // Install polyfills
      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        console.warn('Browser not supported for Shaka Player, playing natively');
        if (!isCancelled && videoRef.current) {
          videoRef.current.src = src;
        }
        return;
      }

      const newPlayer = new shaka.Player(videoRef.current);
      activePlayer = newPlayer;
      if (!isCancelled) {
        setPlayer(newPlayer);
      }
      
      // Aggressive buffering configuration
      newPlayer.configure({
        streaming: {
          bufferingGoal: 60, // Buffer up to 60 seconds ahead
          rebufferingGoal: 15, // Start playback only when 15 seconds are buffered
          bufferBehind: 30, // Keep 30 seconds of buffer behind
          retryParameters: {
            maxAttempts: 5,
            baseDelay: 1000,
            backoffFactor: 2,
          },
        },
      });

      try {
        await newPlayer.load(src);
        if (isCancelled) {
          await newPlayer.destroy().catch(() => {});
          return;
        }
        console.log('Video loaded successfully with Shaka Player');
        if (videoRef.current) {
          videoRef.current.play().catch(e => console.warn('Autoplay on next episode failed:', e));
        }
      } catch (error: any) {
        if (isCancelled) return;
        console.warn('Shaka Player load failed, falling back gracefully to native video element:', error?.message || error);
        
        try {
          await newPlayer.destroy();
        } catch (detachErr) {
          // Ignore detach error during cleanup
        }

        activePlayer = null;
        setPlayer(null);

        // Fallback to native HTML5 video player
        if (videoRef.current) {
          videoRef.current.src = src;
          try {
            videoRef.current.load();
            videoRef.current.play().catch(() => {});
          } catch (e) {}
        }
      }
    };

    initPlayer();

    return () => {
      isCancelled = true;
      if (activePlayer) {
        activePlayer.destroy().catch((err) => console.warn('Error destroying Shaka instance:', err));
      }
    };
  }, [src]);

  return (
    <div ref={containerRef} className={`relative bg-black w-full h-full ${className}`}>
      <video
        ref={videoRef}
        className="w-full h-full"
        autoPlay
        playsInline
        crossOrigin="anonymous"
      >
        {subtitles && subtitles.map((sub, index) => (
          <track
            key={`${sub.src}_${index}`}
            label={sub.label}
            src={sub.src}
            kind="subtitles"
            srcLang="es"
          />
        ))}
      </video>
      {onClose && (
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-50 bg-red-600 text-white p-2 rounded-full hover:bg-red-700 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ShakaPlayer;
