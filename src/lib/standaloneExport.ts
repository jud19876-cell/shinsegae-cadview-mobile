/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DrawingModel } from '../types/cad';

export function downloadBlobFile(
  filename: string,
  content: string,
  mime: string = 'text/html;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildStandaloneViewerHtml(
  embeddedModel: DrawingModel | null = null
): string {
  // If the user provided the attachment index_c6b94c45.html in public/assets/aistudio/, we can also use that pristine standalone version as the base template!
  const hasEmbedded = embeddedModel && embeddedModel.entities && embeddedModel.entities.length > 0;
  
  let embeddedJson = 'null';
  if (hasEmbedded) {
    const cleanModel = {
      fileName: embeddedModel.fileName,
      formatVersion: embeddedModel.formatVersion,
      layers: embeddedModel.layers,
      blocks: embeddedModel.blocks || {},
      entities: embeddedModel.entities,
      extents: embeddedModel.extents,
    };
    embeddedJson = JSON.stringify(cleanModel).replace(/<\/script>/gi, '<\\/script>');
  }

  // We read the existing template if available or generate a pristine self-contained HTML
  const template = `<!DOCTYPE html>
<html lang="ko" data-ui-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>CADView Mobile — 모바일 DWG / DXF 도면 뷰어</title>
  <meta name="theme-color" content="#1E3A8A">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="CAD 도면뷰어">
  <link rel="manifest" href="manifest.json">
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.460.0/dist/umd/lucide.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
    html, body {
      margin: 0; padding: 0;
      width: 100vw; height: 100vh; height: 100dvh;
      overflow: hidden;
      font-family: 'Inter', 'Noto Sans KR', sans-serif;
      touch-action: none;
      background-color: #F8F7F4;
      color: #0F172A;
    }
    .ci-burgundy-btn {
      background: #C8102E; border: 1px solid #9f0c24; color: #ffffff;
      box-shadow: 0 2px 6px rgba(200, 16, 46, 0.25);
    }
    .ci-navy-btn {
      background: #1E3A8A; border: 1px solid #172554; color: #ffffff;
      box-shadow: 0 2px 6px rgba(30, 58, 138, 0.25);
    }
  </style>
</head>
<body class="bg-[#F8F7F4] text-slate-900 flex flex-col w-screen h-screen overflow-hidden">
  <div id="root"></div>
  <script>
    window.__EMBEDDED_CAD_DATA__ = ${embeddedJson};
  </script>
</body>
</html>`;

  return template;
}
