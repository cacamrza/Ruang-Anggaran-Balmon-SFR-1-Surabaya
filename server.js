const path = require("node:path");
const express = require("express");
const multer = require("multer");
const ExcelJS = require("exceljs");
const SpreadsheetParser = require("@e965/xlsx");
const { parse: parseCsv } = require("csv-parse/sync");
const cheerio = require("cheerio");
const { PDFParse } = require("pdf-parse");
const WordExtractor = require("word-extractor");
const yauzl = require("yauzl");

const app = express();
const port = Number(process.env.PORT) || 4173;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/image", express.static(path.join(__dirname, "image")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "docx", "dist")));
app.use("/vendor/face-api", express.static(path.join(__dirname, "node_modules", "@vladmandic", "face-api", "dist")));
app.use("/vendor/tesseract", express.static(path.join(__dirname, "node_modules", "tesseract.js", "dist")));
app.use("/vendor/tesseract-core", express.static(path.join(__dirname, "node_modules", "tesseract.js-core")));
app.use("/models/face-api", express.static(path.join(__dirname, "node_modules", "@vladmandic", "face-api", "model")));
app.use("/models/tesseract", express.static(path.join(__dirname, "public", "models", "tesseract")));

class UploadParseError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (value.error) return value.error;
  if (Object.hasOwn(value, "result")) return normalizeCellValue(value.result);
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  if (typeof value.text === "string") return value.text;
  if (typeof value.hyperlink === "string") return value.hyperlink;
  return null;
}

function trimRows(rows) {
  while (rows.length && rows[rows.length - 1].every((value) => value === null || value === "")) {
    rows.pop();
  }
  return rows;
}

function getExcelJsRows(worksheet) {
  const rows = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = [];
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      values.push(normalizeCellValue(row.getCell(columnNumber).value));
    }
    rows.push(values);
  }
  return trimRows(rows);
}

function textToRows(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim());
  return lines.map((line) => {
    const delimiter = line.includes("\t") ? "\t" : / {2,}/;
    return line.trim().split(delimiter).map((value) => value.trim() || null);
  });
}

function parseCsvRows(text) {
  const delimiters = [",", ";", "\t", "|"];
  let bestRows = null;
  let bestScore = -1;
  for (const delimiter of delimiters) {
    let rows;
    try {
      rows = parseCsv(text, {
        bom: true,
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      if (delimiter === delimiters[delimiters.length - 1]) throw error;
      continue;
    }
    const widths = rows.slice(0, 30).map((row) => row.filter((value) => value !== "").length);
    const widestRow = Math.max(0, ...widths);
    const multiColumnRows = widths.filter((width) => width > 1).length;
    const consistentRows = widths.filter((width) => width === widestRow).length;
    const score = widestRow > 1 ? multiColumnRows * 100 + consistentRows * 10 + widestRow : 0;
    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }
  return trimRows((bestRows ?? []).map((row) => row.map((value) => value === "" ? null : value)));
}

function readDocxXml(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        zipFile.close();
        reject(error);
      };
      zipFile.on("error", fail);
      zipFile.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") {
          zipFile.readEntry();
          return;
        }
        if (entry.uncompressedSize > 20 * 1024 * 1024) {
          fail(new UploadParseError("Isi dokumen Word terlalu besar untuk diproses."));
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }
          const chunks = [];
          let size = 0;
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > 20 * 1024 * 1024) {
              stream.destroy(new UploadParseError("Isi dokumen Word terlalu besar untuk diproses."));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            if (settled) return;
            settled = true;
            zipFile.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
      });
      zipFile.on("end", () => fail(new UploadParseError("Dokumen Word tidak memiliki isi yang dapat dibaca.")));
      zipFile.readEntry();
    });
  });
}

function parseDocxRows(xml) {
  const $ = cheerio.load(xml.replace(/(<\/?)w:/g, "$1"), { xmlMode: true });
  const rows = [];
  $("tbl").each((_, table) => {
    $(table).children("tr").each((__, row) => {
      const cells = $(row).children("tc").map((___, cell) =>
        $(cell).find("p").map((____, paragraph) => $(paragraph).text()).get().join(" ").replace(/\s+/g, " ").trim() || null,
      ).get();
      if (cells.some((cell) => cell !== null)) rows.push(cells);
    });
    if (rows.length) rows.push([]);
  });
  if (!rows.length) rows.push(...textToRows($("body").text()));
  return trimRows(rows);
}

function parseSp2dReportRows(rows) {
  const reportText = rows.flat().map((value) => String(value ?? "")).join(" ");
  const isSp2dReport = /\bLAPORAN REALISASI SP2D\b/i.test(reportText)
    && rows.some((row) => row.some((value) => /^Lock Pagu$/i.test(String(value ?? "").trim())))
    && rows.some((row) => row.some((value) => /^Uraian$/i.test(String(value ?? "").trim())));
  if (!isSp2dReport) return null;

  const normalizedRows = [["Kode Anggaran", "Uraian", "Pagu", "Sisa Anggaran"]];
  for (const row of rows) {
    const code = String(row[0] ?? "").trim();
    const description = String(row[2] ?? "").trim();
    const amount = Number(String(row[8] ?? "").replaceAll(",", ""));
    const remaining = Number(String(row[6] ?? "").replaceAll(",", ""));
    if (!/^(?:\d{3}|\d{6})$/.test(code) || !description) continue;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(remaining) || remaining < 0) continue;
    normalizedRows.push([code, description, amount, remaining]);
  }
  if (normalizedRows.length === 1) {
    throw new UploadParseError("Kolom pagu dan sisa pada laporan SP2D tidak dapat dipastikan.");
  }
  return normalizedRows;
}

async function parseUpload(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const buffer = file.buffer;
  if ([".xlsx", ".xlsm"].includes(extension)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook.worksheets.map((worksheet) => ({
      name: worksheet.name,
      rows: getExcelJsRows(worksheet),
    }));
  }
  if (extension === ".xls") {
    const workbook = SpreadsheetParser.read(buffer, { type: "buffer", cellDates: true });
    return workbook.SheetNames.map((name) => ({
      name,
      rows: trimRows(SpreadsheetParser.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        defval: null,
        blankrows: true,
        raw: true,
      })),
    }));
  }
  if (extension === ".csv") {
    const text = new TextDecoder("utf-8").decode(buffer);
    return [{ name: "Data RAB", rows: parseCsvRows(text) }];
  }
  if (extension === ".docx") {
    return [{ name: "Data RAB", rows: parseDocxRows(await readDocxXml(buffer)) }];
  }
  if (extension === ".doc") {
    const extracted = await new WordExtractor().extract(buffer);
    return [{ name: "Data RAB", rows: trimRows(textToRows(extracted.getBody())) }];
  }
  if (extension === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    let text;
    try {
      const parsed = await parser.getText({ cellSeparator: "\t", itemJoiner: "\t", pageJoiner: "\n" });
      text = parsed.text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "").trim();
    } finally {
      await parser.destroy();
    }
    if (!text) {
      throw new UploadParseError("PDF tidak memiliki teks yang dapat dibaca. Jika PDF berupa hasil pindai, ubah dulu dengan OCR atau unggah Excel/CSV.");
    }
    const rows = trimRows(textToRows(text));
    const sp2dRows = parseSp2dReportRows(rows);
    if (sp2dRows) {
      return [{ name: "Realisasi SP2D", rows: sp2dRows }];
    }
    const hasBudgetTableHeader = rows.some((row) => {
      const labels = row.filter((value) => value !== null).map((value) => String(value).toLowerCase());
      const descriptionColumn = labels.findIndex((label) => /uraian|deskripsi|kegiatan|belanja/.test(label));
      return descriptionColumn >= 0
        && labels.some((label, index) =>
          index !== descriptionColumn && /pagu|jumlah|anggaran|nilai|sisa/.test(label),
        );
    });
    if (!hasBudgetTableHeader) {
      throw new UploadParseError("Struktur tabel RAB pada PDF tidak dapat dipastikan. Simpan ulang sebagai PDF dengan teks/kolom terpisah atau unggah Excel/CSV.");
    }
    return [{ name: "Data RAB", rows }];
  }
  throw new UploadParseError("Format tidak didukung. Gunakan Excel (.xlsx/.xls/.xlsm), CSV, Word (.docx/.doc), atau PDF.", 415);
}

app.post("/api/parse", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) {
      return response.status(400).json({ error: "Pilih file RAB terlebih dahulu." });
    }
    const sheets = await parseUpload(request.file);
    if (!sheets.some((sheet) => sheet.rows.some((row) => row.some((value) => value !== null && value !== "")))) {
      throw new UploadParseError("Tidak ada isi tabel yang dapat dibaca dari file ini.");
    }
    response.json({
      fileName: request.file.originalname,
      sheets,
    });
  } catch (error) {
    if (error instanceof UploadParseError) {
      return response.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Ukuran file melebihi batas 20 MB."
      : error.message;
    return response.status(400).json({ error: message });
  }
  console.error(error);
  response.status(500).json({
    error: "File tidak dapat dibaca. Pastikan formatnya didukung dan file tidak rusak atau terkunci.",
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Dashboard siap di http://127.0.0.1:${port}`);
});
