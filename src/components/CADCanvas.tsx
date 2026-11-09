/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import {
  Maximize2,
  RotateCw,
  Eraser,
  FolderOpen,
  Compass,
  Clock,
  History,
  Eye,
  EyeOff,
  Cloud,
} from 'lucide-react';
import {
  CadEntity,
  CadTheme,
  Extents2D,
  MeasurementItem,
  Point2D,
  RasterPreviewEntity,
  RenderBatch,
  SnapPoint,
  TextEntity,
  ToolMode,
} from '../types/cad';
import { resolveCadColorValue } from '../lib/cadColors';
import { RecentDrawingItem, formatRelativeTime, captureCanvasThumbnail } from '../lib/drawingStorage';

export interface CADCanvasHandle {
  captureThumbnail: () => string | null;
  fitExtents: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  requestRender: (force?: boolean) => void;
}

export interface CADCanvasProps {
  theme: CadTheme;
  mode: ToolMode;
  showGrid: boolean;
  enableOsnap: boolean;
  textScale: number;
  unitScaleFactor: number;
  rotation: number;
  camX: number;
  camY: number;
  zoom: number;
  extents: Extents2D;
  entities: CadEntity[];
  renderBatches: RenderBatch[];
  textEntities: TextEntity[];
  rasterEntities: RasterPreviewEntity[];
  layers: Record<string, { visible: boolean; aci: number }>;
  selectedEntity: CadEntity | null;
  measurements: MeasurementItem[];
  measurePoints: Point2D[];
  isLoading: boolean;
  loadingMessage: string;
  recentDrawings?: RecentDrawingItem[];
  isMenuHidden?: boolean;
  onToggleMenuHidden?: () => void;
  onSelectRecentDrawing?: (item: RecentDrawingItem) => void;
  onOpenSelectModal?: () => void;
  onOpenCloudModal?: () => void;
  onUpdateCamera: (camX: number, camY: number, zoom: number) => void;
  onRotate90: () => void;
  onSelectEntity: (entity: CadEntity | null) => void;
  onAddMeasurement: (p1: Point2D, p2: Point2D, distanceMm: number) => void;
  onStartCalibration: (rawDist: number) => void;
  onClearMeasurements: () => void;
  onCancelMode: () => void;
  onOpenFileClick: () => void;
  onLoadArchSample: () => void;
  onLoadMechSample: () => void;
  onUpdateMouseWorld: (pt: Point2D) => void;
}

export const CADCanvas = forwardRef<CADCanvasHandle, CADCanvasProps>(({
  theme,
  mode,
  showGrid,
  enableOsnap,
  textScale,
  unitScaleFactor,
  rotation,
  camX,
  camY,
  zoom,
  extents,
  entities,
  renderBatches,
  textEntities,
  rasterEntities,
  layers,
  selectedEntity,
  measurements,
  measurePoints,
  isLoading,
  loadingMessage,
  recentDrawings = [],
  isMenuHidden = false,
  onToggleMenuHidden,
  onSelectRecentDrawing,
  onOpenSelectModal,
  onOpenCloudModal,
  onUpdateCamera,
  onRotate90,
  onSelectEntity,
  onAddMeasurement,
  onStartCalibration,
  onClearMeasurements,
  onCancelMode,
  onOpenFileClick,
  onLoadArchSample,
  onLoadMechSample,
  onUpdateMouseWorld,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeWrapperRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const [canvasDimensions, setCanvasDimensions] = useState({ width: 400, height: 600 });
  const prevIsPortraitRef = useRef<boolean | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartScreenRef = useRef({ x: 0, y: 0 });
  const dragStartCamRef = useRef({ x: 0, y: 0 });
  const pinchDistStartRef = useRef(0);
  const tapStartPosRef = useRef({ x: 0, y: 0 });
  const snapPointRef = useRef<SnapPoint | null>(null);

  // Coordinate transforms
  const worldToScreen = useCallback(
    (wx: number, wy: number) => {
      const c = canvasRef.current;
      if (!c) return { x: 0, y: 0 };
      const cw = c.width;
      const ch = c.height;
      const dx = wx - camX;
      const dy = wy - camY;
      const rad = (rotation * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const rx = dx * cosA - dy * sinA;
      const ry = dx * sinA + dy * cosA;
      return { x: cw / 2 + rx * zoom, y: ch / 2 - ry * zoom };
    },
    [camX, camY, zoom, rotation]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const c = canvasRef.current;
      if (!c) return { x: 0, y: 0 };
      const cw = c.width;
      const ch = c.height;
      const rx = (sx - cw / 2) / zoom;
      const ry = -(sy - ch / 2) / zoom;
      const rad = (-rotation * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      return {
        x: camX + (rx * cosA - ry * sinA),
        y: camY + (rx * sinA + ry * cosA),
      };
    },
    [camX, camY, zoom, rotation]
  );

  // OSNAP Finder
  const findSnapPoint = useCallback(
    (sx: number, sy: number): SnapPoint | null => {
      if (!enableOsnap || entities.length === 0) return null;
      let best: SnapPoint | null = null;
      let bestDist = 18;
      const wPt = screenToWorld(sx, sy);
      const worldRadius = 24 / zoom;

      function check(wx: number, wy: number, type: 'END' | 'MID' | 'CEN') {
        if (
          Math.abs(wx - wPt.x) > worldRadius ||
          Math.abs(wy - wPt.y) > worldRadius
        )
          return;
        const sp = worldToScreen(wx, wy);
        const d = Math.hypot(sp.x - sx, sp.y - sy);
        if (d < bestDist) {
          bestDist = d;
          best = { x: wx, y: wy, type };
        }
      }

      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        const lyr = layers[e.layer || '0'];
        if (lyr && !lyr.visible) continue;

        if (e.type === 'LINE' && e.start && e.end) {
          check(e.start.x, e.start.y, 'END');
          check(e.end.x, e.end.y, 'END');
          check((e.start.x + e.end.x) / 2, (e.start.y + e.end.y) / 2, 'MID');
        } else if (e.type === 'LWPOLYLINE' && e.vertices) {
          for (let k = 0; k < e.vertices.length; k++) {
            check(e.vertices[k].x, e.vertices[k].y, 'END');
          }
        } else if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.center) {
          check(e.center.x, e.center.y, 'CEN');
        }
      }
      return best;
    },
    [enableOsnap, entities, layers, zoom, screenToWorld, worldToScreen]
  );

  // Entity Finder
  const findEntityAt = useCallback(
    (sx: number, sy: number): CadEntity | null => {
      let best: CadEntity | null = null;
      let minDist = 14;

      function distToSeg(
        px: number,
        py: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number
      ) {
        const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        if (l2 === 0) return Math.hypot(px - x1, py - y1);
        const t = Math.max(
          0,
          Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2)
        );
        return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
      }

      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        const lyr = layers[e.layer || '0'];
        if (lyr && !lyr.visible) continue;

        if (e.type === 'LINE' && e.start && e.end) {
          const p1 = worldToScreen(e.start.x, e.start.y);
          const p2 = worldToScreen(e.end.x, e.end.y);
          const d = distToSeg(sx, sy, p1.x, p1.y, p2.x, p2.y);
          if (d < minDist) {
            minDist = d;
            best = e;
          }
        } else if (
          e.type === 'LWPOLYLINE' &&
          e.vertices &&
          e.vertices.length >= 2
        ) {
          for (let k = 0; k < e.vertices.length - 1; k++) {
            const p1 = worldToScreen(e.vertices[k].x, e.vertices[k].y);
            const p2 = worldToScreen(e.vertices[k + 1].x, e.vertices[k + 1].y);
            const d = distToSeg(sx, sy, p1.x, p1.y, p2.x, p2.y);
            if (d < minDist) {
              minDist = d;
              best = e;
            }
          }
        } else if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.center) {
          const c = worldToScreen(e.center.x, e.center.y);
          const d = Math.abs(
            Math.hypot(sx - c.x, sy - c.y) - e.radius * zoom
          );
          if (d < minDist) {
            minDist = d;
            best = e;
          }
        } else if (e.type === 'TEXT' && e.position) {
          const p = worldToScreen(e.position.x, e.position.y);
          const d = Math.hypot(sx - p.x, sy - p.y);
          if (d < 24 && d < minDist + 12) {
            minDist = Math.min(minDist, d);
            best = e;
          }
        }
      }
      return best;
    },
    [entities, layers, worldToScreen, zoom]
  );

  // Fit Extents to Screen
  const handleFitExtents = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const cw = c.width || 360;
    const ch = c.height || 600;
    const w = Math.max(10, extents.maxX - extents.minX);
    const h = Math.max(10, extents.maxY - extents.minY);
    const newCamX = (extents.minX + extents.maxX) / 2;
    const newCamY = (extents.minY + extents.maxY) / 2;
    const newZoom = Math.min((cw * 0.86) / w, (ch * 0.86) / h);
    onUpdateCamera(newCamX, newCamY, newZoom);
  }, [extents, onUpdateCamera]);

  useImperativeHandle(
    ref,
    () => ({
      captureThumbnail: () => {
        if (!canvasRef.current) return null;
        latestRef.current.ensureRendered();
        return captureCanvasThumbnail(canvasRef.current, 320, 200);
      },
      fitExtents: handleFitExtents,
      getCanvas: () => canvasRef.current,
      requestRender: (force?: boolean) => latestRef.current.requestRender(force ?? true),
    }),
    [handleFitExtents]
  );

  // Touch Loupe Magnifier
  const updateTouchLoupe = (sx: number, sy: number) => {
    const wrapper = loupeWrapperRef.current;
    const lCanv = loupeCanvasRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !lCanv || !canvas) return;

    if (mode !== 'measure' && mode !== 'calibrate') {
      wrapper.classList.add('hidden');
      return;
    }
    wrapper.classList.remove('hidden');
    const lw = 112;
    const lh = 112;
    wrapper.style.left = `${Math.max(8, Math.min(canvas.width - lw - 8, sx - lw / 2))}px`;
    wrapper.style.top = `${Math.max(8, sy - lh - 40)}px`;

    const lCtx = lCanv.getContext('2d');
    if (!lCtx) return;
    lCtx.clearRect(0, 0, lw, lh);
    const z = 2.4;
    lCtx.drawImage(
      canvas,
      sx - lw / z / 2,
      sy - lh / z / 2,
      lw / z,
      lh / z,
      0,
      0,
      lw,
      lh
    );
    lCtx.strokeStyle = '#C8102E';
    lCtx.lineWidth = 1.4;
    lCtx.beginPath();
    lCtx.moveTo(lw / 2, 0);
    lCtx.lineTo(lw / 2, lh);
    lCtx.moveTo(0, lh / 2);
    lCtx.lineTo(lw, lh / 2);
    lCtx.stroke();
  };

  const handlePointTap = (sx: number, sy: number) => {
    if (mode === 'select') {
      const hit = findEntityAt(sx, sy);
      onSelectEntity(hit);
      return;
    }

    const snap = mode === 'measure' || mode === 'calibrate' ? findSnapPoint(sx, sy) : null;
    const wp = snap ? { x: snap.x, y: snap.y } : screenToWorld(sx, sy);

    if (mode === 'measure') {
      if (measurePoints.length === 0) {
        onAddMeasurement(wp, wp, 0); // Temporary set first point
      } else if (measurePoints.length === 1) {
        const p1 = measurePoints[0];
        const p2 = wp;
        const distMm = Math.hypot(p2.x - p1.x, p2.y - p1.y) * unitScaleFactor;
        onAddMeasurement(p1, p2, distMm);
      }
      return;
    }

    if (mode === 'calibrate') {
      if (measurePoints.length === 0) {
        onAddMeasurement(wp, wp, 0);
      } else if (measurePoints.length === 1) {
        const p1 = measurePoints[0];
        const p2 = wp;
        const rawDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        onStartCalibration(rawDist);
      }
    }
  };

  interface RenderStateSnapshot {
    cw: number;
    ch: number;
    camX: number;
    camY: number;
    zoom: number;
    rotation: number;
    theme: string;
    showGrid: boolean;
    enableOsnap: boolean;
    textScale: number;
    snapKey: string;
    entitiesLen: number;
    batchesLen: number;
    textsLen: number;
    rastersLen: number;
    layersKey: string;
    selectedId: string;
    measurementsLen: number;
    measurePointsKey: string;
    isInteracting: boolean;
  }

  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isDirtyRef = useRef<boolean>(true);
  const isInteractingRef = useRef<boolean>(false);
  const interactTimerRef = useRef<number | null>(null);
  const lastMouseWorldEmitRef = useRef<number>(0);
  const lastRenderStateRef = useRef<RenderStateSnapshot | null>(null);

  const markInteracting = useCallback(() => {
    isInteractingRef.current = true;
    if (interactTimerRef.current !== null) {
      window.clearTimeout(interactTimerRef.current);
    }
    interactTimerRef.current = window.setTimeout(() => {
      isInteractingRef.current = false;
      interactTimerRef.current = null;
      latestRef.current.requestRender(true);
    }, 140);
  }, []);

  const latestRef = useRef({
    camX,
    camY,
    zoom,
    rotation,
    mode,
    unitScaleFactor,
    screenToWorld,
    worldToScreen,
    findSnapPoint,
    onUpdateCamera,
    onUpdateMouseWorld,
    handlePointTap,
    updateTouchLoupe,
    theme,
    showGrid,
    enableOsnap,
    textScale,
    entities,
    extents,
    renderBatches,
    textEntities,
    rasterEntities,
    layers,
    selectedEntity,
    measurements,
    measurePoints,
    requestRender: (_force?: boolean) => {},
    ensureRendered: () => {},
  });

  latestRef.current = {
    camX,
    camY,
    zoom,
    rotation,
    mode,
    unitScaleFactor,
    screenToWorld,
    worldToScreen,
    findSnapPoint,
    onUpdateCamera,
    onUpdateMouseWorld,
    handlePointTap,
    updateTouchLoupe,
    theme,
    showGrid,
    enableOsnap,
    textScale,
    entities,
    extents,
    renderBatches,
    textEntities,
    rasterEntities,
    layers,
    selectedEntity,
    measurements,
    measurePoints,
    requestRender: (force?: boolean) => {
      requestRender(force);
    },
    ensureRendered: () => {
      render();
    },
  };

  // Request-on-Demand Double-Buffered Render Function (Only draws when visual changes occur)
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cw = canvas.width;
    const ch = canvas.height;
    if (!cw || !ch) return;

    const {
      camX,
      camY,
      zoom,
      rotation,
      theme,
      showGrid,
      enableOsnap,
      textScale,
      entities,
      renderBatches,
      textEntities,
      rasterEntities,
      layers,
      selectedEntity,
      measurements,
      measurePoints,
      worldToScreen,
      screenToWorld,
    } = latestRef.current;

    // Check snap point
    const curSnap = snapPointRef.current;
    const snapKey = curSnap ? `${curSnap.x.toFixed(1)},${curSnap.y.toFixed(1)},${curSnap.type}` : '';

    // Quick layer visibility signature
    let layersKey = '';
    const layerNames = Object.keys(layers);
    for (let i = 0; i < layerNames.length; i++) {
      const k = layerNames[i];
      layersKey += `${k}:${layers[k]?.visible ? 1 : 0},`;
    }

    const selectedId = selectedEntity ? `${selectedEntity.type}_${selectedEntity.id || ''}` : '';
    const measurePointsKey = measurePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';');

    const last = lastRenderStateRef.current;
    const isInteracting = isInteractingRef.current;
    const hasVisualChanges =
      isDirtyRef.current ||
      !last ||
      last.cw !== cw ||
      last.ch !== ch ||
      last.camX !== camX ||
      last.camY !== camY ||
      last.zoom !== zoom ||
      last.rotation !== rotation ||
      last.theme !== theme ||
      last.showGrid !== showGrid ||
      last.enableOsnap !== enableOsnap ||
      last.textScale !== textScale ||
      last.snapKey !== snapKey ||
      last.entitiesLen !== entities.length ||
      last.batchesLen !== renderBatches.length ||
      last.textsLen !== textEntities.length ||
      last.rastersLen !== rasterEntities.length ||
      last.layersKey !== layersKey ||
      last.selectedId !== selectedId ||
      last.measurementsLen !== measurements.length ||
      last.measurePointsKey !== measurePointsKey ||
      last.isInteracting !== isInteracting;

    if (!hasVisualChanges) {
      // Request-on-demand: Zero visual changes between frames, bypass redraw completely!
      return;
    }

    // Mark state as clean and record snapshot
    isDirtyRef.current = false;
    lastRenderStateRef.current = {
      cw,
      ch,
      camX,
      camY,
      zoom,
      rotation,
      theme,
      showGrid,
      enableOsnap,
      textScale,
      snapKey,
      entitiesLen: entities.length,
      batchesLen: renderBatches.length,
      textsLen: textEntities.length,
      rastersLen: rasterEntities.length,
      layersKey,
      selectedId,
      measurementsLen: measurements.length,
      measurePointsKey,
      isInteracting,
    };

    let offscreen = offscreenRef.current;
    if (!offscreen) {
      offscreen = document.createElement('canvas');
      offscreenRef.current = offscreen;
    }
    if (offscreen.width !== cw || offscreen.height !== ch) {
      offscreen.width = cw;
      offscreen.height = ch;
    }
    const drawCtx = offscreen.getContext('2d', { alpha: false });
    if (!drawCtx) return;
    const ctx = drawCtx;

    // Surface Background: AI-Vault Soft Ivory vs Dark vs Blueprint
    const bgMap = { white: '#F8F7F4', dark: '#0B101B', blueprint: '#071B38' };
    ctx.fillStyle = bgMap[theme] || '#F8F7F4';
    ctx.fillRect(0, 0, cw, ch);

      // Grid
      if (showGrid && entities.length > 0) {
        const rawStep = 85 / zoom;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        let step = mag;
        if (rawStep / mag > 5) step = mag * 10;
        else if (rawStep / mag > 2) step = mag * 5;
        else if (rawStep / mag > 1) step = mag * 2;

        const c1 = screenToWorld(0, 0);
        const c2 = screenToWorld(cw, ch);
        const minX = Math.floor(Math.min(c1.x, c2.x) / step) * step;
        const maxX = Math.ceil(Math.max(c1.x, c2.x) / step) * step;
        const minY = Math.floor(Math.min(c1.y, c2.y) / step) * step;
        const maxY = Math.ceil(Math.max(c1.y, c2.y) / step) * step;

        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle =
          theme === 'white'
            ? 'rgba(148, 163, 184, 0.25)'
            : 'rgba(51, 65, 85, 0.35)';
        ctx.beginPath();
        for (let x = minX; x <= maxX; x += step) {
          const pA = worldToScreen(x, minY);
          const pB = worldToScreen(x, maxY);
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
        }
        for (let y = minY; y <= maxY; y += step) {
          const pA = worldToScreen(minX, y);
          const pB = worldToScreen(maxX, y);
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
        }
        ctx.stroke();

        // Origin crosshair
        const orig = worldToScreen(0, 0);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#C8102E';
        ctx.beginPath();
        ctx.moveTo(orig.x, orig.y);
        ctx.lineTo(orig.x + 28, orig.y);
        ctx.stroke();
        ctx.strokeStyle = '#15803d';
        ctx.beginPath();
        ctx.moveTo(orig.x, orig.y);
        ctx.lineTo(orig.x, orig.y - 28);
        ctx.stroke();
        ctx.restore();
      }

      // Raster Preview
      for (let i = 0; i < rasterEntities.length; i++) {
        const ent = rasterEntities[i];
        const tl = worldToScreen(ent.minX, ent.maxY);
        const br = worldToScreen(ent.maxX, ent.minY);
        ctx.drawImage(ent.img, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      }

      // Render Batches with LOD Sub-pixel Culling & Fast Interactive Acceleration
      const halfW = cw / 2;
      const halfH = ch / 2;
      const rad = (rotation * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const noRot = rotation === 0;
      const isLargeDrawing = entities.length > 50000;
      const fastInteractive = isInteracting && isLargeDrawing;
      const minSegPx = fastInteractive ? 2.2 : isLargeDrawing ? 0.85 : 0.4;
      const minArcPx = fastInteractive ? 1.8 : isLargeDrawing ? 0.85 : 0.55;
      const MAX_PATH_OPS = 4000;

      ctx.lineWidth = 1.15;
      for (let bIdx = 0; bIdx < renderBatches.length; bIdx++) {
        const batch = renderBatches[bIdx];
        const lyr = layers[batch.layer];
        if (lyr && !lyr.visible) continue;

        ctx.strokeStyle = batch.color;
        if (fastInteractive || (isLargeDrawing && zoom < 0.08)) {
          // Bypass heavy software dash tessellation during pan/zoom or extreme overview zoom
          ctx.setLineDash([]);
        } else if (batch.dashType === 'C') {
          ctx.setLineDash([10, 4, 3, 4]);
        } else if (batch.dashType === 'D') {
          ctx.setLineDash([6, 4]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        let opCount = 0;
        const coords = batch.lineCoords;
        if (noRot) {
          for (let i = 0; i < coords.length; i += 4) {
            const x1 = coords[i];
            const y1 = coords[i + 1];
            const x2 = coords[i + 2];
            const y2 = coords[i + 3];

            const sx1 = halfW + (x1 - camX) * zoom;
            const sy1 = halfH - (y1 - camY) * zoom;
            const sx2 = halfW + (x2 - camX) * zoom;
            const sy2 = halfH - (y2 - camY) * zoom;
            if (
              (sx1 < 0 && sx2 < 0) ||
              (sx1 > cw && sx2 > cw) ||
              (sy1 < 0 && sy2 < 0) ||
              (sy1 > ch && sy2 > ch)
            )
              continue;
            if (Math.abs(sx2 - sx1) + Math.abs(sy2 - sy1) < minSegPx) continue;
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            if (++opCount >= MAX_PATH_OPS) {
              ctx.stroke();
              ctx.beginPath();
              opCount = 0;
            }
          }
        } else {
          for (let i = 0; i < coords.length; i += 4) {
            const x1 = coords[i];
            const y1 = coords[i + 1];
            const x2 = coords[i + 2];
            const y2 = coords[i + 3];

            const dx1 = x1 - camX;
            const dy1 = y1 - camY;
            const sx1 = halfW + (dx1 * cosA - dy1 * sinA) * zoom;
            const sy1 = halfH - (dx1 * sinA + dy1 * cosA) * zoom;
            const dx2 = x2 - camX;
            const dy2 = y2 - camY;
            const sx2 = halfW + (dx2 * cosA - dy2 * sinA) * zoom;
            const sy2 = halfH - (dx2 * sinA + dy2 * cosA) * zoom;
            if (
              (sx1 < 0 && sx2 < 0) ||
              (sx1 > cw && sx2 > cw) ||
              (sy1 < 0 && sy2 < 0) ||
              (sy1 > ch && sy2 > ch)
            )
              continue;
            if (Math.abs(sx2 - sx1) + Math.abs(sy2 - sy1) < minSegPx) continue;
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            if (++opCount >= MAX_PATH_OPS) {
              ctx.stroke();
              ctx.beginPath();
              opCount = 0;
            }
          }
        }

        // Polylines (if any were not flattened into lineCoords)
        const polys = batch.polylines;
        for (let pIdx = 0; pIdx < polys.length; pIdx++) {
          const verts = polys[pIdx].vertices;
          if (verts.length < 2) continue;
          const v0 = verts[0];
          if (!isFinite(v0.x) || !isFinite(v0.y)) continue;
          const s0 = worldToScreen(v0.x, v0.y);
          if (!isFinite(s0.x) || !isFinite(s0.y)) continue;
          ctx.moveTo(s0.x, s0.y);
          for (let k = 1; k < verts.length; k++) {
            const vk = verts[k];
            if (!isFinite(vk.x) || !isFinite(vk.y)) continue;
            const sk = worldToScreen(vk.x, vk.y);
            if (!isFinite(sk.x) || !isFinite(sk.y)) continue;
            ctx.lineTo(sk.x, sk.y);
          }
          if (polys[pIdx].closed) {
            ctx.closePath();
          }
        }

        // Circles (inlined transform)
        const circles = batch.circles;
        for (let cIdx = 0; cIdx < circles.length; cIdx++) {
          const c = circles[cIdx];
          const r = c.radius * zoom;
          if (r < minArcPx) continue;
          const dx = c.center.x - camX;
          const dy = c.center.y - camY;
          const sx = noRot ? halfW + dx * zoom : halfW + (dx * cosA - dy * sinA) * zoom;
          const sy = noRot ? halfH - dy * zoom : halfH - (dx * sinA + dy * cosA) * zoom;
          if (sx + r < 0 || sx - r > cw || sy + r < 0 || sy - r > ch)
            continue;
          ctx.moveTo(sx + r, sy);
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          if (++opCount >= MAX_PATH_OPS) {
            ctx.stroke();
            ctx.beginPath();
            opCount = 0;
          }
        }

        // Arcs (inlined transform)
        const arcs = batch.arcs;
        for (let aIdx = 0; aIdx < arcs.length; aIdx++) {
          const a = arcs[aIdx];
          const r = a.radius * zoom;
          if (r < minArcPx) continue;
          const dx = a.center.x - camX;
          const dy = a.center.y - camY;
          const sx = noRot ? halfW + dx * zoom : halfW + (dx * cosA - dy * sinA) * zoom;
          const sy = noRot ? halfH - dy * zoom : halfH - (dx * sinA + dy * cosA) * zoom;
          if (sx + r < 0 || sx - r > cw || sy + r < 0 || sy - r > ch)
            continue;
          const sRad = (-(a.startAngle + rotation) * Math.PI) / 180;
          const eRad = (-(a.endAngle + rotation) * Math.PI) / 180;
          ctx.moveTo(sx + Math.cos(sRad) * r, sy + Math.sin(sRad) * r);
          ctx.arc(sx, sy, r, sRad, eRad, true);
          if (++opCount >= MAX_PATH_OPS) {
            ctx.stroke();
            ctx.beginPath();
            opCount = 0;
          }
        }

        // Ellipses (inlined transform + ctx.moveTo before ctx.ellipse to prevent cross-view connecting lines!)
        const ellipses = batch.ellipses;
        for (let eIdx = 0; eIdx < ellipses.length; eIdx++) {
          const el = ellipses[eIdx];
          const majLen = Math.hypot(el.majorAxis.x, el.majorAxis.y) * zoom;
          if (majLen < minArcPx) continue;
          const dx = el.center.x - camX;
          const dy = el.center.y - camY;
          const sx = noRot ? halfW + dx * zoom : halfW + (dx * cosA - dy * sinA) * zoom;
          const sy = noRot ? halfH - dy * zoom : halfH - (dx * sinA + dy * cosA) * zoom;
          if (sx + majLen < 0 || sx - majLen > cw || sy + majLen < 0 || sy - majLen > ch)
            continue;
          const minLen = majLen * el.axisRatio;
          const rotA = -(Math.atan2(el.majorAxis.y, el.majorAxis.x) + rad);
          ctx.moveTo(sx + majLen * Math.cos(rotA), sy + majLen * Math.sin(rotA));
          ctx.ellipse(sx, sy, majLen, minLen, rotA, 0, Math.PI * 2);
          if (++opCount >= MAX_PATH_OPS) {
            ctx.stroke();
            ctx.beginPath();
            opCount = 0;
          }
        }

        if (opCount > 0 || polys.length > 0) {
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // Texts
      for (let tIdx = 0; tIdx < textEntities.length; tIdx++) {
        const ent = textEntities[tIdx];
        const lyr = layers[ent.layer || '0'];
        if (lyr && !lyr.visible) continue;
        const rawPx = (ent.height || 10) * zoom * textScale;
        if (rawPx < 3.5) continue;
        const p = worldToScreen(ent.position.x, ent.position.y);
        if (p.x < -120 || p.x > cw + 120 || p.y < -60 || p.y > ch + 60) continue;

        const fontPx = Math.min(56, rawPx);
        ctx.save();
        ctx.fillStyle =
          ent.aci !== null && ent.aci !== undefined
            ? resolveCadColorValue(ent.aci, theme)
            : lyr
              ? resolveCadColorValue(lyr.aci, theme)
              : theme === 'white'
                ? '#0f172a'
                : '#f8fafc';
        ctx.translate(p.x, p.y);
        const rotRad =
          (-((ent.rotation || 0) + rotation) * Math.PI) / 180;
        if (rotRad !== 0) ctx.rotate(rotRad);
        ctx.font = `500 ${fontPx.toFixed(1)}px "Inter", "Noto Sans KR", sans-serif`;
        ctx.textAlign = ent.align || 'left';
        ctx.textBaseline = 'alphabetic';
        const lines = String(ent.text).split('\n');
        for (let l = 0; l < lines.length; l++) {
          ctx.fillText(lines[l], 0, l * fontPx * 1.2);
        }
        ctx.restore();
      }

      // Selected Entity Highlight
      if (selectedEntity) {
        ctx.save();
        ctx.strokeStyle = '#C8102E';
        ctx.lineWidth = 3.0;
        if (selectedEntity.type === 'LINE' && selectedEntity.start && selectedEntity.end) {
          const p1 = worldToScreen(selectedEntity.start.x, selectedEntity.start.y);
          const p2 = worldToScreen(selectedEntity.end.x, selectedEntity.end.y);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        } else if (
          selectedEntity.type === 'LWPOLYLINE' &&
          selectedEntity.vertices
        ) {
          ctx.beginPath();
          const p0 = worldToScreen(
            selectedEntity.vertices[0].x,
            selectedEntity.vertices[0].y
          );
          ctx.moveTo(p0.x, p0.y);
          for (let k = 1; k < selectedEntity.vertices.length; k++) {
            const pk = worldToScreen(
              selectedEntity.vertices[k].x,
              selectedEntity.vertices[k].y
            );
            ctx.lineTo(pk.x, pk.y);
          }
          if (selectedEntity.closed) ctx.closePath();
          ctx.stroke();
        } else if (
          (selectedEntity.type === 'CIRCLE' || selectedEntity.type === 'ARC') &&
          selectedEntity.center
        ) {
          const c = worldToScreen(
            selectedEntity.center.x,
            selectedEntity.center.y
          );
          ctx.beginPath();
          ctx.arc(c.x, c.y, Math.max(2, selectedEntity.radius * zoom), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Measurements
      measurements.forEach((m) => {
        const s1 = worldToScreen(m.p1.x, m.p1.y);
        const s2 = worldToScreen(m.p2.x, m.p2.y);
        ctx.save();
        ctx.strokeStyle = '#C8102E';
        ctx.fillStyle = '#C8102E';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        [s1, s2].forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        });

        // Measurement pill
        const mx = (s1.x + s2.x) / 2;
        const my = (s1.y + s2.y) / 2 - 12;
        ctx.font = 'bold 11px "Inter", "Noto Sans KR", sans-serif';
        const tw = ctx.measureText(m.label).width + 14;
        ctx.fillStyle = '#C8102E';
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2, my - 11, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.label, mx, my);
        ctx.restore();
      });

      // Active Measurement Points
      if (measurePoints.length > 0) {
        const p0 = worldToScreen(measurePoints[0].x, measurePoints[0].y);
        ctx.save();
        ctx.fillStyle = '#C8102E';
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // OSNAP Marker
      if (enableOsnap && snapPointRef.current) {
        const sp = worldToScreen(
          snapPointRef.current.x,
          snapPointRef.current.y
        );
        ctx.save();
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 2;
        ctx.strokeRect(sp.x - 6, sp.y - 6, 12, 12);
        ctx.restore();
      }

      // Atomic double-buffer copy from offscreen canvas to visible onscreen canvas (100% flicker-free)
      const onScreenCtx = canvas.getContext('2d', { alpha: false });
      if (onScreenCtx) {
        onScreenCtx.drawImage(offscreen, 0, 0);
      }
    },
    []
  );

  // Request-on-demand: Coalesce into at most 1 render per VSYNC frame
  const requestRender = useCallback(
    (force = false) => {
      if (force) {
        isDirtyRef.current = true;
      }
      if (animFrameRef.current !== null) {
        return;
      }
      animFrameRef.current = requestAnimationFrame(() => {
        animFrameRef.current = null;
        render();
      });
    },
    [render]
  );

  // Request-on-demand: Trigger frame only when visual props or canvas dimensions update
  useEffect(() => {
    isDirtyRef.current = true;
    requestRender();
    // RequestRender handles coalescing without dropping in-flight frames
  }, [
    theme,
    showGrid,
    entities,
    renderBatches,
    textEntities,
    rasterEntities,
    layers,
    selectedEntity,
    measurements,
    measurePoints,
    camX,
    camY,
    zoom,
    rotation,
    textScale,
    enableOsnap,
    canvasDimensions,
    requestRender,
  ]);

  // Persistent size tracker to prevent redundant canvas.width buffer resets (which causes blank flicker)
  const canvasSizeRef = useRef({ width: 0, height: 0 });

  // Window & Container resize observer with orientation auto-adjustment (Mounted once, 100% flicker-free)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      const newW = Math.max(100, Math.floor(rect.width));
      const newH = Math.max(100, Math.floor(rect.height));

      // CRITICAL: Only mutate canvas.width/height if dimensions strictly changed!
      // Assigning canvas.width / canvas.height unconditionally clears the entire buffer to blank.
      if (
        newW !== canvasSizeRef.current.width ||
        newH !== canvasSizeRef.current.height ||
        canvas.width !== newW ||
        canvas.height !== newH
      ) {
        canvasSizeRef.current = { width: newW, height: newH };
        canvas.width = newW;
        canvas.height = newH;
        setCanvasDimensions({ width: newW, height: newH });
        latestRef.current.requestRender(true);

        // Auto adjust camera when switching between landscape and portrait
        const { entities, extents, onUpdateCamera } = latestRef.current;
        if (entities.length > 0) {
          const isPortrait = newW < newH;
          if (
            prevIsPortraitRef.current !== null &&
            prevIsPortraitRef.current !== isPortrait
          ) {
            const extW = Math.max(10, extents.maxX - extents.minX);
            const extH = Math.max(10, extents.maxY - extents.minY);
            const newCamX = (extents.minX + extents.maxX) / 2;
            const newCamY = (extents.minY + extents.maxY) / 2;
            const fittedZoom = Math.min((newW * 0.88) / extW, (newH * 0.88) / extH);
            onUpdateCamera(newCamX, newCamY, fittedZoom);
          }
          prevIsPortraitRef.current = isPortrait;
        }
      }
    };

    handleResize();

    const ro = new ResizeObserver(() => {
      handleResize();
    });
    ro.observe(container);

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 100);
      setTimeout(handleResize, 350);
    });

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Mouse & Touch Interaction Listeners (Stable, zero-thrash, flicker-free)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { camX, camY } = latestRef.current;
      isDraggingRef.current = true;
      dragStartScreenRef.current = { x: sx, y: sy };
      dragStartCamRef.current = { x: camX, y: camY };
      tapStartPosRef.current = { x: sx, y: sy };
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const {
        zoom,
        rotation,
        mode,
        onUpdateCamera,
        onUpdateMouseWorld,
        findSnapPoint,
        screenToWorld,
      } = latestRef.current;

      if (isDraggingRef.current && mode === 'pan') {
        markInteracting();
        const dx = sx - dragStartScreenRef.current.x;
        const dy = sy - dragStartScreenRef.current.y;
        const rad = (-rotation * Math.PI) / 180;
        const wx = -(dx / zoom);
        const wy = dy / zoom;
        const nx = dragStartCamRef.current.x + (wx * Math.cos(rad) - wy * Math.sin(rad));
        const ny = dragStartCamRef.current.y + (wx * Math.sin(rad) + wy * Math.cos(rad));
        onUpdateCamera(nx, ny, zoom);
      } else {
        const now = performance.now();
        if (now - lastMouseWorldEmitRef.current > 80) {
          lastMouseWorldEmitRef.current = now;
          const wPt = screenToWorld(sx, sy);
          onUpdateMouseWorld(wPt);
        }
        if (mode === 'measure' || mode === 'calibrate') {
          const sp = findSnapPoint(sx, sy);
          const prev = snapPointRef.current;
          const changed =
            (prev === null && sp !== null) ||
            (prev !== null && sp === null) ||
            (prev !== null && sp !== null && (prev.x !== sp.x || prev.y !== sp.y || prev.type !== sp.type));
          if (changed) {
            snapPointRef.current = sp;
            latestRef.current.requestRender();
          }
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { mode, handlePointTap, screenToWorld, onUpdateMouseWorld } = latestRef.current;
      onUpdateMouseWorld(screenToWorld(sx, sy));
      if (
        Math.hypot(
          sx - tapStartPosRef.current.x,
          sy - tapStartPosRef.current.y
        ) < 6 &&
        mode !== 'pan'
      ) {
        handlePointTap(sx, sy);
      }
      if (snapPointRef.current) {
        snapPointRef.current = null;
        latestRef.current.requestRender();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markInteracting();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { camX, camY, zoom, screenToWorld, onUpdateCamera } = latestRef.current;
      const before = screenToWorld(sx, sy);
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const newZoom = Math.max(0.0002, Math.min(2000, zoom * factor));
      const after = {
        x: camX + (before.x - camX) * (zoom / newZoom),
        y: camY + (before.y - camY) * (zoom / newZoom),
      };
      onUpdateCamera(after.x, after.y, newZoom);
    };

    const onTouchStart = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { camX, camY, mode, findSnapPoint, updateTouchLoupe } = latestRef.current;
      if (e.touches.length === 1) {
        const sx = e.touches[0].clientX - rect.left;
        const sy = e.touches[0].clientY - rect.top;
        isDraggingRef.current = true;
        dragStartScreenRef.current = { x: sx, y: sy };
        dragStartCamRef.current = { x: camX, y: camY };
        tapStartPosRef.current = { x: sx, y: sy };
        if (mode === 'measure' || mode === 'calibrate') {
          snapPointRef.current = findSnapPoint(sx, sy);
          latestRef.current.requestRender();
          updateTouchLoupe(sx, sy);
        }
      } else if (e.touches.length === 2) {
        isDraggingRef.current = false;
        loupeWrapperRef.current?.classList.add('hidden');
        pinchDistStartRef.current = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const {
        camX,
        camY,
        zoom,
        rotation,
        mode,
        findSnapPoint,
        screenToWorld,
        onUpdateCamera,
        updateTouchLoupe,
      } = latestRef.current;

      if (e.touches.length === 1 && isDraggingRef.current) {
        const sx = e.touches[0].clientX - rect.left;
        const sy = e.touches[0].clientY - rect.top;
        if (mode === 'measure' || mode === 'calibrate') {
          const sp = findSnapPoint(sx, sy);
          const prev = snapPointRef.current;
          const changed =
            (prev === null && sp !== null) ||
            (prev !== null && sp === null) ||
            (prev !== null && sp !== null && (prev.x !== sp.x || prev.y !== sp.y || prev.type !== sp.type));
          if (changed) {
            snapPointRef.current = sp;
            latestRef.current.requestRender();
          }
          updateTouchLoupe(sx, sy);
          return;
        }
        markInteracting();
        const dx = sx - dragStartScreenRef.current.x;
        const dy = sy - dragStartScreenRef.current.y;
        const rad = (-rotation * Math.PI) / 180;
        const wx = -(dx / zoom);
        const wy = dy / zoom;
        const nx = dragStartCamRef.current.x + (wx * Math.cos(rad) - wy * Math.sin(rad));
        const ny = dragStartCamRef.current.y + (wx * Math.sin(rad) + wy * Math.cos(rad));
        onUpdateCamera(nx, ny, zoom);
      } else if (e.touches.length === 2 && pinchDistStartRef.current > 10) {
        markInteracting();
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        const midX =
          (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY =
          (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        const before = screenToWorld(midX, midY);
        const newZoom = Math.max(
          0.0002,
          Math.min(2000, zoom * (dist / pinchDistStartRef.current))
        );
        const after = screenToWorld(midX, midY);
        onUpdateCamera(
          camX + (before.x - after.x),
          camY + (before.y - after.y),
          newZoom
        );
        pinchDistStartRef.current = dist;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      loupeWrapperRef.current?.classList.add('hidden');
      const { mode, handlePointTap } = latestRef.current;
      if (isDraggingRef.current && e.changedTouches.length === 1) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.changedTouches[0].clientX - rect.left;
        const sy = e.changedTouches[0].clientY - rect.top;
        if (
          Math.hypot(
            sx - tapStartPosRef.current.x,
            sy - tapStartPosRef.current.y
          ) < 12 &&
          mode !== 'pan'
        ) {
          handlePointTap(sx, sy);
        }
      }
      if (snapPointRef.current) {
        snapPointRef.current = null;
        latestRef.current.requestRender();
      }
      isDraggingRef.current = false;
      pinchDistStartRef.current = 0;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);

      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <main
      ref={containerRef}
      className="relative w-full h-full flex-1 min-h-0 bg-[#F8F9FA] overflow-hidden flex flex-col"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full flex-1 cursor-grab active:cursor-grabbing"
      />

      {/* Floating Restore Menus Button when Menus are Hidden */}
      {isMenuHidden && onToggleMenuHidden && (
        <button
          onClick={onToggleMenuHidden}
          className="absolute top-3 left-3 z-30 bg-[#1A1A1A] hover:bg-[#333333] text-white px-3.5 py-2 rounded-full text-xs font-bold shadow-xl flex items-center gap-1.5 border border-white/20 active:scale-95 transition"
          title="상단/하단 메뉴바 다시 표시하기"
        >
          <Eye className="w-4 h-4 text-[#C8102E]" />
          <span>메뉴 보이기</span>
        </button>
      )}

      {/* Empty State Welcome Screen (Shinsegae Food Corporate Identity) */}
      {entities.length === 0 && !isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-3 sm:p-6 text-center bg-[#F8F9FA] overflow-y-auto">
          <div className="w-full max-w-[calc(100vw-1.5rem)] sm:max-w-md bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col items-center my-auto">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#C8102E] text-white flex items-center justify-center mb-2.5 sm:mb-3.5 shadow-sm">
              <Compass className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#C8102E]/10 text-[#C8102E] border border-[#C8102E]/25 text-[10px] sm:text-[11px] font-extrabold tracking-tight mb-2">
              <span>SHINSEGAE FOOD · 공무기획 엔지니어링</span>
            </div>
            <h2 className="text-sm sm:text-lg font-bold text-[#1A1A1A] mb-1 sm:mb-1.5">
              신세계푸드 모바일 DWG · DXF 도면 뷰어
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-600 max-w-sm leading-relaxed mb-4 sm:mb-5">
              스마트폰·태블릿·PC에 저장된 <strong>.dwg</strong> 및 <strong>.dxf</strong> 원본 도면을 외부 서버 전송 없이 기기 내부에서 즉시 해독하여 확대·축소·레이어 제어·실측 치수 측정을 수행합니다.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-2.5 w-full">
              <button
                onClick={onOpenFileClick}
                className="bg-[#C8102E] hover:bg-[#a50d26] text-white flex-1 w-full py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition shadow-xs"
              >
                <FolderOpen className="w-4 h-4" />
                <span>내 기기 도면 열기</span>
              </button>
              {onOpenCloudModal && (
                <button
                  onClick={onOpenCloudModal}
                  className="bg-[#1A1A1A] hover:bg-[#333333] text-white flex-1 w-full py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition shadow-xs"
                >
                  <Cloud className="w-4 h-4" />
                  <span>클라우드 (Drive·Dropbox)</span>
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 w-full">
              <button
                onClick={onLoadArchSample}
                className="flex-1 min-w-[120px] px-2.5 py-1.5 sm:py-2 rounded-lg bg-[#F8F9FA] hover:bg-slate-200/70 text-[10px] sm:text-[11px] font-semibold text-[#1A1A1A] border border-slate-200 transition"
              >
                📐 건축 평면도 샘플
              </button>
              <button
                onClick={onLoadMechSample}
                className="flex-1 min-w-[120px] px-2.5 py-1.5 sm:py-2 rounded-lg bg-[#F8F9FA] hover:bg-slate-200/70 text-[10px] sm:text-[11px] font-semibold text-[#1A1A1A] border border-slate-200 transition"
              >
                ⚙️ 기계 조립도 샘플
              </button>
            </div>

            {/* Recent Drawings Preview Cards on Welcome Screen */}
            {recentDrawings.length > 0 && (
              <div className="w-full mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <span className="text-[11px] sm:text-xs font-bold flex items-center gap-1.5 text-[#1A1A1A]">
                    <History className="w-3.5 h-3.5 text-[#C8102E]" />
                    최근 열어본 도면
                  </span>
                  {onOpenSelectModal && (
                    <button
                      onClick={onOpenSelectModal}
                      className="text-[10px] sm:text-[11px] text-[#C8102E] font-bold hover:underline"
                    >
                      전체 보기 ({recentDrawings.length}) →
                    </button>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {recentDrawings.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      onClick={() => onSelectRecentDrawing?.(item)}
                      className="w-28 sm:w-36 shrink-0 cursor-pointer rounded-xl bg-[#F8F9FA] hover:bg-white border border-slate-200 hover:border-[#C8102E]/40 p-1.5 sm:p-2 text-left hover:shadow-sm transition active:scale-95"
                      title={`${item.fileName} 다시 열기`}
                    >
                      <div className="w-full h-16 sm:h-20 rounded-lg overflow-hidden bg-slate-900 mb-1 border border-slate-200 flex items-center justify-center">
                        {item.thumbnail ? (
                          <img
                            src={item.thumbnail}
                            alt={item.fileName}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-slate-400 text-[9px] sm:text-[10px]">미리보기</span>
                        )}
                      </div>
                      <div className="text-[10px] sm:text-[11px] font-bold text-[#1A1A1A] truncate">
                        {item.fileName}
                      </div>
                      <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5 text-[#C8102E]" />
                        {formatRelativeTime(item.lastOpenedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active Mode Banner */}
      {(mode === 'measure' || mode === 'calibrate') && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-[#1A1A1A] text-white px-3.5 py-1.5 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 whitespace-nowrap border-l-4 border-[#C8102E]">
          <span>
            {mode === 'measure'
              ? '📏 두 지점을 차례로 터치하세요 (끝점·중심점 자동 스냅)'
              : '📐 2점 축척교정: 실제 치수를 아는 두 점을 터치하세요'}
          </span>
          <button
            onClick={onCancelMode}
            className="w-5 h-5 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-[11px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating Vertical Tool Pill (Zoom In, Zoom Out, Fit, Rotate, Clear) - Only visible when drawing is loaded */}
      {entities.length > 0 && (
        <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 sm:gap-1.5 bg-white/95 backdrop-blur-md border border-slate-200 p-1 sm:p-1.5 rounded-2xl shadow-lg">
          <button
            onClick={() => onUpdateCamera(camX, camY, Math.min(2000, zoom * 1.25))}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#F8F9FA] hover:bg-slate-200 text-[#1A1A1A] border border-slate-200 flex items-center justify-center text-base sm:text-lg font-bold transition active:scale-95"
            title="도면 확대"
          >
            +
          </button>
          <button
            onClick={() => onUpdateCamera(camX, camY, Math.max(0.0002, zoom / 1.25))}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#F8F9FA] hover:bg-slate-200 text-[#1A1A1A] border border-slate-200 flex items-center justify-center text-base sm:text-lg font-bold transition active:scale-95"
            title="도면 축소"
          >
            −
          </button>
          <button
            onClick={handleFitExtents}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#C8102E] hover:bg-[#a50d26] text-white flex items-center justify-center transition active:scale-95 shadow-xs"
            title="도면 전체 화면 맞춤"
          >
            <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={onRotate90}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#F8F9FA] hover:bg-slate-200 text-[#1A1A1A] border border-slate-200 flex items-center justify-center transition active:scale-95"
            title="도면 90도 회전"
          >
            <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          {onToggleMenuHidden && (
            <button
              onClick={onToggleMenuHidden}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#F8F9FA] hover:bg-slate-200 text-[#1A1A1A] border border-slate-200 flex items-center justify-center transition active:scale-95"
              title={isMenuHidden ? '메뉴바 보이기' : '메뉴바 숨기기 (도면 화면 최대화)'}
            >
              {isMenuHidden ? (
                <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#C8102E]" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-700" />
              )}
            </button>
          )}
          {measurements.length > 0 && (
            <button
              onClick={onClearMeasurements}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-rose-50 hover:bg-rose-100 text-[#C8102E] border border-rose-200 flex items-center justify-center transition active:scale-95"
              title="측정선 모두 지우기"
            >
              <Eraser className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}
        </div>
      )}

      {/* Mobile Touch Loupe (Magnifying Glass) */}
      <div
        ref={loupeWrapperRef}
        className="hidden pointer-events-none absolute z-30 w-28 h-28 rounded-full border-2 border-[#C8102E] shadow-2xl overflow-hidden bg-white"
      >
        <canvas
          ref={loupeCanvasRef}
          width="112"
          height="112"
          className="block w-full h-full"
        />
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-40 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center text-center p-6 text-[#1A1A1A]">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-[#C8102E] animate-spin mb-3"></div>
          <h3 className="text-sm font-bold mb-1">
            DWG/DXF 도면 정밀 해독 중...
          </h3>
          <p className="text-xs text-slate-600 max-w-xs">{loadingMessage}</p>
        </div>
      )}
    </main>
  );
});
