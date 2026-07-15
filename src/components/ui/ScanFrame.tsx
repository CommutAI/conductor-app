import React from 'react';
import { motion } from 'framer-motion';
import { Flashlight, SwitchCamera } from 'lucide-react';

interface ScanFrameProps {
  active?: boolean;
  children?: React.ReactNode;
  onTorchToggle?: () => void;
  onCameraSwitch?: () => void;
  showControls?: boolean;
}

const ScanFrame: React.FC<ScanFrameProps> = ({
  active = false,
  children,
  onTorchToggle,
  onCameraSwitch,
  showControls = true,
}) => (
  <div className="scan-frame">
    <div className={`scan-frame__viewport ${active ? 'scan-frame__viewport--active' : ''}`}>
      {children}
      <div className="scan-frame__overlay" aria-hidden="true">
        <div className="scan-frame__corner scan-frame__corner--tl" />
        <div className="scan-frame__corner scan-frame__corner--tr" />
        <div className="scan-frame__corner scan-frame__corner--bl" />
        <div className="scan-frame__corner scan-frame__corner--br" />
        {active && <div className="scan-frame__line" />}
      </div>
    </div>

    {showControls && (
      <div className="scan-frame__controls">
        <motion.button
          type="button"
          className="scan-frame__control-btn"
          onClick={onTorchToggle}
          whileTap={{ scale: 0.92 }}
          aria-label="Toggle flashlight"
        >
          <Flashlight size={22} />
        </motion.button>
        <motion.button
          type="button"
          className="scan-frame__control-btn"
          onClick={onCameraSwitch}
          whileTap={{ scale: 0.92 }}
          aria-label="Switch camera"
        >
          <SwitchCamera size={22} />
        </motion.button>
      </div>
    )}
  </div>
);

export default ScanFrame;
