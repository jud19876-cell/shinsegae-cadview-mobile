/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArcEntity, CircleEntity, DrawingModel, LineEntity, PolylineEntity, TextEntity } from '../types/cad';

export function createSampleArch(): DrawingModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities: any[] = [];
  let id = 1;

  const layers = {
    'A-WALL': { name: 'A-WALL (벽체)', aci: 7, color: '#0f172a', visible: true, count: 0 },
    'A-DOOR': { name: 'A-DOOR (창호)', aci: 4, color: '#0369a1', visible: true, count: 0 },
    'A-FURN': { name: 'A-FURN (가구/설비)', aci: 3, color: '#15803d', visible: true, count: 0 },
    'A-GRID': { name: 'A-GRID (중심선)', aci: 1, color: '#dc2626', visible: true, count: 0 },
    'A-DIM': { name: 'A-DIM (치수선)', aci: 2, color: '#b45309', visible: true, count: 0 },
    'A-TEXT': { name: 'A-TEXT (실명)', aci: 6, color: '#a21caf', visible: true, count: 0 },
  };

  // Outer boundary
  const wall1: PolylineEntity = {
    id: `E${id++}`,
    type: 'LWPOLYLINE',
    layer: 'A-WALL',
    lineweight: 2.2,
    closed: true,
    vertices: [
      { x: 0, y: 0 },
      { x: 18000, y: 0 },
      { x: 18000, y: 10000 },
      { x: 0, y: 10000 },
    ],
  };
  entities.push(wall1);

  // Inner perimeter wall (200mm thick)
  const wall2: PolylineEntity = {
    id: `E${id++}`,
    type: 'LWPOLYLINE',
    layer: 'A-WALL',
    lineweight: 1.5,
    closed: true,
    vertices: [
      { x: 200, y: 200 },
      { x: 17800, y: 200 },
      { x: 17800, y: 9800 },
      { x: 200, y: 9800 },
    ],
  };
  entities.push(wall2);

  // Internal partition walls
  const wallLines: LineEntity[] = [
    { id: `E${id++}`, type: 'LINE', layer: 'A-WALL', lineweight: 1.8, start: { x: 200, y: 5000 }, end: { x: 17800, y: 5000 } },
    { id: `E${id++}`, type: 'LINE', layer: 'A-WALL', lineweight: 1.8, start: { x: 6000, y: 5000 }, end: { x: 6000, y: 9800 } },
    { id: `E${id++}`, type: 'LINE', layer: 'A-WALL', lineweight: 1.8, start: { x: 12000, y: 200 }, end: { x: 12000, y: 9800 } },
  ];
  entities.push(...wallLines);

  // Doors with swing arcs
  const doors = [
    [1200, 5000],
    [7200, 5000],
    [13200, 5000],
  ];
  doors.forEach(([dx, dy]) => {
    const doorLine: LineEntity = {
      id: `E${id++}`,
      type: 'LINE',
      layer: 'A-DOOR',
      start: { x: dx, y: dy },
      end: { x: dx, y: dy + 900 },
    };
    const doorArc: ArcEntity = {
      id: `E${id++}`,
      type: 'ARC',
      layer: 'A-DOOR',
      center: { x: dx, y: dy },
      radius: 900,
      startAngle: 0,
      endAngle: 90,
    };
    entities.push(doorLine, doorArc);
  });

  // Conference Table in Room 101
  const table: PolylineEntity = {
    id: `E${id++}`,
    type: 'LWPOLYLINE',
    layer: 'A-FURN',
    closed: true,
    vertices: [
      { x: 1600, y: 6800 },
      { x: 4600, y: 6800 },
      { x: 4600, y: 8400 },
      { x: 1600, y: 8400 },
    ],
  };
  entities.push(table);

  // Conference Chairs
  [2000, 2750, 3500, 4200].forEach((cx) => {
    const chairTop: CircleEntity = {
      id: `E${id++}`,
      type: 'CIRCLE',
      layer: 'A-FURN',
      center: { x: cx, y: 6500 },
      radius: 180,
    };
    const chairBottom: CircleEntity = {
      id: `E${id++}`,
      type: 'CIRCLE',
      layer: 'A-FURN',
      center: { x: cx, y: 8700 },
      radius: 180,
    };
    entities.push(chairTop, chairBottom);
  });

  // Korean Room Labels
  const roomTexts: TextEntity[] = [
    { id: `E${id++}`, type: 'TEXT', layer: 'A-TEXT', position: { x: 3000, y: 6000 }, height: 260, text: '101 대회의실 (30.0m²)', align: 'center' },
    { id: `E${id++}`, type: 'TEXT', layer: 'A-TEXT', position: { x: 9000, y: 7400 }, height: 260, text: '102 기술연구소 (R&D)', align: 'center' },
    { id: `E${id++}`, type: 'TEXT', layer: 'A-TEXT', position: { x: 15000, y: 7400 }, height: 260, text: '103 전산/서버실', align: 'center' },
    { id: `E${id++}`, type: 'TEXT', layer: 'A-TEXT', position: { x: 6000, y: 2600 }, height: 280, text: '104 메인 오픈 스튜디오 로비', align: 'center' },
    { id: `E${id++}`, type: 'TEXT', layer: 'A-TEXT', position: { x: 15000, y: 2600 }, height: 260, text: '105 CAD 도면설계실', align: 'center' },
  ];
  entities.push(...roomTexts);

  // Exterior Dimension line
  const dimLine: LineEntity = {
    id: `E${id++}`,
    type: 'LINE',
    layer: 'A-DIM',
    start: { x: 0, y: 10600 },
    end: { x: 18000, y: 10600 },
  };
  const dimText: TextEntity = {
    id: `E${id++}`,
    type: 'TEXT',
    layer: 'A-DIM',
    position: { x: 9000, y: 10800 },
    height: 240,
    text: '총 폭 18,000 mm (18.0 m)',
    align: 'center',
  };
  entities.push(dimLine, dimText);

  return {
    fileName: 'A-101_오피스_건축평면도.dwg',
    formatVersion: 'AutoCAD 2018',
    layers,
    blocks: {},
    entities,
  };
}

export function createSampleMech(): DrawingModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities: any[] = [];
  let id = 1;

  const layers = {
    'M-OUTLINE': { name: 'M-OUTLINE (외형선)', aci: 7, color: '#0f172a', visible: true, count: 0 },
    'M-CENTER': { name: 'M-CENTER (중심선)', aci: 1, color: '#dc2626', visible: true, count: 0 },
    'M-DIM': { name: 'M-DIM (치수/공차)', aci: 2, color: '#b45309', visible: true, count: 0 },
  };

  // Concentric flange circles
  [240, 180, 115, 65].forEach((r, idx) => {
    const circ: CircleEntity = {
      id: `M${id++}`,
      type: 'CIRCLE',
      layer: idx === 1 ? 'M-CENTER' : 'M-OUTLINE',
      linetype: idx === 1 ? 'CENTER' : 'CONTINUOUS',
      center: { x: 0, y: 0 },
      radius: r,
    };
    entities.push(circ);
  });

  // 8 Bolt holes on PCD 360 (radius 180)
  for (let i = 0; i < 8; i++) {
    const rad = (i * 45 * Math.PI) / 180;
    const hole: CircleEntity = {
      id: `M${id++}`,
      type: 'CIRCLE',
      layer: 'M-OUTLINE',
      center: { x: Math.cos(rad) * 180, y: Math.sin(rad) * 180 },
      radius: 18,
    };
    entities.push(hole);
  }

  // Cross centerlines
  const cl1: LineEntity = {
    id: `M${id++}`,
    type: 'LINE',
    layer: 'M-CENTER',
    linetype: 'CENTER',
    start: { x: -290, y: 0 },
    end: { x: 290, y: 0 },
  };
  const cl2: LineEntity = {
    id: `M${id++}`,
    type: 'LINE',
    layer: 'M-CENTER',
    linetype: 'CENTER',
    start: { x: 0, y: -290 },
    end: { x: 0, y: 290 },
  };
  entities.push(cl1, cl2);

  // Dimension & Specification Text
  const specText: TextEntity = {
    id: `M${id++}`,
    type: 'TEXT',
    layer: 'M-DIM',
    position: { x: 0, y: 280 },
    height: 18,
    text: 'Ø480 FLANGE / PCD Ø360 (8-Ø36 BOLT HOLES)',
    align: 'center',
  };
  entities.push(specText);

  return {
    fileName: 'M-204_터빈플랜지_정밀조립도.dwg',
    formatVersion: 'AutoCAD 2018',
    layers,
    blocks: {},
    entities,
  };
}
