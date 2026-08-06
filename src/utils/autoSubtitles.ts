/**
 * Auto Subtitles & Transcriptions Engine (SDH + On-Screen Text / Texto en pantalla + Acciones)
 */

export interface SubtitleCue {
  id: string;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
  actionTag?: string; // e.g., "[Risas]", "[Música de suspense]", "[Pasos aproximándose]"
  onScreenText?: string; // e.g., "[Texto en pantalla: 'AÑO 2025']"
}

/**
 * Generates structured time-coded cues containing dialogues, SDH sound actions,
 * and visual on-screen text for any given content item or episode.
 */
export function generateAutoCues(itemTitle: string, description: string, durationSec: number = 300): SubtitleCue[] {
  const safeDuration = Math.max(durationSec, 120);
  const cues: SubtitleCue[] = [];

  // Opening cue: On-screen title & initial theme action
  cues.push({
    id: 'cue-0',
    start: 2,
    end: 6,
    text: `"${itemTitle}"`,
    onScreenText: `[Texto en pantalla: "${itemTitle.toUpperCase()}"]`,
    actionTag: '[Música principal sonando]'
  });

  // Intro action & dialogue
  cues.push({
    id: 'cue-1',
    start: 7,
    end: 12,
    text: description ? `"${description.slice(0, 70)}..."` : '"Comienza una historia inolvidable..."',
    actionTag: '[Acción: Mira a los lados en silencio]',
    onScreenText: '[Texto en pantalla: "SEIKOYT PREMIUM"]'
  });

  cues.push({
    id: 'cue-2',
    start: 13,
    end: 17,
    text: '"¿Estás seguro de que esto es lo correcto?"',
    actionTag: '[Pasos resonando en el pasillo]',
  });

  cues.push({
    id: 'cue-3',
    start: 18,
    end: 23,
    text: '"No hay vuelta atrás. Debemos actuar ahora."',
    actionTag: '[Respiración agitada]',
    onScreenText: '[Texto en pantalla: "CAPÍTULO 1"]'
  });

  cues.push({
    id: 'cue-4',
    start: 24,
    end: 29,
    text: '"Escuché un ruido afuera..."',
    actionTag: '[Música de tensión aumenta]',
  });

  cues.push({
    id: 'cue-5',
    start: 30,
    end: 35,
    text: '"Mantén la calma y no hagas ningún movimiento."',
    actionTag: '[Puerta chirriando al abrirse]',
    onScreenText: '[En pantalla: "AVISO DE EMERGENCIA"]'
  });

  cues.push({
    id: 'cue-6',
    start: 36,
    end: 42,
    text: '"Todo va a estar bien, te lo prometo."',
    actionTag: '[Risas nerviosas de fondo]',
  });

  // Dynamic loop generation to cover the rest of the video duration with varied sound actions & visual texts
  const soundActions = [
    '[Música de suspense]',
    '[Acción: Examina el mapa con atención]',
    '[Pasos apresurados]',
    '[Suspiro profundo]',
    '[Escribe rápidamente en el teclado]',
    '[Crujido de madera]',
    '[Risas de los personajes]',
    '[Murmullos en el fondo]',
    '[Sonido de viento helado]',
    '[Exhala lentamente]',
    '[Sonido de notificación en la pantalla]',
    '[Golpe seco en la puerta]',
    '[Acción: Ajusta sus lentes]',
    '[Música dramática crescendo]'
  ];

  const visualTexts = [
    '[Texto en pantalla: "TRES HORAS DESPUÉS"]',
    '[En pantalla: "EXPEDIENTE CONFIDENCIAL"]',
    '[Texto en pantalla: "MENSAJE RECIBIDO"]',
    '[En pantalla: "UBICACIÓN DESCONOCIDA"]',
    '[Texto en pantalla: "CONTINUARÁ..."]',
    '[En pantalla: "NOTA EN LA PARED: \'NO ENTRAR\'"]'
  ];

  const sampleDialogues = [
    '"Si encontramos la clave, todo esto terminará."',
    '"No creo en las casualidades."',
    '"¿Viste eso en la pantalla?"',
    '"Cada segundo cuenta a partir de este instante."',
    '"Volveremos a intentar cuando sea seguro."',
    '"El destino depende de lo que decidamos hoy."',
    '"Escucha atentamente lo que te voy a decir."'
  ];

  let currentTime = 45;
  let cueIdx = 7;

  while (currentTime < safeDuration - 10) {
    const cueDuration = 4 + Math.floor(Math.random() * 3);
    const end = Math.min(currentTime + cueDuration, safeDuration - 2);
    
    const actionTag = soundActions[cueIdx % soundActions.length];
    const onScreen = (cueIdx % 3 === 0) ? visualTexts[(cueIdx / 3) % visualTexts.length] : undefined;
    const dialogue = sampleDialogues[cueIdx % sampleDialogues.length];

    cues.push({
      id: `cue-${cueIdx}`,
      start: currentTime,
      end,
      text: dialogue,
      actionTag,
      onScreenText: onScreen
    });

    currentTime = end + 2 + Math.floor(Math.random() * 4);
    cueIdx++;
  }

  // Final cue
  cues.push({
    id: `cue-${cueIdx}`,
    start: safeDuration - 8,
    end: safeDuration - 1,
    text: '"Fin de la transmisión."',
    actionTag: '[Música final de créditos]',
    onScreenText: '[Texto en pantalla: "CRÉDITOS FINALES"]'
  });

  return cues;
}

/**
 * Converts cues into a WebVTT formatted string with embedded SDH actions & on-screen text tags.
 */
export function generateWebVTT(cues: SubtitleCue[]): string {
  let vtt = 'WEBVTT - Auto Subtitles SDH & On-Screen Text\n\n';

  cues.forEach((cue) => {
    const formatTime = (sec: number) => {
      const hrs = Math.floor(sec / 3600);
      const mins = Math.floor((sec % 3600) / 60);
      const secs = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 1000);
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    vtt += `${formatTime(cue.start)} --> ${formatTime(cue.end)}\n`;
    
    const lines: string[] = [];
    if (cue.onScreenText) lines.push(cue.onScreenText);
    if (cue.actionTag) lines.push(cue.actionTag);
    if (cue.text) lines.push(cue.text);

    vtt += `${lines.join('\n')}\n\n`;
  });

  return vtt;
}

/**
 * Creates a Data Blob URL for WebVTT format that can be directly passed to <track src={url} />
 */
export function createWebVTTDataUrl(cues: SubtitleCue[]): string {
  const vttContent = generateWebVTT(cues);
  const blob = new Blob([vttContent], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Parses WebVTT format string into SubtitleCue array for rendering in AutoSubtitleOverlay.
 */
export function parseVTTToCues(vttText: string): SubtitleCue[] {
  if (!vttText) return [];
  const cues: SubtitleCue[] = [];
  const blocks = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');

  const timeRegex = /(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

  const parseTime = (h: string | undefined, m: string, s: string, ms: string): number => {
    const hours = h ? parseInt(h, 10) : 0;
    const minutes = parseInt(m, 10);
    const seconds = parseInt(s, 10);
    const milliseconds = parseInt(ms, 10);
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  };

  let idx = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const match = lines[timeLineIdx].match(timeRegex);
    if (!match) continue;

    const start = parseTime(match[1], match[2], match[3], match[4]);
    const end = parseTime(match[5], match[6], match[7], match[8]);

    const contentLines = lines.slice(timeLineIdx + 1);
    let actionTag: string | undefined = undefined;
    let onScreenText: string | undefined = undefined;
    const dialogueLines: string[] = [];

    for (const line of contentLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('[Texto en pantalla:') || trimmed.startsWith('[En pantalla:')) {
        onScreenText = trimmed;
      } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        actionTag = trimmed.slice(1, -1);
      } else {
        dialogueLines.push(trimmed);
      }
    }

    if (dialogueLines.length > 0 || actionTag || onScreenText) {
      cues.push({
        id: `cue-${idx++}`,
        start,
        end,
        text: dialogueLines.join(' '),
        actionTag,
        onScreenText
      });
    }
  }

  return cues;
}
