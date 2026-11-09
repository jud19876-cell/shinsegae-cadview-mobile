/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type CadTheme = 'white' | 'dark' | 'blueprint';
export type AppThemePreference = 'system' | 'white' | 'dark' | 'blueprint';
export type ToolMode = 'pan' | 'select' | 'measure' | 'calibrate';

export interface Point2D {
  x: number;
  y: number;
}

export interface Vertex2D extends Point2D {
  bulge?: number;
}

export interface Extents2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LayerInfo {
  name: string;
  aci: number;
  color: string;
  visible: boolean;
  frozen?: boolean;
  isPlot?: boolean;
  count: number;
}

export interface CadEntityBase {
  id: string;
  type: string;
  layer: string;
  aci?: number | null;
  linetype?: string;
  lineweight?: number;
}

export interface LineEntity extends CadEntityBase {
  type: 'LINE';
  start: Point2D;
  end: Point2D;
}

export interface PolylineEntity extends CadEntityBase {
  type: 'LWPOLYLINE';
  vertices: Vertex2D[];
  closed?: boolean;
}

export interface CircleEntity extends CadEntityBase {
  type: 'CIRCLE';
  center: Point2D;
  radius: number;
}

export interface ArcEntity extends CadEntityBase {
  type: 'ARC';
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface EllipseEntity extends CadEntityBase {
  type: 'ELLIPSE';
  center: Point2D;
  majorAxis: Point2D;
  axisRatio: number;
  startAngle?: number;
  endAngle?: number;
}

export interface TextEntity extends CadEntityBase {
  type: 'TEXT';
  position: Point2D;
  height: number;
  scaleFactor?: number;
  rotation?: number;
  text: string;
  align?: CanvasTextAlign;
  isMtext?: boolean;
}

export interface InsertEntity extends CadEntityBase {
  type: 'INSERT';
  blockName: string;
  position: Point2D;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  rowCount?: number;
  columnCount?: number;
  rowSpacing?: number;
  columnSpacing?: number;
}

export interface RasterPreviewEntity extends CadEntityBase {
  type: 'RASTER_PREVIEW';
  img: HTMLImageElement;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type CadEntity =
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | TextEntity
  | InsertEntity
  | RasterPreviewEntity;

export interface CadBlock {
  name: string;
  basePoint: Point2D;
  entities: CadEntity[];
}

export interface DrawingModel {
  fileName: string;
  formatVersion: string;
  layers: Record<string, LayerInfo>;
  blocks: Record<string, CadBlock>;
  entities: CadEntity[];
  extents?: Extents2D;
}

export interface RenderBatch {
  layer: string;
  color: string;
  dashType: 'S' | 'D' | 'C'; // Solid, Dashed, Center
  lineCoords: Float64Array;
  polylines: PolylineEntity[];
  circles: CircleEntity[];
  arcs: ArcEntity[];
  ellipses: EllipseEntity[];
}

export interface MeasurementItem {
  id: string;
  p1: Point2D;
  p2: Point2D;
  label: string;
  distanceMm: number;
}

export interface SnapPoint {
  x: number;
  y: number;
  type: 'END' | 'MID' | 'CEN';
}
