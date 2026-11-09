/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { X, Ruler } from 'lucide-react';

interface ScaleModalProps {
  isOpen: boolean;
  rawDistance: number;
  currentScaleFactor: number;
  onClose: () => void;
  onApplyScale: (realDistanceMm: number) => void;
  onResetScale: () => void;
}

export const ScaleModal: React.FC<ScaleModalProps> = ({
  isOpen,
  rawDistance,
  currentScaleFactor,
  onClose,
  onApplyScale,
  onResetScale,
}) => {
  const [realMm, setRealMm] = useState<string>('');

  useEffect(() => {
    if (isOpen && rawDistance > 0) {
      setRealMm(String(Math.round(rawDistance * currentScaleFactor)));
    }
  }, [isOpen, rawDistance, currentScaleFactor]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(realMm);
    if (val > 0) {
      onApplyScale(val);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
          <div className="flex items-center gap-2">
            <Ruler className="w-4 h-4 text-[#C8102E]" />
            <h3 className="text-sm font-bold text-[#1A1A1A]">
              2점 기준 축척(Scale) 교정
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-[#1A1A1A] p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          선택한 두 점 사이의 도면 원시 거리는{' '}
          <strong className="font-mono text-[#C8102E]">
            {rawDistance.toFixed(2)}
          </strong>{' '}
          입니다.
          <br />
          치수선에 적힌 <strong>실제 길이(mm)</strong>를 입력하면 이후 모든
          거리 측정이 실제 치수로 자동 환산됩니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              실제 기준 치수 (mm)
            </label>
            <input
              type="number"
              step="any"
              placeholder="예: 6000"
              value={realMm}
              onChange={(e) => setRealMm(e.target.value)}
              className="w-full bg-[#F8F9FA] border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono text-[#1A1A1A] focus:outline-none focus:border-[#C8102E]"
              autoFocus
            />
          </div>

          <div className="flex justify-between items-center pt-1">
            <button
              type="button"
              onClick={() => {
                onResetScale();
                onClose();
              }}
              className="text-xs text-slate-500 hover:text-[#1A1A1A] underline"
            >
              1:1 초기화
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
              >
                취소
              </button>
              <button
                type="submit"
                className="bg-[#C8102E] hover:bg-[#a50d26] text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-xs active:scale-95 transition"
              >
                축척 적용
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
