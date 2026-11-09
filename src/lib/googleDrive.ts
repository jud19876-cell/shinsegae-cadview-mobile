/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// In-memory token storage (DO NOT persist in localStorage or sessionStorage)
let inMemoryDriveAccessToken: string | null = null;

export interface GoogleAuthUser {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  uid?: string;
}

let currentGoogleUser: GoogleAuthUser | null = null;
const authListeners: Array<(user: GoogleAuthUser | null) => void> = [];

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  size?: string;
  mimeType: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  iconLink?: string;
  webContentLink?: string;
}

declare global {
  interface Window {
    google?: any;
  }
}

/**
 * Returns current cached access token
 */
export function getDriveAccessToken(): string | null {
  return inMemoryDriveAccessToken;
}

/**
 * Returns current authenticated Google user
 */
export function getCurrentGoogleUser(): GoogleAuthUser | null {
  return currentGoogleUser;
}

function notifyAuthState(user: GoogleAuthUser | null) {
  currentGoogleUser = user;
  authListeners.forEach((cb) => cb(user));
}

/**
 * Listen to Google Auth state changes
 */
export function subscribeToGoogleAuth(callback: (user: GoogleAuthUser | null) => void) {
  authListeners.push(callback);
  callback(currentGoogleUser);

  // Also hook into Firebase Auth if Firebase is used
  const unsubscribeFirebase = onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser && inMemoryDriveAccessToken) {
      const u: GoogleAuthUser = {
        displayName: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL,
        uid: firebaseUser.uid,
      };
      notifyAuthState(u);
    }
  });

  return () => {
    const idx = authListeners.indexOf(callback);
    if (idx !== -1) authListeners.splice(idx, 1);
    unsubscribeFirebase();
  };
}

/**
 * Ensure Google Identity Services (GSI) script is loaded
 */
export async function ensureGsiLoaded(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.google?.accounts?.oauth2) return true;

  return new Promise((resolve) => {
    let checkCount = 0;
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(interval);
        resolve(true);
      }
      checkCount++;
      if (checkCount > 15) {
        clearInterval(interval);
        resolve(Boolean(window.google?.accounts?.oauth2));
      }
    }, 100);
  });
}

/**
 * Primary Sign In using Google Identity Services (GIS) Token Client
 * Bypasses third-party cookie restrictions and identitytoolkit network blocks
 */
async function signInWithGsi(): Promise<{ user: GoogleAuthUser; accessToken: string }> {
  await ensureGsiLoaded();

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services 라이브러리를 불러오지 못했습니다.');
  }

  const clientId = firebaseConfig.oAuthClientId;
  if (!clientId) {
    throw new Error('OAuth Client ID가 구성되지 않았습니다.');
  }

  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope:
          'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (response: any) => {
          if (response.error) {
            console.error('GSI token response error:', response);
            reject(new Error(response.error_description || response.error || 'Google 인증에 실패했습니다.'));
            return;
          }

          const accessToken = response.access_token;
          if (!accessToken) {
            reject(new Error('Google Drive 접근 토큰을 발급받지 못했습니다.'));
            return;
          }

          inMemoryDriveAccessToken = accessToken;

          // Fetch user profile info using the token
          let user: GoogleAuthUser = {
            displayName: 'Google Drive 사용자',
            email: '',
          };

          try {
            const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (profileRes.ok) {
              const profile = await profileRes.json();
              user = {
                displayName: profile.name || profile.email || 'Google 사용자',
                email: profile.email || '',
                photoURL: profile.picture,
                uid: profile.sub,
              };
            }
          } catch (e) {
            console.warn('Failed to fetch userinfo from Google:', e);
          }

          notifyAuthState(user);
          resolve({ user, accessToken });
        },
      });

      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fallback Sign In using Firebase Auth signInWithPopup
 */
async function signInWithFirebasePopup(): Promise<{ user: GoogleAuthUser; accessToken: string }> {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');
  provider.setCustomParameters({
    prompt: 'select_account',
  });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;

  if (!token) {
    throw new Error('Google Drive 접근 토큰을 발급받지 못했습니다.');
  }

  inMemoryDriveAccessToken = token;
  const user: GoogleAuthUser = {
    displayName: result.user.displayName,
    email: result.user.email,
    photoURL: result.user.photoURL,
    uid: result.user.uid,
  };
  notifyAuthState(user);
  return { user, accessToken: token };
}

/**
 * Main Sign In function: Tries Google Identity Services first, falls back to Firebase Auth
 */
export async function signInWithGoogleDrive(): Promise<{
  user: GoogleAuthUser;
  accessToken: string;
}> {
  // Strategy 1: Google Identity Services (GIS) Token Client
  try {
    const hasGsi = await ensureGsiLoaded();
    if (hasGsi && window.google?.accounts?.oauth2) {
      return await signInWithGsi();
    }
  } catch (gsiError: any) {
    console.warn('GSI sign-in failed, trying Firebase popup fallback:', gsiError);
    if (gsiError?.message?.includes('popup_closed') || gsiError?.message?.includes('closed')) {
      throw new Error('로그인 팝업이 닫혔습니다.');
    }
  }

  // Strategy 2: Firebase Auth signInWithPopup
  try {
    return await signInWithFirebasePopup();
  } catch (firebaseError: any) {
    console.error('Firebase Auth sign-in failed:', firebaseError);

    if (firebaseError?.code === 'auth/popup-closed-by-user') {
      throw new Error('로그인 팝업이 닫혔습니다.');
    }

    if (
      firebaseError?.code === 'auth/network-request-failed' ||
      firebaseError?.message?.includes('network-request-failed')
    ) {
      throw new Error(
        '브라우저의 팝업 차단 또는 서드파티 쿠키 차단으로 인해 네트워크 통신이 실패했습니다. 아래 [공유 링크 직접 열기] 또는 [토큰 입력]을 이용해 보세요.'
      );
    }

    throw firebaseError;
  }
}

/**
 * Connect with a manually provided Google Access Token
 */
export async function connectWithGoogleToken(
  token: string
): Promise<{ user: GoogleAuthUser; accessToken: string }> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Google 액세스 토큰을 입력해 주세요.');
  }

  // Verify token by querying userinfo
  let user: GoogleAuthUser = {
    displayName: 'Google 계정',
    email: '',
  };

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${cleanToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      user = {
        displayName: data.name || data.email || 'Google 사용자',
        email: data.email || '',
        photoURL: data.picture,
        uid: data.sub,
      };
    }
  } catch {
    // If userinfo endpoint fails, verify with drive endpoint directly
  }

  // Test drive access
  const driveCheck = await fetch(
    'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',
    {
      headers: { Authorization: `Bearer ${cleanToken}` },
    }
  );

  if (!driveCheck.ok) {
    if (driveCheck.status === 401) {
      throw new Error('유효하지 않거나 만료된 Google Drive 토큰입니다.');
    }
    throw new Error(`Google Drive 토큰 검증 실패 (${driveCheck.status})`);
  }

  inMemoryDriveAccessToken = cleanToken;
  notifyAuthState(user);
  return { user, accessToken: cleanToken };
}

/**
 * Sign out from Google Drive
 */
export async function signOutFromGoogleDrive(): Promise<void> {
  inMemoryDriveAccessToken = null;
  notifyAuthState(null);
  try {
    await signOut(auth);
  } catch {
    // Ignore sign out errors
  }
}

/**
 * List DWG & DXF files from Google Drive
 */
export async function listGoogleDriveDwgFiles(
  searchKeyword: string = '',
  nextPageToken?: string
): Promise<{ files: GoogleDriveFileItem[]; nextPageToken?: string }> {
  if (!inMemoryDriveAccessToken) {
    throw new Error('Google Drive 로그인이 필요합니다.');
  }

  // Filters for DWG and DXF extensions or CAD MIME types, excluding trashed
  let query =
    "(name contains '.dwg' or name contains '.DWG' or name contains '.dxf' or name contains '.DXF' or mimeType = 'application/acad' or mimeType = 'image/vnd.dwg' or mimeType = 'image/vnd.dxf') and trashed = false";

  if (searchKeyword.trim()) {
    const escaped = searchKeyword.replace(/'/g, "\\'");
    query += ` and name contains '${escaped}'`;
  }

  const fields =
    'nextPageToken,files(id,name,size,mimeType,modifiedTime,thumbnailLink,iconLink,webContentLink)';
  const params = new URLSearchParams({
    q: query,
    fields,
    pageSize: '50',
    orderBy: 'modifiedTime desc',
  });

  if (nextPageToken) {
    params.set('pageToken', nextPageToken);
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${inMemoryDriveAccessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      inMemoryDriveAccessToken = null;
      notifyAuthState(null);
      throw new Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
    const errText = await response.text();
    console.error('Drive API error response:', errText);
    throw new Error(`Google Drive 파일 목록 조회 실패 (${response.status})`);
  }

  const data = await response.json();
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Download a file from Google Drive as ArrayBuffer
 */
export async function downloadGoogleDriveFile(fileId: string): Promise<ArrayBuffer> {
  if (!inMemoryDriveAccessToken) {
    throw new Error('Google Drive 로그인이 필요합니다.');
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${inMemoryDriveAccessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      inMemoryDriveAccessToken = null;
      notifyAuthState(null);
      throw new Error('인증이 만료되었습니다. 다시 로그인해 주세요.');
    }
    throw new Error(`Google Drive 파일 다운로드 실패 (${response.status})`);
  }

  return await response.arrayBuffer();
}

/**
 * Extract Google Drive file ID from a link or string
 */
export function extractGoogleDriveFileId(urlOrId: string): string | null {
  const str = urlOrId.trim();
  if (!str) return null;

  // Direct alphanumeric ID check
  if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) {
    return str;
  }

  // /file/d/FILE_ID pattern
  const match1 = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match1 && match1[1]) return match1[1];

  // id=FILE_ID pattern
  const match2 = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match2 && match2[1]) return match2[1];

  return null;
}

/**
 * Download DWG/DXF directly from a Google Drive shared link
 */
export async function downloadFromGoogleDriveSharedLink(
  sharedUrlOrId: string
): Promise<{ arrayBuffer: ArrayBuffer; fileName: string }> {
  const fileId = extractGoogleDriveFileId(sharedUrlOrId);
  if (!fileId) {
    throw new Error('유효한 Google Drive 파일 ID 또는 공유 링크를 찾을 수 없습니다.');
  }

  // If we have an active access token, use Drive v3 API to get metadata & binary
  if (inMemoryDriveAccessToken) {
    try {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name`,
        {
          headers: { Authorization: `Bearer ${inMemoryDriveAccessToken}` },
        }
      );
      let fileName = 'googledrive_drawing.dwg';
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.name) fileName = meta.name;
      }
      const buffer = await downloadGoogleDriveFile(fileId);
      return { arrayBuffer: buffer, fileName };
    } catch (e) {
      console.warn('Authenticated download failed, falling back to public download:', e);
    }
  }

  // Direct public download link
  const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  const res = await fetch(directUrl);
  if (!res.ok) {
    throw new Error(`Google Drive에서 파일을 다운로드하지 못했습니다 (${res.status}). 파일의 '링크가 있는 모든 사용자' 공유 설정을 확인하세요.`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { arrayBuffer, fileName: 'googledrive_drawing.dwg' };
}

/**
 * Helper to format file size
 */
export function formatFileSize(bytes?: string | number): string {
  if (!bytes) return '크기 미상';
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}
