import React from 'react';
import { motion } from 'framer-motion';
import { Check, X, AlertTriangle } from 'lucide-react';
import ProfileAvatar from '../ProfileAvatar';
import SoftCard from '../ui/SoftCard';
import StatusBadge from '../ui/StatusBadge';

interface PassengerDetailsProps {
  success: boolean;
  warning?: boolean;
  passengerName?: string;
  cardNumber?: string;
  remainingBalance?: number;
  fareDeducted?: number;
  currentTrip?: string;
  timestamp?: string;
  message?: string;
}

const PassengerDetailsCard: React.FC<PassengerDetailsProps> = ({
  success,
  warning = false,
  passengerName,
  cardNumber,
  remainingBalance,
  fareDeducted,
  currentTrip,
  timestamp,
  message,
}) => {
  const variant = success ? 'success' : warning ? 'warning' : 'danger';
  const Icon = success ? Check : warning ? AlertTriangle : X;

  return (
    <motion.div
      className="passenger-details"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      {/* Result animation */}
      <motion.div
        className={`passenger-details__result passenger-details__result--${variant}`}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
      >
        <motion.div
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
        >
          <Icon size={48} strokeWidth={2.5} />
        </motion.div>
        {success && (
          <motion.div
            className="passenger-details__ripple"
            initial={{ scale: 0.8, opacity: 0.6 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 0.8, repeat: 2 }}
          />
        )}
      </motion.div>

      <h2 className={`passenger-details__title passenger-details__title--${variant}`}>
        {success ? 'Validated!' : warning ? 'Warning' : 'Not Accepted'}
      </h2>

      {message && (
        <p className="passenger-details__message">{message}</p>
      )}

      {passengerName && (
        <SoftCard padding="md" className="passenger-details__profile">
          <div className="passenger-details__profile-header">
            <ProfileAvatar name={passengerName} size="lg" />
            <div>
              <p className="passenger-details__name">{passengerName}</p>
              <StatusBadge variant={variant} dot>
                {success ? 'Boarded' : warning ? 'Review' : 'Declined'}
              </StatusBadge>
            </div>
          </div>

          <div className="passenger-details__grid">
            {cardNumber && (
              <div className="passenger-details__field">
                <span className="passenger-details__field-label">QR Card</span>
                <span className="passenger-details__field-value">{cardNumber}</span>
              </div>
            )}
            {remainingBalance !== undefined && (
              <div className="passenger-details__field">
                <span className="passenger-details__field-label">Balance</span>
                <span className={`passenger-details__field-value passenger-details__field-value--${success ? 'success' : 'danger'}`}>
                  ₱{remainingBalance.toFixed(2)}
                </span>
              </div>
            )}
            {fareDeducted !== undefined && fareDeducted > 0 && (
              <div className="passenger-details__field">
                <span className="passenger-details__field-label">Fare Deducted</span>
                <span className="passenger-details__field-value passenger-details__field-value--primary">
                  ₱{fareDeducted.toFixed(2)}
                </span>
              </div>
            )}
            {currentTrip && (
              <div className="passenger-details__field">
                <span className="passenger-details__field-label">Route</span>
                <span className="passenger-details__field-value">{currentTrip}</span>
              </div>
            )}
            {timestamp && (
              <div className="passenger-details__field passenger-details__field--full">
                <span className="passenger-details__field-label">Timestamp</span>
                <span className="passenger-details__field-value">{timestamp}</span>
              </div>
            )}
          </div>
        </SoftCard>
      )}
    </motion.div>
  );
};

export default PassengerDetailsCard;
