function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

export function decodePcm16Base64(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const pcm = new Int16Array(bytes.buffer);
  const samples = new Float32Array(pcm.length);

  for (let index = 0; index < pcm.length; index += 1) {
    samples[index] = pcm[index] / 0x8000;
  }

  return samples;
}
