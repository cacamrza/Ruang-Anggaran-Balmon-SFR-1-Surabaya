# Ruang Anggaran — Dashboard RAB & Generator TOR

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
- Signup dibatasi ke rentang jaringan internal Balmon `192.168.100.0/24` (dari IP `192.168.100.192` dan subnet mask `255.255.255.0` yang diberikan). Browser tidak mengizinkan aplikasi web membaca nama Wi-Fi/SSID, jadi nama jaringan seperti `BALMON LT2 01-5G` tidak bisa dibedakan langsung oleh aplikasi. Jaringan tamu hanya tertolak jika memakai rentang IP yang berbeda; pastikan dengan admin jaringan bahwa `BALMON LOBBY TAMU` bukan pada `192.168.100.0/24`. Rentang dapat diganti melalui `SIGNUP_ALLOWED_CIDRS`. Login akun yang sudah ada tetap tersedia dari jaringan mana pun.
- Unggah Excel (`.xlsx`, `.xls`, `.xlsm`), CSV, Word (`.docx`), atau PDF berbasis teks hingga 20 MB. PDF hasil pindai perlu OCR terlebih dahulu. Format Word `.doc` lama belum didukung pada versi Streamlit.
- Unggah bersama PDF **Rincian Kertas Kerja Satker** dan **Laporan FA Detail** untuk memasangkan kode RO. Dashboard mengambil pagu penuh dan pagu terblokir dari Rincian Kertas Kerja (baris `Jumlah Biaya` bertanda `*`), serta pagu efektif, realisasi kumulatif, dan sisa dari Laporan FA. Baris yang tidak punya pasangan tetap ditampilkan dengan statusnya.
- Preprocessing memilih header uraian dan kolom anggaran, membersihkan baris kosong/tidak bernilai, serta menampilkan baris hasil olahan.
- Grafik batang horizontal untuk membandingkan pagu dan sisa per kategori, komposisi pagu, temuan otomatis, dan pemeriksaan rincian `Semula` → `Menjadi`, termasuk kecukupan `Sisa Anggaran` terhadap `Selisih`.
- Generator TOR berbasis aturan lokal; untuk pasangan PDF, pilih kode RO dan masukkan ke metadata TOR bersama ringkasan pagu/realisasi. Dokumen Word menggunakan format A4, Times New Roman 11, spasi 1,5, paragraf rata kiri-kanan, dan heading biru tua. Hasilnya draft yang perlu ditinjau.
- Logo dan palet warna Balmon, DJID, serta Komdigi.

## Deploy untuk demo

Untuk menjalankan di jaringan kantor, jalankan Streamlit pada komputer kantor dan biarkan `SIGNUP_ALLOWED_CIDRS` memakai default `192.168.100.0/24`, atau set variabel tersebut jika rentang internal berubah. Streamlit Cloud di internet tidak dapat melihat IP privat tersebut; pada hosting lain, atur rentang CIDR publik/jaringan yang benar-benar dilihat server serta proxy tepercaya. SSID kantor dan SSID tamu harus berada di rentang jaringan berbeda agar pengecualian jaringan tamu dapat ditegakkan.

## Batasan privasi dan keamanan

File RAB diunggah ke proses server Streamlit untuk diparsing dan tidak sengaja disimpan ke disk atau dikirim ke layanan AI eksternal. Akun demo disimpan dalam SQLite lokal di server, terpisah dari session browser, sehingga pengguna dapat menutup browser dan login kembali. Pada hosting dengan penyimpanan sementara seperti Streamlit Community Cloud, akun tetap ada selama file database tersedia, tetapi dapat hilang saat server dibuat ulang atau aplikasi dipindah/redeploy; untuk penyimpanan akun yang tahan restart gunakan database persisten terkelola. Pembatasan signup mengandalkan alamat IP/CIDR, bukan SSID; bila Wi-Fi tamu berbagi subnet dengan Wi-Fi internal atau jaringan memakai VPN/proxy, pembatasan IP tidak dapat menjamin SSID yang digunakan. Ini bukan sistem autentikasi atau akses pegawai sungguhan. Jangan gunakan aplikasi demo untuk melindungi data rahasia atau memublikasikan dokumen internal. Analisis dan isi TOR dibuat dengan aturan lokal, bukan AI eksternal. Periksa kembali perhitungan, dasar hukum, keluaran, jadwal, dan persetujuan sebelum penggunaan resmi.
