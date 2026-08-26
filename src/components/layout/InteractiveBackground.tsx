import React from 'react';

const ORBS = [
  { className: 'interactive-bg__orb interactive-bg__orb--1', delay: 0 },
  { className: 'interactive-bg__orb interactive-bg__orb--2', delay: 2 },
  { className: 'interactive-bg__orb interactive-bg__orb--3', delay: 4 },
  { className: 'interactive-bg__orb interactive-bg__orb--4', delay: 1 },
];

const InteractiveBackground: React.FC = () => (
  <div className="interactive-bg" aria-hidden="true">
    <div className="interactive-bg__gradient" />

    {ORBS.map(({ className, delay }) => (
      <div
        key={className}
        className={className}
        style={{ animationDelay: `${delay}s` }}
      />
    ))}

    <div className="interactive-bg__grid" />
    <div className="interactive-bg__noise" />
  </div>
);

export default InteractiveBackground;
