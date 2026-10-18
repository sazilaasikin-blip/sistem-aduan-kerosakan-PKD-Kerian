# Sistem Aduan Kerosakan Aset & Fasiliti — PKD Kerian

Sistem untuk pihak pentadbiran mendaftar, memantau dan mengemas kini aduan kerosakan aset, bangunan dan fasiliti di klinik dan unit PKD Kerian.

- **Frontend:** `index.html` (dihoskan di GitHub Pages)
- **Backend:** `apps-script/Code.gs` (Google Apps Script Web App)
- **Pangkalan data:** Google Sheet (tab `Aduan`, `Log`, `Pengguna`, `Fasiliti`, `Rujukan`, `Tetapan`, `Audit`)

## Peranan pengguna

| Peranan | Lihat aduan | Daftar / kemas kini | Padam aduan | Urus pengguna & tetapan |
|---|---|---|---|---|
| Admin | Semua fasiliti | Semua fasiliti | Ya | Ya |
| Pentadbir fasiliti | Fasiliti sendiri | Fasiliti sendiri | Tidak | Tidak |
| Pemantau | Semua fasiliti | Tidak | Tidak | Tidak |

Semua semakan peranan dan skop fasiliti dibuat di server (Apps Script), bukan di browser.

## Aliran status aduan

`Baru` → `Dirujuk` → `Dalam Tindakan` → `Selesai`  (atau `Dibatalkan`)

Setiap perubahan direkod dalam tab `Log` (siapa, bila, tarikh tindakan, catatan).

---

## Langkah pemasangan

### 1. Sediakan Google Sheet

1. Log masuk ke akaun Google yang akan memiliki sistem ini.
2. Cipta Google Sheet baharu. Namakan, contohnya `DB Aduan Kerosakan PKD Kerian`.
3. **Jangan** guna *File > Share > Publish to web* untuk Sheet ini. Kongsi akses edit Sheet hanya dengan pemilik sistem.

### 2. Pasang kod Apps Script

1. Dalam Sheet: **Extensions > Apps Script**.
2. Padam kod contoh dalam `Code.gs`, tampal seluruh kandungan `apps-script/Code.gs`.
3. Klik ikon gear **Project Settings** > tandakan **Show "appsscript.json" manifest file in editor**.
4. Buka `appsscript.json`, ganti kandungannya dengan `apps-script/appsscript.json` (zon masa Asia/Kuala_Lumpur).
5. Klik **Save**.

### 3. Jalankan setup awal

1. Kembali ke tab Sheet dan muat semula (refresh). Menu **Aduan Kerosakan** akan muncul.
2. Klik **Aduan Kerosakan > Setup awal sistem**.
3. Benarkan akses (Authorize) apabila diminta. Jika muncul amaran "Google hasn't verified this app", klik **Advanced > Go to … (unsafe)**. Ini normal untuk skrip yang anda cipta sendiri.
4. Jalankan menu yang sama sekali lagi jika setup terhenti selepas authorize.
5. **Salin kata laluan sementara admin** yang dipaparkan. Ia tidak dipaparkan semula. Emel admin ialah emel akaun Google yang menjalankan setup.

Setup akan mencipta semua tab, menyembunyikan kolum `Salt` dan `Hash`, dan menjana kunci rahsia (`PEPPER`) dalam Script Properties.

### 4. Deploy sebagai Web App

1. Dalam editor Apps Script: **Deploy > New deployment**.
2. Pilih jenis **Web app**.
3. Tetapkan:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Klik **Deploy**, kemudian salin **Web app URL** (berakhir dengan `/exec`).

"Anyone" diperlukan supaya halaman GitHub boleh berhubung dengan backend. Data tetap dilindungi kerana setiap permintaan memerlukan log masuk dan token sesi yang sah.

### 5. Sambungkan frontend

1. Buka `index.html`, cari baris:
   ```js
   const API_URL = 'TAMPAL_URL_WEB_APP_APPS_SCRIPT_DI_SINI';
   ```
2. Ganti dengan URL `/exec` dari langkah 4. Simpan.

### 6. Publish di GitHub Pages

1. Di github.com: **New repository**, contoh nama `aduan-kerosakan-kerian`.
   - GitHub Pages percuma memerlukan repository **Public**. Kod frontend tidak mengandungi data atau rahsia, jadi ini selamat. Data kekal dalam Google Sheet di sebalik log masuk.
2. **Add file > Upload files**: muat naik `index.html` (folder `apps-script` dan `README.md` boleh dimuat naik sebagai rujukan; tiada rahsia di dalamnya).
3. **Settings > Pages > Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`. Klik **Save**.
4. Selepas 1–2 minit, sistem boleh dibuka di `https://<nama-pengguna-github>.github.io/aduan-kerosakan-kerian/`.

### 7. Konfigurasi pertama dalam sistem

1. Log masuk dengan emel admin dan kata laluan sementara. Tukar kata laluan apabila diminta.
2. Tab **Tetapan**: semak senarai klinik kesihatan dan unit PKD (satu setiap baris), senarai pihak rujukan tindakan, dan had hari lewat (lalai 14 hari). Simpan. Baris `Lain-lain` ialah pilihan khas: apabila dipilih dalam borang, pengguna perlu menyatakan nama fasiliti/unit, dan aduan direkod sebagai `Lain-lain: <nama>`. Buang baris itu jika tidak mahu pilihan ini.
3. Tab **Pengguna**: tambah pengguna. Sistem memaparkan kata laluan sementara sekali sahaja untuk setiap pengguna baharu. Berikan secara terus kepada pengguna berkenaan.

---

## Kemas kini kod selepas ini

- **Backend (`Code.gs`)**: selepas edit, **Deploy > Manage deployments > ikon pensel > Version: New version > Deploy**. URL kekal sama, jadi `index.html` tidak perlu diubah.
- **Frontend (`index.html`)**: muat naik semula ke GitHub. Pages dikemas kini dalam 1–2 minit.

## Ciri keselamatan yang dibina

1. Tiada "Publish to web". Semua data melalui Apps Script.
2. Kata laluan disimpan sebagai hash SHA-256 berulang dengan salt unik setiap pengguna dan pepper rahsia dalam Script Properties.
3. Token sesi rawak, disemak setiap permintaan, tamat selepas 6 jam tanpa aktiviti, dan dipadam di server semasa log keluar. Token disimpan dalam `sessionStorage` (hilang apabila tab ditutup).
4. Peranan, status akaun dan skop fasiliti disemak di server pada setiap permintaan. Akaun yang dinyahaktifkan terus tidak boleh digunakan.
5. Had percubaan log masuk: 8 kali dalam 5 minit bagi setiap emel.
6. Input dibersihkan sebelum ditulis ke Sheet dan CSV (elak formula injection). Paparan menggunakan `textContent` (elak XSS).
7. Tab `Audit` merekod log masuk, pendaftaran, kemas kini, pemadaman dan perubahan pengguna.

## Perkara yang perlu diputuskan atau disemak

- **Akaun Google pemilik.** Sistem ini menyimpan rekod kerajaan dalam Google Sheet. Semak dengan Unit ICT / pegawai keselamatan ICT PKD atau JKN sama ada penggunaan Google Workspace atau akaun Google untuk rekod operasi dibenarkan, dan gunakan akaun milik pejabat (bukan akaun peribadi) supaya sistem tidak hilang apabila pegawai bertukar.
- **Data peribadi** yang disimpan adalah minimum: nama dan emel pengguna, serta nama pegawai yang melaporkan. Jangan masukkan maklumat pesakit dalam keterangan aduan.
- **Tempoh simpanan.** Cadangan: simpan aduan aktif dalam Sheet, eksport CSV dan arkibkan aduan yang selesai melebihi 2 tahun. Sahkan tempoh mengikut keperluan rekod jabatan.
- **Backup.** Buat salinan Sheet secara berkala (File > Make a copy) atau bergantung pada Version history.
- **Set semula kata laluan** tidak menamatkan sesi yang sedang aktif bagi pengguna itu. Jika akaun disyaki digunakan orang lain, nyahaktifkan akaun dahulu (berkuat kuasa serta-merta), kemudian aktifkan semula selepas set semula kata laluan.

## Had teknikal

- Sesuai untuk beberapa ribu aduan. Data dimuatkan sekali gus semasa log masuk dan butang **Muat semula**.
- Apps Script mempunyai kuota harian dan had pelaksanaan serentak. Untuk penggunaan oleh pentadbiran 10 klinik kesihatan dan unit PKD, ini mencukupi.
- Kategori dan jenis kerosakan ditakrifkan dalam kod (`KATEGORI` dalam `Code.gs` dan `index.html`). Jika diubah, ubah kedua-dua fail.
