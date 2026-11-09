/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { Compass, FolderOpen, Layers, FileCode, Smartphone, Download, EyeOff, Cloud } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface HeaderProps {
  fileName: string;
  formatVersion: string;
  entityCount: number;
  layerCount: number;
  recentCount: number;
  onOpenFile: (file: File) => void;
  onOpenLayersModal: () => void;
  onOpenSelectModal: () => void;
  onOpenCloudModal?: () => void;
  onOpenDeployModal: () => void;
  onToggleMenuHidden?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  fileName,
  formatVersion,
  entityCount,
  layerCount,
  recentCount,
  onOpenFile,
  onOpenLayersModal,
  onOpenSelectModal,
  onOpenCloudModal,
  onOpenDeployModal,
  onToggleMenuHidden,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isInstallable, install } = usePWAInstall();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onOpenFile(e.target.files[0]);
      setTimeout(() => {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }, 1000);
    }
  };

  return (
    <header className="h-14 bg-white border-b-2 border-[#C8102E] px-3 flex items-center justify-between gap-2 shrink-0 z-30 pt-safe shadow-xs">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*,.dwg,.DWG,.dxf,.DXF,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Brand & File Status */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-xl bg-[#C8102E] text-white flex items-center justify-center shrink-0 shadow-xs">
          <Compass className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="hidden md:inline-block text-[10px] font-extrabold tracking-tight px-1.5 py-0.5 rounded bg-[#C8102E]/10 text-[#C8102E] border border-[#C8102E]/20 shrink-0">
              SHINSEGAE FOOD
            </span>
            <h1 className="text-xs sm:text-sm font-bold text-[#1A1A1A] truncate">
              {fileName || '신세계푸드 CAD 도면 뷰어'}
            </h1>
            {formatVersion && (
              <span className="hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-[#1A1A1A] border border-slate-300 shrink-0 font-semibold">
                {formatVersion}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            {entityCount > 0
              ? `객체 ${entityCount.toLocaleString()}개 · 레이어 ${layerCount}개`
              : '공무기획 엔지니어링 · .dwg 또는 .dxf 도면을 선택하세요'}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Open Drawing & Recent Modal Button */}
        <button
          onClick={onOpenSelectModal}
          className="bg-[#C8102E] hover:bg-[#a50d26] text-white border border-[#9f0c24] px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1 sm:gap-1.5 shadow-xs active:scale-95 transition"
          title="도면 파일 열기 및 최근 도면 목록"
        >
          <FolderOpen className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">도면 열기</span>
          <span className="sm:hidden">열기</span>
          {recentCount > 0 && (
            <span className="ml-0.5 text-[10px] font-mono bg-black/20 px-1.5 py-0.2 rounded-full">
              {recentCount}
            </span>
          )}
        </button>

        {/* Cloud Storage (Google Drive / Dropbox) Button */}
        {onOpenCloudModal && (
          <button
            onClick={onOpenCloudModal}
            className="p-1.5 sm:p-2 rounded-xl bg-[#F8F9FA] hover:bg-slate-200/80 text-[#1A1A1A] border border-slate-300 transition"
            title="Google Drive 및 Dropbox 클라우드 도면 연동"
          >
            <Cloud className="w-4 h-4" />
          </button>
        )}

        {/* Layers & Search Modal Button */}
        <button
          onClick={onOpenLayersModal}
          className="p-1.5 sm:p-2 rounded-xl bg-[#F8F9FA] hover:bg-slate-200/80 text-[#1A1A1A] border border-slate-300 transition"
          title="레이어 제어 및 도면 텍스트 검색"
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* Recent & Samples Modal Button - Hidden on mobile to avoid overcrowding */}
        <button
          onClick={onOpenSelectModal}
          className="hidden sm:inline-flex p-2 rounded-xl bg-[#F8F9FA] hover:bg-slate-200/80 text-[#1A1A1A] border border-slate-300 transition"
          title="최근 열어본 도면 및 샘플 보기"
        >
          <FileCode className="w-4 h-4" />
        </button>

        {/* In-App Direct Install Button (If browser supports beforeinstallprompt) */}
        {isInstallable && (
          <button
            onClick={install}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 sm:px-2.5 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs active:scale-95 transition"
            title="스마트폰 홈 화면에 즉시 앱으로 설치"
          >
            <Download className="w-4 h-4 shrink-0 animate-bounce" />
            <span className="hidden md:inline">앱 설치</span>
          </button>
        )}

        {/* Deploy & Mobile Install Guide Modal - Hidden on extra small mobile */}
        <button
          onClick={onOpenDeployModal}
          className="hidden sm:inline-flex bg-[#1A1A1A] hover:bg-[#333333] text-white border border-black px-2.5 py-2 rounded-xl text-xs font-bold items-center gap-1 shadow-xs active:scale-95 transition"
          title="스마트폰 앱 설치 및 개인용 배포 안내"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span className="hidden md:inline">폰 설치·배포</span>
        </button>

        {/* Hide Menus / Fullscreen View Toggle */}
        {onToggleMenuHidden && (
          <button
            onClick={onToggleMenuHidden}
            className="p-1.5 sm:p-2 rounded-xl bg-[#F8F9FA] hover:bg-slate-200/80 text-[#1A1A1A] border border-slate-300 transition"
            title="상단/하단 메뉴바 숨기기 (도면 전체화면 몰입 뷰)"
          >
            <EyeOff className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
