import maplibregl from 'maplibre-gl';

let registered = false;

const CLOUD_LOW_THRESHOLD = 132;
const CLOUD_HIGH_THRESHOLD = 242;

async function canvasToPngBuffer(
  canvas: OffscreenCanvas | HTMLCanvasElement
): Promise<ArrayBuffer> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas toBlob failed'));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });
}

export function registerCloudProtocol(): void {
  if (registered) return;
  registered = true;

  maplibregl.addProtocol('cloud-ir', async (params, abortController) => {
    const coords = params.url.replace('cloud-ir://', '');
    const remoteUrl = `https://realearth.ssec.wisc.edu/tiles/globalir/${coords}.png`;

    const response = await fetch(remoteUrl, { signal: abortController.signal });
    if (!response.ok) {
      return { data: new ArrayBuffer(0) };
    }

    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;

    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });

    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;

    if (!ctx) {
      bitmap.close();
      return { data: new ArrayBuffer(0) };
    }

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;
    const span = CLOUD_HIGH_THRESHOLD - CLOUD_LOW_THRESHOLD;

    for (let i = 0; i < pixels.length; i += 4) {
      const lum = pixels[i];
      if (lum <= CLOUD_LOW_THRESHOLD) {
        pixels[i + 3] = 0;
        continue;
      }

      const t = Math.min(1, (lum - CLOUD_LOW_THRESHOLD) / span);
      const smooth = t * t * (3 - 2 * t);

      pixels[i] = 246 + Math.round(9 * smooth);
      pixels[i + 1] = 250 + Math.round(5 * smooth);
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(smooth * 242);
    }

    ctx.putImageData(imgData, 0, 0);
    const data = await canvasToPngBuffer(canvas);
    return { data };
  });
}
