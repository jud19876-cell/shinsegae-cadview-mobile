/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  Search,
  RefreshCw,
  LogOut,
  LogIn,
  FileCode,
  FolderSync,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  HardDrive,
  Download,
  Link,
  Key,
  ShieldCheck,
  ChevronRight,
  ArrowRight,
  Info,
} from 'lucide-react';
import {
  signInWithGoogleDrive,
  signOutFromGoogleDrive,
  subscribeToGoogleAuth,
  listGoogleDriveDwgFiles,
  downloadGoogleDriveFile,
  downloadFromGoogleDriveSharedLink,
  connectWithGoogleToken,
  formatFileSize,
  getDriveAccessToken,
  GoogleDriveFileItem,
  GoogleAuthUser,
} from '../lib/googleDrive';
import {
  connectDropboxWithToken,
  disconnectDropbox,
  getDropboxAccount,
  getDropboxToken,
  listDropboxDwgFiles,
  downloadDropboxFile,
  downloadFromDropboxSharedLink,
  DropboxFileItem,
  DropboxAccount,
} from '../lib/dropbox';

interface CloudStorageExplorerProps {
  onOpenCloudFile: (arrayBuffer: ArrayBuffer, fileName: string) => Promise<void>;
  showToast: (msg: string) => void;
  activeProvider?: 'google' | 'dropbox';
}

export const CloudStorageExplorer: React.FC<CloudStorageExplorerProps> = ({
  onOpenCloudFile,
  showToast,
  activeProvider = 'google',
}) => {
  const [provider, setProvider] = useState<'google' | 'dropbox'>(activeProvider);

  // Google Drive state
  const [googleUser, setGoogleUser] = useState<GoogleAuthUser | null>(null);
  const [googleShareUrl, setGoogleShareUrl] = useState('');
  const [googleTokenInput, setGoogleTokenInput] = useState('');
  const [showGoogleTokenInput, setShowGoogleTokenInput] = useState(false);
  const [googleFiles, setGoogleFiles] = useState<GoogleDriveFileItem[]>([]);
  const [googleSearchQuery, setGoogleSearchQuery] = useState('');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [googleLoadingAction, setGoogleLoadingAction] = useState('');
  const [googleError, setGoogleError] = useState<string | null>(null);

  // Dropbox state
  const [dropboxAccount, setDropboxAccount] = useState<DropboxAccount | null>(getDropboxAccount());
  const [dropboxTokenInput, setDropboxTokenInput] = useState('');
  const [dropboxShareUrl, setDropboxShareUrl] = useState('');
  const [dropboxFiles, setDropboxFiles] = useState<DropboxFileItem[]>([]);
  const [dropboxSearchQuery, setDropboxSearchQuery] = useState('');
  const [isDropboxLoading, setIsDropboxLoading] = useState(false);
  const [dropboxLoadingAction, setDropboxLoadingAction] = useState('');
  const [dropboxError, setDropboxError] = useState<string | null>(null);
  const [showTokenHelp, setShowTokenHelp] = useState(false);

  // Listen to Google Auth changes
  useEffect(() => {
    const unsubscribe = subscribeToGoogleAuth((user) => {
      setGoogleUser(user);
      if (user && getDriveAccessToken()) {
        loadGoogleFiles();
      } else {
        setGoogleFiles([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Load Google Drive files
  const loadGoogleFiles = useCallback(async (query: string = '') => {
    try {
      setIsGoogleLoading(true);
      setGoogleLoadingAction('Google Drive에서 DWG/DXF 도면을 검색하는 중...');
      setGoogleError(null);
      const res = await listGoogleDriveDwgFiles(query);
      setGoogleFiles(res.files);
    } catch (err: any) {
      console.error('Failed to load Google Drive files:', err);
      const msg = err?.message || 'Google Drive 파일을 불러올 수 없습니다.';
      setGoogleError(msg);
      showToast(`Google Drive: ${msg}`);
    } finally {
      setIsGoogleLoading(false);
      setGoogleLoadingAction('');
    }
  }, [showToast]);

  // Handle Google Login via GIS / Firebase
  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleLoading(true);
      setGoogleLoadingAction('Google 계정 인증 창을 여는 중...');
      setGoogleError(null);
      const { user } = await signInWithGoogleDrive();
      setGoogleUser(user);
      showToast(`${user.displayName || user.email || 'Google'} 계정으로 연동 완료!`);
      await loadGoogleFiles();
    } catch (err: any) {
      console.error('Google sign in error:', err);
      const msg = err?.message || 'Google Drive 로그인에 실패했습니다.';
      setGoogleError(msg);
      showToast(`로그인 실패: ${msg}`);
    } finally {
      setIsGoogleLoading(false);
      setGoogleLoadingAction('');
    }
  };

  // Handle Google Drive Shared Link Open
  const handleOpenGoogleSharedLink = async () => {
    if (!googleShareUrl.trim()) {
      showToast('Google Drive 공유 링크 또는 파일 ID를 입력해 주세요.');
      return;
    }
    try {
      setIsGoogleLoading(true);
      setGoogleLoadingAction('Google Drive 링크에서 도면 다운로드 중...');
      setGoogleError(null);
      const { arrayBuffer, fileName } = await downloadFromGoogleDriveSharedLink(
        googleShareUrl.trim()
      );
      await onOpenCloudFile(arrayBuffer, fileName);
      setGoogleShareUrl('');
    } catch (err: any) {
      console.error('Google link download error:', err);
      const msg = err?.message || '도면을 다운로드하지 못했습니다.';
      setGoogleError(msg);
      showToast(`도면 열기 실패: ${msg}`);
    } finally {
      setIsGoogleLoading(false);
      setGoogleLoadingAction('');
    }
  };

  // Handle Manual Google Token Connection
  const handleConnectGoogleToken = async () => {
    if (!googleTokenInput.trim()) {
      showToast('Google 액세스 토큰을 입력해 주세요.');
      return;
    }
    try {
      setIsGoogleLoading(true);
      setGoogleLoadingAction('Google 액세스 토큰 검증 중...');
      setGoogleError(null);
      const { user } = await connectWithGoogleToken(googleTokenInput.trim());
      setGoogleUser(user);
      setGoogleTokenInput('');
      setShowGoogleTokenInput(false);
      showToast('Google Drive 토큰 연동 완료!');
      await loadGoogleFiles();
    } catch (err: any) {
      const msg = err?.message || '토큰 연동에 실패했습니다.';
      setGoogleError(msg);
      showToast(`연동 실패: ${msg}`);
    } finally {
      setIsGoogleLoading(false);
      setGoogleLoadingAction('');
    }
  };

  // Handle Google Sign Out
  const handleGoogleSignOut = async () => {
    try {
      await signOutFromGoogleDrive();
      setGoogleUser(null);
      setGoogleFiles([]);
      showToast('Google Drive 계정에서 로그아웃되었습니다.');
    } catch (err: any) {
      showToast('로그아웃 중 오류가 발생했습니다.');
    }
  };

  // Handle Opening a Google Drive File
  const handleSelectGoogleFile = async (file: GoogleDriveFileItem) => {
    try {
      setIsGoogleLoading(true);
      setGoogleLoadingAction(`${file.name} 다운로드 및 파싱 준비 중...`);
      const buffer = await downloadGoogleDriveFile(file.id);
      await onOpenCloudFile(buffer, file.name);
    } catch (err: any) {
      console.error('Open Google Drive file error:', err);
      showToast(`파일 열기 실패: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setIsGoogleLoading(false);
      setGoogleLoadingAction('');
    }
  };

  // Load Dropbox files
  const loadDropboxFiles = useCallback(async (query: string = '') => {
    if (!getDropboxToken()) return;
    try {
      setIsDropboxLoading(true);
      setDropboxLoadingAction('Dropbox에서 도면 목록을 조회하는 중...');
      setDropboxError(null);
      const files = await listDropboxDwgFiles('', query);
      setDropboxFiles(files);
    } catch (err: any) {
      console.error('Failed to load Dropbox files:', err);
      const msg = err?.message || 'Dropbox 도면 목록을 가져오지 못했습니다.';
      setDropboxError(msg);
      showToast(`Dropbox: ${msg}`);
    } finally {
      setIsDropboxLoading(false);
      setDropboxLoadingAction('');
    }
  }, [showToast]);

  // Initial Dropbox files load if token exists
  useEffect(() => {
    if (getDropboxToken()) {
      loadDropboxFiles();
    }
  }, [loadDropboxFiles]);

  // Handle Dropbox Token Connection
  const handleConnectDropbox = async () => {
    if (!dropboxTokenInput.trim()) {
      showToast('Dropbox 액세스 토큰을 입력해 주세요.');
      return;
    }
    try {
      setIsDropboxLoading(true);
      setDropboxLoadingAction('Dropbox 계정 인증 중...');
      setDropboxError(null);
      const acc = await connectDropboxWithToken(dropboxTokenInput.trim());
      setDropboxAccount(acc);
      setDropboxTokenInput('');
      showToast(`${acc.displayName} 계정으로 Dropbox 연동 완료!`);
      await loadDropboxFiles();
    } catch (err: any) {
      const msg = err?.message || 'Dropbox 연동에 실패했습니다.';
      setDropboxError(msg);
      showToast(`Dropbox 연동 실패: ${msg}`);
    } finally {
      setIsDropboxLoading(false);
      setDropboxLoadingAction('');
    }
  };

  // Handle Dropbox Disconnect
  const handleDisconnectDropbox = () => {
    disconnectDropbox();
    setDropboxAccount(null);
    setDropboxFiles([]);
    showToast('Dropbox 연동이 해제되었습니다.');
  };

  // Handle Opening a Dropbox File via API
  const handleSelectDropboxFile = async (file: DropboxFileItem) => {
    try {
      setIsDropboxLoading(true);
      setDropboxLoadingAction(`${file.name} 다운로드 중...`);
      const buffer = await downloadDropboxFile(file.pathLower);
      await onOpenCloudFile(buffer, file.name);
    } catch (err: any) {
      showToast(`Dropbox 파일 열기 실패: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setIsDropboxLoading(false);
      setDropboxLoadingAction('');
    }
  };

  // Handle Opening a Dropbox Shared Link
  const handleOpenDropboxSharedLink = async () => {
    if (!dropboxShareUrl.trim()) {
      showToast('Dropbox 공유 링크 URL을 입력해주세요.');
      return;
    }
    try {
      setIsDropboxLoading(true);
      setDropboxLoadingAction('Dropbox 공유 링크에서 도면 다운로드 중...');
      const { arrayBuffer, fileName } = await downloadFromDropboxSharedLink(dropboxShareUrl.trim());
      await onOpenCloudFile(arrayBuffer, fileName);
      setDropboxShareUrl('');
    } catch (err: any) {
      showToast(`공유 링크 열기 실패: ${err?.message || '링크를 확인해주세요.'}`);
    } finally {
      setIsDropboxLoading(false);
      setDropboxLoadingAction('');
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Cloud Provider Tabs */}
      <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/60 shrink-0">
        <button
          onClick={() => setProvider('google')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition ${
            provider === 'google'
              ? 'bg-white dark:bg-slate-900 text-[#1E3A8A] dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {/* Google Drive SVG Logo */}
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
            <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
            <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
            <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/>
            <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
            <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
            <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
          </svg>
          <span>Google Drive</span>
          {googleUser && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setProvider('dropbox')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition ${
            provider === 'dropbox'
              ? 'bg-white dark:bg-slate-900 text-[#0061FF] dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {/* Dropbox SVG Logo */}
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10.5 7.5L20 13.75L10.5 20L1 13.75L10.5 7.5Z" fill="#0061FF"/>
            <path d="M29.5 7.5L39 13.75L29.5 20L20 13.75L29.5 7.5Z" fill="#0061FF"/>
            <path d="M1 26.25L10.5 20L20 26.25L10.5 32.5L1 26.25Z" fill="#0061FF"/>
            <path d="M39 26.25L29.5 20L20 26.25L29.5 32.5L39 26.25Z" fill="#0061FF"/>
            <path d="M20 27.5L29.5 33.75L20 40L10.5 33.75L20 27.5Z" fill="#0061FF"/>
          </svg>
          <span>Dropbox</span>
          {dropboxAccount && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* GOOGLE DRIVE PANEL */}
      {/* ========================================================================= */}
      {provider === 'google' && (
        <div className="space-y-4 flex-1 flex flex-col min-h-0">
          {/* 1. Quick Shared Link Import (No login required / zero friction) */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800/80 dark:to-blue-950/40 border border-blue-200 dark:border-blue-900/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#1E3A8A] dark:text-blue-300 flex items-center gap-1.5">
                <Link className="w-4 h-4" />
                <span>Google Drive 도면 링크/ID로 즉시 열기</span>
              </span>
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-[#1E3A8A] dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">
                공유 링크 즉시 지원
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              '링크가 있는 모든 사용자'로 공유된 Google Drive 링크나 파일 ID를 입력하면 1초 만에 로드됩니다.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Google Drive 링크(https://drive.google.com/file/d/...) 또는 파일 ID 입력..."
                value={googleShareUrl}
                onChange={(e) => setGoogleShareUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleOpenGoogleSharedLink();
                }}
                className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
              <button
                onClick={handleOpenGoogleSharedLink}
                disabled={isGoogleLoading || !googleShareUrl.trim()}
                className="bg-[#1E3A8A] hover:bg-[#172e6e] text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>도면 열기</span>
              </button>
            </div>
          </div>

          {/* 2. Official Google Account Connection (GIS Token Client + Firebase) */}
          {!googleUser ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E3A8A] dark:text-blue-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>내 Google Drive 전체 도면 탐색 및 연동</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Google 계정으로 연결하여 내 드라이브의 모든 .DWG / .DXF 도면을 직접 검색하고 엽니다.
                  </p>
                </div>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={isGoogleLoading}
                  className="w-full sm:w-auto bg-[#1E3A8A] hover:bg-[#172e6e] text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition shadow-sm shrink-0 disabled:opacity-50"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Google Drive 로그인</span>
                </button>
              </div>

              {/* Manual Token Option Toggle */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60">
                <button
                  onClick={() => setShowGoogleTokenInput((prev) => !prev)}
                  className="text-[11px] text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                >
                  <Key className="w-3 h-3 text-amber-500" />
                  <span>팝업이 차단된 환경이신가요? Google 액세스 토큰 직접 입력</span>
                </button>

                {showGoogleTokenInput && (
                  <div className="mt-2.5 flex gap-2">
                    <input
                      type="password"
                      placeholder="Google OAuth Access Token 붙여넣기..."
                      value={googleTokenInput}
                      onChange={(e) => setGoogleTokenInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConnectGoogleToken();
                      }}
                      className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                    <button
                      onClick={handleConnectGoogleToken}
                      disabled={isGoogleLoading || !googleTokenInput.trim()}
                      className="bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition disabled:opacity-50 shrink-0"
                    >
                      토큰 연동
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                {googleUser.photoURL ? (
                  <img
                    src={googleUser.photoURL}
                    alt={googleUser.displayName || ''}
                    className="w-8 h-8 rounded-full border border-blue-300"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                    {(googleUser.displayName || googleUser.email || 'G')[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 dark:text-white truncate">
                    {googleUser.displayName || 'Google 사용자'}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {googleUser.email}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => loadGoogleFiles(googleSearchQuery)}
                  disabled={isGoogleLoading}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-600 transition"
                  title="파일 목록 새로고침"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGoogleLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleGoogleSignOut}
                  className="px-2.5 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1 transition"
                  title="로그아웃"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">로그아웃</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Bar (Enabled if logged in) */}
          {googleUser && (
            <div className="relative">
              <input
                type="text"
                placeholder="Google Drive 내 DWG / DXF 파일명 검색..."
                value={googleSearchQuery}
                onChange={(e) => setGoogleSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    loadGoogleFiles(googleSearchQuery);
                  }
                }}
                className="w-full pl-9 pr-16 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <button
                onClick={() => loadGoogleFiles(googleSearchQuery)}
                className="absolute right-1.5 top-1.5 bg-[#1E3A8A] text-white px-2 py-1 rounded-lg text-[10px] font-bold"
              >
                검색
              </button>
            </div>
          )}

          {/* Google Error Message with recovery hints */}
          {googleError && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
              <div className="flex items-center gap-2 font-bold">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{googleError}</span>
              </div>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80 leading-relaxed pl-6">
                💡 브라우저 보안 정책으로 팝업 통신이 제한되는 경우, 위의 <strong>[Google Drive 도면 링크/ID로 즉시 열기]</strong>에 파일 링크를 넣거나 Dropbox 탭을 이용하시면 즉시 도면을 열람하실 수 있습니다.
              </p>
            </div>
          )}

          {/* Google Files List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[160px] custom-scrollbar">
            {isGoogleLoading ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-center space-y-2">
                <div className="w-8 h-8 rounded-full border-3 border-[#1E3A8A]/30 border-t-[#1E3A8A] animate-spin" />
                <p className="text-xs font-semibold">{googleLoadingAction || '로딩 중...'}</p>
              </div>
            ) : !googleUser ? (
              <div className="py-8 text-center text-slate-400 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                <Cloud className="w-10 h-10 mx-auto text-[#1E3A8A] dark:text-blue-400 opacity-60" />
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Google Drive에 연결되지 않았습니다
                </div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  상단의 [Google Drive 로그인]으로 계정을 연결하거나, 공유 링크를 입력하여 CAD 도면을 즉시 열어보세요.
                </p>
              </div>
            ) : googleFiles.length === 0 ? (
              <div className="py-10 text-center text-slate-400 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                <FileCode className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  {googleSearchQuery ? `'${googleSearchQuery}' 검색 결과가 없습니다` : 'Google Drive에 DWG/DXF 파일이 없습니다'}
                </div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Google Drive에 .dwg 또는 .dxf 파일을 업로드한 후 우측 상단의 새로고침 버튼을 눌러주세요.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1 flex items-center justify-between">
                  <span>검색된 도면 ({googleFiles.length}개)</span>
                  <span>클릭 시 즉시 열기</span>
                </div>
                {googleFiles.map((file) => {
                  const isDwg = file.name.toLowerCase().endsWith('.dwg');
                  return (
                    <div
                      key={file.id}
                      onClick={() => handleSelectGoogleFile(file)}
                      className="group cursor-pointer p-3 rounded-xl bg-slate-50 hover:bg-blue-50/60 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/70 hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between gap-3 transition shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            isDwg
                              ? 'bg-[#C8102E]/10 text-[#C8102E] border border-[#C8102E]/20'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {isDwg ? 'DWG' : 'DXF'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-[#1E3A8A] dark:group-hover:text-blue-400">
                            {file.name}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
                            <span>{formatFileSize(file.size)}</span>
                            {file.modifiedTime && (
                              <span>· {new Date(file.modifiedTime).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectGoogleFile(file);
                        }}
                        className="bg-[#1E3A8A] hover:bg-[#172e6e] text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 active:scale-95 transition shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>열기</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DROPBOX PANEL */}
      {/* ========================================================================= */}
      {provider === 'dropbox' && (
        <div className="space-y-4 flex-1 flex flex-col min-h-0">
          {/* Quick Option 1: Direct Shared Link Import */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-sky-50 dark:from-slate-800/80 dark:to-blue-950/40 border border-blue-200 dark:border-blue-900/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#0061FF] dark:text-blue-300 flex items-center gap-1.5">
                <Link className="w-4 h-4" />
                <span>Dropbox 공유 링크로 즉시 도면 열기</span>
              </span>
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-[#0061FF] dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">
                로그인 불필요
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Dropbox 링크(https://www.dropbox.com/s/...)를 붙여넣으면 앱에서 바로 다운로드 및 렌더링합니다.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="Dropbox 도면 공유 링크 URL 붙여넣기..."
                value={dropboxShareUrl}
                onChange={(e) => setDropboxShareUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleOpenDropboxSharedLink();
                }}
                className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0061FF]"
              />
              <button
                onClick={handleOpenDropboxSharedLink}
                disabled={isDropboxLoading || !dropboxShareUrl.trim()}
                className="bg-[#0061FF] hover:bg-[#0052d9] text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50 shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>도면 열기</span>
              </button>
            </div>
          </div>

          {/* Option 2: Dropbox Account Integration */}
          {!dropboxAccount ? (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-white">
                  <Key className="w-4 h-4 text-amber-500" />
                  <span>Dropbox 계정 연동 (API Token)</span>
                </div>
                <button
                  onClick={() => setShowTokenHelp((prev) => !prev)}
                  className="text-[11px] text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-0.5"
                >
                  <Info className="w-3 h-3" />
                  <span>토큰 발급 안내</span>
                </button>
              </div>

              {showTokenHelp && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                  <p className="font-semibold">Dropbox 토큰 발급 30초 가이드:</p>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>
                      <a
                        href="https://www.dropbox.com/developers/apps"
                        target="_blank"
                        rel="noreferrer"
                        className="underline font-bold text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5"
                      >
                        Dropbox App Console <ExternalLink className="w-2.5 h-2.5 inline" />
                      </a>
                      에서 'Create app' 클릭
                    </li>
                    <li>Scoped access 선택 및 files.content.read 권한 체크</li>
                    <li>'Generated access token' 버튼을 눌러 복사 후 아래에 붙여넣기</li>
                  </ol>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="Dropbox Access Token 붙여넣기..."
                  value={dropboxTokenInput}
                  onChange={(e) => setDropboxTokenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConnectDropbox();
                  }}
                  className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0061FF]"
                />
                <button
                  onClick={handleConnectDropbox}
                  disabled={isDropboxLoading || !dropboxTokenInput.trim()}
                  className="bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition disabled:opacity-50 shrink-0 flex items-center gap-1"
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  <span>연동하기</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                {dropboxAccount.profilePhotoUrl ? (
                  <img
                    src={dropboxAccount.profilePhotoUrl}
                    alt={dropboxAccount.displayName}
                    className="w-8 h-8 rounded-full border border-blue-400"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#0061FF] text-white font-bold text-xs flex items-center justify-center">
                    {dropboxAccount.displayName[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 dark:text-white truncate">
                    {dropboxAccount.displayName}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {dropboxAccount.email || 'Dropbox 계정'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => loadDropboxFiles(dropboxSearchQuery)}
                  disabled={isDropboxLoading}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-600 transition"
                  title="파일 목록 새로고침"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDropboxLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleDisconnectDropbox}
                  className="px-2.5 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1 transition"
                  title="연동 해제"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">연동 해제</span>
                </button>
              </div>
            </div>
          )}

          {/* Dropbox Search Bar (If connected) */}
          {dropboxAccount && (
            <div className="relative">
              <input
                type="text"
                placeholder="Dropbox 내 DWG / DXF 파일명 검색..."
                value={dropboxSearchQuery}
                onChange={(e) => setDropboxSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadDropboxFiles(dropboxSearchQuery);
                }}
                className="w-full pl-9 pr-16 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0061FF]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <button
                onClick={() => loadDropboxFiles(dropboxSearchQuery)}
                className="absolute right-1.5 top-1.5 bg-[#0061FF] text-white px-2 py-1 rounded-lg text-[10px] font-bold"
              >
                검색
              </button>
            </div>
          )}

          {/* Dropbox Error Message */}
          {dropboxError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{dropboxError}</span>
            </div>
          )}

          {/* Dropbox File List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[160px] custom-scrollbar">
            {isDropboxLoading ? (
              <div className="py-10 flex flex-col items-center justify-center text-slate-400 text-center space-y-2">
                <div className="w-8 h-8 rounded-full border-3 border-[#0061FF]/30 border-t-[#0061FF] animate-spin" />
                <p className="text-xs font-semibold">{dropboxLoadingAction || '로딩 중...'}</p>
              </div>
            ) : dropboxAccount && dropboxFiles.length === 0 ? (
              <div className="py-8 text-center text-slate-400 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                <FileCode className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  {dropboxSearchQuery ? `'${dropboxSearchQuery}' 검색 결과가 없습니다` : 'Dropbox에 DWG/DXF 파일이 없습니다'}
                </div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Dropbox 폴더에 .dwg 또는 .dxf 파일을 넣은 후 새로고침하거나 위의 공유 링크 입력창을 이용해주세요.
                </p>
              </div>
            ) : dropboxAccount && dropboxFiles.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 px-1 flex items-center justify-between">
                  <span>Dropbox 도면 ({dropboxFiles.length}개)</span>
                  <span>클릭 시 즉시 열기</span>
                </div>
                {dropboxFiles.map((file) => {
                  const isDwg = file.name.toLowerCase().endsWith('.dwg');
                  return (
                    <div
                      key={file.id}
                      onClick={() => handleSelectDropboxFile(file)}
                      className="group cursor-pointer p-3 rounded-xl bg-slate-50 hover:bg-blue-50/60 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/70 hover:border-blue-400 dark:hover:border-blue-500 flex items-center justify-between gap-3 transition shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            isDwg
                              ? 'bg-[#C8102E]/10 text-[#C8102E] border border-[#C8102E]/20'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {isDwg ? 'DWG' : 'DXF'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-[#0061FF] dark:group-hover:text-blue-400">
                            {file.name}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
                            <span>{formatFileSize(file.size)}</span>
                            {file.serverModified && (
                              <span>· {new Date(file.serverModified).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectDropboxFile(file);
                        }}
                        className="bg-[#0061FF] hover:bg-[#0052d9] text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 active:scale-95 transition shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>열기</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
