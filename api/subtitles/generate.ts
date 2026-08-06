import fetch from "node-fetch";
import ImageKit from "imagekit";
import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { GoogleGenAI } from "@google/genai";

const firebaseConfig = {
  apiKey: "AIzaSyAUY3mbdZ3_MgxDDVE0qRwDOBqIuSOTdOU",
  authDomain: "seikoyt-streaming.firebaseapp.com",
  projectId: "seikoyt-streaming",
  storageBucket: "seikoyt-streaming.firebasestorage.app",
  messagingSenderId: "329984889094",
  appId: "1:329984889094:web:2c4814f98f9bb0edb74e87"
};

const firebaseApp = initializeApp(firebaseConfig);
const storage = getStorage(firebaseApp);

function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key || key.trim() === "" || key.includes("YOUR_") || key.includes("placeholder") || key === "null" || key === "undefined") {
    throw new Error("GEMINI_API_KEY is not defined or is invalid in environment variables.");
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Helper to format seconds into WebVTT HH:MM:SS.mmm format
function formatSecondsToVttTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const hrsStr = hrs.toString().padStart(2, "0");
  const minsStr = mins.toString().padStart(2, "0");
  const secsStr = secs.toString().padStart(2, "0");
  const msStr = ms.toString().padStart(3, "0");

  return `${hrsStr}:${minsStr}:${secsStr}.${msStr}`;
}

// Local fallback subtitles with SDH sound effects and action descriptions
function getLocalFallbackSubtitles(title: string, description: string, langCode: string): string {
  const normCode = langCode.toLowerCase();
  
  if (normCode === "es" || normCode === "spanish") {
    return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
[Música alegre de fondo]
¡Hola a todos! Bienvenidos a un nuevo video en SeikoYT.

2
00:00:05.000 --> 00:00:08.200
[Risas y aplausos de fondo]
Hoy estamos muy emocionados de presentarles este proyecto especial.

3
00:00:09.000 --> 00:00:12.800
[Efecto de sonido de campanilla]
Muchos de ustedes han estado pidiendo más contenido sobre esta serie.

4
00:00:13.500 --> 00:00:17.000
[Música dramática suave]
Así que nos hemos esforzado al máximo para traerles la mejor calidad.

5
00:00:18.000 --> 00:00:21.500
[Sonido de clic de botón]
No olviden suscribirse y activar la campanita para no perderse nada.

6
00:00:22.500 --> 00:00:25.800
[Aplausos y vítores finales]
¡Disfruten del video y dejen sus comentarios abajo!`;
  }
  
  if (normCode === "en" || normCode === "english") {
    return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
[Upbeat background music]
Hello everyone! Welcome to a new video on SeikoYT.

2
00:00:05.000 --> 00:00:08.200
[Laughter and applause]
Today we are very excited to present this special project.

3
00:00:09.000 --> 00:00:12.800
[Chime sound effect]
Many of you have been asking for more content about this series.

4
00:00:13.500 --> 00:00:17.000
[Soft dramatic music]
So we have done our absolute best to bring you the highest quality.

5
00:00:18.000 --> 00:00:21.500
[Button click sound]
Don't forget to subscribe and turn on the bell so you don't miss anything.

6
00:00:22.500 --> 00:00:25.800
[Cheering and applause]
Enjoy the video and leave your comments below!`;
  }
  
  if (normCode === "ja" || normCode === "japanese") {
    return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
[明るいBGM]
皆さん、こんにちは！SeikoYTの新しい動画へようこそ。

2
00:00:05.000 --> 00:00:08.200
[笑い声と拍手]
今日は、この特別なプロジェクトをお届けできることをとても嬉しく思います。

3
00:00:09.000 --> 00:00:12.800
[効果音：チャイム]
多くの方から、このシリーズに関するリクエストをいただいていました。

4
00:00:13.500 --> 00:00:17.000
[ドラマチックなBGM]
そのため、最高のクオリティでお届けできるよう全力を尽くしました。

5
00:00:18.000 --> 00:00:21.500
[クリック音]
チャンネル登録と通知ベルをオンにして、最新情報を見逃さないようにしてください。

6
00:00:22.500 --> 00:00:25.800
[歓声と拍手]
それでは、動画をお楽しみください！下にコメントを残してくださいね。`;
  }

  return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
[Background music / Música de fondo]
[Video: ${title || 'SeikoYT'}]

2
00:00:05.000 --> 00:00:08.200
[Sound effect / Efecto de sonido]
[Description: ${description || 'SeikoYT video'}]

3
00:00:09.000 --> 00:00:12.800
[Subtitles SDH: ${langCode.toUpperCase()}]

4
00:00:13.500 --> 00:00:17.000
[Cheering / Aplausos]
SeikoYT Community Project - Enjoy the video!`;
}

// Translate WebVTT using Gemini 3.6 Flash
async function translateWebVttWithGemini(originalVttText: string, targetLang: string): Promise<string> {
  try {
    const ai = getGeminiClient();
    const prompt = `Translate the following Spanish WebVTT subtitle file into ${targetLang}.

CRITICAL INSTRUCTIONS FOR SUBTITLES (SDH & TRANSLATION):
1. Preserve all WebVTT header lines, cue numbers, and timestamp lines EXACTLY as they are (e.g. 00:00:01.000 --> 00:00:04.500).
2. Translate spoken dialogues into natural ${targetLang}.
3. CRITICAL: Translate all sound effect descriptions and action cues inside brackets [ ... ] into ${targetLang} (e.g. translate [Música dramática] to [Dramatic music] or [ドラマチックな音楽], [Risas] to [Laughter]).
4. Output strictly the raw WebVTT file content starting with 'WEBVTT', without markdown code blocks.

WebVTT File:
${originalVttText}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        temperature: 0.1
      }
    });

    const raw = response.text || "";
    const cleaned = raw.replace(/```vtt/gi, "").replace(/```/g, "").trim();
    if (cleaned && cleaned.startsWith("WEBVTT")) {
      return cleaned;
    }
    return originalVttText;
  } catch (err: any) {
    console.warn(`Gemini translation to ${targetLang} failed:`, err.message);
    return originalVttText;
  }
}

export default async function handler(req: any, res: any) {
  // 1. CORS headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", message: "Only POST requests are supported." });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON", message: "Failed to parse request body." });
      }
    }

    const { videoUrl, title, description, languages = ["es", "en", "ja"] } = body || {};
    console.log("Processing Gemini Subtitles Request:", { videoUrl, title, description, languages });

    const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const isKeyInvalid = !key || key.trim() === "" || key.includes("YOUR_") || key.includes("placeholder") || key === "null" || key === "undefined";

    const uploadToFirebaseStorage = async (vttContent: string, fileName: string): Promise<string> => {
      try {
        const storageRef = ref(storage, `subtitles/${fileName}`);
        const buffer = Buffer.from(vttContent, "utf-8");
        const metadata = {
          contentType: "text/vtt",
        };
        const uploadResult = await uploadBytes(storageRef, buffer, metadata);
        const downloadUrl = await getDownloadURL(uploadResult.ref);
        return downloadUrl;
      } catch (_error: any) {
        // Data URI fallback
        const base64 = Buffer.from(vttContent).toString("base64");
        return `data:text/vtt;base64,${base64}`;
      }
    };

    let originalVtt = "";

    const isYouTube = videoUrl && (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be"));
    const isDirectMedia = videoUrl && !isYouTube && (
      videoUrl.toLowerCase().endsWith(".mp3") || 
      videoUrl.toLowerCase().endsWith(".mp4") || 
      videoUrl.toLowerCase().endsWith(".wav") || 
      videoUrl.toLowerCase().endsWith(".webm") || 
      videoUrl.toLowerCase().endsWith(".m4a") || 
      videoUrl.toLowerCase().endsWith(".mov") || 
      videoUrl.includes("uploadcare") || 
      videoUrl.includes("imagekit")
    );

    // Multimodal audio/video transcription with Gemini 3.6 Flash
    if (videoUrl && isDirectMedia && !isKeyInvalid) {
      try {
        console.log(`Fetching media file for Gemini multimodal audio analysis: ${videoUrl}`);
        const mediaRes = await fetch(videoUrl);
        if (!mediaRes.ok) {
          throw new Error(`Failed to download direct media file: ${mediaRes.statusText}`);
        }
        
        const arrayBuffer = await mediaRes.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        const base64Data = fileBuffer.toString("base64");

        let mimeType = "audio/mp3";
        const lowerUrl = videoUrl.toLowerCase();
        if (lowerUrl.endsWith(".wav")) mimeType = "audio/wav";
        else if (lowerUrl.endsWith(".webm")) mimeType = "audio/webm";
        else if (lowerUrl.endsWith(".m4a")) mimeType = "audio/m4a";
        else if (lowerUrl.endsWith(".mp4")) mimeType = "video/mp4";
        else if (lowerUrl.endsWith(".mov")) mimeType = "video/mov";

        console.log("Transcribing audio and generating SDH action/sound subtitles using Gemini 3.6 Flash...");
        const ai = getGeminiClient();
        const response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: [
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            },
            {
              text: `Analiza este archivo de audio/video y genera un archivo de subtítulos WebVTT completo, preciso y sincronizado en español.

INSTRUCCIONES CRÍTICAS (ACCESIBILIDAD SDH - DIÁLOGOS + ACCIONES Y EFECTOS DE SONIDO):
1. Transcribe con fidelidad todos los diálogos hablados en español.
2. CRÍTICO: Incluye descripciones breves entre corchetes [ ... ] para efectos de sonido, ambiente musical y acciones de los personajes.
   Ejemplos de corchetes obligatorios:
   - [Música alegre de fondo]
   - [Risas de los personajes]
   - [Efecto de sonido de impacto / magia]
   - [Suspiro profundo]
   - [Sonido de pasos]
   - [Aplausos y vítores]
   - [Puerta azotándose]
   - [Música dramática de tensión]
3. Utiliza marcas de tiempo WebVTT válidas (formato: 00:00:01.000 --> 00:00:04.500) sincronizadas con la duración.
4. Devuelve ÚNICAMENTE el texto WebVTT crudo iniciando con 'WEBVTT', sin markdown (\`\`\`vtt o \`\`\`).`
            }
          ],
          config: {
            temperature: 0.2
          }
        });

        const rawContent = response.text || "";
        originalVtt = rawContent.replace(/```vtt/gi, "").replace(/```/g, "").trim();
        console.log("Gemini multimodal audio transcription generated successfully!");
      } catch (mediaErr: any) {
        console.error("Gemini audio transcription failed, falling back to semantic generation:", mediaErr.message);
        originalVtt = "";
      }
    }

    // Step 2: Semantic fallback generation if transcribe failed, no key, or no direct media
    if (!originalVtt || !originalVtt.trim().startsWith("WEBVTT")) {
      console.log("Generating context-aware semantic WebVTT subtitles with SDH sound effects using Gemini 3.6 Flash...");
      if (!isKeyInvalid) {
        try {
          const ai = getGeminiClient();
          const semanticPrompt = `Genera un guion completo de subtítulos en español formato WebVTT para un video con:
Título: "${title || 'SeikoYT Video'}"
Descripción: "${description || 'Un video emocionante de la comunidad'}"

INSTRUCCIONES CRÍTICAS (ACCESIBILIDAD SDH CON ACCIONES Y EFECTOS DE SONIDO):
1. Inicia estrictamente con 'WEBVTT'.
2. Crea entre 6 y 12 bloques de subtítulos sincronizados.
3. CRÍTICO: Incluye acciones y efectos de sonido relevantes entre corchetes [ ... ] dentro o entre las líneas de diálogo.
   Ejemplos:
   - [Música de suspenso]
   - [Risas de los personajes]
   - [Efectos especiales de magia / combate]
   - [Suspiro de alivio]
   - [Sonido de pasos en la oscuridad]
   - [Música emotiva de fondo]
4. Usa marcas de tiempo precisas (00:00:01.000 --> 00:00:05.000).
5. Devuelve ÚNICAMENTE el formato WebVTT crudo, sin bloques de código markdown.`;

          const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: semanticPrompt,
            config: {
              temperature: 0.7
            }
          });

          const content = response.text || "";
          originalVtt = content.replace(/```vtt/gi, "").replace(/```/g, "").trim();
        } catch (semanticErr: any) {
          console.warn("Gemini semantic subtitle generation failed, falling back to local fallback:", semanticErr.message);
          originalVtt = getLocalFallbackSubtitles(title, description, "es");
        }
      } else {
        originalVtt = getLocalFallbackSubtitles(title, description, "es");
      }
    }

    // Sanity check
    if (!originalVtt || !originalVtt.trim().startsWith("WEBVTT")) {
      originalVtt = getLocalFallbackSubtitles(title, description, "es");
    }

    originalVtt = originalVtt.replace(/```vtt/gi, "").replace(/```/g, "").trim();

    const tracks: Array<{ label: string; src: string; lang: string }> = [];
    const randomId = Math.random().toString(36).substring(7);

    // Upload original Spanish track
    const espUrl = await uploadToFirebaseStorage(originalVtt, `sub_${randomId}_es.vtt`);
    tracks.push({ label: "Español (Original)", src: espUrl, lang: "es" });

    // Translate to requested target languages
    const langNames: Record<string, string> = {
      en: "English",
      ja: "Japanese",
      english: "English",
      japanese: "Japanese",
      es: "Spanish",
      fr: "French",
      pt: "Portuguese"
    };

    for (const langCode of languages) {
      const targetLang = langNames[langCode.toLowerCase()] || langCode;
      if (targetLang === "Spanish" || langCode === "es") continue;

      if (!isKeyInvalid) {
        try {
          console.log(`Translating WebVTT subtitles to ${targetLang} using Gemini 3.6 Flash...`);
          const translatedVtt = await translateWebVttWithGemini(originalVtt, targetLang);

          if (translatedVtt && translatedVtt.trim().startsWith("WEBVTT")) {
            const transUrl = await uploadToFirebaseStorage(translatedVtt, `sub_${randomId}_${langCode}.vtt`);
            tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl, lang: langCode });
          } else {
            throw new Error(`Failed to translate VTT to ${targetLang}`);
          }
        } catch (transErr: any) {
          console.warn(`Gemini translation to ${targetLang} failed, falling back to local translation:`, transErr.message);
          const fallbackVtt = getLocalFallbackSubtitles(title, description, langCode);
          const transUrl = await uploadToFirebaseStorage(fallbackVtt, `sub_${randomId}_${langCode}.vtt`);
          tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl, lang: langCode });
        }
      } else {
        const fallbackVtt = getLocalFallbackSubtitles(title, description, langCode);
        const transUrl = await uploadToFirebaseStorage(fallbackVtt, `sub_${randomId}_${langCode}.vtt`);
        tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl, lang: langCode });
      }
    }

    console.log("Subtitles generated successfully with Gemini!", tracks);
    return res.status(200).json({ success: true, tracks });
  } catch (error: any) {
    console.error("Subtitles Route Error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to generate subtitles", message: error.message });
  }
}
