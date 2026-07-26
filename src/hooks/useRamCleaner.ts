import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Custom hook to clean up memory when changing sections in the SPA.
 * It nullifies references to large objects and clears potential memory leaks.
 */
const useRamCleaner = () => {
  const location = useLocation();

  useEffect(() => {
    console.log(`[RAM Cleaner] Section changed to: ${location.pathname}. Cleaning memory...`);

    // 1. Clear any global intervals or timeouts that might be running
    // (This is a generic approach, specific ones should be cleared in their own components)
    const highestId = window.setTimeout(() => {
      for (let i = highestId; i > 0; i--) {
        window.clearTimeout(i);
        window.clearInterval(i);
      }
    }, 0);

    // 2. Suggest Garbage Collection (if possible, though not standard)
    // In some environments, window.gc() exists, but not in standard browsers.
    // Instead, we ensure large objects are eligible for GC by nullifying them.
    
    // 3. Clear any large caches or state that isn't needed
    // (Example: clearing a global video buffer if we had one)
    if ((window as any).videoBuffer) {
      (window as any).videoBuffer = null;
    }

    // 4. Clear any large canvas data if applicable
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, 1, 1);
    });

    // 5. Force a small delay to allow the browser to breathe
    // This isn't direct RAM cleaning, but helps with perceived performance.
    
    return () => {
      // Cleanup logic if needed when leaving the current section
    };
  }, [location.pathname]);
};

export default useRamCleaner;
