"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
].join(' ');

function useGoogleAccessToken() {
  const [token, setToken] = useState<string | null>(null);
  const tokenClientRef = useRef<any>(null);

  const ready = typeof window !== 'undefined' && !!(window as any).google && !!GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!ready) return;
    if (tokenClientRef.current) return;
    const google = (window as any).google;
    tokenClientRef.current = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (resp: any) => {
        if (resp && resp.access_token) setToken(resp.access_token);
      },
    });
  }, [ready]);

  const ensureToken = useCallback(async () => {
    return new Promise<string>((resolve, reject) => {
      if (!tokenClientRef.current) {
        reject(new Error('Google Identity not initialized'));
        return;
      }
      tokenClientRef.current.requestAccessToken({ prompt: token ? '' : 'consent' });
      const google = (window as any).google;
      const listener = (e: MessageEvent) => {
        // no-op: GIS invokes callback directly
      };
      window.addEventListener('message', listener);
      const check = () => {
        if (tokenClientRef.current && (google as any)) {
          // resolved by callback above
          if (token) {
            window.removeEventListener('message', listener);
            resolve(token);
          } else {
            setTimeout(check, 100);
          }
        } else {
          reject(new Error('GIS token client unavailable'));
        }
      };
      setTimeout(check, 100);
    });
  }, [token]);

  return { token, ensureToken, ready } as const;
}

async function createResumableSession(params: {
  token: string;
  file: File;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'private' | 'public' | 'unlisted';
  publishAt?: string | null;
}) {
  const { token, file, title, description, tags, privacyStatus, publishAt } = params;
  const endpoint = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
  const body = {
    snippet: {
      title,
      description,
      tags: tags.filter(Boolean),
      categoryId: '22',
    },
    status: {
      privacyStatus,
      publishAt: publishAt || undefined,
      selfDeclaredMadeForKids: false,
    },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.size),
      'X-Upload-Content-Type': file.type || 'video/*',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create upload session: ${res.status} ${text}`);
  }
  const location = res.headers.get('Location');
  if (!location) throw new Error('Upload session missing Location header');
  return location;
}

async function uploadInChunks(params: {
  sessionUrl: string;
  file: File;
  onProgress?: (pct: number) => void;
}) {
  const { sessionUrl, file, onProgress } = params;
  const chunkSize = 8 * 1024 * 1024; // 8 MiB
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
    const end = offset + chunk.size - 1;
    const contentRange = `bytes ${offset}-${end}/${file.size}`;

    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.size),
        'Content-Type': file.type || 'video/*',
        'Content-Range': contentRange,
      },
      body: chunk,
    });

    if (res.status === 308) {
      offset = end + 1;
      onProgress?.(Math.round((offset / file.size) * 100));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed: ${res.status} ${text}`);
    }

    // Completed
    onProgress?.(100);
    const json = await res.json();
    return json; // Video resource
  }
  throw new Error('Unexpected termination of upload loop');
}

export default function Page() {
  const { token, ensureToken, ready } = useGoogleAccessToken();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState<'private' | 'public' | 'unlisted'>('private');
  const [schedule, setSchedule] = useState<string>('');

  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [videoId, setVideoId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const canUpload = useMemo(() => !!file && !!title && ready && !!GOOGLE_CLIENT_ID, [file, title, ready]);

  const startAuth = useCallback(async () => {
    setError('');
    try {
      await ensureToken();
    } catch (err: any) {
      setError(err.message || 'Authorization failed');
    }
  }, [ensureToken]);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^/.]+$/, ''));
  };

  const onUpload = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setStatus('Requesting access token...');
    setProgress(0);
    setVideoId('');
    try {
      const accessToken = token || (await ensureToken());
      setStatus('Creating upload session...');
      const publishAt = schedule ? new Date(schedule).toISOString() : null;
      const sessionUrl = await createResumableSession({
        token: accessToken,
        file,
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        privacyStatus: privacy,
        publishAt,
      });

      setStatus('Uploading video...');
      const video = await uploadInChunks({
        sessionUrl,
        file,
        onProgress: setProgress,
      });
      setStatus('Upload completed');
      setVideoId(video?.id || '');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }, [file, title, description, tags, privacy, schedule, token, ensureToken]);

  return (
    <div className="card" style={{ padding: 20 }}>
      {!GOOGLE_CLIENT_ID && (
        <p className="badge warn">Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google auth</p>
      )}
      <div className="row">
        <div>
          <label>Video file</label>
          <input type="file" accept="video/*" onChange={onSelectFile} />
        </div>
        <div>
          <label>Privacy</label>
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value as any)}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div>
          <label>Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My awesome video" />
        </div>
        <div>
          <label>Tags (comma-separated)</label>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tech, vlog, coding" />
        </div>
      </div>

      <div>
        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your video..." />
      </div>

      <div className="row">
        <div>
          <label>Schedule publish (optional)</label>
          <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          <div className="small">If set, video will be scheduled via publishAt.</div>
        </div>
        <div>
          <label>Authorization</label>
          <div className="actions">
            <button onClick={startAuth} disabled={!ready || !GOOGLE_CLIENT_ID || busy}>
              {token ? 'Re-authorize' : 'Authorize Google'}
            </button>
          </div>
          <div className="small">Scopes: youtube, youtube.upload</div>
        </div>
      </div>

      <hr />

      <div className="actions">
        <button onClick={onUpload} disabled={!canUpload || busy}>{busy ? 'Uploading?' : 'Start Upload'}</button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="progress"><div style={{ width: `${progress}%` }} /></div>
        <div className="small" style={{ marginTop: 8 }}>{status}</div>
        {error && <div className="badge err" style={{ marginTop: 8 }}>{error}</div>}
        {videoId && (
          <div className="badge success" style={{ marginTop: 8 }}>
            Uploaded video ID: {videoId}
          </div>
        )}
      </div>

      <hr />
      <div className="small">
        This uploader uses the YouTube Data API with a browser-based resumable upload session to avoid server limits.
      </div>
    </div>
  );
}
