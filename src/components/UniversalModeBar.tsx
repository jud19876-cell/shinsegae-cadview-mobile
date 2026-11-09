/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppThemePreference, CadTheme, Point2D } from '../types/cad';
import { SunMoon } from 'lucide-react';

interface UniversalModeBarProps {
  zoom: number;
  mouseWorld: Point2D;
  unitScaleFactor: number;
  theme: CadTheme;
  themePreference: AppThemePreference;
  textScale: number;
  onSetThemePreference: (theme: AppThemePreference) => void;
  onTextScaleDown: () => void;
  onTextScaleUp: () => void;
}

export const UniversalModeBar: React.FC<UniversalModeBarProps> = ({
  zoom,
  mouseWorld,
  unitScaleFactor,
  theme,
  themePreference,
  textScale,
  onSetThemePreference,
  onTextScaleDown,
  onTextScaleUp,
}) => {
  const isCalibrated = Math.abs(unitScaleFactor - 1.0) > 0.001;

  return (
    <div className="h-9 bg-[#F8F9FA] border-b border-slate-200 px-3 flex items-center justify-between gap-2 shrink-0 z-20 overflow-x-auto no-scrollbar">
      {/* HUD Info */}
      <div className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
        <span className="w-2 h-2 rounded-full bg-[#C8102E] shrink-0"></span>
        <span className="font-bold text-[#1A1A1A]">
          {Math.round(zoom * 100)}%
        </span>
        <span className="hidden sm:inline text-slate-300">|</span>
        <span className="hidden sm:inline text-slate-700 font-semibold truncate max-w-[140px] sm:max-w-none">
          X: {mouseWorld.x.toFixed(0)}, Y: {mouseWorld.y.toFixed(0)}
        </span>
        {isCalibrated && (
          <span className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#C8102E]/10 text-[#C8102E] font-bold">
            배율 ×{unitScaleFactor.toFixed(3)}
          </span>
        )}
      </div>

      {/* Theme & Text Scaling Controls */}
      <div className="flex items-center gap-1 shrink-0 text-[11px]">
        <span className="text-[10px] text-slate-400 font-semibold mr-0.5 hidden sm:inline">
          도면배경:
        </span>
        {/* Ivory White Theme (Shinsegae Default) */}
        <button
          onClick={() => onSetThemePreference('white')}
          className={`px-2 sm:px-2.5 py-0.5 rounded-lg text-xs font-bold transition ${
            theme === 'white'
              ? 'bg-[#C8102E] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70'
          }`}
          title="신세계 표준 라이트(백지) 도면 테마"
        >
          백지<span className="hidden sm:inline"> (기본)</span>
        </button>

        {/* CAD Dark Theme */}
        <button
          onClick={() => onSetThemePreference('dark')}
          className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition ${
            theme === 'dark'
              ? 'bg-[#1A1A1A] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70'
          }`}
          title="AutoCAD 클래식 다크 도면 배경"
        >
          다크
        </button>

        {/* Engineering Blueprint Theme */}
        <button
          onClick={() => onSetThemePreference('blueprint')}
          className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition ${
            theme === 'blueprint'
              ? 'bg-[#1A1A1A] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70'
          }`}
          title="엔지니어링 청사진 도면 배경"
        >
          청사진
        </button>

        <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>

        {/* Text Scaling */}
        <button
          onClick={onTextScaleDown}
          className="px-1.5 py-0.5 rounded hover:bg-slate-200 text-[#1A1A1A] font-mono font-bold"
          title={`도면 문자 크기 축소 (현재: ${textScale}x)`}
        >
          A-
        </button>
        <button
          onClick={onTextScaleUp}
          className="px-1.5 py-0.5 rounded hover:bg-slate-200 text-[#1A1A1A] font-mono font-bold"
          title={`도면 문자 크기 확대 (현재: ${textScale}x)`}
        >
          A+
        </button>
      </div>
    </div>
  );
};
