/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CadTheme } from '../types/cad';

export const ACI_DARK_PALETTE: Record<number, string> = {
  0: '#f8fafc',
  1: '#ff3b30', // Red
  2: '#ffcc00', // Yellow
  3: '#28cd41', // Green
  4: '#00d7ff', // Cyan
  5: '#3b82f6', // Blue
  6: '#e879f9', // Magenta
  7: '#f8fafc', // White
  8: '#94a3b8', // Gray
  9: '#cbd5e1', // Light Gray
  10: '#ff2d55',
  20: '#ff6d00',
  30: '#ff9500',
  40: '#ffea00',
  50: '#ffd600',
  70: '#64dd17',
  90: '#00bfa5',
  130: '#3d5afe',
  150: '#aa00ff',
  250: '#64748b',
  251: '#94a3b8',
  252: '#cbd5e1',
  253: '#e2e8f0',
  254: '#f1f5f9',
};

export const ACI_LIGHT_PALETTE: Record<number, string> = {
  0: '#0f172a',
  1: '#dc2626', // Red
  2: '#b45309', // Deep Amber / Dark Yellow
  3: '#15803d', // Dark Forest Green
  4: '#0369a1', // Deep Ocean Cyan
  5: '#1d4ed8', // Royal Blue
  6: '#a21caf', // Deep Magenta
  7: '#0f172a', // Slate Black (on Ivory)
  8: '#475569',
  9: '#64748b',
  10: '#be123c',
  20: '#c2410c',
  30: '#b45309',
  40: '#a16207',
  50: '#854d0e',
  70: '#166534',
  90: '#0f766e',
  130: '#1e40af',
  150: '#6b21a8',
  250: '#334155',
  251: '#475569',
  252: '#64748b',
  253: '#475569',
  254: '#334155',
};

export function resolveCadColorValue(rawVal: unknown, theme: CadTheme): string {
  const isLight = theme === 'white';
  const isBlueprint = theme === 'blueprint';

  if (rawVal === undefined || rawVal === null) {
    if (isBlueprint) return '#93c5fd';
    return isLight ? '#0f172a' : '#f8fafc';
  }

  // Handle object color with colorIndex or rgb
  if (typeof rawVal === 'object' && rawVal !== null) {
    const obj = rawVal as { colorIndex?: number; rgb?: number };
    if (obj.colorIndex !== undefined) return resolveCadColorValue(obj.colorIndex, theme);
    if (obj.rgb !== undefined) return resolveCadColorValue(obj.rgb, theme);
  }

  const num = Math.abs(parseInt(String(rawVal), 10));
  if (isNaN(num)) {
    if (isBlueprint) return '#93c5fd';
    return isLight ? '#0f172a' : '#f8fafc';
  }

  // TrueColor 24-bit RGB integer (> 256)
  if (num > 256) {
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;

    if (isLight) {
      if (r > 230 && g > 230 && b > 230) return '#0f172a'; // White to Slate Black
      if (r > 220 && g > 220 && b < 60) return '#b45309'; // Bright Yellow to Dark Amber
      if (r < 60 && g > 200 && b > 200) return '#0369a1'; // Bright Cyan to Ocean Blue
      if (r < 60 && g > 200 && b < 60) return '#15803d'; // Bright Green to Forest Green
    } else if (isBlueprint) {
      if (r < 60 && g < 60 && b < 60) return '#ffffff';
    } else {
      if (r < 30 && g < 30 && b < 30) return '#f8fafc'; // Black to White in Dark Mode
    }

    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  const code = num % 256;
  const pal = isLight ? ACI_LIGHT_PALETTE : ACI_DARK_PALETTE;
  if (pal[code]) return pal[code];

  const hue = (code * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 80%, ${isLight ? '36%' : '65%'})`;
}
