import JSZip from 'jszip';
import * as XLSX from 'xlsx';

export interface ProcessedFilePart {
  type: 'inlineData' | 'text';
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
  text?: string;
  fileName: string;
}

/**
 * Extracts plain text from XML by extracting content inside tags (e.g. <w:t>, <a:t>)
 */
function extractXmlText(xml: string): string {
  // Replace line breaks and paragraph ends
  const withBreaks = xml
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/a:p>/gi, '\n')
    .replace(/<w:tab\/>/gi, '\t')
    .replace(/<a:tab\/>/gi, '\t');
  // Strip tags
  const text = withBreaks.replace(/<[^>]+>/g, ' ');
  // Clean whitespace
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Processes a base64 encoded uploaded file into either:
 * - inlineData part for Gemini (Images, PDF)
 * - text part for Gemini (Word docx, PowerPoint pptx, Excel xlsx, CSV, TXT)
 */
export async function processUploadedFile(file: {
  name: string;
  type: string;
  base64: string;
}): Promise<ProcessedFilePart> {
  const { name, type, base64 } = file;
  const buffer = Buffer.from(base64, 'base64');
  const lowerName = name.toLowerCase();

  // 1. PDF
  if (type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return {
      type: 'inlineData',
      inlineData: {
        mimeType: 'application/pdf',
        data: base64,
      },
      fileName: name,
    };
  }

  // 2. Images (JPEG, PNG, WEBP, GIF)
  if (
    type.startsWith('image/') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.webp')
  ) {
    let mime = type;
    if (!mime || mime === 'application/octet-stream') {
      if (lowerName.endsWith('.png')) mime = 'image/png';
      else if (lowerName.endsWith('.webp')) mime = 'image/webp';
      else mime = 'image/jpeg';
    }
    return {
      type: 'inlineData',
      inlineData: {
        mimeType: mime,
        data: base64,
      },
      fileName: name,
    };
  }

  // 3. Word Document (.docx)
  if (lowerName.endsWith('.docx')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const docXmlFile = zip.file('word/document.xml');
      if (docXmlFile) {
        const docXml = await docXmlFile.async('text');
        const extracted = extractXmlText(docXml);
        return {
          type: 'text',
          text: `[Dokumen Word: ${name}]\n${extracted}`,
          fileName: name,
        };
      }
    } catch (err) {
      console.warn(`Gagal membaca docx ${name}:`, err);
    }
  }

  // 4. PowerPoint Presentation (.pptx)
  if (lowerName.endsWith('.pptx')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = Object.keys(zip.files)
        .filter((f) => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
        .sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
          const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
          return numA - numB;
        });

      let slidesText = `[Presentasi PowerPoint: ${name}]\n`;
      for (const s of slideFiles) {
        const slideXml = await zip.file(s)?.async('text');
        if (slideXml) {
          const slideNumber = s.replace(/\D/g, '');
          const content = extractXmlText(slideXml);
          if (content) {
            slidesText += `--- Slide ${slideNumber} ---\n${content}\n`;
          }
        }
      }

      return {
        type: 'text',
        text: slidesText,
        fileName: name,
      };
    } catch (err) {
      console.warn(`Gagal membaca pptx ${name}:`, err);
    }
  }

  // 5. Excel Spreadsheet (.xlsx, .xls)
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || type.includes('spreadsheet')) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let sheetTexts = `[File Excel: ${name}]\n`;
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (csv && csv.trim().length > 0) {
          sheetTexts += `--- Sheet: ${sheetName} ---\n${csv}\n`;
        }
      });

      return {
        type: 'text',
        text: sheetTexts,
        fileName: name,
      };
    } catch (err) {
      console.warn(`Gagal membaca excel ${name}:`, err);
    }
  }

  // 6. Text, CSV, JSON, Markdown
  if (
    type.startsWith('text/') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.json')
  ) {
    const textContent = buffer.toString('utf-8');
    return {
      type: 'text',
      text: `[File Teks: ${name}]\n${textContent}`,
      fileName: name,
    };
  }

  // Fallback: treat as raw text or notice
  return {
    type: 'text',
    text: `[Lampiran File: ${name} (${type || 'unknown type'}, ${buffer.length} bytes)]`,
    fileName: name,
  };
}
