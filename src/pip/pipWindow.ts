declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: {
        width?: number;
        height?: number;
        disallowReturnToOpener?: boolean;
      }): Promise<Window>;
      window: Window | null;
    };
  }
}

export function pipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

/**
 * Opens the always-on-top Document PiP window and copies every stylesheet in
 * (Document PiP windows start with no styles at all). Returns null when the
 * API is unavailable or the gesture was consumed.
 */
export async function openPipWindow(width: number, height: number): Promise<Window | null> {
  if (!pipSupported()) return null;
  try {
    const pip = await window.documentPictureInPicture!.requestWindow({
      width,
      height,
      disallowReturnToOpener: true,
    });
    copyStylesInto(pip);
    pip.document.title = 'framecast — controls';
    pip.document.documentElement.style.colorScheme = 'dark';
    // The deck is a video surface: always dark, regardless of the app theme.
    pip.document.documentElement.dataset.theme = 'dark';
    pip.document.body.className = document.body.className;
    return pip;
  } catch {
    return null;
  }
}

function copyStylesInto(pip: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      const style = pip.document.createElement('style');
      style.textContent = css;
      pip.document.head.appendChild(style);
    } catch {
      // Cross-origin stylesheet: link it instead.
      if (sheet.href) {
        const link = pip.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pip.document.head.appendChild(link);
      }
    }
  }
}
