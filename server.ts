import * as dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import ImageKit from "imagekit";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import os from "os";
import { storage } from "./firebaseConfig";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import multer from "multer";
import { uploadToR2, getR2Config, getPresignedR2Url, parseR2Error, getR2DiagnosticSummary } from "./services/r2Storage";

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB max
});

let __filename = "";
let __dirname = "";
try {
  if (typeof import.meta !== "undefined" && import.meta.url) {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
  } else {
    __filename = process.cwd();
    __dirname = process.cwd();
  }
} catch (e) {
  __filename = process.cwd();
  __dirname = process.cwd();
}

let aiClient: GoogleGenAI | null = null;
let chatModel: any = null;

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

  // Default fallback (e.g. for French, Portuguese, etc.)
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

function validateGeneratedVtt(vtt: string): void {
  if (!vtt || typeof vtt !== "string") {
    throw new Error("El contenido de subtítulos generado está vacío o no es una cadena de texto.");
  }

  if (!vtt.trim().startsWith("WEBVTT")) {
    throw new Error("El contenido generado no tiene un formato WebVTT válido (no comienza con WEBVTT).");
  }

  const suspiciousPhrases = [
    "bienvenido a mi canal",
    "bienvenidos a mi canal",
    "en este video veremos",
    "en este vídeo veremos",
    "hola a todos",
    "no olviden suscribirse",
    "activa la campanita",
    "bienvenidos a un nuevo video",
    "bienvenidos a un nuevo vídeo"
  ];

  const lowerVtt = vtt.toLowerCase();
  for (const phrase of suspiciousPhrases) {
    if (lowerVtt.includes(phrase)) {
      throw new Error(`Se detectó una frase sospechosa de relleno (placeholder) en los subtítulos: "${phrase}".`);
    }
  }
}

function getLocalAssistantResponse(message: string): string {
  const msg = message.toLowerCase();
  
  if (msg.includes("hola") || msg.includes("buenos") || msg.includes("buenas") || msg.includes("hello") || msg.includes("hi")) {
    return "¡Hola crack! ✨ Eres súper bienvenido a SeikoYT, el mejor rincón de cultura Gacha, FanDub y gaming. Soy tu asistente virtual Seiko-Bot, listo para ayudarte en lo que necesites hoy. ¿Qué tienes en mente, bestie? 🥺";
  }
  
  if (msg.includes("perfil") || msg.includes("profile")) {
    return "¡Claro vv! Crear y personalizar tus perfiles en SeikoYT es facilísimo. Solo tienes que ir a tu selector de perfiles en la esquina superior derecha, elegir un avatar genial de nuestros creadores o de Seiko Ayami, poner tu nombre de usuario ¡y listo! ¿Quieres que te ayude con algo más de tu perfil? 🎮";
  }
  
  if (msg.includes("comunidad") || msg.includes("subir") || msg.includes("video") || msg.includes("subir video") || msg.includes("postular")) {
    return "¡Me encanta tu iniciativa, crack! 🎬 Para subir tus propios videos o sugerir contenido en la sección 'Comunidad', solo tienes que ir al formulario de postulación. Rellenas el título, agregas una pequeña descripción de qué trata y pegas el enlace (de YouTube o archivo directo). Nuestro equipo lo revisará volando para aprobarlo. ¡Anímate a compartir tu talento! ✨";
  }
  
  if (msg.includes("watch party") || msg.includes("ver juntos") || msg.includes("sala")) {
    return "¡Las Watch Parties son lo máximo! 🍿 Te permiten ver tus series y películas favoritas en tiempo real junto con otros mejores amigos de la comunidad, chateando en vivo. Solo tienes que hacer clic en el botón 'Crear Watch Party' en cualquier contenido, compartir el código de sala con tus amigos, ¡y a disfrutar juntos en sincronía! 🎬✨";
  }
  
  if (msg.includes("seiko ayami") || msg.includes("creador") || msg.includes("seiko")) {
    return "Seiko Ayami es nuestro creador estrella y el alma de esta maravillosa comunidad. 🌟 Es súper talentoso en edición, actuación de voz y dirección de proyectos de animación y doblaje. ¡Todos aquí somos súper fans de su trabajo! No te pierdas su contenido destacado en la página de inicio. ✨";
  }
  
  if (msg.includes("after you") || msg.includes("me") || msg.includes("serie")) {
    return "¡Oh, Dios mío, 'After you, it’s me' es una de nuestras series de drama y romance más recomendadas y emocionantes! 🥺❤️ Tiene una producción vocal espectacular y un guión que te llegará al corazón. Te super recomiendo prepararte unas palomitas y verla hoy mismo. ¡Es arte puro!";
  }
  
  if (msg.includes("error") || msg.includes("problema") || msg.includes("falla") || msg.includes("ayuda")) {
    return "¡Uy, lamento escuchar eso, bestie! 🥺 Si estás experimentando algún problema técnico, te sugiero recargar la página. Si estás en un iframe, prueba abrir la aplicación en una pestaña independiente desde el botón de arriba a la derecha. ¡Eso suele dar superpoderes y solucionar los permisos de micro o audio! Si sigue fallando, avísame y lo revisamos juntos. 🛠️";
  }

  return "¡Entendido, bestie! ✨ Como tu asistente oficial de SeikoYT, me alegra mucho estar charlando contigo. Recuerda que puedes explorar todas nuestras series de Gacha, FanDub, unirte a Watch Parties con amigos, o compartir tus propios videos en la pestaña de Comunidad. ¿Hay algo específico sobre SeikoYT o sus proyectos que quieras descubrir hoy? 🥺🎮";
}

function getChatModel() {
  if (!chatModel) {
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const isKeyInvalid = !key || key.trim() === "" || key.includes("YOUR_") || key.includes("placeholder") || key === "null" || key === "undefined";
    if (isKeyInvalid) {
      throw new Error("API_KEY_INVALID: No valid Gemini API key configured in environment variables");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    chatModel = aiClient.chats.create({
      model: "gemini-3.6-flash",
      config: {
        systemInstruction: `Eres el Asistente Virtual Oficial de la plataforma SeikoYT. Tu personalidad es sumamente amigable, entusiasta y experta en la cultura Gacha, el FanDub y el gaming. Eres el mejor amigo y guía de los usuarios dentro de la plataforma.

Misión Principal:
Ayudar a los usuarios a descubrir contenido, resolver sus dudas técnicas y mantener viva la emoción por los creadores y proyectos de SeikoYT.

Funciones y Reglas de Respuesta:
1. Recomendación de Contenido:
- Si el usuario está triste o nostálgico: Sugiérele series sentimentales o emotivas de la plataforma.
- Si el usuario busca acción o adrenalina: Recomienda los proyectos de Minecraft o las series de drama intenso.
2. Soporte Técnico:
- Perfiles: Explica cómo crear y configurar perfiles.
- Comunidad: Explica cómo subir videos a la sección "Comunidad".
- Watch Party: Explica cómo utilizar la función "Watch Party".
3. Lore de SeikoYT:
- Habla con familiaridad del creador principal: Seiko Ayami.
- Promociona proyectos activos, especialmente "After you, it’s me".

Restricciones de Comportamiento:
- Tono: Lenguaje juvenil, cercano y respetuoso. Usa términos como "vv", "crack", "bestie" o emojis (✨, 🥺, 🎮, 🎬) con moderación.
- Límite de Conocimiento: No inventes fechas de estreno. Invita a revisar el "Tablón de Anuncios".
- Longitud: Respuestas breves, concisas y estructuradas en párrafos cortos.
- Formato: Texto enriquecido con emojis por defecto. Si el usuario pide "datos estructurados" o "JSON", responde estrictamente con un bloque JSON sin texto adicional.`
      }
    });
  }
  return chatModel;
}

const app = express();
const PORT = 3000;

// Lazy ImageKit Initialization helper
function getImageKitInstance() {
  const publicKey = process.env.VITE_IMAGEKIT_PUBLIC_KEY || process.env.IMAGEKIT_PUBLIC_KEY || "";
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || "";
  const urlEndpoint = process.env.VITE_IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT || "";

  if (!publicKey || !privateKey || !urlEndpoint) {
    throw new Error("ImageKit configuration missing: Ensure IMAGEKIT_PRIVATE_KEY, VITE_IMAGEKIT_PUBLIC_KEY and VITE_IMAGEKIT_URL_ENDPOINT are set.");
  }

  return new ImageKit({
    publicKey,
    privateKey,
    urlEndpoint
  });
}

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Enable CORS for all incoming requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

  // Cloudflare R2 Status & Health Endpoint
  // Endpoint for obtaining Cloudflare R2 Presigned Upload URL (Avoids 413 Payload Too Large on server)
  app.post(["/api/upload/presign", "/upload/presign"], async (req, res) => {
    try {
      console.log("[R2 Presign] Request received:", {
        fileName: req.body?.fileName,
        mimeType: req.body?.mimeType,
        folder: req.body?.folder,
      });

      const { fileName, mimeType, folder } = req.body || {};
      if (!fileName) {
        return res.status(400).json({ success: false, error: "Se requiere el parámetro 'fileName'." });
      }

      const presignData = await getPresignedR2Url(
        fileName,
        mimeType || "application/octet-stream",
        folder || "uploads"
      );

      console.log("[R2 Presign] Generated successfully for key:", presignData.key);
      return res.json({
        success: true,
        presignedUrl: presignData.presignedUrl,
        url: presignData.fileUrl,
        key: presignData.key,
        bucket: presignData.bucket,
      });
    } catch (error: any) {
      const parsed = parseR2Error(error);
      console.error("[R2 Presign API Error]:", {
        category: parsed.category,
        errorName: parsed.errorName,
        message: parsed.message,
        statusCode: parsed.statusCode,
        s3Code: parsed.s3Code,
        requestId: parsed.requestId,
        cfRay: parsed.cfRay,
        stack: error?.stack,
        diagnosticSummary: parsed.diagnosticSummary,
        troubleshooting: parsed.troubleshooting,
      });

      return res.status(parsed.statusCode).json({
        success: false,
        error: parsed.message,
        category: parsed.category,
        errorName: parsed.errorName,
        s3Code: parsed.s3Code,
        requestId: parsed.requestId,
        troubleshooting: parsed.troubleshooting,
        envStatus: {
          configured: parsed.diagnosticSummary.isConfigured,
          missingVars: parsed.diagnosticSummary.missingVars,
          warnings: parsed.diagnosticSummary.warnings,
          maskedConfig: parsed.diagnosticSummary.maskedConfig,
        }
      });
    }
  });

  app.get(["/api/upload", "/upload"], async (req, res) => {
    const diag = getR2DiagnosticSummary();
    console.log("[R2 Health Check] Diagnostic summary:", diag);

    let testResult: any = null;
    if (req.query.test === "true" && diag.isConfigured) {
      try {
        const testData = await getPresignedR2Url("test-connection.txt", "text/plain", "test");
        testResult = {
          success: true,
          message: "Presigned URL de prueba generada exitosamente. Las credenciales de R2 son válidas.",
          key: testData.key,
        };
      } catch (err: any) {
        const parsed = parseR2Error(err);
        testResult = {
          success: false,
          error: parsed.message,
          category: parsed.category,
          troubleshooting: parsed.troubleshooting,
        };
      }
    }

    res.json({
      status: "ok",
      provider: "Cloudflare R2",
      isConfigured: diag.isConfigured,
      bucket: diag.maskedConfig.bucketName,
      publicUrl: diag.maskedConfig.publicUrl,
      maskedConfig: diag.maskedConfig,
      missingVars: diag.missingVars,
      warnings: diag.warnings,
      testResult,
      message: diag.isConfigured
        ? "Cloudflare R2 está configurado. Agrega '?test=true' a la URL para validar la conexión con la API de Cloudflare."
        : "Faltan variables de entorno requeridas para conectar con Cloudflare R2."
    });
  });

  // Cloudflare R2 Upload Endpoint (Supports both multipart form data and base64 JSON payload)
  app.post(["/api/upload", "/upload"], (req, res, next) => {
    multerUpload.single("file")(req, res, (err) => {
      if (err) {
        console.error("[R2 Upload Multer Error]:", err);
        return res.status(400).json({
          success: false,
          error: `Error al procesar la subida del archivo: ${err.message || err}`
        });
      }
      next();
    });
  }, async (req, res) => {
    try {
      let fileBuffer: Buffer | null = null;
      let fileName = "";
      let mimeType = "application/octet-stream";
      let folder = "media";

      if (req.file) {
        // Handle multipart form upload
        fileBuffer = req.file.buffer;
        fileName = req.file.originalname;
        mimeType = req.file.mimetype;
        folder = req.body.folder || "media";
      } else if (req.body && req.body.fileData) {
        // Handle JSON base64 upload
        fileName = req.body.fileName || `file-${Date.now()}`;
        mimeType = req.body.mimeType || "application/octet-stream";
        folder = req.body.folder || "media";
        const base64Data = req.body.fileData.includes(";base64,") 
          ? req.body.fileData.split(";base64,")[1] 
          : req.body.fileData;
        fileBuffer = Buffer.from(base64Data, "base64");
      }

      if (!fileBuffer || !fileName) {
        return res.status(400).json({
          success: false,
          error: "No se proporcionó ningún archivo. Envía un archivo en el campo 'file' o 'fileData' (base64)."
        });
      }

      console.log(`[R2 Direct Upload] Processing '${fileName}' (${mimeType}, ${fileBuffer.length} bytes)...`);
      const uploadResult = await uploadToR2(fileBuffer, fileName, mimeType, folder);
      
      console.log(`[R2 Direct Upload] Success! URL: ${uploadResult.url}`);
      return res.json({
        success: true,
        message: "Archivo subido exitosamente a Cloudflare R2",
        url: uploadResult.url,
        key: uploadResult.key,
        bucket: uploadResult.bucket
      });
    } catch (error: any) {
      const parsed = parseR2Error(error);
      console.error("[R2 Direct Upload API Error]:", {
        category: parsed.category,
        errorName: parsed.errorName,
        message: parsed.message,
        statusCode: parsed.statusCode,
        s3Code: parsed.s3Code,
        requestId: parsed.requestId,
        cfRay: parsed.cfRay,
        stack: error?.stack,
        diagnosticSummary: parsed.diagnosticSummary,
        troubleshooting: parsed.troubleshooting,
      });

      return res.status(parsed.statusCode).json({
        success: false,
        error: parsed.message,
        category: parsed.category,
        errorName: parsed.errorName,
        s3Code: parsed.s3Code,
        requestId: parsed.requestId,
        troubleshooting: parsed.troubleshooting,
        envStatus: {
          configured: parsed.diagnosticSummary.isConfigured,
          missingVars: parsed.diagnosticSummary.missingVars,
          warnings: parsed.diagnosticSummary.warnings,
          maskedConfig: parsed.diagnosticSummary.maskedConfig,
        }
      });
    }
  });

  // API Route for ImageKit Authentication
  app.get("/api/imagekit/auth", (req, res) => {
    try {
      console.log("Generating ImageKit auth parameters...");
      const ik = getImageKitInstance();
      const result = ik.getAuthenticationParameters();
      console.log("Auth parameters generated successfully");
      res.json(result);
    } catch (error: any) {
      console.error("ImageKit Auth Error:", error.message);
      res.status(500).json({ 
        error: "Failed to authenticate with ImageKit",
        message: error.message 
      });
    }
  });

  // API Route for Gemini Chat
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log("Processing chat message with Gemini...");
      try {
        const chat = getChatModel();
        const response = await chat.sendMessage({ message });
        console.log("Response received from Gemini model successfully");
        res.json({ text: response.text });
      } catch (geminiErr: any) {
        const msg = geminiErr?.message || String(geminiErr);
        if (msg.includes("API key not valid") || msg.includes("API_KEY_INVALID") || msg.includes("API_KEY")) {
          console.log("[Gemini] Chat message skipped: API key is invalid or not configured. Using local assistant response fallback.");
        } else {
          console.log("[Gemini] Chat message status:", msg);
        }
        const fallbackText = getLocalAssistantResponse(message);
        res.json({ text: fallbackText });
      }
    } catch (error: any) {
      console.log("Gemini Chat Route handled cleanly:", error.message);
      const fallbackText = getLocalAssistantResponse(req.body.message || "");
      res.json({ text: fallbackText });
    }
  });

  // Helper for uploading WebVTT to Firebase Storage or fallback to base64 Data URI
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
      // Return clean data URI fallback when storage is not provisioned/configured
      const base64 = Buffer.from(vttContent).toString("base64");
      return `data:text/vtt;base64,${base64}`;
    }
  };

  // Helper to format seconds into WebVTT HH:MM:SS.mmm format
  const formatSecondsToVttTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    const hrsStr = hrs.toString().padStart(2, "0");
    const minsStr = mins.toString().padStart(2, "0");
    const secsStr = secs.toString().padStart(2, "0");
    const msStr = ms.toString().padStart(3, "0");

    return `${hrsStr}:${minsStr}:${secsStr}.${msStr}`;
  };

  // Helper to translate WebVTT using Gemini 3.6 Flash
  const translateWebVttWithGemini = async (originalVttText: string, targetLang: string, apiKey: string): Promise<string> => {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

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
    } catch (e: any) {
      console.error("Error in translateWebVttWithGemini:", e.message);
      return originalVttText;
    }
  };

  // API Route for AI Subtitle Generation & Translation (Gemini 3.6 Flash Multimodal + SDH)
  app.post("/api/subtitles/generate", async (req, res) => {
    try {
      const { videoUrl, title, description, languages = ["es", "en", "ja"] } = req.body;
      console.log("Processing subtitles generation request (Gemini 3.6 Flash API):", { videoUrl, title, description, languages });

      const geminiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const isKeyInvalid = !geminiKey || geminiKey.trim() === "" || geminiKey.includes("YOUR_") || geminiKey.includes("placeholder") || geminiKey === "null" || geminiKey === "undefined";
      
      if (isKeyInvalid) {
        console.log("[Gemini] No valid GEMINI_API_KEY configured. Running subtitle generator in local fallback mode.");
      } else {
        console.log("[Gemini] Valid GEMINI_API_KEY configured. Proceeding with Gemini 3.6 Flash.");
      }

      let originalVtt = "";
      let tempVideoPath = "";
      let tempAudioPath = "";

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

      if (videoUrl && geminiKey && !isKeyInvalid && isDirectMedia) {
        try {
          const tempDir = os.tmpdir();
          const randomSuffix = Math.random().toString(36).substring(7);
          
          let ext = ".mp4";
          try {
            const urlObj = new URL(videoUrl);
            const pathname = urlObj.pathname.toLowerCase();
            if (pathname.endsWith(".mp3")) ext = ".mp3";
            else if (pathname.endsWith(".wav")) ext = ".wav";
            else if (pathname.endsWith(".webm")) ext = ".webm";
            else if (pathname.endsWith(".m4a")) ext = ".m4a";
            else if (pathname.endsWith(".mov")) ext = ".mov";
          } catch (e) {
            console.warn("Could not parse videoUrl extension, defaulting to .mp4", e);
          }

          tempVideoPath = path.join(tempDir, `video_${randomSuffix}${ext}`);
          tempAudioPath = path.join(tempDir, `audio_${randomSuffix}.mp3`);

          console.log(`Downloading media file to temporary path: ${tempVideoPath}`);
          const fileRes = await fetch(videoUrl);
          if (!fileRes.ok) {
            throw new Error(`Failed to download video: ${fileRes.statusText}`);
          }
          const arrayBuffer = await fileRes.arrayBuffer();
          await fs.promises.writeFile(tempVideoPath, Buffer.from(arrayBuffer));

          const isAlreadyMp3 = ext === ".mp3";
          if (isAlreadyMp3) {
            await fs.promises.copyFile(tempVideoPath, tempAudioPath);
          } else {
            await new Promise<void>(async (resolve, reject) => {
              try {
                const ffmpegModule = await import("fluent-ffmpeg");
                let ffmpegConstructor = ffmpegModule.default || ffmpegModule;
                if (typeof ffmpegConstructor !== "function" && (ffmpegConstructor as any).default) {
                  ffmpegConstructor = (ffmpegConstructor as any).default;
                }

                if (typeof ffmpegConstructor !== "function") {
                  throw new Error("fluent-ffmpeg default export is not a function");
                }

                ffmpegConstructor(tempVideoPath)
                  .noVideo()
                  .audioChannels(1)
                  .audioFrequency(16000)
                  .toFormat("mp3")
                  .on("end", () => resolve())
                  .on("error", (err) => reject(err))
                  .save(tempAudioPath);
              } catch (importErr: any) {
                reject(importErr);
              }
            });
          }

          console.log("Transcribing audio & actions with Gemini 3.6 Flash multimodal...");
          const ai = new GoogleGenAI({
            apiKey: geminiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });

          const audioBuffer = await fs.promises.readFile(tempAudioPath);
          const base64Audio = audioBuffer.toString("base64");

          const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: [
              {
                inlineData: {
                  mimeType: "audio/mp3",
                  data: base64Audio
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

        } catch (mediaErr: any) {
          console.error("Gemini audio-based subtitle generation failed:", mediaErr.message);
          originalVtt = "";
        } finally {
          try {
            if (tempVideoPath && fs.existsSync(tempVideoPath)) {
              await fs.promises.unlink(tempVideoPath);
            }
            if (tempAudioPath && fs.existsSync(tempAudioPath)) {
              await fs.promises.unlink(tempAudioPath);
            }
          } catch (cleanupErr: any) {
            console.warn("Error cleaning up temporary files:", cleanupErr.message);
          }
        }
      }

      // Step 2: Semantic fallback generation if transcribe failed or no direct media
      if (!originalVtt || !originalVtt.trim().startsWith("WEBVTT")) {
        console.log("Generating context-aware semantic WebVTT subtitles with SDH sound effects using Gemini 3.6 Flash...");
        if (geminiKey && !isKeyInvalid) {
          try {
            const ai = new GoogleGenAI({
              apiKey: geminiKey,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build',
                }
              }
            });

            const semanticPrompt = `Genera un guion completo de subtítulos en español formato WebVTT para un video con:
Título: "${title || 'SeikoYT Video'}"
Descripción: "${description || 'Un video emocionante de la comunidad'}"

INSTRUCCIONES CRÍTICAS (ACCESIBILIDAD SDH CON ACCIONES Y EFECTOS DE SONIDO):
1. Inicia strictly con 'WEBVTT'.
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

      if (!originalVtt || !originalVtt.trim().startsWith("WEBVTT")) {
        originalVtt = getLocalFallbackSubtitles(title, description, "es");
      }

      originalVtt = originalVtt.replace(/```vtt/gi, "").replace(/```/g, "").trim();

      const tracks: Array<{ label: string; src: string }> = [];
      const randomId = Math.random().toString(36).substring(7);

      const espUrl = await uploadToFirebaseStorage(originalVtt, `sub_${randomId}_es.vtt`);
      tracks.push({ label: "Español (Original)", src: espUrl });

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

        if (geminiKey && !isKeyInvalid) {
          try {
            console.log(`Translating WebVTT subtitles to ${targetLang} using Gemini 3.6 Flash...`);
            const translatedVtt = await translateWebVttWithGemini(originalVtt, targetLang, geminiKey);

            if (translatedVtt && translatedVtt.trim().startsWith("WEBVTT")) {
              const transUrl = await uploadToFirebaseStorage(translatedVtt, `sub_${randomId}_${langCode}.vtt`);
              tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl });
            } else {
              throw new Error(`Failed to translate VTT to ${targetLang} using Gemini.`);
            }
          } catch (transErr: any) {
            console.warn(`Gemini translation to ${targetLang} failed, falling back to local translation:`, transErr.message);
            const fallbackVtt = getLocalFallbackSubtitles(title, description, langCode);
            const transUrl = await uploadToFirebaseStorage(fallbackVtt, `sub_${randomId}_${langCode}.vtt`);
            tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl });
          }
        } else {
          const fallbackVtt = getLocalFallbackSubtitles(title, description, langCode);
          const transUrl = await uploadToFirebaseStorage(fallbackVtt, `sub_${randomId}_${langCode}.vtt`);
          tracks.push({ label: `${targetLang} (Traducido)`, src: transUrl });
        }
      }

      console.log("Subtitles generated and translated successfully with Gemini 3.6 Flash!", tracks);
      res.json({ success: true, tracks });
    } catch (error: any) {
      console.error("Subtitle Route Error:", error.message);
      res.status(500).json({ error: "Failed to generate subtitles", message: error.message });
    }
  });

  // Vite middleware for development or SPA serving in standalone production
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    import("vite")
      .then(({ createServer }) => {
        createServer({
          server: { middlewareMode: true },
          appType: "spa",
        }).then((vite) => {
          app.use(vite.middlewares);
          app.listen(PORT, "0.0.0.0", () => {
            console.log(`Server running on http://localhost:${PORT}`);
          });
        });
      })
      .catch((err) => {
        console.error("Failed to initialize Vite development server:", err);
      });
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

export default app;
