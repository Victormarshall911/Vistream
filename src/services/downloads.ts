import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DownloadTask {
  id: string; // Typically the media ID
  title: string;
  url: string;
  status: 'downloading' | 'paused' | 'completed' | 'error';
  progress: number; // 0 to 1
  localUri?: string;
  type: 'movie' | 'series' | 'anime';
}

// In-memory reference for resumables to allow pausing/resuming
const activeDownloads: Record<string, FileSystem.DownloadResumable> = {};
const DOWNLOAD_STORAGE_KEY = 'vistream_downloads';

// Helper to get stored downloads
export async function getStoredDownloads(): Promise<Record<string, DownloadTask>> {
  try {
    const data = await AsyncStorage.getItem(DOWNLOAD_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Failed to load downloads', e);
    return {};
  }
}

// Helper to save downloads
async function saveDownloads(downloads: Record<string, DownloadTask>) {
  try {
    await AsyncStorage.setItem(DOWNLOAD_STORAGE_KEY, JSON.stringify(downloads));
  } catch (e) {
    console.error('Failed to save downloads', e);
  }
}

// Helper to trigger state updates for the UI
type DownloadStateListener = (downloads: DownloadTask[]) => void;
const listeners: Set<DownloadStateListener> = new Set();

export function subscribeToDownloads(listener: DownloadStateListener) {
  listeners.add(listener);
  // Send initial state
  getStoredDownloads().then(downloads => {
    listener(Object.values(downloads));
  });
  return () => listeners.delete(listener);
}

async function notifyListeners() {
  const downloads = await getStoredDownloads();
  const list = Object.values(downloads);
  listeners.forEach(l => l(list));
}

export async function startDownload(
  id: string,
  title: string,
  url: string,
  type: 'movie' | 'series' | 'anime'
) {
  // Only mp4s are supported for now based on the previous decision
  if (!url.endsWith('.mp4')) {
    throw new Error('Only .mp4 files can be downloaded directly.');
  }

  const downloads = await getStoredDownloads();
  
  if (downloads[id] && downloads[id].status === 'completed') {
    return; // Already downloaded
  }

  const fileUri = `${FileSystem.documentDirectory}${id}_${Date.now()}.mp4`;

  downloads[id] = {
    id,
    title,
    url,
    status: 'downloading',
    progress: 0,
    type,
  };
  await saveDownloads(downloads);
  notifyListeners();

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    fileUri,
    {},
    async (downloadProgress) => {
      const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
      const currentDownloads = await getStoredDownloads();
      if (currentDownloads[id]) {
         currentDownloads[id].progress = progress;
         await saveDownloads(currentDownloads);
         notifyListeners();
      }
    }
  );

  activeDownloads[id] = downloadResumable;

  try {
    const result = await downloadResumable.downloadAsync();
    const currentDownloads = await getStoredDownloads();
    if (result && currentDownloads[id]) {
      currentDownloads[id].status = 'completed';
      currentDownloads[id].localUri = result.uri;
      currentDownloads[id].progress = 1;
      await saveDownloads(currentDownloads);
      notifyListeners();
    }
  } catch (e) {
    console.error('Download failed', e);
    const currentDownloads = await getStoredDownloads();
    if (currentDownloads[id]) {
      currentDownloads[id].status = 'error';
      await saveDownloads(currentDownloads);
      notifyListeners();
    }
  } finally {
    delete activeDownloads[id];
  }
}

export async function pauseDownload(id: string) {
  if (activeDownloads[id]) {
    await activeDownloads[id].pauseAsync();
    const currentDownloads = await getStoredDownloads();
    if (currentDownloads[id]) {
      currentDownloads[id].status = 'paused';
      await saveDownloads(currentDownloads);
      notifyListeners();
    }
  }
}

export async function resumeDownload(id: string) {
  if (activeDownloads[id]) {
    const currentDownloads = await getStoredDownloads();
    if (currentDownloads[id]) {
      currentDownloads[id].status = 'downloading';
      await saveDownloads(currentDownloads);
      notifyListeners();
    }
    
    try {
      const result = await activeDownloads[id].resumeAsync();
      const latestDownloads = await getStoredDownloads();
      if (result && latestDownloads[id]) {
        latestDownloads[id].status = 'completed';
        latestDownloads[id].localUri = result.uri;
        latestDownloads[id].progress = 1;
        await saveDownloads(latestDownloads);
        notifyListeners();
      }
    } catch (e) {
      console.error('Failed to resume download', e);
      const latestDownloads = await getStoredDownloads();
      if (latestDownloads[id]) {
         latestDownloads[id].status = 'error';
         await saveDownloads(latestDownloads);
         notifyListeners();
      }
    } finally {
      delete activeDownloads[id];
    }
  }
}

export async function deleteDownload(id: string) {
  const currentDownloads = await getStoredDownloads();
  const download = currentDownloads[id];
  
  if (download) {
    if (activeDownloads[id]) {
      await activeDownloads[id].pauseAsync();
      delete activeDownloads[id];
    }
    
    if (download.localUri) {
      try {
        await FileSystem.deleteAsync(download.localUri);
      } catch (e) {
        console.error('Failed to delete file', e);
      }
    }
    
    delete currentDownloads[id];
    await saveDownloads(currentDownloads);
    notifyListeners();
  }
}
