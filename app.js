/* ==========================================================================
   PDF Studio Pro — Unified Application Bundle
   Order: 1. Core -> 2. Conversion Tools -> 3. PDF Tools -> 4. UI Controller
   ========================================================================== */

/* ==========================================================================
   PDF Studio Pro — Core Utilities, Memory Management & Library Wrappers
   ========================================================================== */

(function (global) {
  "use strict";

  const PDFJS_WORKER_CDN =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const VIETNAMESE_FONT_URLS = [
    "https://cdn.jsdelivr.net/gh/bettergui/BeVietnamPro@main/fonts/ttf/BeVietnamPro-SemiBold.ttf",
    "https://cdn.jsdelivr.net/gh/bettergui/BeVietnamPro@main/fonts/ttf/BeVietnamPro-Regular.ttf",
  ];

  const trackedObjectUrls = new Set();
  let cachedFontBytes = null;
  let fontFetchAttempted = false;
  let workerInitPromise = null;

  /* --------------------------------------------------------------------------
     Library & PDF.js Worker Initialization
     -------------------------------------------------------------------------- */

  function configurePdfWorkerSync() {
    if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    }
  }

  async function ensurePdfWorkerReady() {
    configurePdfWorkerSync();
    if (!global.pdfjsLib) return;
    if (workerInitPromise) return workerInitPromise;

    workerInitPromise = (async () => {
      try {
        const res = await fetch(PDFJS_WORKER_CDN, { mode: "cors" });
        if (!res.ok) return;
        const scriptText = await res.text();
        const blob = new Blob([scriptText], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        // Verify Web Worker can actually start from Blob URL (works on https:// and modern file://)
        const testWorker = new Worker(blobUrl);
        testWorker.terminate();
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
      } catch (_err) {
        // Fallback silently to CDN URL (pdf.js handles fake worker automatically)
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
      }
    })();

    return workerInitPromise;
  }

  function checkRequiredLibraries() {
    const missing = [];
    if (!global.PDFLib) missing.push("pdf-lib");
    if (!global.pdfjsLib) missing.push("pdf.js");
    if (!global.docx) missing.push("docx");
    if (!global.JSZip) missing.push("JSZip");
    return missing;
  }

  /* --------------------------------------------------------------------------
     Memory Management & Safe Downloads
     -------------------------------------------------------------------------- */

  function trackObjectUrl(url) {
    if (url) trackedObjectUrls.add(url);
    return url;
  }

  function revokeTrackedUrl(url) {
    if (!url) return;
    if (trackedObjectUrls.has(url)) {
      trackedObjectUrls.delete(url);
    }
    try {
      URL.revokeObjectURL(url);
    } catch (_e) {
      // ignore
    }
  }

  function revokeAllTrackedUrls() {
    trackedObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_e) {
        // ignore
      }
    });
    trackedObjectUrls.clear();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Free memory shortly after browser begins saving
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_e) {
        // ignore
      }
    }, 2000);
  }

  /* --------------------------------------------------------------------------
     Formatting, Sanitization & UI Feedback
     -------------------------------------------------------------------------- */

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exp);
    return `${value >= 10 || exp === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[exp]}`;
  }

  function stripExtension(filename) {
    return String(filename || "tai_lieu").replace(/\.[^/.]+$/, "");
  }

  function sanitizeFilename(rawName, extension) {
    const cleanExt = extension.startsWith(".") ? extension : `.${extension}`;
    const cleaned = String(rawName || "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ");
    const base = cleaned || "pdf_studio_output";
    return base.toLowerCase().endsWith(cleanExt.toLowerCase()) ? base : `${base}${cleanExt}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function setProgress(percent, statusText, isDone = false) {
    const fill = document.getElementById("progressFill");
    const pctEl = document.getElementById("progressPercent");
    const statusEl = document.getElementById("progressStatus");
    const track = document.querySelector(".progress-track");

    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (fill) {
      fill.style.width = `${clamped}%`;
      fill.classList.toggle("is-done", Boolean(isDone));
    }
    if (pctEl) pctEl.textContent = `${clamped}%`;
    if (statusEl && statusText !== undefined) statusEl.textContent = statusText;
    if (track) track.setAttribute("aria-valuenow", String(clamped));
  }

  function showToast(type, title, message, duration = 4800) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const icons = {
      success: "✅",
      error: "❌",
      warning: "⚠️",
      info: "ℹ️",
    };

    const toast = document.createElement("div");
    toast.className = `toast is-${type || "info"}`;
    toast.innerHTML = `
      <div class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</div>
      <div class="toast-body">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="toast-msg">${escapeHtml(message)}</div>` : ""}
      </div>
      <button type="button" class="toast-close" aria-label="Đóng thông báo">✕</button>
    `;

    const closeBtn = toast.querySelector(".toast-close");
    const removeToast = () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    };
    closeBtn.addEventListener("click", removeToast);
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(removeToast, duration);
    }
  }

  /* --------------------------------------------------------------------------
     PDF Validation & Friendly Vietnamese Error Translation
     -------------------------------------------------------------------------- */

  function hasPdfSignature(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 5) return false;
    const head = new Uint8Array(arrayBuffer, 0, Math.min(1024, arrayBuffer.byteLength));
    // %PDF- may appear within the first 1024 bytes according to PDF spec
    for (let i = 0; i <= head.length - 5; i++) {
      if (
        head[i] === 0x25 && // %
        head[i + 1] === 0x50 && // P
        head[i + 2] === 0x44 && // D
        head[i + 3] === 0x46 && // F
        head[i + 4] === 0x2d // -
      ) {
        return true;
      }
    }
    return false;
  }

  function translatePdfError(err, fileName) {
    const prefix = fileName ? `"${fileName}": ` : "";
    const msg = String((err && (err.message || err.name)) || err || "");
    const lower = msg.toLowerCase();

    if (
      (err && err.name === "PasswordException") ||
      lower.includes("password") ||
      lower.includes("encrypted")
    ) {
      return `${prefix}File PDF đang được bảo vệ bằng mật khẩu. Vui lòng gỡ mật khẩu trước khi tải lên.`;
    }
    if (
      lower.includes("invalid pdf") ||
      lower.includes("formaterror") ||
      lower.includes("no pdf header") ||
      lower.includes("unexpected end") ||
      lower.includes("failed to parse")
    ) {
      return `${prefix}Tệp không đúng định dạng PDF hoặc dữ liệu PDF bị lỗi/hỏng.`;
    }
    if (lower.includes("cmyk") || lower.includes("not a valid jpg") || lower.includes("not a png")) {
      return `${prefix}Định dạng ảnh không hợp lệ hoặc bị hỏng.`;
    }
    return `${prefix}${msg || "Đã xảy ra lỗi không xác định khi xử lý tệp."}`;
  }

  async function readFileAsArrayBuffer(file) {
    return await file.arrayBuffer();
  }

  async function openPdfWithPdfJs(arrayBuffer, fileName) {
    await ensurePdfWorkerReady();
    if (!hasPdfSignature(arrayBuffer)) {
      throw new Error(`${fileName ? `"${fileName}": ` : ""}Tệp không phải là file PDF hợp lệ (thiếu chữ ký %PDF-).`);
    }

    // Pass a sliced copy so pdf.js worker transfer never detaches the caller's ArrayBuffer
    const copy = new Uint8Array(arrayBuffer.slice(0));
    try {
      const loadingTask = global.pdfjsLib.getDocument({
        data: copy,
        disableAutoFetch: false,
        disableStream: false,
      });
      return await loadingTask.promise;
    } catch (err) {
      throw new Error(translatePdfError(err, fileName));
    }
  }

  async function openPdfWithPdfLib(arrayBuffer, fileName) {
    if (!hasPdfSignature(arrayBuffer)) {
      throw new Error(`${fileName ? `"${fileName}": ` : ""}Tệp không phải là file PDF hợp lệ.`);
    }
    try {
      return await global.PDFLib.PDFDocument.load(arrayBuffer, {
        ignoreEncryption: false,
      });
    } catch (err) {
      throw new Error(translatePdfError(err, fileName));
    }
  }

  /* --------------------------------------------------------------------------
     PDF Page Canvas Rendering (Memory-Safe)
     -------------------------------------------------------------------------- */

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Không thể xuất ảnh từ khung vẽ Canvas."));
        },
        mimeType,
        quality
      );
    });
  }

  async function renderPdfPageToBlob(pdfJsDoc, pageNumber, options = {}) {
    const {
      scale = 1,
      maxWidth = null,
      mimeType = "image/jpeg",
      quality = 0.86,
      background = "#FFFFFF",
    } = options;

    const page = await pdfJsDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    let effectiveScale = scale;
    if (maxWidth && baseViewport.width > 0) {
      effectiveScale = maxWidth / baseViewport.width;
    }

    const viewport = page.getViewport({ scale: effectiveScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const ctx = canvas.getContext("2d", { alpha: mimeType === "image/png" && background === "transparent" });
    if (background !== "transparent") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await canvasToBlob(canvas, mimeType, quality);
      return {
        blob,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        pointWidth: baseViewport.width,
        pointHeight: baseViewport.height,
      };
    } finally {
      // Immediately release backing canvas bitmap memory & pdf.js page resources
      canvas.width = 0;
      canvas.height = 0;
      if (typeof page.cleanup === "function") {
        page.cleanup();
      }
    }
  }

  /* --------------------------------------------------------------------------
     Page Range Parser & Formatter (2-way Synchronization)
     -------------------------------------------------------------------------- */

  function parsePageRange(input, totalPages) {
    const trimmed = String(input || "").trim();
    if (!trimmed) {
      return { pages: [], error: null };
    }

    const tokens = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
    const selected = new Set();

    for (const token of tokens) {
      const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
      const singleMatch = token.match(/^(\d+)$/);

      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
          return {
            pages: [],
            error: `Khoảng trang "${token}" nằm ngoài phạm vi 1–${totalPages}.`,
          };
        }
        if (start > end) {
          return {
            pages: [],
            error: `Khoảng trang "${token}" không hợp lệ (số đầu phải ≤ số cuối).`,
          };
        }
        for (let p = start; p <= end; p++) {
          selected.add(p);
        }
      } else if (singleMatch) {
        const num = parseInt(singleMatch[1], 10);
        if (num < 1 || num > totalPages) {
          return {
            pages: [],
            error: `Trang ${num} vượt quá tổng số ${totalPages} trang.`,
          };
        }
        selected.add(num);
      } else {
        return {
          pages: [],
          error: `Cú pháp "${token}" không hợp lệ. Ví dụ đúng: 1-3, 5, 8-12.`,
        };
      }
    }

    const sorted = Array.from(selected).sort((a, b) => a - b);
    return { pages: sorted, error: null };
  }

  function formatPageRanges(pageNumbers) {
    const sorted = Array.from(new Set(pageNumbers))
      .filter((n) => Number.isInteger(n) && n >= 1)
      .sort((a, b) => a - b);

    if (sorted.length === 0) return "";

    const parts = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i];
      if (curr === prev + 1) {
        prev = curr;
      } else {
        parts.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = curr;
        prev = curr;
      }
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    return parts.join(", ");
  }

  /* --------------------------------------------------------------------------
     Vietnamese Font Support & Canvas-PNG Fallback for pdf-lib
     -------------------------------------------------------------------------- */

  async function loadVietnameseFontBytes() {
    if (cachedFontBytes) return cachedFontBytes;
    if (fontFetchAttempted) return null;
    fontFetchAttempted = true;

    for (const url of VIETNAMESE_FONT_URLS) {
      try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        if (buf && buf.byteLength > 10000) {
          cachedFontBytes = new Uint8Array(buf);
          return cachedFontBytes;
        }
      } catch (_err) {
        // Try next mirror
      }
    }
    return null;
  }

  async function embedVietnameseFont(pdfDoc) {
    try {
      const bytes = await loadVietnameseFontBytes();
      if (bytes && global.fontkit) {
        pdfDoc.registerFontkit(global.fontkit);
        const font = await pdfDoc.embedFont(bytes);
        return { font, isCustom: true };
      }
    } catch (_err) {
      // Fallback to standard font + canvas PNG for non-WinAnsi text
    }
    const fallbackFont = await pdfDoc.embedFont(global.PDFLib.StandardFonts.HelveticaBold);
    return { font: fallbackFont, isCustom: false };
  }

  function hexToRgbNormalized(hex) {
    const clean = String(hex || "#64748B").replace("#", "");
    const full = clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return { r: 0.39, g: 0.45, b: 0.55 };
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255,
    };
  }

  async function renderTextToPngBuffer(text, fontSizePt, colorHex, bold = true) {
    const scale = 3; // Crisp 216+ DPI
    const probeCanvas = document.createElement("canvas");
    const probeCtx = probeCanvas.getContext("2d");
    const fontSpec = `${bold ? "700" : "500"} ${fontSizePt * scale}px "Be Vietnam Pro", "Segoe UI", Arial, sans-serif`;
    probeCtx.font = fontSpec;
    const metrics = probeCtx.measureText(text);

    const textWidthPx = Math.max(10, Math.ceil(metrics.width));
    const padX = Math.ceil(fontSizePt * scale * 0.25);
    const padY = Math.ceil(fontSizePt * scale * 0.35);
    const boxW = textWidthPx + padX * 2;
    const boxH = Math.ceil(fontSizePt * scale * 1.35) + padY;

    const canvas = document.createElement("canvas");
    canvas.width = boxW;
    canvas.height = boxH;
    const ctx = canvas.getContext("2d");
    ctx.font = fontSpec;
    ctx.fillStyle = colorHex || "#1E293B";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, boxW / 2, boxH / 2);

    try {
      const blob = await canvasToBlob(canvas, "image/png", 1);
      const buffer = await blob.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        widthPt: boxW / scale,
        heightPt: boxH / scale,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  global.PDFStudio = {
    configurePdfWorkerSync,
    ensurePdfWorkerReady,
    checkRequiredLibraries,
    trackObjectUrl,
    revokeTrackedUrl,
    revokeAllTrackedUrls,
    downloadBlob,
    formatBytes,
    stripExtension,
    sanitizeFilename,
    escapeHtml,
    yieldToUI,
    setProgress,
    showToast,
    hasPdfSignature,
    translatePdfError,
    readFileAsArrayBuffer,
    openPdfWithPdfJs,
    openPdfWithPdfLib,
    canvasToBlob,
    renderPdfPageToBlob,
    parsePageRange,
    formatPageRanges,
    embedVietnameseFont,
    hexToRgbNormalized,
    renderTextToPngBuffer,
  };
})(window);

/* ==========================================================================
   PDF Studio Pro — Conversion Tools
   Tool 1: PDF -> Word (.docx)
   Tool 5: Images -> PDF (JPG / PNG / WebP)
   Tool 6: PDF -> Images (PNG / JPG + ZIP)
   ========================================================================== */

(function (global) {
  "use strict";

  const S = () => global.PDFStudio;

  /* ==========================================================================
     TOOL 1: PDF -> WORD (.DOCX)
     ========================================================================== */

  function sanitizeXmlText(str) {
    // Strip invalid XML 1.0 control characters while preserving tab, LF, CR and all Unicode/Vietnamese
    return String(str || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  function detectFontStyles(fontName, stylesMap) {
    const styleObj = (stylesMap && stylesMap[fontName]) || {};
    const combined = `${fontName || ""} ${styleObj.fontFamily || ""}`.toLowerCase();
    return {
      bold: /bold|black|heavy|semibold|demi|medi/i.test(combined),
      italic: /italic|oblique|slant/i.test(combined),
    };
  }

  function computeMedianFontSize(allPagesItems) {
    const weights = new Map();
    let totalWeight = 0;

    for (const items of allPagesItems) {
      for (const it of items) {
        const len = it.str.trim().length;
        if (!len) continue;
        const bucket = Math.round(it.fontSize * 2) / 2;
        weights.set(bucket, (weights.get(bucket) || 0) + len);
        totalWeight += len;
      }
    }

    if (totalWeight === 0) return 11.5;

    const sorted = Array.from(weights.entries()).sort((a, b) => a[0] - b[0]);
    const half = totalWeight / 2;
    let acc = 0;
    for (const [size, w] of sorted) {
      acc += w;
      if (acc >= half) return size;
    }
    return 11.5;
  }

  function extractStructuredLines(textContent) {
    const styles = textContent.styles || {};
    const rawItems = [];

    for (const item of textContent.items || []) {
      if (!item || typeof item.str !== "string") continue;
      const cleanStr = sanitizeXmlText(item.str);
      if (!cleanStr && !item.hasEOL) continue;

      const t = item.transform || [11, 0, 0, 11, 0, 0];
      const fontSize = Math.max(6, Math.hypot(t[0], t[1]) || Math.abs(t[3]) || 11);
      const { bold, italic } = detectFontStyles(item.fontName, styles);

      rawItems.push({
        str: cleanStr,
        x: t[4] || 0,
        y: t[5] || 0,
        width: item.width || 0,
        fontSize,
        bold,
        italic,
        hasEOL: Boolean(item.hasEOL),
      });
    }

    if (rawItems.length === 0) return [];

    // Sort top-to-bottom (higher Y first), then left-to-right
    rawItems.sort((a, b) => {
      if (Math.abs(b.y - a.y) > 2.5) return b.y - a.y;
      return a.x - b.x;
    });

    // Cluster into lines based on Y proximity
    const lines = [];
    for (const item of rawItems) {
      const tol = Math.max(2.6, item.fontSize * 0.36);
      let targetLine = null;

      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
        if (Math.abs(lines[i].y - item.y) <= tol) {
          targetLine = lines[i];
          break;
        }
      }

      if (!targetLine) {
        targetLine = { y: item.y, items: [] };
        lines.push(targetLine);
      }
      targetLine.items.push(item);
    }

    // Normalize each line left-to-right and compute summary metrics
    const normalizedLines = [];
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const segments = [];
      let plainText = "";
      let weightedSizeSum = 0;
      let boldWeight = 0;
      let totalChars = 0;
      let prevEnd = null;
      let minX = Infinity;
      let maxX = -Infinity;

      for (const it of line.items) {
        if (!it.str) continue;
        if (it.x < minX) minX = it.x;
        if (it.x + it.width > maxX) maxX = it.x + it.width;

        let prefix = "";
        if (prevEnd !== null && plainText.length > 0) {
          const gap = it.x - prevEnd;
          const prevEndsSpace = /\s$/.test(plainText);
          const currStartsSpace = /^\s/.test(it.str);
          if (!prevEndsSpace && !currStartsSpace) {
            if (gap > it.fontSize * 2.3) {
              prefix = "   ";
            } else if (gap > it.fontSize * 0.16) {
              prefix = " ";
            }
          }
        }

        const chunkText = prefix + it.str;
        plainText += chunkText;
        const charLen = it.str.trim().length;
        if (charLen > 0) {
          weightedSizeSum += it.fontSize * charLen;
          if (it.bold) boldWeight += charLen;
          totalChars += charLen;
        }

        segments.push({
          text: chunkText,
          bold: it.bold,
          italic: it.italic,
          fontSize: it.fontSize,
        });

        prevEnd = it.x + it.width;
      }

      const trimmed = plainText.trim();
      if (!trimmed) continue;

      normalizedLines.push({
        y: line.y,
        minX,
        maxX,
        width: Math.max(0, maxX - minX),
        text: trimmed,
        segments,
        avgFontSize: totalChars > 0 ? weightedSizeSum / totalChars : 11.5,
        mostlyBold: totalChars > 0 && boldWeight / totalChars >= 0.75,
      });
    }

    return normalizedLines;
  }

  function buildWordParagraphsForPage(lines, bodyFontSize, pageNumber) {
    const { Paragraph, TextRun, HeadingLevel } = global.docx;
    const paragraphs = [];

    if (lines.length === 0) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[Trang ${pageNumber} không có văn bản có thể trích xuất — có thể là trang ảnh/scan. Hãy dùng chế độ "Giữ nguyên bố cục & Công thức".]`,
              italics: true,
              color: "64748B",
              size: 20,
              font: "Arial",
            }),
          ],
          spacing: { after: 180 },
        })
      );
      return { paragraphs, isEmpty: true };
    }

    const maxLineWidth = Math.max(...lines.map((l) => l.width), 1);
    const listPrefixRegex = /^([•●▪◦\-*+]|(\d+|[a-zA-Z])[.)])\s+/;

    let currentGroup = null;

    const flushGroup = () => {
      if (!currentGroup) return;
      const runs = [];
      for (let i = 0; i < currentGroup.lines.length; i++) {
        const l = currentGroup.lines[i];
        if (i > 0) {
          runs.push(
            new TextRun({
              text: " ",
              font: "Arial",
              size: Math.round(bodyFontSize * 2),
            })
          );
        }
        for (const seg of l.segments) {
          const halfPts = Math.max(16, Math.min(72, Math.round(seg.fontSize * 2)));
          runs.push(
            new TextRun({
              text: seg.text,
              bold: seg.bold,
              italics: seg.italic,
              size: halfPts,
              font: "Arial",
            })
          );
        }
      }

      paragraphs.push(
        new Paragraph({
          children: runs,
          spacing: { after: 140, line: 276 },
        })
      );
      currentGroup = null;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const len = line.text.length;

      let headingLevel = null;
      if (line.avgFontSize >= bodyFontSize * 1.42 && len <= 150) {
        headingLevel = HeadingLevel.HEADING_1;
      } else if (line.avgFontSize >= bodyFontSize * 1.18 && len <= 150) {
        headingLevel = HeadingLevel.HEADING_2;
      } else if (line.avgFontSize >= bodyFontSize * 1.06 && line.mostlyBold && len <= 120) {
        headingLevel = HeadingLevel.HEADING_3;
      }

      if (headingLevel) {
        flushGroup();
        paragraphs.push(
          new Paragraph({
            heading: headingLevel,
            spacing: { before: 180, after: 100 },
            children: [
              new TextRun({
                text: line.text,
                bold: true,
                font: "Arial",
              }),
            ],
          })
        );
        continue;
      }

      const startsList = listPrefixRegex.test(line.text);
      let shouldBreakParagraph = false;

      if (!currentGroup || startsList) {
        shouldBreakParagraph = true;
      } else {
        const prevLine = currentGroup.lines[currentGroup.lines.length - 1];
        const yGap = prevLine.y - line.y;
        const lineHeight = Math.max(prevLine.avgFontSize, line.avgFontSize);
        const prevEndedSentence = /[.?!:]$/.test(prevLine.text);
        const prevWasShort = prevLine.width < maxLineWidth * 0.78;

        if (yGap > lineHeight * 1.52 || (prevEndedSentence && prevWasShort)) {
          shouldBreakParagraph = true;
        }
      }

      if (shouldBreakParagraph) {
        flushGroup();
        currentGroup = { lines: [line] };
      } else {
        currentGroup.lines.push(line);
      }
    }

    flushGroup();
    return { paragraphs, isEmpty: false };
  }

  async function runPdfToWord(toolState, options) {
    const utils = S();
    const { mode, pageRangeMode, pageRangeText, pageBreakPerPage, exactScale, outputName } = options;

    if (!toolState.pdfJsDoc) {
      throw new Error("Vui lòng chọn một file PDF trước khi chuyển đổi.");
    }

    const totalPages = toolState.totalPages;
    let targetPages = [];
    if (pageRangeMode === "all") {
      targetPages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
      const parsed = utils.parsePageRange(pageRangeText, totalPages);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.pages.length === 0) {
        throw new Error("Vui lòng nhập ít nhất một trang hợp lệ (ví dụ: 1-5).");
      }
      targetPages = parsed.pages;
    }

    const { Document, Packer, Paragraph, ImageRun, PageBreak, PageOrientation, AlignmentType } =
      global.docx;

    let doc = null;
    let emptyTextPagesCount = 0;

    if (mode === "editable") {
      utils.setProgress(5, "Đang đọc cấu trúc văn bản PDF...");
      const pageLinesMap = new Map();
      const rawItemsForMedian = [];

      for (let i = 0; i < targetPages.length; i++) {
        const pageNum = targetPages[i];
        const page = await toolState.pdfJsDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const lines = extractStructuredLines(textContent);
        pageLinesMap.set(pageNum, lines);

        // Collect font sizes for global median body size estimation
        for (const it of textContent.items || []) {
          if (it && typeof it.str === "string" && it.str.trim()) {
            const t = it.transform || [11, 0, 0, 11, 0, 0];
            rawItemsForMedian.push({
              str: it.str,
              fontSize: Math.max(6, Math.hypot(t[0], t[1]) || Math.abs(t[3]) || 11),
            });
          }
        }
        if (typeof page.cleanup === "function") page.cleanup();

        const pct = 5 + Math.round(((i + 1) / targetPages.length) * 55);
        utils.setProgress(pct, `Đang trích xuất chữ trang ${pageNum} (${i + 1}/${targetPages.length})...`);
        await utils.yieldToUI();
      }

      const bodySize = computeMedianFontSize([rawItemsForMedian]);
      const docChildren = [];

      for (let i = 0; i < targetPages.length; i++) {
        const pageNum = targetPages[i];
        const lines = pageLinesMap.get(pageNum) || [];
        const { paragraphs, isEmpty } = buildWordParagraphsForPage(lines, bodySize, pageNum);
        if (isEmpty) emptyTextPagesCount++;

        docChildren.push(...paragraphs);

        if (pageBreakPerPage && i < targetPages.length - 1) {
          docChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }

        const pct = 60 + Math.round(((i + 1) / targetPages.length) * 25);
        utils.setProgress(pct, `Đang định dạng nội dung Word (${i + 1}/${targetPages.length})...`);
      }

      doc = new Document({
        creator: "PDF Studio Pro",
        title: outputName || "Tai lieu Word",
        sections: [
          {
            properties: {
              page: {
                margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // ~2cm standard margins
              },
            },
            children: docChildren,
          },
        ],
      });
    } else {
      // Exact Layout Mode: Render high-res PNG per page & place edge-to-edge inside matched Word sections
      const sections = [];
      const renderScaleBase = Number(exactScale) || 2.0;

      for (let i = 0; i < targetPages.length; i++) {
        const pageNum = targetPages[i];
        utils.setProgress(
          Math.round((i / targetPages.length) * 84),
          `Đang kết xuất trang ${pageNum} độ nét cao (${i + 1}/${targetPages.length})...`
        );

        const page = await toolState.pdfJsDoc.getPage(pageNum);
        const vp1 = page.getViewport({ scale: 1 });
        if (typeof page.cleanup === "function") page.cleanup();

        // Cap ultra-wide sheets so canvas stays within safe browser memory bounds
        const safeScale = vp1.width * renderScaleBase > 2800
          ? 2800 / Math.max(1, vp1.width)
          : renderScaleBase;

        const rendered = await utils.renderPdfPageToBlob(toolState.pdfJsDoc, pageNum, {
          scale: safeScale,
          mimeType: "image/png",
          quality: 1,
          background: "#FFFFFF",
        });

        const imgBytes = new Uint8Array(await rendered.blob.arrayBuffer());
        const ptW = rendered.pointWidth;
        const ptH = rendered.pointHeight;
        const isLandscape = ptW > ptH;

        // dolanmiu/docx swaps width & height internally when orientation === LANDSCAPE
        const dxaW = Math.round(ptW * 20);
        const dxaH = Math.round(ptH * 20);
        const imgPxW = Math.max(12, Math.floor(ptW * (96 / 72)) - 2);
        const imgPxH = Math.max(12, Math.floor(ptH * (96 / 72)) - 2);

        sections.push({
          properties: {
            page: {
              margin: { top: 0, right: 0, bottom: 0, left: 0 },
              size: isLandscape
                ? { width: dxaH, height: dxaW, orientation: PageOrientation.LANDSCAPE }
                : { width: dxaW, height: dxaH, orientation: PageOrientation.PORTRAIT },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  type: "png",
                  data: imgBytes,
                  transformation: {
                    width: imgPxW,
                    height: imgPxH,
                  },
                }),
              ],
            }),
          ],
        });

        await utils.yieldToUI();
      }

      doc = new Document({
        creator: "PDF Studio Pro",
        title: outputName || "Tai lieu Word",
        sections,
      });
    }

    utils.setProgress(90, "Đang đóng gói tệp Word (.docx)...");
    await utils.yieldToUI();

    const docxBlob = await Packer.toBlob(doc);
    const filename = utils.sanitizeFilename(outputName, ".docx");
    utils.downloadBlob(docxBlob, filename);

    utils.setProgress(100, "Hoàn tất! Tệp Word đã được tải xuống.", true);

    return {
      filename,
      size: docxBlob.size,
      pageCount: targetPages.length,
      emptyTextPagesCount,
      mode,
    };
  }

  /* ==========================================================================
     TOOL 5: IMAGES -> PDF (JPG / PNG / WebP -> PDF)
     ========================================================================== */

  function getJpegExifOrientation(arrayBuffer) {
    try {
      const view = new DataView(arrayBuffer);
      if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) return 1;
      let offset = 2;
      while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xffe1) {
          if (offset + 8 > view.byteLength) return 1;
          if (view.getUint32(offset + 2, false) !== 0x45786966) return 1; // "Exif"
          const tiffStart = offset + 8;
          const little = view.getUint16(tiffStart, false) === 0x4949;
          const ifdOffset = view.getUint32(tiffStart + 4, little);
          const entriesOffset = tiffStart + ifdOffset;
          if (entriesOffset + 2 > view.byteLength) return 1;
          const tags = view.getUint16(entriesOffset, little);
          for (let i = 0; i < tags; i++) {
            const entry = entriesOffset + 2 + i * 12;
            if (entry + 12 > view.byteLength) break;
            if (view.getUint16(entry, little) === 0x0112) {
              return view.getUint16(entry + 8, little);
            }
          }
          return 1;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        const size = view.getUint16(offset, false);
        offset += size;
      }
    } catch (_e) {
      // Ignore malformed EXIF
    }
    return 1;
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Không thể đọc dữ liệu ảnh."));
      img.src = url;
    });
  }

  async function convertImageItemForPdf(item, pdfDoc) {
    const utils = S();
    const mime = (item.file.type || "").toLowerCase();
    const ext = item.name.toLowerCase();
    const rawBuffer = await item.file.arrayBuffer();

    const isPng = mime === "image/png" || ext.endsWith(".png");
    const isJpeg = mime === "image/jpeg" || mime === "image/jpg" || /\.jpe?g$/.test(ext);

    if (isPng) {
      try {
        return await pdfDoc.embedPng(rawBuffer);
      } catch (_err) {
        // Fallback to canvas re-encoding if unusual PNG chunk fails
      }
    }

    if (isJpeg && getJpegExifOrientation(rawBuffer) === 1) {
      try {
        return await pdfDoc.embedJpg(rawBuffer);
      } catch (_err) {
        // Fallback to canvas (e.g. CMYK or uncommon JPEG encoding)
      }
    }

    // Handle WebP, EXIF-rotated JPEGs, or non-standard color profiles via Canvas
    const img = await loadImageFromUrl(item.previewUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, img.naturalWidth || item.width);
    canvas.height = Math.max(1, img.naturalHeight || item.height);
    const ctx = canvas.getContext("2d");
    const outMime = isJpeg ? "image/jpeg" : "image/png";
    if (outMime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    try {
      // Preserve PNG alpha for WebP/PNG; use high-quality JPEG for opaque photos
      const blob = await utils.canvasToBlob(canvas, outMime, 0.92);
      const bytes = await blob.arrayBuffer();
      return outMime === "image/jpeg"
        ? await pdfDoc.embedJpg(bytes)
        : await pdfDoc.embedPng(bytes);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async function readImageMetadata(file) {
    const utils = S();
    const previewUrl = utils.trackObjectUrl(URL.createObjectURL(file));
    try {
      const img = await loadImageFromUrl(previewUrl);
      return {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        width: img.naturalWidth || 800,
        height: img.naturalHeight || 600,
        previewUrl,
      };
    } catch (err) {
      utils.revokeTrackedUrl(previewUrl);
      throw new Error(`"${file.name}": Tệp ảnh không hợp lệ hoặc bị hỏng.`);
    }
  }

  async function runImagesToPdf(items, options) {
    const utils = S();
    const { paperSize, orientation, marginMode, outputName } = options;

    if (!items || items.length === 0) {
      throw new Error("Vui lòng chọn ít nhất một tệp ảnh (JPG, PNG, WebP).");
    }

    const marginMap = { none: 0, small: 20, medium: 42 };
    const margin = marginMap[marginMode] ?? 20;

    const pdfDoc = await global.PDFLib.PDFDocument.create();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      utils.setProgress(
        Math.round((i / items.length) * 88),
        `Đang xử lý ảnh ${i + 1}/${items.length}: ${item.name}`
      );

      const embedded = await convertImageItemForPdf(item, pdfDoc);
      const imgDims = embedded.scale(1);

      let pageW;
      let pageH;

      if (paperSize === "a4") {
        // Standard A4 in PDF points (595.28 x 841.89)
        pageW = orientation === "landscape" ? 841.89 : 595.28;
        pageH = orientation === "landscape" ? 595.28 : 841.89;
      } else {
        // Fit exactly to image size (convert 96dpi-ish px -> 72dpi PDF points, capped sensibly)
        const ptW = imgDims.width * 0.75;
        const ptH = imgDims.height * 0.75;
        pageW = ptW + margin * 2;
        pageH = ptH + margin * 2;
      }

      const page = pdfDoc.addPage([pageW, pageH]);
      const availW = Math.max(10, pageW - margin * 2);
      const availH = Math.max(10, pageH - margin * 2);

      const fitScale = Math.min(availW / imgDims.width, availH / imgDims.height);
      const drawW = imgDims.width * fitScale;
      const drawH = imgDims.height * fitScale;

      page.drawImage(embedded, {
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW,
        height: drawH,
      });

      await utils.yieldToUI();
    }

    utils.setProgress(93, "Đang tạo tệp PDF hoàn chỉnh...");
    const pdfBytes = await pdfDoc.save();
    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
    const filename = utils.sanitizeFilename(outputName, ".pdf");
    utils.downloadBlob(pdfBlob, filename);

    utils.setProgress(100, "Hoàn tất! Tệp PDF đã được tải xuống.", true);
    return { filename, size: pdfBlob.size, pageCount: items.length };
  }

  /* ==========================================================================
     TOOL 6: PDF -> IMAGES (PNG / JPG + ZIP)
     ========================================================================== */

  async function exportSinglePdfPageImage(pdfJsDoc, pageNumber, options) {
    const utils = S();
    const { format, scale, baseName } = options;
    const isPng = format === "png";
    const mimeType = isPng ? "image/png" : "image/jpeg";
    const quality = isPng ? 1 : 0.92;

    const rendered = await utils.renderPdfPageToBlob(pdfJsDoc, pageNumber, {
      scale: Number(scale) || 1.5,
      mimeType,
      quality,
      background: "#FFFFFF",
    });

    const padded = String(pageNumber).padStart(3, "0");
    const filename = `${utils.stripExtension(baseName || "trang")}_trang_${padded}.${format}`;
    utils.downloadBlob(rendered.blob, filename);
    return { filename, size: rendered.blob.size };
  }

  async function runPdfToAllImagesZip(toolState, options) {
    const utils = S();
    const { format, scale, outputName } = options;

    if (!toolState.pdfJsDoc) {
      throw new Error("Vui lòng chọn file PDF trước khi chuyển đổi.");
    }

    const total = toolState.totalPages;
    const isPng = format === "png";
    const mimeType = isPng ? "image/png" : "image/jpeg";
    const quality = isPng ? 1 : 0.92;
    const zip = new global.JSZip();
    const prefix = utils.stripExtension(outputName || toolState.fileName || "pdf_anh");

    for (let pageNum = 1; pageNum <= total; pageNum++) {
      utils.setProgress(
        Math.round(((pageNum - 1) / total) * 86),
        `Đang xuất trang ${pageNum}/${total} sang ${format.toUpperCase()}...`
      );

      const rendered = await utils.renderPdfPageToBlob(toolState.pdfJsDoc, pageNum, {
        scale: Number(scale) || 1.5,
        mimeType,
        quality,
        background: "#FFFFFF",
      });

      const padded = String(pageNum).padStart(3, "0");
      zip.file(`${prefix}_trang_${padded}.${format}`, rendered.blob);
      await utils.yieldToUI();
    }

    utils.setProgress(90, "Đang đóng gói tất cả ảnh vào tệp .ZIP...");
    const zipBlob = await zip.generateAsync(
      { type: "blob", compression: "STORE" },
      (meta) => {
        const pct = 90 + Math.round((meta.percent / 100) * 9);
        utils.setProgress(pct, `Đang nén tệp ZIP (${Math.round(meta.percent)}%)...`);
      }
    );

    const filename = utils.sanitizeFilename(outputName, ".zip");
    utils.downloadBlob(zipBlob, filename);
    utils.setProgress(100, "Hoàn tất! Tệp ZIP chứa toàn bộ ảnh đã được tải xuống.", true);

    return { filename, size: zipBlob.size, pageCount: total };
  }

  global.PDFToolsConvert = {
    runPdfToWord,
    readImageMetadata,
    runImagesToPdf,
    exportSinglePdfPageImage,
    runPdfToAllImagesZip,
  };
})(window);

/* ==========================================================================
   PDF Studio Pro — PDF Manipulation Tools
   Tool 2: Merge PDF
   Tool 3: Split / Extract PDF
   Tool 4: Organize, Rotate & Delete Pages
   Tool 7: Page Numbers & Watermark
   ========================================================================== */

(function (global) {
  "use strict";

  const S = () => global.PDFStudio;

  /* ==========================================================================
     TOOL 2: MERGE MULTIPLE PDFs
     ========================================================================== */

  async function inspectPdfForMerge(file) {
    const utils = S();
    const arrayBuffer = await utils.readFileAsArrayBuffer(file);
    const pdfDoc = await utils.openPdfWithPdfLib(arrayBuffer, file.name);
    const pageCount = pdfDoc.getPageCount();

    if (pageCount === 0) {
      throw new Error(`"${file.name}": File PDF không có trang nào.`);
    }

    return {
      id: `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      size: file.size,
      pageCount,
      arrayBuffer,
    };
  }

  async function runMergePdf(pdfItems, outputName) {
    const utils = S();
    if (!pdfItems || pdfItems.length < 2) {
      throw new Error("Vui lòng tải lên ít nhất 2 file PDF để gộp lại.");
    }

    const { PDFDocument } = global.PDFLib;
    const mergedPdf = await PDFDocument.create();
    let totalPagesMerged = 0;

    for (let i = 0; i < pdfItems.length; i++) {
      const item = pdfItems[i];
      utils.setProgress(
        Math.round((i / pdfItems.length) * 85),
        `Đang gộp tệp ${i + 1}/${pdfItems.length}: ${item.name}...`
      );

      const srcDoc = await utils.openPdfWithPdfLib(item.arrayBuffer, item.name);
      const indices = srcDoc.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(srcDoc, indices);
      for (const page of copiedPages) {
        mergedPdf.addPage(page);
      }
      totalPagesMerged += copiedPages.length;
      await utils.yieldToUI();
    }

    utils.setProgress(90, "Đang xuất file PDF đã gộp...");
    const mergedBytes = await mergedPdf.save();
    const pdfBlob = new Blob([mergedBytes], { type: "application/pdf" });
    const filename = utils.sanitizeFilename(outputName, ".pdf");
    utils.downloadBlob(pdfBlob, filename);

    utils.setProgress(100, "Hoàn tất! Đã gộp thành công file PDF.", true);
    return {
      filename,
      size: pdfBlob.size,
      pageCount: totalPagesMerged,
      fileCount: pdfItems.length,
    };
  }

  /* ==========================================================================
     TOOL 3: SPLIT / EXTRACT PDF PAGES
     ========================================================================== */

  async function runSplitPdf(toolState, options) {
    const utils = S();
    const { selectedPages, exportMode, outputName } = options;

    if (!toolState.arrayBuffer) {
      throw new Error("Vui lòng chọn một file PDF trước.");
    }
    if (!selectedPages || selectedPages.length === 0) {
      throw new Error("Vui lòng chọn ít nhất 1 trang (bấm vào ảnh xem trước hoặc nhập số trang).");
    }

    const sortedPages = Array.from(new Set(selectedPages)).sort((a, b) => a - b);
    const srcPdf = await utils.openPdfWithPdfLib(toolState.arrayBuffer, toolState.fileName);
    const total = srcPdf.getPageCount();

    for (const p of sortedPages) {
      if (p < 1 || p > total) {
        throw new Error(`Trang ${p} vượt quá tổng số ${total} trang của tài liệu.`);
      }
    }

    const { PDFDocument } = global.PDFLib;

    if (exportMode === "single_pdf") {
      utils.setProgress(25, `Đang trích xuất ${sortedPages.length} trang vào 1 file PDF...`);
      const outDoc = await PDFDocument.create();
      const zeroIndices = sortedPages.map((p) => p - 1);
      const copiedPages = await outDoc.copyPages(srcPdf, zeroIndices);
      for (const page of copiedPages) {
        outDoc.addPage(page);
      }

      utils.setProgress(85, "Đang lưu file PDF đầu ra...");
      const outBytes = await outDoc.save();
      const blob = new Blob([outBytes], { type: "application/pdf" });
      const filename = utils.sanitizeFilename(outputName, ".pdf");
      utils.downloadBlob(blob, filename);

      utils.setProgress(100, "Hoàn tất! Đã trích xuất file PDF.", true);
      return { filename, size: blob.size, pageCount: sortedPages.length, exportMode };
    }

    // Separate PDFs packaged in .ZIP
    const zip = new global.JSZip();
    const prefix = utils.stripExtension(outputName || toolState.fileName || "tach_trang");

    for (let i = 0; i < sortedPages.length; i++) {
      const pageNum = sortedPages[i];
      utils.setProgress(
        Math.round((i / sortedPages.length) * 85),
        `Đang tách trang ${pageNum} (${i + 1}/${sortedPages.length})...`
      );

      const singleDoc = await PDFDocument.create();
      const [copied] = await singleDoc.copyPages(srcPdf, [pageNum - 1]);
      singleDoc.addPage(copied);
      const bytes = await singleDoc.save();

      const padded = String(pageNum).padStart(3, "0");
      zip.file(`${prefix}_trang_${padded}.pdf`, bytes);
      await utils.yieldToUI();
    }

    utils.setProgress(90, "Đang nén các file PDF lẻ thành tệp .ZIP...");
    const zipBlob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      (meta) => {
        const pct = 90 + Math.round((meta.percent / 100) * 9);
        utils.setProgress(pct, `Đang nén tệp ZIP (${Math.round(meta.percent)}%)...`);
      }
    );

    const filename = utils.sanitizeFilename(outputName, ".zip");
    utils.downloadBlob(zipBlob, filename);
    utils.setProgress(100, "Hoàn tất! Tệp ZIP chứa các trang PDF đã được tải xuống.", true);

    return { filename, size: zipBlob.size, pageCount: sortedPages.length, exportMode };
  }

  /* ==========================================================================
     TOOL 4: ORGANIZE, ROTATE & DELETE PAGES
     ========================================================================== */

  async function runOrganizePdf(toolState, pageItems, outputName) {
    const utils = S();
    if (!toolState.arrayBuffer) {
      throw new Error("Vui lòng chọn một file PDF trước.");
    }
    if (!pageItems || pageItems.length === 0) {
      throw new Error("Tài liệu phải còn ít nhất 1 trang để xuất file.");
    }

    const { PDFDocument, degrees } = global.PDFLib;
    utils.setProgress(15, "Đang đọc dữ liệu PDF gốc...");

    const srcPdf = await utils.openPdfWithPdfLib(toolState.arrayBuffer, toolState.fileName);
    const outPdf = await PDFDocument.create();
    const indices = pageItems.map((item) => item.originalIndex);

    utils.setProgress(40, `Đang sắp xếp và xoay ${pageItems.length} trang...`);
    const copiedPages = await outPdf.copyPages(srcPdf, indices);

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i];
      const delta = pageItems[i].rotationDelta || 0;
      if (delta !== 0) {
        const existingAngle = (page.getRotation() && page.getRotation().angle) || 0;
        const nextAngle = ((existingAngle + delta) % 360 + 360) % 360;
        page.setRotation(degrees(nextAngle));
      }
      outPdf.addPage(page);

      if (i % 15 === 0) {
        const pct = 40 + Math.round(((i + 1) / copiedPages.length) * 45);
        utils.setProgress(pct, `Đang áp dụng thay đổi trang ${i + 1}/${copiedPages.length}...`);
        await utils.yieldToUI();
      }
    }

    utils.setProgress(90, "Đang tạo tệp PDF mới...");
    const bytes = await outPdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const filename = utils.sanitizeFilename(outputName, ".pdf");
    utils.downloadBlob(blob, filename);

    utils.setProgress(100, "Hoàn tất! Tệp PDF mới đã được tải xuống.", true);
    return { filename, size: blob.size, pageCount: pageItems.length };
  }

  /* ==========================================================================
     TOOL 7: PAGE NUMBERS & WATERMARK
     ========================================================================== */

  function mapVisualPointToRawPdf(vx, vy, visualAngleDeg, rawW, rawH, pageRotAngle) {
    const rot = ((pageRotAngle % 360) + 360) % 360;
    if (rot === 90) {
      return { x: rawW - vy, y: vx, angle: visualAngleDeg + 90 };
    }
    if (rot === 180) {
      return { x: rawW - vx, y: rawH - vy, angle: visualAngleDeg + 180 };
    }
    if (rot === 270) {
      return { x: vy, y: rawH - vx, angle: visualAngleDeg + 270 };
    }
    return { x: vx, y: vy, angle: visualAngleDeg };
  }

  function getVisualPageDimensions(rawW, rawH, pageRotAngle) {
    const rot = ((pageRotAngle % 360) + 360) % 360;
    if (rot === 90 || rot === 270) {
      return { width: rawH, height: rawW };
    }
    return { width: rawW, height: rawH };
  }

  function canEncodeWithFont(font, text) {
    try {
      font.widthOfTextAtSize(text, 12);
      return true;
    } catch (_err) {
      return false;
    }
  }

  async function runWatermarkAndNumbers(toolState, options) {
    const utils = S();
    const {
      enableNumbers,
      numberFormat,
      numberPosition,
      enableWatermark,
      watermarkText,
      watermarkSize,
      watermarkColor,
      watermarkOpacity,
      outputName,
    } = options;

    if (!toolState.arrayBuffer) {
      throw new Error("Vui lòng chọn một file PDF trước.");
    }
    if (!enableNumbers && !enableWatermark) {
      throw new Error("Vui lòng bật ít nhất một tính năng: Đánh số trang hoặc Đóng dấu chữ mờ.");
    }
    if (enableWatermark && !String(watermarkText || "").trim()) {
      throw new Error("Vui lòng nhập nội dung chữ đóng dấu (Watermark).");
    }

    const { degrees, rgb } = global.PDFLib;
    utils.setProgress(8, "Đang tải tài liệu PDF và chuẩn bị phông chữ tiếng Việt...");

    const pdfDoc = await utils.openPdfWithPdfLib(toolState.arrayBuffer, toolState.fileName);
    const { font } = await utils.embedVietnameseFont(pdfDoc);
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;

    const wmText = String(watermarkText || "").trim();
    const wmFontSize = Math.max(12, Math.min(120, Number(watermarkSize) || 48));
    const wmOpacity = Math.max(0.05, Math.min(0.9, Number(watermarkOpacity) || 0.25));
    const wmColorRgb = utils.hexToRgbNormalized(watermarkColor || "#64748B");
    const numFontSize = 11;
    const numColorRgb = utils.hexToRgbNormalized("#1E293B");

    // Pre-prepare PNG fallback if custom TTF cannot encode characters (e.g., offline or emoji)
    let embeddedWmPng = null;
    let wmPngMeta = null;
    if (enableWatermark && !canEncodeWithFont(font, wmText)) {
      wmPngMeta = await utils.renderTextToPngBuffer(
        wmText,
        wmFontSize,
        watermarkColor || "#64748B",
        true
      );
      embeddedWmPng = await pdfDoc.embedPng(wmPngMeta.bytes);
    }

    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const pageNum = i + 1;
      const { width: rawW, height: rawH } = page.getSize();
      const rotAngle = (page.getRotation() && page.getRotation().angle) || 0;
      const visual = getVisualPageDimensions(rawW, rawH, rotAngle);

      // 1. Watermark
      if (enableWatermark) {
        const visualAngle = 45; // Bottom-left to top-right diagonal (matches CSS -45deg preview)
        const rad = (visualAngle * Math.PI) / 180;

        if (!embeddedWmPng) {
          // Scale watermark gracefully if page is smaller than A4
          const textW = font.widthOfTextAtSize(wmText, wmFontSize);
          const maxDiagSpan = Math.hypot(visual.width, visual.height) * 0.72;
          const effSize = textW > maxDiagSpan ? wmFontSize * (maxDiagSpan / textW) : wmFontSize;
          const finalW = font.widthOfTextAtSize(wmText, effSize);
          const finalH = effSize * 0.72;

          const dx = (finalW / 2) * Math.cos(rad) - (finalH / 2) * Math.sin(rad);
          const dy = (finalW / 2) * Math.sin(rad) + (finalH / 2) * Math.cos(rad);
          const originVX = visual.width / 2 - dx;
          const originVY = visual.height / 2 - dy;

          const mapped = mapVisualPointToRawPdf(
            originVX,
            originVY,
            visualAngle,
            rawW,
            rawH,
            rotAngle
          );

          page.drawText(wmText, {
            x: mapped.x,
            y: mapped.y,
            size: effSize,
            font,
            color: rgb(wmColorRgb.r, wmColorRgb.g, wmColorRgb.b),
            opacity: wmOpacity,
            rotate: degrees(mapped.angle),
          });
        } else {
          const maxDiagSpan = Math.hypot(visual.width, visual.height) * 0.72;
          const fitRatio = wmPngMeta.widthPt > maxDiagSpan ? maxDiagSpan / wmPngMeta.widthPt : 1;
          const drawW = wmPngMeta.widthPt * fitRatio;
          const drawH = wmPngMeta.heightPt * fitRatio;

          const dx = (drawW / 2) * Math.cos(rad) - (drawH / 2) * Math.sin(rad);
          const dy = (drawW / 2) * Math.sin(rad) + (drawH / 2) * Math.cos(rad);
          const originVX = visual.width / 2 - dx;
          const originVY = visual.height / 2 - dy;

          const mapped = mapVisualPointToRawPdf(
            originVX,
            originVY,
            visualAngle,
            rawW,
            rawH,
            rotAngle
          );

          page.drawImage(embeddedWmPng, {
            x: mapped.x,
            y: mapped.y,
            width: drawW,
            height: drawH,
            opacity: wmOpacity,
            rotate: degrees(mapped.angle),
          });
        }
      }

      // 2. Page Number
      if (enableNumbers) {
        const label =
          numberFormat === "page_of_total"
            ? `Trang ${pageNum} / ${totalPages}`
            : `${pageNum}`;

        const padX = 28;
        const padY = 22;

        if (canEncodeWithFont(font, label)) {
          const labelW = font.widthOfTextAtSize(label, numFontSize);
          let vx = (visual.width - labelW) / 2;
          let vy = padY;

          if (numberPosition === "bottom-right") {
            vx = visual.width - labelW - padX;
            vy = padY;
          } else if (numberPosition === "top-right") {
            vx = visual.width - labelW - padX;
            vy = visual.height - padY - numFontSize;
          }

          const mapped = mapVisualPointToRawPdf(vx, vy, 0, rawW, rawH, rotAngle);
          page.drawText(label, {
            x: mapped.x,
            y: mapped.y,
            size: numFontSize,
            font,
            color: rgb(numColorRgb.r, numColorRgb.g, numColorRgb.b),
            opacity: 0.9,
            rotate: degrees(mapped.angle),
          });
        } else {
          // Offline/fallback PNG rendering for non-WinAnsi Vietnamese "Trang 1 / 10"
          const numPng = await utils.renderTextToPngBuffer(label, numFontSize, "#1E293B", false);
          const embeddedNum = await pdfDoc.embedPng(numPng.bytes);
          let vx = (visual.width - numPng.widthPt) / 2;
          let vy = padY - 3;

          if (numberPosition === "bottom-right") {
            vx = visual.width - numPng.widthPt - padX;
            vy = padY - 3;
          } else if (numberPosition === "top-right") {
            vx = visual.width - numPng.widthPt - padX;
            vy = visual.height - padY - numPng.heightPt;
          }

          const mapped = mapVisualPointToRawPdf(vx, vy, 0, rawW, rawH, rotAngle);
          page.drawImage(embeddedNum, {
            x: mapped.x,
            y: mapped.y,
            width: numPng.widthPt,
            height: numPng.heightPt,
            opacity: 0.9,
            rotate: degrees(mapped.angle),
          });
        }
      }

      if (i % 10 === 0 || i === totalPages - 1) {
        const pct = 15 + Math.round(((i + 1) / totalPages) * 75);
        utils.setProgress(pct, `Đang xử lý trang ${pageNum}/${totalPages}...`);
        await utils.yieldToUI();
      }
    }

    utils.setProgress(93, "Đang lưu tệp PDF hoàn chỉnh...");
    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const filename = utils.sanitizeFilename(outputName, ".pdf");
    utils.downloadBlob(blob, filename);

    utils.setProgress(100, "Hoàn tất! Tệp PDF đã được tải xuống.", true);
    return { filename, size: blob.size, pageCount: totalPages };
  }

  global.PDFToolsPdf = {
    inspectPdfForMerge,
    runMergePdf,
    runSplitPdf,
    runOrganizePdf,
    runWatermarkAndNumbers,
  };
})(window);

/* ==========================================================================
   PDF Studio Pro — Application Controller, Bento Dashboard & Split Workspace
   ========================================================================== */

(function (global) {
  "use strict";

  const S = () => global.PDFStudio;
  const Conv = () => global.PDFToolsConvert;
  const PdfT = () => global.PDFToolsPdf;

  /* --------------------------------------------------------------------------
     Tool Definitions (7 Tools)
     -------------------------------------------------------------------------- */

  const TOOLS = [
    {
      id: "pdf-to-word",
      title: "Chuyển PDF sang Word (.docx)",
      shortDesc:
        "Trích xuất văn bản chỉnh sửa được hoặc giữ nguyên bố cục công thức, bảng biểu sang file Word chuẩn.",
      badge: "Tính năng trọng tâm",
      featured: true,
      accept: ".pdf,application/pdf",
      acceptLabel: "Hỗ trợ tệp .PDF",
      multiple: false,
      defaultExt: ".docx",
      actionLabel: "Chuyển sang Word (.docx)",
      accentBg: "#EFF6FF",
      accentColor: "#2563EB",
      accentBorder: "#93C5FD",
      iconSvg: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l1.5 5L12 14l2.5 4L16 13"/></svg>`,
    },
    {
      id: "merge-pdf",
      title: "Gộp nhiều file PDF",
      shortDesc: "Ghép nhiều tài liệu PDF thành 1 file hoàn chỉnh, kéo-thả sắp xếp thứ tự.",
      featured: false,
      accept: ".pdf,application/pdf",
      acceptLabel: "Chọn nhiều tệp .PDF",
      multiple: true,
      defaultExt: ".pdf",
      actionLabel: "Gộp thành 1 file PDF",
      accentBg: "#EEF2FF",
      accentColor: "#4F46E5",
      accentBorder: "#A5B4FC",
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="12" height="14" rx="2"/><path d="M4 8v11a2 2 0 0 0 2 2h11"/><path d="M12 7v4M10 9h4"/></svg>`,
    },
    {
      id: "split-pdf",
      title: "Tách & Trích xuất trang PDF",
      shortDesc: "Chọn trang trực quan hoặc nhập dãy trang, xuất 1 file PDF hay gói .ZIP.",
      featured: false,
      accept: ".pdf,application/pdf",
      acceptLabel: "Hỗ trợ tệp .PDF",
      multiple: false,
      defaultExt: ".pdf",
      actionLabel: "Tách & Xuất trang đã chọn",
      accentBg: "#F5F3FF",
      accentColor: "#7C3AED",
      accentBorder: "#C4B5FD",
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
    },
    {
      id: "organize-pdf",
      title: "Sắp xếp, Xoay & Xóa trang",
      shortDesc: "Kéo-thả đổi vị trí, xoay trái/phải 90° từng trang hoặc toàn bộ tài liệu.",
      featured: false,
      accept: ".pdf,application/pdf",
      acceptLabel: "Hỗ trợ tệp .PDF",
      multiple: false,
      defaultExt: ".pdf",
      actionLabel: "Lưu PDF sau khi sắp xếp",
      accentBg: "#FFFBEB",
      accentColor: "#D97706",
      accentBorder: "#FCD34D",
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
    },
    {
      id: "images-to-pdf",
      title: "Chuyển Ảnh sang PDF",
      shortDesc: "Nạp ảnh JPG, PNG, WebP thành PDF với tùy chọn khổ giấy A4, hướng và lề.",
      featured: false,
      accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
      acceptLabel: "Hỗ trợ JPG, PNG, WebP",
      multiple: true,
      defaultExt: ".pdf",
      actionLabel: "Tạo file PDF từ ảnh",
      accentBg: "#ECFDF5",
      accentColor: "#059669",
      accentBorder: "#6EE7B7",
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    },
    {
      id: "pdf-to-images",
      title: "Chuyển PDF sang Ảnh",
      shortDesc: "Xuất trang PDF thành ảnh PNG/JPG độ nét cao, tải từng ảnh hoặc file .ZIP.",
      featured: false,
      accept: ".pdf,application/pdf",
      acceptLabel: "Hỗ trợ tệp .PDF",
      multiple: false,
      defaultExt: ".zip",
      actionLabel: "Tải toàn bộ ảnh (.ZIP)",
      accentBg: "#F0F9FF",
      accentColor: "#0284C7",
      accentBorder: "#7DD3FC",
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><circle cx="10" cy="13" r="1.5"/><path d="M20 17l-3.5-3.5L11 19"/></svg>`,
    },
    {
      id: "watermark-numbers",
      title: "Đánh số trang & Đóng dấu",
      shortDesc: "Tự động đánh số trang và chèn chữ bản quyền mờ (Watermark) chuyên nghiệp.",
      featured: false,
      accept: ".pdf,application/pdf",
      acceptLabel: "Hỗ trợ tệp .PDF",
      multiple: false,
      defaultExt: ".pdf",
      actionLabel: "Áp dụng & Xuất file PDF",
      accentBg: "#FFF1F2",
      accentColor: "#E11D48",
      accentBorder: "#FDA4AF",
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`,
    },
  ];

  /* --------------------------------------------------------------------------
     Application State
     -------------------------------------------------------------------------- */

  const state = {
    activeToolId: null,
    isProcessing: false,
    renderSessionId: 0,

    // Single PDF loaded state (Tools 1, 3, 4, 6, 7)
    fileName: "",
    fileSize: 0,
    totalPages: 0,
    arrayBuffer: null,
    pdfJsDoc: null,

    // Multi-file lists (Tool 2 Merge & Tool 5 Images-to-PDF)
    mergeFiles: [],
    imageItems: [],

    // Tool 1 options
    wordMode: "editable", // 'editable' | 'exact'
    wordRangeMode: "all", // 'all' | 'custom'
    wordRangeText: "1-5",
    wordPageBreak: true,
    wordExactScale: "2.0",

    // Tool 3 Split state
    splitSelected: new Set(),
    splitRangeText: "",
    splitRangeError: "",
    splitExportMode: "single_pdf", // 'single_pdf' | 'zip_pages'

    // Tool 4 Organize state
    organizePages: [], // [{ id, originalIndex, pageNumber, rotationDelta, thumbUrl }]

    // Tool 5 Images -> PDF options
    imgPaperSize: "a4", // 'a4' | 'fit'
    imgOrientation: "portrait", // 'portrait' | 'landscape'
    imgMargin: "small", // 'none' | 'small' | 'medium'

    // Tool 6 PDF -> Images options
    imgOutFormat: "png", // 'png' | 'jpg'
    imgOutScale: "1.5", // '1.5' | '2.5'

    // Tool 7 Watermark & Page Numbers options
    wmEnableNumbers: true,
    wmNumberFormat: "page_of_total", // 'number_only' | 'page_of_total'
    wmNumberPos: "bottom-center", // 'bottom-center' | 'bottom-right' | 'top-right'
    wmEnableWatermark: true,
    wmText: "Tài liệu lưu hành nội bộ",
    wmFontSize: 48,
    wmColor: "#64748B",
    wmOpacity: 0.25,
    wmPreviewUrl: "",
    wmPreviewPagePointWidth: 595,
  };

  /* --------------------------------------------------------------------------
     DOM References
     -------------------------------------------------------------------------- */

  const dom = {};

  function cacheDom() {
    dom.dashboardView = document.getElementById("dashboardView");
    dom.workspaceView = document.getElementById("workspaceView");
    dom.bentoGrid = document.getElementById("bentoGrid");
    dom.brandHomeBtn = document.getElementById("brandHomeBtn");
    dom.navHomeBtn = document.getElementById("navHomeBtn");
    dom.backToHomeBtn = document.getElementById("backToHomeBtn");
    dom.workspaceToolBadge = document.getElementById("workspaceToolBadge");
    dom.workspaceQuickTools = document.getElementById("workspaceQuickTools");
    dom.dropzone = document.getElementById("dropzone");
    dom.fileInput = document.getElementById("fileInput");
    dom.dropzoneTitle = document.getElementById("dropzoneTitle");
    dom.dropzoneSubtitle = document.getElementById("dropzoneSubtitle");
    dom.dropzoneAcceptTag = document.getElementById("dropzoneAcceptTag");
    dom.stageToolbar = document.getElementById("stageToolbar");
    dom.stageBody = document.getElementById("stageBody");
    dom.settingsToolTag = document.getElementById("settingsToolTag");
    dom.toolSettingsContainer = document.getElementById("toolSettingsContainer");
    dom.outputFilenameInput = document.getElementById("outputFilenameInput");
    dom.outputExtBadge = document.getElementById("outputExtBadge");
    dom.primaryActionBtn = document.getElementById("primaryActionBtn");
    dom.primaryActionSpinner = document.getElementById("primaryActionSpinner");
    dom.primaryActionLabel = document.getElementById("primaryActionLabel");
    dom.resultSummaryCard = document.getElementById("resultSummaryCard");
    dom.cdnWarningBanner = document.getElementById("cdnWarningBanner");
    dom.cdnWarningDetail = document.getElementById("cdnWarningDetail");
  }

  function getToolById(id) {
    return TOOLS.find((t) => t.id === id) || null;
  }

  /* --------------------------------------------------------------------------
     Cleanup & State Reset
     -------------------------------------------------------------------------- */

  function resetLoadedFiles() {
    state.renderSessionId += 1;

    if (state.pdfJsDoc && typeof state.pdfJsDoc.destroy === "function") {
      try {
        state.pdfJsDoc.destroy();
      } catch (_e) {
        // ignore
      }
    }

    S().revokeAllTrackedUrls();

    state.fileName = "";
    state.fileSize = 0;
    state.totalPages = 0;
    state.arrayBuffer = null;
    state.pdfJsDoc = null;
    state.mergeFiles = [];
    state.imageItems = [];
    state.splitSelected = new Set();
    state.splitRangeText = "";
    state.splitRangeError = "";
    state.organizePages = [];
    state.wmPreviewUrl = "";

    if (dom.fileInput) dom.fileInput.value = "";
    if (dom.resultSummaryCard) {
      dom.resultSummaryCard.classList.add("hidden");
      dom.resultSummaryCard.innerHTML = "";
    }
    S().setProgress(0, "Sẵn sàng xử lý", false);
  }

  /* --------------------------------------------------------------------------
     Dashboard Rendering (Bento Grid)
     -------------------------------------------------------------------------- */

  function renderDashboard() {
    const utils = S();
    dom.bentoGrid.innerHTML = TOOLS.map((tool) => {
      return `
        <button
          type="button"
          class="tool-card ${tool.featured ? "is-featured" : ""}"
          data-tool-id="${tool.id}"
          style="--tool-accent-border: ${tool.accentBorder};"
        >
          <div>
            <div class="tool-card-top">
              <div class="tool-icon-box" style="background: ${tool.accentBg}; color: ${tool.accentColor};">
                ${tool.iconSvg}
              </div>
              ${tool.badge ? `<span class="tool-badge">${utils.escapeHtml(tool.badge)}</span>` : ""}
            </div>
            <div class="tool-card-body" style="margin-top: 16px;">
              <h3>${utils.escapeHtml(tool.title)}</h3>
              <p>${utils.escapeHtml(tool.shortDesc)}</p>
            </div>
          </div>
          <div class="tool-card-footer">
            <span>Mở công cụ</span>
            <span class="tool-arrow" aria-hidden="true">→</span>
          </div>
        </button>
      `;
    }).join("");

    dom.bentoGrid.querySelectorAll("[data-tool-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openTool(btn.getAttribute("data-tool-id"));
      });
    });
  }

  /* --------------------------------------------------------------------------
     Navigation Between Dashboard & Workspace
     -------------------------------------------------------------------------- */

  function showDashboard() {
    if (state.isProcessing) {
      S().showToast("warning", "Đang xử lý", "Vui lòng đợi tiến trình hiện tại hoàn tất.");
      return;
    }
    resetLoadedFiles();
    state.activeToolId = null;
    dom.workspaceView.classList.add("hidden");
    dom.dashboardView.classList.remove("hidden");
    dom.navHomeBtn.classList.add("is-active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTool(toolId) {
    if (state.isProcessing) {
      S().showToast("warning", "Đang xử lý", "Vui lòng đợi tiến trình hiện tại hoàn tất.");
      return;
    }
    const tool = getToolById(toolId);
    if (!tool) return;

    resetLoadedFiles();
    state.activeToolId = toolId;

    dom.dashboardView.classList.add("hidden");
    dom.workspaceView.classList.remove("hidden");
    dom.navHomeBtn.classList.remove("is-active");

    // Top bar & quick switcher
    dom.workspaceToolBadge.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:${tool.accentBg};color:${tool.accentColor};">
        ${tool.iconSvg}
      </span>
      <span>${S().escapeHtml(tool.title)}</span>
    `;

    dom.workspaceQuickTools.innerHTML = TOOLS.map(
      (t) => `
        <button
          type="button"
          class="quick-tool-pill ${t.id === toolId ? "is-active" : ""}"
          data-switch-tool="${t.id}"
          title="${S().escapeHtml(t.title)}"
        >
          ${S().escapeHtml(getShortPillName(t.id))}
        </button>
      `
    ).join("");

    dom.workspaceQuickTools.querySelectorAll("[data-switch-tool]").forEach((pill) => {
      pill.addEventListener("click", () => openTool(pill.getAttribute("data-switch-tool")));
    });

    // Dropzone configuration
    dom.fileInput.accept = tool.accept;
    dom.fileInput.multiple = tool.multiple;
    dom.dropzoneAcceptTag.textContent = tool.acceptLabel;
    dom.settingsToolTag.textContent = getShortPillName(tool.id);

    renderWorkspaceView();
    renderSettingsPanel();
    updateOutputFilenameDefault();
    updatePrimaryActionState();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getShortPillName(toolId) {
    const map = {
      "pdf-to-word": "PDF → Word",
      "merge-pdf": "Gộp PDF",
      "split-pdf": "Tách PDF",
      "organize-pdf": "Sắp xếp & Xoay",
      "images-to-pdf": "Ảnh → PDF",
      "pdf-to-images": "PDF → Ảnh",
      "watermark-numbers": "Số trang & Watermark",
    };
    return map[toolId] || toolId;
  }

  /* --------------------------------------------------------------------------
     File Input & Drag-Drop Handlers
     -------------------------------------------------------------------------- */

  function hasLoadedData() {
    switch (state.activeToolId) {
      case "merge-pdf":
        return state.mergeFiles.length > 0;
      case "images-to-pdf":
        return state.imageItems.length > 0;
      default:
        return Boolean(state.pdfJsDoc && state.totalPages > 0);
    }
  }

  function isPdfFile(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return type === "application/pdf" || name.endsWith(".pdf");
  }

  function isSupportedImageFile(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return (
      type === "image/jpeg" ||
      type === "image/png" ||
      type === "image/webp" ||
      /\.(jpe?g|png|webp)$/.test(name)
    );
  }

  async function handleIncomingFiles(fileList) {
    const utils = S();
    if (!fileList || fileList.length === 0 || state.isProcessing) return;
    const files = Array.from(fileList);
    const toolId = state.activeToolId;
    if (!toolId) return;

    dom.resultSummaryCard.classList.add("hidden");
    utils.setProgress(0, "Đang nạp tệp...", false);

    try {
      if (toolId === "merge-pdf") {
        let added = 0;
        for (const f of files) {
          if (!isPdfFile(f)) {
            utils.showToast("error", "Sai định dạng", `"${f.name}" không phải file PDF.`);
            continue;
          }
          try {
            const info = await PdfT().inspectPdfForMerge(f);
            state.mergeFiles.push(info);
            added++;
          } catch (err) {
            utils.showToast("error", "Không thể đọc PDF", err.message);
          }
        }
        if (added > 0) {
          utils.showToast("success", "Đã thêm tệp PDF", `Đã nạp ${added} tệp vào danh sách gộp.`);
        }
        updateOutputFilenameDefault();
        renderWorkspaceView();
        renderSettingsPanel();
        updatePrimaryActionState();
        utils.setProgress(0, "Sẵn sàng gộp PDF", false);
        return;
      }

      if (toolId === "images-to-pdf") {
        let added = 0;
        for (const f of files) {
          if (!isSupportedImageFile(f)) {
            utils.showToast(
              "error",
              "Định dạng ảnh chưa hỗ trợ",
              `"${f.name}" không phải ảnh JPG, PNG hoặc WebP.`
            );
            continue;
          }
          try {
            const meta = await Conv().readImageMetadata(f);
            state.imageItems.push(meta);
            added++;
          } catch (err) {
            utils.showToast("error", "Lỗi đọc ảnh", err.message);
          }
        }
        if (added > 0) {
          utils.showToast("success", "Đã thêm ảnh", `Đã nạp ${added} ảnh vào danh sách.`);
        }
        updateOutputFilenameDefault();
        renderWorkspaceView();
        renderSettingsPanel();
        updatePrimaryActionState();
        utils.setProgress(0, "Sẵn sàng tạo PDF", false);
        return;
      }

      // Single-PDF tools: take the first file
      const file = files[0];
      if (!isPdfFile(file)) {
        utils.showToast("error", "Sai định dạng tệp", `"${file.name}" không phải là file PDF (.pdf).`);
        utils.setProgress(0, "Vui lòng chọn file PDF hợp lệ", false);
        return;
      }

      utils.setProgress(15, `Đang phân tích "${file.name}"...`);
      const buffer = await utils.readFileAsArrayBuffer(file);
      const pdfJsDoc = await utils.openPdfWithPdfJs(buffer, file.name);
      // Also verify with pdf-lib upfront for tools that modify PDFs so encrypted/broken edge cases are caught early
      if (toolId !== "pdf-to-word" && toolId !== "pdf-to-images") {
        try {
          await utils.openPdfWithPdfLib(buffer, file.name);
        } catch (libErr) {
          if (typeof pdfJsDoc.destroy === "function") pdfJsDoc.destroy();
          throw libErr;
        }
      }

      resetLoadedFiles();
      state.fileName = file.name;
      state.fileSize = file.size;
      state.arrayBuffer = buffer;
      state.pdfJsDoc = pdfJsDoc;
      state.totalPages = pdfJsDoc.numPages;

      if (toolId === "split-pdf") {
        // Pre-select all or leave empty? Let's pre-select page 1 or all? Actually selecting all by default OR clear makes intent explicit: let's pre-select all pages (or empty? Actually selecting nothing lets user pick, OR selecting 1..totalPages if small? No! Letting user click pages or type `1-3, 5` is much cleaner when empty, or let's add a 1-click "Chọn tất cả" right in toolbar!).
        state.splitSelected = new Set();
        state.splitRangeText = "";
        state.splitRangeError = "";
      } else if (toolId === "organize-pdf") {
        state.organizePages = Array.from({ length: pdfJsDoc.numPages }, (_, idx) => ({
          id: `pg_${idx + 1}`,
          originalIndex: idx,
          pageNumber: idx + 1,
          rotationDelta: 0,
          thumbUrl: "",
        }));
      }

      updateOutputFilenameDefault();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
      utils.setProgress(0, `Đã sẵn sàng (${state.totalPages} trang)`, false);
    } catch (err) {
      utils.setProgress(0, "Không thể nạp tệp", false);
      utils.showToast("error", "Lỗi đọc tài liệu PDF", err.message || String(err), 6500);
    }
  }

  /* --------------------------------------------------------------------------
     Left Workspace Rendering
     -------------------------------------------------------------------------- */

  function updateDropzoneAppearance() {
    const tool = getToolById(state.activeToolId);
    if (!tool) return;

    const loaded = hasLoadedData();
    dom.dropzone.classList.toggle("is-compact", loaded);

    if (loaded) {
      dom.dropzoneTitle.textContent = tool.multiple
        ? "Kéo thả thêm tệp vào đây để bổ sung vào danh sách"
        : `Đã nạp: ${state.fileName} — Kéo thả tệp khác để thay thế`;
      dom.stageToolbar.classList.remove("hidden");
      dom.stageBody.classList.remove("hidden");
    } else {
      dom.dropzoneTitle.textContent = tool.multiple
        ? "Kéo & thả nhiều tệp vào đây"
        : "Kéo & thả tệp PDF vào đây";
      dom.dropzoneSubtitle.textContent =
        tool.id === "images-to-pdf"
          ? "Hỗ trợ chọn cùng lúc nhiều ảnh JPG, PNG, WebP để ghép thành PDF"
          : "hoặc bấm để chọn tệp trực tiếp từ máy tính của bạn (xử lý 100% cục bộ)";
      dom.stageToolbar.classList.add("hidden");
      dom.stageBody.classList.add("hidden");
      dom.stageToolbar.innerHTML = "";
      dom.stageBody.innerHTML = "";
    }
  }

  function renderWorkspaceView() {
    updateDropzoneAppearance();
    if (!hasLoadedData()) return;

    const toolId = state.activeToolId;
    if (toolId === "merge-pdf") return renderMergeWorkspace();
    if (toolId === "images-to-pdf") return renderImagesToPdfWorkspace();
    if (toolId === "pdf-to-word") return renderPdfToWordWorkspace();
    if (toolId === "split-pdf") return renderSplitWorkspace();
    if (toolId === "organize-pdf") return renderOrganizeWorkspace();
    if (toolId === "pdf-to-images") return renderPdfToImagesWorkspace();
    if (toolId === "watermark-numbers") return renderWatermarkWorkspace();
  }

  /* --- Tool 1 Workspace (Summary + Preview Strip) --- */
  function renderPdfToWordWorkspace() {
    const utils = S();
    const previewLimit = Math.min(state.totalPages, 12);
    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info">
          <strong>${utils.escapeHtml(state.fileName)}</strong> • ${utils.formatBytes(state.fileSize)} • <strong>${state.totalPages} trang</strong>
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Xóa tệp</button>
      </div>
    `;
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    const cardsHtml = Array.from({ length: previewLimit }, (_, i) => {
      const p = i + 1;
      return `
        <div class="page-card">
          <div class="page-thumb-stage" data-thumb-stage="${p}">
            <div class="page-thumb-skeleton"></div>
          </div>
          <div class="page-card-footer">
            <div class="page-label">Trang ${p}</div>
          </div>
        </div>
      `;
    }).join("");

    dom.stageBody.innerHTML = `
      ${
        state.totalPages > previewLimit
          ? `<div class="pdf-doc-banner">
              <div class="pdf-doc-info">
                <div class="file-pdf-badge">PDF</div>
                <div>
                  <div class="pdf-doc-title">Đang hiển thị xem trước ${previewLimit}/${state.totalPages} trang đầu</div>
                  <div class="pdf-doc-meta">Khi chuyển đổi sang Word, ứng dụng vẫn xử lý đầy đủ theo phạm vi trang bạn đã chọn ở cột phải.</div>
                </div>
              </div>
            </div>`
          : ""
      }
      <div class="thumb-grid">${cardsHtml}</div>
    `;

    startProgressiveThumbQueue(
      Array.from({ length: previewLimit }, (_, i) => i + 1),
      220
    );
  }

  /* --- Tool 2 Workspace (Merge PDF File List) --- */
  function renderMergeWorkspace() {
    const utils = S();
    const totalPages = state.mergeFiles.reduce((acc, f) => acc + f.pageCount, 0);
    const totalBytes = state.mergeFiles.reduce((acc, f) => acc + f.size, 0);

    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info">
          <strong>${state.mergeFiles.length} tệp PDF</strong> • Tổng cộng <strong>${totalPages} trang</strong> (${utils.formatBytes(totalBytes)})
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm" id="addMoreFilesBtn">+ Thêm file PDF</button>
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Xóa tất cả</button>
      </div>
    `;

    document.getElementById("addMoreFilesBtn").addEventListener("click", () => dom.fileInput.click());
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    dom.stageBody.innerHTML = `
      <div class="file-list" id="mergeFileList">
        ${state.mergeFiles
          .map(
            (item, idx) => `
          <div class="file-item-card" draggable="true" data-index="${idx}">
            <span class="drag-handle" title="Kéo thả để đổi vị trí">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>
            </span>
            <span class="file-order-num">${idx + 1}</span>
            <span class="file-pdf-badge">PDF</span>
            <div class="file-meta">
              <div class="file-name" title="${utils.escapeHtml(item.name)}">${utils.escapeHtml(item.name)}</div>
              <div class="file-sub">${item.pageCount} trang • ${utils.formatBytes(item.size)}</div>
            </div>
            <div class="file-actions">
              <button type="button" class="icon-btn" data-move-up="${idx}" ${idx === 0 ? "disabled" : ""} title="Chuyển lên">↑</button>
              <button type="button" class="icon-btn" data-move-down="${idx}" ${idx === state.mergeFiles.length - 1 ? "disabled" : ""} title="Chuyển xuống">↓</button>
              <button type="button" class="icon-btn is-danger" data-remove="${idx}" title="Xóa khỏi danh sách">✕</button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    wireReorderableList(dom.stageBody.querySelector("#mergeFileList"), state.mergeFiles, () => {
      renderMergeWorkspace();
      renderSettingsPanel();
      updatePrimaryActionState();
    });
  }

  /* --- Tool 3 Workspace (Split & 2-Way Synchronized Selection Grid) --- */
  function renderSplitWorkspace() {
    const utils = S();
    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info" id="splitSelectionSummary">
          Đã chọn <strong>${state.splitSelected.size}</strong> / ${state.totalPages} trang
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm" id="splitSelectAllBtn">Chọn tất cả</button>
        <button type="button" class="btn-tool-sm" id="splitSelectOddBtn">Trang lẻ</button>
        <button type="button" class="btn-tool-sm" id="splitSelectEvenBtn">Trang chẵn</button>
        <button type="button" class="btn-tool-sm" id="splitClearSelBtn">Bỏ chọn</button>
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Đổi tệp</button>
      </div>
    `;

    document.getElementById("splitSelectAllBtn").addEventListener("click", () => {
      for (let p = 1; p <= state.totalPages; p++) state.splitSelected.add(p);
      syncSplitFromSetToInputAndGrid();
    });
    document.getElementById("splitSelectOddBtn").addEventListener("click", () => {
      state.splitSelected.clear();
      for (let p = 1; p <= state.totalPages; p += 2) state.splitSelected.add(p);
      syncSplitFromSetToInputAndGrid();
    });
    document.getElementById("splitSelectEvenBtn").addEventListener("click", () => {
      state.splitSelected.clear();
      for (let p = 2; p <= state.totalPages; p += 2) state.splitSelected.add(p);
      syncSplitFromSetToInputAndGrid();
    });
    document.getElementById("splitClearSelBtn").addEventListener("click", () => {
      state.splitSelected.clear();
      syncSplitFromSetToInputAndGrid();
    });
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    const cardsHtml = Array.from({ length: state.totalPages }, (_, idx) => {
      const p = idx + 1;
      const isSelected = state.splitSelected.has(p);
      return `
        <div class="page-card is-clickable ${isSelected ? "is-selected" : ""}" data-split-page="${p}" role="checkbox" aria-checked="${isSelected}" tabindex="0">
          <span class="page-check-badge" aria-hidden="true">✓</span>
          <div class="page-thumb-stage" data-thumb-stage="${p}">
            <div class="page-thumb-skeleton"></div>
          </div>
          <div class="page-card-footer">
            <div class="page-label">Trang ${p}</div>
          </div>
        </div>
      `;
    }).join("");

    dom.stageBody.innerHTML = `<div class="thumb-grid" id="splitThumbGrid">${cardsHtml}</div>`;

    const grid = document.getElementById("splitThumbGrid");
    grid.querySelectorAll("[data-split-page]").forEach((card) => {
      const toggle = () => {
        const p = Number(card.getAttribute("data-split-page"));
        if (state.splitSelected.has(p)) state.splitSelected.delete(p);
        else state.splitSelected.add(p);
        syncSplitFromSetToInputAndGrid();
      };
      card.addEventListener("click", toggle);
      card.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      });
    });

    startProgressiveThumbQueue(
      Array.from({ length: state.totalPages }, (_, i) => i + 1),
      210
    );
  }

  function syncSplitFromSetToInputAndGrid() {
    state.splitRangeText = S().formatPageRanges(Array.from(state.splitSelected));
    state.splitRangeError = "";

    const rangeInput = document.getElementById("splitRangeInput");
    if (rangeInput) rangeInput.value = state.splitRangeText;

    const errEl = document.getElementById("splitRangeHint");
    if (errEl) {
      errEl.textContent = "Nhập số trang cách nhau bởi dấu phẩy hoặc dấu gạch ngang (vd: 1-3, 5, 8-12).";
      errEl.classList.remove("is-error");
    }

    syncSplitGridOnly();
  }

  function syncSplitGridOnly() {
    const summary = document.getElementById("splitSelectionSummary");
    if (summary) {
      summary.innerHTML = `Đã chọn <strong>${state.splitSelected.size}</strong> / ${state.totalPages} trang`;
    }

    const countStat = document.getElementById("splitSelectedStat");
    if (countStat) {
      countStat.textContent = `${state.splitSelected.size} trang`;
    }

    document.querySelectorAll("[data-split-page]").forEach((card) => {
      const p = Number(card.getAttribute("data-split-page"));
      const sel = state.splitSelected.has(p);
      card.classList.toggle("is-selected", sel);
      card.setAttribute("aria-checked", String(sel));
    });

    updatePrimaryActionState();
  }

  /* --- Tool 4 Workspace (Organize, Rotate & Delete) --- */
  function renderOrganizeWorkspace() {
    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info">
          Còn lại <strong>${state.organizePages.length}</strong> / ${state.totalPages} trang • Kéo-thả thẻ để đổi vị trí
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm" id="rotateAllRightBtn">↻ Xoay tất cả 90°</button>
        <button type="button" class="btn-tool-sm" id="rotateAllLeftBtn">↺ Xoay trái tất cả</button>
        <button type="button" class="btn-tool-sm" id="resetOrganizeBtn">Khôi phục gốc</button>
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Đổi tệp</button>
      </div>
    `;

    document.getElementById("rotateAllRightBtn").addEventListener("click", () => {
      state.organizePages.forEach((p) => {
        p.rotationDelta = (p.rotationDelta + 90) % 360;
      });
      renderOrganizeGridOnly();
      renderSettingsPanel();
    });
    document.getElementById("rotateAllLeftBtn").addEventListener("click", () => {
      state.organizePages.forEach((p) => {
        p.rotationDelta = (p.rotationDelta + 270) % 360;
      });
      renderOrganizeGridOnly();
      renderSettingsPanel();
    });
    document.getElementById("resetOrganizeBtn").addEventListener("click", () => {
      const urlByOrig = new Map(state.organizePages.map((p) => [p.pageNumber, p.thumbUrl]));
      state.organizePages = Array.from({ length: state.totalPages }, (_, idx) => ({
        id: `pg_${idx + 1}`,
        originalIndex: idx,
        pageNumber: idx + 1,
        rotationDelta: 0,
        thumbUrl: urlByOrig.get(idx + 1) || "",
      }));
      renderOrganizeWorkspace();
      renderSettingsPanel();
    });
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    dom.stageBody.innerHTML = `<div class="thumb-grid" id="organizeThumbGrid"></div>`;
    renderOrganizeGridOnly();

    // Queue thumbnails for any page that doesn't have thumbUrl yet
    const missingPages = state.organizePages
      .filter((p) => !p.thumbUrl)
      .map((p) => p.pageNumber);
    if (missingPages.length > 0) {
      startProgressiveThumbQueue(missingPages, 210, (pageNum, url) => {
        const target = state.organizePages.find((p) => p.pageNumber === pageNum);
        if (target) target.thumbUrl = url;
      });
    }
  }

  function renderOrganizeGridOnly() {
    const grid = document.getElementById("organizeThumbGrid");
    if (!grid) return;

    const infoEl = dom.stageToolbar.querySelector(".toolbar-info");
    if (infoEl) {
      infoEl.innerHTML = `Còn lại <strong>${state.organizePages.length}</strong> / ${state.totalPages} trang • Kéo-thả thẻ để đổi vị trí`;
    }

    grid.innerHTML = state.organizePages
      .map((item, idx) => {
        const rot = item.rotationDelta || 0;
        const imgStyle = `transform: rotate(${rot}deg); ${rot === 90 || rot === 270 ? "max-width: 82%; max-height: 82%;" : ""}`;
        return `
          <div class="page-card is-draggable" draggable="true" data-org-idx="${idx}">
            ${rot !== 0 ? `<span class="page-rot-badge">+${rot}°</span>` : ""}
            <div class="page-thumb-stage is-square" data-thumb-stage="${item.pageNumber}">
              ${
                item.thumbUrl
                  ? `<img class="page-thumb-img" src="${item.thumbUrl}" alt="Trang ${item.pageNumber}" style="${imgStyle}" />`
                  : `<div class="page-thumb-skeleton"></div>`
              }
            </div>
            <div class="page-card-footer">
              <div class="page-label">Vị trí ${idx + 1} (Gốc tr.${item.pageNumber})</div>
              <div class="page-actions-row">
                <button type="button" class="page-mini-btn" data-rot-left="${idx}" title="Xoay trái 90°">↺ 90°</button>
                <button type="button" class="page-mini-btn" data-rot-right="${idx}" title="Xoay phải 90°">↻ 90°</button>
                <button type="button" class="page-mini-btn is-danger" data-del-page="${idx}" title="Xóa trang">🗑</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // Bind action buttons
    grid.querySelectorAll("[data-rot-left]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = Number(btn.getAttribute("data-rot-left"));
        state.organizePages[i].rotationDelta = (state.organizePages[i].rotationDelta + 270) % 360;
        renderOrganizeGridOnly();
        renderSettingsPanel();
      });
    });

    grid.querySelectorAll("[data-rot-right]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = Number(btn.getAttribute("data-rot-right"));
        state.organizePages[i].rotationDelta = (state.organizePages[i].rotationDelta + 90) % 360;
        renderOrganizeGridOnly();
        renderSettingsPanel();
      });
    });

    grid.querySelectorAll("[data-del-page]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.organizePages.length <= 1) {
          S().showToast("warning", "Không thể xóa", "Tài liệu phải giữ lại ít nhất 1 trang.");
          return;
        }
        const i = Number(btn.getAttribute("data-del-page"));
        state.organizePages.splice(i, 1);
        renderOrganizeGridOnly();
        renderSettingsPanel();
      });
    });

    // Drag-and-drop reorder cards
    let dragSrc = null;
    grid.querySelectorAll("[data-org-idx]").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        dragSrc = Number(card.getAttribute("data-org-idx"));
        card.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragSrc));
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        card.classList.add("is-drag-target");
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("is-drag-target");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("is-drag-target");
        const targetIdx = Number(card.getAttribute("data-org-idx"));
        if (dragSrc !== null && dragSrc !== targetIdx) {
          const [moved] = state.organizePages.splice(dragSrc, 1);
          state.organizePages.splice(targetIdx, 0, moved);
          renderOrganizeGridOnly();
        }
      });
      card.addEventListener("dragend", () => {
        dragSrc = null;
        grid.querySelectorAll("[data-org-idx]").forEach((c) => {
          c.classList.remove("is-dragging", "is-drag-target");
        });
      });
    });
  }

  /* --- Tool 5 Workspace (Images -> PDF List) --- */
  function renderImagesToPdfWorkspace() {
    const utils = S();
    const totalBytes = state.imageItems.reduce((acc, it) => acc + it.size, 0);

    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info">
          <strong>${state.imageItems.length} ảnh</strong> (${utils.formatBytes(totalBytes)}) • Kéo-thả để đổi thứ tự trang
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm" id="addMoreImgsBtn">+ Thêm ảnh</button>
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Xóa tất cả</button>
      </div>
    `;

    document.getElementById("addMoreImgsBtn").addEventListener("click", () => dom.fileInput.click());
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    dom.stageBody.innerHTML = `
      <div class="file-list" id="imageFileList">
        ${state.imageItems
          .map(
            (item, idx) => `
          <div class="file-item-card" draggable="true" data-index="${idx}">
            <span class="drag-handle" title="Kéo thả để đổi vị trí">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>
            </span>
            <span class="file-order-num">${idx + 1}</span>
            <img class="file-thumb-mini" src="${item.previewUrl}" alt="${utils.escapeHtml(item.name)}" />
            <div class="file-meta">
              <div class="file-name" title="${utils.escapeHtml(item.name)}">${utils.escapeHtml(item.name)}</div>
              <div class="file-sub">${item.width} × ${item.height} px • ${utils.formatBytes(item.size)}</div>
            </div>
            <div class="file-actions">
              <button type="button" class="icon-btn" data-move-up="${idx}" ${idx === 0 ? "disabled" : ""} title="Chuyển lên">↑</button>
              <button type="button" class="icon-btn" data-move-down="${idx}" ${idx === state.imageItems.length - 1 ? "disabled" : ""} title="Chuyển xuống">↓</button>
              <button type="button" class="icon-btn is-danger" data-remove="${idx}" title="Xóa ảnh">✕</button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    wireReorderableList(dom.stageBody.querySelector("#imageFileList"), state.imageItems, () => {
      renderImagesToPdfWorkspace();
      renderSettingsPanel();
      updatePrimaryActionState();
    });
  }

  /* --- Shared Reorderable List Wiring (Merge & Images) --- */
  function wireReorderableList(listEl, arrayRef, onChange) {
    if (!listEl) return;

    listEl.querySelectorAll("[data-move-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-move-up"));
        if (idx > 0) {
          const [moved] = arrayRef.splice(idx, 1);
          arrayRef.splice(idx - 1, 0, moved);
          onChange();
        }
      });
    });

    listEl.querySelectorAll("[data-move-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-move-down"));
        if (idx < arrayRef.length - 1) {
          const [moved] = arrayRef.splice(idx, 1);
          arrayRef.splice(idx + 1, 0, moved);
          onChange();
        }
      });
    });

    listEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove"));
        const removed = arrayRef.splice(idx, 1)[0];
        if (removed && removed.previewUrl) {
          S().revokeTrackedUrl(removed.previewUrl);
        }
        onChange();
      });
    });

    let dragSrc = null;
    listEl.querySelectorAll("[data-index]").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        dragSrc = Number(card.getAttribute("data-index"));
        card.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragSrc));
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        card.classList.add("is-drag-target");
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("is-drag-target");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("is-drag-target");
        const target = Number(card.getAttribute("data-index"));
        if (dragSrc !== null && dragSrc !== target) {
          const [moved] = arrayRef.splice(dragSrc, 1);
          arrayRef.splice(target, 0, moved);
          onChange();
        }
      });
      card.addEventListener("dragend", () => {
        dragSrc = null;
        listEl.querySelectorAll("[data-index]").forEach((c) => {
          c.classList.remove("is-dragging", "is-drag-target");
        });
      });
    });
  }

  /* --- Tool 6 Workspace (PDF -> Images Preview + Per-page Download) --- */
  function renderPdfToImagesWorkspace() {
    const utils = S();
    const extUpper = state.imgOutFormat.toUpperCase();

    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info">
          <strong>${utils.escapeHtml(state.fileName)}</strong> • <strong>${state.totalPages} trang</strong>
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Đổi tệp</button>
      </div>
    `;
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    const cardsHtml = Array.from({ length: state.totalPages }, (_, i) => {
      const p = i + 1;
      return `
        <div class="page-card">
          <div class="page-thumb-stage" data-thumb-stage="${p}">
            <div class="page-thumb-skeleton"></div>
          </div>
          <div class="page-card-footer">
            <div class="page-label">Trang ${p}</div>
            <button type="button" class="btn-download-single" data-dl-img-page="${p}">
              Tải ảnh .${extUpper}
            </button>
          </div>
        </div>
      `;
    }).join("");

    dom.stageBody.innerHTML = `<div class="thumb-grid">${cardsHtml}</div>`;

    dom.stageBody.querySelectorAll("[data-dl-img-page]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pageNum = Number(btn.getAttribute("data-dl-img-page"));
        if (state.isProcessing) return;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Đang xuất...";
        try {
          const res = await Conv().exportSinglePdfPageImage(state.pdfJsDoc, pageNum, {
            format: state.imgOutFormat,
            scale: state.imgOutScale,
            baseName: dom.outputFilenameInput.value || state.fileName,
          });
          utils.showToast("success", "Đã tải ảnh lẻ", `${res.filename} (${utils.formatBytes(res.size)})`);
        } catch (err) {
          utils.showToast("error", "Lỗi xuất ảnh", err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    });

    startProgressiveThumbQueue(
      Array.from({ length: state.totalPages }, (_, i) => i + 1),
      220
    );
  }

  /* --- Tool 7 Workspace (Watermark & Page Numbers Live Preview) --- */
  async function renderWatermarkWorkspace() {
    const utils = S();
    dom.stageToolbar.innerHTML = `
      <div class="toolbar-group">
        <span class="toolbar-info">
          <strong>${utils.escapeHtml(state.fileName)}</strong> • <strong>${state.totalPages} trang</strong>
        </span>
      </div>
      <div class="toolbar-group">
        <button type="button" class="btn-tool-sm is-danger" id="clearWorkspaceBtn">Đổi tệp</button>
      </div>
    `;
    document.getElementById("clearWorkspaceBtn").addEventListener("click", () => {
      resetLoadedFiles();
      renderWorkspaceView();
      renderSettingsPanel();
      updatePrimaryActionState();
    });

    dom.stageBody.innerHTML = `
      <div class="live-preview-wrap">
        <div class="live-preview-hint">Xem trước trực tiếp trên Trang 1 (tự động cập nhật khi bạn thay đổi tùy chọn bên phải)</div>
        <div class="live-page-canvas-box" id="livePreviewBox">
          <div style="width: 340px; height: 460px; display:flex; align-items:center; justify-content:center; color:#64748B; font-size:0.85rem;">
            Đang tải ảnh xem trước trang 1...
          </div>
        </div>
      </div>
    `;

    const session = state.renderSessionId;
    try {
      const rendered = await utils.renderPdfPageToBlob(state.pdfJsDoc, 1, {
        maxWidth: 460,
        mimeType: "image/jpeg",
        quality: 0.88,
      });
      if (session !== state.renderSessionId || state.activeToolId !== "watermark-numbers") return;

      const url = utils.trackObjectUrl(URL.createObjectURL(rendered.blob));
      state.wmPreviewUrl = url;
      state.wmPreviewPagePointWidth = rendered.pointWidth || 595;

      const box = document.getElementById("livePreviewBox");
      if (!box) return;
      box.innerHTML = `
        <img src="${url}" alt="Xem trước trang 1" id="livePreviewImg" />
        <div class="live-watermark-overlay" id="liveWmOverlay">
          <span class="live-watermark-text" id="liveWmText"></span>
        </div>
        <div class="live-pagenum-overlay" id="livePageNumOverlay"></div>
      `;

      const imgEl = document.getElementById("livePreviewImg");
      if (imgEl) {
        imgEl.addEventListener("load", updateWatermarkLiveOverlay);
      }
      updateWatermarkLiveOverlay();
    } catch (err) {
      utils.showToast("error", "Lỗi xem trước", err.message);
    }
  }

  function updateWatermarkLiveOverlay() {
    const wmOverlay = document.getElementById("liveWmOverlay");
    const wmTextEl = document.getElementById("liveWmText");
    const numEl = document.getElementById("livePageNumOverlay");
    const imgEl = document.getElementById("livePreviewImg");
    if (!wmOverlay || !wmTextEl || !numEl) return;

    if (state.wmEnableWatermark && state.wmText.trim()) {
      wmOverlay.classList.remove("hidden");
      wmTextEl.textContent = state.wmText;
      wmTextEl.style.color = state.wmColor;
      wmTextEl.style.opacity = String(state.wmOpacity);

      // Scale preview font relative to actual PDF point width
      const renderedW = (imgEl && imgEl.clientWidth) || 380;
      const ratio = renderedW / Math.max(200, state.wmPreviewPagePointWidth || 595);
      wmTextEl.style.fontSize = `${Math.max(10, state.wmFontSize * ratio)}px`;
    } else {
      wmOverlay.classList.add("hidden");
    }

    if (state.wmEnableNumbers) {
      numEl.classList.remove("hidden");
      numEl.textContent =
        state.wmNumberFormat === "page_of_total"
          ? `Trang 1 / ${state.totalPages}`
          : "1";
      numEl.className = `live-pagenum-overlay pos-${state.wmNumberPos}`;
    } else {
      numEl.classList.add("hidden");
    }
  }

  /* --------------------------------------------------------------------------
     Progressive Thumbnail Queue (In-place DOM update, non-blocking)
     -------------------------------------------------------------------------- */

  async function startProgressiveThumbQueue(pageNumbers, maxWidth, onEachRendered) {
    const utils = S();
    const session = state.renderSessionId;
    const toolId = state.activeToolId;
    const doc = state.pdfJsDoc;
    if (!doc) return;

    for (let i = 0; i < pageNumbers.length; i++) {
      if (session !== state.renderSessionId || state.activeToolId !== toolId) return;
      const pageNum = pageNumbers[i];

      try {
        const rendered = await utils.renderPdfPageToBlob(doc, pageNum, {
          maxWidth,
          mimeType: "image/jpeg",
          quality: 0.78,
        });
        if (session !== state.renderSessionId || state.activeToolId !== toolId) return;

        const url = utils.trackObjectUrl(URL.createObjectURL(rendered.blob));
        if (typeof onEachRendered === "function") {
          onEachRendered(pageNum, url);
        }

        const stages = dom.stageBody.querySelectorAll(`[data-thumb-stage="${pageNum}"]`);
        stages.forEach((stageEl) => {
          // Preserve rotation transform if tool 4 already rotated this item while loading
          let extraStyle = "";
          if (toolId === "organize-pdf") {
            const orgItem = state.organizePages.find((p) => p.pageNumber === pageNum);
            const rot = (orgItem && orgItem.rotationDelta) || 0;
            if (rot !== 0) {
              extraStyle = `transform: rotate(${rot}deg); ${rot === 90 || rot === 270 ? "max-width: 82%; max-height: 82%;" : ""}`;
            }
          }
          stageEl.innerHTML = `<img class="page-thumb-img" src="${url}" alt="Trang ${pageNum}" style="${extraStyle}" />`;
        });
      } catch (_err) {
        // Leave placeholder gracefully if a single thumbnail fails
      }

      if (i % 2 === 1) {
        await utils.yieldToUI();
      }
    }
  }

  /* --------------------------------------------------------------------------
     Right Sidebar: Dynamic Tool Settings Rendering
     -------------------------------------------------------------------------- */

  function renderSettingsPanel() {
    const toolId = state.activeToolId;
    const container = dom.toolSettingsContainer;
    if (!toolId || !container) return;

    if (toolId === "pdf-to-word") {
      container.innerHTML = `
        <div class="setting-group">
          <span class="setting-label">Chế độ chuyển đổi</span>
          <div class="mode-card-list">
            <label class="mode-option-card ${state.wordMode === "editable" ? "is-active" : ""}">
              <input type="radio" name="wordMode" value="editable" ${state.wordMode === "editable" ? "checked" : ""} />
              <div>
                <div class="mode-option-title">Văn bản chỉnh sửa được</div>
                <div class="mode-option-desc">Tự nhận diện tiêu đề, giữ ngắt đoạn &amp; ngắt trang để sửa chữ thoải mái trong Word.</div>
              </div>
            </label>
            <label class="mode-option-card ${state.wordMode === "exact" ? "is-active" : ""}">
              <input type="radio" name="wordMode" value="exact" ${state.wordMode === "exact" ? "checked" : ""} />
              <div>
                <div class="mode-option-title">Giữ nguyên bố cục &amp; Công thức</div>
                <div class="mode-option-desc">Kết xuất trang nét cao vào từng trang .docx — không bao giờ lệch bảng biểu, công thức hay file scan.</div>
              </div>
            </label>
          </div>
        </div>

        ${
          state.wordMode === "editable"
            ? `<label class="toggle-row">
                <span>Ngắt trang Word theo từng trang PDF</span>
                <input type="checkbox" id="wordPageBreakChk" ${state.wordPageBreak ? "checked" : ""} />
              </label>`
            : `<div class="setting-group">
                <span class="setting-label">Độ nét ảnh bố cục</span>
                <div class="segmented-control">
                  <button type="button" class="seg-btn ${state.wordExactScale === "1.8" ? "is-active" : ""}" data-word-scale="1.8">1.8x Tiêu chuẩn</button>
                  <button type="button" class="seg-btn ${state.wordExactScale === "2.4" ? "is-active" : ""}" data-word-scale="2.4">2.4x Siêu nét</button>
                </div>
              </div>`
        }

        <div class="setting-group">
          <span class="setting-label">Phạm vi trang chuyển đổi</span>
          <div class="segmented-control">
            <button type="button" class="seg-btn ${state.wordRangeMode === "all" ? "is-active" : ""}" data-word-range="all">Tất cả các trang</button>
            <button type="button" class="seg-btn ${state.wordRangeMode === "custom" ? "is-active" : ""}" data-word-range="custom">Khoảng trang</button>
          </div>
          ${
            state.wordRangeMode === "custom"
              ? `<input type="text" id="wordRangeInput" class="text-input" value="${S().escapeHtml(state.wordRangeText)}" placeholder="Ví dụ: 1-5 hoặc 1-3, 7" />
                 <span id="wordRangeHint" class="setting-hint">${state.totalPages > 0 ? `Tài liệu có ${state.totalPages} trang. ` : ""}Nhập dạng 1-5 hoặc 1-3, 8.</span>`
              : `<span class="setting-hint">${state.totalPages > 0 ? `Sẽ chuyển toàn bộ ${state.totalPages} trang.` : "Sẽ chuyển toàn bộ các trang sau khi tải PDF."}</span>`
          }
        </div>
      `;

      container.querySelectorAll('input[name="wordMode"]').forEach((r) => {
        r.addEventListener("change", () => {
          state.wordMode = r.value;
          renderSettingsPanel();
        });
      });

      const pbChk = document.getElementById("wordPageBreakChk");
      if (pbChk) {
        pbChk.addEventListener("change", () => {
          state.wordPageBreak = pbChk.checked;
        });
      }

      container.querySelectorAll("[data-word-scale]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.wordExactScale = btn.getAttribute("data-word-scale");
          renderSettingsPanel();
        });
      });

      container.querySelectorAll("[data-word-range]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.wordRangeMode = btn.getAttribute("data-word-range");
          renderSettingsPanel();
          updatePrimaryActionState();
        });
      });

      const rangeIn = document.getElementById("wordRangeInput");
      if (rangeIn) {
        const validateWordRangeHint = () => {
          const hint = document.getElementById("wordRangeHint");
          if (!hint) return;
          if (state.totalPages > 0) {
            const parsed = S().parsePageRange(state.wordRangeText, state.totalPages);
            if (parsed.error) {
              hint.textContent = parsed.error;
              hint.classList.add("is-error");
            } else if (parsed.pages.length === 0) {
              hint.textContent = `Tài liệu có ${state.totalPages} trang. Vui lòng nhập khoảng trang (vd: 1-5).`;
              hint.classList.add("is-error");
            } else {
              hint.textContent = `Sẽ chuyển ${parsed.pages.length} trang đã chọn (trên tổng ${state.totalPages} trang).`;
              hint.classList.remove("is-error");
            }
          }
        };
        validateWordRangeHint();
        rangeIn.addEventListener("input", () => {
          state.wordRangeText = rangeIn.value;
          validateWordRangeHint();
          updatePrimaryActionState();
        });
      }
      return;
    }

    if (toolId === "merge-pdf") {
      const totalPages = state.mergeFiles.reduce((a, f) => a + f.pageCount, 0);
      container.innerHTML = `
        <div class="info-stat-box">
          <div>Số tệp PDF đã nạp: <strong>${state.mergeFiles.length} tệp</strong></div>
          <div>Tổng số trang sau khi gộp: <strong>${totalPages} trang</strong></div>
        </div>
        <span class="setting-hint">
          Kéo-thả hoặc nhấn nút <strong>↑ / ↓</strong> ở danh sách bên trái để sắp xếp thứ tự các file trước khi gộp. Cần tối thiểu 2 file PDF.
        </span>
      `;
      return;
    }

    if (toolId === "split-pdf") {
      dom.outputExtBadge.textContent = state.splitExportMode === "zip_pages" ? ".zip" : ".pdf";
      container.innerHTML = `
        <div class="info-stat-box">
          <div>Trang đã chọn: <strong id="splitSelectedStat">${state.splitSelected.size} trang</strong> ${state.totalPages ? `/ ${state.totalPages}` : ""}</div>
        </div>

        <div class="setting-group">
          <label for="splitRangeInput" class="setting-label">Nhập nhanh số trang cần tách</label>
          <input
            type="text"
            id="splitRangeInput"
            class="text-input"
            value="${S().escapeHtml(state.splitRangeText)}"
            placeholder="Ví dụ: 1-3, 5, 8-12"
            ${state.totalPages === 0 ? "disabled" : ""}
          />
          <span id="splitRangeHint" class="setting-hint ${state.splitRangeError ? "is-error" : ""}">
            ${S().escapeHtml(state.splitRangeError || "Đồng bộ 2 chiều: gõ tại đây hoặc bấm trực tiếp vào ảnh trang bên trái.")}
          </span>
        </div>

        <div class="setting-group">
          <span class="setting-label">Hình thức xuất file</span>
          <div class="mode-card-list">
            <label class="mode-option-card ${state.splitExportMode === "single_pdf" ? "is-active" : ""}">
              <input type="radio" name="splitMode" value="single_pdf" ${state.splitExportMode === "single_pdf" ? "checked" : ""} />
              <div>
                <div class="mode-option-title">Xuất 1 file PDF chung</div>
                <div class="mode-option-desc">Gộp các trang đã chọn vào một tài liệu PDF duy nhất.</div>
              </div>
            </label>
            <label class="mode-option-card ${state.splitExportMode === "zip_pages" ? "is-active" : ""}">
              <input type="radio" name="splitMode" value="zip_pages" ${state.splitExportMode === "zip_pages" ? "checked" : ""} />
              <div>
                <div class="mode-option-title">Tách thành các file PDF lẻ (.ZIP)</div>
                <div class="mode-option-desc">Mỗi trang đã chọn trở thành 1 file PDF riêng và nén chung vào tệp .zip.</div>
              </div>
            </label>
          </div>
        </div>
      `;

      const splitInput = document.getElementById("splitRangeInput");
      if (splitInput) {
        splitInput.addEventListener("input", () => {
          state.splitRangeText = splitInput.value;
          const parsed = S().parsePageRange(splitInput.value, state.totalPages);
          const hint = document.getElementById("splitRangeHint");
          if (parsed.error) {
            state.splitRangeError = parsed.error;
            if (hint) {
              hint.textContent = parsed.error;
              hint.classList.add("is-error");
            }
          } else {
            state.splitRangeError = "";
            state.splitSelected = new Set(parsed.pages);
            if (hint) {
              hint.textContent = "Đồng bộ 2 chiều: gõ tại đây hoặc bấm trực tiếp vào ảnh trang bên trái.";
              hint.classList.remove("is-error");
            }
            syncSplitGridOnly();
          }
          updatePrimaryActionState();
        });
      }

      container.querySelectorAll('input[name="splitMode"]').forEach((r) => {
        r.addEventListener("change", () => {
          state.splitExportMode = r.value;
          renderSettingsPanel();
        });
      });
      return;
    }

    if (toolId === "organize-pdf") {
      const rotatedCount = state.organizePages.filter((p) => p.rotationDelta !== 0).length;
      const deletedCount = Math.max(0, state.totalPages - state.organizePages.length);
      container.innerHTML = `
        <div class="info-stat-box">
          <div>Tổng số trang giữ lại: <strong>${state.organizePages.length} trang</strong></div>
          <div>Số trang đã xoay: <strong>${rotatedCount} trang</strong></div>
          <div>Số trang đã xóa: <strong>${deletedCount} trang</strong></div>
        </div>
        <span class="setting-hint">
          Sử dụng các nút xoay 90° / xóa trực tiếp trên từng trang hoặc kéo-thả thẻ ở lưới bên trái để sắp xếp lại thứ tự.
        </span>
      `;
      return;
    }

    if (toolId === "images-to-pdf") {
      container.innerHTML = `
        <div class="setting-group">
          <span class="setting-label">Khổ giấy</span>
          <div class="segmented-control">
            <button type="button" class="seg-btn ${state.imgPaperSize === "a4" ? "is-active" : ""}" data-paper="a4">A4 chuẩn</button>
            <button type="button" class="seg-btn ${state.imgPaperSize === "fit" ? "is-active" : ""}" data-paper="fit">Vừa khít ảnh</button>
          </div>
        </div>

        ${
          state.imgPaperSize === "a4"
            ? `<div class="setting-group">
                <span class="setting-label">Hướng giấy</span>
                <div class="segmented-control">
                  <button type="button" class="seg-btn ${state.imgOrientation === "portrait" ? "is-active" : ""}" data-orient="portrait">Dọc (Portrait)</button>
                  <button type="button" class="seg-btn ${state.imgOrientation === "landscape" ? "is-active" : ""}" data-orient="landscape">Ngang (Landscape)</button>
                </div>
              </div>`
            : `<span class="setting-hint">Mỗi trang PDF sẽ tự co giãn khớp đúng tỷ lệ và kích thước từng ảnh.</span>`
        }

        <div class="setting-group">
          <span class="setting-label">Lề trang</span>
          <div class="segmented-control cols-3">
            <button type="button" class="seg-btn ${state.imgMargin === "none" ? "is-active" : ""}" data-margin="none">Không lề</button>
            <button type="button" class="seg-btn ${state.imgMargin === "small" ? "is-active" : ""}" data-margin="small">Lề nhỏ</button>
            <button type="button" class="seg-btn ${state.imgMargin === "medium" ? "is-active" : ""}" data-margin="medium">Lề vừa</button>
          </div>
        </div>
      `;

      container.querySelectorAll("[data-paper]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.imgPaperSize = btn.getAttribute("data-paper");
          renderSettingsPanel();
        });
      });
      container.querySelectorAll("[data-orient]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.imgOrientation = btn.getAttribute("data-orient");
          renderSettingsPanel();
        });
      });
      container.querySelectorAll("[data-margin]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.imgMargin = btn.getAttribute("data-margin");
          renderSettingsPanel();
        });
      });
      return;
    }

    if (toolId === "pdf-to-images") {
      container.innerHTML = `
        <div class="setting-group">
          <span class="setting-label">Định dạng ảnh xuất ra</span>
          <div class="segmented-control">
            <button type="button" class="seg-btn ${state.imgOutFormat === "png" ? "is-active" : ""}" data-img-fmt="png">PNG (Nét cao)</button>
            <button type="button" class="seg-btn ${state.imgOutFormat === "jpg" ? "is-active" : ""}" data-img-fmt="jpg">JPG (Nhẹ file)</button>
          </div>
        </div>

        <div class="setting-group">
          <span class="setting-label">Độ phân giải kết xuất</span>
          <div class="segmented-control">
            <button type="button" class="seg-btn ${state.imgOutScale === "1.5" ? "is-active" : ""}" data-img-scale="1.5">1.5x Tiêu chuẩn</button>
            <button type="button" class="seg-btn ${state.imgOutScale === "2.5" ? "is-active" : ""}" data-img-scale="2.5">2.5x Siêu nét</button>
          </div>
        </div>

        <span class="setting-hint">
          Bạn có thể tải lẻ từng trang ngay dưới ảnh xem trước hoặc bấm nút bên dưới để đóng gói toàn bộ thành tệp .ZIP.
        </span>
      `;

      container.querySelectorAll("[data-img-fmt]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.imgOutFormat = btn.getAttribute("data-img-fmt");
          renderSettingsPanel();
          // Update single download labels cleanly without re-rendering thumbnails
          document.querySelectorAll("[data-dl-img-page]").forEach((dlBtn) => {
            dlBtn.textContent = `Tải ảnh .${state.imgOutFormat.toUpperCase()}`;
          });
        });
      });

      container.querySelectorAll("[data-img-scale]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.imgOutScale = btn.getAttribute("data-img-scale");
          renderSettingsPanel();
        });
      });
      return;
    }

    if (toolId === "watermark-numbers") {
      const swatches = ["#64748B", "#DC2626", "#2563EB", "#059669", "#0F172A"];
      container.innerHTML = `
        <label class="toggle-row">
          <span>Đánh số trang tự động</span>
          <input type="checkbox" id="wmEnableNumbersChk" ${state.wmEnableNumbers ? "checked" : ""} />
        </label>

        ${
          state.wmEnableNumbers
            ? `<div class="sub-settings-box">
                <div class="setting-group">
                  <span class="setting-label">Kiểu đánh số</span>
                  <div class="segmented-control">
                    <button type="button" class="seg-btn ${state.wmNumberFormat === "number_only" ? "is-active" : ""}" data-num-fmt="number_only">1, 2, 3...</button>
                    <button type="button" class="seg-btn ${state.wmNumberFormat === "page_of_total" ? "is-active" : ""}" data-num-fmt="page_of_total">Trang 1 / 10</button>
                  </div>
                </div>
                <div class="setting-group">
                  <span class="setting-label">Vị trí hiển thị</span>
                  <div class="segmented-control cols-3">
                    <button type="button" class="seg-btn ${state.wmNumberPos === "bottom-center" ? "is-active" : ""}" data-num-pos="bottom-center">Giữa dưới</button>
                    <button type="button" class="seg-btn ${state.wmNumberPos === "bottom-right" ? "is-active" : ""}" data-num-pos="bottom-right">Phải dưới</button>
                    <button type="button" class="seg-btn ${state.wmNumberPos === "top-right" ? "is-active" : ""}" data-num-pos="top-right">Phải trên</button>
                  </div>
                </div>
              </div>`
            : ""
        }

        <label class="toggle-row">
          <span>Đóng dấu chữ mờ (Watermark)</span>
          <input type="checkbox" id="wmEnableWatermarkChk" ${state.wmEnableWatermark ? "checked" : ""} />
        </label>

        ${
          state.wmEnableWatermark
            ? `<div class="sub-settings-box">
                <div class="setting-group">
                  <label for="wmTextInput" class="setting-label">Nội dung chữ bản quyền</label>
                  <input type="text" id="wmTextInput" class="text-input" value="${S().escapeHtml(state.wmText)}" placeholder="Ví dụ: Tài liệu lưu hành nội bộ" />
                </div>

                <div class="setting-group">
                  <label for="wmSizeRange" class="setting-label">
                    <span>Cỡ chữ</span>
                    <span class="setting-value-pill" id="wmSizeVal">${state.wmFontSize} pt</span>
                  </label>
                  <input type="range" id="wmSizeRange" class="range-slider" min="18" max="90" step="2" value="${state.wmFontSize}" />
                </div>

                <div class="setting-group">
                  <label for="wmOpacityRange" class="setting-label">
                    <span>Độ mờ (Opacity)</span>
                    <span class="setting-value-pill" id="wmOpacityVal">${Math.round(state.wmOpacity * 100)}%</span>
                  </label>
                  <input type="range" id="wmOpacityRange" class="range-slider" min="0.08" max="0.75" step="0.01" value="${state.wmOpacity}" />
                </div>

                <div class="setting-group">
                  <span class="setting-label">Màu chữ</span>
                  <div class="color-swatches">
                    ${swatches
                      .map(
                        (hex) => `
                      <button
                        type="button"
                        class="color-swatch ${state.wmColor.toUpperCase() === hex ? "is-active" : ""}"
                        style="background: ${hex};"
                        data-wm-color="${hex}"
                        title="${hex}"
                      ></button>
                    `
                      )
                      .join("")}
                    <input type="color" id="wmColorPicker" class="color-picker-native" value="${state.wmColor}" title="Chọn màu tùy ý" />
                  </div>
                </div>
              </div>`
            : ""
        }
      `;

      const numChk = document.getElementById("wmEnableNumbersChk");
      numChk.addEventListener("change", () => {
        state.wmEnableNumbers = numChk.checked;
        renderSettingsPanel();
        updateWatermarkLiveOverlay();
        updatePrimaryActionState();
      });

      const wmChk = document.getElementById("wmEnableWatermarkChk");
      wmChk.addEventListener("change", () => {
        state.wmEnableWatermark = wmChk.checked;
        renderSettingsPanel();
        updateWatermarkLiveOverlay();
        updatePrimaryActionState();
      });

      container.querySelectorAll("[data-num-fmt]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.wmNumberFormat = btn.getAttribute("data-num-fmt");
          renderSettingsPanel();
          updateWatermarkLiveOverlay();
        });
      });

      container.querySelectorAll("[data-num-pos]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.wmNumberPos = btn.getAttribute("data-num-pos");
          renderSettingsPanel();
          updateWatermarkLiveOverlay();
        });
      });

      const wmTextInput = document.getElementById("wmTextInput");
      if (wmTextInput) {
        wmTextInput.addEventListener("input", () => {
          state.wmText = wmTextInput.value;
          updateWatermarkLiveOverlay();
          updatePrimaryActionState();
        });
      }

      const wmSizeRange = document.getElementById("wmSizeRange");
      if (wmSizeRange) {
        wmSizeRange.addEventListener("input", () => {
          state.wmFontSize = Number(wmSizeRange.value);
          const pill = document.getElementById("wmSizeVal");
          if (pill) pill.textContent = `${state.wmFontSize} pt`;
          updateWatermarkLiveOverlay();
        });
      }

      const wmOpacityRange = document.getElementById("wmOpacityRange");
      if (wmOpacityRange) {
        wmOpacityRange.addEventListener("input", () => {
          state.wmOpacity = Number(wmOpacityRange.value);
          const pill = document.getElementById("wmOpacityVal");
          if (pill) pill.textContent = `${Math.round(state.wmOpacity * 100)}%`;
          updateWatermarkLiveOverlay();
        });
      }

      container.querySelectorAll("[data-wm-color]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.wmColor = btn.getAttribute("data-wm-color");
          renderSettingsPanel();
          updateWatermarkLiveOverlay();
        });
      });

      const colorPicker = document.getElementById("wmColorPicker");
      if (colorPicker) {
        colorPicker.addEventListener("input", () => {
          state.wmColor = colorPicker.value;
          updateWatermarkLiveOverlay();
        });
      }
    }
  }

  /* --------------------------------------------------------------------------
     Output Filename & Primary Action Execution
     -------------------------------------------------------------------------- */

  function updateOutputFilenameDefault() {
    const utils = S();
    const tool = getToolById(state.activeToolId);
    if (!tool) return;

    let defaultBase = "ket_qua";
    if (state.fileName) {
      const base = utils.stripExtension(state.fileName);
      if (tool.id === "pdf-to-word") defaultBase = `${base}_word`;
      else if (tool.id === "split-pdf") defaultBase = `${base}_tach_trang`;
      else if (tool.id === "organize-pdf") defaultBase = `${base}_da_sap_xep`;
      else if (tool.id === "pdf-to-images") defaultBase = `${base}_hinh_anh`;
      else if (tool.id === "watermark-numbers") defaultBase = `${base}_dong_dau`;
    } else if (tool.id === "merge-pdf") {
      defaultBase = state.mergeFiles.length > 0
        ? `${utils.stripExtension(state.mergeFiles[0].name)}_gop`
        : "tai_lieu_gop";
    } else if (tool.id === "images-to-pdf") {
      defaultBase = state.imageItems.length > 0
        ? `${utils.stripExtension(state.imageItems[0].name)}_pdf`
        : "anh_sang_pdf";
    }

    dom.outputFilenameInput.value = defaultBase;
    dom.outputExtBadge.textContent =
      tool.id === "split-pdf" && state.splitExportMode === "zip_pages"
        ? ".zip"
        : tool.defaultExt;
  }

  function updatePrimaryActionState() {
    const tool = getToolById(state.activeToolId);
    if (!tool) return;

    dom.primaryActionLabel.textContent = tool.actionLabel;
    dom.primaryActionSpinner.classList.toggle("hidden", !state.isProcessing);

    if (state.isProcessing) {
      dom.primaryActionBtn.disabled = true;
      return;
    }

    let ready = false;
    switch (tool.id) {
      case "merge-pdf":
        ready = state.mergeFiles.length >= 2;
        break;
      case "images-to-pdf":
        ready = state.imageItems.length >= 1;
        break;
      case "split-pdf":
        ready = Boolean(state.pdfJsDoc && state.splitSelected.size > 0 && !state.splitRangeError);
        break;
      case "organize-pdf":
        ready = Boolean(state.pdfJsDoc && state.organizePages.length > 0);
        break;
      case "watermark-numbers":
        ready = Boolean(
          state.pdfJsDoc &&
            (state.wmEnableNumbers || (state.wmEnableWatermark && state.wmText.trim()))
        );
        break;
      case "pdf-to-word":
        if (state.pdfJsDoc && state.totalPages > 0) {
          if (state.wordRangeMode === "all") {
            ready = true;
          } else {
            const parsed = S().parsePageRange(state.wordRangeText, state.totalPages);
            ready = !parsed.error && parsed.pages.length > 0;
          }
        }
        break;
      default:
        ready = Boolean(state.pdfJsDoc && state.totalPages > 0);
    }

    dom.primaryActionBtn.disabled = !ready;
  }

  async function executePrimaryAction() {
    const utils = S();
    if (state.isProcessing || !state.activeToolId) return;

    const missingLibs = utils.checkRequiredLibraries();
    if (missingLibs.length > 0) {
      utils.showToast(
        "error",
        "Thiếu thư viện xử lý",
        `Chưa tải được: ${missingLibs.join(", ")}. Vui lòng kiểm tra kết nối mạng.`
      );
      return;
    }

    state.isProcessing = true;
    dom.resultSummaryCard.classList.add("hidden");
    updatePrimaryActionState();

    const outputName = dom.outputFilenameInput.value.trim() || "pdf_studio_output";

    try {
      let result = null;

      if (state.activeToolId === "pdf-to-word") {
        result = await Conv().runPdfToWord(state, {
          mode: state.wordMode,
          pageRangeMode: state.wordRangeMode,
          pageRangeText: state.wordRangeText,
          pageBreakPerPage: state.wordPageBreak,
          exactScale: state.wordExactScale,
          outputName,
        });

        if (result.emptyTextPagesCount > 0 && result.mode === "editable") {
          utils.showToast(
            "warning",
            "Phát hiện trang scan / ảnh",
            `${result.emptyTextPagesCount} trang không có chữ chọn được. Hãy thử chế độ "Giữ nguyên bố cục & Công thức" nếu cần.`,
            6500
          );
        }
      } else if (state.activeToolId === "merge-pdf") {
        result = await PdfT().runMergePdf(state.mergeFiles, outputName);
      } else if (state.activeToolId === "split-pdf") {
        result = await PdfT().runSplitPdf(state, {
          selectedPages: Array.from(state.splitSelected),
          exportMode: state.splitExportMode,
          outputName,
        });
      } else if (state.activeToolId === "organize-pdf") {
        result = await PdfT().runOrganizePdf(state, state.organizePages, outputName);
      } else if (state.activeToolId === "images-to-pdf") {
        result = await Conv().runImagesToPdf(state.imageItems, {
          paperSize: state.imgPaperSize,
          orientation: state.imgOrientation,
          marginMode: state.imgMargin,
          outputName,
        });
      } else if (state.activeToolId === "pdf-to-images") {
        result = await Conv().runPdfToAllImagesZip(state, {
          format: state.imgOutFormat,
          scale: state.imgOutScale,
          outputName,
        });
      } else if (state.activeToolId === "watermark-numbers") {
        result = await PdfT().runWatermarkAndNumbers(state, {
          enableNumbers: state.wmEnableNumbers,
          numberFormat: state.wmNumberFormat,
          numberPosition: state.wmNumberPos,
          enableWatermark: state.wmEnableWatermark,
          watermarkText: state.wmText,
          watermarkSize: state.wmFontSize,
          watermarkColor: state.wmColor,
          watermarkOpacity: state.wmOpacity,
          outputName,
        });
      }

      if (result) {
        dom.resultSummaryCard.classList.remove("hidden");
        dom.resultSummaryCard.innerHTML = `
          <strong>✓ Xuất file thành công!</strong>
          <span>Tệp: <b>${utils.escapeHtml(result.filename)}</b></span>
          <span>Dung lượng: ${utils.formatBytes(result.size)}${result.pageCount ? ` • ${result.pageCount} trang` : ""}</span>
        `;
        utils.showToast("success", "Xử lý hoàn tất", `Đã tải xuống tệp "${result.filename}".`);
      }
    } catch (err) {
      utils.setProgress(0, "Xử lý gặp lỗi", false);
      utils.showToast("error", "Không thể hoàn tất thao tác", err.message || String(err), 6500);
    } finally {
      state.isProcessing = false;
      updatePrimaryActionState();
    }
  }

  /* --------------------------------------------------------------------------
     Global Event Listeners & App Boot
     -------------------------------------------------------------------------- */

  function bindEvents() {
    dom.brandHomeBtn.addEventListener("click", showDashboard);
    dom.navHomeBtn.addEventListener("click", showDashboard);
    dom.backToHomeBtn.addEventListener("click", showDashboard);

    dom.dropzone.addEventListener("click", () => {
      if (!state.isProcessing) dom.fileInput.click();
    });
    dom.dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!state.isProcessing) dom.fileInput.click();
      }
    });

    dom.fileInput.addEventListener("change", (e) => {
      const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
      dom.fileInput.value = "";
      handleIncomingFiles(selectedFiles);
    });

    // Drag & Drop onto Dropzone (prevent browser from navigating to dropped PDF)
    ["dragenter", "dragover"].forEach((evt) => {
      dom.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dom.dropzone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      dom.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dom.dropzone.classList.remove("is-dragover");
      });
    });

    dom.dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files) {
        handleIncomingFiles(e.dataTransfer.files);
      }
    });

    // Prevent accidental tab navigation when dropping outside dropzone in workspace
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());

    dom.primaryActionBtn.addEventListener("click", executePrimaryAction);

    // Clean up memory if user closes or refreshes tab
    window.addEventListener("beforeunload", () => {
      S().revokeAllTrackedUrls();
    });
  }

  function init() {
    cacheDom();
    S().configurePdfWorkerSync();

    const missing = S().checkRequiredLibraries();
    if (missing.length > 0) {
      dom.cdnWarningBanner.classList.remove("hidden");
      dom.cdnWarningDetail.textContent = `Thiếu thư viện: ${missing.join(", ")}. Hãy kiểm tra kết nối Internet và tải lại trang.`;
    } else {
      // Warm up worker in background without blocking first paint
      S().ensurePdfWorkerReady();
    }

    renderDashboard();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);

