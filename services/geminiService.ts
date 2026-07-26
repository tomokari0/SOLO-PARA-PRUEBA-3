/**
 * SEIKOYT - Client Side Gemini Service Proxy
 * 
 * Este archivo contiene proxies seguros que realizan llamadas al backend
 * para interactuar con la API de Gemini, evitando exponer claves y previniendo
 * errores de sandbox de iframe ("Cannot set property fetch of #<Window> which has only a getter")
 * al no inicializar el SDK de GoogleGenAI directamente en el navegador.
 */

export const sendMessageToChatbot = async (message: string): Promise<string> => {
  try {
    const response = await fetch('/api/gemini/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.text || "¡Hola crack! ✨ Tuve un pequeño inconveniente procesando tu mensaje. Intenta de nuevo por favor.";
  } catch (error) {
    console.error("Error client calling gemini chat:", error);
    return "Lo siento vv, tuve un error de conexión con mi cerebro artificial. ✨ Intenta de nuevo en un ratito.";
  }
};

// Funciones preparadas por compatibilidad
export const editImageWithPrompt = async (base64Image: string, mimeType: string, prompt: string): Promise<string | null> => {
  console.warn("editImageWithPrompt no está implementado en cliente");
  return null;
};

export const generateImageWithPrompt = async (prompt: string): Promise<string | null> => {
  console.warn("generateImageWithPrompt no está implementado en cliente");
  return null;
};

export const searchWithGrounding = async (query: string): Promise<{ text: string; sources: any[] }> => {
  console.warn("searchWithGrounding no está implementado en cliente");
  return { text: "Grounding search no disponible", sources: [] };
};

export const getPersonalizedRecommendations = async (
  watchedTitles: string[],
  likedTitles: string[],
  searchQueries: string[],
  availableContent: any[]
): Promise<string[]> => {
  console.warn("getPersonalizedRecommendations no está implementado en cliente");
  return [];
};
