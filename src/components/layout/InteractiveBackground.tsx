import React from 'react';

const InteractiveBackground: React.FC = () => (
  <div className="interactive-bg" aria-hidden="true">
    <div className="interactive-bg__gradient" />
    <div className="interactive-bg__grid" />
  </div>
);

export default InteractiveBackground;
