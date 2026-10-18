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

const SH = { ADUAN: 'Aduan', LOG: 'Log', PENGGUNA: 'Pengguna', FASILITI: 'Fasiliti', RUJUKAN: 'Rujukan', TETAPAN: 'Tetapan', AUDIT: 'Audit' };
const HEAD = {
  Aduan: ['NoAduan', 'TarikhDiterima', 'Fasiliti', 'Lokasi', 'KategoriKod', 'Kategori', 'JenisKerosakan', 'NoAset', 'Keterangan', 'Keutamaan', 'DilaporkanOleh', 'Status', 'DirujukKepada', 'TarikhSelesai', 'DidaftarOleh', 'DidaftarPada', 'DikemaskiniOleh', 'DikemaskiniPada'],
  Log: ['NoAduan', 'Masa', 'TarikhTindakan', 'Status', 'DirujukKepada', 'Catatan', 'Oleh'],
  Pengguna: ['Email', 'Nama', 'Peranan', 'Fasiliti', 'Aktif', 'Salt', 'Hash', 'TukarKataLaluan', 'DiciptaPada', 'LogMasukTerakhir'],
  Fasiliti: ['Nama'],
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
const LAIN_LAIN = 'Lain-lain';   // pilihan khas dalam senarai fasiliti; pengguna perlu nyatakan nama

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

  const s = requireAuth_(b.token);
  if (s.tukar && ['tukarKataLaluan', 'logout', 'saya'].indexOf(action) === -1) {
    throw appErr_('PASSWORD_CHANGE', 'Sila tukar kata laluan sementara anda dahulu.');
  }

  switch (action) {
    case 'saya': return { user: awam_(s) };
    case 'logout': return logout_(b.token, s);
    case 'tukarKataLaluan': return tukarKataLaluan_(s, b);
    case 'muat': return muat_(s);
    case 'butiran': return butiran_(s, b);
    case 'daftar': perlu_(s, ['admin', 'pentadbir']); return daftar_(s, b.data || {});
    case 'kemaskini': perlu_(s, ['admin', 'pentadbir']); return kemaskini_(s, b.data || {});
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
  cache.put('sesi_' + token, JSON.stringify({ email: email }), SESI_SAAT);
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

function requireAuth_(token) {
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(token))) throw appErr_('UNAUTHORIZED', 'Sesi tamat. Sila log masuk semula.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sesi_' + token);
  if (!raw) throw appErr_('UNAUTHORIZED', 'Sesi tamat. Sila log masuk semula.');
  const email = JSON.parse(raw).email;
  // Semak semula akaun setiap permintaan: akaun dinyahaktifkan atau tukar peranan berkuat kuasa serta-merta
  const u = cariPengguna_(email).u;
  if (!u || !bool_(u.Aktif) || PERANAN.indexOf(String(u.Peranan).trim().toLowerCase()) === -1) {
    cache.remove('sesi_' + token);
    throw appErr_('UNAUTHORIZED', 'Akaun tidak aktif. Hubungi pentadbir sistem.');
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

function tukarKataLaluan_(s, b) {
  const lama = String(b.lama || ''), baru = String(b.baru || '');
  semakPolisi_(baru);
  if (lama === baru) throw appErr_('VALIDATION', 'Kata laluan baharu mesti berbeza daripada yang lama.');
  return withLock_(function () {
    const r = cariPengguna_(s.email);
    if (!r.u || !samaRata_(hash_(lama, r.u.Salt), r.u.Hash)) throw appErr_('VALIDATION', 'Kata laluan semasa tidak betul.');
    const salt = saltBaru_();
    const h = r.t.head;
    r.t.sh.getRange(r.u._row, h.indexOf('Salt') + 1).setValue(salt);
    r.t.sh.getRange(r.u._row, h.indexOf('Hash') + 1).setValue(hash_(baru, salt));
    r.t.sh.getRange(r.u._row, h.indexOf('TukarKataLaluan') + 1).setValue(false);
    audit_(s.email, 'TUKAR_KATA_LALUAN', '');
    s.tukar = false;
    return { user: awam_(s) };
  });
}

/* =========================================================
 * DATA ADUAN
 * ========================================================= */

function dalamSkop_(s, fasiliti) {
  return s.peranan !== 'pentadbir' || String(fasiliti) === String(s.fasiliti);
}

function aduanAwam_(r) {
  return {
    noAduan: r.NoAduan, tarikh: r.TarikhDiterima, fasiliti: r.Fasiliti, lokasi: r.Lokasi,
    kategoriKod: String(r.KategoriKod), kategori: r.Kategori, jenis: r.JenisKerosakan, noAset: r.NoAset,
    keterangan: r.Keterangan, keutamaan: r.Keutamaan, pelapor: r.DilaporkanOleh, status: r.Status,
    dirujukKepada: r.DirujukKepada, tarikhSelesai: r.TarikhSelesai, didaftarPada: r.DidaftarPada,
    dikemaskiniPada: r.DikemaskiniPada
  };
}

function tetapan_() {
  const fasiliti = table_(SH.FASILITI).rows.map(function (r) { return r.Nama; }).filter(String);
  const rujukan = table_(SH.RUJUKAN).rows.map(function (r) { return r.Nama; }).filter(String);
  const t = table_(SH.TETAPAN).rows;
  const had = Number((t.find(function (r) { return r.Kunci === 'HadHari'; }) || {}).Nilai) || 14;
  return { fasiliti: fasiliti, rujukan: rujukan, hadHari: had };
}

function muat_(s) {
  const aduan = table_(SH.ADUAN).rows
    .filter(function (r) { return r.NoAduan && dalamSkop_(s, r.Fasiliti); })
    .map(aduanAwam_)
    .sort(function (a, b) { return String(b.didaftarPada).localeCompare(String(a.didaftarPada)); });
  return { user: awam_(s), tetapan: tetapan_(), aduan: aduan, kategori: KATEGORI };
}

function cariAduan_(no) {
  const t = table_(SH.ADUAN);
  const a = t.rows.find(function (r) { return r.NoAduan === String(no || ''); });
  return { t: t, a: a };
}

function butiran_(s, b) {
  const r = cariAduan_(b.noAduan);
  if (!r.a || !dalamSkop_(s, r.a.Fasiliti)) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
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
  if (s.peranan === 'pentadbir') {
    fasiliti = s.fasiliti;
  } else if (fasiliti === LAIN_LAIN) {
    if (tet.fasiliti.indexOf(LAIN_LAIN) === -1) throw appErr_('VALIDATION', 'Pilihan Lain-lain tidak diaktifkan dalam senarai fasiliti.');
    fasiliti = LAIN_LAIN + ': ' + teks_(d.fasilitiLain, 80, 'Nama fasiliti / unit (Lain-lain)', true);
  } else if (tet.fasiliti.indexOf(fasiliti) === -1) {
    throw appErr_('VALIDATION', 'Fasiliti tidak ada dalam senarai.');
  }
  const lokasi = teks_(d.lokasi, 120, 'Lokasi', true);
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
  const noAset = teks_(d.noAset, 60, 'No. aset', false);
  const pelapor = teks_(d.pelapor, 80, 'Dilaporkan oleh', false);

  return withLock_(function () {
    const tahun = tarikh.slice(0, 4);
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('SEQ_' + tahun) || 0) + 1;
    props.setProperty('SEQ_' + tahun, String(seq));
    const no = 'KRN-' + tahun + '-' + ('0000' + seq).slice(-4);
    const masa = nowIso_();
    const rec = {
      NoAduan: no, TarikhDiterima: tarikh, Fasiliti: fasiliti, Lokasi: lokasi, KategoriKod: kod, Kategori: kat.nama,
      JenisKerosakan: jenis, NoAset: noAset, Keterangan: keterangan, Keutamaan: keutamaan, DilaporkanOleh: pelapor,
      Status: 'Baru', DirujukKepada: '', TarikhSelesai: '', DidaftarOleh: s.email, DidaftarPada: masa,
      DikemaskiniOleh: s.email, DikemaskiniPada: masa
    };
    const sh = sheet_(SH.ADUAN);
    sh.appendRow(rowFrom_(HEAD.Aduan, rec));
    sheet_(SH.LOG).appendRow(rowFrom_(HEAD.Log, { NoAduan: no, Masa: masa, TarikhTindakan: tarikh, Status: 'Baru', DirujukKepada: '', Catatan: 'Aduan didaftarkan', Oleh: s.email }));
    audit_(s.email, 'DAFTAR_ADUAN', no);
    return { noAduan: no };
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
    if (!r.a || !dalamSkop_(s, r.a.Fasiliti)) throw appErr_('NOT_FOUND', 'Aduan tidak dijumpai.');
    if (tarikh < r.a.TarikhDiterima) throw appErr_('VALIDATION', 'Tarikh tindakan tidak boleh sebelum tarikh aduan diterima.');
    if (status === r.a.Status && rujuk === r.a.DirujukKepada && !catatan) throw appErr_('VALIDATION', 'Tiada perubahan untuk disimpan.');
    const h = r.t.head, row = r.a._row, masa = nowIso_();
    const set = function (col, v) { r.t.sh.getRange(row, h.indexOf(col) + 1).setValue(safe_(v)); };
    set('Status', status);
    set('DirujukKepada', rujuk);
    set('TarikhSelesai', status === 'Selesai' ? tarikh : '');
    set('DikemaskiniOleh', s.email);
    set('DikemaskiniPada', masa);
    sheet_(SH.LOG).appendRow(rowFrom_(HEAD.Log, {
      NoAduan: r.a.NoAduan, Masa: masa, TarikhTindakan: tarikh, Status: status,
      DirujukKepada: rujuk !== r.a.DirujukKepada ? rujuk : '', Catatan: catatan, Oleh: s.email
    }));
    audit_(s.email, 'KEMASKINI_ADUAN', r.a.NoAduan + ' → ' + status);
    return {};
  });
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
    audit_(s.email, 'PADAM_ADUAN', r.a.NoAduan + ' (' + r.a.Fasiliti + ')');
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
  const had = Number(d.hadHari);
  if (!fasiliti.length) throw appErr_('VALIDATION', 'Senarai fasiliti tidak boleh kosong.');
  if (!(had >= 1 && had <= 365 && Math.floor(had) === had)) throw appErr_('VALIDATION', 'Had hari mesti nombor bulat antara 1 dan 365.');
  return withLock_(function () {
    tulisSenarai_(SH.FASILITI, fasiliti);
    tulisSenarai_(SH.RUJUKAN, rujukan);
    const t = table_(SH.TETAPAN);
    const r = t.rows.find(function (x) { return x.Kunci === 'HadHari'; });
    if (r) t.sh.getRange(r._row, 2).setValue(had); else t.sh.appendRow(['HadHari', had]);
    audit_(s.email, 'SIMPAN_TETAPAN', fasiliti.length + ' fasiliti, had ' + had + ' hari');
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
    if (fasiliti === LAIN_LAIN || tetapan_().fasiliti.indexOf(fasiliti) === -1) throw appErr_('VALIDATION', 'Pilih fasiliti untuk pentadbir fasiliti.');
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
    r.t.sh.appendRow(rowFrom_(HEAD.Pengguna, {
      Email: email, Nama: nama, Peranan: peranan, Fasiliti: fasiliti, Aktif: aktif, Salt: salt, Hash: hash_(temp, salt),
      TukarKataLaluan: true, DiciptaPada: nowIso_(), LogMasukTerakhir: ''
    }));
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
    audit_(s.email, 'SET_SEMULA_KATA_LALUAN', email);
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
    const cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
    if (cur.join('') === '') sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Simpan semua sebagai teks supaya tarikh tidak ditukar automatik oleh Sheets
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
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

  // Sembunyikan kolum Salt dan Hash supaya tidak terpapar semasa sheet dibuka
  const pg = sheet_(SH.PENGGUNA);
  pg.hideColumns(HEAD.Pengguna.indexOf('Salt') + 1, 2);

  const ada = table_(SH.PENGGUNA).rows.some(function (u) { return String(u.Peranan).toLowerCase() === 'admin' && bool_(u.Aktif); });
  if (ada) { console.log('Admin sudah wujud. Tiada akaun baharu dicipta.'); return {}; }

  const email = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Tidak dapat membaca emel akaun. Jalankan setup() semasa log masuk ke akaun Google pemilik.');
  const temp = kataLaluanSementara_();
  const salt = saltBaru_();
  pg.appendRow(rowFrom_(HEAD.Pengguna, {
    Email: email, Nama: 'Pentadbir Sistem', Peranan: 'admin', Fasiliti: '', Aktif: true, Salt: salt,
    Hash: hash_(temp, salt), TukarKataLaluan: true, DiciptaPada: nowIso_(), LogMasukTerakhir: ''
  }));
  audit_(email, 'SETUP', 'Admin pertama dicipta');
  console.log('Admin pertama: ' + email + ' | kata laluan sementara: ' + temp + ' (tukar semasa log masuk pertama)');
  return { email: email, kataLaluanSementara: temp };
}
