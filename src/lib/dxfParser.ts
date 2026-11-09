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
import { cleanCadText } from './textSanitizer';
import { isValidCoord, isSanePoint, MAX_COORD_LIMIT } from './cadSanitizer';

const DEG2RAD = Math.PI / 180;

/**
 * Normalize extrusion vector and compute OCS axes (Arbitrary Axis Algorithm)
 */
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

function ocsToWcs2D(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number
): Point2D {
  const mat = getOcsMatrix(nx, ny, nz);
  if (!mat) return { x, y };
  return {
    x: x * mat.Ax.x + y * mat.Ay.x + z * mat.Az.x,
    y: x * mat.Ax.y + y * mat.Ay.y + z * mat.Az.y,
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
  if (U.length !== n + p + 2) {
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

/**
 * Zero-allocation streaming DXF group code/value cursor.
 * Prevents allocating millions of `{ code, value }` objects on 30MB~100MB DXF files.
 */
class DxfStreamCursor {
  private readonly text: string;
  private readonly len: number;
  private pos = 0;
  public code = -1;
  public value = '';
  public done = false;

  constructor(text: string) {
    this.text = text;
    this.len = text.length;
    this.advance();
  }

  private readLine(): string | null {
    if (this.pos >= this.len) return null;
    const nl = this.text.indexOf('\n', this.pos);
    let end: number;
    let nextPos: number;
    if (nl === -1) {
      end = this.len;
      nextPos = this.len;
    } else {
      end = nl > this.pos && this.text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
      nextPos = nl + 1;
    }
    const line = this.text.slice(this.pos, end);
    this.pos = nextPos;
    return line;
  }

  public advance(): boolean {
    while (this.pos < this.len) {
      const cLine = this.readLine();
      if (cLine === null) {
        this.done = true;
        return false;
      }
      const trimmedCode = cLine.trim();
      if (trimmedCode.length === 0) continue;

      const vLine = this.readLine();
      if (vLine === null) {
        this.done = true;
        return false;
      }

      const code = parseInt(trimmedCode, 10);
      if (!Number.isNaN(code)) {
        this.code = code;
        this.value = vLine.trim();
        return true;
      }
    }
    this.done = true;
    return false;
  }
}

export function parseDxfText(
  text: string,
  fileName: string,
  theme: CadTheme = 'dark'
): DrawingModel {
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
  const paperEntities: CadEntity[] = [];

  const cursor = new DxfStreamCursor(text) as {
    code: number;
    value: string;
    done: boolean;
    advance(): boolean;
  };
  const curCode = () => cursor.code;
  const curVal = () => cursor.value;
  let idCounter = 1;

  function ensureLayer(layerName: string) {
    const cleanName = layerName || '0';
    if (!layers[cleanName]) {
      const lower = cleanName.toLowerCase();
      const isHiddenByDefault =
        lower === 'defpoints' || /^xref/i.test(cleanName);
      layers[cleanName] = {
        name: cleanName,
        aci: 7,
        color: resolveCadColorValue(7, theme),
        visible: !isHiddenByDefault,
        count: 0,
      };
    }
  }

  function pushEntity(
    targetList: CadEntity[],
    ent: CadEntity,
    countInLayer: boolean,
    isPaperSpace: boolean = false
  ) {
    if (isPaperSpace && targetList === entities) {
      paperEntities.push(ent);
      return;
    }
    targetList.push(ent);
    if (countInLayer) {
      ensureLayer(ent.layer);
      layers[ent.layer].count++;
    }
  }

  /**
   * Parse HATCH boundary paths into crisp outline polylines/lines/arcs
   */
  function parseHatchEntity(targetList: CadEntity[], countInLayer: boolean) {
    let layer = '0';
    let aci: number | null = null;
    let isPaper = false;
    let isInvisible = false;
    let nx = 0, ny = 0, nz = 1;

    // Collect raw pairs of this HATCH entity so we can parse multi-loop paths cleanly
    const hatchPairs: Array<{ code: number; value: string }> = [];
    while (!cursor.done && cursor.code !== 0) {
      const c = cursor.code;
      const v = cursor.value;
      if (c === 8) layer = cleanCadText(v) || '0';
      else if (c === 62) aci = parseInt(v, 10);
      else if (c === 67) isPaper = parseInt(v, 10) === 1;
      else if (c === 60) isInvisible = parseInt(v, 10) === 1;
      else if (c === 210) nx = parseFloat(v) || 0;
      else if (c === 220) ny = parseFloat(v) || 0;
      else if (c === 230) nz = parseFloat(v) || 1;
      hatchPairs.push({ code: c, value: v });
      cursor.advance();
    }

    if (isInvisible) return;
    if (aci !== null && aci < 0) return;

    let idx = 0;
    const nPairs = hatchPairs.length;

    // Find code 91 (number of boundary paths)
    while (idx < nPairs && hatchPairs[idx].code !== 91) idx++;
    if (idx >= nPairs) return;
    const numLoops = Math.min(parseInt(hatchPairs[idx].value, 10) || 0, 2000);
    idx++;

    for (let loop = 0; loop < numLoops && idx < nPairs; loop++) {
      while (idx < nPairs && hatchPairs[idx].code !== 92) {
        // Stop if we hit pattern definition codes (75 = hatch style, 76 = pattern type)
        if (hatchPairs[idx].code === 75 || hatchPairs[idx].code === 76) return;
        idx++;
      }
      if (idx >= nPairs) break;

      const pathFlag = parseInt(hatchPairs[idx].value, 10) || 0;
      idx++;

      const isPolyline = (pathFlag & 2) !== 0;
      if (isPolyline) {
        let isClosed = true;
        let numVerts = 0;
        while (idx < nPairs && hatchPairs[idx].code !== 93) {
          if (hatchPairs[idx].code === 73) {
            isClosed = parseInt(hatchPairs[idx].value, 10) !== 0;
          }
          idx++;
        }
        if (idx >= nPairs) break;
        numVerts = Math.min(parseInt(hatchPairs[idx].value, 10) || 0, 50000);
        idx++;

        const vertices: Vertex2D[] = [];
        for (let vIdx = 0; vIdx < numVerts && idx < nPairs; vIdx++) {
          if (hatchPairs[idx].code !== 10) {
            while (idx < nPairs && hatchPairs[idx].code !== 10 && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
              idx++;
            }
            if (idx >= nPairs || hatchPairs[idx].code !== 10) break;
          }
          const vx = parseFloat(hatchPairs[idx].value);
          idx++;
          let vy = 0;
          if (idx < nPairs && hatchPairs[idx].code === 20) {
            vy = parseFloat(hatchPairs[idx].value);
            idx++;
          }
          let bulge = 0;
          if (idx < nPairs && hatchPairs[idx].code === 42) {
            bulge = parseFloat(hatchPairs[idx].value) || 0;
            idx++;
          }
          if (isValidCoord(vx) && isValidCoord(vy)) {
            const p = ocsToWcs2D(vx, vy, 0, nx, ny, nz);
            if (isSanePoint(p)) {
              const flip = nz < 0 ? -1 : 1;
              vertices.push({ x: p.x, y: p.y, bulge: bulge * flip });
            }
          }
        }

        // Skip any seed/source object handles (97)
        while (idx < nPairs && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
          idx++;
        }

        if (vertices.length >= 2) {
          pushEntity(
            targetList,
            {
              id: `e_${idCounter++}`,
              type: 'LWPOLYLINE',
              layer,
              aci,
              vertices,
              closed: isClosed,
            },
            countInLayer,
            isPaper
          );
        }
      } else {
        // Segmented edge boundary path
        while (idx < nPairs && hatchPairs[idx].code !== 93 && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
          idx++;
        }
        if (idx >= nPairs || hatchPairs[idx].code !== 93) continue;
        const numEdges = Math.min(parseInt(hatchPairs[idx].value, 10) || 0, 10000);
        idx++;

        for (let eIdx = 0; eIdx < numEdges && idx < nPairs; eIdx++) {
          while (idx < nPairs && hatchPairs[idx].code !== 72 && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
            idx++;
          }
          if (idx >= nPairs || hatchPairs[idx].code !== 72) break;
          const edgeType = parseInt(hatchPairs[idx].value, 10);
          idx++;

          if (edgeType === 1) {
            // Line edge: 10, 20, 11, 21
            let x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN;
            while (idx < nPairs && hatchPairs[idx].code !== 72 && hatchPairs[idx].code !== 97 && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
              const c = hatchPairs[idx].code;
              const v = hatchPairs[idx].value;
              if (c === 10) x1 = parseFloat(v);
              else if (c === 20) y1 = parseFloat(v);
              else if (c === 11) x2 = parseFloat(v);
              else if (c === 21) y2 = parseFloat(v);
              idx++;
            }
            if (isValidCoord(x1) && isValidCoord(y1) && isValidCoord(x2) && isValidCoord(y2)) {
              const p1 = ocsToWcs2D(x1, y1, 0, nx, ny, nz);
              const p2 = ocsToWcs2D(x2, y2, 0, nx, ny, nz);
              if (isSanePoint(p1) && isSanePoint(p2) && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 1e-6) {
                pushEntity(
                  targetList,
                  { id: `e_${idCounter++}`, type: 'LINE', layer, aci, start: p1, end: p2 },
                  countInLayer,
                  isPaper
                );
              }
            }
          } else if (edgeType === 2) {
            // Circular arc edge: 10, 20, 40 (radius), 50 (start deg), 51 (end deg), 73 (isCCW)
            let cx = NaN, cy = NaN, r = 0, sa = 0, ea = 360, ccw = true;
            while (idx < nPairs && hatchPairs[idx].code !== 72 && hatchPairs[idx].code !== 97 && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
              const c = hatchPairs[idx].code;
              const v = hatchPairs[idx].value;
              if (c === 10) cx = parseFloat(v);
              else if (c === 20) cy = parseFloat(v);
              else if (c === 40) r = parseFloat(v);
              else if (c === 50) sa = parseFloat(v) || 0;
              else if (c === 51) ea = parseFloat(v) || 0;
              else if (c === 73) ccw = parseInt(v, 10) !== 0;
              idx++;
            }
            if (isValidCoord(cx) && isValidCoord(cy) && r > 0 && r <= MAX_COORD_LIMIT) {
              const center = ocsToWcs2D(cx, cy, 0, nx, ny, nz);
              if (isSanePoint(center)) {
                let startAngle = sa;
                let endAngle = ea;
                if (!ccw) {
                  startAngle = 360 - ea;
                  endAngle = 360 - sa;
                }
                if (nz < 0) {
                  const tmp = 180 - endAngle;
                  endAngle = 180 - startAngle;
                  startAngle = tmp;
                }
                if (Math.abs(endAngle - startAngle) >= 359.99) {
                  pushEntity(
                    targetList,
                    { id: `e_${idCounter++}`, type: 'CIRCLE', layer, aci, center, radius: r },
                    countInLayer,
                    isPaper
                  );
                } else {
                  pushEntity(
                    targetList,
                    {
                      id: `e_${idCounter++}`,
                      type: 'ARC',
                      layer,
                      aci,
                      center,
                      radius: r,
                      startAngle,
                      endAngle,
                    },
                    countInLayer,
                    isPaper
                  );
                }
              }
            }
          } else {
            // Skip elliptic (3) or spline (4) edge fields until next 72 / 97 / 92 / 75
            const polyPts: Vertex2D[] = [];
            let curX: number | null = null;
            while (idx < nPairs && hatchPairs[idx].code !== 72 && hatchPairs[idx].code !== 97 && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
              const c = hatchPairs[idx].code;
              const v = hatchPairs[idx].value;
              if (c === 10) curX = parseFloat(v);
              else if (c === 20 && curX !== null) {
                const curY = parseFloat(v);
                if (isValidCoord(curX) && isValidCoord(curY)) {
                  const p = ocsToWcs2D(curX, curY, 0, nx, ny, nz);
                  if (isSanePoint(p)) polyPts.push(p);
                }
                curX = null;
              }
              idx++;
            }
            if (polyPts.length >= 2) {
              pushEntity(
                targetList,
                { id: `e_${idCounter++}`, type: 'LWPOLYLINE', layer, aci, vertices: polyPts },
                countInLayer,
                isPaper
              );
            }
          }
        }
        while (idx < nPairs && hatchPairs[idx].code !== 92 && hatchPairs[idx].code !== 75) {
          idx++;
        }
      }
    }
  }

  function parseEntity(
    entType: string,
    targetList: CadEntity[],
    countInLayer: boolean
  ) {
    if (entType === 'HATCH') {
      parseHatchEntity(targetList, countInLayer);
      return;
    }

    let layer = '0';
    let aci: number | null = null;
    let linetype = 'CONTINUOUS';
    let lineweight: number | undefined;
    let isPaper = false;
    let isInvisible = false;

    let x1 = NaN, y1 = NaN, z1 = 0;
    let x2 = NaN, y2 = NaN, z2 = 0;
    let r = 0, sa = 0, ea = 0, rot = 0;
    let sx = 1, sy = 1, sz = 1;
    let rowCount = 1, columnCount = 1, rowSpacing = 0, columnSpacing = 0;
    let nx = 0, ny = 0, nz = 1;
    let str = '', bName = '';
    let closed = false;
    let polyFlag = 0;
    let meshM = 0, meshN = 0;
    let splineDeg = 3;
    let hAlign = 0;
    let attachPt = 1;
    let hasAlignPt = false;
    let alignX = 0, alignY = 0;

    // 4-corner support for SOLID / TRACE / 3DFACE
    const cornersX: [number, number, number, number] = [NaN, NaN, NaN, NaN];
    const cornersY: [number, number, number, number] = [NaN, NaN, NaN, NaN];

    // DIMENSION points
    let dimDefX = NaN, dimDefY = NaN;
    let dimMidX = NaN, dimMidY = NaN;
    let dimP1X = NaN, dimP1Y = NaN;
    let dimP2X = NaN, dimP2Y = NaN;

    const verts: Vertex2D[] = [];
    const fitPts: Point2D[] = [];
    const ctrlPts: Point2D[] = [];
    const knots: number[] = [];
    const weights: number[] = [];
    let curV: Vertex2D | null = null;
    let curFit: Point2D | null = null;
    let curCtrl: Point2D | null = null;

    while (!cursor.done && cursor.code !== 0) {
      const c = cursor.code;
      const v = cursor.value;

      if (c === 8) layer = cleanCadText(v) || '0';
      else if (c === 62) aci = parseInt(v, 10);
      else if (c === 6) linetype = v.toUpperCase();
      else if (c === 370) lineweight = parseInt(v, 10);
      else if (c === 67) isPaper = parseInt(v, 10) === 1;
      else if (c === 60) isInvisible = parseInt(v, 10) === 1;
      else if (c === 210) nx = parseFloat(v) || 0;
      else if (c === 220) ny = parseFloat(v) || 0;
      else if (c === 230) nz = parseFloat(v) || 1;
      else if (entType === 'LWPOLYLINE' || entType === 'LEADER' || entType === 'MLINE') {
        if (c === 10 || (entType === 'MLINE' && c === 11)) {
          curV = { x: parseFloat(v), y: 0 };
          verts.push(curV);
        } else if ((c === 20 || (entType === 'MLINE' && c === 21)) && curV) {
          curV.y = parseFloat(v);
        } else if (c === 42 && curV) {
          curV.bulge = parseFloat(v);
        } else if (c === 70) {
          polyFlag = parseInt(v, 10);
          closed = (polyFlag & 1) === 1;
        } else if (c === 71 && entType === 'MLINE') {
          polyFlag = parseInt(v, 10);
          closed = (polyFlag & 2) !== 0;
        }
      } else if (entType === 'SPLINE') {
        if (c === 70) {
          polyFlag = parseInt(v, 10);
          closed = (polyFlag & 1) === 1;
        } else if (c === 71) {
          splineDeg = parseInt(v, 10) || 3;
        } else if (c === 40) {
          knots.push(parseFloat(v));
        } else if (c === 41) {
          weights.push(parseFloat(v));
        } else if (c === 10) {
          curCtrl = { x: parseFloat(v), y: 0 };
          ctrlPts.push(curCtrl);
        } else if (c === 20 && curCtrl) {
          curCtrl.y = parseFloat(v);
        } else if (c === 11) {
          curFit = { x: parseFloat(v), y: 0 };
          fitPts.push(curFit);
        } else if (c === 21 && curFit) {
          curFit.y = parseFloat(v);
        }
      } else if (entType === 'SOLID' || entType === 'TRACE' || entType === '3DFACE') {
        if (c >= 10 && c <= 13) cornersX[c - 10] = parseFloat(v);
        else if (c >= 20 && c <= 23) cornersY[c - 20] = parseFloat(v);
        else if (c === 70) polyFlag = parseInt(v, 10) || 0;
      } else if (entType === 'DIMENSION') {
        if (c === 2) bName = cleanCadText(v);
        else if (c === 1) str = cleanCadText(v);
        else if (c === 10) dimDefX = parseFloat(v);
        else if (c === 20) dimDefY = parseFloat(v);
        else if (c === 11) dimMidX = parseFloat(v);
        else if (c === 21) dimMidY = parseFloat(v);
        else if (c === 13) dimP1X = parseFloat(v);
        else if (c === 23) dimP1Y = parseFloat(v);
        else if (c === 14) dimP2X = parseFloat(v);
        else if (c === 24) dimP2Y = parseFloat(v);
        else if (c === 42 && !str) {
          const meas = parseFloat(v);
          if (Number.isFinite(meas) && meas > 0) {
            str = Number.isInteger(meas) ? String(meas) : meas.toFixed(1).replace(/\.0$/, '');
          }
        }
      } else if (entType === 'MLEADER' || entType === 'MULTILEADER') {
        if (c === 10) {
          curV = { x: parseFloat(v), y: 0 };
          verts.push(curV);
        } else if (c === 20 && curV) {
          curV.y = parseFloat(v);
        } else if (c === 304 || c === 1) {
          const cleaned = cleanCadText(v);
          if (cleaned) str += (str ? '\n' : '') + cleaned;
        } else if (c === 40 && r === 0) {
          r = parseFloat(v) || 0;
        }
      } else {
        if (c === 10) x1 = parseFloat(v);
        else if (c === 20) y1 = parseFloat(v);
        else if (c === 30) z1 = parseFloat(v) || 0;
        else if (c === 11) {
          const val = parseFloat(v);
          if (entType === 'TEXT' || entType === 'ATTRIB' || entType === 'ATTDEF') {
            alignX = val;
            hasAlignPt = true;
          } else {
            x2 = val;
          }
        } else if (c === 21) {
          const val = parseFloat(v);
          if (entType === 'TEXT' || entType === 'ATTRIB' || entType === 'ATTDEF') {
            alignY = val;
          } else {
            y2 = val;
          }
        } else if (c === 31) z2 = parseFloat(v) || 0;
        else if (c === 40) r = parseFloat(v);
        else if (c === 41) sx = parseFloat(v);
        else if (c === 42) sy = parseFloat(v);
        else if (c === 43) sz = parseFloat(v);
        else if (c === 44) columnSpacing = parseFloat(v) || 0;
        else if (c === 45) rowSpacing = parseFloat(v) || 0;
        else if (c === 50) {
          const val = parseFloat(v);
          sa = val;
          rot = val;
        } else if (c === 51) ea = parseFloat(v);
        else if (c === 1 || c === 3) str += v;
        else if (c === 2) bName = cleanCadText(v);
        else if (c === 70) {
          polyFlag = parseInt(v, 10);
          closed = (polyFlag & 1) === 1;
          if (entType === 'INSERT') columnCount = Math.max(1, polyFlag || 1);
        } else if (c === 71) {
          const val = parseInt(v, 10);
          if (entType === 'MTEXT') attachPt = val;
          else if (entType === 'INSERT') rowCount = Math.max(1, val || 1);
          else if (entType === 'POLYLINE') meshM = val;
        } else if (c === 72) {
          const val = parseInt(v, 10);
          if (entType === 'POLYLINE') meshN = val;
          else hAlign = val;
        }
      }
      cursor.advance();
    }

    // Legacy POLYLINE (2D, 3D, Polygon Mesh, or Polyface Mesh)
    if (entType === 'POLYLINE') {
      const isPolyfaceMesh = (polyFlag & 64) !== 0;
      const isPolygonMesh = (polyFlag & 16) !== 0;
      const is3DPolyline = (polyFlag & 8) !== 0;

      const meshCoords: Point2D[] = [];
      const faceRecords: Array<[number, number, number, number]> = [];

      while (!cursor.done) {
        if (cursor.code === 0 && cursor.value === 'SEQEND') {
          cursor.advance();
          while (!cursor.done && cursor.code !== 0) cursor.advance();
          break;
        }
        if (cursor.code === 0 && cursor.value === 'VERTEX') {
          cursor.advance();
          let vx = NaN, vy = NaN, vz = 0, vBulge = 0, vtxFlag = 0;
          let f1 = 0, f2 = 0, f3 = 0, f4 = 0;
          while (!cursor.done && cursor.code !== 0) {
            const vc = cursor.code;
            const vv = cursor.value;
            if (vc === 10) vx = parseFloat(vv);
            else if (vc === 20) vy = parseFloat(vv);
            else if (vc === 30) vz = parseFloat(vv) || 0;
            else if (vc === 42) vBulge = parseFloat(vv) || 0;
            else if (vc === 70) vtxFlag = parseInt(vv, 10) || 0;
            else if (vc === 71) f1 = parseInt(vv, 10) || 0;
            else if (vc === 72) f2 = parseInt(vv, 10) || 0;
            else if (vc === 73) f3 = parseInt(vv, 10) || 0;
            else if (vc === 74) f4 = parseInt(vv, 10) || 0;
            cursor.advance();
          }

          if (isPolyfaceMesh) {
            // In DXF Polyface Mesh:
            // - Coordinate vertices have bit 64 set (typically 128 | 64 = 192)
            // - Face records have bit 128 set and bit 64 CLEAR (128), with vertex indices in 71..74
            if ((vtxFlag & 64) !== 0) {
              if (isValidCoord(vx) && isValidCoord(vy)) {
                meshCoords.push({ x: vx, y: vy });
              } else {
                meshCoords.push({ x: NaN, y: NaN });
              }
            } else if ((vtxFlag & 128) !== 0 || f1 !== 0 || f2 !== 0 || f3 !== 0) {
              faceRecords.push([f1, f2, f3, f4]);
            }
          } else {
            // Skip spline frame control points (flag & 16)
            const isSplineControlPoint = (vtxFlag & 16) !== 0;
            if (!isSplineControlPoint && isValidCoord(vx) && isValidCoord(vy)) {
              const p = is3DPolyline || isPolygonMesh ? { x: vx, y: vy } : ocsToWcs2D(vx, vy, vz, nx, ny, nz);
              if (isSanePoint(p)) {
                const flip = !is3DPolyline && nz < 0 ? -1 : 1;
                verts.push({ x: p.x, y: p.y, bulge: vBulge * flip });
              }
            }
          }
        } else if (cursor.code === 0) {
          break;
        } else {
          cursor.advance();
        }
      }

      if (isInvisible || (aci !== null && aci < 0)) return;

      if (isPolyfaceMesh) {
        if (faceRecords.length > 0 && meshCoords.length > 0) {
          const emittedEdges = new Set<string>();
          for (const face of faceRecords) {
            const count = face[3] !== 0 ? 4 : 3;
            for (let i = 0; i < count; i++) {
              const rawIdxA = face[i];
              const rawIdxB = face[(i + 1) % count];
              // Negative vertex index in DXF Polyface Mesh means the edge starting at this vertex is invisible
              if (rawIdxA <= 0 || rawIdxB === 0) continue;
              const idxA = Math.abs(rawIdxA) - 1;
              const idxB = Math.abs(rawIdxB) - 1;
              if (idxA < 0 || idxA >= meshCoords.length || idxB < 0 || idxB >= meshCoords.length || idxA === idxB) {
                continue;
              }
              const pA = meshCoords[idxA];
              const pB = meshCoords[idxB];
              if (!isSanePoint(pA) || !isSanePoint(pB)) continue;
              const edgeKey = idxA < idxB ? `${idxA}_${idxB}` : `${idxB}_${idxA}`;
              if (emittedEdges.has(edgeKey)) continue;
              emittedEdges.add(edgeKey);
              pushEntity(
                targetList,
                { id: `e_${idCounter++}`, type: 'LINE', layer, aci, linetype, lineweight, start: pA, end: pB },
                countInLayer,
                isPaper
              );
            }
          }
        }
        return;
      }

      if (isPolygonMesh && meshM > 1 && meshN > 1 && verts.length >= meshM * meshN) {
        const closeM = (polyFlag & 1) !== 0;
        const closeN = (polyFlag & 32) !== 0;
        for (let m = 0; m < meshM; m++) {
          const rowVerts: Vertex2D[] = [];
          for (let n = 0; n < meshN; n++) {
            rowVerts.push(verts[m * meshN + n]);
          }
          pushEntity(
            targetList,
            { id: `e_${idCounter++}`, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: rowVerts, closed: closeN },
            countInLayer,
            isPaper
          );
        }
        for (let n = 0; n < meshN; n++) {
          const colVerts: Vertex2D[] = [];
          for (let m = 0; m < meshM; m++) {
            colVerts.push(verts[m * meshN + n]);
          }
          pushEntity(
            targetList,
            { id: `e_${idCounter++}`, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: colVerts, closed: closeM },
            countInLayer,
            isPaper
          );
        }
        return;
      }

      if (verts.length >= 2) {
        pushEntity(
          targetList,
          { id: `e_${idCounter++}`, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: verts, closed },
          countInLayer,
          isPaper
        );
      }
      return;
    }

    if (isInvisible || (aci !== null && aci < 0)) return;
    if (entType === 'ATTDEF') return;

    const id = `e_${idCounter++}`;

    if (entType === 'LINE') {
      if (!isValidCoord(x1) || !isValidCoord(y1) || !isValidCoord(x2) || !isValidCoord(y2)) return;
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return;
      pushEntity(
        targetList,
        { id, type: 'LINE', layer, aci, linetype, lineweight, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
        countInLayer,
        isPaper
      );
    } else if (entType === 'LWPOLYLINE' || entType === 'LEADER' || entType === 'MLINE') {
      const validVerts: Vertex2D[] = [];
      for (const v of verts) {
        if (isValidCoord(v.x) && isValidCoord(v.y)) {
          const p = entType === 'LWPOLYLINE' ? ocsToWcs2D(v.x, v.y, z1, nx, ny, nz) : { x: v.x, y: v.y };
          if (isSanePoint(p)) {
            const flip = entType === 'LWPOLYLINE' && nz < 0 ? -1 : 1;
            validVerts.push({ x: p.x, y: p.y, bulge: v.bulge ? v.bulge * flip : undefined });
          }
        }
      }
      if (validVerts.length >= 2) {
        pushEntity(
          targetList,
          {
            id,
            type: 'LWPOLYLINE',
            layer,
            aci,
            linetype,
            lineweight,
            vertices: validVerts,
            closed: entType === 'LEADER' ? false : closed,
          },
          countInLayer,
          isPaper
        );
      }
    } else if (entType === 'SOLID' || entType === 'TRACE' || entType === '3DFACE') {
      const cPts: Point2D[] = [];
      for (let i = 0; i < 4; i++) {
        if (isValidCoord(cornersX[i]) && isValidCoord(cornersY[i])) {
          const p = entType === '3DFACE'
            ? { x: cornersX[i], y: cornersY[i] }
            : ocsToWcs2D(cornersX[i], cornersY[i], z1, nx, ny, nz);
          if (isSanePoint(p)) cPts.push(p);
        }
      }
      if (cPts.length >= 3) {
        // SOLID and TRACE swap vertices 3 and 4 (indices 2 and 3); 3DFACE uses perimeter order 0-1-2-3
        const ordered =
          entType !== '3DFACE' && cPts.length === 4
            ? [cPts[0], cPts[1], cPts[3], cPts[2]]
            : cPts;
        // Dedup consecutive identical points (e.g. 3-point triangle where corner 3 == corner 4)
        const deduped: Vertex2D[] = [];
        for (const pt of ordered) {
          const prev = deduped[deduped.length - 1];
          if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 1e-6) {
            deduped.push({ x: pt.x, y: pt.y });
          }
        }
        if (deduped.length >= 3) {
          pushEntity(
            targetList,
            { id, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: deduped, closed: true },
            countInLayer,
            isPaper
          );
        }
      }
    } else if (entType === 'SPLINE') {
      const validFit = fitPts.filter(isSanePoint);
      const validCtrl = ctrlPts.filter(isSanePoint);
      let pts: Point2D[] = [];
      if (validCtrl.length >= 2) {
        const samples = Math.min(128, Math.max(32, validCtrl.length * 8));
        pts = evaluateBSpline(splineDeg, validCtrl, knots, weights.length === validCtrl.length ? weights : undefined, samples);
      } else if (validFit.length >= 2) {
        pts = validFit;
      }
      if (pts.length >= 2) {
        pushEntity(
          targetList,
          { id, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: pts, closed },
          countInLayer,
          isPaper
        );
      }
    } else if (entType === 'CIRCLE') {
      if (!isValidCoord(x1) || !isValidCoord(y1) || !(r > 0 && r <= MAX_COORD_LIMIT)) return;
      const center = ocsToWcs2D(x1, y1, z1, nx, ny, nz);
      if (isSanePoint(center)) {
        pushEntity(
          targetList,
          { id, type: 'CIRCLE', layer, aci, linetype, lineweight, center, radius: r },
          countInLayer,
          isPaper
        );
      }
    } else if (entType === 'ARC') {
      if (!isValidCoord(x1) || !isValidCoord(y1) || !(r > 0 && r <= MAX_COORD_LIMIT)) return;
      const center = ocsToWcs2D(x1, y1, z1, nx, ny, nz);
      if (isSanePoint(center)) {
        let startAngle = sa;
        let endAngle = ea;
        if (nz < 0) {
          startAngle = 180 - ea;
          endAngle = 180 - sa;
        }
        pushEntity(
          targetList,
          { id, type: 'ARC', layer, aci, linetype, lineweight, center, radius: r, startAngle, endAngle },
          countInLayer,
          isPaper
        );
      }
    } else if (entType === 'ELLIPSE') {
      if (!isValidCoord(x1) || !isValidCoord(y1) || !isValidCoord(x2) || !isValidCoord(y2) || !(r > 0)) return;
      const isFullEllipse = Math.abs(ea - sa) >= Math.PI * 2 - 1e-3 || (sa === 0 && ea === 0);
      if (isFullEllipse && nz >= 0) {
        pushEntity(
          targetList,
          {
            id,
            type: 'ELLIPSE',
            layer,
            aci,
            linetype,
            lineweight,
            center: { x: x1, y: y1 },
            majorAxis: { x: x2, y: y2 },
            axisRatio: r,
          },
          countInLayer,
          isPaper
        );
      } else {
        // Tessellate partial elliptical arc or mirrored ellipse into polyline
        const majorR = Math.hypot(x2, y2);
        const minorR = majorR * r;
        const rotRad = Math.atan2(y2, x2);
        const cosRot = Math.cos(rotRad);
        const sinRot = Math.sin(rotRad);
        let t0 = sa;
        let t1 = ea;
        if (t1 <= t0) t1 += Math.PI * 2;
        const steps = 36;
        const eVerts: Vertex2D[] = [];
        const flipY = nz < 0 ? -1 : 1;
        for (let i = 0; i <= steps; i++) {
          const t = t0 + (t1 - t0) * (i / steps);
          const lx = majorR * Math.cos(t);
          const ly = minorR * Math.sin(t) * flipY;
          eVerts.push({
            x: x1 + lx * cosRot - ly * sinRot,
            y: y1 + lx * sinRot + ly * cosRot,
          });
        }
        pushEntity(
          targetList,
          { id, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: eVerts, closed: false },
          countInLayer,
          isPaper
        );
      }
    } else if (entType === 'TEXT' || entType === 'MTEXT' || entType === 'ATTRIB') {
      const cleaned = cleanCadText(str);
      if (cleaned && isValidCoord(x1) && isValidCoord(y1)) {
        let tx = x1;
        let ty = y1;
        let align: CanvasTextAlign = 'left';

        if (entType === 'TEXT' || entType === 'ATTRIB') {
          if (hAlign > 0 && hasAlignPt && (Math.abs(alignX) > 1e-6 || Math.abs(alignY) > 1e-6)) {
            tx = alignX;
            ty = alignY;
          }
          if (hAlign === 1 || hAlign === 4) align = 'center';
          else if (hAlign === 2) align = 'right';
          const p = ocsToWcs2D(tx, ty, z1, nx, ny, nz);
          tx = p.x;
          ty = p.y;
        } else if (entType === 'MTEXT') {
          if (attachPt === 2 || attachPt === 5 || attachPt === 8) align = 'center';
          else if (attachPt === 3 || attachPt === 6 || attachPt === 9) align = 'right';
          // MTEXT direction vector in 11, 21 overrides rotation 50
          if (isValidCoord(x2) && isValidCoord(y2) && (Math.abs(x2) > 1e-6 || Math.abs(y2) > 1e-6)) {
            rot = Math.atan2(y2, x2) / DEG2RAD;
          } else if (Math.abs(rot) > 0 && Math.abs(rot) <= Math.PI * 2 + 1e-4) {
            // MTEXT code 50 in DXF can be in radians in some exporters
            rot = rot;
          }
        }

        if (isSanePoint({ x: tx, y: ty })) {
          pushEntity(
            targetList,
            {
              id,
              type: 'TEXT',
              layer,
              aci,
              position: { x: tx, y: ty },
              height: r > 0 ? r : 2.5,
              rotation: rot,
              text: cleaned,
              align,
              isMtext: entType === 'MTEXT',
            },
            countInLayer,
            isPaper
          );
        }
      }
    } else if (entType === 'MLEADER' || entType === 'MULTILEADER') {
      const validVerts = verts.filter(isSanePoint);
      if (validVerts.length >= 2) {
        pushEntity(
          targetList,
          { id, type: 'LWPOLYLINE', layer, aci, linetype, lineweight, vertices: validVerts, closed: false },
          countInLayer,
          isPaper
        );
      }
      if (str && validVerts.length >= 1) {
        const lastPt = validVerts[validVerts.length - 1];
        pushEntity(
          targetList,
          {
            id: `e_${idCounter++}`,
            type: 'TEXT',
            layer,
            aci,
            position: { x: lastPt.x, y: lastPt.y },
            height: r > 0 ? r : 2.5,
            text: str,
            isMtext: true,
          },
          countInLayer,
          isPaper
        );
      }
    } else if (entType === 'DIMENSION') {
      if (bName) {
        // Note: In DXF, anonymous dimension blocks (*D1, *D2...) contain pre-computed WCS geometry at (0,0)
        pushEntity(
          targetList,
          {
            id,
            type: 'INSERT',
            layer,
            aci,
            blockName: bName,
            position: { x: 0, y: 0 },
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
          },
          countInLayer,
          isPaper
        );
      } else {
        // Fallback when DIMENSION has no anonymous block reference
        if (isValidCoord(dimP1X) && isValidCoord(dimP1Y) && isValidCoord(dimP2X) && isValidCoord(dimP2Y)) {
          pushEntity(
            targetList,
            {
              id,
              type: 'LINE',
              layer,
              aci,
              linetype,
              lineweight,
              start: { x: dimP1X, y: dimP1Y },
              end: { x: dimP2X, y: dimP2Y },
            },
            countInLayer,
            isPaper
          );
        }
        if (str && isValidCoord(dimMidX) && isValidCoord(dimMidY)) {
          pushEntity(
            targetList,
            {
              id: `e_${idCounter++}`,
              type: 'TEXT',
              layer,
              aci,
              position: { x: dimMidX, y: dimMidY },
              height: 2.5,
              text: str,
              align: 'center',
            },
            countInLayer,
            isPaper
          );
        } else if (str && isValidCoord(dimDefX) && isValidCoord(dimDefY)) {
          pushEntity(
            targetList,
            {
              id: `e_${idCounter++}`,
              type: 'TEXT',
              layer,
              aci,
              position: { x: dimDefX, y: dimDefY },
              height: 2.5,
              text: str,
              align: 'center',
            },
            countInLayer,
            isPaper
          );
        }
      }
    } else if (entType === 'INSERT') {
      if (bName && isValidCoord(x1) && isValidCoord(y1)) {
        const insPos = ocsToWcs2D(x1, y1, z1, nx, ny, nz);
        if (isSanePoint(insPos)) {
          const finalSx = nz < 0 ? -sx : sx;
          const finalRot = nz < 0 ? -rot : rot;
          pushEntity(
            targetList,
            {
              id,
              type: 'INSERT',
              layer,
              aci,
              blockName: bName,
              position: insPos,
              scaleX: finalSx,
              scaleY: sy,
              rotation: finalRot,
              rowCount: rowCount > 1 ? rowCount : undefined,
              columnCount: columnCount > 1 ? columnCount : undefined,
              rowSpacing: rowSpacing !== 0 ? rowSpacing : undefined,
              columnSpacing: columnSpacing !== 0 ? columnSpacing : undefined,
            },
            countInLayer,
            isPaper
          );
        }
      }
    }
  }

  let section = '';
  let inLayerTable = false;

  while (!cursor.done) {
    if (curCode() === 0 && curVal() === 'SECTION') {
      cursor.advance();
      if (!cursor.done && curCode() === 2) {
        section = curVal().toUpperCase();
        cursor.advance();
      }
      // Fast-skip sections that don't affect 2D geometry rendering
      if (
        section === 'HEADER' ||
        section === 'CLASSES' ||
        section === 'OBJECTS' ||
        section === 'THUMBNAILIMAGE' ||
        section === 'ACDSDATA'
      ) {
        while (!cursor.done && !(curCode() === 0 && curVal() === 'ENDSEC')) {
          cursor.advance();
        }
        if (!cursor.done) cursor.advance();
        section = '';
      }
      continue;
    }

    if (curCode() === 0 && curVal() === 'ENDSEC') {
      section = '';
      inLayerTable = false;
      cursor.advance();
      continue;
    }

    if (section === 'TABLES') {
      if (curCode() === 0 && curVal() === 'TABLE') {
        cursor.advance();
        if (!cursor.done && curCode() === 2) {
          inLayerTable = curVal().toUpperCase() === 'LAYER';
          cursor.advance();
        }
        continue;
      }
      if (curCode() === 0 && curVal() === 'ENDTAB') {
        inLayerTable = false;
        cursor.advance();
        continue;
      }
      if (inLayerTable && curCode() === 0 && curVal() === 'LAYER') {
        cursor.advance();
        let lName = '0';
        let col = 7;
        let trueColor: number | null = null;
        let layerFlags = 0;
        let isPlot = true;

        while (!cursor.done && curCode() !== 0) {
          if (curCode() === 2) lName = cleanCadText(curVal()) || '0';
          else if (curCode() === 62) col = parseInt(curVal(), 10);
          else if (curCode() === 420) trueColor = parseInt(curVal(), 10);
          else if (curCode() === 70) layerFlags = parseInt(curVal(), 10) || 0;
          else if (curCode() === 290) isPlot = parseInt(curVal(), 10) !== 0;
          cursor.advance();
        }

        const isFrozen = (layerFlags & 1) !== 0;
        const isOff = col < 0;
        const isXref = /^xref/i.test(lName);
        const isDefpoints = lName.toLowerCase() === 'defpoints';
        const effectiveColorVal = trueColor !== null ? trueColor : Math.abs(col);

        layers[lName] = {
          name: lName,
          aci: Math.abs(col),
          color: resolveCadColorValue(effectiveColorVal, theme),
          visible: !isOff && !isFrozen && !isXref && !isDefpoints,
          frozen: isFrozen,
          isPlot,
          count: layers[lName]?.count || 0,
        };
        continue;
      }
      cursor.advance();
    } else if (section === 'BLOCKS') {
      if (curCode() === 0 && curVal() === 'BLOCK') {
        cursor.advance();
        let bName = '';
        let bx = 0, by = 0;
        while (!cursor.done && curCode() !== 0) {
          if (curCode() === 2 || curCode() === 3) {
            if (!bName) bName = cleanCadText(curVal());
          } else if (curCode() === 10) bx = parseFloat(curVal()) || 0;
          else if (curCode() === 20) by = parseFloat(curVal()) || 0;
          cursor.advance();
        }
        const bEntities: CadEntity[] = [];
        // Resilient block loop: also stops if an unterminated block hits another BLOCK, ENDSEC, or SECTION
        while (
          !cursor.done &&
          !(
            curCode() === 0 &&
            (curVal() === 'ENDBLK' ||
              curVal() === 'BLOCK' ||
              curVal() === 'ENDSEC' ||
              curVal() === 'SECTION')
          )
        ) {
          if (curCode() === 0) {
            const eType = curVal();
            cursor.advance();
            parseEntity(eType, bEntities, false);
          } else {
            cursor.advance();
          }
        }
        if (!cursor.done && curCode() === 0 && curVal() === 'ENDBLK') {
          cursor.advance();
          while (!cursor.done && curCode() !== 0) cursor.advance();
        }
        if (bName) {
          blocks[bName] = {
            name: bName,
            basePoint: { x: bx, y: by },
            entities: bEntities,
          };
        }
      } else {
        cursor.advance();
      }
    } else if (section === 'ENTITIES') {
      if (curCode() === 0) {
        const eType = curVal();
        cursor.advance();
        parseEntity(eType, entities, true);
      } else {
        cursor.advance();
      }
    } else {
      cursor.advance();
    }
  }

  // Fallback to Paper Space entities if Model Space has no entities
  if (entities.length === 0 && paperEntities.length > 0) {
    for (const pe of paperEntities) {
      entities.push(pe);
      ensureLayer(pe.layer);
      layers[pe.layer].count++;
    }
  }

  // Fallback to *Model_Space block if ENTITIES section was empty
  if (entities.length === 0) {
    for (const [bName, blk] of Object.entries(blocks)) {
      if (bName.toUpperCase().startsWith('*MODEL_SPACE') && blk.entities.length > 0) {
        for (const be of blk.entities) {
          entities.push(be);
          ensureLayer(be.layer);
          layers[be.layer].count++;
        }
      }
    }
  }

  return {
    fileName,
    formatVersion: 'DXF (Direct Vector)',
    layers,
    blocks,
    entities,
  };
}
