/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  FolderOpen,
  Clock,
  Trash2,
  Building,
  Cog,
  History,
  FileCheck,
  ChevronRight,
  Cloud,
  HardDrive,
} from 'lucide-react';
import { RecentDrawingItem, formatRelativeTime } from '../lib/drawingStorage';
import { CloudStorageExplorer } from './CloudStorageExplorer';

export type FileModalTab = 'local' | 'cloud_google' | 'cloud_dropbox';

interface FileSelectModalProps {
  isOpen: boolean;
  recentDrawings: RecentDrawingItem[];
  initialTab?: FileModalTab;
  onClose: () => void;
  onOpenFileClick: () => void;
  onSelectRecent: (item: RecentDrawingItem) => void;
  onDeleteRecent: (id: string, e: React.MouseEvent) => void;
  onClearAllRecent: () => void;
  onLoadArchSample: () => void;
  onLoadMechSample: () => void;
  onClearCanvas: () => void;
  onOpenCloudFile: (arrayBuffer: ArrayBuffer, fileName: string) => Promise<void>;
  showToast: (msg: string) => void;
}

export const FileSelectModal: React.FC<FileSelectModalProps> = ({
  isOpen,
  recentDrawings,
  initialTab = 'local',
  onClose,
  onOpenFileClick,
  onSelectRecent,
  onDeleteRecent,
  onClearAllRecent,
  onLoadArchSample,
  onLoadMechSample,
  onClearCanvas,
  onOpenCloudFile,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<FileModalTab>(initialTab);

  // Sync initial tab when reopened
  React.useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="bg-white border border-slate-200 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#C8102E] text-white flex items-center justify-center shadow-xs">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1A1A1A]">
                도면 파일 열기 및 클라우드 연동
              </h3>
              <p className="text-[11px] text-slate-500">
                기기 내 파일, 최근 열어본 도면 또는 클라우드(Google Drive/Dropbox) 도면을 엽니다
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-[#1A1A1A] p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-4 bg-[#F8F9FA] shrink-0 gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('local')}
            className={`py-2.5 px-3 border-b-2 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'local'
                ? 'border-[#C8102E] text-[#C8102E]'
                : 'border-transparent text-slate-500 hover:text-[#1A1A1A]'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>내 기기 & 최근 ({recentDrawings.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('cloud_google')}
            className={`py-2.5 px-3 border-b-2 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'cloud_google'
                ? 'border-[#C8102E] text-[#C8102E]'
                : 'border-transparent text-slate-500 hover:text-[#1A1A1A]'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
              <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/>
              <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
              <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
              <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
            </svg>
            <span>Google Drive</span>
          </button>

          <button
            onClick={() => setActiveTab('cloud_dropbox')}
            className={`py-2.5 px-3 border-b-2 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'cloud_dropbox'
                ? 'border-[#C8102E] text-[#C8102E]'
                : 'border-transparent text-slate-500 hover:text-[#1A1A1A]'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10.5 7.5L20 13.75L10.5 20L1 13.75L10.5 7.5Z" fill="#0061FF"/>
              <path d="M29.5 7.5L39 13.75L29.5 20L20 13.75L29.5 7.5Z" fill="#0061FF"/>
              <path d="M1 26.25L10.5 20L20 26.25L10.5 32.5L1 26.25Z" fill="#0061FF"/>
              <path d="M39 26.25L29.5 20L20 26.25L29.5 32.5L39 26.25Z" fill="#0061FF"/>
              <path d="M20 27.5L29.5 33.75L20 40L10.5 33.75L20 27.5Z" fill="#0061FF"/>
            </svg>
            <span>Dropbox</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto custom-scrollbar flex-1">
          {/* TAB 1: LOCAL & RECENT */}
          {activeTab === 'local' && (
            <div className="space-y-5">
              {/* Primary Action: Open from Device */}
              <div className="p-4 rounded-2xl bg-[#1A1A1A] text-white shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-l-4 border-[#C8102E]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#C8102E] text-white font-mono">
                      DWG · DXF
                    </span>
                    <span className="text-xs text-slate-300">신세계푸드 공무기획 100% 로컬 해독</span>
                  </div>
                  <h4 className="text-sm font-bold">내 기기에서 새 도면 파일 열기</h4>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    서버 전송 없이 기기 메모리에서 즉시 렌더링됩니다.
                  </p>
                </div>
                <button
                  onClick={() => {
                    onOpenFileClick();
                    onClose();
                  }}
                  className="bg-[#C8102E] hover:bg-[#a50d26] text-white border border-[#9f0c24] px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 active:scale-95 transition shadow-xs shrink-0 w-full sm:w-auto justify-center"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>파일 선택하기</span>
                </button>
              </div>

              {/* Cloud Shortcut Banner */}
              <div className="p-3 rounded-xl bg-[#F8F9FA] border border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <Cloud className="w-4 h-4 text-[#C8102E] shrink-0" />
                  <span>클라우드 저장소(Google Drive, Dropbox)에 도면이 있나요?</span>
                </div>
                <button
                  onClick={() => setActiveTab('cloud_google')}
                  className="text-xs font-bold text-[#C8102E] hover:underline shrink-0"
                >
                  클라우드 열기 →
                </button>
              </div>

              {/* Section: Recent Drawings */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#C8102E]" />
                    <h4 className="text-xs font-bold text-[#1A1A1A]">
                      최근 열어본 도면 ({recentDrawings.length})
                    </h4>
                  </div>
                  {recentDrawings.length > 0 && (
                    <button
                      onClick={onClearAllRecent}
                      className="text-[11px] text-slate-400 hover:text-[#C8102E] transition flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>기록 전체 삭제</span>
                    </button>
                  )}
                </div>

                {recentDrawings.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-slate-300 text-center text-slate-400 space-y-1">
                    <Clock className="w-6 h-6 mx-auto opacity-40 mb-1" />
                    <p className="text-xs font-medium">최근 열어본 도면 기록이 없습니다.</p>
                    <p className="text-[11px] text-slate-500">
                      도면을 열면 캔버스 썸네일과 마지막 열람 시간이 여기에 자동 보관됩니다.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {recentDrawings.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          onSelectRecent(item);
                          onClose();
                        }}
                        className="group relative cursor-pointer rounded-xl bg-[#F8F9FA] hover:bg-white border border-slate-200 hover:border-[#C8102E]/40 p-2.5 flex flex-col justify-between transition shadow-xs hover:shadow-md"
                      >
                        {/* Thumbnail preview */}
                        <div className="relative w-full h-28 rounded-lg overflow-hidden bg-slate-900 border border-slate-200 mb-2">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt={item.fileName}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-mono">
                              미리보기 없음
                            </div>
                          )}
                          <span className="absolute top-1.5 left-1.5 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 text-white backdrop-blur-xs">
                            {item.formatVersion || 'CAD'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteRecent(item.id, e);
                            }}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 hover:bg-[#C8102E] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                            title="최근 목록에서 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Metadata */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-[#1A1A1A] truncate flex-1">
                              {item.fileName}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition shrink-0" />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                            <span>
                              객체 {item.entityCount.toLocaleString()}개 · L {item.layerCount}개
                            </span>
                            <span className="flex items-center gap-1 text-[#C8102E] font-semibold">
                              <Clock className="w-2.5 h-2.5" />
                              {formatRelativeTime(item.lastOpenedAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section: Built-in CAD Samples */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-[#1A1A1A] flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-[#C8102E]" />
                  <span>테스트용 정밀 샘플 도면</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      onLoadArchSample();
                      onClose();
                    }}
                    className="text-left p-3 rounded-xl bg-[#F8F9FA] hover:bg-slate-100 border border-slate-200 flex items-center gap-3 transition shadow-xs"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#C8102E]/10 text-[#C8102E] flex items-center justify-center shrink-0 font-bold">
                      <Building className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[#1A1A1A] truncate">
                        건축 평면도 (A-101.dwg)
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        대회의실, 연구소, 벽체 및 치수선
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      onLoadMechSample();
                      onClose();
                    }}
                    className="text-left p-3 rounded-xl bg-[#F8F9FA] hover:bg-slate-100 border border-slate-200 flex items-center gap-3 transition shadow-xs"
                  >
                    <div className="w-9 h-9 rounded-lg bg-slate-200 text-[#1A1A1A] flex items-center justify-center shrink-0 font-bold">
                      <Cog className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[#1A1A1A] truncate">
                        기계 플랜지 조립도 (M-204.dwg)
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        PCD Ø360 볼트 홀 및 정밀 치수
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Section: Reset / Clear Canvas */}
              <div className="pt-1 border-t border-slate-200">
                <button
                  onClick={() => {
                    onClearCanvas();
                    onClose();
                  }}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-rose-50 text-[#C8102E] flex items-center justify-between text-xs font-semibold transition"
                >
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    <span>현재 도면 닫기 (화면 비우기)</span>
                  </div>
                  <span className="text-[11px] text-slate-400">메모리 초기화</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2 & 3: GOOGLE DRIVE & DROPBOX */}
          {(activeTab === 'cloud_google' || activeTab === 'cloud_dropbox') && (
            <CloudStorageExplorer
              activeProvider={activeTab === 'cloud_google' ? 'google' : 'dropbox'}
              showToast={showToast}
              onOpenCloudFile={async (buffer, fileName) => {
                await onOpenCloudFile(buffer, fileName);
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
