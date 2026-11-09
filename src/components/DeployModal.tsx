/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Download, Share2, Smartphone, Rocket, ExternalLink, Check, Copy, QrCode } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { downloadBlobFile } from '../lib/standaloneExport';

interface DeployModalProps {
  isOpen: boolean;
  fileName: string;
  hasDrawing: boolean;
  onClose: () => void;
  onDownloadStandaloneHtml: () => void;
  onExportEmbeddedHtml: () => void;
}

export const DeployModal: React.FC<DeployModalProps> = ({
  isOpen,
  fileName,
  hasDrawing,
  onClose,
  onDownloadStandaloneHtml,
  onExportEmbeddedHtml,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [ghToken, setGhToken] = useState('');
  const [ghRepo, setGhRepo] = useState('my-cad-viewer');
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);

  if (!isOpen) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const sharedUrl = currentUrl.includes('ais-dev-')
    ? currentUrl.replace('ais-dev-', 'ais-pre-')
    : currentUrl;

  const handleCopyUrl = (urlToCopy: string) => {
    navigator.clipboard.writeText(urlToCopy);
    setCopiedAppUrl(true);
    setTimeout(() => setCopiedAppUrl(false), 2000);
  };

  const handleRunGhDeploy = async () => {
    const token = ghToken.trim();
    const repo = (ghRepo.trim() || 'my-cad-viewer').replace(/[^a-zA-Z0-9._-]/g, '-');
    setDeployLogs([]);

    if (!token) {
      setDeployLogs(['⚠️ GitHub Personal Access Token(ghp_...)을 입력해 주세요.']);
      return;
    }

    setIsDeploying(true);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    const toB64 = (str: string) => {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      }
      return btoa(bin);
    };

    try {
      setDeployLogs((prev) => [...prev, '⏳ 1/3. GitHub 계정 인증 및 저장소 확인 중...']);
      const uRes = await fetch('https://api.github.com/user', { headers });
      if (!uRes.ok) throw new Error('토큰 인증 실패 (repo 권한을 확인하세요)');
      const uData = await uRes.json();
      const owner = uData.login;

      let rRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      let rData = null;
      if (rRes.status === 404) {
        const cRes = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: repo, private: false, auto_init: true }),
        });
        if (!cRes.ok) throw new Error('새 저장소 생성에 실패했습니다.');
        rData = await cRes.json();
        await new Promise((r) => setTimeout(r, 1200));
      } else {
        rData = await rRes.json();
      }
      const branch = (rData && rData.default_branch) || 'main';

      async function putFile(path: string, contentStr: string, msg: string) {
        let sha: string | null = null;
        const chk = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
          { headers }
        );
        if (chk.ok) sha = (await chk.json()).sha;
        const body: Record<string, string> = { message: msg, content: toB64(contentStr), branch };
        if (sha) body.sha = sha;
        const pRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          { method: 'PUT', headers, body: JSON.stringify(body) }
        );
        if (!pRes.ok) throw new Error(`${path} 업로드 실패`);
      }

      setDeployLogs((prev) => [
        ...prev,
        '⏳ 2/3. index.html 및 모바일 PWA manifest 업로드 중...',
      ]);

      // Fetch the standalone HTML template from /public/assets/aistudio/index_c6b94c45.html or current page
      let standaloneContent = '';
      try {
        const resHtml = await fetch('/assets/aistudio/index_c6b94c45.html');
        if (resHtml.ok) {
          standaloneContent = await resHtml.text();
        }
      } catch {
        // fallback to document html
      }
      if (!standaloneContent) {
        standaloneContent = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
      }

      const manifestStr = JSON.stringify(
        {
          name: 'CADView 모바일 도면 뷰어',
          short_name: 'CAD뷰어',
          start_url: './index.html',
          display: 'standalone',
          background_color: '#F8F7F4',
          theme_color: '#1E3A8A',
          icons: [
            {
              src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="38" fill="%231E3A8A"/><path d="M48 144L96 48l48 96H48z" fill="none" stroke="%23ffffff" stroke-width="14" stroke-linejoin="round"/></svg>',
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        null,
        2
      );

      await putFile('index.html', standaloneContent, 'Deploy Mobile CAD Viewer');
      await putFile('manifest.json', manifestStr, 'Add PWA manifest');
      await putFile('.nojekyll', '', 'Add .nojekyll');

      setDeployLogs((prev) => [
        ...prev,
        '⏳ 3/3. GitHub Pages 무료 호스팅 활성화 중...',
      ]);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/pages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ source: { branch, path: '/' } }),
      });

      const liveUrl = `https://${owner}.github.io/${repo}/`;
      setDeployLogs((prev) => [
        ...prev,
        `✅ 배포 성공! (약 1분 뒤 활성화됩니다)`,
        `🔗 내 전용 모바일 웹 앱 주소: ${liveUrl}`,
        '👉 스마트폰 크롬에서 위 주소 접속 후 [앱 설치]를 누르면 스마트폰에 앱이 생성됩니다.',
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeployLogs((prev) => [...prev, `❌ 오류: ${msg}`]);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white border border-slate-200 w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-[#C8102E]" />
            <h3 className="text-sm font-bold text-[#1A1A1A]">
              스마트폰 설치 &amp; 개인용 무료 배포
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-[#1A1A1A] p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar text-xs text-slate-700 leading-relaxed">
          {/* Direct Share Link & QR Code (No App Store required) */}
          <div className="p-4 rounded-xl bg-[#F8F9FA] border-2 border-[#C8102E]/25 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-[#C8102E] animate-pulse" />
                <span className="font-bold text-sm text-[#1A1A1A]">
                  나만의 전용 웹 앱 주소 (스토어 등록 불필요)
                </span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C8102E]/10 text-[#C8102E] font-bold">
                비공개 다이렉트 링크
              </span>
            </div>

            <p className="text-[11px] text-slate-600">
              구글 플레이 스토어에 올릴 필요 없이, <strong>나 또는 링크를 받은 사람</strong>만 접속하여 스마트폰에 앱으로 설치해 사용할 수 있습니다.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-3 rounded-xl border border-slate-200">
              {/* QR Code */}
              <div className="bg-white p-1.5 rounded-lg border border-slate-200 shadow-xs shrink-0 flex flex-col items-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(sharedUrl)}`}
                  alt="스마트폰 연결 QR코드"
                  className="w-24 h-24 sm:w-28 sm:h-28 object-contain"
                  loading="lazy"
                />
                <span className="text-[9px] text-slate-500 font-medium mt-1">스마트폰 카메라로 스캔</span>
              </div>

              {/* URL & Action buttons */}
              <div className="flex-1 w-full space-y-2">
                <div className="text-[11px] font-mono bg-[#F8F9FA] px-2.5 py-1.5 rounded-lg border border-slate-200 break-all select-all text-[#1A1A1A]">
                  {sharedUrl}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleCopyUrl(sharedUrl)}
                    className="flex-1 bg-[#C8102E] hover:bg-[#a50d26] text-white py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 text-xs shadow-xs transition active:scale-95"
                  >
                    {copiedAppUrl ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedAppUrl ? '링크 복사됨!' : '카톡/문자 전송용 링크 복사'}</span>
                  </button>
                  <a
                    href={sharedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-slate-100 hover:bg-slate-200 text-[#1A1A1A] border border-slate-200 py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-1 text-xs transition"
                  >
                    <span>새 창 열기</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-[10px] text-slate-500 leading-tight">
                  💡 <strong>스마트폰 앱 추가 팁</strong>: 폰 브라우저에서 링크 접속 후 메뉴(⋮) ➔ <strong>[앱 설치]</strong> 또는 <strong>[홈 화면에 추가]</strong>를 누르면 폰 바탕화면에 단독 CAD 뷰어 아이콘이 생깁니다.
                </div>
              </div>
            </div>
          </div>

          {/* Option 1: Direct Standalone HTML */}
          <div className="p-3.5 rounded-xl bg-[#F8F9FA] border border-slate-200 space-y-2">
            <div className="font-bold text-[#1A1A1A] flex items-center justify-between">
              <span>방법 1. 단일 파일(.html)로 받아 내 폰에서 바로 쓰기</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 font-bold">
                설치 없이 바로 작동
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              아래 버튼을 눌러 완성된 <strong>index.html</strong> 파일을 다운받은 후, 카카오톡(나와의 채팅)이나 구글 드라이브로 내 스마트폰에 전송하여 크롬 브라우저로 열면 서버 없이 즉시 도면을 볼 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={onDownloadStandaloneHtml}
                className="bg-[#C8102E] hover:bg-[#a50d26] text-white py-2 px-3.5 rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition shadow-xs flex-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>완성된 뷰어 파일 (index.html) 다운로드</span>
              </button>
              {hasDrawing && (
                <button
                  onClick={onExportEmbeddedHtml}
                  className="bg-white hover:bg-slate-100 text-[#1A1A1A] border border-slate-300 py-2 px-3 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition"
                  title="현재 열린 도면 데이터를 HTML 안에 심어서 별도 파일 선택 없이 바로 열리도록 저장합니다"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>현재 도면 내장 HTML 저장</span>
                </button>
              )}
            </div>
          </div>

          {/* Option 2: Mobile PWA Install */}
          <div className="p-3.5 rounded-xl bg-[#F8F9FA] border border-slate-200 space-y-2">
            <div className="font-bold text-[#1A1A1A] flex items-center justify-between">
              <span>방법 2. 스마트폰 홈 화면에 정식 앱(PWA)으로 설치</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#C8102E]/10 text-[#C8102E] font-bold">
                앱 아이콘 생성
              </span>
            </div>

            {isInstalled ? (
              <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700 font-medium">
                ✅ 현재 스마트폰에 독립 실행형 앱으로 정상 설치되어 실행 중입니다!
              </div>
            ) : isInstallable ? (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">
                  브라우저 설치 기능이 감지되었습니다. 아래 버튼을 누르면 스마트폰 바탕화면에 즉시 CAD 뷰어 앱 아이콘이 추가됩니다.
                </p>
                <button
                  onClick={install}
                  className="w-full bg-[#1A1A1A] hover:bg-[#333333] text-white py-2 px-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-xs transition"
                >
                  <Download className="w-4 h-4" />
                  <span>스마트폰에 앱으로 지금 설치하기</span>
                </button>
              </div>
            ) : isIOS ? (
              <div className="space-y-1 text-[11px] text-slate-600">
                <p className="font-semibold text-[#1A1A1A]">아이폰 / 아이패드 (iOS Safari) 설치 방법:</p>
                <ol className="list-decimal pl-5 space-y-1 text-slate-500">
                  <li>사파리(Safari) 브라우저 하단 <strong>공유(Share)</strong> 버튼 터치</li>
                  <li>메뉴 목록에서 <strong>[홈 화면에 추가 (Add to Home Screen)]</strong> 선택</li>
                  <li>홈 화면에 정식 CADView 앱 아이콘이 생성됩니다.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-1 text-[11px] text-slate-600">
                <p className="font-semibold text-[#1A1A1A]">안드로이드 스마트폰 (Chrome) 설치 방법:</p>
                <ol className="list-decimal pl-5 space-y-1 text-slate-500">
                  <li>크롬 브라우저 우측 상단 <strong>메뉴 (⋮)</strong> 터치</li>
                  <li><strong>[앱 설치]</strong> 또는 <strong>[홈 화면에 추가]</strong> 터치</li>
                </ol>
              </div>
            )}
          </div>

          {/* Option 3: APK Package Generation Guide */}
          <div className="p-3.5 rounded-xl bg-[#F8F9FA] border border-slate-200 space-y-2">
            <div className="font-bold text-[#1A1A1A] flex items-center justify-between">
              <span>방법 3. 안드로이드 순정 .APK 설치 파일 만들기</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 font-bold">
                1분 완성
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              현재 웹 주소를 <strong>PWABuilder.com</strong>에 입력하면 구글 플레이스토어 등록용 또는 직접 스마트폰에 설치할 수 있는 순정 <strong>.apk 파일</strong>을 무료로 생성할 수 있습니다.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                readOnly
                value={currentUrl}
                className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-[#1A1A1A]"
              />
              <button
                onClick={() => handleCopyUrl(currentUrl)}
                className="px-3 py-1.5 rounded-lg bg-slate-200 text-xs font-semibold flex items-center gap-1"
              >
                {copiedAppUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAppUrl ? '복사됨' : '주소 복사'}</span>
              </button>
              <a
                href="https://www.pwabuilder.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#1A1A1A] text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs"
              >
                <span>PWABuilder 열기</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Option 4: Personal GitHub Pages Free Hosting */}
          <div className="p-3.5 rounded-xl bg-[#F8F9FA] border border-slate-200 space-y-2.5">
            <div className="font-bold text-[#1A1A1A] flex items-center justify-between">
              <span>방법 4. GitHub 토큰으로 내 개인 전용 웹 호스팅 배포</span>
              <a
                href="https://github.com/settings/tokens/new?description=Mobile-CAD-Viewer&scopes=repo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] px-2 py-0.5 rounded bg-[#1A1A1A] text-white font-semibold"
              >
                🔑 토큰 발급 ↗
              </a>
            </div>
            <p className="text-[11px] text-slate-500">
              GitHub Personal Access Token(<code className="font-mono font-bold">ghp_...</code>)을 입력하고 배포를 누르면 평생 무료로 유지되는 나만의 CAD 뷰어 웹사이트(<code className="font-mono">https://아이디.github.io/my-cad-viewer/</code>)가 자동 개설됩니다.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <input
                type="password"
                placeholder="GitHub 토큰 (ghp_...)"
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C8102E]"
              />
              <input
                type="text"
                placeholder="저장소 이름"
                value={ghRepo}
                onChange={(e) => setGhRepo(e.target.value)}
                className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C8102E]"
              />
            </div>
            <button
              onClick={handleRunGhDeploy}
              disabled={isDeploying}
              className="bg-[#C8102E] hover:bg-[#a50d26] disabled:opacity-60 text-white w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition"
            >
              <Rocket className="w-4 h-4" />
              <span>{isDeploying ? '배포 진행 중...' : '🚀 내 개인 GitHub 웹 앱으로 자동 배포'}</span>
            </button>

            {deployLogs.length > 0 && (
              <div className="p-2.5 rounded-xl bg-[#1A1A1A] border border-black font-mono text-[11px] space-y-1 text-slate-200">
                {deployLogs.map((log, idx) => (
                  <div key={idx} className="break-all">
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
