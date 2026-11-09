/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { CadEntity, CadTheme, Extents2D } from '../types/cad';

interface MinimapProps {
  isOpen: boolean;
  theme: CadTheme;
  extents: Extents2D;
  entities: CadEntity[];
  layers: Record<string, { visible: boolean }>;
  camX: number;
  camY: number;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  onClose: () => void;
  onJumpToWorld: (wx: number, wy: number) => void;
}

export const Minimap: React.FC<MinimapProps> = ({
  isOpen,
  theme,
  extents,
  entities,
  layers,
  camX,
  camY,
  zoom,
  canvasWidth,
  canvasHeight,
  onClose,
  onJumpToWorld,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mw = canvas.width;
    const mh = canvas.height;

    ctx.fillStyle = theme === 'white' ? '#F1F5F9' : '#070B12';
    ctx.fillRect(0, 0, mw, mh);

    if (entities.length === 0) return;

    const extW = Math.max(10, extents.maxX - extents.minX);
    const extH = Math.max(10, extents.maxY - extents.minY);
    const scale = Math.min((mw - 14) / extW, (mh - 14) / extH);
    const cx = (extents.minX + extents.maxX) / 2;
    const cy = (extents.minY + extents.maxY) / 2;

    function mPt(wx: number, wy: number) {
      return {
        x: mw / 2 + (wx - cx) * scale,
        y: mh / 2 - (wy - cy) * scale,
      };
    }

    ctx.strokeStyle = theme === 'white' ? '#64748B' : '#94A3B8';
    ctx.lineWidth = 1;
    ctx.beginPath();

    const stride = Math.max(1, Math.floor(entities.length / 2500));
    for (let i = 0; i < entities.length; i += stride) {
      const e = entities[i];
      const lyr = layers[e.layer || '0'];
      if (lyr && !lyr.visible) continue;

      if (e.type === 'LINE' && e.start && e.end) {
        const p1 = mPt(e.start.x, e.start.y);
        const p2 = mPt(e.end.x, e.end.y);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      } else if (e.type === 'LWPOLYLINE' && e.vertices && e.vertices.length >= 2) {
        const p0 = mPt(e.vertices[0].x, e.vertices[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let k = 1; k < e.vertices.length; k++) {
          const pk = mPt(e.vertices[k].x, e.vertices[k].y);
          ctx.lineTo(pk.x, pk.y);
        }
      }
    }
    ctx.stroke();

    // Camera viewport bounding box
    const halfVw = canvasWidth / 2 / zoom;
    const halfVh = canvasHeight / 2 / zoom;
    const tl = mPt(camX - halfVw, camY + halfVh);
    const br = mPt(camX + halfVw, camY - halfVh);

    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      Math.min(tl.x, br.x),
      Math.min(tl.y, br.y),
      Math.abs(br.x - tl.x),
      Math.abs(br.y - tl.y)
    );
  }, [
    isOpen,
    theme,
    extents,
    entities,
    layers,
    camX,
    camY,
    zoom,
    canvasWidth,
    canvasHeight,
  ]);

  if (!isOpen) return null;

  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const mw = canvas.width;
    const mh = canvas.height;
    const extW = Math.max(10, extents.maxX - extents.minX);
    const extH = Math.max(10, extents.maxY - extents.minY);
    const scale = Math.min((mw - 14) / extW, (mh - 14) / extH);
    const cx = (extents.minX + extents.maxX) / 2;
    const cy = (extents.minY + extents.maxY) / 2;

    const targetWx = cx + (mx - mw / 2) / scale;
    const targetWy = cy - (my - mh / 2) / scale;
    onJumpToWorld(targetWx, targetWy);
  };

  return (
    <div className="absolute right-3 bottom-3 z-20 bg-white/95 border border-slate-200 rounded-xl p-1.5 shadow-xl">
      <div className="flex items-center justify-between text-[10px] text-[#1A1A1A] px-1 mb-1">
        <span className="font-bold">도면 미니맵</span>
        <button onClick={onClose} className="hover:opacity-75 p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={140}
        height={95}
        onClick={handleMinimapClick}
        className="rounded border border-slate-200 block cursor-pointer"
        title="터치하여 해당 위치로 화면 이동"
      />
    </div>
  );
};
