/**
 * Ekstraksi teks PDF server-side (unpdf/pdf.js) — dipakai bersama
 * /api/ai/parse-case dan /api/chat sebagai "jangkar deterministik":
 * teks soal asli menjadi sumber kebenaran angka selain tampilan visual PDF.
 * Best-effort: gagal → string kosong, alur pemanggil tetap jalan.
 */
export async function extractPdfTextFromBase64(base64: string): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const buffer = Buffer.from(base64, 'base64');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    if (typeof text === 'string') return text;
    if (Array.isArray(text)) return (text as string[]).join('\n');
    return '';
  } catch (err) {
    console.warn('[pdf-text] Ekstraksi teks PDF gagal (dilanjutkan tanpa teks):', err instanceof Error ? err.message.slice(0, 120) : err);
    return '';
  }
}
