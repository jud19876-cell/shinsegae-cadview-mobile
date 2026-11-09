/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CadEntity,
  CadTheme,
  AppThemePreference,
  DrawingModel,
  Extents2D,
  MeasurementItem,
  Point2D,
  ToolMode,
} from './types/cad';
import { parseDxfText } from './lib/dxfParser';
import { decodeTextBuffer, detectDwgHeader } from './lib/textSanitizer';
import { parseBinaryDwgFile } from './lib/libreDwgLoader';
import { expandAndOptimizeDrawing } from './lib/modelExpander';
import { createSampleArch, createSampleMech } from './lib/sampleDrawings';
import { downloadBlobFile, buildStandaloneViewerHtml } from './lib/standaloneExport';
import {
  RecentDrawingItem,
  getRecentDrawings,
  saveRecentDrawing,
  loadDrawingModelFromDb,
  deleteRecentDrawing,
  clearAllRecentDrawings,
  saveActiveDrawingSession,
  loadActiveDrawingSession,
  saveActiveCameraState,
} from './lib/drawingStorage';

import { Header } from './components/Header';
import { UniversalModeBar } from './components/UniversalModeBar';
import { BottomDock } from './components/BottomDock';
import { CADCanvas, CADCanvasHandle } from './components/CADCanvas';
import { Minimap } from './components/Minimap';
import { EntityInspector } from './components/EntityInspector';
import { LayerModal } from './components/LayerModal';
import { ScaleModal } from './components/ScaleModal';
import { FileSelectModal, FileModalTab } from './components/FileSelectModal';
import { DeployModal } from './components/DeployModal';

export default function App() {
  const canvasRef = useRef<CADCanvasHandle>(null);

  const [model, setModel] = useState<DrawingModel | null>(null);
  const [themePreference, setThemePreference] = useState<AppThemePreference>(() => {
    try {
      return (localStorage.getItem('cadview_theme_pref_ssg') as AppThemePreference) || 'white';
    } catch {
      return 'white';
    }
  });

  const [systemDark, setSystemDark] = useState<boolean>(false);

  // Calculate effective CAD canvas theme (Shinsegae Light Mode 'white' by default)
  const theme: CadTheme = useMemo(() => {
    if (themePreference === 'system') {
      return systemDark ? 'dark' : 'white';
    }
    return themePreference;
  }, [themePreference, systemDark]);

  // Listen to OS dark mode changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    try {
      mq.addEventListener('change', handleMediaChange);
      return () => mq.removeEventListener('change', handleMediaChange);
    } catch {
      mq.addListener(handleMediaChange);
      return () => mq.removeListener(handleMediaChange);
    }
  }, []);

  const [mode, setMode] = useState<ToolMode>('pan');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const [textScale, setTextScale] = useState<number>(1.0);
  const [unitScaleFactor, setUnitScaleFactor] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);

  const [camX, setCamX] = useState<number>(500);
  const [camY, setCamY] = useState<number>(500);
  const [zoom, setZoom] = useState<number>(1.0);
  const [mouseWorld, setMouseWorld] = useState<Point2D>({ x: 0, y: 0 });

  const [selectedEntity, setSelectedEntity] = useState<CadEntity | null>(null);
  const [measurements, setMeasurements] = useState<MeasurementItem[]>([]);
  const [measurePoints, setMeasurePoints] = useState<Point2D[]>([]);

  // Recent drawings list stored in localStorage
  const [recentDrawings, setRecentDrawings] = useState<RecentDrawingItem[]>([]);

  // Menu bar visibility toggle (fullscreen immersive mode)
  const [isMenuHidden, setIsMenuHidden] = useState<boolean>(false);

  // Modals state
  const [isLayersModalOpen, setIsLayersModalOpen] = useState(false);
  const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
  const [isFileSelectModalOpen, setIsFileSelectModalOpen] = useState(false);
  const [fileModalTab, setFileModalTab] = useState<FileModalTab>('local');
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [pendingCalibDist, setPendingCalibDist] = useState<number>(0);

  // Loading & Toast state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const handleSetThemePreference = useCallback((pref: AppThemePreference) => {
    setThemePreference(pref);
    try {
      localStorage.setItem('cadview_theme_pref_ssg', pref);
    } catch {
      // ignore
    }
    if (pref === 'system') {
      showToast('표준 라이트(백지) 테마 적용');
    } else if (pref === 'white') {
      showToast('신세계 라이트(백지) 도면 테마 적용');
    } else if (pref === 'dark') {
      showToast('CAD 클래식 다크 도면 배경 적용');
    } else if (pref === 'blueprint') {
      showToast('엔지니어링 청사진 도면 배경 적용');
    }
  }, [showToast]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const cameraStateRef = useRef({ camX, camY, zoom, rotation });
  cameraStateRef.current = { camX, camY, zoom, rotation };
  const currentModelRef = useRef<DrawingModel | null>(null);
  currentModelRef.current = model;

  // 1. Load recent drawings and automatically restore last active drawing session on mount
  useEffect(() => {
    setRecentDrawings(getRecentDrawings());

    let isMounted = true;
    loadActiveDrawingSession().then((session) => {
      if (isMounted && session && session.model) {
        if (session.camera) {
          setModel(session.model);
          setCamX(session.camera.camX);
          setCamY(session.camera.camY);
          setZoom(session.camera.zoom);
          setRotation(session.camera.rotation || 0);
        } else {
          const opt = expandAndOptimizeDrawing(session.model, 'white');
          setModel(session.model);
          const w = Math.max(10, opt.extents.maxX - opt.extents.minX);
          const h = Math.max(10, opt.extents.maxY - opt.extents.minY);
          const cx = (opt.extents.minX + opt.extents.maxX) / 2;
          const cy = (opt.extents.minY + opt.extents.maxY) / 2;
          const cw = typeof window !== 'undefined' ? window.innerWidth : 400;
          const ch = typeof window !== 'undefined' ? window.innerHeight - 120 : 600;
          const initZoom = Math.min((cw * 0.88) / w, (ch * 0.88) / h);
          setCamX(cx);
          setCamY(cy);
          setZoom(Math.max(0.0001, Math.min(2000, initZoom)));
          setRotation(0);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Debounced camera saving to survive mobile background app switches
  useEffect(() => {
    if (!model) return;
    const t = setTimeout(() => {
      saveActiveCameraState(cameraStateRef.current);
    }, 500);
    return () => clearTimeout(t);
  }, [camX, camY, zoom, rotation, model]);

  // 3. Immediately save session when user switches away to another app (KakaoTalk, Phone, Browser)
  useEffect(() => {
    const handleBackground = () => {
      if (currentModelRef.current) {
        saveActiveCameraState(cameraStateRef.current);
        saveActiveDrawingSession(currentModelRef.current, cameraStateRef.current);
      }
    };
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        handleBackground();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('pagehide', handleBackground);
    window.addEventListener('beforeunload', handleBackground);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('pagehide', handleBackground);
      window.removeEventListener('beforeunload', handleBackground);
    };
  }, []);

  // Enforce Shinsegae Food Corporate Identity Light Mode on the UI shell
  useEffect(() => {
    document.documentElement.setAttribute('data-ui-theme', 'light');
    document.documentElement.classList.remove('dark');
  }, [theme]);

  // Cache last expanded scene so applyDrawingModel and useMemo never expand the same model twice
  const lastExpandedCacheRef = useRef<{
    model: DrawingModel;
    theme: CadTheme;
    result: ReturnType<typeof expandAndOptimizeDrawing>;
  } | null>(null);

  // Optimize and compile drawing entities into hardware render batches
  const optimized = useMemo(() => {
    if (!model) {
      return {
        entities: [],
        layers: {},
        extents: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
        renderBatches: [],
        textEntities: [],
        rasterEntities: [],
      };
    }
    const cached = lastExpandedCacheRef.current;
    if (cached && cached.model === model && cached.theme === theme) {
      return cached.result;
    }
    const result = expandAndOptimizeDrawing(model, theme);
    lastExpandedCacheRef.current = { model, theme, result };
    return result;
  }, [model, theme]);

  // Load a new drawing model into state and trigger thumbnail capture
  const applyDrawingModel = useCallback(
    (newModel: DrawingModel) => {
      setIsFileSelectModalOpen(false);
      setSelectedEntity(null);
      setMeasurements([]);
      setMeasurePoints([]);
      setRotation(0);
      setUnitScaleFactor(1.0);
      setMode('pan');

      const opt = expandAndOptimizeDrawing(newModel, theme);
      lastExpandedCacheRef.current = { model: newModel, theme, result: opt };
      setModel(newModel);

      // Auto fit extents
      const w = Math.max(10, opt.extents.maxX - opt.extents.minX);
      const h = Math.max(10, opt.extents.maxY - opt.extents.minY);
      const cx = (opt.extents.minX + opt.extents.maxX) / 2;
      const cy = (opt.extents.minY + opt.extents.maxY) / 2;
      const cw = typeof window !== 'undefined' ? window.innerWidth : 400;
      const ch = typeof window !== 'undefined' ? window.innerHeight - 120 : 600;
      const initZoom = Math.min((cw * 0.85) / w, (ch * 0.85) / h);

      setCamX(cx);
      setCamY(cy);
      setZoom(Math.max(0.0001, Math.min(2000, initZoom)));

      // Defer IndexedDB persistence and thumbnail capture until after first paint settles
      setTimeout(async () => {
        try {
          await saveActiveDrawingSession(newModel, {
            camX: cx,
            camY: cy,
            zoom: Math.max(0.0001, Math.min(2000, initZoom)),
            rotation: 0,
          });
          if (canvasRef.current) {
            const thumb = canvasRef.current.captureThumbnail();
            if (thumb) {
              await saveRecentDrawing(
                {
                  id: newModel.fileName,
                  fileName: newModel.fileName,
                  formatVersion: newModel.formatVersion,
                  entityCount: opt.entities.length,
                  layerCount: Object.keys(opt.layers).length,
                  thumbnail: thumb,
                },
                newModel
              );
              setRecentDrawings(getRecentDrawings());
            }
          }
        } catch (e) {
          console.warn('Failed to capture drawing thumbnail:', e);
        }
      }, 450);
    },
    [theme]
  );

  // File Upload Processor
  const handleOpenFile = useCallback(
    async (file: File) => {
      if (!file) return;
      const name = file.name;
      const lower = name.toLowerCase();

      try {
        setIsLoading(true);
        setLoadingMessage('파일 버퍼를 읽고 있습니다...');
        const arrayBuffer = await file.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          showToast('선택한 파일이 비어 있거나 손상되었습니다.');
          setIsLoading(false);
          return;
        }

        const uint8 = new Uint8Array(arrayBuffer);
        const dwgVer = detectDwgHeader(uint8);

        if (dwgVer || lower.endsWith('.dwg')) {
          setLoadingMessage(`DWG WebAssembly 엔진 구동 중 (${dwgVer || 'DWG'})...`);
          const parsed = await parseBinaryDwgFile(
            arrayBuffer,
            name,
            dwgVer || 'AutoCAD DWG',
            (msg) => setLoadingMessage(msg)
          );
          applyDrawingModel(parsed);
          showToast(`${name} — 총 ${parsed.entities.length.toLocaleString()}개 객체 로드 완료!`);
        } else if (lower.endsWith('.json')) {
          const text = decodeTextBuffer(uint8);
          const parsed = JSON.parse(text) as DrawingModel;
          applyDrawingModel(parsed);
          showToast(`${name} 로드 완료!`);
        } else {
          // DXF
          setLoadingMessage('DXF 텍스트 구조를 분석하고 있습니다...');
          const text = decodeTextBuffer(uint8);
          const parsed = parseDxfText(text, name);
          if (!parsed.entities || parsed.entities.length === 0) {
            showToast('도면 객체를 찾을 수 없습니다. (.dwg 또는 .dxf 파일을 선택해 주세요)');
          } else {
            applyDrawingModel(parsed);
            showToast(`${name} — 총 ${parsed.entities.length.toLocaleString()}개 객체 로드 완료!`);
          }
        }
      } catch (err: unknown) {
        console.error('File open error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`오류: ${msg}`);
      } finally {
        setIsLoading(false);
      }
    },
    [applyDrawingModel, showToast]
  );

  // Open a DWG/DXF file downloaded from Google Drive or Dropbox
  const handleOpenCloudFile = useCallback(
    async (arrayBuffer: ArrayBuffer, fileName: string) => {
      setIsFileSelectModalOpen(false);
      try {
        const file = new File([arrayBuffer], fileName, {
          type: 'application/octet-stream',
        });
        await handleOpenFile(file);
      } catch (err: unknown) {
        console.error('Cloud file processing error:', err);
        showToast('클라우드 도면 변환 중 오류가 발생했습니다.');
      }
    },
    [handleOpenFile, showToast]
  );

  // Select a recent drawing
  const handleSelectRecent = useCallback(
    async (item: RecentDrawingItem) => {
      try {
        setIsLoading(true);
        setLoadingMessage(`${item.fileName} 도면을 불러오는 중...`);

        // Check IndexedDB cache first
        const cachedModel = await loadDrawingModelFromDb(item.id);
        if (cachedModel && cachedModel.entities && cachedModel.entities.length > 0) {
          applyDrawingModel(cachedModel);
          showToast(`${item.fileName} 다시 열기 완료!`);
          setIsLoading(false);
          return;
        }

        // If not found in IndexedDB, fallback to built-in sample match
        if (item.fileName.includes('A-101')) {
          const s = createSampleArch();
          applyDrawingModel(s);
          showToast('오피스 건축 평면도 샘플을 불러왔습니다.');
        } else if (item.fileName.includes('M-204')) {
          const s = createSampleMech();
          applyDrawingModel(s);
          showToast('기계 플랜지 조립도 샘플을 불러왔습니다.');
        } else {
          showToast(`'${item.fileName}'의 원본 캐시가 만료되었습니다. 파일을 다시 선택해주세요.`);
          const fi = document.querySelector('input[type="file"]') as HTMLInputElement;
          fi?.click();
        }
      } catch (err) {
        console.error('Failed to open recent drawing:', err);
        showToast('도면을 여는 중 문제가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    },
    [applyDrawingModel, showToast]
  );

  // Delete a recent drawing item
  const handleDeleteRecent = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await deleteRecentDrawing(id);
      setRecentDrawings(getRecentDrawings());
      showToast('최근 목록에서 삭제되었습니다.');
    },
    [showToast]
  );

  // Clear all recent drawings
  const handleClearAllRecent = useCallback(async () => {
    await clearAllRecentDrawings();
    setRecentDrawings([]);
    showToast('최근 도면 기록이 모두 삭제되었습니다.');
  }, [showToast]);

  // Standalone HTML Download (Option 1)
  const handleDownloadStandaloneHtml = useCallback(async () => {
    try {
      let htmlStr = '';
      try {
        const res = await fetch('/assets/aistudio/index_c6b94c45.html');
        if (res.ok) {
          htmlStr = await res.text();
        }
      } catch {
        // fallback
      }
      if (!htmlStr) {
        htmlStr = buildStandaloneViewerHtml(null);
      }
      downloadBlobFile('index.html', htmlStr, 'text/html;charset=utf-8');
      showToast('완성된 독립 실행형 뷰어(index.html)가 다운로드되었습니다!');
    } catch {
      showToast('다운로드 중 오류가 발생했습니다.');
    }
  }, [showToast]);

  // Export Drawing Embedded HTML
  const handleExportEmbeddedHtml = useCallback(async () => {
    if (!model || optimized.entities.length === 0) {
      showToast('먼저 도면을 열어주세요.');
      return;
    }
    try {
      const outName = `${model.fileName.replace(/\.[^.]+$/, '') || 'drawing'}_viewer.html`;
      let template = '';
      try {
        const res = await fetch('/assets/aistudio/index_c6b94c45.html');
        if (res.ok) {
          template = await res.text();
        }
      } catch {
        // fallback
      }
      if (!template) {
        template = buildStandaloneViewerHtml(model);
      } else {
        const snapshot = {
          fileName: model.fileName,
          formatVersion: model.formatVersion,
          layers: optimized.layers,
          blocks: model.blocks || {},
          entities: optimized.entities,
          extents: optimized.extents,
        };
        const jsonStr = JSON.stringify(snapshot).replace(/<\/script>/gi, '<\\/script>');
        template = template.replace(
          /<script id="embeddedCadDataScript">[\s\S]*?<\/script>/,
          `<script id="embeddedCadDataScript">\n    window.__EMBEDDED_CAD_DATA__ = ${jsonStr};\n  </script>`
        );
      }
      downloadBlobFile(outName, template, 'text/html;charset=utf-8');
      showToast(`도면이 내장된 ${outName} 파일이 저장되었습니다!`);
    } catch {
      showToast('도면 내장 파일 저장 중 오류가 발생했습니다.');
    }
  }, [model, optimized, showToast]);

  // Sample Loaders
  const handleLoadArchSample = useCallback(() => {
    const s = createSampleArch();
    applyDrawingModel(s);
    showToast('오피스 건축 평면도 샘플을 불러왔습니다.');
  }, [applyDrawingModel, showToast]);

  const handleLoadMechSample = useCallback(() => {
    const s = createSampleMech();
    applyDrawingModel(s);
    showToast('기계 플랜지 조립도 샘플을 불러왔습니다.');
  }, [applyDrawingModel, showToast]);

  const handleClearCanvas = useCallback(() => {
    setModel(null);
    setSelectedEntity(null);
    setMeasurements([]);
    setMeasurePoints([]);
    showToast('도면 화면을 초기화했습니다.');
  }, [showToast]);

  // Layer toggle
  const handleToggleLayer = useCallback((layerName: string) => {
    setModel((prev) => {
      if (!prev) return prev;
      const curL = prev.layers[layerName];
      const isVisible = curL ? curL.visible : true;
      return {
        ...prev,
        layers: {
          ...prev.layers,
          [layerName]: {
            ...curL,
            name: layerName,
            aci: curL ? curL.aci : 7,
            color: curL ? curL.color : '#0f172a',
            count: curL ? curL.count : 0,
            visible: !isVisible,
          },
        },
      };
    });
  }, []);

  const handleShowAllLayers = useCallback(() => {
    setModel((prev) => {
      if (!prev) return prev;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated: Record<string, any> = {};
      Object.keys(prev.layers).forEach((k) => {
        updated[k] = { ...prev.layers[k], visible: true };
      });
      return { ...prev, layers: updated };
    });
  }, []);

  const handleHideAllLayers = useCallback(() => {
    setModel((prev) => {
      if (!prev) return prev;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated: Record<string, any> = {};
      Object.keys(prev.layers).forEach((k) => {
        updated[k] = { ...prev.layers[k], visible: false };
      });
      return { ...prev, layers: updated };
    });
  }, []);

  // Measurement handlers
  const handleAddMeasurement = useCallback(
    (p1: Point2D, p2: Point2D, distanceMm: number) => {
      if (p1 === p2 && distanceMm === 0) {
        setMeasurePoints([p1]);
        return;
      }
      const label =
        distanceMm >= 1000
          ? `${distanceMm.toFixed(0)} mm (${(distanceMm / 1000).toFixed(2)} m)`
          : `${distanceMm.toFixed(1)} mm`;

      setMeasurements((prev) => [
        ...prev,
        {
          id: `M_${Date.now()}`,
          p1,
          p2,
          label,
          distanceMm,
        },
      ]);
      setMeasurePoints([]);
      showToast(`측정 거리: ${label}`);
    },
    [showToast]
  );

  const handleStartCalibration = useCallback((rawDist: number) => {
    setPendingCalibDist(rawDist);
    setMeasurePoints([]);
    setIsScaleModalOpen(true);
  }, []);

  const handleApplyScale = useCallback(
    (realDistanceMm: number) => {
      if (realDistanceMm > 0 && pendingCalibDist > 0) {
        const factor = realDistanceMm / pendingCalibDist;
        setUnitScaleFactor(factor);
        setMode('pan');
        showToast(`2점 축척 교정 완료 (배율 ×${factor.toFixed(3)})`);
      }
    },
    [pendingCalibDist, showToast]
  );

  const handleJumpToText = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (textEnt: any) => {
      setCamX(textEnt.position.x);
      setCamY(textEnt.position.y);
      setZoom(Math.min(window.innerWidth, window.innerHeight) / Math.max(120, (textEnt.height || 100) * 12));
      setSelectedEntity(textEnt);
    },
    []
  );

  const handleUpdateCamera = useCallback((nx: number, ny: number, nz: number) => {
    setCamX(nx);
    setCamY(ny);
    setZoom(nz);
  }, []);

  const handleOpenFileClick = () => {
    const fi = document.querySelector('input[type="file"]') as HTMLInputElement;
    fi?.click();
  };

  return (
    <div className="flex flex-col w-full h-full min-h-[100dvh] h-[100dvh] overflow-hidden bg-[#F8F9FA] text-[#1A1A1A]">
      {/* 1. Header (Hidden in Fullscreen Immersive Mode) */}
      {!isMenuHidden && (
        <Header
          fileName={model?.fileName || ''}
          formatVersion={model?.formatVersion || ''}
          entityCount={optimized.entities.length}
          layerCount={Object.keys(optimized.layers).length}
          recentCount={recentDrawings.length}
          onOpenFile={handleOpenFile}
          onOpenLayersModal={() => setIsLayersModalOpen(true)}
          onOpenSelectModal={() => {
            setFileModalTab('local');
            setIsFileSelectModalOpen(true);
          }}
          onOpenCloudModal={() => {
            setFileModalTab('cloud_google');
            setIsFileSelectModalOpen(true);
          }}
          onOpenDeployModal={() => setIsDeployModalOpen(true)}
          onToggleMenuHidden={() => {
            setIsMenuHidden(true);
            showToast('메뉴바가 숨겨졌습니다. (좌측 상단 버튼으로 복원)');
          }}
        />
      )}

      {/* 2. Universal Mode Bar (Hidden in Fullscreen Immersive Mode) */}
      {!isMenuHidden && (
        <UniversalModeBar
          zoom={zoom}
          mouseWorld={mouseWorld}
          unitScaleFactor={unitScaleFactor}
          theme={theme}
          themePreference={themePreference}
          textScale={textScale}
          onSetThemePreference={handleSetThemePreference}
          onTextScaleDown={() => setTextScale((s) => Math.max(0.25, +(s * 0.8).toFixed(2)))}
          onTextScaleUp={() => setTextScale((s) => Math.min(4.0, +(s * 1.25).toFixed(2)))}
        />
      )}

      {/* 3. Main CAD Canvas Viewport (Expands to 100% full screen when menus are hidden) */}
      <div className="relative flex-1 w-full h-full min-h-0 overflow-hidden flex flex-col">
        <CADCanvas
          ref={canvasRef}
          theme={theme}
          mode={mode}
          showGrid={showGrid}
          enableOsnap={showGrid}
          textScale={textScale}
          unitScaleFactor={unitScaleFactor}
          rotation={rotation}
          camX={camX}
          camY={camY}
          zoom={zoom}
          extents={optimized.extents}
          entities={optimized.entities}
          renderBatches={optimized.renderBatches}
          textEntities={optimized.textEntities}
          rasterEntities={optimized.rasterEntities}
          layers={optimized.layers}
          selectedEntity={selectedEntity}
          measurements={measurements}
          measurePoints={measurePoints}
          isLoading={isLoading}
          loadingMessage={loadingMessage}
          recentDrawings={recentDrawings}
          isMenuHidden={isMenuHidden}
          onToggleMenuHidden={() => setIsMenuHidden((prev) => !prev)}
          onSelectRecentDrawing={handleSelectRecent}
          onOpenSelectModal={() => {
            setFileModalTab('local');
            setIsFileSelectModalOpen(true);
          }}
          onOpenCloudModal={() => {
            setFileModalTab('cloud_google');
            setIsFileSelectModalOpen(true);
          }}
          onUpdateCamera={handleUpdateCamera}
          onRotate90={() => setRotation((r) => (r + 90) % 360)}
          onSelectEntity={setSelectedEntity}
          onAddMeasurement={handleAddMeasurement}
          onStartCalibration={handleStartCalibration}
          onClearMeasurements={() => setMeasurements([])}
          onCancelMode={() => {
            setMode('pan');
            setMeasurePoints([]);
          }}
          onOpenFileClick={handleOpenFileClick}
          onLoadArchSample={handleLoadArchSample}
          onLoadMechSample={handleLoadMechSample}
          onUpdateMouseWorld={setMouseWorld}
        />

        {/* Minimap Overlay */}
        <Minimap
          isOpen={showMinimap}
          theme={theme}
          extents={optimized.extents}
          entities={optimized.entities}
          layers={optimized.layers}
          camX={camX}
          camY={camY}
          zoom={zoom}
          canvasWidth={typeof window !== 'undefined' ? window.innerWidth : 400}
          canvasHeight={typeof window !== 'undefined' ? window.innerHeight - 120 : 600}
          onClose={() => setShowMinimap(false)}
          onJumpToWorld={(wx, wy) => {
            setCamX(wx);
            setCamY(wy);
          }}
        />

        {/* Selected Entity Inspector Sheet */}
        <EntityInspector
          entity={selectedEntity}
          unitScaleFactor={unitScaleFactor}
          onClose={() => setSelectedEntity(null)}
        />
      </div>

      {/* 4. Bottom Workstation Dock (Hidden in Fullscreen Immersive Mode) */}
      {!isMenuHidden && (
        <BottomDock
          mode={mode}
          showGrid={showGrid}
          showMinimap={showMinimap}
          onSetMode={(m) => {
            setMode(m);
            setMeasurePoints([]);
          }}
          onToggleGrid={() => {
            setShowGrid((g) => {
              const next = !g;
              showToast(next ? '격자 및 끝점 스냅(OSNAP) 켜짐' : '격자 및 스냅 꺼짐');
              return next;
            });
          }}
          onToggleMinimap={() => setShowMinimap((m) => !m)}
        />
      )}

      {/* 5. Modals */}
      <LayerModal
        isOpen={isLayersModalOpen}
        theme={theme}
        layers={optimized.layers}
        textEntities={optimized.textEntities}
        onClose={() => setIsLayersModalOpen(false)}
        onToggleLayer={handleToggleLayer}
        onShowAllLayers={handleShowAllLayers}
        onHideAllLayers={handleHideAllLayers}
        onJumpToText={handleJumpToText}
      />

      <ScaleModal
        isOpen={isScaleModalOpen}
        rawDistance={pendingCalibDist}
        currentScaleFactor={unitScaleFactor}
        onClose={() => setIsScaleModalOpen(false)}
        onApplyScale={handleApplyScale}
        onResetScale={() => {
          setUnitScaleFactor(1.0);
          showToast('축척이 1:1 기본값으로 초기화되었습니다.');
        }}
      />

      {/* File Select & Recent Drawings & Cloud Storage Modal */}
      <FileSelectModal
        isOpen={isFileSelectModalOpen}
        initialTab={fileModalTab}
        recentDrawings={recentDrawings}
        onClose={() => setIsFileSelectModalOpen(false)}
        onOpenFileClick={handleOpenFileClick}
        onSelectRecent={handleSelectRecent}
        onDeleteRecent={handleDeleteRecent}
        onClearAllRecent={handleClearAllRecent}
        onLoadArchSample={handleLoadArchSample}
        onLoadMechSample={handleLoadMechSample}
        onClearCanvas={handleClearCanvas}
        onOpenCloudFile={handleOpenCloudFile}
        showToast={showToast}
      />

      <DeployModal
        isOpen={isDeployModalOpen}
        fileName={model?.fileName || 'drawing'}
        hasDrawing={Boolean(model && optimized.entities.length > 0)}
        onClose={() => setIsDeployModalOpen(false)}
        onDownloadStandaloneHtml={handleDownloadStandaloneHtml}
        onExportEmbeddedHtml={handleExportEmbeddedHtml}
      />

      {/* 6. Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#1A1A1A] text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-xl max-w-[90vw] truncate border-l-4 border-[#C8102E] animate-fade-in">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
