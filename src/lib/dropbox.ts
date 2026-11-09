/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DropboxFileItem {
  id: string;
  name: string;
  pathDisplay: string;
  pathLower: string;
  size?: number;
  clientModified?: string;
  serverModified?: string;
}

export interface DropboxAccount {
  accountId: string;
  displayName: string;
  email: string;
  profilePhotoUrl?: string;
}

// In-memory token storage (with optional session fallback)
let inMemoryDropboxToken: string | null = null;
let currentDropboxAccount: DropboxAccount | null = null;

// Try to restore from sessionStorage (transient, cleared on browser close)
try {
  inMemoryDropboxToken = sessionStorage.getItem('cadview_dropbox_token');
  const savedAcc = sessionStorage.getItem('cadview_dropbox_acc');
  if (savedAcc) {
    currentDropboxAccount = JSON.parse(savedAcc);
  }
} catch {
  // Ignore storage errors in restricted contexts
}

export function getDropboxToken(): string | null {
  return inMemoryDropboxToken;
}

export function getDropboxAccount(): DropboxAccount | null {
  return currentDropboxAccount;
}

/**
 * Connect to Dropbox using an API Access Token
 */
export async function connectDropboxWithToken(token: string): Promise<DropboxAccount> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Dropbox 액세스 토큰을 입력해 주세요.');
  }

  // Verify token by getting account details
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('유효하지 않거나 만료된 Dropbox 토큰입니다.');
    }
    throw new Error(`Dropbox 계정 확인 실패 (${res.status})`);
  }

  const data = await res.json();
  const account: DropboxAccount = {
    accountId: data.account_id,
    displayName: data.name?.display_name || 'Dropbox 사용자',
    email: data.email || '',
    profilePhotoUrl: data.profile_photo_url,
  };

  inMemoryDropboxToken = cleanToken;
  currentDropboxAccount = account;

  try {
    sessionStorage.setItem('cadview_dropbox_token', cleanToken);
    sessionStorage.setItem('cadview_dropbox_acc', JSON.stringify(account));
  } catch {
    // Ignore
  }

  return account;
}

/**
 * Disconnect Dropbox
 */
export function disconnectDropbox(): void {
  inMemoryDropboxToken = null;
  currentDropboxAccount = null;
  try {
    sessionStorage.removeItem('cadview_dropbox_token');
    sessionStorage.removeItem('cadview_dropbox_acc');
  } catch {
    // Ignore
  }
}

/**
 * List DWG and DXF files from Dropbox
 */
export async function listDropboxDwgFiles(
  folderPath: string = '',
  searchKeyword: string = ''
): Promise<DropboxFileItem[]> {
  if (!inMemoryDropboxToken) {
    throw new Error('Dropbox 연동이 필요합니다.');
  }

  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${inMemoryDropboxToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: folderPath,
      recursive: true,
      include_media_info: false,
      include_deleted: false,
      limit: 100,
    }),
  });

  if (!res.ok) {
    if (res.status === 401) {
      disconnectDropbox();
      throw new Error('Dropbox 토큰이 만료되었습니다. 다시 연동해 주세요.');
    }
    const errData = await res.text();
    console.error('Dropbox list_folder error:', errData);
    throw new Error(`Dropbox 파일 목록 불러오기 실패 (${res.status})`);
  }

  const data = await res.json();
  const entries: any[] = data.entries || [];

  // Filter for DWG and DXF files
  const cadFiles: DropboxFileItem[] = entries
    .filter((entry) => {
      if (entry['.tag'] !== 'file') return false;
      const lower = (entry.name || '').toLowerCase();
      return lower.endsWith('.dwg') || lower.endsWith('.dxf');
    })
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      pathDisplay: entry.path_display || entry.name,
      pathLower: entry.path_lower || entry.name,
      size: entry.size,
      clientModified: entry.client_modified,
      serverModified: entry.server_modified,
    }));

  if (searchKeyword.trim()) {
    const q = searchKeyword.toLowerCase();
    return cadFiles.filter((f) => f.name.toLowerCase().includes(q));
  }

  return cadFiles;
}

/**
 * Download a file from Dropbox as ArrayBuffer
 */
export async function downloadDropboxFile(filePath: string): Promise<ArrayBuffer> {
  if (!inMemoryDropboxToken) {
    throw new Error('Dropbox 연동이 필요합니다.');
  }

  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${inMemoryDropboxToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      disconnectDropbox();
      throw new Error('Dropbox 인증이 만료되었습니다.');
    }
    throw new Error(`Dropbox 파일 다운로드 실패 (${res.status})`);
  }

  return await res.arrayBuffer();
}

/**
 * Convert any Dropbox shared link to a direct raw download URL
 * Handles both dropbox.com/s/... and dropbox.com/scl/fi/... links
 */
export function convertDropboxShareUrlToDirect(url: string): string {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.includes('dropbox.com')) {
      return url.trim();
    }
    // Remove dl=0 parameter and set raw=1 or dl=1
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  } catch {
    // If not a valid URL, replace regex
    return url.replace(/([?&])dl=0/g, '$1raw=1');
  }
}

/**
 * Download DWG/DXF directly from a Dropbox shared link
 */
export async function downloadFromDropboxSharedLink(
  sharedUrl: string
): Promise<{ arrayBuffer: ArrayBuffer; fileName: string }> {
  const directUrl = convertDropboxShareUrlToDirect(sharedUrl);

  // Extract file name from URL
  let fileName = 'dropbox_drawing.dwg';
  try {
    const parsed = new URL(sharedUrl);
    const pathParts = parsed.pathname.split('/');
    const last = pathParts[pathParts.length - 1];
    if (last && (last.toLowerCase().endsWith('.dwg') || last.toLowerCase().endsWith('.dxf'))) {
      fileName = decodeURIComponent(last);
    }
  } catch {
    // fallback
  }

  const res = await fetch(directUrl);
  if (!res.ok) {
    throw new Error(`Dropbox 링크에서 파일을 다운로드하지 못했습니다 (${res.status}). 링크 공유 설정을 확인하세요.`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { arrayBuffer, fileName };
}
