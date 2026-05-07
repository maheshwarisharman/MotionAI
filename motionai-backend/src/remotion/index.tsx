/**
 * Remotion root — registers the DynamicAnimation composition.
 * This file is the static entry point used during development/preview.
 * The render service generates its own entry file dynamically at runtime.
 */

import React from 'react';
import { registerRoot, Composition } from 'remotion';
import { DynamicAnimation } from './DynamicAnimation.js';

const Root: React.FC = () => (
  <Composition
    id="DynamicAnimation"
    component={DynamicAnimation}
    durationInFrames={300}
    fps={30}
    width={1280}
    height={720}
  />
);

registerRoot(Root);
