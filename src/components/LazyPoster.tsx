import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LazyPosterProps {
  src: string;
  alt: string;
  className?: string;
  aspectRatio?: string;
}

const LazyPoster: React.FC<LazyPosterProps> = ({ src, alt, className = "", aspectRatio = "2/3" }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = src;
    img.onload = () => setIsLoaded(true);
    img.onerror = () => setError(true);
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-red-600 ${className}`} style={{ aspectRatio }}>
      <AnimatePresence>
        {!isLoaded && !error && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-red-600 flex items-center justify-center"
          >
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>

      {isLoaded && !error && (
        <motion.img
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      )}

      {error && (
        <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center text-white text-xs text-center p-2">
          Error al cargar póster
        </div>
      )}
    </div>
  );
};

export default LazyPoster;
