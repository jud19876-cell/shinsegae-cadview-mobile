/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CadBlock,
  CadEntity,
  DrawingModel,
  LineEntity,
  Point2D,
  PolylineEntity,
  Vertex2D,
} from '../types/cad';

export const MAX_COORD_ABS = 1e12;
export const MAX_COORD_LIMIT = MAX_COORD_ABS;
export const MAX_BLOCK_DEPTH = 16;
const MIN_GEOM_SPAN = 1e-4; // 0.0001 units: below this is a degenerate microscopic dot

/**
 * Precision midpoint avoiding floating point overflow on large coordinates (CADCraft bounds.rs)
 */
export function safeMid(a: number, b: number): number {
  if (Math.sign(a) !== Math.sign(b)) {
    return a * 0.5 + b * 0.5;
  }
  return a + (b - a) * 0.5;
}

/**
 * Validates whether a numerical coordinate is finite, non-NaN, and within sane CAD boundaries.
 */
export function isSaneCoord(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    !Number.isNaN(v) &&
    Math.abs(v) <= MAX_COORD_ABS
  );
}

export const isValidCoord = isSaneCoord;

/**
 * Validates a 2D point.
 */
export function isSanePoint(pt: unknown): pt is Point2D {
  if (!pt || typeof pt !== 'object') return false;
  const p = pt as Point2D;
  return isSaneCoord(p.x) && isSaneCoord(p.y);
}

/**
 * Sanitizes and validates a single CAD entity.
 * Returns null if the entity is degenerate, microscopic, or has infinite/invalid coordinates.
 */
export function sanitizeCadEntity(ent: CadEntity | null | undefined): CadEntity | null {
  if (!ent || !ent.type) return null;

  switch (ent.type) {
    case 'LINE': {
      const line = ent as LineEntity;
      if (!isSanePoint(line.start) || !isSanePoint(line.end)) return null;

      const dx = line.end.x - line.start.x;
      const dy = line.end.y - line.start.y;
      const len = Math.hypot(dx, dy);

      // Filter out zero-length lines / microscopic points
      if (!Number.isFinite(len) || len < MIN_GEOM_SPAN) return null;

      // Filter out astronomical infinite rays / overflow lines
      if (len > MAX_COORD_ABS) return null;

      return line;
    }

    case 'LWPOLYLINE': {
      const poly = ent as PolylineEntity;
      if (!Array.isArray(poly.vertices) || poly.vertices.length < 2) return null;

      const saneVerts: Vertex2D[] = [];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (let i = 0; i < poly.vertices.length; i++) {
        const v = poly.vertices[i];
        if (!v || !isSaneCoord(v.x) || !isSaneCoord(v.y)) continue;

        // Skip consecutive duplicate vertices (microscopic zero-length segment)
        if (saneVerts.length > 0) {
          const prev = saneVerts[saneVerts.length - 1];
          const dist = Math.hypot(v.x - prev.x, v.y - prev.y);
          if (dist < MIN_GEOM_SPAN) {
            // Keep bulge if present on the duplicate
            if (v.bulge && !prev.bulge) prev.bulge = v.bulge;
            continue;
          }
        }

        saneVerts.push({
          x: v.x,
          y: v.y,
          bulge: typeof v.bulge === 'number' && Number.isFinite(v.bulge) ? v.bulge : undefined,
        });

        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }

      if (saneVerts.length < 2) return null;

      // Filter out polylines whose total bounding span is microscopic (noise/dots)
      const spanW = maxX - minX;
      const spanH = maxY - minY;
      if (Math.hypot(spanW, spanH) < MIN_GEOM_SPAN) return null;

      poly.vertices = saneVerts;
      return poly;
    }

    case 'CIRCLE': {
      if (!isSanePoint(ent.center)) return null;
      if (!Number.isFinite(ent.radius) || ent.radius < MIN_GEOM_SPAN || ent.radius > MAX_COORD_ABS) {
        return null;
      }
      return ent;
    }

    case 'ARC': {
      if (!isSanePoint(ent.center)) return null;
      if (!Number.isFinite(ent.radius) || ent.radius < MIN_GEOM_SPAN || ent.radius > MAX_COORD_ABS) {
        return null;
      }
      const sa = Number(ent.startAngle || 0);
      const ea = Number(ent.endAngle || 0);
      if (!Number.isFinite(sa) || !Number.isFinite(ea)) return null;

      // Normalize angles
      ent.startAngle = ((sa % 360) + 360) % 360;
      ent.endAngle = ((ea % 360) + 360) % 360;

      return ent;
    }

    case 'ELLIPSE': {
      if (!isSanePoint(ent.center) || !isSanePoint(ent.majorAxis)) return null;
      const majLen = Math.hypot(ent.majorAxis.x, ent.majorAxis.y);
      if (!Number.isFinite(majLen) || majLen < MIN_GEOM_SPAN || majLen > MAX_COORD_ABS) {
        return null;
      }
      let ratio = Number(ent.axisRatio || 0.5);
      if (!Number.isFinite(ratio) || ratio <= 0) ratio = 0.5;
      if (ratio > 1) ratio = 1;
      ent.axisRatio = ratio;
      return ent;
    }

    case 'TEXT': {
      if (!isSanePoint(ent.position)) return null;
      let h = Number(ent.height || 0);
      if (!Number.isFinite(h) || h < MIN_GEOM_SPAN || h > MAX_COORD_ABS) {
        h = 10;
      }
      ent.height = h;
      if (!Number.isFinite(ent.rotation)) ent.rotation = 0;
      if (!ent.text || typeof ent.text !== 'string' || !ent.text.trim()) return null;
      return ent;
    }

    case 'INSERT': {
      if (!isSanePoint(ent.position)) return null;
      if (!ent.blockName || typeof ent.blockName !== 'string') return null;

      let sx = Number(ent.scaleX !== undefined ? ent.scaleX : 1);
      let sy = Number(ent.scaleY !== undefined ? ent.scaleY : 1);
      if (!Number.isFinite(sx) || Math.abs(sx) < 1e-7 || Math.abs(sx) > 1e6) sx = 1;
      if (!Number.isFinite(sy) || Math.abs(sy) < 1e-7 || Math.abs(sy) > 1e6) sy = 1;
      ent.scaleX = sx;
      ent.scaleY = sy;
      if (!Number.isFinite(ent.rotation)) ent.rotation = 0;
      return ent;
    }

    case 'RASTER_PREVIEW': {
      return ent;
    }

    default:
      return null;
  }
}

/**
 * Sanitizes an array of entities, removing microscopic or invalid items.
 */
export function sanitizeEntityList(list: CadEntity[]): CadEntity[] {
  if (!Array.isArray(list)) return [];
  const result: CadEntity[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = sanitizeCadEntity(list[i]);
    if (s) result.push(s);
  }
  return result;
}

/**
 * Preprocesses and sanitizes a complete DrawingModel, cleaning both top-level entities and block definitions.
 */
export function sanitizeDrawingModel(model: DrawingModel): DrawingModel {
  if (!model) return model;

  // Sanitize top-level entities
  const cleanEntities = sanitizeEntityList(model.entities || []);

  // Sanitize all block entities and base points
  const cleanBlocks: Record<string, CadBlock> = {};
  if (model.blocks) {
    Object.keys(model.blocks).forEach((k) => {
      const b = model.blocks[k];
      if (!b) return;
      const bp = isSanePoint(b.basePoint) ? b.basePoint : { x: 0, y: 0 };
      cleanBlocks[k] = {
        name: b.name || k,
        basePoint: bp,
        entities: sanitizeEntityList(b.entities || []),
      };
    });
  }

  return {
    ...model,
    blocks: cleanBlocks,
    entities: cleanEntities,
  };
}
