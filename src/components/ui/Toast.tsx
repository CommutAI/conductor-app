import React from 'react';
import { IonToast } from '@ionic/react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastColor = 'success' | 'danger' | 'warning' | 'info';

interface AppToastProps {
  isOpen: boolean;
  message: string;
  color?: ToastColor;
  duration?: number;
  onDismiss: () => void;
}

const iconMap = {
  success: CheckCircle2,
  danger: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const AppToast: React.FC<AppToastProps> = ({
  isOpen,
  message,
  color = 'success',
  duration = 2800,
  onDismiss,
}) => {
  const Icon = iconMap[color === 'danger' ? 'danger' : color === 'warning' ? 'warning' : color === 'info' ? 'info' : 'success'];

  return (
    <IonToast
      isOpen={isOpen}
      onDidDismiss={onDismiss}
      message={message}
      duration={duration}
      position="top"
      cssClass={`app-toast app-toast--${color}`}
      buttons={[
        {
          icon: 'close',
          role: 'cancel',
          handler: onDismiss,
        },
      ]}
    >
      <div className="app-toast__inner" slot="message">
        <Icon size={18} className={`app-toast__icon app-toast__icon--${color}`} />
        <span>{message}</span>
      </div>
    </IonToast>
  );
};

export default AppToast;
