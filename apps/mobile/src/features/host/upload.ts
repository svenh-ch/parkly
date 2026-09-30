import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { IMAGE_MAX_BYTES, type HostSpot } from '@parking/shared';
import { ApiError } from '@parking/api-client';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { mediaUrl } from '@/lib/media';

/**
 * Fotos auswählen, verkleinern, Metadaten entfernen und direkt in den Speicher hochladen.
 *
 * Datenschutz: Beim Neu-Kodieren als JPEG gehen alle EXIF-Daten verloren (GPS-Position,
 * Kamera, Aufnahmezeit). Das Original verlässt das Handy nie.
 */

const MAX_SIDE = 2048;
const QUALITY = 0.82;

export type UploadStatus = 'processing' | 'uploading' | 'finishing' | 'error';

export interface PendingPhoto {
  localId: string;
  uri: string;
  status: UploadStatus;
  progress: number;
  error: string | null;
}

async function prepare(asset: ImagePicker.ImagePickerAsset) {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width || 0, asset.height || 0);
  if (longest > MAX_SIDE) {
    if ((asset.width || 0) >= (asset.height || 0)) ctx.resize({ width: MAX_SIDE });
    else ctx.resize({ height: MAX_SIDE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  const blob = await (await fetch(out.uri)).blob();
  return { uri: out.uri, width: out.width, height: out.height, blob };
}

function put(url: string, headers: Record<string, string>, body: Blob, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Keine Verbindung. Bitte erneut versuchen.'));
    xhr.ontimeout = () => reject(new Error('Zeitüberschreitung beim Hochladen'));
    xhr.timeout = 120_000;
    xhr.send(body);
  });
}

export function usePhotoUploads(spotId: string | null, onSpot: (spot: HostSpot) => void) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const assets = useRef(new Map<string, ImagePicker.ImagePickerAsset>());
  const patch = (localId: string, p: Partial<PendingPhoto>) =>
    setPending((list) => list.map((x) => (x.localId === localId ? { ...x, ...p } : x)));

  const run = useCallback(
    async (localId: string) => {
      const asset = assets.current.get(localId);
      if (!asset || !spotId) return;
      patch(localId, { status: 'processing', progress: 0, error: null });
      let imageId: string | null = null;
      try {
        const img = await prepare(asset);
        if (img.blob.size > IMAGE_MAX_BYTES) throw new Error('Das Foto ist auch verkleinert grösser als 10 MB');
        const ticket = await api.host.requestImageUpload(spotId, {
          kind: 'OTHER',
          mimeType: 'image/jpeg',
          bytes: img.blob.size,
          width: img.width,
          height: img.height,
        });
        imageId = ticket.image.id;
        patch(localId, { status: 'uploading' });
        await put(mediaUrl(ticket.upload.url), ticket.upload.headers, img.blob, (p) => patch(localId, { progress: p }));
        patch(localId, { status: 'finishing', progress: 1 });
        await api.host.completeImageUpload(spotId, ticket.image.id);
        onSpot(await api.host.get(spotId));
        setPending((list) => list.filter((x) => x.localId !== localId));
        assets.current.delete(localId);
      } catch (e) {
        // Halbfertigen Eintrag aufräumen, damit er nicht als Foto zählt
        if (imageId) await api.host.deleteImage(spotId, imageId).catch(() => undefined);
        patch(localId, { status: 'error', error: e instanceof ApiError ? userMessage(e) : e instanceof Error ? e.message : userMessage(e) });
      }
    },
    [spotId, onSpot],
  );

  const add = useCallback(
    async (source: 'library' | 'camera', remaining: number) => {
      if (remaining <= 0) return;
      const perm =
        source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted && Platform.OS !== 'web') throw new Error('Bitte erlaube den Zugriff in den Einstellungen.');
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
      const res =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: remaining, orderedSelection: true });
      if (res.canceled) return;
      const picked = res.assets.slice(0, remaining).map((a, i) => {
        const localId = `${Date.now()}-${i}`;
        assets.current.set(localId, a);
        return { localId, uri: a.uri, status: 'processing' as const, progress: 0, error: null };
      });
      setPending((list) => [...list, ...picked]);
      // Nacheinander hochladen: schont Mobilfunk und das Kontingent
      for (const p of picked) await run(p.localId);
    },
    [run],
  );

  const retry = (localId: string) => void run(localId);
  const dismiss = (localId: string) => {
    assets.current.delete(localId);
    setPending((list) => list.filter((x) => x.localId !== localId));
  };

  return { pending, add, retry, dismiss };
}
