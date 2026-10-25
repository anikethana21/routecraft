import React from 'react';
import logoMark from '../assets/logo-mark.png';

/**
 * RouteCraft mark: a white-outline spaceship flying over a highway loop.
 * Rendered from the brand artwork so the header, favicon and extension icon
 * all stay identical.
 */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 30, className = '' }) => (
  <span
    className={`logo-mark ${className}`}
    style={{ width: size, height: size, borderRadius: Math.max(5, Math.round(size * 0.24)) }}
    aria-hidden="true"
  >
    <img src={logoMark} alt="" width={size} height={size} draggable={false} />
  </span>
);
