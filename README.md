# Sistem Aduan Kerosakan Aset & Fasiliti — PKD Kerian

Sistem untuk pihak pentadbiran mendaftar, memantau dan mengemas kini aduan kerosakan aset, bangunan dan fasiliti di klinik dan unit PKD Kerian.

- **Frontend:** `index.html` + `app.js` (dihoskan di GitHub Pages)
- **Backend:** `apps-script/Code.gs` (Google Apps Script Web App)
- **Pangkalan data:** Google Sheet (tab `Aduan`, `Log`, `Pengguna`, `Fasiliti`, `KlinikDesa`, `Lokasi`, `Rujukan`, `Tetapan`, `Audit`)

## Peranan pengguna

| Peranan | Lihat aduan | Daftar / kemas kini | Padam aduan | Urus pengguna & tetapan |
|---|---|---|---|---|
| Admin | Semua fasiliti | Semua fasiliti | Ya | Ya |
| Pentadbir fasiliti | Fasiliti sendiri dan klinik desa di bawahnya | Fasiliti sendiri dan klinik desa di bawahnya | Tidak | Tidak |
| Pemantau | Semua fasiliti | Tidak | Tidak | Tidak |

Semua semakan peranan dan skop fasiliti dibuat di server (Apps Script), bukan di browser.

## Kategori aset dan KEW.PA-10

Setiap aduan ditanda **Aset Alih** atau **Aset Tak Alih** (dipilih automatik ikut kategori kerosakan, boleh ditukar).

- **Aset alih** mengikut KEW.PA-10 (Tatacara Pengurusan Aset Alih Kerajaan, Pekeliling Perbendaharaan AM 2.4):
  - Bahagian I diisi semasa daftar: jenis aset, no. siri pendaftaran aset/komponen, pengguna terakhir, tarikh kerosakan, perihal kerosakan, nama dan jawatan pengadu.
  - Bahagian II (Pegawai Aset/Pegawai Teknikal) dan Bahagian III (keputusan Ketua Jabatan) diisi oleh **admin** dalam butiran aduan.
  - Butang **Cetak KEW.PA-10** menjana borang berisi untuk ditandatangan. Semak susunan Bahagian III dengan borang rasmi yang digunakan di PKD.
  - Selepas pembaikan, rekod penyelenggaraan harta modal masih perlu dibuat dalam KEW.PA-15 mengikut tatacara sedia ada.
- **Aset tak alih** (bangunan dan struktur) tidak menggunakan KEW.PA-10. Tindakan direkod melalui kemas kini status.

Dalam tab `Aduan`, lajur `B2_*` ialah Bahagian II dan `B3_*` ialah Bahagian III. Lokasi kerosakan dipilih daripada tab `Lokasi` (boleh diedit di tab Tetapan); pilihan `Lain-lain` memerlukan perincian lokasi.

## Semakan status oleh pengadu

Pengadu tidak perlu akaun.

1. Semasa mendaftar aduan, isi **Emel pengadu**. Sistem terus menghantar emel pengesahan yang mengandungi No. aduan, butiran ringkas dan butang **Semak status aduan**.
2. Pengadu semak status dengan klik butang dalam emel, atau buka sistem, pilih **Semak status aduan** dan masukkan **No. aduan + emel mereka**.
3. Pengadu yang tiada emel: dalam butiran aduan, klik **Salin mesej untuk pengadu** (mengandungi No. aduan, kod semakan 6 aksara dan pautan) dan hantar melalui WhatsApp. Kod semakan boleh digunakan di tempat emel.
4. Jika pengadu tidak menerima emel, buka butiran aduan, betulkan alamat emel jika perlu dan klik **Hantar semula emel**.

Paparan pengadu hanya menunjukkan status, fasiliti, lokasi, jenis kerosakan, tarikh, keputusan KEW.PA-10 dan sejarah status. Nama pegawai, emel dan catatan dalaman tidak dipaparkan.

Nota emel:
- Emel dihantar melalui `MailApp` atas nama akaun yang membuat deployment Web App. Kali pertama selepas kemas kini kod, jalankan **Aduan Kerosakan > Setup awal sistem** supaya Google meminta kebenaran menghantar emel.
- Had harian penghantaran emel bergantung pada jenis akaun Google. Jika had dicapai, aduan tetap disimpan dan emel boleh dihantar semula keesokan hari.

Had keselamatan: 10 cubaan salah bagi setiap No. aduan dalam 10 minit. Jika kod semakan terdedah, klik **Jana kod baharu** dan kod lama terus tidak sah.

## Aliran status aduan

`Baru` → `Dirujuk` → `Dalam Tindakan` → `Selesai`  (atau `Dibatalkan`)

Setiap perubahan direkod dalam tab `Log` (siapa, bila, tarikh tindakan, catatan).

---

## Langkah pemasangan

### 1. Sediakan Google Sheet

1. Log masuk ke akaun Google yang akan memiliki sistem ini.
2. Cipta Google Sheet baharu. Namakan, contohnya `DB Aduan Kerosakan PKD Kerian`.
3. **Jangan** guna *File > Share > Publish to web* untuk Sheet ini, dan pastikan *General access* ialah **Restricted**. Jangan letak Sheet dalam folder yang dikongsi "Anyone with the link" kerana perkongsian folder diwarisi oleh Sheet. Kongsi akses edit hanya dengan pemilik sistem: editor Sheet boleh membuka Apps Script dan membaca kunci rahsia.

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

1. Buka `app.js`, cari baris:
   ```js
   const API_URL = 'TAMPAL_URL_WEB_APP_APPS_SCRIPT_DI_SINI';
   ```
2. Ganti dengan URL `/exec` dari langkah 4. Simpan.
3. Jangan pindahkan kod ke dalam `index.html`. Polisi keselamatan (CSP) dalam `index.html` hanya membenarkan skrip daripada fail `app.js` dalam repo yang sama.

### 6. Publish di GitHub Pages

1. Di github.com: **New repository**, contoh nama `aduan-kerosakan-kerian`.
   - GitHub Pages percuma memerlukan repository **Public**. Kod frontend tidak mengandungi data atau rahsia, jadi ini selamat. Data kekal dalam Google Sheet di sebalik log masuk.
2. **Add file > Upload files**: muat naik `index.html` dan `app.js` (folder `apps-script` dan `README.md` boleh dimuat naik sebagai rujukan; tiada rahsia di dalamnya).
3. **Settings > Pages > Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`. Klik **Save**.
4. Selepas 1–2 minit, sistem boleh dibuka di `https://<nama-pengguna-github>.github.io/aduan-kerosakan-kerian/`.

### 7. Konfigurasi pertama dalam sistem

1. Log masuk dengan emel admin dan kata laluan sementara. Tukar kata laluan apabila diminta.
2. Tab **Tetapan**: semak senarai klinik kesihatan dan unit PKD (satu setiap baris), senarai pihak rujukan tindakan, dan had hari lewat (lalai 14 hari). Simpan. Baris `Klinik Desa` dan `Lain-lain` ialah pilihan khas. `Klinik Desa` membuka dropdown klinik desa yang beroperasi (diurus dalam ruangan *Klinik desa yang beroperasi*, format `Nama klinik desa | KK induk`), dan aduan direkod dengan nama klinik desa itu. `Lain-lain` membuka ruangan teks, dan aduan direkod sebagai `Lain-lain: <nama>`. Kedua-dua pilihan ini tidak boleh dijadikan fasiliti untuk akaun pentadbir fasiliti. Pentadbir fasiliti secara automatik boleh mendaftar dan melihat aduan klinik desa yang KK induknya ialah fasiliti mereka. Apabila klinik desa ditutup, buang barisnya dari senarai; aduan lama kekal.
3. Tab **Pengguna**: tambah pengguna. Sistem memaparkan kata laluan sementara sekali sahaja untuk setiap pengguna baharu. Berikan secara terus kepada pengguna berkenaan.

---

## Kemas kini kod selepas ini

- **Backend (`Code.gs`)**: selepas edit, jalankan **Aduan Kerosakan > Setup awal sistem** sekali (menambah lajur atau tab baharu tanpa mengubah data lama), kemudian **Deploy > Manage deployments > ikon pensel > Version: New version > Deploy**. URL kekal sama, jadi `index.html` tidak perlu diubah.
- **Frontend (`index.html`, `app.js`)**: muat naik semula ke GitHub. Pages dikemas kini dalam 1–2 minit.

## Ciri keselamatan yang dibina

1. Tiada "Publish to web". Semua data melalui Apps Script.
2. Kata laluan disimpan sebagai hash SHA-256 berulang dengan salt unik setiap pengguna dan pepper rahsia dalam Script Properties.
3. Token sesi rawak, disemak setiap permintaan, tamat selepas 6 jam tanpa aktiviti, dan dipadam di server semasa log keluar. Token disimpan dalam `sessionStorage` (hilang apabila tab ditutup). Tukar atau set semula kata laluan menamatkan semua sesi lain pengguna itu serta-merta.
4. Peranan, status akaun dan skop fasiliti disemak di server pada setiap permintaan. Akaun yang dinyahaktifkan terus tidak boleh digunakan.
5. Had percubaan log masuk: 8 kali dalam 5 minit bagi setiap emel.
6. Input dibersihkan sebelum ditulis ke Sheet dan CSV (elak formula injection). Paparan menggunakan `textContent` (elak XSS).
7. Content-Security-Policy dalam `index.html`: skrip hanya dimuatkan dari `app.js`, dan data hanya boleh dihantar ke Apps Script.
8. Tab `Audit` merekod log masuk, pendaftaran, kemas kini, pemadaman dan perubahan pengguna.

## Perkara yang perlu diputuskan atau disemak

- **Akaun Google pemilik.** Sistem ini menyimpan rekod kerajaan dalam Google Sheet. Semak dengan Unit ICT / pegawai keselamatan ICT PKD atau JKN sama ada penggunaan Google Workspace atau akaun Google untuk rekod operasi dibenarkan, dan gunakan akaun milik pejabat (bukan akaun peribadi) supaya sistem tidak hilang apabila pegawai bertukar.
- **Data peribadi** yang disimpan adalah minimum: nama dan emel pengguna, serta nama pegawai yang melaporkan. Jangan masukkan maklumat pesakit dalam keterangan aduan.
- **Tempoh simpanan.** Cadangan: simpan aduan aktif dalam Sheet, eksport CSV dan arkibkan aduan yang selesai melebihi 2 tahun. Sahkan tempoh mengikut keperluan rekod jabatan.
- **Backup.** Buat salinan Sheet secara berkala (File > Make a copy) atau bergantung pada Version history.

## Had teknikal

- Sesuai untuk beberapa ribu aduan. Data dimuatkan sekali gus semasa log masuk dan butang **Muat semula**.
- Apps Script mempunyai kuota harian dan had pelaksanaan serentak. Untuk penggunaan oleh pentadbiran 10 klinik kesihatan dan unit PKD, ini mencukupi.
- Kategori dan jenis kerosakan ditakrifkan dalam kod (`KATEGORI` dalam `Code.gs` dan `index.html`). Jika diubah, ubah kedua-dua fail.
