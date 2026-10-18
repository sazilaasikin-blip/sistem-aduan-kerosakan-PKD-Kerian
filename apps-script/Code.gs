/**
 * SISTEM ADUAN KEROSAKAN ASET & FASILITI — PKD KERIAN
 * Backend: Google Apps Script (Web App) + Google Sheets
 *
 * Fail ini mesti dipasang sebagai skrip TERIKAT (container-bound) pada Google Sheet
 * pangkalan data: buka Sheet > Extensions > Apps Script > tampal kod ini.
 *
 * Prinsip keselamatan:
 *  - Sheet TIDAK di-"Publish to web". Semua baca/tulis melalui doPost di bawah.
 *  - Kata laluan disimpan sebagai hash SHA-256 (salt unik setiap pengguna + pepper rahsia
 *    dalam Script Properties). Tiada kata laluan teks biasa.
 *  - Setiap permintaan (kecuali login) mesti membawa token sesi; token disemak setiap kali.
 *  - Peranan dan skop fasiliti disemak di server, bukan di browser.
 *  - Input dibersihkan sebelum ditulis ke Sheet (elak formula injection).
 */

const TZ = 'Asia/Kuala_Lumpur';
const SESI_SAAT = 6 * 60 * 60;          // sesi tamat selepas 6 jam tanpa aktiviti (had CacheService)
const HASH_ULANG = 300;                 // bilangan pusingan hash
const LOGIN_MAKS = 8;                   // percubaan login maksimum ...
const LOGIN_TEMPOH_SAAT = 300;          // ... dalam 5 minit
const SEMAK_MAKS = 10;                  // semakan status awam maksimum setiap no. aduan ...
const SEMAK_TEMPOH_SAAT = 600;          // ... dalam 10 minit
const SEMAK_GLOBAL_MAKS = 300;          // had keseluruhan semakan awam dalam 10 minit

const SH = { ADUAN: 'Aduan', LOG: 'Log', PENGGUNA: 'Pengguna', FASILITI: 'Fasiliti', KD: 'KlinikDesa', LOKASI: 'Lokasi', RUJUKAN: 'Rujukan', TETAPAN: 'Tetapan', AUDIT: 'Audit' };
const HEAD = {
  // Susunan lajur mengikut KEW.PA-10: Bahagian I (pengadu), B2_ = Bahagian II (Pegawai Aset/Teknikal), B3_ = Bahagian III (Ketua Jabatan)
  Aduan: ['NoAduan', 'KodSemakan', 'TarikhDiterima', 'Status', 'Keutamaan', 'FasilitiPengadu', 'Lokasi', 'LokasiPerincian', 'KategoriKod', 'Kategori',
    'JenisKerosakan', 'KategoriAset', 'JenisAset', 'NoAset', 'PenggunaTerakhir', 'TarikhKerosakan', 'Keterangan', 'DilaporkanOleh',
    'EmelPengadu', 'EmelDihantar', 'DirujukKepada', 'TarikhSelesai', 'B2_KosTerdahuluRM', 'B2_AnggaranKosRM', 'B2_SyorUlasan', 'B2_NamaJawatan', 'B2_Tarikh',
    'B3_Keputusan', 'B3_Ulasan', 'B3_NamaJawatan', 'B3_Tarikh', 'DidaftarOleh', 'DidaftarPada', 'DikemaskiniOleh', 'DikemaskiniPada'],
  Log: ['NoAduan', 'Masa', 'TarikhTindakan', 'Status', 'DirujukKepada', 'Catatan', 'Oleh'],
  Pengguna: ['Email', 'Nama', 'Peranan', 'Fasiliti', 'Aktif', 'Salt', 'Hash', 'TukarKataLaluan', 'DiciptaPada', 'LogMasukTerakhir'],
  Fasiliti: ['Nama'],
  KlinikDesa: ['Nama', 'KKInduk'],
  Lokasi: ['Nama'],
  Rujukan: ['Nama'],
  Tetapan: ['Kunci', 'Nilai'],
  Audit: ['Masa', 'Email', 'Tindakan', 'Butiran']
};

const KATEGORI = {
  '1': { nama: 'Kerosakan Bangunan dan Fasiliti', jenis: ['Bumbung dan siling', 'Dinding dan lantai', 'Pintu dan tingkap', 'Tandas', 'Paip, saliran, tangki air dan kebocoran', 'Pendawaian, lampu, soket dan suis', 'Pendingin hawa, kipas dan pengudaraan', 'Longkang, pagar, laluan dan parkir', 'Ruang menunggu dan struktur luar bangunan'] },
  '2': { nama: 'Aset dan Peralatan Bukan Klinikal', jenis: ['Perabot (meja, kerusi, kabinet, rak)', 'Mesin fotostat dan projektor', 'Telefon, sistem PA dan CCTV', 'Peti sejuk (bukan vaksin) dan dispenser air', 'Mesin nombor giliran', 'Peralatan pejabat lain'] },
  '3': { nama: 'Aset dan Peralatan Klinikal', jenis: ['Katil pemeriksaan, troli, kerusi roda, stretcher', 'Timbangan, BP set, nebulizer, glucometer', 'Peralatan pergigian', 'Peralatan makmal', 'Peralatan farmasi', 'Peti sejuk vaksin / cold chain', 'Peralatan klinikal lain'] },
  '4': { nama: 'ICT dan Sistem Berkaitan Aset', jenis: ['Komputer atau laptop', 'Monitor, papan kekunci, tetikus', 'UPS', 'Pencetak atau pengimbas', 'Rangkaian Internet / LAN', 'Sistem aplikasi tidak boleh diakses (akibat peralatan/rangkaian fasiliti)', 'Peralatan ICT lain'] },
  '5': { nama: 'Lain-lain Kerosakan Aset atau Fasiliti', jenis: ['Lain-lain'] }
};
const JENIS_COLD = 'Peti sejuk vaksin / cold chain';
const STATUS = ['Baru', 'Dirujuk', 'Dalam Tindakan', 'Selesai', 'Dibatalkan'];
const KEUTAMAAN = ['Kritikal', 'Tinggi', 'Biasa'];
const PERANAN = ['admin', 'pentadbir', 'pemantau'];
// Pilihan khas dalam senarai fasiliti:
//  - 'Klinik Desa': pengguna pilih KD dari tab KlinikDesa; aduan direkod dengan nama KD itu
//  - 'Lain-lain'  : pengguna taip nama; direkod sebagai "Lain-lain: <nama>"
const PILIHAN_KD = 'Klinik Desa';
const PILIHAN_LAIN = 'Lain-lain';
const PILIHAN_KHAS = [PILIHAN_KD, PILIHAN_LAIN];
// Kategori aset (dokumentasi): aset alih menggunakan KEW.PA-10
const ASET_ALIH = 'Aset Alih';
const ASET_TAK_ALIH = 'Aset Tak Alih';
const KEPUTUSAN_KJ = ['Diluluskan', 'Tidak Diluluskan'];
const LOKASI_LAIN = 'Lain-lain';
const LOKASI_ASAL = ['Kaunter pendaftaran', 'Ruang menunggu', 'Bilik rawatan / prosedur', 'Bilik doktor / konsultasi',
  'Bilik KKIA (ibu dan anak)', 'Bilik imunisasi / vaksin', 'Bilik kecemasan / rawatan segera', 'Farmasi / stor ubat', 'Makmal',
  'Klinik pergigian', 'Bilik X-ray / pengimejan', 'Tandas awam', 'Tandas kakitangan', 'Pejabat / bilik pentadbiran',
  'Bilik mesyuarat / latihan', 'Stor am', 'Surau', 'Pantri', 'Kawasan luar (laluan, parkir, pagar, longkang)',
  'Bumbung / struktur bangunan', LOKASI_LAIN];

/* =========================================================
 * PINTU MASUK WEB APP
 * ========================================================= */

function doGet() {
  return ContentService.createTextOutput('API Aduan Kerosakan PKD Kerian aktif.').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ ok: false, code: 'BAD_REQUEST', error: 'Permintaan tidak sah.' });
  }
  try {
    const hasil = route_(body || {});
    return out_(Object.assign({ ok: true }, hasil));
  } catch (err) {
    if (err && err.isApp) return out_({ ok: false, code: err.code, error: err.message });
    console.error(err && err.stack ? err.stack : err);
    return out_({ ok: false, code: 'SERVER', error: 'Ralat pelayan. Cuba lagi sebentar.' });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function appErr_(code, msg) {
  const e = new Error(msg);
  e.code = code;
  e.isApp = true;
  return e;
}

function route_(b) {
  const action = String(b.action || '');
  if (action === 'login') return login_(b);
  if (action === 'semak') return semak_(b);   // semakan status oleh pengadu: tanpa log masuk, perlu no. aduan + kod semakan

  const s = requireAuth_(b.token);
  if (s.tukar && ['tukarKataLaluan', 'logout', 'saya'].indexOf(action) === -1) {
    throw appErr_('PASSWORD_CHANGE', 'Sila tukar kata laluan sementara anda dahulu.');
  }

  switch (action) {
    case 'saya': return { user: awam_(s) };
    case 'logout': return logout_(b.token, s);
    case 'tukarKataLaluan': return tukarKataLaluan_(s, b, b.token);
    case 'muat': return muat_(s);
    case 'butiran': return butiran_(s, b);
    case 'daftar': perlu_(s, ['admin', 'pentadbir']); return daftar_(s, b.data || {});
    case 'kemaskini': perlu_(s, ['admin', 'pentadbir']); return kemaskini_(s, b.data || {});
    case 'kewpa': perlu_(s, ['admin']); return kewpa_(s, b.data || {});
    case 'janaKod': perlu_(s, ['admin', 'pentadbir']); return janaKod_(s, b);
    case 'hantarEmel': perlu_(s, ['admin', 'pentadbir']); return hantarEmelSemula_(s, b);
    case 'padam': perlu_(s, ['admin']); return padam_(s, b);
    case 'simpanTetapan': perlu_(s, ['admin']); return simpanTetapan_(s, b.data || {});
    case 'senaraiPengguna': perlu_(s, ['admin']); return { pengguna: senaraiPengguna_() };
    case 'simpanPengguna': perlu_(s, ['admin']); return simpanPengguna_(s, b.data || {});
    case 'setSemula': perlu_(s, ['admin']); return setSemula_(s, b);
    default: throw appErr_('BAD_REQUEST', 'Tindakan tidak dikenali.');
  }
}

/* =========================================================
 * SHEET HELPERS
 * ========================================================= */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw appErr_('NOT_SETUP', 'Sistem belum disediakan. Jalankan setup() dahulu.');
  return sh;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (v === true || v === false) return v;
  return v == null ? '' : String(v);
}

/** Baca jadual: pulangkan senarai objek {_row, Header: nilai} */
function table_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i].every(function (c) { return c === '' || c === null; })) continue;
    const o = { _row: i + 1 };
    head.forEach(function (h, j) { o[h] = cell_(values[i][j]); });
    rows.push(o);
  }
  return { sh: sh, head: head, rows: rows };
}

/** Neutralkan nilai yang boleh dibaca sebagai formula oleh Sheets/Excel */
function safe_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function rowFrom_(head, obj) {
  return head.map(function (h) {
    const v = obj[h];
    if (v === true || v === false) return v;
    return safe_(v);
  });
}

/** Tambah satu rekod mengikut susunan header sebenar dalam sheet */
function tambahBaris_(name, rec) {
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(rowFrom_(head, rec));
}

function wang_(v, label) {
  if (v === '' || v == null) return '';
  const n = Number(String(v).replace(/,/g, ''));
  if (!isFinite(n) || n < 0 || n > 100000000) throw appErr_('VALIDATION', label + ' mesti nombor RM yang sah.');
  return n.toFixed(2);
}

function nowIso_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function teks_(v, maks, label, wajib) {
  const s = String(v == null ? '' : v).replace(/\u0000/g, '').trim();
  if (wajib && !s) throw appErr_('VALIDATION', label + ' wajib diisi.');
  if (s.length > maks) throw appErr_('VALIDATION', label + ' terlalu panjang (maksimum ' + maks + ' aksara).');
  return s;
}

function tarikh_(v, label) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw appErr_('VALIDATION', label + ' tidak sah.');
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw appErr_('VALIDATION', label + ' tidak sah.');
  if (s > today_()) throw appErr_('VALIDATION', label + ' tidak boleh melebihi hari ini.');
  return s;
}

function audit_(email, tindakan, butiran) {
  try {
    sheet_(SH.AUDIT).appendRow([nowIso_(), safe_(email), safe_(tindakan), safe_(butiran || '')]);
  } catch (e) { console.error('Audit gagal: ' + e); }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw appErr_('BUSY', 'Sistem sedang sibuk. Cuba lagi sebentar.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =========================================================
 * KATA LALUAN & SESI
 * ========================================================= */

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function hash_(password, salt) {
  const pepper = prop_('PEPPER');
  if (!pepper) throw appErr_('NOT_SETUP', 'Sistem belum disediakan. Jalankan setup() dahulu.');
  let h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password + '|' + pepper, Utilities.Charset.UTF_8);
  for (let i = 0; i < HASH_ULANG; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hex_(h) + salt, Utilities.Charset.UTF_8);
  }
  return hex_(h);
}

function samaRata_(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function saltBaru_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }

function kataLaluanSementara_() {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  let s = '';
  for (let i = 0; i < 12; i++) s += abjad.charAt(((bytes[i] + 256) % 256) % abjad.length);
  return s.slice(0, 6) + '-' + s.slice(6);
}

/** Kod semakan 6 aksara tanpa aksara mengelirukan (0/O, 1/I/L) */
function kodSemakanBaru_() {
  const abjad = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  let s = '';
  for (let i = 0; i < 6; i++) s += abjad.charAt(((bytes[i] + 256) % 256) % abjad.length);
  return s;
}

function semakPolisi_(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw appErr_('VALIDATION', 'Kata laluan mesti sekurang-kurangnya 10 aksara.');
  if (pw.length > 128) throw appErr_('VALIDATION', 'Kata laluan terlalu panjang.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw appErr_('VALIDATION', 'Kata laluan mesti mengandungi huruf dan nombor.');
}

function cariPengguna_(email) {
  const t = table_(SH.PENGGUNA);
  const e = String(email || '').trim().toLowerCase();
  const u = t.rows.find(function (r) { return String(r.Email).trim().toLowerCase() === e; });
  return { t: t, u: u };
}

function login_(b) {
  const email = String(b.email || '').trim().toLowerCase();
  const pw = String(b.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !pw) throw appErr_('LOGIN_FAILED', 'Emel atau kata laluan salah.');

  const cache = CacheService.getScriptCache();
  const kunci = 'login_' + email;
  const cubaan = Number(cache.get(kunci) || 0);
  if (cubaan >= LOGIN_MAKS) throw appErr_('RATE_LIMIT', 'Terlalu banyak percubaan. Cuba lagi selepas 5 minit.');
  cache.put(kunci, String(cubaan + 1), LOGIN_TEMPOH_SAAT);

  const r = cariPengguna_(email);
  const u = r.u;
  if (!u || !bool_(u.Aktif) || !u.Salt || !u.Hash || !samaRata_(hash_(pw, u.Salt), u.Hash)) {
    audit_(email, 'LOGIN_GAGAL', '');
    throw appErr_('LOGIN_FAILED', 'Emel atau kata laluan salah.');
  }
  cache.remove(kunci);

  const token = Utilities.getUuid();
  cache.put('sesi_' + token, JSON.stringify({ email: email, cap: capKataLaluan_(u.Hash) }), SESI_SAAT);
  const col = r.t.head.indexOf('LogMasukTerakhir') + 1;
  r.t.sh.getRange(u._row, col).setValue(nowIso_());
  audit_(email, 'LOGIN', '');
  return { token: token, user: awam_(sesiDari_(u)) };
}

function sesiDari_(u) {
  return {
    email: String(u.Email).trim().toLowerCase(),
    nama: u.Nama,
    peranan: String(u.Peranan).trim().toLowerCase(),
    fasiliti: u.Fasiliti,
    tukar: bool_(u.TukarKataLaluan)
  };
}

function awam_(s) {
  return { email: s.email, nama: s.nama, peranan: s.peranan, fasiliti: s.fasiliti, tukarKataLaluan: s.tukar };
}

/** Cap ringkas hash semasa: jika kata laluan ditukar atau diset semula, cap berubah dan semua sesi lama terbatal */
function capKataLaluan_(hash) { return String(hash || '').slice(0, 16); }

function requireAuth_(token) {
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(token))) throw appErr_('UNAUTHORIZED', 'Sesi tamat. Sila log masuk semula.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sesi_' + token);
  if (!raw) throw appErr_('UNAUTHORIZED', 'Sesi tamat. Sila log masuk semula.');
  const sesi = JSON.parse(raw);
  // Semak semula akaun setiap permintaan: akaun dinyahaktifkan atau tukar peranan berkuat kuasa serta-merta
  const u = cariPengguna_(sesi.email).u;
  if (!u || !bool_(u.Aktif) || PERANAN.indexOf(String(u.Peranan).trim().toLowerCase()) === -1) {
    cache.remove('sesi_' + token);
    throw appErr_('UNAUTHORIZED', 'Akaun tidak aktif. Hubungi pentadbir sistem.');
  }
  if (!sesi.cap || sesi.cap !== capKataLaluan_(u.Hash)) {
    cache.remove('sesi_' + token);
    throw appErr_('UNAUTHORIZED', 'Kata laluan akaun ini telah ditukar. Sila log masuk semula.');
  }
  cache.put('sesi_' + token, raw, SESI_SAAT); // lanjutkan sesi (idle timeout)
  return sesiDari_(u);
}

function perlu_(s, peranan) {
  if (peranan.indexOf(s.peranan) === -1) throw appErr_('FORBIDDEN', 'Anda tidak mempunyai kebenaran untuk tindakan ini.');
}

function logout_(token, s) {
  CacheService.getScriptCache().remove('sesi_' + token);
  audit_(s.email, 'LOGOUT', '');
  return {};
}

function tukarKataLaluan_(s, b, token) {
  const lama = String(b.lama || ''), baru = String(b.baru || '');
  semakPolisi_(baru);
  if (lama === baru) throw appErr_('VALIDATION', 'Kata laluan baharu mesti berbeza daripada yang lama.');
  return withLock_(function () {
    const r = cariPengguna_(s.email);
    if (!r.u || !samaRata_(hash_(lama, r.u.Salt), r.u.Hash)) throw appErr_('VALIDATION', 'Kata laluan semasa tidak betul.');
    const salt = saltBaru_();
    const hashBaru = hash_(baru, salt);
    const h = r.t.head;
    r.t.sh.getRange(r.u._row, h.indexOf('Salt') + 1).setValue(salt);
    r.t.sh.getRange(r.u._row, h.indexOf('Hash') + 1).setValue(hashBaru);
    r.t.sh.getRange(r.u._row, h.indexOf('TukarKataLaluan') + 1).setValue(false);
    // Sesi lain (peranti lain) terbatal; sesi semasa dikekalkan dengan cap baharu
    CacheService.getScriptCache().put('sesi_' + token, JSON.stringify({ email: s.email, cap: capKataLaluan_(hashBaru) }), SESI_SAAT);
    audit_(s.email, 'TUKAR_KATA_LALUAN', 'Sesi lain ditamatkan');
    s.tukar = false;
    return { user: awam_(s) };
  });
}

/* =========================================================
 * DATA ADUAN
 * ========================================================= */

/** Peta nama KD -> KK induk */
function petaKd_(kd) {
  const m = {};
  (kd || tetapan_().klinikDesa).forEach(function (k) { m[k.nama] = k.induk; });
  return m;
}

/** Pentadbir fasiliti nampak fasiliti sendiri dan klinik desa di bawahnya */
function dalamSkop_(s, fasiliti, peta) {
  if (s.peranan !== 'pentadbir') return true;
  const f = String(fasiliti);
  return f === String(s.fasiliti) || (peta || petaKd_())[f] === String(s.fasiliti);
}

function aduanAwam_(r) {
  return {
    noAduan: r.NoAduan, kodSemakan: r.KodSemakan, tarikh: r.TarikhDiterima, fasiliti: r.FasilitiPengadu, lokasi: r.Lokasi, lokasiPerincian: r.LokasiPerincian,
    kategoriKod: String(r.KategoriKod), kategori: r.Kategori, jenis: r.JenisKerosakan,
    kategoriAset: r.KategoriAset, jenisAset: r.JenisAset, noAset: r.NoAset, penggunaTerakhir: r.PenggunaTerakhir,
    tarikhKerosakan: r.TarikhKerosakan, keterangan: r.Keterangan, keutamaan: r.Keutamaan, pelapor: r.DilaporkanOleh,
    emelPengadu: r.EmelPengadu, emelDihantar: r.EmelDihantar,
    status: r.Status, dirujukKepada: r.DirujukKepada, tarikhSelesai: r.TarikhSelesai,
    b2: { kosTerdahulu: r.B2_KosTerdahuluRM, anggaranKos: r.B2_AnggaranKosRM, syor: r.B2_SyorUlasan, namaJawatan: r.B2_NamaJawatan, tarikh: r.B2_Tarikh },
    b3: { keputusan: r.B3_Keputusan, ulasan: r.B3_Ulasan, namaJawatan: r.B3_NamaJawatan, tarikh: r.B3_Tarikh },
    didaftarPada: r.DidaftarPada, dikemaskiniPada: r.DikemaskiniPada
  };
}

function tetapan_() {
  const fasiliti = table_(SH.FASILITI).rows.map(function (r) { return r.Nama; }).filter(String);
  const rujukan = table_(SH.RUJUKAN).rows.map(function (r) { return r.Nama; }).filter(String);
  const klinikDesa = table_(SH.KD).rows
    .filter(function (r) { return r.Nama; })
    .map(function (r) { return { nama: r.Nama, induk: r.KKInduk }; });
  const lokasi = table_(SH.LOKASI).rows.map(function (r) { return r.Nama; }).filter(String);
  const t = table_(SH.TETAPAN).rows;
  const had = Number((t.find(function (r) { return r.Kunci === 'HadHari'; }) || {}).Nilai) || 14;
  return { fasiliti: fasiliti, klinikDesa: klinikDesa, lokasi: lokasi, rujukan: rujukan, hadHari: had };
}

function muat_(s) {
  const tet = tetapan_();
  const peta = petaKd_(tet.klinikDesa);
  const aduan = table_(SH.ADUAN).rows
    .filter(function (r) { return r.NoAduan && dalamSkop_(s, r.FasilitiPengadu, peta); })
    .map(aduanAwam_)
    .sort(function (a, b) { return String(b.didaftarPada).localeCompare(String(a.didaftarPada)); });
  return { user: awam_(s), tetapan: tet, aduan: aduan, kategori: KATEGORI };
}

function cariAduan_(no) {
  const t = table_(SH.ADUAN);
  const a = t.rows.find(function (r) { return r.NoAduan === String(no || ''); });
  return { t: t, a: a };
}

function butiran_(s, b) {
  const r = cariAduan_(b.noAduan);
  if (!r.a || !dalamSkop_(s, r.a.FasilitiPengadu)) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
  const nama = {};
  table_(SH.PENGGUNA).rows.forEach(function (u) { nama[String(u.Email).toLowerCase()] = u.Nama; });
  const log = table_(SH.LOG).rows
    .filter(function (l) { return l.NoAduan === r.a.NoAduan; })
    .map(function (l) {
      return { masa: l.Masa, tarikh: l.TarikhTindakan, status: l.Status, dirujuk: l.DirujukKepada, catatan: l.Catatan, oleh: nama[String(l.Oleh).toLowerCase()] || l.Oleh };
    })
    .sort(function (x, y) { return String(y.masa).localeCompare(String(x.masa)); });
  return { aduan: aduanAwam_(r.a), log: log };
}

function daftar_(s, d) {
  const tarikh = tarikh_(d.tarikh, 'Tarikh aduan diterima');
  const tet = tetapan_();
  let fasiliti = teks_(d.fasiliti, 100, 'Fasiliti', true);
  if (tet.fasiliti.indexOf(fasiliti) === -1) throw appErr_('VALIDATION', 'Fasiliti tidak ada dalam senarai.');
  if (fasiliti === PILIHAN_KD) {
    const kd = String(d.klinikDesa || '');
    if (!tet.klinikDesa.some(function (k) { return k.nama === kd; })) throw appErr_('VALIDATION', 'Pilih klinik desa daripada senarai.');
    fasiliti = kd;
  } else if (fasiliti === PILIHAN_LAIN) {
    fasiliti = PILIHAN_LAIN + ': ' + teks_(d.fasilitiLain, 80, 'Nama fasiliti / unit (Lain-lain)', true);
  }
  if (!dalamSkop_(s, fasiliti, petaKd_(tet.klinikDesa))) {
    throw appErr_('FORBIDDEN', 'Anda hanya boleh mendaftar aduan untuk ' + s.fasiliti + ' dan klinik desa di bawahnya.');
  }
  const lokasi = teks_(d.lokasi, 100, 'Lokasi kerosakan', true);
  if (tet.lokasi.indexOf(lokasi) === -1) throw appErr_('VALIDATION', 'Pilih lokasi kerosakan daripada senarai.');
  const lokasiPerincian = teks_(d.lokasiPerincian, 120, 'Perincian lokasi', lokasi === LOKASI_LAIN);
  const tarikhKerosakan = tarikh_(d.tarikhKerosakan, 'Tarikh kerosakan');
  if (tarikhKerosakan > tarikh) throw appErr_('VALIDATION', 'Tarikh kerosakan tidak boleh selepas tarikh aduan diterima.');
  const kod = String(d.kategoriKod || '');
  const kat = KATEGORI[kod];
  if (!kat) throw appErr_('VALIDATION', 'Kategori tidak sah.');
  const jenis = kod === '5' ? 'Lain-lain' : String(d.jenis || '');
  if (kat.jenis.indexOf(jenis) === -1) throw appErr_('VALIDATION', 'Jenis kerosakan tidak sah.');
  const keterangan = teks_(d.keterangan, 1500, 'Keterangan', true);
  const min = kod === '5' ? 40 : 15;
  if (keterangan.length < min) throw appErr_('VALIDATION', 'Keterangan terlalu ringkas (minimum ' + min + ' aksara).');
  let keutamaan = String(d.keutamaan || '');
  if (KEUTAMAAN.indexOf(keutamaan) === -1) throw appErr_('VALIDATION', 'Tahap keutamaan tidak sah.');
  if (jenis === JENIS_COLD) keutamaan = 'Kritikal';
  const kategoriAset = String(d.kategoriAset || '');
  if ([ASET_ALIH, ASET_TAK_ALIH].indexOf(kategoriAset) === -1) throw appErr_('VALIDATION', 'Pilih kategori aset: aset alih atau aset tak alih.');
  const alih = kategoriAset === ASET_ALIH;
  const jenisAset = alih ? teks_(d.jenisAset, 100, 'Jenis aset', true) : '';
  const noAset = alih ? teks_(d.noAset, 60, 'No. siri pendaftaran aset', true) : teks_(d.noAset, 60, 'No. aset', false);
  const penggunaTerakhir = alih ? teks_(d.penggunaTerakhir, 80, 'Pengguna terakhir', false) : '';
  const pelapor = teks_(d.pelapor, 100, 'Nama dan jawatan pengadu', true);
  const emelPengadu = emel_(d.emelPengadu);

  return withLock_(function () {
    const tahun = tarikh.slice(0, 4);
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('SEQ_' + tahun) || 0) + 1;
    props.setProperty('SEQ_' + tahun, String(seq));
    const no = 'KRN-' + tahun + '-' + ('0000' + seq).slice(-4);
    const masa = nowIso_();
    const kod = kodSemakanBaru_();
    const rec = {
      NoAduan: no, KodSemakan: kod, TarikhDiterima: tarikh, Status: 'Baru', Keutamaan: keutamaan, FasilitiPengadu: fasiliti,
      Lokasi: lokasi, LokasiPerincian: lokasiPerincian, KategoriKod: kod, Kategori: kat.nama, JenisKerosakan: jenis,
      KategoriAset: kategoriAset, JenisAset: jenisAset, NoAset: noAset, PenggunaTerakhir: penggunaTerakhir,
      TarikhKerosakan: tarikhKerosakan, Keterangan: keterangan, DilaporkanOleh: pelapor, EmelPengadu: emelPengadu, EmelDihantar: '',
      DirujukKepada: '', TarikhSelesai: '',
      DidaftarOleh: s.email, DidaftarPada: masa, DikemaskiniOleh: s.email, DikemaskiniPada: masa
    };
    tambahBaris_(SH.ADUAN, rec);
    tambahBaris_(SH.LOG, { NoAduan: no, Masa: masa, TarikhTindakan: tarikh, Status: 'Baru', DirujukKepada: '', Catatan: 'Aduan didaftarkan' + (alih ? ' (aset alih, KEW.PA-10)' : ''), Oleh: s.email });
    audit_(s.email, 'DAFTAR_ADUAN', no);
    const hasil = { noAduan: no, kodSemakan: kod, emel: 'tiada' };
    if (emelPengadu) {
      const e = hantarEmel_(rec, d.pautanAsas);
      hasil.emel = e.ok ? 'dihantar' : 'gagal';
      if (!e.ok) hasil.emelRalat = e.ralat;
      else catatEmelDihantar_(no);
    }
    return hasil;
  });
}

/* ---------- Emel kepada pengadu ---------- */
function emel_(v) {
  const e = String(v == null ? '' : v).trim().toLowerCase();
  if (!e) return '';
  if (e.length > 120 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e)) throw appErr_('VALIDATION', 'Emel pengadu tidak sah.');
  return e;
}

/** Pautan sistem untuk emel: hanya halaman GitHub Pages (elak pautan ke laman lain) */
function pautanSah_(p) {
  const u = String(p || '').trim();
  return /^https:\/\/[a-z0-9-]+\.github\.io(\/[A-Za-z0-9._-]+)?\/?$/.test(u) ? u.replace(/\/?$/, '/') : '';
}

function fmtTarikh_(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function escHtml_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

/** Hantar emel pengesahan aduan. Tidak membatalkan pendaftaran jika gagal. */
function hantarEmel_(a, pautanAsas) {
  try {
    const asas = pautanSah_(pautanAsas);
    const pautan = asas ? asas + '?no=' + encodeURIComponent(a.NoAduan) + '&kod=' + encodeURIComponent(a.KodSemakan) : '';
    const baris = [
      ['No. aduan', a.NoAduan], ['Tarikh diterima', fmtTarikh_(a.TarikhDiterima)], ['Fasiliti', a.FasilitiPengadu],
      ['Lokasi', [a.Lokasi, a.LokasiPerincian].filter(String).join(' · ')],
      ['Kerosakan', a.JenisAset || a.JenisKerosakan], ['Status semasa', a.Status || 'Baru']
    ];
    const teks = ['Salam sejahtera,', '',
      'Aduan kerosakan anda telah direkodkan dalam Sistem Aduan Kerosakan Aset & Fasiliti PKD Kerian.', '']
      .concat(baris.map(function (b) { return b[0] + ': ' + b[1]; }))
      .concat(['', pautan ? 'Semak status aduan: ' + pautan : '',
        asas ? 'Atau buka ' + asas + ', pilih "Semak status aduan" dan masukkan No. aduan berserta emel ini.' : 'Untuk menyemak status, hubungi pentadbir fasiliti anda dengan menyatakan No. aduan di atas.',
        '', 'Emel ini dijana secara automatik. Untuk pertanyaan, hubungi pentadbir fasiliti anda.'])
      .join('\n');
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#16262a;line-height:1.5">' +
      '<p>Salam sejahtera,</p><p>Aduan kerosakan anda telah direkodkan dalam <b>Sistem Aduan Kerosakan Aset &amp; Fasiliti PKD Kerian</b>.</p>' +
      '<table style="border-collapse:collapse;margin:8px 0 14px">' +
      baris.map(function (b) { return '<tr><td style="padding:4px 14px 4px 0;color:#56686c">' + escHtml_(b[0]) + '</td><td style="padding:4px 0"><b>' + escHtml_(b[1]) + '</b></td></tr>'; }).join('') +
      '</table>' +
      (pautan ? '<p><a href="' + escHtml_(pautan) + '" style="display:inline-block;background:#0d6a62;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Semak status aduan</a></p>' +
        '<p style="font-size:13px;color:#56686c">Atau buka ' + escHtml_(asas) + ', pilih "Semak status aduan" dan masukkan No. aduan berserta emel ini.</p>'
        : '<p>Untuk menyemak status, hubungi pentadbir fasiliti anda dengan menyatakan No. aduan di atas.</p>') +
      '<p style="font-size:12px;color:#56686c">Emel ini dijana secara automatik. Untuk pertanyaan, hubungi pentadbir fasiliti anda.</p></div>';
    MailApp.sendEmail({ to: a.EmelPengadu, subject: 'Aduan kerosakan direkodkan: ' + a.NoAduan, body: teks, htmlBody: html, name: 'Sistem Aduan Kerosakan PKD Kerian' });
    return { ok: true };
  } catch (e) {
    console.error('Emel gagal: ' + e);
    const kuota = /limit|quota|too many/i.test(String(e));
    return { ok: false, ralat: kuota ? 'Had harian penghantaran emel telah dicapai. Cuba hantar semula esok.' : 'Emel tidak dapat dihantar. Semak alamat emel dan cuba hantar semula.' };
  }
}

function catatEmelDihantar_(no) {
  const r = cariAduan_(no);
  const i = r.t.head.indexOf('EmelDihantar');
  if (r.a && i !== -1) r.t.sh.getRange(r.a._row, i + 1).setValue(nowIso_());
}

/** Hantar semula emel (boleh tukar alamat emel pengadu sekali) */
function hantarEmelSemula_(s, b) {
  const emelBaru = emel_(b.emel);
  if (!emelBaru) throw appErr_('VALIDATION', 'Masukkan emel pengadu.');
  return withLock_(function () {
    const r = cariAduan_(b.noAduan);
    if (!r.a || !dalamSkop_(s, r.a.FasilitiPengadu)) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
    const iE = r.t.head.indexOf('EmelPengadu');
    if (iE === -1) throw appErr_('NOT_SETUP', 'Lajur EmelPengadu tiada dalam sheet Aduan. Jalankan Setup awal sistem sekali lagi.');
    if (emelBaru !== r.a.EmelPengadu) r.t.sh.getRange(r.a._row, iE + 1).setValue(safe_(emelBaru));
    const rec = Object.assign({}, r.a, { EmelPengadu: emelBaru });
    if (!rec.KodSemakan) {
      rec.KodSemakan = kodSemakanBaru_();
      r.t.sh.getRange(r.a._row, r.t.head.indexOf('KodSemakan') + 1).setValue(rec.KodSemakan);
    }
    const e = hantarEmel_(rec, b.pautanAsas);
    if (!e.ok) throw appErr_('EMEL_GAGAL', e.ralat);
    catatEmelDihantar_(r.a.NoAduan);
    audit_(s.email, 'HANTAR_EMEL_PENGADU', r.a.NoAduan);
    return { emel: emelBaru };
  });
}

function kemaskini_(s, d) {
  const status = String(d.status || '');
  if (STATUS.indexOf(status) === -1) throw appErr_('VALIDATION', 'Status tidak sah.');
  const tarikh = tarikh_(d.tarikh, 'Tarikh tindakan');
  const rujuk = teks_(d.dirujukKepada, 100, 'Dirujuk kepada', false);
  const catatan = teks_(d.catatan, 800, 'Catatan', false);
  if ((status === 'Selesai' || status === 'Dibatalkan') && !catatan) throw appErr_('VALIDATION', 'Tambah catatan untuk status ' + status + '.');
  if (status === 'Dirujuk' && !rujuk) throw appErr_('VALIDATION', 'Nyatakan pihak yang menerima rujukan.');

  return withLock_(function () {
    const r = cariAduan_(d.noAduan);
    if (!r.a || !dalamSkop_(s, r.a.FasilitiPengadu)) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
    if (tarikh < r.a.TarikhDiterima) throw appErr_('VALIDATION', 'Tarikh tindakan tidak boleh sebelum tarikh aduan diterima.');
    if (status === r.a.Status && rujuk === r.a.DirujukKepada && !catatan) throw appErr_('VALIDATION', 'Tiada perubahan untuk disimpan.');
    const h = r.t.head, row = r.a._row, masa = nowIso_();
    const set = function (col, v) { r.t.sh.getRange(row, h.indexOf(col) + 1).setValue(safe_(v)); };
    set('Status', status);
    set('DirujukKepada', rujuk);
    set('TarikhSelesai', status === 'Selesai' ? tarikh : '');
    set('DikemaskiniOleh', s.email);
    set('DikemaskiniPada', masa);
    tambahBaris_(SH.LOG, {
      NoAduan: r.a.NoAduan, Masa: masa, TarikhTindakan: tarikh, Status: status,
      DirujukKepada: rujuk !== r.a.DirujukKepada ? rujuk : '', Catatan: catatan, Oleh: s.email
    });
    audit_(s.email, 'KEMASKINI_ADUAN', r.a.NoAduan + ' → ' + status);
    return {};
  });
}

/** KEW.PA-10 Bahagian II (Pegawai Aset/Teknikal) dan Bahagian III (Ketua Jabatan) — admin sahaja */
function kewpa_(s, d) {
  const b2 = {
    B2_KosTerdahuluRM: wang_(d.kosTerdahulu, 'Jumlah kos penyelenggaraan terdahulu'),
    B2_AnggaranKosRM: wang_(d.anggaranKos, 'Anggaran kos penyelenggaraan'),
    B2_SyorUlasan: teks_(d.syor, 800, 'Syor dan ulasan', false),
    B2_NamaJawatan: teks_(d.b2Nama, 100, 'Nama dan jawatan (Bahagian II)', false),
    B2_Tarikh: d.b2Tarikh ? tarikh_(d.b2Tarikh, 'Tarikh Bahagian II') : ''
  };
  const adaB2 = b2.B2_KosTerdahuluRM !== '' || b2.B2_AnggaranKosRM !== '' || b2.B2_SyorUlasan || b2.B2_NamaJawatan || b2.B2_Tarikh;
  if (adaB2 && (!b2.B2_NamaJawatan || !b2.B2_Tarikh)) throw appErr_('VALIDATION', 'Bahagian II: isi nama dan jawatan serta tarikh.');
  const keputusan = String(d.keputusan || '');
  if (keputusan && KEPUTUSAN_KJ.indexOf(keputusan) === -1) throw appErr_('VALIDATION', 'Keputusan Ketua Jabatan tidak sah.');
  const b3 = {
    B3_Keputusan: keputusan,
    B3_Ulasan: teks_(d.ulasanKJ, 500, 'Ulasan Ketua Jabatan', false),
    B3_NamaJawatan: teks_(d.b3Nama, 100, 'Nama dan jawatan (Bahagian III)', !!keputusan),
    B3_Tarikh: keputusan ? tarikh_(d.b3Tarikh, 'Tarikh Bahagian III') : ''
  };
  if (keputusan && !adaB2) throw appErr_('VALIDATION', 'Lengkapkan Bahagian II sebelum merekod keputusan Ketua Jabatan.');

  return withLock_(function () {
    const r = cariAduan_(d.noAduan);
    if (!r.a) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
    if (r.a.KategoriAset !== ASET_ALIH) throw appErr_('VALIDATION', 'KEW.PA-10 hanya untuk aduan aset alih.');
    if (b2.B2_Tarikh && b2.B2_Tarikh < r.a.TarikhDiterima) throw appErr_('VALIDATION', 'Tarikh Bahagian II tidak boleh sebelum tarikh aduan diterima.');
    if (b3.B3_Tarikh && b3.B3_Tarikh < b2.B2_Tarikh) throw appErr_('VALIDATION', 'Tarikh Bahagian III tidak boleh sebelum tarikh Bahagian II.');
    const h = r.t.head, row = r.a._row, masa = nowIso_();
    const semua = Object.assign({}, b2, b3, { DikemaskiniOleh: s.email, DikemaskiniPada: masa });
    Object.keys(semua).forEach(function (col) {
      const i = h.indexOf(col);
      if (i === -1) throw appErr_('NOT_SETUP', 'Lajur ' + col + ' tiada dalam sheet Aduan. Jalankan Setup awal sistem sekali lagi.');
      r.t.sh.getRange(row, i + 1).setValue(safe_(semua[col]));
    });
    const nota = [];
    if (adaB2 && (r.a.B2_NamaJawatan !== b2.B2_NamaJawatan || r.a.B2_AnggaranKosRM !== b2.B2_AnggaranKosRM || r.a.B2_SyorUlasan !== b2.B2_SyorUlasan || r.a.B2_KosTerdahuluRM !== b2.B2_KosTerdahuluRM || r.a.B2_Tarikh !== b2.B2_Tarikh)) {
      nota.push('KEW.PA-10 Bahagian II dikemas kini' + (b2.B2_AnggaranKosRM ? ' (anggaran RM' + b2.B2_AnggaranKosRM + ')' : ''));
    }
    if (keputusan && (r.a.B3_Keputusan !== keputusan || r.a.B3_Tarikh !== b3.B3_Tarikh)) nota.push('KEW.PA-10 Bahagian III: ' + keputusan);
    if (!keputusan && r.a.B3_Keputusan) nota.push('KEW.PA-10 Bahagian III dikosongkan');
    if (nota.length) {
      tambahBaris_(SH.LOG, { NoAduan: r.a.NoAduan, Masa: masa, TarikhTindakan: b3.B3_Tarikh || b2.B2_Tarikh || today_(), Status: r.a.Status, DirujukKepada: '', Catatan: nota.join('. '), Oleh: s.email });
    }
    audit_(s.email, 'KEWPA10', r.a.NoAduan + (keputusan ? ' → ' + keputusan : ''));
    return {};
  });
}

/** Jana (atau tukar) kod semakan pengadu, contohnya jika kod lama terdedah */
function janaKod_(s, b) {
  return withLock_(function () {
    const r = cariAduan_(b.noAduan);
    if (!r.a || !dalamSkop_(s, r.a.FasilitiPengadu)) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
    const i = r.t.head.indexOf('KodSemakan');
    if (i === -1) throw appErr_('NOT_SETUP', 'Lajur KodSemakan tiada dalam sheet Aduan. Jalankan Setup awal sistem sekali lagi.');
    const kod = kodSemakanBaru_();
    r.t.sh.getRange(r.a._row, i + 1).setValue(kod);
    audit_(s.email, 'JANA_KOD_SEMAKAN', r.a.NoAduan);
    return { kodSemakan: kod };
  });
}

/** Semakan status oleh pengadu tanpa log masuk. Hanya maklumat asas dipulangkan: tiada nama, emel atau catatan dalaman. */
function semak_(b) {
  const no = String(b.noAduan || '').trim().toUpperCase();
  const pengesah = String(b.kod || '').trim();
  const gunaEmel = pengesah.indexOf('@') !== -1;
  const kod = gunaEmel ? pengesah.toLowerCase() : pengesah.toUpperCase();
  const gagal = function () { return appErr_('SEMAK_GAGAL', 'No. aduan dan ' + (gunaEmel ? 'emel' : 'kod semakan') + ' tidak sepadan. Semak semula emel pengesahan aduan anda atau hubungi pentadbir fasiliti.'); };
  if (!/^KRN-\d{4}-\d{4,6}$/.test(no) || (gunaEmel ? kod.length > 120 : !/^[A-Z2-9]{6}$/.test(kod))) throw gagal();

  const cache = CacheService.getScriptCache();
  const kGlobal = 'semak_global', kNo = 'semak_' + no;
  const nGlobal = Number(cache.get(kGlobal) || 0), nNo = Number(cache.get(kNo) || 0);
  if (nGlobal >= SEMAK_GLOBAL_MAKS || nNo >= SEMAK_MAKS) throw appErr_('RATE_LIMIT', 'Terlalu banyak semakan. Cuba lagi selepas 10 minit.');
  cache.put(kGlobal, String(nGlobal + 1), SEMAK_TEMPOH_SAAT);

  const a = table_(SH.ADUAN).rows.find(function (r) { return r.NoAduan === no; });
  const rujukan = a ? String(gunaEmel ? a.EmelPengadu : a.KodSemakan || '') : '';
  if (!a || !rujukan || !samaRata_(gunaEmel ? rujukan.toLowerCase() : rujukan.toUpperCase(), kod)) {
    cache.put(kNo, String(nNo + 1), SEMAK_TEMPOH_SAAT);
    throw gagal();
  }
  const sejarah = table_(SH.LOG).rows
    .filter(function (l) { return l.NoAduan === no; })
    .sort(function (x, y) { return String(x.Masa).localeCompare(String(y.Masa)); })
    .reduce(function (acc, l) {
      // Hanya perubahan status; catatan dan nama pegawai tidak dipaparkan kepada pengadu
      if (!acc.length || acc[acc.length - 1].status !== l.Status) acc.push({ tarikh: l.TarikhTindakan, status: l.Status });
      return acc;
    }, []);
  return {
    aduan: {
      noAduan: a.NoAduan, status: a.Status, tarikh: a.TarikhDiterima, tarikhKerosakan: a.TarikhKerosakan,
      fasiliti: a.FasilitiPengadu, lokasi: a.Lokasi, kategori: a.Kategori, jenis: a.JenisKerosakan,
      kategoriAset: a.KategoriAset, jenisAset: a.JenisAset, keutamaan: a.Keutamaan, dirujukKepada: a.DirujukKepada,
      tarikhSelesai: a.TarikhSelesai, keputusanKJ: a.KategoriAset === ASET_ALIH ? a.B3_Keputusan : '',
      dikemaskini: String(a.DikemaskiniPada || '').slice(0, 10)
    },
    sejarah: sejarah
  };
}

function padam_(s, b) {
  return withLock_(function () {
    const r = cariAduan_(b.noAduan);
    if (!r.a) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
    r.t.sh.deleteRow(r.a._row);
    const lg = table_(SH.LOG);
    lg.rows.filter(function (l) { return l.NoAduan === r.a.NoAduan; })
      .map(function (l) { return l._row; })
      .sort(function (x, y) { return y - x; })
      .forEach(function (row) { lg.sh.deleteRow(row); });
    audit_(s.email, 'PADAM_ADUAN', r.a.NoAduan + ' (' + r.a.FasilitiPengadu + ')');
    return {};
  });
}

/* =========================================================
 * TETAPAN & PENGGUNA (admin)
 * ========================================================= */

function senaraiBersih_(arr, label) {
  if (!Array.isArray(arr)) return [];
  const seen = {};
  return arr.map(function (x) { return teks_(x, 100, label, false); })
    .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; })
    .slice(0, 100);
}

function tulisSenarai_(name, list) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 1).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, 1).setValues(list.map(function (x) { return [safe_(x)]; }));
}

function simpanTetapan_(s, d) {
  const fasiliti = senaraiBersih_(d.fasiliti, 'Nama fasiliti');
  const rujukan = senaraiBersih_(d.rujukan, 'Pihak rujukan');
  const lokasi = senaraiBersih_(d.lokasi, 'Lokasi');
  if (!lokasi.length) throw appErr_('VALIDATION', 'Senarai lokasi tidak boleh kosong.');
  const kdSeen = {};
  const klinikDesa = (Array.isArray(d.klinikDesa) ? d.klinikDesa : []).map(function (k) {
    return { nama: teks_(k && k.nama, 100, 'Nama klinik desa', false), induk: teks_(k && k.induk, 100, 'KK induk', false) };
  }).filter(function (k) { if (!k.nama || kdSeen[k.nama]) return false; kdSeen[k.nama] = true; return true; }).slice(0, 100);
  klinikDesa.forEach(function (k) {
    if (fasiliti.indexOf(k.induk) === -1) throw appErr_('VALIDATION', 'KK induk bagi ' + k.nama + ' tiada dalam senarai fasiliti: ' + (k.induk || '(kosong)'));
  });
  const had = Number(d.hadHari);
  if (!fasiliti.length) throw appErr_('VALIDATION', 'Senarai fasiliti tidak boleh kosong.');
  if (!(had >= 1 && had <= 365 && Math.floor(had) === had)) throw appErr_('VALIDATION', 'Had hari mesti nombor bulat antara 1 dan 365.');
  return withLock_(function () {
    tulisSenarai_(SH.FASILITI, fasiliti);
    tulisSenarai_(SH.RUJUKAN, rujukan);
    tulisSenarai_(SH.LOKASI, lokasi);
    const kdSh = sheet_(SH.KD);
    const kdLast = kdSh.getLastRow();
    if (kdLast > 1) kdSh.getRange(2, 1, kdLast - 1, 2).clearContent();
    if (klinikDesa.length) kdSh.getRange(2, 1, klinikDesa.length, 2).setValues(klinikDesa.map(function (k) { return [safe_(k.nama), safe_(k.induk)]; }));
    const t = table_(SH.TETAPAN);
    const r = t.rows.find(function (x) { return x.Kunci === 'HadHari'; });
    if (r) t.sh.getRange(r._row, 2).setValue(had); else t.sh.appendRow(['HadHari', had]);
    audit_(s.email, 'SIMPAN_TETAPAN', fasiliti.length + ' fasiliti, ' + klinikDesa.length + ' klinik desa, ' + lokasi.length + ' lokasi, had ' + had + ' hari');
    return { tetapan: tetapan_() };
  });
}

function senaraiPengguna_() {
  return table_(SH.PENGGUNA).rows.map(function (u) {
    return {
      email: u.Email, nama: u.Nama, peranan: String(u.Peranan).toLowerCase(), fasiliti: u.Fasiliti,
      aktif: bool_(u.Aktif), tukarKataLaluan: bool_(u.TukarKataLaluan), logMasukTerakhir: u.LogMasukTerakhir
    };
  });
}

function simpanPengguna_(s, d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw appErr_('VALIDATION', 'Emel tidak sah.');
  const nama = teks_(d.nama, 80, 'Nama', true);
  const peranan = String(d.peranan || '').toLowerCase();
  if (PERANAN.indexOf(peranan) === -1) throw appErr_('VALIDATION', 'Peranan tidak sah.');
  let fasiliti = teks_(d.fasiliti, 100, 'Fasiliti', false);
  if (peranan === 'pentadbir') {
    if (PILIHAN_KHAS.indexOf(fasiliti) !== -1 || tetapan_().fasiliti.indexOf(fasiliti) === -1) throw appErr_('VALIDATION', 'Pilih fasiliti untuk pentadbir fasiliti.');
  } else fasiliti = '';
  const aktif = d.aktif !== false;

  return withLock_(function () {
    const r = cariPengguna_(email);
    if (r.u) {
      if (email === s.email && (peranan !== 'admin' || !aktif)) throw appErr_('VALIDATION', 'Anda tidak boleh membuang peranan admin atau menyahaktifkan akaun sendiri.');
      const h = r.t.head;
      const set = function (col, v) { r.t.sh.getRange(r.u._row, h.indexOf(col) + 1).setValue(typeof v === 'boolean' ? v : safe_(v)); };
      set('Nama', nama); set('Peranan', peranan); set('Fasiliti', fasiliti); set('Aktif', aktif);
      audit_(s.email, 'KEMASKINI_PENGGUNA', email + ' (' + peranan + (aktif ? '' : ', tidak aktif') + ')');
      return { pengguna: senaraiPengguna_() };
    }
    if (d.baru !== true) throw appErr_('NOT_FOUND', 'Pengguna tidak dijumpai.');
    const temp = kataLaluanSementara_();
    const salt = saltBaru_();
    tambahBaris_(SH.PENGGUNA, {
      Email: email, Nama: nama, Peranan: peranan, Fasiliti: fasiliti, Aktif: aktif, Salt: salt, Hash: hash_(temp, salt),
      TukarKataLaluan: true, DiciptaPada: nowIso_(), LogMasukTerakhir: ''
    });
    audit_(s.email, 'TAMBAH_PENGGUNA', email + ' (' + peranan + ')');
    return { pengguna: senaraiPengguna_(), kataLaluanSementara: temp, email: email };
  });
}

function setSemula_(s, b) {
  const email = String(b.email || '').trim().toLowerCase();
  return withLock_(function () {
    const r = cariPengguna_(email);
    if (!r.u) throw appErr_('NOT_FOUND', 'Pengguna tidak dijumpai.');
    const temp = kataLaluanSementara_();
    const salt = saltBaru_();
    const h = r.t.head;
    r.t.sh.getRange(r.u._row, h.indexOf('Salt') + 1).setValue(salt);
    r.t.sh.getRange(r.u._row, h.indexOf('Hash') + 1).setValue(hash_(temp, salt));
    r.t.sh.getRange(r.u._row, h.indexOf('TukarKataLaluan') + 1).setValue(true);
    audit_(s.email, 'SET_SEMULA_KATA_LALUAN', email + ' (semua sesi pengguna ditamatkan)');
    return { kataLaluanSementara: temp, email: email };
  });
}

/* =========================================================
 * SETUP — jalankan SEKALI dari editor Apps Script atau menu Sheet
 * ========================================================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Aduan Kerosakan')
    .addItem('Setup awal sistem', 'setupDariMenu')
    .addToUi();
}

function setupDariMenu() {
  const r = setup();
  const ui = SpreadsheetApp.getUi();
  if (r.kataLaluanSementara) {
    ui.alert('Setup selesai',
      'Akaun admin pertama:\n\nEmel: ' + r.email + '\nKata laluan sementara: ' + r.kataLaluanSementara +
      '\n\nSalin sekarang. Kata laluan ini tidak akan dipaparkan lagi dan perlu ditukar semasa log masuk pertama.', ui.ButtonSet.OK);
  } else {
    ui.alert('Setup selesai', 'Struktur sheet telah disemak. Akaun admin sedia ada tidak diubah.', ui.ButtonSet.OK);
  }
}

function setup() {
  const ss = ss_();
  Object.keys(HEAD).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = HEAD[name];
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const cur = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    if (cur.join('') === '') {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    } else {
      // Sheet sedia ada: tambah lajur baharu di hujung tanpa mengubah data lama
      const tiada = head.filter(function (h) { return cur.indexOf(h) === -1; });
      if (tiada.length) {
        if (sh.getMaxColumns() < cur.length + tiada.length) sh.insertColumnsAfter(sh.getMaxColumns(), cur.length + tiada.length - sh.getMaxColumns());
        sh.getRange(1, cur.length + 1, 1, tiada.length).setValues([tiada]).setFontWeight('bold');
      }
    }
    sh.setFrozenRows(1);
    // Simpan semua sebagai teks supaya tarikh tidak ditukar automatik oleh Sheets
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getLastColumn(), head.length)).setNumberFormat('@');
  });
  ['Sheet1', 'Helaian1'].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', saltBaru_());
  if (!props.getProperty('SHEET_ID')) props.setProperty('SHEET_ID', ss.getId());

  const tet = table_(SH.TETAPAN);
  if (!tet.rows.find(function (r) { return r.Kunci === 'HadHari'; })) tet.sh.appendRow(['HadHari', 14]);
  if (!table_(SH.LOKASI).rows.length) tulisSenarai_(SH.LOKASI, LOKASI_ASAL);

  // Sembunyikan kolum Salt dan Hash supaya tidak terpapar semasa sheet dibuka
  const pg = sheet_(SH.PENGGUNA);
  pg.hideColumns(HEAD.Pengguna.indexOf('Salt') + 1, 2);

  const ada = table_(SH.PENGGUNA).rows.some(function (u) { return String(u.Peranan).toLowerCase() === 'admin' && bool_(u.Aktif); });
  if (ada) { console.log('Admin sudah wujud. Tiada akaun baharu dicipta.'); return {}; }

  const email = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Tidak dapat membaca emel akaun. Jalankan setup() semasa log masuk ke akaun Google pemilik.');
  const temp = kataLaluanSementara_();
  const salt = saltBaru_();
  tambahBaris_(SH.PENGGUNA, {
    Email: email, Nama: 'Pentadbir Sistem', Peranan: 'admin', Fasiliti: '', Aktif: true, Salt: salt,
    Hash: hash_(temp, salt), TukarKataLaluan: true, DiciptaPada: nowIso_(), LogMasukTerakhir: ''
  });
  audit_(email, 'SETUP', 'Admin pertama dicipta');
  console.log('Admin pertama: ' + email + ' | kata laluan sementara: ' + temp + ' (tukar semasa log masuk pertama)');
  return { email: email, kataLaluanSementara: temp };
}
