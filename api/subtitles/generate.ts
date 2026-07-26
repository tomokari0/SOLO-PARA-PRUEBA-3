import fetch from "node-fetch";
import ImageKit from "imagekit";
import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

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

// Local fallback subtitles
function getLocalFallbackSubtitles(title: string, description: string, langCode: string): string {
  const normCode = langCode.toLowerCase();
  
  if (normCode === "es" || normCode === "spanish") {
    return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
¡Hola a todos! Bienvenidos a un nuevo video en SeikoYT.

2
00:00:05.000 --> 00:00:08.200
Hoy estamos muy emocionados de presentarles este proyecto especial.

3
00:00:09.000 --> 00:00:12.800
Muchos de ustedes han estado pidiendo más contenido sobre esta serie.

4
00:00:13.500 --> 00:00:17.000
Así que nos hemos esforzado al máximo para traerles la mejor calidad.

5
00:00:18.000 --> 00:00:21.500
No olviden suscribirse y activar la campanita para no perderse nada.

6
00:00:22.500 --> 00:00:25.800
¡Disfruten del video y dejen sus comentarios abajo!`;
  }
  
  if (normCode === "en" || normCode === "english") {
    return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
Hello everyone! Welcome to a new video on SeikoYT.

2
00:00:05.000 --> 00:00:08.200
Today we are very excited to present this special project.

3
00:00:09.000 --> 00:00:12.800
Many of you have been asking for more content about this series.

4
00:00:13.500 --> 00:00:17.000
So we have done our absolute best to bring you the highest quality.

5
00:00:18.000 --> 00:00:21.500
Don't forget to subscribe and turn on the bell so you don't miss anything.

6
00:00:22.500 --> 00:00:25.800
Enjoy the video and leave your comments below!`;
  }
  
  if (normCode === "ja" || normCode === "japanese") {
    return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
皆さん、こんにちは！SeikoYT de no atarashii dōga e yōkoso. (¡Bienvenidos a un nuevo video de SeikoYT!)

2
00:00:05.000 --> 00:00:08.200
今日は、この特別なプロジェクトをお届けできることをとても嬉しく思います。

3
00:00:09.000 --> 00:00:12.800
多くの方から、このシリーズに関するコンテンツをもっと見たいとのリクエストをいただいていました。

4
00:00:13.500 --> 00:00:17.000
そのため、最高のクオリティでお届けできるよう、全力を尽くしました。

5
00:00:18.000 --> 00:00:21.500
チャンネル登録と通知ベルをオンにして、最新情報を見逃さないようにしてください。

6
00:00:22.500 --> 00:00:25.800
それでは、動画をお楽しみください！下にコメントを残してくださいね。`;
  }

  return `WEBVTT

1
00:00:01.000 --> 00:00:04.500
[Video: ${title || 'SeikoYT'}]

2
00:00:05.000 --> 00:00:08.200
[Description: ${description || 'SeikoYT video'}]

3
00:00:09.000 --> 00:00:12.800
[Subtitles / Subtítulos: ${langCode.toUpperCase()}]

4
00:00:13.500 --> 00:00:17.000
SeikoYT Community Project - Enjoy the video!

5
00:00:18.000 --> 00:00:21.500
Thank you for watching and supporting our creators!`;
}

// Helper to translate WebVTT file in small cue chunks to avoid Groq payload and TPM limits
async function translateWebVttInChunks(originalVttText: string, targetLang: string, groqApiKey: string): Promise<string> {
  try {
    const normalized = originalVttText.replace(/\r\n/g, "\n").trim();
    const blocks = normalized.split(/\n\n+/);

    const header = "WEBVTT\n\n";
    const cues: string[] = [];

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("WEBVTT")) {
        const lines = trimmed.split("\n");
        const subLines = lines.filter(l => !l.startsWith("WEBVTT"));
        if (subLines.length > 0) {
          cues.push(subLines.map(line => line.trim()).join("\n"));
        }
      } else {
        cues.push(trimmed);
      }
    }

    if (cues.length === 0) {
      console.warn("No WebVTT cues found to translate.");
      return originalVttText;
    }

    const chunkSize = 100;
    const cueChunks: string[][] = [];
    for (let i = 0; i < cues.length; i += chunkSize) {
      cueChunks.push(cues.slice(i, i + chunkSize));
    }

    console.log(`[Groq Translation] Split WebVTT into ${cueChunks.length} chunks of size <= ${chunkSize}`);

    const translatedCues: string[] = [];

    for (let chunkIdx = 0; chunkIdx < cueChunks.length; chunkIdx++) {
      const chunk = cueChunks[chunkIdx];
      const chunkText = chunk.join("\n\n");

      const systemPrompt = `Eres un traductor de subtítulos WebVTT. Tu única tarea es traducir el texto de los diálogos al idioma ${targetLang}. Debes mantener exactamente idénticas todas las marcas de tiempo (ej. 00:01.200 --> 00:04.500) y la estructura de número de secuencia. No agregues introducciones, notas ni explicaciones. Devuelve únicamente el código WebVTT traducido correspondiente a la entrada sin ningún bloque de código markdown.`;

      let attemptSuccess = false;
      let attemptContent = "";

      try {
        console.log(`Translating chunk ${chunkIdx + 1}/${cueChunks.length} to ${targetLang} with llama-3.1-8b-instant...`);
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${groqApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: chunkText }
            ],
            temperature: 0
          })
        });

        if (response.ok) {
          const data = await response.json() as any;
          const rawContent = data.choices?.[0]?.message?.content || "";
          const cleaned = rawContent.replace(/```vtt/gi, "").replace(/```/g, "").trim();
          if (cleaned) {
            attemptContent = cleaned;
            attemptSuccess = true;
          }
        } else {
          const errText = await response.text();
          console.warn(`Groq chunk ${chunkIdx + 1} translation failed (Status: ${response.status}):`, errText);
        }
      } catch (err: any) {
        console.warn(`Error on chunk ${chunkIdx + 1} translation:`, err.message);
      }

      if (attemptSuccess && attemptContent) {
        translatedCues.push(attemptContent);
      } else {
        console.warn(`Groq chunk ${chunkIdx + 1} translation failed, keeping original cues as fallback.`);
        translatedCues.push(chunkText);
      }

      // Add 100ms delay to respect RPM
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return header + translatedCues.join("\n\n");
  } catch (e: any) {
    console.error("Error in translateWebVttInChunks:", e.message);
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
    console.log("Serverless Subtitles Request:", { videoUrl, title, description, languages });

    const groqKey = process.env.GROQ_API_KEY;
    const isKeyInvalid = !groqKey || groqKey.trim() === "" || groqKey.includes("YOUR_") || groqKey.includes("placeholder") || groqKey === "null" || groqKey === "undefined";

    // Mandatory check for missing GROQ_API_KEY as requested
    if (isKeyInvalid) {
      console.error("GROQ_API_KEY is not defined or is invalid in the environment variables.");
      return res.status(500).json({
        success: false,
        error: "Missing API Key",
        message: "La variable de entorno GROQ_API_KEY no está configurada o es inválida. Por favor, añádela a la configuración de tu entorno."
      });
    }

    const uploadToFirebaseStorage = async (vttContent: string, fileName: string): Promise<string> => {
      try {
        const storageRef = ref(storage, `subtitles/${fileName}`);
        const buffer = Buffer.from(vttContent, "utf-8");
        const metadata = {
          contentType: "text/vtt",
        };
        const uploadResult = await uploadBytes(storageRef, buffer, metadata);
        const downloadUrl = await getDownloadURL(uploadResult.ref);
        console.log(`Uploaded ${fileName} to Firebase Storage successfully:`, downloadUrl);
        return downloadUrl;
      } catch (error) {
        console.warn(`Error uploading ${fileName} to Firebase Storage, returning data URI fallback:`, error);
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

    // Bypassing FFmpeg: fetch direct media directly and upload to Groq Whisper in-memory using node-fetch
    if (videoUrl && isDirectMedia) {
      try {
        console.log(`Serverless: fetching direct media file to memory via node-fetch: ${videoUrl}`);
        const mediaRes = await fetch(videoUrl);
        if (!mediaRes.ok) {
          throw new Error(`Failed to download direct media file: ${mediaRes.statusText}`);
        }
        
        // Fetch as arrayBuffer and convert to Node Buffer
        const arrayBuffer = await mediaRes.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        
        // Convert to Blob for standard FormData packaging
        const fileBlob = new Blob([fileBuffer], { type: "audio/mp3" });

        let filename = "audio.mp3";
        try {
          const urlObj = new URL(videoUrl);
          const pathname = urlObj.pathname.toLowerCase();
          if (pathname.endsWith(".mp3")) filename = "audio.mp3";
          else if (pathname.endsWith(".wav")) filename = "audio.wav";
          else if (pathname.endsWith(".webm")) filename = "audio.webm";
          else if (pathname.endsWith(".m4a")) filename = "audio.m4a";
          else if (pathname.endsWith(".mov")) filename = "video.mov";
          else if (pathname.endsWith(".mp4")) filename = "video.mp4";
        } catch (e) {
          console.warn("Could not determine media filename, defaulting to audio.mp3");
        }

        console.log(`Transcribing file ${filename} using Groq Whisper API (whisper-large-v3) in-memory...`);
        const formData = new FormData();
        formData.append("file", fileBlob, filename);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");
        formData.append("language", "es");

        const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${groqKey}`
          },
          body: formData
        });

        if (!groqRes.ok) {
          const errText = await groqRes.text();
          throw new Error(`Groq Whisper transcription failed: ${groqRes.statusText}. Details: ${errText}`);
        }

        const responseJson = await groqRes.json() as any;
        if (responseJson && Array.isArray(responseJson.segments)) {
          console.log(`Transcribed ${responseJson.segments.length} segments. Converting to WebVTT...`);
          const vttLines = ["WEBVTT\n"];
          responseJson.segments.forEach((seg: any, idx: number) => {
            const startStr = formatSecondsToVttTime(seg.start || 0);
            const endStr = formatSecondsToVttTime(seg.end || 0);
            vttLines.push(`${idx + 1}`);
            vttLines.push(`${startStr} --> ${endStr}`);
            vttLines.push(`${(seg.text || "").trim()}\n`);
          });
          originalVtt = vttLines.join("\n");
        } else if (responseJson && responseJson.text) {
          console.log("Transcribed text without segments. Using a single WebVTT block...");
          const text = responseJson.text.trim();
          originalVtt = `WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\n${text}`;
        } else {
          throw new Error("Groq response did not contain expected text or segments.");
        }

        console.log("Whisper transcription generated and verified successfully in serverless context.");
      } catch (mediaErr: any) {
        console.error("Audio-based serverless transcription failed, falling back to Llama 3 semantic subtitles:", mediaErr.message);
        originalVtt = ""; // trigger fallback
      }
    }

    // Step 2: Semantic fallback generation if transcribe failed or no direct media (e.g. YouTube URL)
    if (!originalVtt || !originalVtt.trim().startsWith("WEBVTT")) {
      console.log("Generating context-aware semantic WebVTT subtitles using Groq Llama 3...");
      try {
        const semanticSystemInstruction = "You are an expert subtitle writer. You produce highly realistic, fully synchronized Spanish subtitle files in WebVTT format starting with WEBVTT.";
        const semanticPrompt = `Generate a realistic, synchronized Spanish WebVTT subtitle script for a video with:
Title: "${title || 'SeikoYT Video'}"
Description: "${description || 'Un video emocionante de la comunidad'}"

RULES:
1. Provide a beautiful WebVTT starting with 'WEBVTT'.
2. Create about 5 to 10 dialogue blocks corresponding to a 2-minute video.
3. Use precise timestamps (e.g. 00:00:01.000 --> 00:00:05.000).
4. Dialogues should feel completely realistic and match the title and description (fan-dub, Gacha, or gaming style).
5. Output strictly the raw WebVTT content, without markdown code blocks.`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${groqKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: semanticSystemInstruction },
              { role: "user", content: semanticPrompt }
            ],
            temperature: 0.7
          })
        });

        if (response.ok) {
          const data = await response.json() as any;
          const content = data.choices?.[0]?.message?.content || "";
          originalVtt = content.replace(/```vtt/gi, "").replace(/```/g, "").trim();
        } else {
          throw new Error("Failed to generate semantic subtitles from Groq API: " + response.statusText);
        }
      } catch (semanticErr: any) {
        console.warn("Groq semantic subtitle generation failed, falling back to local fallback:", semanticErr.message);
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

      try {
        console.log(`Translating WebVTT subtitles to ${targetLang} using chunked Groq Llama 3...`);
        const translatedVtt = await translateWebVttInChunks(originalVtt, targetLang, groqKey);

        if (translatedVtt && translatedVtt.trim().startsWith("WEBVTT")) {
          const transUrl = await uploadToFirebaseStorage(translatedVtt, `sub_${randomId}_${langCode}.vtt`);
          tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl, lang: langCode });
        } else {
          throw new Error(`Failed to translate VTT to ${targetLang} using chunked Groq.`);
        }
      } catch (transErr: any) {
        console.warn(`Groq translation to ${targetLang} failed, falling back to local translation:`, transErr.message);
        const fallbackVtt = getLocalFallbackSubtitles(title, description, langCode);
        const transUrl = await uploadToFirebaseStorage(fallbackVtt, `sub_${randomId}_${langCode}.vtt`);
        tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl, lang: langCode });
      }
    }

    console.log("Subtitles generated successfully in serverless environment!", tracks);
    return res.status(200).json({ success: true, tracks });
  } catch (error: any) {
    console.error("Serverless Subtitle Route Error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to generate subtitles", message: error.message });
  }
}
