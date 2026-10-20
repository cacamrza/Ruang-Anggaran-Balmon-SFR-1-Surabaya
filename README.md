# Ruang-Anggaran-Balmon-SFR-1-Surabaya

## Ruang Anggaran — Dashboard RAB & Generator TOR

Demo aplikasi berbasis Streamlit untuk membaca RAB, menampilkan ringkasan dan grafik, membandingkan perubahan anggaran, serta membuat draft TOR dalam format Word.

## Jalankan demo Streamlit

Gunakan Python 3.9 atau lebih baru:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Buka alamat lokal yang ditampilkan Streamlit (biasanya `http://localhost:8501`). Untuk menjalankan aplikasi lama berbasis Express, gunakan `npm install` lalu `npm start`; versi Streamlit tidak membutuhkan server Express.

## Fitur

- Aplikasi dibuka langsung tanpa login atau signup. Siapa pun yang memiliki alamat aplikasi dapat menggunakan dashboard dan fitur unggah.
- Unggah Excel (`.xlsx`, `.xls`, `.xlsm`), CSV, Word (`.docx`), atau PDF berbasis teks hingga 20 MB. PDF hasil pindai perlu OCR terlebih dahulu. Format Word `.doc` lama belum didukung pada versi Streamlit.
- Unggah bersama PDF **Rincian Kertas Kerja Satker** dan **Laporan FA Detail** untuk memasangkan kode RO. Dashboard membaca seluruh hierarki Rincian Kertas Kerja—Program, Kegiatan, KRO, RO, Komponen, Subkomponen, Akun, dan Detil—serta menampilkan induk setiap baris. Pilih satu tingkat hierarki untuk grafik agar pagu induk dan anak tidak dijumlahkan ganda. Pagu penuh dan pagu terblokir diambil dari Rincian Kertas Kerja (baris detil bertanda `*`), sedangkan pagu efektif, realisasi kumulatif, dan sisa dari Laporan FA dipasangkan pada tingkat RO. Baris yang tidak punya pasangan tetap ditampilkan dengan statusnya.
- Preprocessing memilih header uraian dan kolom anggaran, membersihkan baris kosong/tidak bernilai, serta menampilkan baris hasil olahan.
- Grafik batang horizontal untuk membandingkan pagu dan sisa per kategori, komposisi pagu, temuan otomatis, dan pemeriksaan rincian `Semula` → `Menjadi`, termasuk kecukupan `Sisa Anggaran` terhadap `Selisih`.
- Generator TOR berbasis aturan lokal; untuk pasangan PDF, pilih kode RO dan masukkan ke metadata TOR bersama ringkasan pagu/realisasi. Dokumen Word menggunakan format A4, Times New Roman 11, spasi 1,5, paragraf rata kiri-kanan, dan heading biru tua. Hasilnya draft yang perlu ditinjau.
- Logo dan palet warna Balmon, DJID, serta Komdigi.

## Deploy untuk demo

Jika aplikasi dideploy ke internet, dashboard ini dapat diakses siapa saja karena tidak ada autentikasi. Jangan unggah atau gunakan data anggaran/dokumen yang bersifat rahasia. Untuk akses terbatas, lindungi aplikasi menggunakan autentikasi atau kontrol akses di lapisan hosting sebelum dipublikasikan.

## Batasan privasi dan keamanan

File RAB yang diunggah diproses oleh server Streamlit dan tidak sengaja disimpan ke disk atau dikirim ke layanan AI eksternal. Karena aplikasi tidak memiliki autentikasi, data dashboard dan fitur unggah tersedia bagi siapa saja yang dapat membuka aplikasi. Jangan gunakan untuk melindungi data rahasia atau memublikasikan dokumen internal. Analisis dan isi TOR dibuat dengan aturan lokal, bukan AI eksternal. Periksa kembali perhitungan, dasar hukum, keluaran, jadwal, dan persetujuan sebelum penggunaan resmi.
