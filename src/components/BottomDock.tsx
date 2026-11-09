/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Hand, MousePointer, Ruler, Scaling, Magnet, Map as MapIcon } from 'lucide-react';
import { ToolMode } from '../types/cad';

interface BottomDockProps {
  mode: ToolMode;
  showGrid: boolean;
  showMinimap: boolean;
  onSetMode: (mode: ToolMode) => void;
  onToggleGrid: () => void;
  onToggleMinimap: () => void;
}

export const BottomDock: React.FC<BottomDockProps> = ({
  mode,
  showGrid,
  showMinimap,
  onSetMode,
  onToggleGrid,
  onToggleMinimap,
}) => {
  return (
    <footer className="h-14 sm:h-16 bg-white border-t border-slate-200 px-1.5 sm:px-2 flex items-center justify-around gap-1 shrink-0 z-30 pb-safe shadow-md">
      {/* 1. Pan Tool */}
      <button
        onClick={() => onSetMode('pan')}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-xl text-xs font-semibold transition active:scale-95 ${
          mode === 'pan'
            ? 'bg-[#C8102E] text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
        title="터치로 도면 화면 자유 이동"
      >
        <Hand className="w-4 h-4 shrink-0" />
        <span className="text-[10px] sm:text-[11px] whitespace-nowrap tracking-tight">
          <span className="hidden sm:inline">화면</span>이동
        </span>
      </button>

      {/* 2. Select Tool */}
      <button
        onClick={() => onSetMode('select')}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-xl text-xs font-semibold transition active:scale-95 ${
          mode === 'select'
            ? 'bg-[#1A1A1A] text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
        title="선, 호, 원, 텍스트 객체 터치 및 속성 확인"
      >
        <MousePointer className="w-4 h-4 shrink-0" />
        <span className="text-[10px] sm:text-[11px] whitespace-nowrap tracking-tight">
          <span className="hidden sm:inline">객체</span>선택
        </span>
      </button>

      {/* 3. Measure Tool */}
      <button
        onClick={() => onSetMode('measure')}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-xl text-xs font-semibold transition active:scale-95 ${
          mode === 'measure'
            ? 'bg-[#C8102E] text-white shadow-sm'
            : 'text-[#C8102E] hover:bg-rose-50'
        }`}
        title="두 지점을 터치하여 실제 길이 및 치수 측정"
      >
        <Ruler className="w-4 h-4 shrink-0" />
        <span className="text-[10px] sm:text-[11px] whitespace-nowrap tracking-tight">
          <span className="hidden sm:inline">거리</span>측정
        </span>
      </button>

      {/* 4. Calibrate Tool */}
      <button
        onClick={() => onSetMode('calibrate')}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-xl text-xs font-semibold transition active:scale-95 ${
          mode === 'calibrate'
            ? 'bg-[#1A1A1A] text-white shadow-sm'
            : 'text-slate-700 hover:bg-slate-100'
        }`}
        title="기준 치수 2점을 터치하여 도면 실제 1:1 축척 교정"
      >
        <Scaling className="w-4 h-4 shrink-0" />
        <span className="text-[10px] sm:text-[11px] whitespace-nowrap tracking-tight">
          <span className="hidden sm:inline">2점</span>축척
        </span>
      </button>

      {/* 5. Snap & Grid Toggle */}
      <button
        onClick={onToggleGrid}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-xl text-xs font-semibold transition active:scale-95 ${
          showGrid
            ? 'text-emerald-700 font-bold bg-emerald-50 border border-emerald-200'
            : 'text-slate-400 hover:bg-slate-100'
        }`}
        title="그리드 표시 및 끝점·중심점 자석 스냅(OSNAP) On/Off"
      >
        <Magnet className="w-4 h-4 shrink-0" />
        <span className="text-[10px] sm:text-[11px] whitespace-nowrap tracking-tight">
          <span className="hidden sm:inline">스냅·</span>격자
        </span>
      </button>

      {/* 6. Minimap Toggle */}
      <button
        onClick={onToggleMinimap}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-xl text-xs font-semibold transition active:scale-95 ${
          showMinimap
            ? 'bg-[#1A1A1A] text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
        title="도면 전체 미니맵 표시/숨김"
      >
        <MapIcon className="w-4 h-4 shrink-0" />
        <span className="text-[10px] sm:text-[11px] whitespace-nowrap tracking-tight">미니맵</span>
      </button>
    </footer>
  );
};
