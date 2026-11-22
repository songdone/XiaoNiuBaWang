export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename.replace(/[/\\\0]/g, '_');
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
