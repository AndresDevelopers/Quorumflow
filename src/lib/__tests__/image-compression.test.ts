import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImageForUpload, compressProfileImage } from '@/lib/image-compression';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Exercise the real compress pipeline with a stubbed Image + canvas so we can
 * assert size reduction without the `canvas` native package in jsdom.
 */
function stubCanvasPipeline(options: {
  naturalWidth: number;
  naturalHeight: number;
  /** bytes of the blob returned by toBlob */
  compressedBytes: number;
  mime?: string;
}) {
  const mime = options.mime || 'image/webp';

  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  // HTMLImageElement load via src assignment
  vi.spyOn(globalThis, 'Image').mockImplementation(function MockImage(this: HTMLImageElement) {
    const img = {
      width: options.naturalWidth,
      height: options.naturalHeight,
      naturalWidth: options.naturalWidth,
      naturalHeight: options.naturalHeight,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(_v: string) {
        queueMicrotask(() => img.onload?.());
      },
    };
    return img as unknown as HTMLImageElement;
  } as unknown as typeof Image);

  const toBlob = vi.fn(
    (cb: BlobCallback, _type?: string, _quality?: number) => {
      const bytes = new Uint8Array(options.compressedBytes);
      cb(new Blob([bytes], { type: mime }));
    }
  );

  const getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  }));

  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext,
        toBlob,
        toDataURL: () => `data:${mime};base64,AAAA`,
      } as unknown as HTMLCanvasElement;
    }
    return originalCreateElement(tag);
  });
}

describe('compressImageForUpload', () => {
  it('returns a smaller File that is what uploadBytes receives (size reduced before upload)', async () => {
    // Simulate a multi-MB phone photo (dimension + size) and a ~90KB compressed result
    const originalBytes = new Uint8Array(2_500_000);
    const original = new File([originalBytes], 'camera-original.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    stubCanvasPipeline({
      naturalWidth: 4000,
      naturalHeight: 3000,
      compressedBytes: 90_000,
      mime: 'image/webp',
    });

    const compressed = await compressProfileImage(original);

    expect(compressed).toBeInstanceOf(File);
    expect(compressed).not.toBe(original);
    expect(compressed.size).toBe(90_000);
    expect(compressed.size).toBeLessThan(original.size);
    expect(compressed.type).toBe('image/webp');
    expect(compressed.name.endsWith('.webp')).toBe(true);
  });

  it('leaves SVG files unchanged', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'icon.svg', {
      type: 'image/svg+xml',
    });
    const out = await compressImageForUpload(svg);
    expect(out).toBe(svg);
  });

  it('leaves non-image files unchanged', async () => {
    const pdf = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    const out = await compressImageForUpload(pdf);
    expect(out).toBe(pdf);
  });

  it('keeps already-tiny images without re-encoding (short-circuit)', async () => {
    const tiny = new File([new Uint8Array(8_000)], 'tiny.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    const out = await compressImageForUpload(tiny, {
      maxBytes: 400 * 1024,
      preferWebp: true,
    });
    // Under maxBytes/2 and < 200KB → return original reference
    expect(out).toBe(tiny);
  });
});
