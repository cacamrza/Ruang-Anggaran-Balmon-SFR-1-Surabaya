const state = {
  workbook: null,
  selectedSheet: null,
  currentAnalysis: null,
  generatedSections: null,
  torSourceRowNumber: null,
  torAmountOverride: null,
  torRemainingOverride: null,
};

const byId = (id) => document.getElementById(id);
const rupiah = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const demoAccountKey = "rab-tor-demo-accounts";
const demoSessionKey = "rab-tor-demo-session";
let verificationCamera = null;
let capturedSelfie = null;
let faceModelsReady = false;
let ocrWorker = null;
let pendingRegistration = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function setAuthMessage(id, message, isError = true) {
  const element = byId(id);
  element.textContent = message;
  element.classList.toggle("hidden", !message);
  element.classList.toggle("success", !isError);
}

function readDemoAccounts() {
  const stored = localStorage.getItem(demoAccountKey);
  if (!stored) return [];
  const accounts = JSON.parse(stored);
  if (!Array.isArray(accounts)) throw new Error("Data akun demo di browser tidak dapat dibaca.");
  return accounts;
}

function showAuthPanel(panel) {
  stopVerificationCamera();
  pendingRegistration = null;
  const capture = byId("verification-capture");
  capture.width = 0;
  capture.height = 0;
  capture.classList.add("hidden");
  byId("employee-card-photo").value = "";
  byId("capture-photo").textContent = "Ambil selfie + kartu";
  capturedSelfie = null;
  byId("register-panel").classList.toggle("hidden", panel !== "register");
  byId("login-panel").classList.toggle("hidden", panel !== "login");
  setRegistrationStep("credentials");
  setAuthMessage("register-message", "");
  setAuthMessage("login-message", "");
}

function setRegistrationStep(step) {
  const isVerification = step === "verification";
  byId("credentials-step").classList.toggle("hidden", isVerification);
  byId("verification-step").classList.toggle("hidden", !isVerification);
  byId("verification-actions").classList.toggle("hidden", !isVerification);
  byId("employee-number").disabled = !isVerification;
  byId("employee-card-photo").disabled = !isVerification;
  byId("register-panel").querySelector(".auth-heading h1").textContent = isVerification ? "Verify Employee Card" : "Sign Up";
  byId("register-panel").querySelector(".auth-heading p").textContent = isVerification
    ? "Cocokkan foto kartu dan selfie kamera untuk melanjutkan."
    : "Daftar untuk melanjutkan ke dashboard";
}

function stopVerificationCamera() {
  verificationCamera?.getTracks().forEach((track) => track.stop());
  verificationCamera = null;
  const video = byId("verification-camera");
  if (video) video.srcObject = null;
  const status = byId("camera-status");
  if (status) status.textContent = "Kamera belum dinyalakan";
  const captureButton = byId("capture-photo");
  if (captureButton) captureButton.disabled = true;
}

function openDashboard(email) {
  stopVerificationCamera();
  byId("register-form").reset();
  const capture = byId("verification-capture");
  capture.width = 0;
  capture.height = 0;
  capture.classList.add("hidden");
  capturedSelfie = null;
  sessionStorage.setItem(demoSessionKey, email);
  byId("auth-screen").classList.add("hidden");
  byId("app-shell").classList.remove("hidden");
}

async function hashPassword(password, saltHex) {
  if (!window.crypto?.subtle) throw new Error("Fitur keamanan browser tidak tersedia. Buka prototipe melalui HTTPS atau localhost.");
  const encoder = new TextEncoder();
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16))
    : window.crypto.getRandomValues(new Uint8Array(16));
  const key = await window.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await window.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    key,
    256,
  );
  const saltValue = saltHex ?? [...salt].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = [...new Uint8Array(derived)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { salt: saltValue, digest };
}

async function loadVerificationModels() {
  if (faceModelsReady) return;
  const faceapi = window.faceapi;
  if (!faceapi) throw new Error("Model pemeriksaan wajah belum tersedia.");
  const modelUrl = "/models/face-api";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
  ]);
  faceModelsReady = true;
}

async function loadOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) throw new Error("Model OCR belum tersedia.");
  ocrWorker = await window.Tesseract.createWorker("eng", 1, {
    workerPath: "/vendor/tesseract/worker.min.js",
    corePath: "/vendor/tesseract-core",
    langPath: "/models/tesseract",
    workerBlobURL: false,
    gzip: true,
    logger: (message) => {
      if (message.status === "loading tesseract core") byId("camera-status").textContent = "Menyiapkan pemeriksaan lokal...";
    },
  });
  await ocrWorker.setParameters({
    tessedit_char_whitelist: "0123456789",
    preserve_interword_spaces: "1",
  });
  return ocrWorker;
}

function enlargeVerificationImage(image) {
  const width = image.videoWidth || image.naturalWidth || image.width;
  const height = image.videoHeight || image.naturalHeight || image.height;
  const scale = Math.min(2.5, 1800 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function faceDescriptor(image, label) {
  const faceapi = window.faceapi;
  const enlarged = enlargeVerificationImage(image);
  const detection = await faceapi
    .detectSingleFace(enlarged, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!detection) throw new Error(`Wajah pada ${label} belum terbaca. Dekatkan foto kartu atau selfie dan pastikan wajah tidak tertutup.`);
  return detection.descriptor;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Foto kartu tidak dapat dibuka."));
    };
    image.src = url;
  });
}

function readOcrDigits(result) {
  return String(result?.data?.text ?? "").replace(/\D/g, "");
}

function verificationImageSize(image) {
  return {
    width: image.videoWidth || image.naturalWidth || image.width,
    height: image.videoHeight || image.naturalHeight || image.height,
  };
}

function prepareOcrCanvas(image, crop = null, binary = false) {
  const { width, height } = verificationImageSize(image);
  const sourceX = crop ? Math.round(crop.x * width) : 0;
  const sourceY = crop ? Math.round(crop.y * height) : 0;
  const sourceWidth = crop ? Math.round(crop.width * width) : width;
  const sourceHeight = crop ? Math.round(crop.height * height) : height;
  const scale = Math.min(3, 2000 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = Math.round(
      pixels.data[index] * 0.299
      + pixels.data[index + 1] * 0.587
      + pixels.data[index + 2] * 0.114,
    );
    pixels.data[index] = gray;
    pixels.data[index + 1] = gray;
    pixels.data[index + 2] = gray;
    histogram[gray] += 1;
  }

  const pixelCount = canvas.width * canvas.height;
  let low = 0;
  let high = 255;
  let cumulative = 0;
  while (low < 255 && cumulative < pixelCount * 0.02) cumulative += histogram[low++];
  cumulative = 0;
  while (high > 0 && cumulative < pixelCount * 0.02) cumulative += histogram[high--];
  const contrastRange = Math.max(1, high - low);
  const normalizedHistogram = new Uint32Array(256);
  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) {
    const normalized = Math.max(0, Math.min(255, Math.round(((value - low) / contrastRange) * 255)));
    normalizedHistogram[normalized] += histogram[value];
    totalSum += normalized * histogram[value];
  }

  let backgroundSum = 0;
  let backgroundWeight = 0;
  let threshold = 128;
  let maxVariance = 0;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += normalizedHistogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * normalizedHistogram[value];
    const meanDifference = backgroundSum / backgroundWeight - (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * meanDifference * meanDifference;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = value;
    }
  }

  for (let index = 0; index < pixels.data.length; index += 4) {
    const normalized = Math.max(0, Math.min(255, Math.round(((pixels.data[index] - low) / contrastRange) * 255)));
    const value = binary ? (normalized > threshold ? 255 : 0) : normalized;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

async function readEmployeeNumber(image, worker, expectedNumber, imageLabel) {
  const candidates = [
    { crop: null, binary: false, pageMode: "11" },
    { crop: null, binary: true, pageMode: "6" },
  ];
  for (const y of [0, 0.2, 0.4]) {
    for (const x of [0, 0.2, 0.4]) {
      const crop = { x, y, width: 0.6, height: 0.6 };
      candidates.push(
        { crop, binary: false, pageMode: "11" },
        { crop, binary: true, pageMode: "11" },
      );
    }
  }

  for (const [index, { crop, binary, pageMode }] of candidates.entries()) {
    byId("camera-status").textContent = `Memperjelas dan membaca nomor pada ${imageLabel} (${index + 1}/${candidates.length})...`;
    const canvas = prepareOcrCanvas(image, crop, binary);
    await worker.setParameters({
      tessedit_pageseg_mode: pageMode,
      tessedit_char_whitelist: "0123456789",
      preserve_interword_spaces: "1",
    });
    const result = await worker.recognize(canvas);
    if (readOcrDigits(result).includes(expectedNumber)) return true;
  }
  return false;
}

function verifyEmployeeIdentity(email, password, employeeNumber, cardFile) {
  return Promise.all([loadVerificationModels(), loadOcrWorker()])
    .then(async ([, worker]) => {
      byId("camera-status").textContent = "Memeriksa wajah pada kedua foto...";
      const { image: cardImage, url } = await readImageFile(cardFile);
      try {
        const [cardFace, selfieFace] = await Promise.all([
          faceDescriptor(cardImage, "foto kartu"),
          faceDescriptor(byId("verification-capture"), "selfie bersama kartu"),
        ]);
        const faceDistance = window.faceapi.euclideanDistance(cardFace, selfieFace);
        const faceMatches = faceDistance <= 0.6;
        if (!faceMatches) {
          throw new Error(`Wajah belum cocok (jarak kemiripan ${faceDistance.toFixed(2)}; batas 0.60). Coba foto kartu dengan wajah lebih besar dan pencahayaan yang sama seperti selfie.`);
        }

        byId("camera-status").textContent = "Membaca nomor pegawai pada kartu...";
        const expectedNumber = employeeNumber.replace(/\D/g, "");
        const cardHasNumber = await readEmployeeNumber(cardImage, worker, expectedNumber, "foto kartu");
        if (!cardHasNumber) {
          throw new Error("Wajah cocok, tetapi nomor pegawai tidak terbaca pada foto kartu. Unggah foto kartu yang lebih dekat, fokus, dan tidak silau.");
        }

        byId("camera-status").textContent = "Mencocokkan nomor kartu dengan selfie...";
        const selfieHasNumber = await readEmployeeNumber(byId("verification-capture"), worker, expectedNumber, "selfie");
        if (!selfieHasNumber) {
          throw new Error("Wajah dan foto kartu cocok, tetapi OCR belum dapat membaca nomor kartu pada selfie. Ambil selfie lebih dekat dan pastikan seluruh nomor kartu terlihat jelas.");
        }

        byId("camera-status").textContent = "Pemeriksaan cocok, menyiapkan akun...";
        const passwordRecord = await hashPassword(password);
        const accounts = readDemoAccounts();
        accounts.push({ email, ...passwordRecord, createdAt: new Date().toISOString() });
        localStorage.setItem(demoAccountKey, JSON.stringify(accounts));
        byId("camera-status").textContent = "Pemeriksaan awal cocok";
        openDashboard(email);
      } finally {
        URL.revokeObjectURL(url);
        const workerToTerminate = ocrWorker;
        ocrWorker = null;
        if (workerToTerminate) await workerToTerminate.terminate();
      }
    });
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  return parseMoneyInput(value);
}

const CHART_COLORS = ["#092759", "#087cb5", "#3d91b8", "#7a9bb5", "#a8bbc9", "#c3ccd4"];

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return cleanText(value.text ?? "");
  return cleanText(value);
}

function findHeader(sheet) {
  let best = null;
  for (let index = 0; index < Math.min(sheet.rows.length, 40); index += 1) {
    const row = sheet.rows[index] ?? [];
    const labels = row.map(cellText);
    const normalized = labels.map((label) => label.toLowerCase());
    const description = normalized.findIndex((label) =>
      /^(uraian(?: kegiatan)?|deskripsi(?: kegiatan)?|nama kegiatan|rincian(?: kegiatan)?|kegiatan|belanja)$/.test(label),
    );
    if (description < 0) continue;
    const amountMatches = normalized.filter((label) => /jumlah|pagu|anggaran|nilai|sisa/.test(label)).length;
    const score = amountMatches * 2 + normalized.filter(Boolean).length;
    if (!best || score >= best.score) best = { rowIndex: index, labels, normalized, description, score };
  }
  return best;
}

function findPrimaryStart(sheet, headerRowIndex) {
  for (let index = Math.max(0, headerRowIndex - 3); index < headerRowIndex; index += 1) {
    const row = (sheet.rows[index] ?? []).map(cellText);
    const markerIndex = row.findIndex((value) => /^menjadi$/i.test(value));
    if (markerIndex >= 0) return markerIndex;
  }
  return 0;
}

function buildRevisionAnalysis(sheet) {
  let layout = null;
  for (let markerRow = 0; markerRow < Math.min(sheet.rows.length, 40); markerRow += 1) {
    const markers = (sheet.rows[markerRow] ?? []).map((value) => cellText(value).toLowerCase());
    const originalStart = markers.indexOf("semula");
    const revisedStart = markers.indexOf("menjadi");
    if (originalStart < 0 || revisedStart <= originalStart) continue;

    for (let headerRow = markerRow + 1; headerRow < Math.min(sheet.rows.length, markerRow + 5); headerRow += 1) {
      const labels = (sheet.rows[headerRow] ?? []).map((value) => cellText(value).toLowerCase());
      const originalDescription = labels.findIndex((label, index) =>
        index >= originalStart && index < revisedStart && label === "uraian",
      );
      const revisedDescription = labels.findIndex((label, index) =>
        index >= revisedStart && label === "uraian",
      );
      const deltaColumn = labels.findIndex((label, index) => index >= revisedStart && label === "selisih");
      const remainingColumn = labels.findIndex((label) => label === "sisa anggaran");
      if (originalDescription < 0 || revisedDescription < 0 || deltaColumn < 0 || remainingColumn < 0) continue;

      const originalCode = labels.findIndex((label, index) =>
        index >= originalStart && index < revisedStart && label === "kode anggaran",
      );
      const revisedCode = labels.findIndex((label, index) =>
        index >= revisedStart && label === "kode anggaran",
      );
      const originalAmountCandidates = labels
        .map((label, index) => ({ label, index }))
        .filter(({ label, index }) =>
          index >= originalStart && index < revisedStart && label.replace(/\s+/g, " ").trim() === "jumlah",
        );
      const originalAmount = originalAmountCandidates
        .map(({ index }) => ({
          index,
          numericCount: sheet.rows.slice(headerRow + 1).filter((row) => toNumber(row[index]) !== null).length,
        }))
        .sort((a, b) => b.numericCount - a.numericCount)[0]?.index;
      const revisedAmount = labels.findIndex((label, index) =>
        index >= revisedStart && index < deltaColumn && label.replace(/\s+/g, " ").trim() === "jumlah",
      );
      if (originalAmount === undefined || revisedAmount < 0) continue;
      layout = {
        firstDataRow: headerRow + 1,
        originalCode,
        originalDescription,
        originalAmount,
        revisedCode,
        revisedDescription,
        revisedAmount,
        deltaColumn,
        remainingColumn,
      };
      break;
    }
    if (layout) break;
  }
  if (!layout) return null;

  const changes = [];
  for (let index = layout.firstDataRow; index < sheet.rows.length; index += 1) {
    const values = sheet.rows[index] ?? [];
    const originalCode = cellText(values[layout.originalCode]);
    const revisedCode = cellText(values[layout.revisedCode]);
    const originalDescription = cellText(values[layout.originalDescription]);
    const revisedDescription = cellText(values[layout.revisedDescription]);
    if (originalCode || revisedCode || (!originalDescription && !revisedDescription)) continue;

    const originalAmount = toNumber(values[layout.originalAmount]);
    const revisedAmount = toNumber(values[layout.revisedAmount]);
    const recordedDelta = toNumber(values[layout.deltaColumn]);
    const delta = recordedDelta ?? (
      originalAmount !== null && revisedAmount !== null ? revisedAmount - originalAmount : null
    );
    if (delta === null || delta === 0) continue;

    const remaining = toNumber(values[layout.remainingColumn]);
    const status = delta < 0
      ? "decrease"
      : remaining === null
        ? "unknown"
        : remaining >= delta
          ? "enough"
          : "short";
    changes.push({
      originalDescription,
      originalAmount,
      revisedDescription,
      revisedAmount,
      delta,
      remaining,
      status,
      rowNumber: index + 1,
    });
  }

  const increases = changes.filter((row) => row.delta > 0);
  const decreases = changes.filter((row) => row.delta < 0);
  const comparableIncreases = increases.filter((row) => row.remaining !== null);
  const sufficient = increases.filter((row) => row.status === "enough");
  const insufficient = increases.filter((row) => row.status === "short");
  const unverified = increases.filter((row) => row.status === "unknown");
  return {
    changes,
    increases,
    decreases,
    increaseTotal: increases.reduce((sum, row) => sum + row.delta, 0),
    decreaseTotal: decreases.reduce((sum, row) => sum + Math.abs(row.delta), 0),
    sufficientCount: sufficient.length,
    insufficientCount: insufficient.length,
    unverifiedCount: unverified.length,
    comparableCount: comparableIncreases.length,
    shortfallTotal: insufficient.reduce((sum, row) => sum + row.delta - row.remaining, 0),
    status: insufficient.length ? "short" : unverified.length ? "unknown" : increases.length ? "enough" : "unchanged",
  };
}

function buildAnalysis(sheet) {
  const revision = buildRevisionAnalysis(sheet);
  const header = findHeader(sheet);
  if (!header) {
    return {
      sheetName: sheet.name,
      headerFound: false,
      revision,
      preprocessing: {
        sourceRows: sheet.rows.length,
        preparedRows: 0,
        excludedRows: sheet.rows.length,
      },
      rows: [],
      columns: [],
      ranked: [],
      chartCategories: [],
      chartGrouping: "",
      chartBudgetTotal: 0,
      chartRemainingTotal: null,
      chartComparableBudgetTotal: 0,
      chartRemainingCount: 0,
      unusualRemainingCategories: [],
      descriptionColumn: -1,
      codeColumn: -1,
      moneyColumn: -1,
      remainingColumn: -1,
      moneyCandidates: [],
      total: null,
      remaining: null,
      valueRows: 0,
    };
  }

  const start = findPrimaryStart(sheet, header.rowIndex);
  const columns = header.labels
    .map((label, index) => ({ label: cleanText(label), normalized: label.toLowerCase(), index }))
    .filter((column) => column.index >= start && column.label);

  const descriptionColumn = columns.find((column) => /uraian|deskripsi|kegiatan|rincian|belanja/.test(column.normalized))
    ?? columns[0];
  const codeColumn = columns.find((column) => /kode anggaran|^kode$|^akun$/.test(column.normalized));
  const moneyColumn = columns
    .filter((column) => /jumlah|pagu|total anggaran|nilai anggaran/.test(column.normalized))
    .at(-1);
  const remainingColumn = columns.filter((column) => /sisa anggaran|^sisa$/.test(column.normalized)).at(-1);
  const moneyCandidates = columns.filter((column) =>
    /jumlah|pagu|anggaran|nilai|total|blokir|selisih|realisasi|belanja/.test(column.normalized),
  );

  const sourceRows = Math.max(0, sheet.rows.length - header.rowIndex - 1);
  const dataRows = [];
  for (let index = header.rowIndex + 1; index < sheet.rows.length; index += 1) {
    const values = sheet.rows[index] ?? [];
    const description = cellText(values[descriptionColumn.index]);
    const code = codeColumn ? cellText(values[codeColumn.index]) : "";
    const amount = moneyColumn ? toNumber(values[moneyColumn.index]) : null;
    const remainingValue = remainingColumn ? toNumber(values[remainingColumn.index]) : null;
    const normalizedDescription = description.toLocaleLowerCase("id");
    const isHeaderRow = /^(uraian|kode anggaran|vol\.?|satuan|harga satuan|jumlah|pagu|sisa anggaran)$/.test(normalizedDescription);
    const isNumericPlaceholder = /^\d+(?:[.,]\d+)?$/.test(description);
    if (!description || isHeaderRow || isNumericPlaceholder) continue;
    if (amount === null && remainingValue === null) continue;
    dataRows.push({
      values,
      description,
      code,
      amount,
      remaining: remainingValue,
      rowNumber: index + 1,
    });
  }

  const amounts = dataRows.map((row) => row.amount).filter((value) => value !== null && value > 0);
  const total = amounts.length ? Math.max(...amounts) : null;
  const remainingValues = dataRows.map((row) => row.remaining).filter((value) => value !== null && value >= 0);
  const remaining = remainingValues.length ? Math.max(...remainingValues) : null;
  const detailRows = dataRows.filter((row) => {
    if (row.amount === null || row.amount <= 0) return false;
    if (total !== null && row.amount >= total * 0.9) return false;
    return row.description.startsWith("-") || row.description.startsWith("•") || row.code;
  });
  const ranked = (detailRows.length ? detailRows : dataRows.filter((row) => row.amount > 0))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const activityRows = dataRows.filter((row) => /^\d{3}$/.test(row.code) && row.amount > 0);
  const accountRows = dataRows.filter((row) => /^\d{6}$/.test(row.code) && row.amount > 0);
  let chartCategories = activityRows.map((row) => ({
    ...row,
    chartLabel: `${row.code} · ${row.description}`,
  }));
  let chartGrouping = "kelompok kegiatan";

  if (chartCategories.length < 2) {
    const groupedAccounts = new Map();
    for (const row of accountRows) {
      const current = groupedAccounts.get(row.code) ?? {
        code: row.code,
        description: row.description,
        amount: 0,
        remaining: 0,
        remainingRows: 0,
        rowCount: 0,
        rowNumber: row.rowNumber,
      };
      current.amount += row.amount;
      current.rowCount += 1;
      if (row.remaining !== null) {
        current.remaining += row.remaining;
        current.remainingRows += 1;
      }
      groupedAccounts.set(row.code, current);
    }
    chartCategories = [...groupedAccounts.values()]
      .map((category) => ({
        ...category,
        chartLabel: `${category.code} · ${category.description}`,
        remaining: category.remainingRows === category.rowCount ? category.remaining : null,
      }));
    chartGrouping = "akun belanja";
  }

  if (chartCategories.length < 2) {
    chartCategories = (detailRows.length ? detailRows : [])
      .filter((row) => row.amount > 0)
      .map((row) => ({ ...row, chartLabel: row.description }));
    chartGrouping = "rincian belanja";
  }
  chartCategories = chartCategories
    .filter((category) => category.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const chartBudgetTotal = chartCategories.reduce((sum, category) => sum + category.amount, 0);
  const chartRemainingCategories = chartCategories.filter((category) => category.remaining !== null);
  const chartRemainingTotal = chartRemainingCategories.length
    ? chartRemainingCategories.reduce((sum, category) => sum + category.remaining, 0)
    : null;
  const chartComparableBudgetTotal = chartRemainingCategories.reduce((sum, category) => sum + category.amount, 0);
  const unusualRemainingCategories = chartCategories.filter((category) =>
    category.remaining !== null && (category.remaining < 0 || category.remaining > category.amount),
  );

  return {
    sheetName: sheet.name,
    headerFound: true,
    revision,
    headerRowIndex: header.rowIndex,
    preprocessing: {
      sourceRows,
      preparedRows: dataRows.length,
      excludedRows: sourceRows - dataRows.length,
    },
    columns,
    descriptionColumn: descriptionColumn.index,
    codeColumn: codeColumn?.index ?? -1,
    moneyColumn: moneyColumn?.index ?? -1,
    remainingColumn: remainingColumn?.index ?? -1,
    moneyCandidates,
    rows: dataRows,
    ranked,
    chartCategories,
    chartGrouping,
    chartBudgetTotal,
    chartRemainingTotal,
    chartComparableBudgetTotal,
    chartRemainingCount: chartRemainingCategories.length,
    unusualRemainingCategories,
    total,
    remaining,
    valueRows: dataRows.length,
  };
}

function formatMoney(value) {
  return value === null || value === undefined ? "—" : `Rp ${rupiah.format(value)}`;
}

function formatCompact(value) {
  if (value === null || value === undefined) return "—";
  return `Rp ${compact.format(value)}`;
}

function parseMoneyInput(value) {
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!cleaned || /^-+$/.test(cleaned)) return null;
  let normalized = cleaned;
  const commaIndex = cleaned.lastIndexOf(",");
  const dotIndex = cleaned.lastIndexOf(".");
  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(groupingSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (commaIndex >= 0 || dotIndex >= 0) {
    const separator = commaIndex >= 0 ? "," : ".";
    const parts = cleaned.split(separator);
    const isGrouped = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].replace("-", "").length <= 3);
    normalized = isGrouped ? parts.join("") : cleaned.replace(separator, ".");
  }
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function findDefaultActivityRow(analysis) {
  return analysis?.rows?.find((row) =>
    /^\d+(?:\.[A-Z0-9]+){2,}$/i.test(row.code) && row.description && row.amount !== null,
  );
}

function chooseActivity(analysis) {
  const codedActivity = findDefaultActivityRow(analysis);
  if (codedActivity) return codedActivity.description;
  const preferred = analysis?.ranked?.find((row) => row.description && row.amount !== null);
  if (preferred) return preferred.description.replace(/^[\-•]\s*/, "");
  return analysis?.rows?.find((row) => row.description && row.code)?.description ?? "";
}

function getLocation(sheet) {
  const text = sheet.rows.flat().map(cellText).find((cell) => /^lokasi\s*:/i.test(cell));
  return text ? text.replace(/^lokasi\s*:\s*/i, "") : "";
}

function getYear(sheet) {
  const match = sheet.rows.flat().map(cellText).join(" ").match(/\b(20\d{2})\b/);
  return match?.[1] ?? String(new Date().getFullYear());
}

function buildInsights(analysis) {
  if (!analysis.headerFound) {
    return [{
      title: "Struktur tabel belum dikenali",
      text: "Pastikan sheet memiliki kolom uraian/kegiatan dan angka anggaran.",
      warning: true,
    }];
  }
  const insights = [];
  if (analysis.revision?.increases.length) {
    const revision = analysis.revision;
    const unknownText = revision.unverifiedCount
      ? ` ${revision.unverifiedCount} rincian belum memiliki nilai sisa.`
      : "";
    const comparisonText = revision.insufficientCount
      ? `${revision.insufficientCount} dari ${revision.comparableCount} rincian kenaikan memiliki sisa lebih kecil daripada selisih.`
      : `Tidak ada kekurangan pada ${revision.comparableCount} rincian yang nilai sisanya terbaca.`;
    insights.push({
      title: revision.status === "enough" ? "Sisa menutup kenaikan pagu" : "Periksa kecukupan sisa untuk revisi",
      text: `${comparisonText}${revision.shortfallTotal > 0 ? ` Kekurangan pada rincian yang dapat dibandingkan: ${formatMoney(revision.shortfallTotal)}.` : ""}${unknownText}`,
      warning: revision.status !== "enough",
    });
  }
  if (analysis.chartCategories.length) {
    const leading = analysis.chartCategories[0];
    const share = analysis.chartBudgetTotal > 0
      ? Math.round((leading.amount / analysis.chartBudgetTotal) * 100)
      : 0;
    insights.push({
      title: "Porsi pagu terbesar",
      text: `${leading.chartLabel} menyumbang sekitar ${share}% dari pagu kategori terdeteksi (${formatMoney(leading.amount)} dari ${formatMoney(analysis.chartBudgetTotal)}).`,
    });
    if (analysis.chartRemainingTotal !== null && analysis.chartComparableBudgetTotal > 0) {
      const remainingShare = Math.round((analysis.chartRemainingTotal / analysis.chartComparableBudgetTotal) * 100);
      const largestRemaining = [...analysis.chartCategories]
        .filter((category) => category.remaining !== null)
        .sort((a, b) => b.remaining - a.remaining)[0];
      insights.push({
        title: "Sisa pada kategori yang terbaca",
        text: `${formatMoney(analysis.chartRemainingTotal)} dari ${formatMoney(analysis.chartComparableBudgetTotal)} pagu kategori memiliki kolom sisa (sekitar ${remainingShare}%). Nilai ini hanya menjumlahkan kategori yang datanya tersedia.`,
      });
      if (largestRemaining?.remaining > 0) {
        insights.push({
          title: "Sisa terbesar per kategori",
          text: `${largestRemaining.chartLabel}: ${formatMoney(largestRemaining.remaining)} dari pagu ${formatMoney(largestRemaining.amount)}.`,
        });
      }
    } else {
      insights.push({
        title: "Kolom sisa tidak tersedia untuk perbandingan",
        text: "Grafik menampilkan komposisi pagu saja karena nilai sisa tidak terbaca pada baris kategori.",
        warning: true,
      });
    }
    if (analysis.unusualRemainingCategories.length) {
      const example = analysis.unusualRemainingCategories[0];
      insights.push({
        title: "Periksa nilai sisa yang melebihi pagu",
        text: `${analysis.unusualRemainingCategories.length} kategori memiliki sisa di luar rentang pagu, contohnya ${example.chartLabel}. Periksa perubahan anggaran atau formula sumber.`,
        warning: true,
      });
    }
  } else if (analysis.total !== null) {
    insights.push({
      title: "Nilai anggaran tertinggi terdeteksi",
      text: `${formatMoney(analysis.total)} ditemukan pada kolom ${analysis.columns.find((column) => column.index === analysis.moneyColumn)?.label ?? "nilai anggaran"}. Nilai ini bisa berupa subtotal, jadi cek konteks barisnya.`,
    });
  } else {
    insights.push({ title: "Kolom nilai belum terpetakan", text: "Uraian terbaca, tetapi kolom jumlah/pagu belum ditemukan pada header sheet.", warning: true });
  }
  if (!analysis.chartCategories.length && analysis.remaining !== null) {
    const ratio = analysis.total ? Math.round((analysis.remaining / analysis.total) * 100) : null;
    insights.push({
      title: "Sisa anggaran tersedia",
      text: `${formatMoney(analysis.remaining)}${ratio !== null ? ` (sekitar ${ratio}% dari nilai tertinggi)` : ""} terbaca pada kolom sisa.`,
    });
  }
  const leader = analysis.ranked[0];
  if (!analysis.chartCategories.length && leader) {
    insights.push({
      title: "Rincian bernilai terbesar",
      text: `${leader.description.replace(/^[\-•]\s*/, "")} — ${formatMoney(leader.amount)}.`,
    });
  }
  if (analysis.remainingColumn < 0 && analysis.moneyColumn < 0) {
    insights.push({ title: "Perlu cek pemetaan kolom", text: "Pilih sheet yang memiliki header anggaran agar ringkasan dapat dihitung.", warning: true });
  }
  return insights.slice(0, 4);
}

function renderStats(analysis) {
  const hasCategories = analysis.chartCategories.length > 0;
  const remainingAvailable = analysis.chartRemainingTotal !== null;
  const stats = [
    {
      label: "Total pagu kategori",
      value: formatMoney(hasCategories ? analysis.chartBudgetTotal : null),
      foot: hasCategories ? `${analysis.chartCategories.length} kategori · ${analysis.chartGrouping}` : "Kategori anggaran belum terbaca",
    },
    {
      label: "Sisa anggaran terdeteksi",
      value: formatMoney(remainingAvailable ? analysis.chartRemainingTotal : null),
      foot: remainingAvailable ? `${analysis.chartRemainingCount} kategori memiliki data sisa` : "Data sisa tidak tersedia pada kategori",
    },
    {
      label: "Kategori dianalisis",
      value: new Intl.NumberFormat("id-ID").format(analysis.chartCategories.length),
      foot: hasCategories ? `Sumber: ${analysis.chartGrouping}` : "Belum ada kelompok kategori",
    },
    {
      label: "Rincian bernilai",
      value: new Intl.NumberFormat("id-ID").format(analysis.valueRows),
      foot: "Baris dengan angka anggaran",
    },
  ];
  byId("stats-grid").innerHTML = stats.map((stat) => `
    <article class="stat-card">
      <div class="stat-top"><span>${escapeHtml(stat.label)}</span></div>
      <div class="stat-value" title="${escapeHtml(stat.value)}">${escapeHtml(stat.value)}</div>
      <div class="stat-foot">${escapeHtml(stat.foot)}</div>
    </article>`).join("");
}

function renderRevisionSummary(revision) {
    const card = byId("revision-card");
    card.classList.toggle("hidden", !revision);
    if (!revision) return;

    const status = byId("revision-status");
    const statusLabels = {
      short: "Perlu cek dana",
      unknown: "Perlu verifikasi",
      enough: "Sisa mencukupi",
      unchanged: "Tidak ada kenaikan",
    };
    status.className = `revision-status ${revision.status}`;
    status.textContent = statusLabels[revision.status];

    let summaryText = "Tidak ada kenaikan pagu pada rincian yang terdeteksi.";
    if (revision.increases.length) {
      summaryText = revision.insufficientCount
        ? `${revision.insufficientCount} dari ${revision.comparableCount} rincian kenaikan memiliki sisa lebih kecil dari selisih.`
        : `Tidak ada kekurangan pada ${revision.comparableCount} rincian yang nilai sisanya terbaca.`;
      if (revision.shortfallTotal > 0) {
        summaryText += ` Kekurangan pada rincian yang dapat dibandingkan: ${formatMoney(revision.shortfallTotal)}.`;
      }
      if (revision.unverifiedCount > 0) {
        summaryText += ` ${revision.unverifiedCount} rincian belum memiliki nilai sisa, jadi perlu diperiksa manual.`;
      }
      if (revision.status === "enough") {
        summaryText = `Sisa anggaran pada seluruh ${revision.sufficientCount} rincian kenaikan cukup untuk menutup selisih.`;
      }
    }

    const metrics = [
      {
        label: "Total kenaikan",
        value: formatMoney(revision.increaseTotal),
        foot: `${revision.increases.length} rincian Semula → Menjadi`,
      },
      {
        label: "Sisa mencukupi",
        value: String(revision.sufficientCount),
        foot: "Rincian dengan sisa ≥ selisih",
      },
      {
        label: "Sisa lebih kecil",
        value: String(revision.insufficientCount),
        foot: "Rincian perlu ditinjau",
      },
      {
        label: "Kekurangan terhitung",
        value: formatMoney(revision.shortfallTotal),
        foot: revision.unverifiedCount ? `${revision.unverifiedCount} rincian sisa belum terbaca` : "Pada rincian yang sisa-nya terbaca",
      },
    ];
    byId("revision-summary").innerHTML = `
      <p class="revision-explanation">${escapeHtml(summaryText)}</p>
      <div class="revision-metrics">${metrics.map((metric) => `
        <div class="revision-metric">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
          <small>${escapeHtml(metric.foot)}</small>
        </div>`).join("")}
      </div>`;
}

function getPieSlices(analysis) {
    const categories = analysis.chartCategories;
    if (categories.length <= 5) {
      return categories.map((category, index) => ({
        label: category.chartLabel,
        amount: category.amount,
        color: CHART_COLORS[index % CHART_COLORS.length],
      }));
    }
    const slices = categories.slice(0, 4).map((category, index) => ({
      label: category.chartLabel,
      amount: category.amount,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
    slices.push({
      label: "Kategori lainnya",
      amount: categories.slice(4).reduce((sum, category) => sum + category.amount, 0),
      color: CHART_COLORS[5],
    });
    return slices;
}

function renderDonutChart(analysis) {
    const visual = byId("donut-chart");
    const legend = byId("donut-legend");
    const total = analysis.chartBudgetTotal;
    if (!analysis.chartCategories.length || total <= 0) {
      visual.innerHTML = `<div class="empty-chart">Belum ada kelompok nilai yang cukup untuk membentuk komposisi.</div>`;
      legend.innerHTML = "";
      byId("donut-caption").textContent = "Tidak ada kategori anggaran yang terdeteksi";
      return;
    }
    const slices = getPieSlices(analysis);
    const circumference = 2 * Math.PI * 49;
    let offset = 0;
    const circles = slices.map((slice) => {
      const portion = slice.amount / total;
      const length = portion * circumference;
      const circle = `<circle cx="66" cy="66" r="49" fill="none" stroke="${slice.color}" stroke-width="18" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escapeHtml(slice.label)}: ${escapeHtml(formatMoney(slice.amount))} (${Math.round(portion * 100)}%)</title></circle>`;
      offset += length;
      return circle;
    }).join("");
    visual.innerHTML = `<svg class="donut-svg" viewBox="0 0 132 132" role="img" aria-label="Grafik donat komposisi pagu berdasarkan kategori">
      <circle cx="66" cy="66" r="49" fill="none" stroke="#eaf0f5" stroke-width="18"></circle>
      <g transform="rotate(-90 66 66)">${circles}</g>
      <text x="66" y="62" text-anchor="middle" class="donut-center-value">${escapeHtml(formatCompact(total))}</text>
      <text x="66" y="78" text-anchor="middle" class="donut-center-label">pagu terdeteksi</text>
    </svg>`;
    legend.innerHTML = slices.map((slice) => {
      const share = Math.round((slice.amount / total) * 100);
      return `<div class="donut-legend-item" title="${escapeHtml(slice.label)}: ${escapeHtml(formatMoney(slice.amount))}">
        <span class="donut-dot" style="--slice-color:${slice.color}"></span>
        <span class="donut-label">${escapeHtml(slice.label)}</span>
        <span class="donut-amount">${escapeHtml(formatMoney(slice.amount))}</span>
        <span class="donut-share">${share}%</span>
      </div>`;
    }).join("");
    byId("donut-caption").textContent = `${analysis.chartGrouping} · porsi dari nilai kategori yang terdeteksi`;
}

function renderColumnChart(analysis) {
    const container = byId("column-chart");
    const categories = analysis.chartCategories.slice(0, 6);
    const hasRemaining = categories.some((category) => category.remaining !== null);
    byId("legend-remaining-item").classList.toggle("hidden", !hasRemaining);
    if (!categories.length) {
      container.innerHTML = `<div class="empty-chart">Pilih sheet dengan kolom pagu dan kategori yang terbaca untuk membuat grafik.</div>`;
      byId("column-caption").textContent = "Perbandingan belum tersedia";
      return;
    }
    const maxValue = Math.max(1, ...categories.flatMap((category) =>
      [category.amount, category.remaining ?? 0],
    ));
    const viewWidth = 660;
    const plot = { x: 54, y: 20, width: 590, height: 184 };
    const axisBottom = plot.y + plot.height;
    const ticks = Array.from({ length: 5 }, (_, index) => maxValue * (4 - index) / 4);
    const grid = ticks.map((value, index) => {
      const y = plot.y + (plot.height / 4) * index;
      return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.width}" y2="${y}" class="chart-grid-line"></line>
        <text x="${plot.x - 8}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${escapeHtml(formatCompact(value))}</text>`;
    }).join("");
    const groupWidth = plot.width / categories.length;
    const barWidth = Math.min(24, Math.max(13, groupWidth * 0.22));
    const gap = 4;
    const bars = categories.map((category, index) => {
      const centerX = plot.x + (index + 0.5) * groupWidth;
      const budgetHeight = (category.amount / maxValue) * plot.height;
      const remainingHeight = category.remaining === null
        ? 0
        : (Math.max(0, category.remaining) / maxValue) * plot.height;
      const budgetX = centerX - barWidth - gap / 2;
      const remainingX = centerX + gap / 2;
      const chartLabel = category.chartLabel ?? category.description;
      const shortLabel = chartLabel.length > 13 ? `${chartLabel.slice(0, 12)}…` : chartLabel;
      return `<g>
        <rect x="${budgetX}" y="${axisBottom - budgetHeight}" width="${barWidth}" height="${budgetHeight}" rx="2" fill="#7898b2">
          <title>${escapeHtml(category.description)} · Pagu: ${escapeHtml(formatMoney(category.amount))}</title>
        </rect>
        ${category.remaining === null ? "" : `<rect x="${remainingX}" y="${axisBottom - remainingHeight}" width="${barWidth}" height="${remainingHeight}" rx="2" fill="#092759"><title>${escapeHtml(category.description)} · Sisa: ${escapeHtml(formatMoney(category.remaining))}</title></rect>`}
        <text x="${centerX}" y="${axisBottom + 18}" text-anchor="middle" class="chart-category-label"><title>${escapeHtml(chartLabel)}</title>${escapeHtml(shortLabel)}</text>
      </g>`;
    }).join("");
    container.innerHTML = `<svg class="column-svg" viewBox="0 0 ${viewWidth} 248" role="img" aria-label="Grafik kolom pagu dan sisa per kategori anggaran">
      ${grid}
      <line x1="${plot.x}" y1="${axisBottom}" x2="${plot.x + plot.width}" y2="${axisBottom}" class="chart-axis-line"></line>
      ${bars}
    </svg>`;
    byId("column-caption").textContent = categories.length < analysis.chartCategories.length
      ? `6 kategori terbesar · dikelompokkan menurut ${analysis.chartGrouping}${hasRemaining ? "" : " · pagu saja"}`
      : `Semua ${categories.length} kategori · dikelompokkan menurut ${analysis.chartGrouping}${hasRemaining ? "" : " · pagu saja"}`;
}

function renderRemainingChart(analysis) {
  const container = byId("remaining-chart");
  const categories = analysis.chartCategories
    .filter((category) => category.remaining !== null && category.remaining >= 0)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 5);
  if (!categories.length) {
    container.innerHTML = `<div class="empty-chart">Data sisa per kategori belum tersedia pada sheet ini.</div>`;
    byId("remaining-caption").textContent = "Perbandingan belum tersedia";
    return;
  }

  const maxRemaining = Math.max(...categories.map((category) => category.remaining), 1);
  const totalRemaining = categories.reduce((sum, category) => sum + category.remaining, 0);
  container.innerHTML = categories.map((category) => {
    const share = totalRemaining > 0 ? Math.round((category.remaining / totalRemaining) * 100) : 0;
    const width = Math.round((category.remaining / maxRemaining) * 100);
    const label = category.description || category.chartLabel;
    return `<div class="remaining-row" title="${escapeHtml(label)}: ${escapeHtml(formatMoney(category.remaining))}">
      <div class="remaining-row-top">
        <span class="remaining-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatMoney(category.remaining))}</strong>
      </div>
      <div class="remaining-track" role="img" aria-label="${escapeHtml(label)}: ${share}% dari sisa pada kategori teratas">
        <span class="remaining-fill" style="width:${width}%"></span>
      </div>
    </div>`;
  }).join("");
  byId("remaining-caption").textContent = `5 kategori dengan sisa terbesar · total ${formatMoney(totalRemaining)}`;
}

function renderInsights(analysis) {
  const insights = buildInsights(analysis);
  byId("insight-list").innerHTML = insights.map((insight) => `
    <div class="insight-item ${insight.warning ? "warning" : ""}">
      <div class="insight-copy">${insight.warning ? '<span class="insight-warning-label">PERLU PERHATIAN</span>' : ""}
        <strong>${escapeHtml(insight.title)}</strong><p>${escapeHtml(insight.text)}</p></div>
    </div>`).join("");
}

function displayColumns(analysis) {
  const columns = analysis.columns ?? [];
  const selected = [];
  if (analysis.codeColumn >= 0) selected.push({ index: analysis.codeColumn, label: "Kode" });
  if (analysis.descriptionColumn >= 0) selected.push({ index: analysis.descriptionColumn, label: "Uraian" });
  if (analysis.moneyColumn >= 0) selected.push({
    index: analysis.moneyColumn,
    label: columns.find((column) => column.index === analysis.moneyColumn)?.label || "Jumlah",
  });
  if (analysis.remainingColumn >= 0 && analysis.remainingColumn !== analysis.moneyColumn) {
    selected.push({
      index: analysis.remainingColumn,
      label: columns.find((column) => column.index === analysis.remainingColumn)?.label || "Sisa",
    });
  }
  return selected.length ? selected : columns.slice(0, 4);
}

function renderTable(analysis) {
  if (analysis.revision) {
    const columns = [
      "Uraian semula",
      "Pagu semula",
      "Uraian menjadi",
      "Pagu menjadi",
      "Selisih",
      "Sisa anggaran",
      "Kecukupan",
    ];
    byId("table-head").innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
    renderTableRows(analysis, []);
    byId("table-caption").textContent = `${analysis.revision.changes.length} rincian dengan perubahan nilai Selisih`;
    return;
  }
  const columns = displayColumns(analysis);
  byId("table-head").innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  renderTableRows(analysis, columns);
  byId("table-caption").textContent = `${analysis.rows.length} baris uraian terdeteksi`;
}

function renderTableRows(analysis, columns) {
  const query = byId("table-search").value.trim().toLocaleLowerCase("id");
  if (analysis.revision) {
    const visible = analysis.revision.changes.filter((row) =>
      !query || `${row.originalDescription} ${row.revisedDescription}`.toLocaleLowerCase("id").includes(query),
    );
    const shown = visible.slice(0, 12);
    const statusLabels = {
      enough: "Sisa cukup",
      short: "Sisa kurang",
      unknown: "Cek sisa",
      decrease: "Pengurangan",
    };
    byId("table-body").innerHTML = shown.length
      ? shown.map((row) => `<tr class="${["short", "unknown"].includes(row.status) ? "warning-row" : ""}">
        <td title="${escapeHtml(row.originalDescription || "Tidak ada pada Semula")}">${escapeHtml(row.originalDescription || "—")}</td>
        <td class="amount">${escapeHtml(formatMoney(row.originalAmount))}</td>
        <td title="${escapeHtml(row.revisedDescription || "Tidak ada pada Menjadi")}">${escapeHtml(row.revisedDescription || "—")}</td>
        <td class="amount">${escapeHtml(formatMoney(row.revisedAmount))}</td>
        <td class="amount ${row.delta < 0 ? "revision-decrease" : ""}">${escapeHtml(formatMoney(row.delta))}</td>
        <td class="amount">${escapeHtml(formatMoney(row.remaining))}</td>
        <td><span class="revision-row-status ${row.status}">${statusLabels[row.status]}</span></td>
      </tr>`).join("")
      : `<tr><td colspan="7">Tidak ada rincian perubahan yang cocok.</td></tr>`;
    byId("table-footer").textContent = visible.length > shown.length
      ? `Menampilkan ${shown.length} dari ${visible.length} rincian perubahan.`
      : `Menampilkan ${shown.length} dari ${visible.length} rincian perubahan.`;
    return;
  }
  const visible = analysis.rows.filter((row) => !query || `${row.description} ${row.code}`.toLocaleLowerCase("id").includes(query));
  const shown = visible.slice(0, 12);
  byId("table-body").innerHTML = shown.length
    ? shown.map((row) => `<tr>${columns.map((column) => {
      const value = row.values[column.index];
      const isMoney = column.index === analysis.moneyColumn || column.index === analysis.remainingColumn;
      const numeric = toNumber(value);
      const text = isMoney && numeric !== null ? formatMoney(numeric) : cellText(value) || "—";
      const classes = column.index === analysis.codeColumn ? "code" : isMoney ? "amount" : "";
      return `<td class="${classes}" title="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
    }).join("")}</tr>`).join("")
    : `<tr><td colspan="${Math.max(columns.length, 1)}">Tidak ada baris yang cocok.</td></tr>`;
  byId("table-footer").textContent = visible.length > shown.length
    ? `Menampilkan ${shown.length} dari ${visible.length} baris yang cocok.`
    : `Menampilkan ${shown.length} dari ${visible.length} baris.`;
}

function updateTorSource(analysis, sheet) {
  const activity = chooseActivity(analysis);
  const location = getLocation(sheet);
  const year = getYear(sheet);
  if (!byId("activity-input").value || !state.generatedSections) byId("activity-input").value = activity;
  if (!byId("location-input").value || !state.generatedSections) byId("location-input").value = location;
  if (!byId("year-input").value || !state.generatedSections) byId("year-input").value = year;

  const sourceRows = analysis.rows.filter((row) => row.amount !== null || row.remaining !== null);
  let selectedRow = sourceRows.find((row) => row.rowNumber === state.torSourceRowNumber);
  if (!selectedRow) {
    selectedRow = sourceRows.find((row) => row.description === activity)
      ?? findDefaultActivityRow(analysis)
      ?? sourceRows[0];
    state.torSourceRowNumber = selectedRow?.rowNumber ?? null;
    state.torAmountOverride = null;
    state.torRemainingOverride = null;
  }

  if (!selectedRow) {
    byId("source-summary").classList.remove("editable");
    byId("source-summary").innerHTML = `
      <div><strong>${escapeHtml(sheet.name)} · Data nilai belum terdeteksi</strong>
        <p>Data RAB yang memiliki uraian dan nilai pagu/sisa belum tersedia pada sheet ini.</p>
      </div>`;
    return;
  }

  const selectedAmount = state.torAmountOverride ?? (selectedRow.amount === null ? "" : formatMoney(selectedRow.amount));
  const selectedRemaining = state.torRemainingOverride ?? (selectedRow.remaining === null ? "" : formatMoney(selectedRow.remaining));
  const options = sourceRows.map((row) => {
    const label = `${row.code ? `${row.code} · ` : ""}${row.description} · ${formatMoney(row.amount)}`;
    return `<option value="${row.rowNumber}" ${row.rowNumber === selectedRow.rowNumber ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  byId("source-summary").classList.add("editable");
  byId("source-summary").innerHTML = `
    <div class="source-summary-heading"><strong>Sumber RAB untuk draft TOR</strong><span>${escapeHtml(sheet.name)}</span></div>
    <label class="source-field">Pilih rincian RAB
      <select id="tor-source-row">${options}</select>
    </label>
    <div class="source-fields">
      <label class="source-field">Pagu untuk TOR
        <input id="tor-source-amount" type="text" inputmode="decimal" value="${escapeHtml(selectedAmount)}" placeholder="Contoh: Rp 1.500.000">
      </label>
      <label class="source-field">Sisa anggaran
        <input id="tor-source-remaining" type="text" inputmode="decimal" value="${escapeHtml(selectedRemaining)}" placeholder="Belum terdeteksi">
      </label>
    </div>
    <small class="source-edit-hint">Perubahan hanya berlaku untuk draft TOR, tidak mengubah data asli RAB.</small>
    <small class="source-edit-warning hidden" id="tor-source-warning" role="alert"></small>`;
  updateTorSourceWarning();
}

function updateTorSourceWarning() {
  const warning = byId("tor-source-warning");
  const amountInput = byId("tor-source-amount");
  const remainingInput = byId("tor-source-remaining");
  if (!warning || !amountInput || !remainingInput) return;

  const messages = [];
  const amount = parseMoneyInput(amountInput.value);
  const remaining = parseMoneyInput(remainingInput.value);
  if (amount === null) messages.push("Pagu untuk TOR belum diisi atau formatnya tidak valid.");
  else if (amount < 0) messages.push("Pagu untuk TOR bernilai negatif; periksa kembali data.");
  if (!remainingInput.value.trim()) messages.push("Sisa anggaran belum terdeteksi; verifikasi langsung pada RAB.");
  else if (remaining === null) messages.push("Format sisa anggaran tidak valid.");
  else if (remaining < 0) messages.push("Sisa anggaran bernilai negatif; periksa kembali data.");

  warning.textContent = messages.join(" ");
  warning.classList.toggle("hidden", messages.length === 0);
}

function renderDashboard() {
  const sheet = state.workbook?.sheets.find((item) => item.name === state.selectedSheet);
  if (!sheet) return;
  const analysis = sheet.analysis ?? buildAnalysis(sheet);
  state.currentAnalysis = analysis;
  byId("summary-caption").textContent = analysis.headerFound
    ? `Sheet “${sheet.name}” · ${analysis.preprocessing.preparedRows} baris anggaran disiapkan; ${analysis.preprocessing.excludedRows} baris tanpa nilai anggaran atau format tabel disaring.${analysis.revision ? ` ${analysis.revision.changes.length} perubahan Semula–Menjadi diperiksa.` : ""}${analysis.chartCategories.length ? ` Grafik memakai ${analysis.chartGrouping}; subtotal induk dikecualikan.` : " Grafik kategori belum tersedia untuk sheet ini."}`
    : `Sheet “${sheet.name}” · struktur tabel anggaran belum dikenali.`;
  renderStats(analysis);
  renderRevisionSummary(analysis.revision);
  renderDonutChart(analysis);
  renderColumnChart(analysis);
  renderRemainingChart(analysis);
  renderInsights(analysis);
  renderTable(analysis);
  updateTorSource(analysis, sheet);
  if (state.generatedSections) generateTor(false);
}

async function loadFile(file) {
  if (!file) return;
  hideError();
  const supportedFormats = /\.(xlsx|xls|xlsm|csv|docx|doc|pdf)$/i;
  if (!supportedFormats.test(file.name)) {
    showError("Format file belum didukung. Gunakan Excel (.xlsx/.xls/.xlsm), CSV, Word (.docx/.doc), atau PDF.");
    return;
  }
  byId("file-status").textContent = "Sedang membaca...";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const response = await fetch("/api/parse", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "File gagal dibaca.");
    const sheets = result.sheets.map((sheet) => ({
      ...sheet,
      analysis: buildAnalysis(sheet),
    }));
    state.workbook = { ...result, sheets };
    const preferred = sheets.find((sheet) => /rab|anggaran/i.test(sheet.name)) ?? sheets[0];
    state.selectedSheet = preferred?.name ?? null;
    byId("file-name").textContent = result.fileName;
    byId("file-status").textContent = `${result.sheets.length} ${result.sheets.length === 1 ? "tabel" : "sheet"} berhasil dibaca`;
    byId("sheet-select").innerHTML = result.sheets
      .map((sheet) => `<option value="${escapeHtml(sheet.name)}">${escapeHtml(sheet.name)}</option>`)
      .join("");
    byId("sheet-select").value = state.selectedSheet;
    byId("dataset-bar").querySelector(".dataset-file-type").textContent = file.name.split(".").at(-1).toUpperCase();
    byId("dataset-bar").classList.remove("hidden");
    byId("dashboard-results").classList.remove("hidden");
    byId("upload-panel").classList.add("hidden");
    byId("table-search").value = "";
    state.generatedSections = null;
    state.torSourceRowNumber = null;
    state.torAmountOverride = null;
    state.torRemainingOverride = null;
    renderDashboard();
  } catch (error) {
    byId("file-status").textContent = "Gagal dibaca";
    showError(error.message);
  }
}

function showError(message) {
  byId("error-message").textContent = message;
  byId("error-message").classList.remove("hidden");
}

function hideError() {
  byId("error-message").classList.add("hidden");
}

function setTab(tab) {
  const isTor = tab === "tor";
  document.querySelectorAll(".nav-link").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  byId("dashboard-view").classList.toggle("active", !isTor);
  byId("tor-view").classList.toggle("active", isTor);
  byId("crumb-current").textContent = isTor ? "Generator TOR" : "Dashboard";
}

function makeTorSections() {
  const analysis = state.currentAnalysis;
  const sheet = state.workbook?.sheets.find((item) => item.name === state.selectedSheet);
  const activity = cleanText(byId("activity-input").value) || "Kegiatan (lengkapi nama kegiatan)";
  const location = cleanText(byId("location-input").value) || "Lokasi pelaksanaan ditetapkan kemudian";
  const year = cleanText(byId("year-input").value) || String(new Date().getFullYear());
  const notes = cleanText(byId("notes-input").value);
  const activityRow = analysis?.rows?.find((row) => row.rowNumber === state.torSourceRowNumber);
  const amount = state.torAmountOverride === null
    ? activityRow?.amount ?? null
    : parseMoneyInput(state.torAmountOverride);
  const remainingValue = state.torRemainingOverride === null
    ? activityRow?.remaining ?? null
    : parseMoneyInput(state.torRemainingOverride);
  const amountText = amount === null
    ? "Nilai pagu belum diisi atau formatnya tidak valid. Periksa kembali sumber anggaran sebelum TOR digunakan."
    : `Pada baris ${activityRow?.rowNumber ?? "pilihan"}${activityRow?.code ? ` dengan kode ${activityRow.code}` : ""} tercatat nilai ${formatMoney(amount)}. Nilai ini perlu diverifikasi terhadap RAB final.`;
  const remaining = remainingValue === null
    ? "Sisa anggaran untuk baris kegiatan ini belum diidentifikasi atau formatnya tidak valid."
    : `Sisa anggaran pada baris kegiatan ini tercatat ${formatMoney(remainingValue)}; mohon verifikasi terhadap RAB final.`;
  const purpose = notes || `Kegiatan ${activity} dilaksanakan untuk mendukung pencapaian target kinerja unit kerja melalui pelaksanaan kegiatan yang terencana, terukur, dan sesuai ketentuan yang berlaku.`;
  return [
    ["I. Latar Belakang", `Pelaksanaan ${activity} pada tahun ${year} perlu direncanakan secara terarah agar kebutuhan, tahapan, dan keluaran kegiatan dapat dipertanggungjawabkan. Kerangka acuan kerja ini disusun sebagai dasar pelaksanaan kegiatan di ${location}. ${amountText}`],
    ["II. Maksud dan Tujuan", purpose],
    ["III. Sasaran", `Sasaran kegiatan adalah terlaksananya ${activity} sesuai kebutuhan unit kerja, dengan penerima manfaat dan target kuantitatif ditetapkan oleh penanggung jawab kegiatan sebelum pelaksanaan.`],
    ["IV. Ruang Lingkup", `Ruang lingkup mencakup persiapan, koordinasi, pelaksanaan, pemantauan, dan penyusunan laporan ${activity}. Rincian volume, komponen teknis, serta akun mengikuti baris kegiatan terpilih dan ketentuan dalam RAB yang telah disetujui.`],
    ["V. Keluaran", `Terselenggaranya ${activity} dan tersedianya dokumentasi serta laporan pelaksanaan yang memuat realisasi keluaran dan penggunaan anggaran.`],
    ["VI. Waktu dan Tempat", `Kegiatan direncanakan pada tahun ${year} di ${location}. Jadwal rinci disusun oleh pelaksana dengan memperhatikan ketersediaan anggaran dan target keluaran.`],
    ["VII. Pembiayaan", `${amountText} ${remaining} Pembiayaan dibebankan pada DIPA/unit kerja yang relevan sesuai akun dan pagu yang disahkan. Seluruh nilai wajib diverifikasi terhadap dokumen RAB final sebelum TOR ditetapkan.`],
    ["VIII. Penutup", `TOR ini merupakan draft awal yang disusun dari data RAB terpilih. Penanggung jawab kegiatan perlu melengkapi indikator, jadwal rinci, dasar hukum, susunan pelaksana, dan persetujuan pejabat berwenang sebelum dokumen digunakan.`],
  ].map(([heading, text]) => ({ heading, text, sheetName: sheet?.name ?? "" }));
}

function generateTor(render = true) {
  if (!state.workbook) {
    showError("Unggah file RAB terlebih dahulu agar draft TOR dapat mengacu pada data.");
    setTab("dashboard");
    return;
  }
  hideError();
  state.generatedSections = makeTorSections();
  const activity = cleanText(byId("activity-input").value) || "Kerangka Acuan Kerja";
  const location = cleanText(byId("location-input").value) || "Lokasi pelaksanaan";
  const year = cleanText(byId("year-input").value);
  byId("tor-document").innerHTML = `
    <div class="tor-doc-kicker">KERANGKA ACUAN KERJA</div>
    <h2 class="tor-doc-title">${escapeHtml(activity)}</h2>
    <table class="tor-doc-meta"><tbody>
      <tr><td>Unit kerja</td><td>Diisi oleh penanggung jawab</td></tr>
      <tr><td>Lokasi</td><td>${escapeHtml(location)}</td></tr>
      <tr><td>Tahun anggaran</td><td>${escapeHtml(year)}</td></tr>
      <tr><td>Sumber data</td><td>${escapeHtml(state.selectedSheet)} · draft demo berbasis aturan lokal</td></tr>
    </tbody></table>
    ${state.generatedSections.map((section) => `<section class="tor-doc-section"><h4>${escapeHtml(section.heading)}</h4><p>${escapeHtml(section.text)}</p></section>`).join("")}
    <div class="tor-doc-signoff">Draft untuk ditinjau dan dilengkapi<br><br><br>Penanggung Jawab Kegiatan</div>`;
  byId("preview-placeholder").classList.add("hidden");
  byId("tor-document").classList.remove("hidden");
  byId("export-tor").disabled = false;
  if (render) setTab("tor");
}

async function downloadTor() {
  if (!state.generatedSections) return;
  const activity = cleanText(byId("activity-input").value) || "Kerangka Acuan Kerja";
  const metadata = [
    ["Unit kerja", "Diisi oleh penanggung jawab"],
    ["Lokasi", cleanText(byId("location-input").value) || "Lokasi pelaksanaan"],
    ["Tahun anggaran", cleanText(byId("year-input").value)],
    ["Sumber data", `${state.selectedSheet} (draft demo berbasis aturan lokal)`],
  ];
  const docxLibrary = window.docx;
  if (!docxLibrary) {
    showError("Komponen pembuat dokumen Word belum berhasil dimuat. Muat ulang halaman dan coba lagi.");
    return;
  }
  const {
    AlignmentType,
    Document,
    Packer,
    Paragraph,
    TextRun,
  } = docxLibrary;
  const docxDocument = new Document({
    creator: "Balmon Surabaya",
    title: `Kerangka Acuan Kerja - ${activity}`,
    subject: "Draft TOR berdasarkan data RAB",
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "KERANGKA ACUAN KERJA", bold: true, size: 28, font: "Arial" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [new TextRun({ text: activity, bold: true, size: 32, font: "Arial" })],
        }),
        ...metadata.map(([label, value]) => new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: `${label}: `, bold: true, font: "Arial", size: 22 }),
            new TextRun({ text: value, font: "Arial", size: 22 }),
          ],
        })),
        new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: "", font: "Arial" })] }),
        ...state.generatedSections.flatMap((section) => [
          new Paragraph({
            heading: "Heading1",
            spacing: { before: 240, after: 100 },
            children: [new TextRun({ text: section.heading, bold: true, color: "123D70", font: "Arial", size: 24 })],
          }),
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 180, line: 300 },
            children: [new TextRun({ text: section.text, font: "Arial", size: 22 })],
          }),
        ]),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 360 },
          children: [new TextRun({ text: "Draft untuk ditinjau dan dilengkapi", italics: true, color: "667789", font: "Arial", size: 20 })],
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 720 },
          children: [new TextRun({ text: "Penanggung Jawab Kegiatan", bold: true, font: "Arial", size: 22 })],
        }),
      ],
    }],
  });

  try {
    const blob = await Packer.toBlob(docxDocument);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `TOR-${activity.toLocaleLowerCase("id").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft"}.docx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showError(`Dokumen Word gagal dibuat: ${error.message}`);
  }
}

function openFilePicker() {
  byId("file-input").value = "";
  byId("file-input").click();
}

if (byId("show-login")) {
byId("show-login").addEventListener("click", () => showAuthPanel("login"));
byId("show-register").addEventListener("click", () => showAuthPanel("register"));
byId("start-camera").addEventListener("click", async () => {
  try {
    verificationCamera = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    const video = byId("verification-camera");
    video.srcObject = verificationCamera;
    await video.play();
    byId("camera-status").textContent = "Kamera siap";
    byId("capture-photo").disabled = false;
  } catch (error) {
    setAuthMessage("register-message", `Kamera tidak dapat dibuka: ${error.message}`);
  }
});
byId("capture-photo").addEventListener("click", () => {
  const video = byId("verification-camera");
  if (!video.videoWidth || !video.videoHeight) {
    setAuthMessage("register-message", "Tunggu sampai kamera siap sebelum mengambil selfie.");
    return;
  }
  const canvas = byId("verification-capture");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  capturedSelfie = true;
  canvas.classList.remove("hidden");
  stopVerificationCamera();
  byId("camera-status").textContent = "Selfie + kartu siap diperiksa";
  byId("capture-photo").textContent = "Ambil ulang";
  setAuthMessage("register-message", "");
});
byId("continue-registration").addEventListener("click", () => {
  const email = byId("register-email");
  const password = byId("register-password");
  if (!email.reportValidity() || !password.reportValidity()) return;
  pendingRegistration = {
    email: email.value.trim().toLocaleLowerCase("id"),
    password: password.value,
  };
  setAuthMessage("register-message", "");
  setRegistrationStep("verification");
});
byId("back-to-credentials").addEventListener("click", () => {
  stopVerificationCamera();
  setAuthMessage("register-message", "");
  setRegistrationStep("credentials");
});
byId("employee-card-photo").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file && !file.type.startsWith("image/")) {
    event.target.value = "";
    setAuthMessage("register-message", "Pilih file gambar untuk foto kartu pegawai.");
    return;
  }
  const filePickerText = document.querySelector(".file-picker span");
  filePickerText.textContent = file?.name ?? "Pilih foto kartu";
  setAuthMessage("register-message", "");
});
byId("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("register-message", "");
  if (!pendingRegistration) {
    setRegistrationStep("credentials");
    return;
  }
  const { email, password } = pendingRegistration;
  const employeeNumber = byId("employee-number").value.replace(/\D/g, "");
  const cardFile = byId("employee-card-photo").files[0];
  if (employeeNumber.length < 5) {
    setAuthMessage("register-message", "Nomor pegawai harus berisi sedikitnya 5 angka.");
    return;
  }
  if (!cardFile || !capturedSelfie) {
    setAuthMessage("register-message", "Pilih foto kartu dan ambil selfie bersama kartu terlebih dahulu.");
    return;
  }
  try {
    if (readDemoAccounts().some((account) => account.email === email)) {
      setAuthMessage("register-message", "Email sudah terdaftar di browser ini. Silakan masuk.");
      return;
    }
    byId("register-submit").disabled = true;
    byId("register-submit").textContent = "Memeriksa di browser...";
    await verifyEmployeeIdentity(email, password, employeeNumber, cardFile);
  } catch (error) {
    setAuthMessage("register-message", error.message);
    byId("camera-status").textContent = "Pemeriksaan belum berhasil";
  } finally {
    byId("register-submit").disabled = false;
    byId("register-submit").textContent = "Verify and Sign Up";
  }
});
byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("login-message", "");
  try {
    const email = byId("login-email").value.trim().toLocaleLowerCase("id");
    const accounts = readDemoAccounts();
    const account = accounts.find((item) => item.email === email);
    if (!account) throw new Error("Akun tidak ditemukan pada browser ini. Daftar terlebih dahulu.");
    const password = await hashPassword(byId("login-password").value, account.salt);
    if (password.digest !== account.digest) throw new Error("Email atau kata sandi tidak cocok.");
    openDashboard(email);
  } catch (error) {
    setAuthMessage("login-message", error.message);
  }
});
byId("logout-button").addEventListener("click", async () => {
  stopVerificationCamera();
  sessionStorage.removeItem(demoSessionKey);
  state.workbook = null;
  state.selectedSheet = null;
  state.currentAnalysis = null;
  state.generatedSections = null;
  state.torSourceRowNumber = null;
  state.torAmountOverride = null;
  state.torRemainingOverride = null;
  byId("dashboard-results").classList.add("hidden");
  byId("dataset-bar").classList.add("hidden");
  byId("upload-panel").classList.remove("hidden");
  byId("file-input").value = "";
  byId("tor-document").innerHTML = "";
  byId("preview-placeholder").classList.remove("hidden");
  byId("export-tor").disabled = true;
  byId("app-shell").classList.add("hidden");
  byId("auth-screen").classList.remove("hidden");
  byId("register-form").reset();
  byId("verification-capture").classList.add("hidden");
  byId("capture-photo").textContent = "Ambil selfie + kartu";
  capturedSelfie = null;
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
  showAuthPanel(readDemoAccounts().length ? "login" : "register");
});

try {
  const sessionEmail = sessionStorage.getItem(demoSessionKey);
  const accounts = readDemoAccounts();
  if (sessionEmail && accounts.some((account) => account.email === sessionEmail)) {
    openDashboard(sessionEmail);
  } else {
    sessionStorage.removeItem(demoSessionKey);
    showAuthPanel(accounts.length ? "login" : "register");
  }
} catch (error) {
  showAuthPanel("register");
  setAuthMessage("register-message", error.message);
}
}

byId("open-upload").addEventListener("click", openFilePicker);
byId("file-input").addEventListener("change", (event) => loadFile(event.target.files[0]));
byId("replace-file").addEventListener("click", openFilePicker);
byId("sheet-select").addEventListener("change", (event) => {
  state.selectedSheet = event.target.value;
  state.generatedSections = null;
  state.torSourceRowNumber = null;
  state.torAmountOverride = null;
  state.torRemainingOverride = null;
  renderDashboard();
});
byId("source-summary").addEventListener("change", (event) => {
  if (event.target.id !== "tor-source-row") return;
  const selectedRow = state.currentAnalysis?.rows.find((row) => row.rowNumber === Number(event.target.value));
  if (!selectedRow) return;
  state.torSourceRowNumber = selectedRow.rowNumber;
  state.torAmountOverride = null;
  state.torRemainingOverride = null;
  const sheet = state.workbook?.sheets.find((item) => item.name === state.selectedSheet);
  if (sheet && state.currentAnalysis) updateTorSource(state.currentAnalysis, sheet);
  byId("activity-input").value = selectedRow.description;
  if (state.generatedSections) generateTor(false);
});
byId("source-summary").addEventListener("input", (event) => {
  if (event.target.id === "tor-source-amount") state.torAmountOverride = event.target.value;
  else if (event.target.id === "tor-source-remaining") state.torRemainingOverride = event.target.value;
  else return;
  updateTorSourceWarning();
  if (state.generatedSections) generateTor(false);
});
byId("source-summary").addEventListener("focusout", (event) => {
  if (!["tor-source-amount", "tor-source-remaining"].includes(event.target.id)) return;
  const value = parseMoneyInput(event.target.value);
  if (value !== null) event.target.value = formatMoney(value);
});
byId("table-search").addEventListener("input", () => {
  if (state.currentAnalysis) renderTableRows(state.currentAnalysis, displayColumns(state.currentAnalysis));
});
byId("generate-tor").addEventListener("click", () => generateTor(true));
byId("export-tor").addEventListener("click", downloadTor);
document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
document.querySelectorAll(".form-stack input, .form-stack textarea").forEach((input) => {
  input.addEventListener("input", () => {
    if (state.generatedSections) generateTor(false);
  });
});

const uploadPanel = byId("upload-panel");
["dragenter", "dragover"].forEach((eventName) => uploadPanel.addEventListener(eventName, (event) => {
  event.preventDefault();
  uploadPanel.classList.add("dragging");
}));
["dragleave", "drop"].forEach((eventName) => uploadPanel.addEventListener(eventName, (event) => {
  event.preventDefault();
  uploadPanel.classList.remove("dragging");
}));
uploadPanel.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
