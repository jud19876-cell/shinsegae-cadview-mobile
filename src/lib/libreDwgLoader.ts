/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CadBlock,
  CadEntity,
  CadTheme,
  DrawingModel,
  LayerInfo,
  Point2D,
  Vertex2D,
} from '../types/cad';
import { resolveCadColorValue } from './cadColors';
import { cleanCadText, extractThumbnailBmp } from './textSanitizer';
import { isValidCoord, isSanePoint, MAX_COORD_LIMIT } from './cadSanitizer';

const RAD2DEG = 180 / Math.PI;

// Note: Calling LibreDwg.create() with undefined uses Vite's native `new URL('libredwg-web.wasm', import.meta.url)`
const WASM_DIRS: Array<string | undefined> = [
  undefined,
  '/wasm',
  'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.8.1/wasm',
];

let cachedLibreDwgInstance: any = null;
let loadingPromise: Promise<any> | null = null;

async function getLibreDwgInstance(): Promise<any> {
  if (cachedLibreDwgInstance) return cachedLibreDwgInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    let lastError: any = null;
    try {
      const mod: any = await import('@mlightcad/libredwg-web');
      const LibreDwg = mod.LibreDwg || mod.default?.LibreDwg || mod.default;
      if (LibreDwg && typeof LibreDwg.create === 'function') {
        for (const wasmDir of WASM_DIRS) {
          try {
            const instance = await LibreDwg.create(wasmDir);
            cachedLibreDwgInstance = instance;
            return instance;
          } catch (wasmErr) {
            lastError = wasmErr;
          }
        }
      }
    } catch (err) {
      lastError = err;
    }
    loadingPromise = null;
    throw lastError || new Error('LibreDWG WebAssembly 엔진을 초기화하지 못했습니다.');
  })();

  return loadingPromise;
}

function getOcsMatrix(nx: number, ny: number, nz: number) {
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  const Az = { x: nx / len, y: ny / len, z: nz / len };

  if (Math.abs(Az.x) < 1e-6 && Math.abs(Az.y) < 1e-6 && Math.abs(Az.z - 1) < 1e-6) {
    return null;
  }

  let Ax: { x: number; y: number; z: number };
  if (Math.abs(Az.x) < 1 / 64 && Math.abs(Az.y) < 1 / 64) {
    Ax = { x: Az.z, y: 0, z: -Az.x };
  } else {
    Ax = { x: -Az.y, y: Az.x, z: 0 };
  }
  const axLen = Math.hypot(Ax.x, Ax.y, Ax.z) || 1;
  Ax = { x: Ax.x / axLen, y: Ax.y / axLen, z: Ax.z / axLen };

  const Ay = {
    x: Az.y * Ax.z - Az.z * Ax.y,
    y: Az.z * Ax.x - Az.x * Ax.z,
    z: Az.x * Ax.y - Az.y * Ax.x,
  };

  return { Ax, Ay, Az };
}

function extractExtrusion(raw: any): { x: number; y: number; z: number } {
  const ext = raw?.extrusionDirection ?? raw?.extrusion ?? raw?.normal;
  if (!ext) return { x: 0, y: 0, z: 1 };
  const x = Number(Array.isArray(ext) ? ext[0] : ext.x ?? 0);
  const y = Number(Array.isArray(ext) ? ext[1] : ext.y ?? 0);
  const z = Number(Array.isArray(ext) ? ext[2] : ext.z ?? 1);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x, y, z };
}

function ocsPointToWcs2D(
  pt: { x: number; y: number; z?: number },
  ext: { x: number; y: number; z: number }
): Point2D {
  const mat = getOcsMatrix(ext.x, ext.y, ext.z);
  if (!mat) return { x: pt.x, y: pt.y };
  const z = pt.z || 0;
  return {
    x: pt.x * mat.Ax.x + pt.y * mat.Ay.x + z * mat.Az.x,
    y: pt.x * mat.Ax.y + pt.y * mat.Ay.y + z * mat.Az.y,
  };
}

function evaluateBSpline(
  degree: number,
  controlPoints: Point2D[],
  knots: number[],
  weights?: number[],
  numSamples: number = 48
): Point2D[] {
  const n = controlPoints.length - 1;
  if (n < 1) return controlPoints;
  const p = Math.min(degree, n);

  let U = knots;
  if (!U || U.length !== n + p + 2) {
    U = [];
    for (let i = 0; i <= n + p + 1; i++) {
      if (i <= p) U.push(0);
      else if (i >= n + 1) U.push(1);
      else U.push((i - p) / (n - p + 1));
    }
  }

  const uMin = U[p];
  const uMax = U[n + 1];
  if (uMax <= uMin) return controlPoints;

  const result: Point2D[] = [];
  for (let s = 0; s <= numSamples; s++) {
    const u = s === numSamples ? uMax - 1e-9 : uMin + (s / numSamples) * (uMax - uMin);

    let span = p;
    for (let i = p; i <= n; i++) {
      if (u >= U[i] && u < U[i + 1]) {
        span = i;
        break;
      }
    }

    const dX: number[] = [];
    const dY: number[] = [];
    const dW: number[] = [];

    for (let j = 0; j <= p; j++) {
      const idx = Math.max(0, Math.min(n, span - p + j));
      const w = weights && weights[idx] > 0 ? weights[idx] : 1;
      dX[j] = controlPoints[idx].x * w;
      dY[j] = controlPoints[idx].y * w;
      dW[j] = w;
    }

    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = span - p + j;
        const denom = U[i + p - r + 1] - U[i];
        const alpha = denom === 0 ? 0 : (u - U[i]) / denom;
        dX[j] = (1 - alpha) * dX[j - 1] + alpha * dX[j];
        dY[j] = (1 - alpha) * dY[j - 1] + alpha * dY[j];
        dW[j] = (1 - alpha) * dW[j - 1] + alpha * dW[j];
      }
    }

    const wFinal = dW[p] || 1;
    result.push({ x: dX[p] / wFinal, y: dY[p] / wFinal });
  }
  return result;
}

function extractPoint2D(pt: any): Point2D | null {
  if (!pt) return null;
  if (Array.isArray(pt) && pt.length >= 2) {
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (isValidCoord(x) && isValidCoord(y)) return { x, y };
  }
  if (typeof pt === 'object') {
    const x = Number(pt.x ?? pt.X ?? pt[0]);
    const y = Number(pt.y ?? pt.Y ?? pt[1]);
    if (isValidCoord(x) && isValidCoord(y)) return { x, y };
  }
  return null;
}

function extractPoint3D(pt: any): { x: number; y: number; z: number } | null {
  if (!pt) return null;
  if (Array.isArray(pt) && pt.length >= 2) {
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    const z = Number(pt[2] ?? 0);
    if (isValidCoord(x) && isValidCoord(y)) return { x, y, z: Number.isFinite(z) ? z : 0 };
  }
  if (typeof pt === 'object') {
    const x = Number(pt.x ?? pt.X ?? pt[0]);
    const y = Number(pt.y ?? pt.Y ?? pt[1]);
    const z = Number(pt.z ?? pt.Z ?? pt[2] ?? 0);
    if (isValidCoord(x) && isValidCoord(y)) return { x, y, z: Number.isFinite(z) ? z : 0 };
  }
  return null;
}

/**
 * LibreDWG stores all binary DWG angles in radians.
 * Convert radians to degrees deterministically.
 */
function radToDeg(val: any): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return n * RAD2DEG;
}

function extractAciOrColor(r: any): number | null {
  // TrueColor RGB integer (> 256)
  if (typeof r.color === 'number' && r.color > 256) {
    return r.color;
  }
  const rawIdx = r.colorIndex ?? r.color?.colorIndex ?? r.color?.index ?? r.aci ?? r.color;
  if (rawIdx === undefined || rawIdx === null) return null;
  const n = Number(rawIdx);
  // 256 = ByLayer, 0 = ByBlock
  if (!Number.isFinite(n) || n === 256 || n === 0) return null;
  return n;
}

/**
 * Convert a single raw LibreDWG entity into one or more CadEntity objects.
 */
function convertRawDwgEntities(
  r: any,
  idGen: () => string,
  blocks?: Record<string, CadBlock>
): CadEntity[] {
  if (!r || typeof r !== 'object') return [];

  // Respect entity-level visibility (`isVisible` from getCommonAttrs or raw flags)
  const isInvisible = Boolean(
    r.isVisible === false ||
    r.visible === false ||
    r.invisible === true ||
    r.invisible === 1 ||
    r.invis === 1 ||
    r.invis === true ||
    r.invisibility === 1 ||
    r.invisibility === true
  );
  if (isInvisible) return [];

  const rawType = String(r.type || r.entityType || '').toUpperCase();
  if (!rawType || rawType === 'VIEWPORT' || rawType === 'ATTDEF') return [];

  const layer = cleanCadText(String(r.layer || r.layerName || '0')) || '0';
  const aci = extractAciOrColor(r);
  if (aci !== null && aci < 0 && aci >= -255) return []; // Negative ACI = hidden entity

  const linetype = String(r.lineType || r.linetype || 'CONTINUOUS').toUpperCase();
  const lineweight = typeof r.lineweight === 'number' ? r.lineweight : undefined;
  const ext = extractExtrusion(r);
  const flipZ = ext.z < 0 ? -1 : 1;

  // 1. LINE
  if (rawType === 'LINE') {
    const start = extractPoint2D(r.startPoint || r.start || r.p1);
    const end = extractPoint2D(r.endPoint || r.end || r.p2);
    if (!start || !end) return [];
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) return [];
    return [{ id: idGen(), type: 'LINE', layer, aci, linetype, lineweight, start, end }];
  }

  // 2. LWPOLYLINE / POLYLINE2D / POLYLINE3D / POLYLINE / LEADER
  if (
    rawType === 'LWPOLYLINE' ||
    rawType === 'LWPLINE' ||
    rawType === 'POLYLINE' ||
    rawType === 'POLYLINE2D' ||
    rawType === 'POLYLINE3D' ||
    rawType === 'POLYLINE_2D' ||
    rawType === 'POLYLINE_3D' ||
    rawType === 'LEADER'
  ) {
    const rawVerts = r.vertices || r.points || r.pts || [];
    if (!Array.isArray(rawVerts) || rawVerts.length < 2) return [];

    const polyFlag = Number(r.flag ?? r.flags ?? 0);
    const is3D = rawType.includes('3D') || (polyFlag & 8) !== 0;
    const isMesh = (polyFlag & 16) !== 0 || (polyFlag & 64) !== 0;
    if (isMesh) return []; // Polyface/Polygon meshes handled separately if needed

    const elev = Number(r.elevation || 0);
    const vertices: Vertex2D[] = [];
    for (const v of rawVerts) {
      const vFlag = Number(v?.flag ?? v?.flags ?? 0);
      // Skip spline control frame points (flag bit 16)
      if ((vFlag & 16) !== 0) continue;

      const pt = extractPoint3D(v?.point || v);
      if (pt) {
        const p2d =
          is3D || rawType === 'LEADER'
            ? { x: pt.x, y: pt.y }
            : ocsPointToWcs2D({ x: pt.x, y: pt.y, z: pt.z || elev }, ext);
        if (isSanePoint(p2d)) {
          const b = Number(v?.bulge ?? 0);
          vertices.push({
            x: p2d.x,
            y: p2d.y,
            bulge: Number.isFinite(b) && b !== 0 ? b * (is3D ? 1 : flipZ) : undefined,
          });
        }
      }
    }
    if (vertices.length < 2) return [];
    const isLwPoly = rawType === 'LWPOLYLINE' || rawType === 'LWPLINE';
    // In binary DWG (LibreDWG), LWPOLYLINE uses bit 512 (0x200) for CLOSED (bit 1 is HAS_EXTRUSION),
    // whereas POLYLINE2D / POLYLINE3D uses bit 1 for CLOSED.
    const closedBit = isLwPoly ? (polyFlag & 512) !== 0 : (polyFlag & 1) !== 0;
    const closed =
      rawType === 'LEADER'
        ? false
        : Boolean(r.closed || r.isClosed || closedBit);
    return [{ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices, closed }];
  }

  // 3. MLINE
  if (rawType === 'MLINE') {
    const rawVerts = r.vertices || [];
    if (!Array.isArray(rawVerts) || rawVerts.length < 2) return [];
    const vertices: Vertex2D[] = [];
    for (const v of rawVerts) {
      const pt = extractPoint2D(v?.vertex || v?.point || v);
      if (pt && isSanePoint(pt)) {
        vertices.push(pt);
      }
    }
    if (vertices.length < 2) return [];
    const closed = (Number(r.flags ?? 0) & 2) !== 0;
    return [{ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices, closed }];
  }

  // 4. HATCH (Boundary paths -> crisp outline polylines/lines/arcs)
  if (rawType === 'HATCH') {
    const paths = r.boundaryPaths || r.paths || r.loops || [];
    if (!Array.isArray(paths) || paths.length === 0) return [];
    const out: CadEntity[] = [];

    for (const path of paths) {
      if (!path) continue;
      // 4a. Polyline boundary path
      if (Array.isArray(path.vertices) && path.vertices.length >= 2) {
        const vertices: Vertex2D[] = [];
        for (const v of path.vertices) {
          const pt = extractPoint2D(v);
          if (pt) {
            const p2d = ocsPointToWcs2D({ x: pt.x, y: pt.y, z: 0 }, ext);
            if (isSanePoint(p2d)) {
              const b = Number(v.bulge ?? 0);
              vertices.push({
                x: p2d.x,
                y: p2d.y,
                bulge: Number.isFinite(b) && b !== 0 ? b * flipZ : undefined,
              });
            }
          }
        }
        if (vertices.length >= 2) {
          out.push({
            id: idGen(),
            type: 'LWPOLYLINE',
            layer,
            aci,
            linetype,
            lineweight,
            vertices,
            closed: path.isClosed !== false,
          });
        }
      }
      // 4b. Segmented edge boundary path
      if (Array.isArray(path.edges) && path.edges.length > 0) {
        for (const edge of path.edges) {
          if (!edge) continue;
          const eType = Number(edge.type);
          if (eType === 1) {
            // Line edge
            const p1Raw = extractPoint2D(edge.start);
            const p2Raw = extractPoint2D(edge.end);
            if (p1Raw && p2Raw) {
              const p1 = ocsPointToWcs2D(p1Raw, ext);
              const p2 = ocsPointToWcs2D(p2Raw, ext);
              if (isSanePoint(p1) && isSanePoint(p2) && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 1e-6) {
                out.push({ id: idGen(), type: 'LINE', layer, aci, linetype, lineweight, start: p1, end: p2 });
              }
            }
          } else if (eType === 2) {
            // Circular arc edge (angles in radians in LibreDWG)
            const cRaw = extractPoint2D(edge.center);
            const radius = Number(edge.radius);
            if (cRaw && radius > 0 && radius <= MAX_COORD_LIMIT) {
              const center = ocsPointToWcs2D(cRaw, ext);
              if (isSanePoint(center)) {
                let sa = radToDeg(edge.startAngle);
                let ea = radToDeg(edge.endAngle);
                if (edge.isCCW === false) {
                  const tmp = 360 - ea;
                  ea = 360 - sa;
                  sa = tmp;
                }
                if (ext.z < 0) {
                  const tmp = 180 - ea;
                  ea = 180 - sa;
                  sa = tmp;
                }
                if (Math.abs(ea - sa) >= 359.9) {
                  out.push({ id: idGen(), type: 'CIRCLE', layer, aci, linetype, lineweight, center, radius });
                } else {
                  out.push({
                    id: idGen(),
                    type: 'ARC',
                    layer,
                    aci,
                    linetype,
                    lineweight,
                    center,
                    radius,
                    startAngle: sa,
                    endAngle: ea,
                  });
                }
              }
            }
          } else if (eType === 3) {
            // Elliptic arc edge
            const cRaw = extractPoint2D(edge.center);
            const majRaw = extractPoint2D(edge.end);
            const ratio = Number(edge.lengthOfMinorAxis || 1);
            if (cRaw && majRaw && ratio > 0) {
              const majorR = Math.hypot(majRaw.x, majRaw.y);
              const minorR = majorR * ratio;
              const rotRad = Math.atan2(majRaw.y, majRaw.x);
              const cosR = Math.cos(rotRad);
              const sinR = Math.sin(rotRad);
              let t0 = Number(edge.startAngle || 0);
              let t1 = Number(edge.endAngle || Math.PI * 2);
              if (t1 <= t0) t1 += Math.PI * 2;
              const steps = 28;
              const eVerts: Vertex2D[] = [];
              for (let i = 0; i <= steps; i++) {
                const t = t0 + (t1 - t0) * (i / steps);
                const lx = majorR * Math.cos(t);
                const ly = minorR * Math.sin(t) * flipZ;
                const pt = ocsPointToWcs2D(
                  { x: cRaw.x + lx * cosR - ly * sinR, y: cRaw.y + lx * sinR + ly * cosR },
                  ext
                );
                if (isSanePoint(pt)) eVerts.push(pt);
              }
              if (eVerts.length >= 2) {
                out.push({ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: eVerts });
              }
            }
          } else if (eType === 4) {
            // Spline edge
            const rawFit = Array.isArray(edge.fitDatum) ? edge.fitDatum : [];
            const rawCtrl = Array.isArray(edge.controlPoints) ? edge.controlPoints : [];
            const pts: Vertex2D[] = [];
            const src = rawCtrl.length >= 2 ? rawCtrl : rawFit;
            for (const p of src) {
              const pt = extractPoint2D(p);
              if (pt) {
                const wpt = ocsPointToWcs2D(pt, ext);
                if (isSanePoint(wpt)) pts.push(wpt);
              }
            }
            if (pts.length >= 2) {
              out.push({ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: pts });
            }
          }
        }
      }
    }
    return out;
  }

  // 5. SOLID / TRACE / 3DFACE
  if (rawType === 'SOLID' || rawType === 'TRACE' || rawType === '3DFACE' || rawType === 'FACE3D') {
    const p1 = extractPoint3D(r.corner1 || r.firstCorner || r.p1);
    const p2 = extractPoint3D(r.corner2 || r.secondCorner || r.p2);
    const p3 = extractPoint3D(r.corner3 || r.thirdCorner || r.p3);
    const p4 = extractPoint3D(r.corner4 || r.fourthCorner || r.p4);
    const is3DFace = rawType === '3DFACE' || rawType === 'FACE3D';
    // SOLID/TRACE swap corners 3 and 4; 3DFACE uses perimeter 1-2-3-4
    const rawOrdered = is3DFace ? [p1, p2, p3, p4] : [p1, p2, p4, p3];
    const pts: Vertex2D[] = [];
    for (const p of rawOrdered) {
      if (!p) continue;
      const wpt = is3DFace ? { x: p.x, y: p.y } : ocsPointToWcs2D(p, ext);
      if (isSanePoint(wpt)) {
        const prev = pts[pts.length - 1];
        if (!prev || Math.hypot(wpt.x - prev.x, wpt.y - prev.y) > 1e-6) {
          pts.push(wpt);
        }
      }
    }
    if (pts.length < 3) return [];
    return [{ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: pts, closed: true }];
  }

  // 6. SPLINE
  if (rawType === 'SPLINE') {
    const rawFit = r.fitPoints || [];
    const rawCtrl = r.controlPoints || r.vertices || [];
    const fitPts = Array.isArray(rawFit) ? rawFit.map(extractPoint2D).filter((p): p is Point2D => p !== null) : [];
    const ctrlPts = Array.isArray(rawCtrl) ? rawCtrl.map(extractPoint2D).filter((p): p is Point2D => p !== null) : [];
    const deg = Number(r.degree || 3);
    const knots = Array.isArray(r.knots) ? r.knots.map(Number) : [];
    const weights = Array.isArray(r.weights) ? r.weights.map(Number) : undefined;

    let vertices: Vertex2D[] = [];
    if (ctrlPts.length >= 2) {
      const samples = Math.min(128, Math.max(32, ctrlPts.length * 8));
      vertices = evaluateBSpline(deg, ctrlPts, knots, weights, samples);
    } else if (fitPts.length >= 2) {
      vertices = fitPts;
    }
    if (vertices.length < 2) return [];
    const closed = Boolean(r.closed || r.isClosed || (Number(r.flag || 0) & 1) === 1);
    return [{ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices, closed }];
  }

  // 7. CIRCLE
  if (rawType === 'CIRCLE') {
    const c3d = extractPoint3D(r.center || r.position);
    const radius = Number(r.radius ?? r.r);
    if (!c3d || !(radius > 0 && radius <= MAX_COORD_LIMIT)) return [];
    const center = ocsPointToWcs2D(c3d, ext);
    if (!isSanePoint(center)) return [];
    return [{ id: idGen(), type: 'CIRCLE', layer, aci, linetype, lineweight, center, radius }];
  }

  // 8. ARC
  if (rawType === 'ARC') {
    const c3d = extractPoint3D(r.center || r.position);
    const radius = Number(r.radius ?? r.r);
    if (!c3d || !(radius > 0 && radius <= MAX_COORD_LIMIT)) return [];
    const center = ocsPointToWcs2D(c3d, ext);
    if (!isSanePoint(center)) return [];
    let startAngle = radToDeg(r.startAngle ?? r.start_angle ?? 0);
    let endAngle = radToDeg(r.endAngle ?? r.end_angle ?? 0);
    if (ext.z < 0) {
      const tmp = 180 - endAngle;
      endAngle = 180 - startAngle;
      startAngle = tmp;
    }
    return [
      {
        id: idGen(),
        type: 'ARC',
        layer,
        aci,
        linetype,
        lineweight,
        center,
        radius,
        startAngle,
        endAngle,
      },
    ];
  }

  // 9. ELLIPSE
  if (rawType === 'ELLIPSE') {
    const center = extractPoint2D(r.center || r.position);
    const majorAxis = extractPoint2D(r.majorAxisEndPoint || r.majorAxis || r.sm_axis);
    const axisRatio = Number(r.axisRatio ?? r.minorToMajorRatio ?? r.ratio ?? 1);
    if (!center || !majorAxis || !(axisRatio > 0)) return [];
    const sa = Number(r.startAngle ?? 0);
    const ea = Number(r.endAngle ?? Math.PI * 2);
    const isFull = Math.abs(ea - sa) >= Math.PI * 2 - 1e-3 || (sa === 0 && ea === 0);
    if (isFull && ext.z >= 0) {
      return [{ id: idGen(), type: 'ELLIPSE', layer, aci, linetype, lineweight, center, majorAxis, axisRatio }];
    }
    // Tessellate partial elliptical arc or mirrored ellipse
    const majorR = Math.hypot(majorAxis.x, majorAxis.y);
    const minorR = majorR * axisRatio;
    const rotRad = Math.atan2(majorAxis.y, majorAxis.x);
    const cosRot = Math.cos(rotRad);
    const sinRot = Math.sin(rotRad);
    let t0 = sa;
    let t1 = ea;
    if (t1 <= t0) t1 += Math.PI * 2;
    const steps = 36;
    const vertices: Vertex2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (t1 - t0) * (i / steps);
      const lx = majorR * Math.cos(t);
      const ly = minorR * Math.sin(t) * flipZ;
      vertices.push({
        x: center.x + lx * cosRot - ly * sinRot,
        y: center.y + lx * sinRot + ly * cosRot,
      });
    }
    return [{ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices, closed: false }];
  }

  // 10. TEXT / MTEXT / ATTRIB
  if (rawType === 'TEXT' || rawType === 'MTEXT' || rawType === 'ATTRIB') {
    const rawStr = String(r.text ?? r.string ?? r.value ?? r.contents ?? '');
    const text = cleanCadText(rawStr);
    if (!text) return [];

    const startPt = extractPoint3D(r.insertionPoint || r.startPoint || r.position || r.ins_pt);
    const endPt = extractPoint3D(r.endPoint || r.alignmentPoint || r.alignment_pt);
    const halign = Number(r.halign ?? r.horizontalAlignment ?? 0);

    let basePt = startPt;
    if (rawType !== 'MTEXT' && halign > 0 && endPt && (Math.abs(endPt.x) > 1e-6 || Math.abs(endPt.y) > 1e-6)) {
      basePt = endPt;
    }
    if (!basePt) return [];

    const pos = rawType === 'MTEXT' ? { x: basePt.x, y: basePt.y } : ocsPointToWcs2D(basePt, ext);
    if (!isSanePoint(pos)) return [];

    const height = Number(r.textHeight ?? r.height ?? r.charHeight ?? 2.5);
    let rotation = 0;
    if (rawType === 'MTEXT' && r.direction) {
      const dir = extractPoint2D(r.direction);
      if (dir && (Math.abs(dir.x) > 1e-6 || Math.abs(dir.y) > 1e-6)) {
        rotation = Math.atan2(dir.y, dir.x) * RAD2DEG;
      }
    } else {
      rotation = radToDeg(r.rotation ?? r.angle ?? 0);
    }

    let align: CanvasTextAlign = 'left';
    if (rawType === 'MTEXT') {
      const att = Number(r.attachmentPoint ?? 1);
      if (att === 2 || att === 5 || att === 8) align = 'center';
      else if (att === 3 || att === 6 || att === 9) align = 'right';
    } else {
      if (halign === 1 || halign === 4) align = 'center';
      else if (halign === 2) align = 'right';
    }

    return [
      {
        id: idGen(),
        type: 'TEXT',
        layer,
        aci,
        position: pos,
        height: height > 0 ? height : 2.5,
        rotation,
        text,
        align,
        isMtext: rawType === 'MTEXT',
      },
    ];
  }

  // 11. MULTILEADER (MLEADER)
  if (rawType === 'MULTILEADER' || rawType === 'MLEADER') {
    const out: CadEntity[] = [];
    if (Array.isArray(r.leaderSections)) {
      for (const sec of r.leaderSections) {
        if (Array.isArray(sec?.leaderLines)) {
          for (const ll of sec.leaderLines) {
            if (Array.isArray(ll?.vertices) && ll.vertices.length >= 2) {
              const vertices: Vertex2D[] = [];
              for (const v of ll.vertices) {
                const pt = extractPoint2D(v);
                if (pt && isSanePoint(pt)) vertices.push(pt);
              }
              if (vertices.length >= 2) {
                if (sec.lastLeaderLinePoint) {
                  const lp = extractPoint2D(sec.lastLeaderLinePoint);
                  if (lp && isSanePoint(lp)) vertices.push(lp);
                }
                out.push({ id: idGen(), type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices });
              }
            }
          }
        }
      }
    }
    const text = cleanCadText(String(r.textContent ?? ''));
    if (text) {
      const anchor = extractPoint2D(r.textAnchor || r.contentBasePosition || r.planeOrigin);
      if (anchor && isSanePoint(anchor)) {
        const th = Number(r.textHeight || 2.5);
        out.push({
          id: idGen(),
          type: 'TEXT',
          layer,
          aci,
          position: anchor,
          height: th > 0 ? th : 2.5,
          rotation: radToDeg(r.textRotation ?? 0),
          text,
          isMtext: true,
        });
      }
    }
    return out;
  }

  // 12. DIMENSION
  if (rawType === 'DIMENSION' || rawType.startsWith('DIMENSION_')) {
    const blockName = cleanCadText(String(r.name || r.blockName || r.block || ''));
    if (blockName && (!blocks || blocks[blockName])) {
      // Anonymous dimension block (*D1, *D2...) contains WCS geometry at (0,0)
      return [
        {
          id: idGen(),
          type: 'INSERT',
          layer,
          aci,
          blockName,
          position: { x: 0, y: 0 },
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        },
      ];
    }
    // Fallback if anonymous dimension block is missing
    const out: CadEntity[] = [];
    const p1 = extractPoint2D(r.subDefinitionPoint1 || r.firstExtensionLineStartPoint);
    const p2 = extractPoint2D(r.subDefinitionPoint2 || r.secondExtensionLineStartPoint || r.definitionPoint);
    if (p1 && p2 && isSanePoint(p1) && isSanePoint(p2) && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 1e-6) {
      out.push({ id: idGen(), type: 'LINE', layer, aci, linetype, lineweight, start: p1, end: p2 });
    }
    const tp = extractPoint2D(r.textPoint || r.definitionPoint);
    let dimStr = cleanCadText(String(r.text || ''));
    if (!dimStr || dimStr === '<>') {
      const meas = Number(r.measurement);
      if (Number.isFinite(meas) && meas > 0) {
        dimStr = Number.isInteger(meas) ? String(meas) : meas.toFixed(1).replace(/\.0$/, '');
      }
    }
    if (tp && isSanePoint(tp) && dimStr) {
      out.push({
        id: idGen(),
        type: 'TEXT',
        layer,
        aci,
        position: tp,
        height: 2.5,
        rotation: radToDeg(r.textRotation ?? 0),
        text: dimStr,
        align: 'center',
      });
    }
    return out;
  }

  // 13. INSERT (Block reference + rectangular array + block attributes)
  if (rawType === 'INSERT') {
    const blockName = cleanCadText(String(r.name || r.blockName || r.block || ''));
    const pos3d = extractPoint3D(r.insertionPoint || r.position || r.ins_pt);
    if (!blockName || !pos3d) return [];
    const position = ocsPointToWcs2D(pos3d, ext);
    if (!isSanePoint(position)) return [];

    const sx = Number(r.xScale ?? r.scaleX ?? r.scale?.x ?? 1);
    const sy = Number(r.yScale ?? r.scaleY ?? r.scale?.y ?? 1);
    const rot = radToDeg(r.rotation ?? r.angle ?? 0);

    const finalSx = (Number.isFinite(sx) && sx !== 0 ? sx : 1) * flipZ;
    const finalSy = Number.isFinite(sy) && sy !== 0 ? sy : 1;
    const finalRot = ext.z < 0 ? -rot : rot;

    const rowCount = Math.max(1, Number(r.rowCount ?? 1));
    const columnCount = Math.max(1, Number(r.columnCount ?? 1));
    const rowSpacing = Number(r.rowSpacing ?? 0);
    const columnSpacing = Number(r.columnSpacing ?? 0);

    const out: CadEntity[] = [
      {
        id: idGen(),
        type: 'INSERT',
        layer,
        aci,
        blockName,
        position,
        scaleX: finalSx,
        scaleY: finalSy,
        rotation: finalRot,
        rowCount: rowCount > 1 ? rowCount : undefined,
        columnCount: columnCount > 1 ? columnCount : undefined,
        rowSpacing: Number.isFinite(rowSpacing) && rowSpacing !== 0 ? rowSpacing : undefined,
        columnSpacing: Number.isFinite(columnSpacing) && columnSpacing !== 0 ? columnSpacing : undefined,
      },
    ];

    // Also emit visible ATTRIB entities attached to this INSERT
    if (Array.isArray(r.attribs) && r.attribs.length > 0) {
      for (const attr of r.attribs) {
        const attrEnts = convertRawDwgEntities(attr, idGen, blocks);
        for (const ae of attrEnts) {
          if (ae.layer === '0') ae.layer = layer;
          out.push(ae);
        }
      }
    }

    return out;
  }

  return [];
}

/**
 * Parse binary DWG buffer using LibreDWG WebAssembly
 */
export async function parseBinaryDwgFile(
  buffer: ArrayBuffer,
  fileName: string,
  versionStr: string,
  onProgressOrTheme?: ((msg: string) => void) | CadTheme,
  themeArg: CadTheme = 'dark'
): Promise<DrawingModel> {
  const onProgress = typeof onProgressOrTheme === 'function' ? onProgressOrTheme : undefined;
  const theme: CadTheme =
    typeof onProgressOrTheme === 'string' ? onProgressOrTheme : themeArg;

  if (!buffer || buffer.byteLength < 32) {
    throw new Error('파일 크기가 0바이트이거나 유효한 DWG 데이터가 없습니다.');
  }

  let wasmErrorDetail = '';
  try {
    onProgress?.('LibreDWG 엔진 초기화 중...');
    const libredwg = await getLibreDwgInstance();
    onProgress?.(`DWG 바이너리 구조 해독 중 (${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB)...`);
    const dwgDataPtr = libredwg.dwg_read_data(buffer, 0);

    if (dwgDataPtr) {
      try {
        onProgress?.('도면 객체 및 블록 테이블 변환 중...');
        const db = libredwg.convert(dwgDataPtr);
        if (db) {
          const layers: Record<string, LayerInfo> = {
            '0': {
              name: '0',
              aci: 7,
              color: resolveCadColorValue(7, theme),
              visible: true,
              count: 0,
            },
          };
          const blocks: Record<string, CadBlock> = {};
          const entities: CadEntity[] = [];

          // 1. Extract Layers
          const rawLayers = db.tables?.LAYER?.entries || db.layers || [];
          const layerList = Array.isArray(rawLayers) ? rawLayers : Object.values(rawLayers);
          for (const l of layerList as any[]) {
            if (!l) continue;
            const name = cleanCadText(String(l.name || '0')) || '0';
            const rawColorIdx =
              typeof l.color === 'object' && l.color !== null
                ? Number(l.color.index ?? l.color.colorIndex ?? 7)
                : Number(l.colorIndex ?? l.color ?? 7);
            const aci = Math.abs(Number.isFinite(rawColorIdx) ? rawColorIdx : 7) || 7;
            const flag = Number(l.flag ?? l.flags ?? 0);
            const isFrozen = Boolean(l.frozen || (flag & 1) !== 0);
            const isOff = Boolean(
              l.off ||
              l.is_off ||
              l.isOff ||
              l.on === false ||
              l.isOn === false ||
              rawColorIdx < 0
            );
            const isPlot = l.plotFlag !== undefined ? Boolean(l.plotFlag) : true;
            const isXref = /^xref/i.test(name);
            const isHiddenByDefault =
              isOff ||
              isFrozen ||
              isXref ||
              /defpoints|guide|proj|align|보조선|투영선/i.test(name);

            const colorVal =
              typeof l.color === 'number' && l.color > 256 ? l.color : aci;

            layers[name] = {
              name,
              aci,
              color: resolveCadColorValue(colorVal, theme),
              visible: !isHiddenByDefault,
              frozen: isFrozen,
              isPlot,
              count: 0,
            };
          }

          let idCounter = 1;
          const nextId = () => `dwg_${idCounter++}`;

          // 2. Extract Blocks & Separate *Model_Space vs *Paper_Space
          const rawBlocks =
            db.tables?.BLOCK_RECORD?.entries ||
            db.blocks ||
            db.blockRecords ||
            [];
          const blockList = Array.isArray(rawBlocks) ? rawBlocks : Object.values(rawBlocks);

          const modelSpaceRaws: any[] = [];
          const paperSpaceRaws: any[] = [];
          const modelSpaceHandles = new Set<string>();
          const paperSpaceHandles = new Set<string>();

          for (const b of blockList as any[]) {
            if (!b) continue;
            const bName = cleanCadText(String(b.name || ''));
            if (!bName) continue;
            const upperName = bName.toUpperCase();
            const bHandle = b.handle !== undefined ? String(b.handle) : '';
            const rawEnts = Array.isArray(b.entities) ? b.entities : [];

            if (upperName.startsWith('*MODEL_SPACE')) {
              if (bHandle) modelSpaceHandles.add(bHandle);
              for (const re of rawEnts) modelSpaceRaws.push(re);
              continue;
            }
            if (upperName.startsWith('*PAPER_SPACE')) {
              if (bHandle) paperSpaceHandles.add(bHandle);
              for (const re of rawEnts) paperSpaceRaws.push(re);
              continue;
            }

            const basePoint = extractPoint2D(b.basePoint || b.origin || b.ins_pt) || { x: 0, y: 0 };
            const bEntities: CadEntity[] = [];
            for (const re of rawEnts) {
              const converted = convertRawDwgEntities(re, nextId);
              for (const ce of converted) bEntities.push(ce);
            }
            blocks[bName] = { name: bName, basePoint, entities: bEntities };
          }

          // 3. Determine active Model Space entities without mixing Paper Space layout borders
          const dbEntities: any[] = Array.isArray(db.entities) ? db.entities : [];
          const activeModelRaws: any[] = [];
          const seenHandles = new Set<string>();

          for (const r of modelSpaceRaws) {
            if (!r) continue;
            const h = r.handle !== undefined ? String(r.handle) : '';
            if (h) {
              if (seenHandles.has(h)) continue;
              seenHandles.add(h);
            }
            activeModelRaws.push(r);
          }

          // Also include any db.entities that do NOT belong to a Paper Space block record
          for (const r of dbEntities) {
            if (!r) continue;
            const ownerId = r.ownerBlockRecordSoftId !== undefined ? String(r.ownerBlockRecordSoftId) : '';
            if (ownerId && paperSpaceHandles.has(ownerId)) continue;
            const h = r.handle !== undefined ? String(r.handle) : '';
            if (h) {
              if (seenHandles.has(h)) continue;
              seenHandles.add(h);
            }
            activeModelRaws.push(r);
          }

          const PROJECTION_LAYER = '가이드/투영선';
          layers[PROJECTION_LAYER] = {
            name: PROJECTION_LAYER,
            aci: 251,
            color: resolveCadColorValue(251, theme),
            visible: false, // Default hidden to match AutoCAD view
            count: 0,
          };

          const isProjectionGuideLine = (ent: CadEntity, rawIndex: number) => {
            if (ent.type !== 'LINE') return false;
            const col = ent.aci ?? 7;
            const p1 = ent.start;
            const p2 = ent.end;
            if (!p1 || !p2) return false;

            const dx = Math.abs(p2.x - p1.x);
            const dy = Math.abs(p2.y - p1.y);
            const len = Math.hypot(dx, dy);

            // 1. Cross-view diagonal connecting isometric view to front/top view (len > 800, dx > 400, dy > 400)
            const isDiagonalCross = len > 800 && dx > 400 && dy > 400;

            // 2. Cross-view vertical connecting top view to front view across empty space
            const isVerticalCross =
              dx < 30 &&
              dy > 500 &&
              Math.min(p1.y, p2.y) < -100 &&
              Math.max(p1.y, p2.y) > 100;

            // 3. Cross-view horizontal connecting front view to side view across empty space
            const isHorizontalCross =
              dy < 30 &&
              dx > 500 &&
              Math.min(p1.x, p2.x) < -2100 &&
              Math.max(p1.x, p2.x) > -1700;

            // 4. Early header projection lines and ticks (< index 250 with col 251/252/94)
            const isEarlyHeaderGuide =
              rawIndex < 250 && (col === 251 || col === 252 || col === 94);

            return (
              isDiagonalCross ||
              isVerticalCross ||
              isHorizontalCross ||
              isEarlyHeaderGuide
            );
          };

          const convertIntoModel = (rawList: any[]) => {
            for (let rawIdx = 0; rawIdx < rawList.length; rawIdx++) {
              const r = rawList[rawIdx];
              const converted = convertRawDwgEntities(r, nextId, blocks);
              for (const ent of converted) {
                // Auto-classify projection/alignment lines between views to PROJECTION_LAYER (hidden by default)
                if (isProjectionGuideLine(ent, rawIdx)) {
                  ent.layer = PROJECTION_LAYER;
                }

                entities.push(ent);
                if (!layers[ent.layer]) {
                  const isHidden =
                    ent.layer.toLowerCase() === 'defpoints' ||
                    /^xref/i.test(ent.layer) ||
                    /guide|proj|align|보조선|투영선/i.test(ent.layer);
                  layers[ent.layer] = {
                    name: ent.layer,
                    aci: 7,
                    color: resolveCadColorValue(7, theme),
                    visible: !isHidden,
                    count: 0,
                  };
                }
                layers[ent.layer].count++;
              }
            }
          };

          convertIntoModel(activeModelRaws);

          // If Model Space had no renderable geometry, fall back to Paper Space entities
          if (entities.length === 0 && paperSpaceRaws.length > 0) {
            convertIntoModel(paperSpaceRaws);
          }

          // If no projection lines were found, clean up the synthetic layer
          if (layers[PROJECTION_LAYER] && layers[PROJECTION_LAYER].count === 0) {
            delete layers[PROJECTION_LAYER];
          }

          if (entities.length > 0) {
            return {
              fileName,
              formatVersion: `${versionStr} (LibreDWG 벡터 엔진)`,
              layers,
              blocks,
              entities,
            };
          }
        }
      } finally {
        try {
          libredwg.dwg_free(dwgDataPtr);
        } catch {
          // ignore cleanup error
        }
      }
    }
  } catch (err: any) {
    wasmErrorDetail = err?.message || String(err);
    console.warn('LibreDWG WASM parsing warning:', err);
  }

  // Fallback: Check embedded preview bitmap if vector extraction produced 0 entities
  const bmpUrl = extractThumbnailBmp(buffer);
  if (bmpUrl) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (e) => reject(e);
      image.src = bmpUrl;
    });

    const w = img.width || 800;
    const h = img.height || 600;

    return {
      fileName,
      formatVersion: `${versionStr} (내장 프리뷰 뷰)`,
      layers: {
        DWG_PREVIEW: {
          name: 'DWG_PREVIEW',
          aci: 7,
          color: '#ffffff',
          visible: true,
          count: 1,
        },
      },
      blocks: {},
      entities: [
        {
          id: 'preview_1',
          type: 'RASTER_PREVIEW',
          layer: 'DWG_PREVIEW',
          img,
          minX: 0,
          minY: 0,
          maxX: w,
          maxY: h,
        },
      ],
      extents: { minX: 0, minY: 0, maxX: w, maxY: h },
    };
  }

  throw new Error(
    `이 DWG 파일(${versionStr})에서 도면 객체를 추출할 수 없습니다.\n` +
      `사내 문서보안(DRM/암호화)이 걸려 있거나 손상된 도면일 수 있습니다. AutoCAD에서 '다른 이름으로 저장 → DXF 또는 AutoCAD 2013~2018 DWG'로 저장 후 다시 열어주세요.` +
      (wasmErrorDetail ? `\n(상세: ${wasmErrorDetail})` : '')
  );
}
