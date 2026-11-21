import React from 'react';
import { CloudOff, RefreshCw, Loader2 } from 'lucide-react';
import { useNetwork } from '../context/NetworkContext';
import { backgroundSyncService } from '../services/backgroundSyncService';

interface OfflineBannerProps {
  style?: React.CSSProperties;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ style }) => {
  const { isOnline, pendingCount, isSyncing, triggerSync } = useNetwork();

  if (isOnline && pendingCount === 0 && !isSyncing) return null;

  if (isSyncing) {
    return (
      <div style={{ ...bannerBase, background: 'linear-gradient(135deg, #2563EB, #3B82F6)', ...style }}>
        <Loader2 size={16} color="white" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        <span style={{ ...textStyle, flex: 1 }}>Syncing {pendingCount} scan{pendingCount !== 1 ? 's' : ''} to cloud…</span>
      </div>
    );
  }

  if (isOnline && pendingCount > 0) {
    return (
      <div
        style={{ ...bannerBase, background: 'linear-gradient(135deg, #D97706, #F59E0B)', cursor: 'pointer', ...style }}
        onClick={async () => {
          try {
            await backgroundSyncService.manualSync();
            triggerSync();
          } catch (error) {
            console.error('[OfflineBanner] Manual sync failed:', error);
          }
        }}
        role="button"
        aria-label="Sync pending scans"
      >
        <RefreshCw size={16} color="white" style={{ flexShrink: 0 }} />
        <span style={{ ...textStyle, color: 'white', flex: 1 }}>
          {pendingCount} scan{pendingCount !== 1 ? 's' : ''} pending sync
        </span>
        <span style={{
          background: 'rgba(255,255,255,0.25)',
          padding: '2px 10px',
          borderRadius: 12,
          fontSize: '0.72rem',
          fontWeight: 800,
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}>
          Sync Now
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...bannerBase, background: 'linear-gradient(135deg, #DC2626, #EF4444)', ...style }}>
      <CloudOff size={16} color="white" style={{ flexShrink: 0 }} />
      <span style={{ ...textStyle, flex: 1 }}>
        Offline Mode{pendingCount > 0 ? ` — ${pendingCount} scan${pendingCount !== 1 ? 's' : ''} queued` : ' — Local caching active'}
      </span>
      {pendingCount > 0 && (
        <span style={{
          background: 'rgba(0,0,0,0.2)',
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: '0.68rem',
          fontWeight: 700,
          color: 'white',
        }}>
          Auto-syncs online
        </span>
      )}
    </div>
  );
};

const bannerBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  transition: 'all 0.5s ease', // Slower transition for smoother network changes
};

const textStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'white',
  letterSpacing: '0.01em',
};

export default OfflineBanner;
