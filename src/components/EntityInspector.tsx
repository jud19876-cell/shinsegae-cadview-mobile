/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X } from 'lucide-react';
import { CadEntity } from '../types/cad';

interface EntityInspectorProps {
  entity: CadEntity | null;
  unitScaleFactor: number;
  onClose: () => void;
}

export const EntityInspector: React.FC<EntityInspectorProps> = ({
  entity,
  unitScaleFactor,
  onClose,
}) => {
  if (!entity) return null;

  const sf = unitScaleFactor || 1;
  const items: string[] = [];

  if (entity.type === 'LINE' && entity.start && entity.end) {
    const len = Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y) * sf;
    items.push(`길이: ${len.toFixed(1)} mm`);
    items.push(`ΔX: ${((entity.end.x - entity.start.x) * sf).toFixed(1)}`);
    items.push(`ΔY: ${((entity.end.y - entity.start.y) * sf).toFixed(1)}`);
  } else if (entity.type === 'CIRCLE' && entity.center) {
    items.push(`반지름 R: ${(entity.radius * sf).toFixed(1)} mm`);
    items.push(`지름 Ø: ${(entity.radius * 2 * sf).toFixed(1)} mm`);
  } else if (entity.type === 'ARC' && entity.center) {
    items.push(`반지름 R: ${(entity.radius * sf).toFixed(1)} mm`);
    items.push(`각도: ${Math.round(entity.startAngle)}° ~ ${Math.round(entity.endAngle)}°`);
  } else if (entity.type === 'LWPOLYLINE' && entity.vertices) {
    let len = 0;
    for (let i = 0; i < entity.vertices.length - 1; i++) {
      len += Math.hypot(
        entity.vertices[i + 1].x - entity.vertices[i].x,
        entity.vertices[i + 1].y - entity.vertices[i].y
      );
    }
    items.push(`꼭짓점: ${entity.vertices.length}개`);
    items.push(`총 길이: ${(len * sf).toFixed(1)} mm`);
    if (entity.closed) items.push('형태: 닫힌 폴리라인 (Closed)');
  } else if (entity.type === 'TEXT') {
    items.push(`내용: ${entity.text}`);
    items.push(`높이: ${Math.round(entity.height * sf)}`);
  }

  return (
    <div className="fixed inset-x-0 bottom-16 z-30 p-3 pointer-events-none">
      <div className="pointer-events-auto max-w-md mx-auto bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-3.5 shadow-2xl">
        <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-[#C8102E] text-white font-mono text-[11px] font-bold">
              {entity.type}
            </span>
            <span className="text-xs font-bold text-[#1A1A1A]">
              레이어: {entity.layer || '0'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-[#1A1A1A] text-xs p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-700 font-mono">
          {items.map((t, idx) => (
            <div
              key={idx}
              className="bg-[#F8F9FA] px-2.5 py-1.5 rounded-lg border border-slate-200 truncate"
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
