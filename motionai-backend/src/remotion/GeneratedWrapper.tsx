import React from 'react';

import * as GeneratedModule from './DynamicAnimation.js';

const ResolvedComponent =
  (GeneratedModule as any).default ||
  (GeneratedModule as any).GeneratedAnimation ||
  (GeneratedModule as any).DynamicAnimation;

const Fallback: React.FC = () => {
  return (
    <div
      style={{
        flex: 1,
        backgroundColor: 'black',
        color: 'white',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: 48,
        fontFamily: 'sans-serif',
      }}
    >
      MotionAI Render Fallback
    </div>
  );
};

const SafeComponent: React.FC = (props) => {
  if (!ResolvedComponent) {
    console.error(
      'Failed to resolve generated animation component',
    );

    return <Fallback />;
  }

  try {
    return React.createElement(
      ResolvedComponent,
      props,
    );
  } catch (err) {
    console.error(
      'Generated component crashed:',
      err,
    );

    return <Fallback />;
  }
};

export default SafeComponent;