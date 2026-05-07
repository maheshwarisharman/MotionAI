/**
 * DynamicAnimation — a placeholder Remotion composition used for local
 * development preview. At render time, the render service replaces this
 * with the LLM-generated component by writing a dynamic entry file.
 *
 * This component demonstrates a clean, self-contained animation pattern
 * that the LLM should follow.
 */

import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
} from 'remotion';

const BRAND_COLORS = {
  primary: '#6C63FF',
  secondary: '#FF6584',
  accent: '#43EAAD',
  background: '#0F0F1A',
  text: '#FFFFFF',
};

/** Animated gradient background */
const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const hueShift = interpolate(frame, [0, 300], [0, 30]);

  return (
    <div
      style={{
        position: 'absolute',
        width,
        height,
        background: `radial-gradient(ellipse at 30% 30%, hsl(${250 + hueShift}, 60%, 25%) 0%, ${BRAND_COLORS.background} 70%)`,
      }}
    />
  );
};

/** Main title with spring entrance */
const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <h1
        style={{
          fontFamily: 'sans-serif',
          fontSize: 96,
          fontWeight: 800,
          color: BRAND_COLORS.text,
          margin: 0,
          letterSpacing: -2,
          background: `linear-gradient(135deg, ${BRAND_COLORS.primary}, ${BRAND_COLORS.accent})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        MotionAI
      </h1>
    </div>
  );
};

/** Subtitle slide-up with fade */
const Subtitle: React.FC = () => {
  const frame = useCurrentFrame();

  const translateY = interpolate(frame, [0, 20], [40, 0], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <p
      style={{
        fontFamily: 'sans-serif',
        fontSize: 32,
        color: `rgba(255,255,255,0.7)`,
        margin: 0,
        transform: `translateY(${translateY}px)`,
        opacity,
        textAlign: 'center',
        letterSpacing: 4,
        textTransform: 'uppercase',
      }}
    >
      AI-Powered Infographic Animations
    </p>
  );
};

/** Pulsing accent dot */
const AccentDot: React.FC<{ x: number; y: number; delay: number; color: string }> = ({
  x,
  y,
  delay,
  color,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const pulse = interpolate(
    frame,
    [delay, delay + 60, delay + 120],
    [1, 1.3, 1],
    { extrapolateRight: 'clamp' },
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: color,
        transform: `scale(${scale * pulse})`,
        boxShadow: `0 0 20px ${color}88`,
      }}
    />
  );
};

// ---------------------------------------------------------------------------
// Main Composition
// ---------------------------------------------------------------------------

export const DynamicAnimation: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // Global fade-out in the last 30 frames (1 second at 30fps)
  const globalOpacity = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', opacity: globalOpacity }}>
      <Background />

      {/* Scene 1: Logo entrance */}
      <Sequence from={0} durationInFrames={150}>
        <div
          style={{
            position: 'absolute',
            width,
            height,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 24,
          }}
        >
          <Title />
          <Sequence from={20}>
            <Subtitle />
          </Sequence>
        </div>

        {/* Decorative floating dots */}
        <AccentDot x={100} y={100} delay={10} color={BRAND_COLORS.primary} />
        <AccentDot x={width - 140} y={80} delay={20} color={BRAND_COLORS.secondary} />
        <AccentDot x={60} y={height - 120} delay={15} color={BRAND_COLORS.accent} />
        <AccentDot x={width - 100} y={height - 100} delay={25} color={BRAND_COLORS.primary} />
      </Sequence>

      {/* Scene 2: Feature callouts */}
      <Sequence from={120} durationInFrames={180}>
        <FeatureScene width={width} height={height} />
      </Sequence>
    </div>
  );
};

/** Feature highlights scene */
const FeatureScene: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const features = [
    { label: 'Gemini 1.5 Pro', icon: '🤖', color: BRAND_COLORS.primary },
    { label: 'Remotion Renderer', icon: '🎬', color: BRAND_COLORS.secondary },
    { label: 'AWS S3 Storage', icon: '☁️', color: BRAND_COLORS.accent },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
      }}
    >
      <div style={{ display: 'flex', gap: 40 }}>
        {features.map((f, i) => {
          const delay = i * 15;
          const sc = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 14 },
          });
          const op = interpolate(frame, [delay, delay + 20], [0, 1], {
            extrapolateRight: 'clamp',
          });

          return (
            <div
              key={f.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                transform: `scale(${sc})`,
                opacity: op,
                background: `${f.color}22`,
                border: `2px solid ${f.color}66`,
                borderRadius: 24,
                padding: '32px 40px',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span style={{ fontSize: 48 }}>{f.icon}</span>
              <span
                style={{
                  fontFamily: 'sans-serif',
                  fontSize: 22,
                  fontWeight: 700,
                  color: BRAND_COLORS.text,
                }}
              >
                {f.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
