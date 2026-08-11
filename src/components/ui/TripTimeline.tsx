import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Navigation } from 'lucide-react';

interface TimelineStop {
  id: string;
  name: string;
  status: 'completed' | 'current' | 'upcoming';
  eta?: string;
}

interface TripTimelineProps {
  stops: TimelineStop[];
  currentStop?: string;
  nextStop?: string;
  eta?: string;
  progress?: number;
  onEndTrip?: () => void;
}

const TripTimeline: React.FC<TripTimelineProps> = ({
  stops,
  currentStop,
  nextStop,
  eta,
  progress = 0,
  onEndTrip,
}) => (
  <div className="trip-timeline">
    {(currentStop || nextStop) && (
      <div className="trip-timeline__summary">
        {currentStop && (
          <div className="trip-timeline__current">
            <MapPin size={18} />
            <div>
              <span className="trip-timeline__label">Current Stop</span>
              <span className="trip-timeline__stop-name">{currentStop}</span>
            </div>
          </div>
        )}
        {nextStop && (
          <div className="trip-timeline__next">
            <Navigation size={18} />
            <div>
              <span className="trip-timeline__label">Next Stop</span>
              <span className="trip-timeline__stop-name">{nextStop}</span>
              {eta && <span className="trip-timeline__eta">ETA {eta}</span>}
            </div>
          </div>
        )}
      </div>
    )}

    <div className="trip-timeline__progress">
      <div className="trip-timeline__progress-track">
        <motion.div
          className="trip-timeline__progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="trip-timeline__progress-label">{Math.round(progress)}% complete</span>
    </div>

    <button
      onClick={onEndTrip}
      style={{
        width: '100%',
        padding: '14px',
        marginTop: '20px',
        background: '#DC2626',
        border: 'none',
        borderRadius: '12px',
        color: 'white',
        fontWeight: 700,
        fontSize: '1rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      End Trip
    </button>
  </div>
);

export default TripTimeline;
