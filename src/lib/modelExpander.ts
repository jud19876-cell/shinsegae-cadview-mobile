/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArcEntity,
  CadBlock,
  CadEntity,
  CadTheme,
  CircleEntity,
  DrawingModel,
  EllipseEntity,
  Extents2D,
  LineEntity,
  Point2D,
  PolylineEntity,
  RenderBatch,
  SnapPoint,
  Vertex2D,
} from '../types/cad';
import { resolveCadColorValue } from './cadColors';
import { isSanePoint, MAX_COORD_LIMIT, MAX_BLOCK_DEPTH, safeMid } from './cadSanitizer';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_EXPANDED_ENTITIES = 350000;

/**
 * 2D Affine Transform Matrix:
 * [ m00  m01  tx ]
 * [ m10  m11  ty ]
 */
interface Mat2D {
  m00: number;
  m01: number;
  tx: number;
  m10: number;
  m11: number;
  ty: number;
}

const IDENTITY_MAT: Mat2D = { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 };

function applyMat2D(m: Mat2D, p: Point2D): Point2D {
  return {
    x: m.m00 * p.x + m.m01 * p.y + m.tx,
    y: m.m10 * p.x + m.m11 * p.y + m.ty,
  };
}

function composeMat2D(parent: Mat2D, child: Mat2D): Mat2D {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    tx: parent.m00 * child.tx + parent.m01 * child.ty + parent.tx,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    ty: parent.m10 * child.tx + parent.m11 * child.ty + parent.ty,
  };
}

function buildInsertMatrix(
  pos: Point2D,
  base: Point2D,
  sx: number,
  sy: number,
  rotDeg: number
): Mat2D {
  const rad = rotDeg * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const m00 = cos * sx;
  const m01 = -sin * sy;
  const m10 = sin * sx;
  const m11 = cos * sy;
  const tx = pos.x - (m00 * base.x + m01 * base.y);
  const ty = pos.y - (m10 * base.x + m11 * base.y);
  return { m00, m01, tx, m10, m11, ty };
}

/**
 * Convert a bulge segment between p1 and p2 into intermediate arc points
 */
export function bulgeToArcPoints(
  p1: Point2D,
  p2: Point2D,
  bulge: number,
  segments = 16
): Point2D[] {
  if (!bulge || Math.abs(bulge) < 1e-6) return [p2];
  // Guard against corrupted extreme bulge values
  if (!Number.isFinite(bulge) || Math.abs(bulge) > 1000) return [p2];

  const chordDx = p2.x - p1.x;
  const chordDy = p2.y - p1.y;
  const chordLen = Math.hypot(chordDx, chordDy);
  if (chordLen < 1e-8) return [p2];

  const theta = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(theta / 2);
  if (Math.abs(sinHalf) < 1e-8) return [p2];

  const radius = Math.abs(chordLen / (2 * sinHalf));
  if (!Number.isFinite(radius) || radius > MAX_COORD_LIMIT) return [p2];

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  const cotHalf = (1 - bulge * bulge) / (2 * bulge);
  const perpX = -chordDy / chordLen;
  const perpY = chordDx / chordLen;

  const cx = midX + perpX * (chordLen / 2) * cotHalf;
  const cy = midY + perpY * (chordLen / 2) * cotHalf;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const steps = Math.max(4, Math.min(segments, Math.ceil((Math.abs(theta) / (Math.PI / 2)) * 8)));

  const pts: Point2D[] = [];
  for (let i = 1; i <= steps; i++) {
    const ang = startAngle + (theta * i) / steps;
    pts.push({
      x: cx + radius * Math.cos(ang),
      y: cy + radius * Math.sin(ang),
    });
  }
  return pts;
}

export function expandPolyVertices(
  vertices: Vertex2D[],
  closed?: boolean
): Vertex2D[] {
  if (vertices.length < 2) return vertices;
  const out: Point2D[] = [{ x: vertices[0].x, y: vertices[0].y }];
  const count = closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < count; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (curr.bulge && Math.abs(curr.bulge) > 1e-5) {
      const arcPts = bulgeToArcPoints(curr, next, curr.bulge, 14);
      for (const p of arcPts) out.push(p);
    } else {
      out.push({ x: next.x, y: next.y });
    }
  }
  return out;
}

function getDashType(linetype?: string): 'S' | 'D' | 'C' {
  if (!linetype) return 'S';
  const u = linetype.toUpperCase();
  if (u.includes('CENTER') || u.includes('DASHDOT')) return 'C';
  if (u.includes('DASH') || u.includes('HIDDEN') || u.includes('DOT') || u.includes('PHANTOM')) {
    return 'D';
  }
  return 'S';
}

/**
 * Shortest-interval outlier-resistant bounds calculation (from Desktop DWG Viewer `buildScene.ts`).
 * Finds the tightest 90% interval on sorted coordinate samples and only trims if full span > 4x core span.
 * Note: This ONLY computes initial Fit View camera bounds — it NEVER deletes any drawing entities!
 */
function shortestIntervalAxisBounds(sorted: Float64Array): { min: number; max: number } {
  const n = sorted.length;
  if (n === 0) return { min: 0, max: 100 };
  const fullMin = sorted[0];
  const fullMax = sorted[n - 1];
  const fullSpan = fullMax - fullMin;
  if (n < 20 || fullSpan <= 0) return { min: fullMin, max: fullMax };

  const windowSize = Math.max(2, Math.floor(n * 0.9));
  let bestSpan = Infinity;
  let bestStart = 0;
  for (let i = 0; i + windowSize - 1 < n; i++) {
    const span = sorted[i + windowSize - 1] - sorted[i];
    if (span < bestSpan) {
      bestSpan = span;
      bestStart = i;
    }
  }

  if (bestSpan > 0 && fullSpan > bestSpan * 8) {
    const coreMin = sorted[bestStart];
    const coreMax = sorted[bestStart + windowSize - 1];
    // Include all legitimate drawing border/frame points within 2.5x of the core span,
    // while excluding far-off outliers (e.g. (0,0) datum or stray points kilometers away).
    const fenceMargin = Math.max(bestSpan * 2.5, 100000);
    const lowFence = coreMin - fenceMargin;
    const highFence = coreMax + fenceMargin;
    let inlierMin = coreMin;
    let inlierMax = coreMax;
    for (let i = 0; i < n; i++) {
      const v = sorted[i];
      if (v >= lowFence && v <= highFence) {
        if (v < inlierMin) inlierMin = v;
        if (v > inlierMax) inlierMax = v;
      }
    }
    return { min: inlierMin, max: inlierMax };
  }
  return { min: fullMin, max: fullMax };
}

export interface ExpandedScene {
  entities: CadEntity[];
  layers: Record<string, DrawingModel['layers'][string]>;
  renderBatches: RenderBatch[];
  textEntities: Extract<CadEntity, { type: 'TEXT' }>[];
  rasterEntities: Extract<CadEntity, { type: 'RASTER_PREVIEW' }>[];
  snapPoints: SnapPoint[];
  extents: Extents2D;
}

export function expandAndOptimizeDrawing(
  model: DrawingModel,
  theme: CadTheme
): ExpandedScene {
  const expanded: CadEntity[] = [];

  // Build case-insensitive block lookup map
  const blockMap = new Map<string, CadBlock>();
  for (const [k, b] of Object.entries(model.blocks)) {
    blockMap.set(k, b);
    blockMap.set(k.toUpperCase(), b);
  }

  function expandEntity(
    ent: CadEntity,
    mat: Mat2D,
    inheritedLayer: string,
    inheritedAci: number | null | undefined,
    isIdentity: boolean,
    depth: number
  ) {
    if (depth > MAX_BLOCK_DEPTH || expanded.length >= MAX_EXPANDED_ENTITIES) return;

    const resolvedLayer =
      ent.layer === '0' && inheritedLayer !== '0' ? inheritedLayer : ent.layer;
    const resolvedAci =
      ent.aci !== undefined && ent.aci !== null ? ent.aci : inheritedAci;

    if (ent.type === 'INSERT') {
      const blk =
        blockMap.get(ent.blockName) || blockMap.get(ent.blockName.toUpperCase());
      if (!blk || blk.entities.length === 0) return;

      const sx = ent.scaleX ?? 1;
      const sy = ent.scaleY ?? 1;
      const rot = ent.rotation ?? 0;
      const rows = Math.max(1, Math.min(ent.rowCount ?? 1, 200));
      const cols = Math.max(1, Math.min(ent.columnCount ?? 1, 200));
      const rowSp = ent.rowSpacing ?? 0;
      const colSp = ent.columnSpacing ?? 0;
      const rad = rot * DEG2RAD;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (expanded.length >= MAX_EXPANDED_ENTITIES) return;
          const localDx = c * colSp;
          const localDy = r * rowSp;
          const cellPos: Point2D = {
            x: ent.position.x + localDx * cosR - localDy * sinR,
            y: ent.position.y + localDx * sinR + localDy * cosR,
          };
          const childMat = buildInsertMatrix(cellPos, blk.basePoint, sx, sy, rot);
          const nextMat = isIdentity ? childMat : composeMat2D(mat, childMat);

          for (const child of blk.entities) {
            expandEntity(
              child,
              nextMat,
              resolvedLayer,
              resolvedAci,
              false,
              depth + 1
            );
          }
        }
      }
      return;
    }

    if (isIdentity) {
      if (resolvedLayer !== ent.layer || resolvedAci !== ent.aci) {
        expanded.push({ ...ent, layer: resolvedLayer, aci: resolvedAci });
      } else {
        expanded.push(ent);
      }
      return;
    }

    const scaleX = Math.hypot(mat.m00, mat.m10);
    const scaleY = Math.hypot(mat.m01, mat.m11);
    const det = mat.m00 * mat.m11 - mat.m01 * mat.m10;
    const isUniform =
      Math.abs(scaleX - scaleY) <= 1e-3 * Math.max(scaleX, scaleY, 1e-6);

    if (ent.type === 'LINE') {
      const start = applyMat2D(mat, ent.start);
      const end = applyMat2D(mat, ent.end);
      if (isSanePoint(start) && isSanePoint(end)) {
        expanded.push({
          ...ent,
          id: `${ent.id}_${expanded.length}`,
          layer: resolvedLayer,
          aci: resolvedAci,
          start,
          end,
        });
      }
    } else if (ent.type === 'LWPOLYLINE') {
      const hasBulge = ent.vertices.some((v) => v.bulge && Math.abs(v.bulge) > 1e-5);
      if (!isUniform && hasBulge) {
        // Non-uniformly scaled polyline with arc bulges: tessellate arcs first, then transform
        const localPts = expandPolyVertices(ent.vertices, ent.closed);
        const vertices: Vertex2D[] = [];
        for (const pt of localPts) {
          const wp = applyMat2D(mat, pt);
          if (isSanePoint(wp)) vertices.push(wp);
        }
        if (vertices.length >= 2) {
          expanded.push({
            ...ent,
            id: `${ent.id}_${expanded.length}`,
            layer: resolvedLayer,
            aci: resolvedAci,
            vertices,
            closed: false,
          });
        }
      } else {
        const bulgeSign = det < 0 ? -1 : 1;
        const vertices: Vertex2D[] = [];
        for (const v of ent.vertices) {
          const wp = applyMat2D(mat, v);
          if (isSanePoint(wp)) {
            vertices.push({
              x: wp.x,
              y: wp.y,
              bulge: v.bulge ? v.bulge * bulgeSign : undefined,
            });
          }
        }
        if (vertices.length >= 2) {
          expanded.push({
            ...ent,
            id: `${ent.id}_${expanded.length}`,
            layer: resolvedLayer,
            aci: resolvedAci,
            vertices,
          });
        }
      }
    } else if (ent.type === 'CIRCLE') {
      const center = applyMat2D(mat, ent.center);
      if (!isSanePoint(center)) return;
      if (isUniform) {
        const radius = ent.radius * scaleX;
        if (radius > 0 && radius <= MAX_COORD_LIMIT) {
          expanded.push({
            ...ent,
            id: `${ent.id}_${expanded.length}`,
            layer: resolvedLayer,
            aci: resolvedAci,
            center,
            radius,
          });
        }
      } else {
        // Non-uniformly scaled circle becomes a closed polyline ellipse
        const steps = 36;
        const vertices: Vertex2D[] = [];
        for (let i = 0; i < steps; i++) {
          const ang = (i / steps) * Math.PI * 2;
          const lp = {
            x: ent.center.x + ent.radius * Math.cos(ang),
            y: ent.center.y + ent.radius * Math.sin(ang),
          };
          const wp = applyMat2D(mat, lp);
          if (isSanePoint(wp)) vertices.push(wp);
        }
        if (vertices.length >= 3) {
          expanded.push({
            id: `${ent.id}_${expanded.length}`,
            type: 'LWPOLYLINE',
            layer: resolvedLayer,
            aci: resolvedAci,
            linetype: ent.linetype,
            lineweight: ent.lineweight,
            vertices,
            closed: true,
          });
        }
      }
    } else if (ent.type === 'ARC') {
      const center = applyMat2D(mat, ent.center);
      if (!isSanePoint(center)) return;

      if (isUniform) {
        const radius = ent.radius * scaleX;
        if (!(radius > 0 && radius <= MAX_COORD_LIMIT)) return;

        // Compute transformed start/end angles from exact transformed endpoints
        const saRad = ent.startAngle * DEG2RAD;
        const eaRad = ent.endAngle * DEG2RAD;
        const pStart = applyMat2D(mat, {
          x: ent.center.x + ent.radius * Math.cos(saRad),
          y: ent.center.y + ent.radius * Math.sin(saRad),
        });
        const pEnd = applyMat2D(mat, {
          x: ent.center.x + ent.radius * Math.cos(eaRad),
          y: ent.center.y + ent.radius * Math.sin(eaRad),
        });

        let wStart = Math.atan2(pStart.y - center.y, pStart.x - center.x) * RAD2DEG;
        let wEnd = Math.atan2(pEnd.y - center.y, pEnd.x - center.x) * RAD2DEG;
        if (wStart < 0) wStart += 360;
        if (wEnd < 0) wEnd += 360;

        // Reflection (det < 0) reverses CCW sweep direction, so swap start and end angles
        if (det < 0) {
          const tmp = wStart;
          wStart = wEnd;
          wEnd = tmp;
        }

        expanded.push({
          ...ent,
          id: `${ent.id}_${expanded.length}`,
          layer: resolvedLayer,
          aci: resolvedAci,
          center,
          radius,
          startAngle: wStart,
          endAngle: wEnd,
        });
      } else {
        // Non-uniformly scaled arc: tessellate in local space and transform points
        let sa = ent.startAngle * DEG2RAD;
        let ea = ent.endAngle * DEG2RAD;
        let sweep = ea - sa;
        if (sweep <= 0) sweep += Math.PI * 2;
        const steps = Math.max(8, Math.ceil((sweep / (Math.PI / 2)) * 10));
        const vertices: Vertex2D[] = [];
        for (let i = 0; i <= steps; i++) {
          const ang = sa + (sweep * i) / steps;
          const lp = {
            x: ent.center.x + ent.radius * Math.cos(ang),
            y: ent.center.y + ent.radius * Math.sin(ang),
          };
          const wp = applyMat2D(mat, lp);
          if (isSanePoint(wp)) vertices.push(wp);
        }
        if (vertices.length >= 2) {
          expanded.push({
            id: `${ent.id}_${expanded.length}`,
            type: 'LWPOLYLINE',
            layer: resolvedLayer,
            aci: resolvedAci,
            linetype: ent.linetype,
            lineweight: ent.lineweight,
            vertices,
            closed: false,
          });
        }
      }
    } else if (ent.type === 'ELLIPSE') {
      const center = applyMat2D(mat, ent.center);
      const majorAxis = {
        x: mat.m00 * ent.majorAxis.x + mat.m01 * ent.majorAxis.y,
        y: mat.m10 * ent.majorAxis.x + mat.m11 * ent.majorAxis.y,
      };
      if (isSanePoint(center) && isSanePoint(majorAxis)) {
        expanded.push({
          ...ent,
          id: `${ent.id}_${expanded.length}`,
          layer: resolvedLayer,
          aci: resolvedAci,
          center,
          majorAxis,
        });
      }
    } else if (ent.type === 'TEXT') {
      const position = applyMat2D(mat, ent.position);
      if (isSanePoint(position)) {
        const localRotRad = (ent.rotation || 0) * DEG2RAD;
        const dx = mat.m00 * Math.cos(localRotRad) + mat.m01 * Math.sin(localRotRad);
        const dy = mat.m10 * Math.cos(localRotRad) + mat.m11 * Math.sin(localRotRad);
        let worldRot = Math.atan2(dy, dx) * RAD2DEG;
        // Keep text right-side up in (-90, 90] when block is mirrored/rotated
        if (worldRot > 90) worldRot -= 180;
        else if (worldRot <= -90) worldRot += 180;

        expanded.push({
          ...ent,
          id: `${ent.id}_${expanded.length}`,
          layer: resolvedLayer,
          aci: resolvedAci,
          position,
          height: Math.max(0.1, ent.height * (scaleY || scaleX || 1)),
          rotation: worldRot,
        });
      }
    } else if (ent.type === 'RASTER_PREVIEW') {
      expanded.push(ent);
    }
  }

  for (const ent of model.entities) {
    expandEntity(ent, IDENTITY_MAT, ent.layer, ent.aci, true, 0);
  }

  // Rebuild theme-aware layers map & counts from expanded entities
  const updatedLayers: Record<string, DrawingModel['layers'][string]> = {};
  for (const [k, l] of Object.entries(model.layers)) {
    updatedLayers[k] = {
      ...l,
      color: resolveCadColorValue(l.aci ?? 7, theme),
      count: 0,
    };
  }

  const batchMap = new Map<string, RenderBatch>();
  const lineArrays = new Map<string, number[]>();
  const texts: Extract<CadEntity, { type: 'TEXT' }>[] = [];
  const rasters: Extract<CadEntity, { type: 'RASTER_PREVIEW' }>[] = [];
  const snapPoints: SnapPoint[] = [];

  // Collect coordinate samples across all visible geometry for initial Fit View
  const rawX: number[] = [];
  const rawY: number[] = [];
  let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;

  function recordBoundsPoint(x: number, y: number, isVisibleLayer: boolean, isGeom: boolean) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD_LIMIT || Math.abs(y) > MAX_COORD_LIMIT) {
      return;
    }
    if (x < allMinX) allMinX = x;
    if (y < allMinY) allMinY = y;
    if (x > allMaxX) allMaxX = x;
    if (y > allMaxY) allMaxY = y;

    if (isVisibleLayer && isGeom) {
      rawX.push(x);
      rawY.push(y);
    }
  }

  const MAX_SNAP_POINTS = 25000;

  for (const e of expanded) {
    if (!updatedLayers[e.layer]) {
      const lower = e.layer.toLowerCase();
      const hiddenByDefault = lower === 'defpoints' || /^xref/i.test(e.layer);
      updatedLayers[e.layer] = {
        name: e.layer,
        aci: 7,
        color: resolveCadColorValue(7, theme),
        visible: !hiddenByDefault,
        count: 0,
      };
    }
    updatedLayers[e.layer].count++;

    const layerInfo = updatedLayers[e.layer];
    const isLayerVisible = layerInfo ? layerInfo.visible !== false : true;
    const isExtentLayer =
      isLayerVisible &&
      e.layer.toLowerCase() !== 'defpoints' &&
      !/^xref/i.test(e.layer);

    if (e.type === 'TEXT') {
      texts.push(e);
      recordBoundsPoint(e.position.x, e.position.y, isExtentLayer, false);
      continue;
    }

    if (e.type === 'RASTER_PREVIEW') {
      rasters.push(e);
      recordBoundsPoint(e.minX, e.minY, true, true);
      recordBoundsPoint(e.maxX, e.maxY, true, true);
      continue;
    }

    const color =
      e.aci !== null && e.aci !== undefined
        ? resolveCadColorValue(e.aci, theme)
        : layerInfo?.color || resolveCadColorValue(7, theme);
    const dashType = getDashType(e.linetype);
    const key = `${e.layer}|${color}|${dashType}`;

    let batch = batchMap.get(key);
    if (!batch) {
      batch = {
        layer: e.layer,
        color,
        dashType,
        lineCoords: new Float64Array(0),
        polylines: [],
        circles: [],
        arcs: [],
        ellipses: [],
      };
      batchMap.set(key, batch);
      lineArrays.set(key, []);
    }

    if (e.type === 'LINE') {
      if (!isSanePoint(e.start) || !isSanePoint(e.end)) continue;
      const arr = lineArrays.get(key)!;
      arr.push(e.start.x, e.start.y, e.end.x, e.end.y);
      recordBoundsPoint(e.start.x, e.start.y, isExtentLayer, true);
      recordBoundsPoint(e.end.x, e.end.y, isExtentLayer, true);

      if (snapPoints.length < MAX_SNAP_POINTS) {
        snapPoints.push(
          { x: e.start.x, y: e.start.y, type: 'END' },
          { x: e.end.x, y: e.end.y, type: 'END' },
          {
            x: safeMid(e.start.x, e.end.x),
            y: safeMid(e.start.y, e.end.y),
            type: 'MID',
          }
        );
      }
    } else if (e.type === 'LWPOLYLINE') {
      const validVerts: Vertex2D[] = e.vertices.filter((v) => isSanePoint(v));
      if (validVerts.length < 2) continue;
      const hasBulge = validVerts.some((v) => v.bulge && Math.abs(v.bulge) > 1e-5);
      const renderVerts = hasBulge
        ? expandPolyVertices(validVerts, e.closed)
        : validVerts;
      const isClosed = hasBulge ? false : Boolean(e.closed);
      e.vertices = renderVerts;
      e.closed = isClosed;

      // Pack polyline segments directly into flat Float64Array lineCoords for 10x faster rendering
      const arr = lineArrays.get(key)!;
      for (let i = 0; i < renderVerts.length - 1; i++) {
        const v0 = renderVerts[i];
        const v1 = renderVerts[i + 1];
        arr.push(v0.x, v0.y, v1.x, v1.y);
      }
      if (isClosed && renderVerts.length >= 3) {
        const vLast = renderVerts[renderVerts.length - 1];
        const vFirst = renderVerts[0];
        arr.push(vLast.x, vLast.y, vFirst.x, vFirst.y);
      }

      for (let i = 0; i < renderVerts.length; i++) {
        const v = renderVerts[i];
        recordBoundsPoint(v.x, v.y, isExtentLayer, true);
        if (snapPoints.length < MAX_SNAP_POINTS) {
          snapPoints.push({ x: v.x, y: v.y, type: 'END' });
          if (i < renderVerts.length - 1) {
            const next = renderVerts[i + 1];
            snapPoints.push({
              x: safeMid(v.x, next.x),
              y: safeMid(v.y, next.y),
              type: 'MID',
            });
          }
        }
      }
    } else if (e.type === 'CIRCLE') {
      if (!isSanePoint(e.center) || e.radius <= 0 || e.radius > MAX_COORD_LIMIT) continue;
      batch.circles.push(e);
      recordBoundsPoint(e.center.x - e.radius, e.center.y - e.radius, isExtentLayer, true);
      recordBoundsPoint(e.center.x + e.radius, e.center.y + e.radius, isExtentLayer, true);
      if (snapPoints.length < MAX_SNAP_POINTS) {
        snapPoints.push({ x: e.center.x, y: e.center.y, type: 'CEN' });
      }
    } else if (e.type === 'ARC') {
      if (!isSanePoint(e.center) || e.radius <= 0 || e.radius > MAX_COORD_LIMIT) continue;
      batch.arcs.push(e);
      const sRad = e.startAngle * DEG2RAD;
      const eRad = e.endAngle * DEG2RAD;
      const p1 = {
        x: e.center.x + e.radius * Math.cos(sRad),
        y: e.center.y + e.radius * Math.sin(sRad),
      };
      const p2 = {
        x: e.center.x + e.radius * Math.cos(eRad),
        y: e.center.y + e.radius * Math.sin(eRad),
      };
      recordBoundsPoint(p1.x, p1.y, isExtentLayer, true);
      recordBoundsPoint(p2.x, p2.y, isExtentLayer, true);
      if (snapPoints.length < MAX_SNAP_POINTS) {
        snapPoints.push(
          { x: e.center.x, y: e.center.y, type: 'CEN' },
          { x: p1.x, y: p1.y, type: 'END' },
          { x: p2.x, y: p2.y, type: 'END' }
        );
      }
    } else if (e.type === 'ELLIPSE') {
      if (!isSanePoint(e.center)) continue;
      batch.ellipses.push(e);
      const rMaj = Math.hypot(e.majorAxis.x, e.majorAxis.y);
      if (rMaj <= MAX_COORD_LIMIT) {
        recordBoundsPoint(e.center.x - rMaj, e.center.y - rMaj, isExtentLayer, true);
        recordBoundsPoint(e.center.x + rMaj, e.center.y + rMaj, isExtentLayer, true);
      }
    }
  }

  for (const [key, batch] of batchMap.entries()) {
    const arr = lineArrays.get(key)!;
    batch.lineCoords = new Float64Array(arr);
  }

  // Compute robust extents across the entire drawing using uniform strided sampling
  let extents: Extents2D;
  if (rawX.length >= 20) {
    const maxSamples = 20000;
    const stride = Math.max(1, Math.floor(rawX.length / maxSamples));
    const count = Math.ceil(rawX.length / stride);
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    for (let i = 0, j = 0; i < rawX.length && j < count; i += stride, j++) {
      xs[j] = rawX[i];
      ys[j] = rawY[i];
    }
    xs.sort();
    ys.sort();
    const bx = shortestIntervalAxisBounds(xs);
    const by = shortestIntervalAxisBounds(ys);
    extents = { minX: bx.min, minY: by.min, maxX: bx.max, maxY: by.max };
  } else if (rawX.length > 0) {
    extents = {
      minX: Math.min(...rawX),
      minY: Math.min(...rawY),
      maxX: Math.max(...rawX),
      maxY: Math.max(...rawY),
    };
  } else if (Number.isFinite(allMinX)) {
    extents = { minX: allMinX, minY: allMinY, maxX: allMaxX, maxY: allMaxY };
  } else {
    extents = model.extents || { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  }

  return {
    entities: expanded,
    layers: updatedLayers,
    renderBatches: Array.from(batchMap.values()),
    textEntities: texts,
    rasterEntities: rasters,
    snapPoints,
    extents,
  };
}
