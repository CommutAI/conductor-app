import React from 'react';
import { CloudOff, RefreshCw, Loader2 } from 'lucide-react';
import { useOffline } from '../context/OfflineContext';

interface OfflineBannerProps {
  style?: React.CSSProperties;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ style }) => {
  const { isOnline, pendingCount, isSyncing, triggerSync } = useOffline();

  if (isOnline && pendingCount === 0 && !isSyncing) return null;

  if (isSyncing) {
    return (
      <div style={{ ...bannerBase, background: 'linear-gradient(135deg, #3B82F6, #60A5FA)', ...style }}>
        <Loader2 size={16} color="white" style={{ animation: 'spin 0.8s linear infinite' }} />
        <span style={textStyle}>Syncing {pendingCount} scan{pendingCount !== 1 ? 's' : ''}…</span>
      </div>
    );
  }

  if (isOnline && pendingCount > 0) {
    return (
      <div
        style={{ ...bannerBase, background: 'linear-gradient(135deg, #FACC15, #FDE047)', cursor: 'pointer', ...style }}
        onClick={() => triggerSync()}
        role="button"
        aria-label="Sync pending scans"
      >
        <RefreshCw size={16} color="#713F12" />
        <span style={{ ...textStyle, color: '#713F12' }}>
          {pendingCount} scan{pendingCount !== 1 ? 's' : ''} pending — Tap to sync
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...bannerBase, background: 'linear-gradient(135deg, #EF4444, #F87171)', ...style }}>
      <CloudOff size={16} color="white" />
      <span style={textStyle}>
        Offline mode{pendingCount > 0 ? ` — ${pendingCount} scan${pendingCount !== 1 ? 's' : ''} queued` : ''}
      </span>
    </div>
  );
};

const bannerBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  transition: 'all 0.3s ease',
};

const textStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'white',
  letterSpacing: '0.01em',
};

export default OfflineBanner;
