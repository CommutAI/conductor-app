const WHITE_BG = /^(#fff(?:fff)?|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|white)$/i;

function isWhiteBackground(value: string | null | undefined): boolean {
  return !!value && WHITE_BG.test(value.trim());
}

/**
 * html5-qrcode injects #qr-shaded-region with white (#ffffff) corner brackets
 * via inline styles when qrbox is set. Strip them so the app's scan frame is used.
 */
export function stripQrShadedRegion(readerId: string): () => void {
  const hide = () => {
    const root = document.getElementById(readerId);
    if (!root) return;

    root.querySelectorAll('#qr-shaded-region, [id^="qr-shaded"]').forEach((node) => {
      const el = node as HTMLElement;
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
    });

    root.querySelectorAll('div').forEach((node) => {
      const el = node as HTMLElement;
      const bg = el.style.backgroundColor;
      if (isWhiteBackground(bg)) {
        el.style.display = 'none';
        el.style.backgroundColor = 'transparent';
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
      }
    });
  };

  hide();

  const root = document.getElementById(readerId);
  if (!root) return () => undefined;

  const observer = new MutationObserver(hide);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'id'] });
  return () => observer.disconnect();
}
