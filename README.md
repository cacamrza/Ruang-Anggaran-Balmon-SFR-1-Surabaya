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
- Unggah Excel, CSV, Word, atau PDF untuk menganalisis hierarki kode yang terbaca, termasuk format kode Program seperti `059.09.WA`. Untuk format Rincian Kertas Kerja dan Laporan FA Detail, aplikasi membaca Program, Kegiatan, KRO, RO, Komponen, Subkomponen, akun/Detil, dan Rincian item. Pemilih grafik dan kartu menyediakan opsi **Semua level** atau tingkat tertentu; angka diambil dari baris pada level tersebut tanpa menjumlahkan induk dan anak sekaligus. Nilai yang tidak tersedia atau belum memiliki pasangan tidak dihitung, sedangkan pagu penuh induk bernilai nol diturunkan dari rincian anak yang tersedia. PDF Laporan FA Detail dapat mengisi pagu efektif, realisasi, dan sisa sampai tingkat item.
- Preprocessing memilih header uraian dan kolom anggaran, membersihkan baris kosong/tidak bernilai, serta menampilkan baris hasil olahan.
- Grafik batang horizontal untuk membandingkan pagu dan sisa per kategori, komposisi pagu, temuan otomatis, dan pemeriksaan perubahan Excel `Semula` → `Menjadi` di seluruh hierarki. Dashboard menampilkan pagu awal, pagu setelah revisi, selisih bersih, dan total kenaikan pada baris perubahan tingkat terendah agar nilai induk dan anak tidak dihitung ganda. Jika PDF Laporan FA Detail turut diunggah, aplikasi mencocokkan sisa FA dengan selisih pada tiap baris, menampilkan sisa setelah kenaikan, dan menandai dana cukup, tidak cukup, atau belum ditemukan. Sisa dinilai cukup hanya jika lebih besar dari selisih; tabel tetap menampilkan rincian perubahan tiap level.
- Generator TOR memakai dokumen `[Template] TOR_...docx` sebagai berkas dasar agar tata letak, font, tabel, warna, dan isi template tetap dipertahankan. Pilih kode RO; metadata Program, Kegiatan, KRO, dan RO serta biaya yang diperlukan diisi dari dashboard. Bagian Penerima Manfaat, Strategi Pencapaian Keluaran, Kurun Waktu, KPI Output, KPI Outcome, Analisis Biaya dan Manfaat, serta Manajemen Risiko dapat disesuaikan sebelum dokumen diunduh. Template Word harus disertakan di folder aplikasi saat deploy.
- Logo dan palet warna Balmon, DJID, serta Komdigi.

## Deploy untuk demo

Jika aplikasi dideploy ke internet, dashboard ini dapat diakses siapa saja karena tidak ada autentikasi. Jangan unggah atau gunakan data anggaran/dokumen yang bersifat rahasia. Untuk akses terbatas, lindungi aplikasi menggunakan autentikasi atau kontrol akses di lapisan hosting sebelum dipublikasikan.

## Batasan privasi dan keamanan

File RAB yang diunggah diproses oleh server Streamlit dan tidak sengaja disimpan ke disk atau dikirim ke layanan AI eksternal. Karena aplikasi tidak memiliki autentikasi, data dashboard dan fitur unggah tersedia bagi siapa saja yang dapat membuka aplikasi. Jangan gunakan untuk melindungi data rahasia atau memublikasikan dokumen internal. Analisis dan isi TOR dibuat dengan aturan lokal, bukan AI eksternal. Periksa kembali perhitungan, dasar hukum, keluaran, jadwal, dan persetujuan sebelum penggunaan resmi.
