/**
 * Detects mobile/compact touch devices so mobile-only UI collapse and
 * performance optimizations never alter desktop behavior.
 */
export function isMobileDevice(): boolean {
  return (
    window.matchMedia("(max-width: 768px)").matches ||
    (window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 960)
  );
}

/**
 * Yields to the browser main thread so loading progress UI updates can paint
 * between heavy synchronous initialization tasks on mobile.
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
