/**
 * Client-side image compression before Firebase Storage upload.
 * Reduces Storage size + download egress for lists and profiles.
 */

export type CompressImageOptions = {
  /** Max width or height in px (default 1280 for profiles/lists) */
  maxDimension?: number;
  /** JPEG/WebP quality 0–1 (default 0.78) */
  quality?: number;
  /** Prefer webp when supported (default true) */
  preferWebp?: boolean;
  /** Max output bytes hint — will lower quality once if still large (default 450KB) */
  maxBytes?: number;
};

const DEFAULTS: Required<CompressImageOptions> = {
  maxDimension: 1280,
  quality: 0.78,
  preferWebp: true,
  maxBytes: 450 * 1024,
};

function supportsWebp(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Fallo al comprimir la imagen'));
      },
      type,
      quality
    );
  });
}

/**
 * Compress an image File for upload. Returns a new File (webp or jpeg).
 * Non-image or SVG files are returned unchanged.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file;
  }

  // Already small enough — skip work
  const opts = { ...DEFAULTS, ...options };
  if (file.size <= opts.maxBytes / 2 && file.size < 200 * 1024) {
    return file;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return file;
  }

  try {
    const img = await loadImage(file);
    let { width, height } = img;

    const maxDim = opts.maxDimension;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);

    const useWebp = opts.preferWebp && supportsWebp();
    const mime = useWebp ? 'image/webp' : 'image/jpeg';
    const ext = useWebp ? 'webp' : 'jpg';

    let quality = opts.quality;
    let blob = await canvasToBlob(canvas, mime, quality);

    // Second pass if still large
    if (blob.size > opts.maxBytes && quality > 0.5) {
      quality = Math.max(0.5, quality - 0.15);
      blob = await canvasToBlob(canvas, mime, quality);
    }

    // If compression somehow grew the file, keep original
    if (blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.${ext}`, {
      type: mime,
      lastModified: Date.now(),
    });
  } catch (error) {
    console.warn('[image-compression] fallback to original file', error);
    return file;
  }
}

/** Gallery / high-detail photos (baptism, activities) */
export function compressGalleryImage(file: File): Promise<File> {
  return compressImageForUpload(file, {
    maxDimension: 1920,
    quality: 0.8,
    maxBytes: 700 * 1024,
  });
}

/** Profile / avatar / list photos */
export function compressProfileImage(file: File): Promise<File> {
  return compressImageForUpload(file, {
    maxDimension: 1280,
    quality: 0.78,
    maxBytes: 400 * 1024,
  });
}
