import { uploadToR2 } from './r2Storage';

interface DownloadResult {
  url: string;
  key: string;
  title: string;
}

/**
 * Downloads a video from a YouTube link or direct video URL,
 * uploads it to Cloudflare R2, and returns the R2 public URL.
 */
export async function downloadVideoAndUploadToR2(
  videoUrl: string,
  folder: string = 'youtube-imports'
): Promise<DownloadResult> {
  const url = videoUrl.trim();
  if (!url) {
    throw new Error('La URL proporcionada está vacía.');
  }

  const isYouTube = /(?:youtube\.com\/(?:watch\?|embed\/|v\/|shorts\/)|youtu\.be\/)/i.test(url);

  if (isYouTube) {
    return await downloadYouTubeToR2(url, folder);
  } else {
    return await downloadDirectUrlToR2(url, folder);
  }
}

async function downloadYouTubeToR2(url: string, folder: string): Promise<DownloadResult> {
  let downloadStreamUrl = '';
  let videoTitle = 'video_youtube';

  // Strategy 1: Loader.to API
  try {
    const startRes = await fetch(
      `https://loader.to/ajax/download.php?start=1&end=1&format=720&url=${encodeURIComponent(url)}`
    );
    if (startRes.ok) {
      const startData = await startRes.json();
      if (startData?.title) {
        videoTitle = startData.title;
      }
      if (startData?.id) {
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 1200));
          const progRes = await fetch(`https://loader.to/ajax/progress.php?id=${startData.id}`);
          if (progRes.ok) {
            const progData = await progRes.json();
            if (progData?.download_url) {
              downloadStreamUrl = progData.download_url;
              break;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Loader.to strategy failed, trying fallback...', err);
  }

  // Strategy 2: Invidious API fallback
  if (!downloadStreamUrl) {
    const match = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https?:\/\/youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) {
      const videoId = match[1];
      const invidiousInstances = [
        'https://invidious.nerdvpn.de',
        'https://inv.tux.pizza',
        'https://invidious.projectsegfau.lt',
        'https://invidious.privacydev.net',
        'https://vid.puffyan.us'
      ];
      for (const inst of invidiousInstances) {
        try {
          const invRes = await fetch(`${inst}/api/v1/videos/${videoId}`);
          if (invRes.ok) {
            const invData = await invRes.json();
            if (invData?.title) videoTitle = invData.title;
            const format =
              invData.formatStreams?.find((f: any) => f.container === 'mp4' || f.type?.includes('mp4')) ||
              invData.formatStreams?.[0];
            if (format?.url) {
              downloadStreamUrl = format.url;
              break;
            }
          }
        } catch (e) {
          // try next instance
        }
      }
    }
  }

  // Strategy 3: ytdl-core fallback
  if (!downloadStreamUrl) {
    try {
      const ytdlModule = await import('@distube/ytdl-core');
      const ytdl = ytdlModule.default;
      const info = await ytdl.getInfo(url);
      if (info?.videoDetails?.title) {
        videoTitle = info.videoDetails.title;
      }
      const format =
        ytdl.chooseFormat(info.formats, { filter: 'audioandvideo' }) ||
        ytdl.chooseFormat(info.formats, { quality: 'highest' });
      if (format?.url) {
        downloadStreamUrl = format.url;
      }
    } catch (err) {
      console.warn('ytdl-core fallback failed:', err);
    }
  }

  if (!downloadStreamUrl) {
    throw new Error('No se pudo procesar la URL de YouTube. Verifica que el video sea público y accesible.');
  }

  // Fetch the actual video binary stream
  const videoRes = await fetch(downloadStreamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!videoRes.ok) {
    throw new Error(`Error al descargar la transmisión de video: status ${videoRes.status}`);
  }

  const arrayBuffer = await videoRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const sanitizedTitle = videoTitle
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .substring(0, 50)
    .toLowerCase();
  const filename = `${sanitizedTitle || 'yt_video'}.mp4`;

  const r2Result = await uploadToR2(buffer, filename, 'video/mp4', folder);

  return {
    url: r2Result.url,
    key: r2Result.key,
    title: videoTitle
  };
}

async function downloadDirectUrlToR2(url: string, folder: string): Promise<DownloadResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Error al obtener el archivo desde el enlace: status ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || 'video/mp4';
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let ext = 'mp4';
  if (contentType.includes('webm')) ext = 'webm';
  else if (contentType.includes('quicktime') || contentType.includes('mov')) ext = 'mov';
  else if (contentType.includes('audio/mpeg') || contentType.includes('mp3')) ext = 'mp3';

  const pathname = new URL(url).pathname;
  const rawFilename = pathname.split('/').pop() || `media_file.${ext}`;
  const filename = rawFilename.includes('.') ? rawFilename : `${rawFilename}.${ext}`;

  const r2Result = await uploadToR2(buffer, filename, contentType, folder);

  return {
    url: r2Result.url,
    key: r2Result.key,
    title: rawFilename
  };
}
