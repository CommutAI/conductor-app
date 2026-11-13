import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LogIn,
  LogOut as AlightIcon,
  QrCode,
  CreditCard,
  Wifi,
  Flashlight,
  SwitchCamera,
  type LucideIcon,
} from 'lucide-react';

export interface ScanFrameProps {
  mode: 'onboarding' | 'alighting';
  active?: boolean;
  stabilityProgress?: number;
  cardWidth?: number;
  cardHeight?: number;
  onTorchToggle?: () => void;
  onCameraSwitch?: () => void;
  showControls?: boolean;
  isTorchOn?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

interface ModeTheme {
  name: string;
  tag: string;
  label: string;
  icon: LucideIcon;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  glow: string;
  border: string;
  badgeBg: string;
  badgeBorder: string;
  beamGradient: string;
  beamShadow: string;
  instruction: string;
  readyInstruction: string;
}

const MODE_THEMES: Record<'onboarding' | 'alighting', ModeTheme> = {
  onboarding: {
    name: 'Onboarding',
    tag: 'ONBOARDING',
    label: 'Onboarding Scan',
    icon: LogIn,
    primary: '#22C55E',
    primaryLight: '#4ADE80',
    primaryDark: '#16A34A',
    glow: 'rgba(34, 197, 94, 0.45)',
    border: 'rgba(34, 197, 94, 0.75)',
    badgeBg: 'rgba(6, 44, 23, 0.85)',
    badgeBorder: 'rgba(34, 197, 94, 0.45)',
    beamGradient: 'linear-gradient(90deg, transparent 0%, #22C55E 50%, transparent 100%)',
    beamShadow: '0 0 14px 4px rgba(34, 197, 94, 0.85)',
    instruction: 'Fit QR card within frame to board',
    readyInstruction: 'Hold steady · Ready to onboard',
  },
  alighting: {
    name: 'Alighting',
    tag: 'ALIGHTING',
    label: 'Alighting Scan',
    icon: AlightIcon,
    primary: '#F59E0B',
    primaryLight: '#FBBF24',
    primaryDark: '#D97706',
    glow: 'rgba(245, 158, 11, 0.45)',
    border: 'rgba(245, 158, 11, 0.75)',
    badgeBg: 'rgba(69, 36, 6, 0.85)',
    badgeBorder: 'rgba(245, 158, 11, 0.45)',
    beamGradient: 'linear-gradient(90deg, transparent 0%, #F59E0B 50%, transparent 100%)',
    beamShadow: '0 0 14px 4px rgba(245, 158, 11, 0.85)',
    instruction: 'Fit QR card within frame to alight',
    readyInstruction: 'Hold steady · Ready to alight',
  },
};

const ScanFrame: React.FC<ScanFrameProps> = ({
  mode = 'onboarding',
  active = true,
  stabilityProgress = 0,
  cardWidth,
  cardHeight,
  onTorchToggle,
  onCameraSwitch,
  showControls = false,
  isTorchOn = false,
  className = '',
  style,
  children,
}) => {
  const theme = MODE_THEMES[mode] || MODE_THEMES.onboarding;
  const ModeIcon = theme.icon;

  // Standard CR80 / ID-1 transit card aspect ratio (85.6mm : 53.98mm = ~1.586)
  const defaultWidth = 270;
  const effectiveWidth = Math.max(cardWidth || defaultWidth, 220);
  const effectiveHeight = cardHeight || Math.round(effectiveWidth / 1.586);

  const cornerSize = Math.max(Math.round(effectiveWidth * 0.12), 24);

  return (
    <div
      className={`scan-frame ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        overflow: 'hidden',
        zIndex: 10,
        ...style,
      }}
      aria-label={`${theme.label} Viewport`}
    >
      {/* ── Top Mode Pill Badge ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 12px',
            borderRadius: 20,
            background: theme.badgeBg,
            border: `1.5px solid ${theme.badgeBorder}`,
            boxShadow: `0 4px 14px rgba(0, 0, 0, 0.4), 0 0 12px ${theme.glow}`,
            backdropFilter: 'blur(10px)',
          }}
        >
          {/* Pulsing live dot */}
          <motion.div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: theme.primary,
              boxShadow: `0 0 8px ${theme.primary}`,
            }}
            animate={{ scale: [1, 1.35, 1], opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          <ModeIcon size={13} color={theme.primary} />

          <span
            style={{
              color: '#ffffff',
              fontSize: '0.72rem',
              fontWeight: 800,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
            }}
          >
            {theme.tag}
          </span>

          <span
            style={{
              width: 1,
              height: 10,
              background: 'rgba(255, 255, 255, 0.25)',
              margin: '0 2px',
            }}
          />

          <span
            style={{
              color: theme.primaryLight,
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.5px',
            }}
          >
            QR CARD
          </span>
        </motion.div>
      </AnimatePresence>

      {/* ── The QR Card Frame (with darkened scrim mask outside) ── */}
      <div
        style={{
          position: 'relative',
          width: effectiveWidth,
          height: effectiveHeight,
          flexShrink: 0,
          borderRadius: 14,
          // Darkened scrim overlay outside the card frame, crystal-clear inside
          boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.52), 0 0 20px ${theme.glow}, inset 0 0 14px ${theme.glow}`,
          border: `1.5px dashed ${theme.border}`,
          overflow: 'hidden',
          transition: 'border-color 0.25s, box-shadow 0.25s',
        }}
      >
        {/* Corner Brackets */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => {
          const isTop = pos.startsWith('t');
          const isLeft = pos.endsWith('l');
          return (
            <div
              key={pos}
              style={{
                position: 'absolute',
                width: cornerSize,
                height: cornerSize,
                top: isTop ? 0 : undefined,
                bottom: !isTop ? 0 : undefined,
                left: isLeft ? 0 : undefined,
                right: !isLeft ? 0 : undefined,
                borderColor: theme.primary,
                borderStyle: 'solid',
                borderWidth:
                  pos === 'tl'
                    ? '3.5px 0 0 3.5px'
                    : pos === 'tr'
                    ? '3.5px 3.5px 0 0'
                    : pos === 'bl'
                    ? '0 0 3.5px 3.5px'
                    : '0 3.5px 3.5px 0',
                borderRadius:
                  pos === 'tl'
                    ? '10px 0 0 0'
                    : pos === 'tr'
                    ? '0 10px 0 0'
                    : pos === 'bl'
                    ? '0 0 0 10px'
                    : '0 0 10px 0',
                boxShadow: `0 0 8px ${theme.glow}`,
                transition: 'border-color 0.25s, box-shadow 0.25s',
                zIndex: 2,
              }}
            />
          );
        })}

        {/* ── Card Watermark & Alignment Guide (Subtle UI hints) ── */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            opacity: 0.85,
            pointerEvents: 'none',
          }}
        >
          {/* Left card details: microchip & transit pass badge */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              height: '100%',
            }}
          >
            {/* Smart card chip graphic */}
            <div
              style={{
                width: 32,
                height: 24,
                borderRadius: 5,
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'inset 0 0 4px rgba(255, 255, 255, 0.1)',
                position: 'relative',
              }}
            >
              <CreditCard size={14} color="rgba(255, 255, 255, 0.75)" />
            </div>

            {/* Card branding watermark */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  color: 'rgba(255, 255, 255, 0.65)',
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase',
                }}
              >
                <Wifi size={11} style={{ transform: 'rotate(90deg)' }} />
                <span>TRANSIT PASS</span>
              </div>
              <span
                style={{
                  color: theme.primaryLight,
                  fontSize: '0.55rem',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  opacity: 0.9,
                }}
              >
                {theme.name} Mode
              </span>
            </div>
          </div>

          {/* Right side: QR code placement target */}
          <div
            style={{
              width: Math.min(Math.round(effectiveHeight * 0.65), 78),
              height: Math.min(Math.round(effectiveHeight * 0.65), 78),
              borderRadius: 8,
              border: `1.5px dashed ${theme.border}`,
              background: 'rgba(0, 0, 0, 0.22)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              position: 'relative',
            }}
          >
            {/* Target corner marks */}
            <div
              style={{
                position: 'absolute',
                top: 3,
                left: 3,
                width: 6,
                height: 6,
                borderTop: `1.5px solid ${theme.primary}`,
                borderLeft: `1.5px solid ${theme.primary}`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 3,
                right: 3,
                width: 6,
                height: 6,
                borderTop: `1.5px solid ${theme.primary}`,
                borderRight: `1.5px solid ${theme.primary}`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 3,
                left: 3,
                width: 6,
                height: 6,
                borderBottom: `1.5px solid ${theme.primary}`,
                borderLeft: `1.5px solid ${theme.primary}`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 3,
                right: 3,
                width: 6,
                height: 6,
                borderBottom: `1.5px solid ${theme.primary}`,
                borderRight: `1.5px solid ${theme.primary}`,
              }}
            />

            <QrCode size={24} color={theme.primary} style={{ opacity: 0.55 }} />
            <span
              style={{
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '0.52rem',
                fontWeight: 800,
                letterSpacing: '0.5px',
              }}
            >
              QR CODE
            </span>
          </div>
        </div>

        {/* ── Active Scanning Laser Beam ── */}
        {active && (
          <motion.div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 3,
              background: theme.beamGradient,
              boxShadow: theme.beamShadow,
              zIndex: 3,
            }}
            animate={{ top: ['4px', `${effectiveHeight - 7}px`, '4px'] }}
            transition={{ duration: 2.3, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {children}
      </div>

      {/* ── Stability Meter & Guidance (Bottom) ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
          padding: '6px 14px',
          background: 'rgba(0, 0, 0, 0.75)',
          borderRadius: 20,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: Math.min(Math.round(effectiveWidth * 0.76), 210),
          }}
        >
          <div
            style={{
              flex: 1,
              height: 5,
              background: 'rgba(255, 255, 255, 0.2)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <motion.div
              style={{
                height: '100%',
                background:
                  stabilityProgress >= 100
                    ? theme.primary
                    : stabilityProgress >= 60
                    ? '#EAB308'
                    : '#EF4444',
                borderRadius: 3,
                boxShadow:
                  stabilityProgress >= 100 ? `0 0 6px ${theme.primary}` : undefined,
              }}
              animate={{ width: `${stabilityProgress}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>

          <span
            style={{
              color: stabilityProgress >= 100 ? theme.primaryLight : '#ffffff',
              fontSize: '0.68rem',
              fontWeight: 800,
              minWidth: 46,
              textAlign: 'right',
            }}
          >
            {stabilityProgress >= 100 ? 'READY' : `${stabilityProgress}%`}
          </span>
        </div>

        <span
          style={{
            color: 'rgba(255, 255, 255, 0.92)',
            fontSize: '0.65rem',
            fontWeight: 600,
            letterSpacing: '0.4px',
            textAlign: 'center',
          }}
        >
          {stabilityProgress >= 100 ? theme.readyInstruction : theme.instruction}
        </span>
      </div>

      {/* ── Optional Camera Controls (Torch / Camera Switch) ── */}
      {showControls && (onTorchToggle || onCameraSwitch) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 2,
            pointerEvents: 'auto',
          }}
        >
          {onTorchToggle && (
            <motion.button
              type="button"
              onClick={onTorchToggle}
              whileTap={{ scale: 0.92 }}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: isTorchOn ? theme.primary : 'rgba(0, 0, 0, 0.65)',
                color: isTorchOn ? '#ffffff' : 'rgba(255, 255, 255, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
              aria-label="Toggle flashlight"
            >
              <Flashlight size={18} />
            </motion.button>
          )}

          {onCameraSwitch && (
            <motion.button
              type="button"
              onClick={onCameraSwitch}
              whileTap={{ scale: 0.92 }}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'rgba(0, 0, 0, 0.65)',
                color: 'rgba(255, 255, 255, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
              aria-label="Switch camera"
            >
              <SwitchCamera size={18} />
            </motion.button>
          )}
        </div>
      )}
    </div>
  );
};

export default ScanFrame;
