import React, { useEffect, useRef, useState } from 'react';

// Card template images live in /assets/ (copied from public/assets/ by Vite)
const REGULAR_TEMPLATES: Record<string, string> = {
  regular:        '/assets/regular.png',
  student:        '/assets/student.png',
  senior_citizen: '/assets/senior_citizien.png',
  pwd:            '/assets/pwd.png',
};

const TEMP_TEMPLATES: Record<string, string> = {
  regular:        '/assets/temp-regular.png',
  student:        '/assets/temp-student.png',
  senior_citizen: '/assets/temp-senior.png',
  pwd:            '/assets/temp-pwd.png',
};

// Alternative paths to try if main path fails
const ALT_REGULAR_TEMPLATES: Record<string, string> = {
  regular:        './assets/regular.png',
  student:        './assets/student.png',
  senior_citizen: './assets/senior_citizien.png',
  pwd:            './assets/pwd.png',
};

const ALT_TEMP_TEMPLATES: Record<string, string> = {
  regular:        './assets/temp-regular.png',
  student:        './assets/temp-student.png',
  senior_citizen: './assets/temp-senior.png',
  pwd:            './assets/temp-pwd.png',
};

const TEMP_ID_COLORS: Record<string, string> = {
  regular:        '#F97316',
  student:        '#059669',
  senior_citizen: '#EA580C',
  pwd:            '#7c3aed',
};

function normaliseType(raw?: string): string {
  if (!raw) return 'regular';

  const normalized = raw.toLowerCase()
    .replace(/ /g, '_')
    .replace(/-/g, '_');

  // Map common variations to standard types
  const typeMap: Record<string, string> = {
    'senior': 'senior_citizen',
    'elderly': 'senior_citizen',
    'disabled': 'pwd',
    'handicapped': 'pwd',
  };

  return typeMap[normalized] || normalized;
}

// ── Simple deterministic QR pattern ──────────────────────────────────────────
function drawQR(
  ctx: CanvasRenderingContext2D,
  data: string,
  x: number,
  y: number,
  size: number,
) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);

  let h = 0;
  for (let i = 0; i < data.length; i++) h = ((h << 5) - h + data.charCodeAt(i)) | 0;

  const M = 21;
  const cell = size / M;

  const drawFinder = (ox: number, oy: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(x + ox * cell, y + oy * cell, 7 * cell, 7 * cell);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + (ox + 1) * cell, y + (oy + 1) * cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + (ox + 2) * cell, y + (oy + 2) * cell, 3 * cell, 3 * cell);
  };

  drawFinder(0, 0);
  drawFinder(M - 7, 0);
  drawFinder(0, M - 7);

  for (let r = 0; r < M; r++) {
    for (let c = 0; c < M; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c >= M - 8) || (r >= M - 8 && c < 8)) continue;
      const bit = ((h >>> ((r * M + c) % 32)) & 1) ^ ((r + c) % 3 === 0 ? 1 : 0);
      if (bit) {
        ctx.fillStyle = '#000';
        ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
      }
    }
  }
}

function drawFallback(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cardUid: string,
  balance: number,
  isTicket: boolean,
  type: string,
) {
  canvas.width  = 800;
  canvas.height = 500;
  const grad = ctx.createLinearGradient(0, 0, 800, 500);
  if (isTicket) {
    const colors: Record<string, [string, string]> = {
      regular:        ['#EA580C', '#FB923C'],
      student:        ['#059669', '#10B981'],
      senior_citizen: ['#7c2d12', '#ea580c'],
      pwd:            ['#7c3aed', '#8B5CF6'],
    };
    const [c1, c2] = colors[type] || colors.regular;
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
  } else {
    grad.addColorStop(0, '#2563EB');
    grad.addColorStop(1, '#3B82F6');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 500);

  // Decorative circles
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.arc(650, -50, 200, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-50, 400, 180, 0, Math.PI * 2); ctx.fill();

  // Logo area
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.roundRect?.(30, 20, 160, 36, 8);
  ctx.fill();
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'left';
  ctx.fillText('CommutAI', 45, 44);

  // Balance removed to match customer service card format

  // Card ID
  ctx.font = '600 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('CARD ID', 40, isTicket ? 260 : 300);
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = 'white';
  const displayId = cardUid.length > 8 ? `•••• ${cardUid.slice(-8).toUpperCase()}` : cardUid;
  ctx.fillText(displayId, 40, isTicket ? 292 : 332);

  // QR on right
  drawQR(ctx, cardUid, 480, 60, 280);
}

function drawRegularCard(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cardUid: string,
  balance: number,
) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  ctx.font          = `bold ${Math.round(W * 0.035)}px monospace`;
  ctx.fillStyle     = '#ffffff';
  ctx.shadowColor   = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur    = 4;
  ctx.shadowOffsetY = 1;
  ctx.textAlign     = 'left';
  // Show full card ID for regular cards (no masking)
  const displayId = cardUid.toUpperCase();
  ctx.fillText(displayId, Math.round(W * 0.08), Math.round(H * 0.44));

  // Balance removed to match customer service card format

  ctx.shadowBlur    = 0;
  ctx.shadowOffsetY = 0;

  drawQR(ctx, cardUid, Math.round(W * 0.51), Math.round(H * 0.12), Math.round(W * 0.40));
}

function drawTempCard(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cardUid: string,
  type: string,
) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  console.log('drawTempCard: Drawing temp card', { W, H, cardUid, type });

  ctx.drawImage(img, 0, 0);

  drawQR(ctx, cardUid, Math.round(W * 0.60), Math.round(H * 0.18), Math.round(W * 0.36));

  const fontSize = Math.round(W * 0.050);
  const cardIdX  = Math.round(W * 0.78);
  const cardIdY  = Math.round(H * 0.93);
  const color    = TEMP_ID_COLORS[type] || '#1362e2';

  ctx.font      = `800 ${fontSize}px 'Courier New', monospace`;
  ctx.textAlign = 'center';

  const tw = ctx.measureText(cardUid).width;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cardIdX - tw / 2 - 15, cardIdY - fontSize - 8, tw + 30, fontSize + 20);

  ctx.fillStyle = color;
  ctx.fillText(cardUid, cardIdX, cardIdY);
  ctx.textAlign = 'left';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface QRCardCanvasProps {
  cardUid: string;
  balance: number;
  passengerType?: string;
  isTicket?: boolean;
  style?: React.CSSProperties;
}

const QRCardCanvas: React.FC<QRCardCanvasProps> = ({
  cardUid,
  balance,
  passengerType,
  isTicket,
  style,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const type      = normaliseType(passengerType);
    const templates = isTicket ? TEMP_TEMPLATES : REGULAR_TEMPLATES;
    const altTemplates = isTicket ? ALT_TEMP_TEMPLATES : ALT_REGULAR_TEMPLATES;
    const src       = templates[type] || templates.regular;
    const altSrc    = altTemplates[type] || altTemplates.regular;

    console.log('QRCardCanvas: Loading template', { type, isTicket, src, altSrc, cardUid, balance });

    const applyDraw = (img: HTMLImageElement) => {
      console.log('QRCardCanvas: Template loaded successfully', {
        width: img.naturalWidth,
        height: img.naturalHeight,
        isTicket,
        cardUid
      });

      canvas.width  = img.naturalWidth  || 800;
      canvas.height = img.naturalHeight || 500;

      if (isTicket) {
        drawTempCard(ctx, img, cardUid, type);
      } else {
        drawRegularCard(ctx, img, cardUid, balance);
      }
      setImageLoaded(true);
    };

    const tryLoadImage = (imageSrc: string, isAlt: boolean = false) => {
      const img = new Image();
      // Allow cross-origin image loading
      img.crossOrigin = 'anonymous';
      img.src = imageSrc;

      // Check if image is already loaded
      if (img.complete && img.naturalWidth > 0) {
        console.log('QRCardCanvas: Image already loaded', { isAlt, imageSrc });
        applyDraw(img);
        return true;
      } else {
        console.log('QRCardCanvas: Waiting for image to load', { isAlt, imageSrc });
        img.onload = () => {
          console.log('QRCardCanvas: Image onload triggered', { isAlt, imageSrc });
          applyDraw(img);
        };
        img.onerror = (error) => {
          console.error('QRCardCanvas: Failed to load template', { imageSrc, isAlt, error });
          if (!isAlt && altSrc) {
            console.log('QRCardCanvas: Trying alternative path', { altSrc });
            tryLoadImage(altSrc, true);
          } else {
            console.log('QRCardCanvas: Using fallback rendering');
            drawFallback(ctx, canvas, cardUid, balance, !!isTicket, type);
            setImageLoaded(true);
          }
        };
        return false;
      }
    };

    // Try main path first
    tryLoadImage(src, false);

    // Cleanup — nothing to do for canvas
    return () => {};
  }, [cardUid, balance, passengerType, isTicket]);

  // Always render canvas — never conditionally hide it
  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: 'auto',
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        imageRendering: 'crisp-edges',
        display: 'block',
        background: imageLoaded ? 'transparent' : '#F97316', // orange while loading
        minHeight: 180,
        maxHeight: 250,
        ...style,
      }}
    />
  );
};

export default QRCardCanvas;
