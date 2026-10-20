(() => {
  const byId = (id) => document.getElementById(id);
  const status = byId("status");
  const camera = byId("camera");
  const capture = byId("capture");
  let stream = null;
  let selfieReady = false;
  let cardFile = null;
  let employeeNumber = "";

  function sendValue(value) {
    window.parent.postMessage({
      isStreamlitMessage: true,
      type: "streamlit:setComponentValue",
      value,
      dataType: "json",
    }, "*");
  }

  function setHeight() {
    window.parent.postMessage({
      isStreamlitMessage: true,
      type: "streamlit:setFrameHeight",
      height: document.documentElement.scrollHeight,
    }, "*");
  }

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = `status ${kind}`;
    setHeight();
  }

  function stopCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    camera.srcObject = null;
  }

  async function startCamera() {
    const captureButton = byId("capture-photo");
    captureButton.disabled = true;
    stopCamera();
    camera.hidden = false;
    capture.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      camera.srcObject = stream;
      await camera.play();
      captureButton.disabled = false;
      setStatus("Kamera siap. Posisikan wajah dan kartu di dalam frame.");
    } catch (error) {
      setStatus(`Kamera tidak dapat dibuka: ${error.message}`, "error");
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Foto kartu tidak dapat dibuka."));
      };
      image.src = url;
    });
  }

  function prepareImage(image, crop = null, binary = false) {
    const width = image.videoWidth || image.naturalWidth || image.width;
    const height = image.videoHeight || image.naturalHeight || image.height;
    const x = crop ? Math.round(crop.x * width) : 0;
    const y = crop ? Math.round(crop.y * height) : 0;
    const sourceWidth = crop ? Math.round(crop.width * width) : width;
    const sourceHeight = crop ? Math.round(crop.height * height) : height;
    const scale = Math.min(3, 2000 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, x, y, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let low = 255;
    let high = 0;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = gray;
      low = Math.min(low, gray);
      high = Math.max(high, gray);
    }
    const span = Math.max(1, high - low);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.max(0, Math.min(255, Math.round(((pixels.data[index] - low) / span) * 255)));
      const value = binary ? (gray > 145 ? 255 : 0) : gray;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  async function descriptor(image, label) {
    const canvas = prepareImage(image);
    const detection = await faceapi
      .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!detection) throw new Error(`Wajah pada ${label} tidak terbaca. Pastikan wajah terlihat jelas.`);
    return detection.descriptor;
  }

  function digits(result) {
    return String(result?.data?.text || "").replace(/\D/g, "");
  }

  async function readNumber(image, worker, label) {
    const candidates = [{ crop: null, binary: false, psm: "11" }, { crop: null, binary: true, psm: "6" }];
    for (const y of [0, 0.2, 0.4]) {
      for (const x of [0, 0.2, 0.4]) {
        const crop = { x, y, width: 0.6, height: 0.6 };
        candidates.push({ crop, binary: false, psm: "11" }, { crop, binary: true, psm: "11" });
      }
    }
    for (const [index, item] of candidates.entries()) {
      setStatus(`Memperjelas nomor pada ${label} (${index + 1}/${candidates.length})...`);
      await worker.setParameters({
        tessedit_pageseg_mode: item.psm,
        tessedit_char_whitelist: "0123456789",
        preserve_interword_spaces: "1",
      });
      const text = digits(await worker.recognize(prepareImage(image, item.crop, item.binary)));
      if (text.includes(employeeNumber)) return true;
    }
    return false;
  }

  async function verify() {
    const button = byId("verify");
    button.disabled = true;
    let worker = null;
    try {
      if (!cardFile || !selfieReady || !employeeNumber) throw new Error("Pilih foto kartu, isi nomor pegawai, dan ambil selfie.");
      setStatus("Memuat model verifikasi lokal...");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("./models/"),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri("./models/"),
        faceapi.nets.faceRecognitionNet.loadFromUri("./models/"),
      ]);
      const cardImage = await loadImage(cardFile);
      setStatus("Mencocokkan wajah pada foto kartu dan selfie...");
      const [cardDescriptor, selfieDescriptor] = await Promise.all([
        descriptor(cardImage, "foto kartu"),
        descriptor(capture, "selfie"),
      ]);
      const distance = faceapi.euclideanDistance(cardDescriptor, selfieDescriptor);
      if (distance > 0.6) throw new Error(`Wajah belum cocok (jarak ${distance.toFixed(2)}; batas 0.60). Coba pencahayaan dan posisi wajah yang lebih serupa.`);

      setStatus("Menyiapkan OCR lokal...");
      worker = await Tesseract.createWorker("eng", 1, {
        workerPath: "./worker.min.js",
        corePath: "./tesseract-core",
        langPath: "./tesseract-data",
        workerBlobURL: false,
        gzip: true,
      });
      const cardMatch = await readNumber(cardImage, worker, "foto kartu");
      if (!cardMatch) throw new Error("Wajah cocok, tetapi nomor pada foto kartu belum terbaca. Ambil foto kartu lebih dekat dan fokus.");
      const selfieMatch = await readNumber(capture, worker, "selfie");
      if (!selfieMatch) throw new Error("Wajah cocok, tetapi nomor kartu pada selfie belum terbaca. Dekatkan kartu ke kamera dan pastikan seluruh nomor terlihat.");

      setStatus("Pemeriksaan awal cocok.", "success");
      sendValue({ verified: true, message: "Pemeriksaan awal cocok." });
    } catch (error) {
      setStatus(error.message || "Pemeriksaan gagal.", "error");
      sendValue({ verified: false, message: error.message || "Pemeriksaan gagal." });
    } finally {
      if (worker) await worker.terminate();
      button.disabled = false;
      setHeight();
    }
  }

  byId("card-file").addEventListener("change", (event) => {
    cardFile = event.target.files?.[0] || null;
    byId("verify").disabled = !(cardFile && selfieReady);
    setStatus(cardFile ? "Foto kartu dipilih. Ambil selfie untuk melanjutkan." : "Pilih foto kartu dan ambil selfie.");
  });
  byId("start-camera").addEventListener("click", startCamera);
  byId("capture-photo").addEventListener("click", async () => {
    if (selfieReady) {
      selfieReady = false;
      byId("verify").disabled = true;
      byId("capture-photo").textContent = "Ambil selfie + kartu";
      await startCamera();
      return;
    }
    if (!camera.videoWidth) {
      setStatus("Tunggu sampai kamera siap.", "error");
      return;
    }
    capture.width = camera.videoWidth;
    capture.height = camera.videoHeight;
    capture.getContext("2d").drawImage(camera, 0, 0, capture.width, capture.height);
    capture.hidden = false;
    camera.hidden = true;
    selfieReady = true;
    stopCamera();
    byId("verify").disabled = !cardFile;
    byId("capture-photo").textContent = "Ambil ulang selfie";
    setStatus("Selfie siap diperiksa.");
  });
  byId("verify").addEventListener("click", verify);

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "streamlit:render") return;
    const nextNumber = String(event.data.args?.employee_number || "").replace(/\D/g, "");
    if (nextNumber !== employeeNumber) {
      employeeNumber = nextNumber;
      cardFile = null;
      selfieReady = false;
      stopCamera();
      byId("card-file").value = "";
      capture.hidden = true;
      camera.hidden = false;
      byId("verify").disabled = true;
      byId("capture-photo").textContent = "Ambil selfie + kartu";
      byId("capture-photo").disabled = true;
      setStatus("Pilih foto kartu dan ambil selfie.");
    }
    setHeight();
  });
  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      window.parent.postMessage({
        isStreamlitMessage: true,
        type: "streamlit:componentReady",
        apiVersion: 1,
      }, "*");
    }, 1000);
  }, { once: true });
})();
