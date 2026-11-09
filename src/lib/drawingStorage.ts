/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DrawingModel } from '../types/cad';

export interface RecentDrawingItem {
  id: string;
  fileName: string;
  formatVersion: string;
  entityCount: number;
  layerCount: number;
  lastOpenedAt: number; // ms timestamp
  thumbnail: string; // base64 JPEG
}

const STORAGE_KEY = 'cadview_recent_drawings_v2';
const DB_NAME = 'cadview_local_db_v2';
const DB_VERSION = 1;
const STORE_NAME = 'cached_drawings';

/**
 * Open or initialize IndexedDB for full DrawingModel storage
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Capture a lightweight thumbnail from a canvas element
 */
export function captureCanvasThumbnail(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number = 300,
  targetHeight: number = 190
): string | null {
  try {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = targetWidth;
    thumbCanvas.height = targetHeight;
    const tCtx = thumbCanvas.getContext('2d');
    if (!tCtx) return null;

    // Soft dark slate neutral background for thumbnail preview
    tCtx.fillStyle = '#0f172a';
    tCtx.fillRect(0, 0, targetWidth, targetHeight);

    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    if (srcW > 0 && srcH > 0) {
      const srcRatio = srcW / srcH;
      const targetRatio = targetWidth / targetHeight;
      let drawW = targetWidth;
      let drawH = targetHeight;
      let offX = 0;
      let offY = 0;

      if (srcRatio > targetRatio) {
        drawH = targetWidth / srcRatio;
        offY = (targetHeight - drawH) / 2;
      } else {
        drawW = targetHeight * srcRatio;
        offX = (targetWidth - drawW) / 2;
      }

      tCtx.drawImage(sourceCanvas, 0, 0, srcW, srcH, offX, offY, drawW, drawH);
    }

    return thumbCanvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    console.warn('Canvas thumbnail capture error:', err);
    return null;
  }
}

/**
 * Retrieve recent drawings list from localStorage
 */
export function getRecentDrawings(): RecentDrawingItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: RecentDrawingItem[] = JSON.parse(raw);
    return Array.isArray(list)
      ? list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      : [];
  } catch (e) {
    console.warn('Failed to parse recent drawings from localStorage:', e);
    return [];
  }
}

const MAX_DB_RAW_ENTITIES = 150000;

function isModelSafeForIndexedDb(model: DrawingModel): boolean {
  if (!model || !Array.isArray(model.entities)) return false;
  let total = model.entities.length;
  if (total > MAX_DB_RAW_ENTITIES) return false;
  for (const e of model.entities) {
    if (e.type === 'RASTER_PREVIEW') return false;
  }
  if (model.blocks) {
    for (const blk of Object.values(model.blocks)) {
      total += blk.entities?.length || 0;
      if (total > MAX_DB_RAW_ENTITIES) return false;
    }
  }
  return true;
}

/**
 * Save or update a recent drawing item in localStorage and IndexedDB
 */
export async function saveRecentDrawing(
  metadata: {
    id?: string;
    fileName: string;
    formatVersion: string;
    entityCount: number;
    layerCount: number;
    thumbnail: string;
  },
  fullModel?: DrawingModel
): Promise<RecentDrawingItem> {
  const id = metadata.id || metadata.fileName;
  const newItem: RecentDrawingItem = {
    id,
    fileName: metadata.fileName,
    formatVersion: metadata.formatVersion,
    entityCount: metadata.entityCount,
    layerCount: metadata.layerCount,
    lastOpenedAt: Date.now(),
    thumbnail: metadata.thumbnail,
  };

  // 1. Save metadata list in localStorage
  try {
    const existing = getRecentDrawings().filter((item) => item.id !== id && item.fileName !== metadata.fileName);
    // Keep top 18 recent files to avoid quota limits
    const updated = [newItem, ...existing].slice(0, 18);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to store recent drawings in localStorage:', err);
    // If quota exceeded, trim to 5 items and retry
    try {
      const existing = getRecentDrawings().filter((item) => item.id !== id && item.fileName !== metadata.fileName);
      const reduced = [newItem, ...existing].slice(0, 5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reduced));
    } catch {
      // Ignore
    }
  }

  // 2. Save full drawing model in IndexedDB for instant 1-tap re-opening
  if (fullModel && isModelSafeForIndexedDb(fullModel)) {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        id,
        fileName: metadata.fileName,
        model: fullModel,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.warn('Could not save full model to IndexedDB:', e);
    }
  }

  return newItem;
}

/**
 * Load cached DrawingModel from IndexedDB
 */
export async function loadDrawingModelFromDb(id: string): Promise<DrawingModel | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result && req.result.model) {
          resolve(repairCachedDrawingModel(req.result.model as DrawingModel));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Delete a drawing from recent list and IndexedDB
 */
export async function deleteRecentDrawing(id: string): Promise<void> {
  try {
    const existing = getRecentDrawings().filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
  } catch (e) {
    console.warn('Failed to delete recent drawing:', e);
  }
}

/**
 * Clear all recent drawings
 */
export async function clearAllRecentDrawings(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY);
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch (e) {
    console.warn('Failed to clear recent drawings:', e);
  }
}

/**
 * Format relative time (e.g., "방금 전", "3분 전", "2시간 전", "어제", "2026. 11. 01")
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '방금 전';
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 2 * day) return '어제';

  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

const ACTIVE_SESSION_ID = '__active_session__';
const CAMERA_SESSION_KEY = 'cadview_active_camera_v3';

/**
 * Repair DrawingModels cached before the binary DWG LWPOLYLINE 0x200 closed-flag fix
 */
function repairCachedDrawingModel(model: DrawingModel): DrawingModel {
  if (!model || !Array.isArray(model.entities)) return model;
  if (model.layers && model.layers['Defpoints']) {
    model.layers['Defpoints'].visible = true;
  }
  const closedLayers = new Set(['Defpoints', 'CONC', '외형선', 'COL', 'E1', '0-PIT', '2', '6']);
  const fixEnts = (ents: DrawingModel['entities']) => {
    for (const e of ents) {
      if (e.type === 'LWPOLYLINE' && !e.closed && e.vertices && e.vertices.length >= 4) {
        if (closedLayers.has(e.layer)) {
          e.closed = true;
        } else if (e.layer === '0' && e.vertices.length === 4) {
          const [v0, v1, v2, v3] = e.vertices;
          const isRect =
            (Math.abs(v0.y - v1.y) < 1 && Math.abs(v1.x - v2.x) < 1 && Math.abs(v2.y - v3.y) < 1 && Math.abs(v3.x - v0.x) < 1) ||
            (Math.abs(v0.x - v1.x) < 1 && Math.abs(v1.y - v2.y) < 1 && Math.abs(v2.x - v3.x) < 1 && Math.abs(v3.y - v0.y) < 1);
          if (isRect) e.closed = true;
        }
      }
    }
  };
  fixEnts(model.entities);
  if (model.blocks) {
    for (const blk of Object.values(model.blocks)) {
      if (blk && Array.isArray(blk.entities)) fixEnts(blk.entities);
    }
  }
  return model;
}

export interface ActiveCameraState {
  camX: number;
  camY: number;
  zoom: number;
  rotation: number;
  updatedAt: number;
}

/**
 * Persist current camera position to survive mobile background app switches
 */
export function saveActiveCameraState(camera: {
  camX: number;
  camY: number;
  zoom: number;
  rotation: number;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const data: ActiveCameraState = {
      ...camera,
      updatedAt: Date.now(),
    };
    localStorage.setItem(CAMERA_SESSION_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

/**
 * Retrieve saved camera position
 */
export function getActiveCameraState(): ActiveCameraState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CAMERA_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveCameraState;
  } catch {
    return null;
  }
}

/**
 * Save active drawing model to IndexedDB so it never resets when switching apps on mobile
 */
export async function saveActiveDrawingSession(
  model: DrawingModel,
  camera?: { camX: number; camY: number; zoom: number; rotation: number }
): Promise<void> {
  if (camera) {
    saveActiveCameraState(camera);
  }
  if (!isModelSafeForIndexedDb(model)) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id: ACTIVE_SESSION_ID,
      fileName: model.fileName,
      model,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('Failed to save active session in IndexedDB:', err);
  }
}

/**
 * Restore active drawing model and camera position from IndexedDB
 */
export async function loadActiveDrawingSession(): Promise<{
  model: DrawingModel;
  camera: ActiveCameraState | null;
} | null> {
  try {
    const db = await openDatabase();
    const model = await new Promise<DrawingModel | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(ACTIVE_SESSION_ID);
      req.onsuccess = () => {
        if (req.result && req.result.model) {
          resolve(repairCachedDrawingModel(req.result.model as DrawingModel));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });

    if (!model) return null;
    const camera = getActiveCameraState();
    return { model: repairCachedDrawingModel(model), camera };
  } catch {
    return null;
  }
}

/**
 * Clear active session when user explicitly closes or resets drawing
 */
export async function clearActiveDrawingSession(): Promise<void> {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(CAMERA_SESSION_KEY);
    } catch {
      // ignore
    }
  }
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(ACTIVE_SESSION_ID);
  } catch {
    // ignore
  }
}
