import React from 'react';
import { IonModal } from '@ionic/react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface AnimatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  showClose?: boolean;
  variant?: 'sheet' | 'center';
}

const AnimatedModal: React.FC<AnimatedModalProps> = ({
  isOpen,
  onClose,
  children,
  title,
  showClose = true,
  variant = 'sheet',
}) => (
  <IonModal
    isOpen={isOpen}
    onDidDismiss={onClose}
    className={`animated-modal animated-modal--${variant}`}
    style={{
      '--border-radius': variant === 'sheet' ? '28px 28px 0 0' : '24px',
      '--height': variant === 'center' ? 'auto' : 'auto',
      '--max-height': variant === 'center' ? '90%' : '85%',
      '--width': variant === 'center' ? 'calc(100% - 32px)' : '100%',
    }}
  >
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="animated-modal__content"
          initial={{ opacity: 0, y: variant === 'sheet' ? 40 : 0, scale: variant === 'center' ? 0.95 : 1 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: variant === 'sheet' ? 40 : 0, scale: variant === 'center' ? 0.95 : 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          {(title || showClose) && (
            <div className="animated-modal__header">
              {title && <h2 className="animated-modal__title">{title}</h2>}
              {showClose && (
                <button
                  type="button"
                  className="animated-modal__close"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          )}
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  </IonModal>
);

export default AnimatedModal;
