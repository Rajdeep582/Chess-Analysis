import LZString from 'lz-string';

export function compressToUrl(text: string): string {
  return LZString.compressToEncodedURIComponent(text);
}

export function decompressFromUrl(data: string): string | null {
  try {
    const out = LZString.decompressFromEncodedURIComponent(data);
    return out || null;
  } catch {
    return null;
  }
}
