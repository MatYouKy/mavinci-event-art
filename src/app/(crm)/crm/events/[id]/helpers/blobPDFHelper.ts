export const dataUriToBlob = (dataUri: string): Blob => {
  // "data:application/pdf;base64,AAAA..."
  const parts = dataUri.split(',');
  const mimeMatch = parts[0].match(/data:(.*?);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/pdf';
  const binary = atob(parts[1]);
  const len = binary.length;
  const buffer = new ArrayBuffer(len);
  const view = new Uint8Array(buffer);

  for (let i = 0; i < len; i++) {
    view[i] = binary.charCodeAt(i);
  }

  return new Blob([buffer], { type: mimeType });
};