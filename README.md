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

- Login dan signup hanya menggunakan email dan kata sandi; pemeriksaan kartu, selfie, dan OCR tidak digunakan. Akun dan hash kata sandi disimpan di SQLite lokal; akun yang sudah dibuat tetap dapat dipakai login dari jaringan mana pun.
- Pendaftaran akun hanya diizinkan dari alamat IP/jaringan yang ditentukan admin; login akun yang sudah tersimpan tersedia dari jaringan mana pun. Aplikasi web tidak dapat membaca nama Wi-Fi/SSID seperti `BALMON LT2 01-5G`. Karena itu pembatasan menggunakan IP jaringan kantor, bukan nama Wi-Fi; pastikan jaringan tamu memiliki alamat/rentang IP publik yang berbeda agar dapat ditolak.
- Unggah Excel (`.xlsx`, `.xls`, `.xlsm`), CSV, Word (`.docx`), atau PDF berbasis teks hingga 20 MB. PDF hasil pindai perlu OCR terlebih dahulu. Format Word `.doc` lama belum didukung pada versi Streamlit.
- Unggah bersama PDF **Rincian Kertas Kerja Satker** dan **Laporan FA Detail** untuk memasangkan kode RO. Dashboard mengambil pagu penuh dan pagu terblokir dari Rincian Kertas Kerja (baris `Jumlah Biaya` bertanda `*`), serta pagu efektif, realisasi kumulatif, dan sisa dari Laporan FA. Baris yang tidak punya pasangan tetap ditampilkan dengan statusnya.
- Preprocessing memilih header uraian dan kolom anggaran, membersihkan baris kosong/tidak bernilai, serta menampilkan baris hasil olahan.
- Grafik batang horizontal untuk membandingkan pagu dan sisa per kategori, komposisi pagu, temuan otomatis, dan pemeriksaan rincian `Semula` → `Menjadi`, termasuk kecukupan `Sisa Anggaran` terhadap `Selisih`.
- Generator TOR berbasis aturan lokal; untuk pasangan PDF, pilih kode RO dan masukkan ke metadata TOR bersama ringkasan pagu/realisasi. Dokumen Word menggunakan format A4, Times New Roman 11, spasi 1,5, paragraf rata kiri-kanan, dan heading biru tua. Hasilnya draft yang perlu ditinjau.
- Logo dan palet warna Balmon, DJID, serta Komdigi.

## Deploy untuk demo

Untuk menjalankan di jaringan kantor, jalankan Streamlit pada komputer kantor dan biarkan `SIGNUP_ALLOWED_CIDRS` memakai default `192.168.100.0/24`, atau set variabel tersebut jika rentang internal berubah. Pada Streamlit Community Cloud atau hosting publik, atur `SIGNUP_ALLOWED_CIDRS` di App Settings → Secrets ke IP publik kantor (biasanya dengan akhiran `/32`) atau rentang IP publik kantor. IP privat `192.168.100.0/24` tidak terlihat oleh aplikasi di internet setelah koneksi melewati NAT. Variabel lingkungan `SIGNUP_ALLOWED_CIDRS` mengesampingkan Streamlit Secrets; jika keduanya tidak diatur, aplikasi memakai default jaringan kantor. Jika alamat IP pengunjung tidak tersedia dari sesi/proxy, pendaftaran ditolak—aplikasi tidak menggunakan alamat jaringan server sebagai pengganti. Pastikan Wi-Fi kantor dan tamu tidak berbagi alamat IP publik jika pendaftaran dari Wi-Fi tamu harus ditolak.

## Batasan privasi dan keamanan

File RAB diunggah ke proses server Streamlit untuk diparsing dan tidak sengaja disimpan ke disk atau dikirim ke layanan AI eksternal. Akun dan hash kata sandinya disimpan dalam SQLite lokal di server, terpisah dari session browser, sehingga pengguna dapat logout atau menutup browser lalu login kembali selama file database masih tersedia. Penyimpanan lokal pada hosting sementara seperti Streamlit Community Cloud dapat hilang ketika server dibuat ulang atau aplikasi dipindah/redeploy; untuk menjamin akun tetap tersedia setelah restart/redeploy, gunakan database persisten terkelola. Pembatasan pendaftaran mengandalkan alamat IP/CIDR, bukan SSID; bila Wi-Fi tamu berbagi IP publik dengan jaringan internal atau jaringan memakai VPN/proxy, pembatasan IP tidak dapat memastikan SSID yang digunakan. Ini bukan sistem autentikasi atau akses pegawai sungguhan. Jangan gunakan aplikasi demo untuk melindungi data rahasia atau memublikasikan dokumen internal. Analisis dan isi TOR dibuat dengan aturan lokal, bukan AI eksternal. Periksa kembali perhitungan, dasar hukum, keluaran, jadwal, dan persetujuan sebelum penggunaan resmi.
