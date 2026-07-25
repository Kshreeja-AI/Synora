import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement ResizeObserver at all. Radix primitives that
 * measure themselves (Checkbox, Switch) construct one on mount via a
 * layout effect, which throws "ResizeObserver is not defined" in any test
 * that renders them — regardless of whether the component under test uses
 * Checkbox/Switch directly. A no-op stub is the standard fix recommended
 * by Radix's own testing docs.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
