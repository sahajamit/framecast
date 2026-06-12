/**
 * Device enumeration + permission priming. Labels are only populated after
 * the user has granted camera/mic permission at least once.
 */
export async function primePermissions(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    // Camera might be missing — retry audio-only before giving up.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch {
      return false;
    }
  }
}

export async function listDevices(): Promise<{
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
}> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    cams: all.filter((d) => d.kind === 'videoinput'),
    mics: all.filter((d) => d.kind === 'audioinput'),
  };
}

export function onDeviceChange(listener: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', listener);
  return () => navigator.mediaDevices.removeEventListener('devicechange', listener);
}
