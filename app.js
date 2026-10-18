/* =========================================================
 * KONFIGURASI — tampal URL Web App Apps Script (berakhir dengan /exec)
 * URL ini bukan rahsia; semua data dilindungi oleh log masuk dan token sesi di server.
 * ========================================================= */
const API_URL = 'https://script.google.com/macros/s/AKfycbw3pcbELxQ4EvhIjz-GpzZkOCMYwSIMEr755pi9PmIgEu3GZYA1XbJzOTGjzlHsySs/exec';

(() => {
'use strict';
const TZ = 'Asia/Kuala_Lumpur';
const KATEGORI = [
  {k:'1', n:'Kerosakan Bangunan dan Fasiliti', s:['Bumbung dan siling','Dinding dan lantai','Pintu dan tingkap','Tandas','Paip, saliran, tangki air dan kebocoran','Pendawaian, lampu, soket dan suis','Pendingin hawa, kipas dan pengudaraan','Longkang, pagar, laluan dan parkir','Ruang menunggu dan struktur luar bangunan']},
  {k:'2', n:'Aset dan Peralatan Bukan Klinikal', s:['Perabot (meja, kerusi, kabinet, rak)','Mesin fotostat dan projektor','Telefon, sistem PA dan CCTV','Peti sejuk (bukan vaksin) dan dispenser air','Mesin nombor giliran','Peralatan pejabat lain']},
  {k:'3', n:'Aset dan Peralatan Klinikal', s:['Katil pemeriksaan, troli, kerusi roda, stretcher','Timbangan, BP set, nebulizer, glucometer','Peralatan pergigian','Peralatan makmal','Peralatan farmasi','Peti sejuk vaksin / cold chain','Peralatan klinikal lain']},
  {k:'4', n:'ICT dan Sistem Berkaitan Aset', s:['Komputer atau laptop','Monitor, papan kekunci, tetikus','UPS','Pencetak atau pengimbas','Rangkaian Internet / LAN','Sistem aplikasi tidak boleh diakses (akibat peralatan/rangkaian fasiliti)','Peralatan ICT lain']},
  {k:'5', n:'Lain-lain Kerosakan Aset atau Fasiliti', s:['Lain-lain']}
];
const COLD = 'Peti sejuk vaksin / cold chain';
const STATUS = ['Baru','Dirujuk','Dalam Tindakan','Selesai','Dibatalkan'];
const OPEN = new Set(['Baru','Dirujuk','Dalam Tindakan']);
const PRIO = ['Kritikal','Tinggi','Biasa'];
const BULAN = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
const PERANAN_LABEL = {admin:'Admin', pentadbir:'Pentadbir fasiliti', pemantau:'Pemantau'};
const katName = k => (KATEGORI.find(x=>x.k===String(k))||{n:'—'}).n;
const ASET_ALIH='Aset Alih', ASET_TAK_ALIH='Aset Tak Alih', LOKASI_LAIN='Lain-lain';
/* Kategori aset lalai ikut kategori kerosakan; pengguna boleh tukar */
const ASET_LALAI = {'1':ASET_TAK_ALIH, '2':ASET_ALIH, '3':ASET_ALIH, '4':ASET_ALIH};
const isAlih = a => a && a.kategoriAset===ASET_ALIH;
const lulusKJ = a => a && a.b3 && a.b3.keputusan==='Diluluskan';
const lokasiPenuh = a => [a.lokasi, a.lokasiPerincian].filter(Boolean).join(' · ');
const rm = v => (v===''||v==null) ? '' : 'RM ' + Number(v).toLocaleString('en-MY',{minimumFractionDigits:2, maximumFractionDigits:2});

/* ---------- Utiliti ---------- */
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)) {
    if (v==null || v===false) continue;
    if (k==='class') el.className = v;
    else if (k.startsWith('on') && typeof v==='function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v===true ? '' : v);
  }
  for (const c of kids.flat()) { if (c==null || c===false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}
const opt = (v,t,sel) => h('option',{value:v, selected:sel||null}, t);
const todayStr = () => new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fmtD = s => { if(!s) return '—'; const [y,m,d]=String(s).slice(0,10).split('-'); return d?`${d}/${m}/${y}`:String(s); };
const fmtDT = iso => { if(!iso) return '—'; const dt=new Date(iso); if(isNaN(dt)) return String(iso); const p=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(dt); const g=t=>(p.find(x=>x.type===t)||{}).value; return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`; };
const dayNum = s => { const [y,m,d]=String(s).slice(0,10).split('-').map(Number); return Date.UTC(y,m-1,d)/864e5; };
const umur = a => { if(!a.tarikh) return 0; const end = a.status==='Selesai' && a.tarikhSelesai ? a.tarikhSelesai : todayStr(); return Math.max(0, Math.round(dayNum(end)-dayNum(a.tarikh))); };
const median = arr => { if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b), m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
const stCls = s => 's-' + String(s).split(' ')[0];
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 3500); }
function banner(msg){ $('banner').textContent=msg||''; $('banner').hidden=!msg; }

/* ---------- Token (sessionStorage: hilang bila tab ditutup) ---------- */
const TK='aduan_krn_token';
const getToken = () => { try{ return sessionStorage.getItem(TK)||''; }catch(e){ return memToken; } };
let memToken='';
const setToken = t => { memToken=t; try{ sessionStorage.setItem(TK,t); }catch(e){} };
const clearToken = () => { memToken=''; try{ sessionStorage.removeItem(TK); }catch(e){} };

/* ---------- API ---------- */
const configured = () => /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_URL);
async function api(action, payload){
  if (!configured()) throw Object.assign(new Error('URL backend belum ditetapkan.'), {code:'CONFIG'});
  let res;
  try{
    res = await fetch(API_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(Object.assign({action, token:getToken()}, payload||{}))});
  }catch(e){ throw Object.assign(new Error('Tidak dapat menghubungi pelayan. Semak sambungan Internet.'), {code:'NETWORK'}); }
  let j; try{ j = await res.json(); }catch(e){ throw Object.assign(new Error('Jawapan pelayan tidak sah. Semak tetapan deployment Apps Script.'), {code:'BAD_RESPONSE'}); }
  if (!j.ok){
    if (j.code==='UNAUTHORIZED'){ clearToken(); ME=null; showLogin(j.error); }
    else if (j.code==='PASSWORD_CHANGE'){ showTukar(true); }
    throw Object.assign(new Error(j.error||'Ralat tidak diketahui.'), {code:j.code});
  }
  return j;
}

/* ---------- State ---------- */
let ME=null, ADUAN=[], TET={fasiliti:[], klinikDesa:[], lokasi:[], rujukan:[], hadHari:14}, PENGGUNA=[], openNo=null, editEmail=null;
const had = () => Number(TET.hadHari)||14;
const isAdmin = () => ME && ME.peranan==='admin';
const bolehTulis = () => ME && (ME.peranan==='admin' || ME.peranan==='pentadbir');

/* ---------- Skrin ---------- */
function screen(id){ ['screen-login','screen-tukar','screen-app','screen-semak'].forEach(s=>$(s).hidden = s!==id); }
function showLogin(msg){ closeDrawer(); screen('screen-login'); $('cfg-warn').hidden = configured(); $('lg-err').textContent = msg||''; $('lg-pw').value=''; setTimeout(()=>$('lg-email').focus(),0); }
function showTukar(wajib){ screen('screen-tukar'); $('pw-intro').textContent = wajib ? 'Anda menggunakan kata laluan sementara. Tetapkan kata laluan baharu sebelum meneruskan.' : 'Tukar kata laluan akaun anda.'; $('pw-batal').textContent = wajib ? 'Log keluar' : 'Batal'; $('pw-batal').dataset.wajib = wajib?'1':''; ['pw-lama','pw-baru','pw-ulang'].forEach(i=>$(i).value=''); $('pw-err').textContent=''; setTimeout(()=>$('pw-lama').focus(),0); }

function show(view){
  const tab = document.querySelector(`.tab[data-view="${view}"]`);
  if (!tab || tab.hidden) view='ringkasan';
  document.querySelectorAll('[data-v]').forEach(s=>s.hidden = s.id!=='v-'+view);
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.view===view)));
  try{ sessionStorage.setItem('aduan_tab', view); }catch(e){}
  if (view==='pengguna') muatPengguna();
  window.scrollTo(0,0);
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>show(t.dataset.view)));

/* ---------- Login / logout ---------- */
$('login-form').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn=$('lg-btn'), err=$('lg-err'); err.textContent='';
  const email=$('lg-email').value.trim(), pw=$('lg-pw').value;
  if (!email || !pw){ err.textContent='Masukkan emel dan kata laluan.'; return; }
  btn.disabled=true; btn.textContent='Menyemak…';
  try{
    const r = await api('login',{email, password:pw});
    setToken(r.token); ME=r.user; $('lg-pw').value='';
    if (ME.tukarKataLaluan) showTukar(true); else await mulaApp();
  }catch(ex){ err.textContent = ex.message; }
  finally{ btn.disabled=false; btn.textContent='Log masuk'; }
});
async function logout(){
  try{ if (getToken()) await api('logout'); }catch(e){}
  clearToken(); ME=null; ADUAN=[]; PENGGUNA=[]; showLogin('Anda telah log keluar.');
}
$('btn-logout').addEventListener('click', logout);
$('btn-pw').addEventListener('click', ()=>showTukar(false));
$('pw-batal').addEventListener('click', ()=>{ if ($('pw-batal').dataset.wajib) logout(); else screen('screen-app'); });
$('pw-form').addEventListener('submit', async e=>{
  e.preventDefault();
  const err=$('pw-err'); err.textContent='';
  const lama=$('pw-lama').value, baru=$('pw-baru').value, ulang=$('pw-ulang').value;
  if (!lama || !baru){ err.textContent='Lengkapkan semua ruangan.'; return; }
  if (baru!==ulang){ err.textContent='Kata laluan baharu tidak sepadan.'; return; }
  if (baru.length<10 || !/[A-Za-z]/.test(baru) || !/\d/.test(baru)){ err.textContent='Minimum 10 aksara, mengandungi huruf dan nombor.'; return; }
  const btn=$('pw-btn'); btn.disabled=true;
  try{ const r=await api('tukarKataLaluan',{lama, baru}); ME=r.user; toast('Kata laluan dikemas kini.'); await mulaApp(); }
  catch(ex){ if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; }
  finally{ btn.disabled=false; }
});

/* ---------- Muat data ---------- */
async function muat(){
  const r = await api('muat');
  ME=r.user; ADUAN=r.aduan||[]; TET=Object.assign({fasiliti:[],klinikDesa:[],lokasi:[],rujukan:[],hadHari:14}, r.tetapan||{});
  renderAll();
}
async function mulaApp(){
  screen('screen-app');
  $('who-nama').textContent = ME.nama || ME.email;
  $('who-role').textContent = PERANAN_LABEL[ME.peranan] + (ME.peranan==='pentadbir' && ME.fasiliti ? ' · '+ME.fasiliti : '');
  document.querySelectorAll('.tab').forEach(t=>{ const p=t.dataset.perlu; t.hidden = (p==='admin' && !isAdmin()) || (p==='tulis' && !bolehTulis()); });
  $('skop-label').textContent = ME.peranan==='pentadbir' ? `Status semasa · ${ME.fasiliti} dan klinik desa di bawahnya` : 'Status semasa · semua fasiliti';
  $('main').classList.add('loading');
  try{ await muat(); banner(''); }catch(ex){ if(ex.code!=='UNAUTHORIZED' && ex.code!=='PASSWORD_CHANGE') banner(ex.message); }
  finally{ $('main').classList.remove('loading'); }
  let v='ringkasan'; try{ v=sessionStorage.getItem('aduan_tab')||v; }catch(e){}
  show(v);
}
$('btn-refresh').addEventListener('click', async ()=>{
  const b=$('btn-refresh'); b.disabled=true;
  try{ await muat(); toast('Data dikemas kini.'); if(openNo) bukaButiran(openNo, true); }catch(ex){ if(ex.code!=='UNAUTHORIZED') toast(ex.message); }
  finally{ b.disabled=false; }
});

/* ---------- Pilihan statik ---------- */
function fillYears(sel, withAll){
  const cur = Number(todayStr().slice(0,4));
  const ys = new Set([cur]); ADUAN.forEach(a=>a.tarikh && ys.add(Number(String(a.tarikh).slice(0,4))));
  const keep = sel.value;
  sel.replaceChildren(...(withAll?[opt('','Semua tahun')]:[]), ...[...ys].sort((a,b)=>b-a).map(y=>opt(String(y),String(y))));
  if ([...sel.options].some(o=>o.value===keep)) sel.value=keep; else if(!withAll) sel.value=String(cur);
}
$('r-bulan').replaceChildren(opt('','Sepanjang tahun'), ...BULAN.map((b,i)=>opt(String(i+1).padStart(2,'0'), b)));
$('r-bulan').value = todayStr().slice(5,7);
$('l-status').replaceChildren(opt('terbuka','Status: Terbuka'), opt('','Status: Semua'), ...STATUS.map(s=>opt(s,'Status: '+s)));
$('l-kat').replaceChildren(opt('','Semua kategori'), ...KATEGORI.map(k=>opt(k.k, k.k+'. '+k.n)));
$('l-pri').replaceChildren(opt('','Semua keutamaan'), ...PRIO.map(p=>opt(p,p)));
$('f-kat').replaceChildren(opt('','Pilih kategori'), ...KATEGORI.map(k=>opt(k.k, k.k+'. '+k.n)));

/* Pilihan khas: "Klinik Desa" buka dropdown KD; "Lain-lain" buka ruangan teks */
const KD_PILIHAN='Klinik Desa', LAIN_PILIHAN='Lain-lain', KHAS=new Set([KD_PILIHAN, LAIN_PILIHAN]);
const isPentadbir = () => ME && ME.peranan==='pentadbir';
const kdSaya = () => (TET.klinikDesa||[]).filter(k => !isPentadbir() || k.induk===ME.fasiliti);
function fillFasiliti(){
  const list=TET.fasiliti||[], kds=kdSaya();
  const fSel=$('f-fasiliti'), keep=fSel.value;
  const pilihan = isPentadbir() ? [ME.fasiliti, ...(kds.length?[KD_PILIHAN]:[])] : list.filter(f => f!==KD_PILIHAN || kds.length);
  fSel.replaceChildren(opt('', pilihan.length?'Pilih fasiliti / unit':'Belum ada senarai'), ...pilihan.map(f=>opt(f,f)));
  if (pilihan.includes(keep)) fSel.value=keep; else if (isPentadbir()) fSel.value=ME.fasiliti;
  const kSel=$('f-kd'), kKeep=kSel.value, groups={};
  kds.forEach(k => (groups[k.induk||'Lain-lain'] = groups[k.induk||'Lain-lain'] || []).push(k.nama));
  kSel.replaceChildren(opt('','Pilih klinik desa'), ...Object.entries(groups).map(([g,ns]) => h('optgroup',{label:g}, ns.map(n=>opt(n,n)))));
  kSel.value = kds.some(k=>k.nama===kKeep) ? kKeep : '';
  const hint=$('fas-hint');
  if (!list.length){ hint.hidden=false; hint.textContent = isAdmin() ? 'Tambah senarai fasiliti di tab Tetapan dahulu.' : 'Senarai fasiliti belum disediakan. Hubungi pentadbir sistem.'; } else hint.hidden=true;
  const tapis = isPentadbir() ? [ME.fasiliti, ...kds.map(k=>k.nama)] : [...list.filter(f=>!KHAS.has(f)), ...kds.map(k=>k.nama)];
  const extra=[...new Set(ADUAN.map(a=>a.fasiliti).filter(f=>f && !tapis.includes(f)))];
  const lk=$('l-fas').value;
  $('l-fas').replaceChildren(opt('','Semua fasiliti'), ...[...tapis,...extra].map(f=>opt(f,f)));
  $('l-fas').value = [...tapis,...extra].includes(lk) ? lk : '';
  const uk=$('u-fasiliti').value;
  $('u-fasiliti').replaceChildren(opt('','Pilih fasiliti'), ...list.filter(f=>!KHAS.has(f)).map(f=>opt(f,f))); $('u-fasiliti').value=uk;
  syncPilihan();
}
function syncPilihan(){
  const v=$('f-fasiliti').value;
  $('kd-wrap').hidden = v!==KD_PILIHAN;
  $('fas-lain-wrap').hidden = v!==LAIN_PILIHAN;
  if (v!==KD_PILIHAN) $('f-kd').value='';
  if (v!==LAIN_PILIHAN) $('f-fas-lain').value='';
}
$('f-fasiliti').addEventListener('change', syncPilihan);
function fillLokasi(){
  const sel=$('f-lokasi'), keep=sel.value, list=TET.lokasi||[];
  sel.replaceChildren(opt('', list.length?'Pilih lokasi':'Belum ada senarai lokasi'), ...list.map(l=>opt(l,l)));
  if (list.includes(keep)) sel.value=keep;
  syncLokasi();
}
function syncLokasi(){
  const lain=$('f-lokasi').value===LOKASI_LAIN;
  $('lok-req').hidden=!lain;
  $('f-lokasi-detail').placeholder = lain ? 'Nyatakan lokasi kerosakan' : 'Contoh: Bilik Rawatan 2, tingkat 1';
}
$('f-lokasi').addEventListener('change', syncLokasi);
const kaPilih = () => (document.querySelector('input[name="ka"]:checked')||{}).value || '';
function syncAset(){
  const alih = kaPilih()===ASET_ALIH;
  $('alih-wrap').hidden = !alih;
  if (!alih){ ['f-jenis-aset','f-aset','f-pengguna'].forEach(id=>$(id).value=''); }
}
document.querySelectorAll('input[name="ka"]').forEach(r=>r.addEventListener('change', syncAset));

/* ---------- Ringkasan ---------- */
const kpi = (cls,n,l,s) => h('div',{class:'kpi '+(cls||'')}, h('div',{class:'n'},n), h('div',{class:'l'},l), s?h('div',{class:'s'},s):null);
function renderRingkasan(){
  $('as-of').textContent = 'Setakat ' + fmtD(todayStr());
  const open=ADUAN.filter(a=>OPEN.has(a.status)), krit=open.filter(a=>a.keutamaan==='Kritikal'), lewat=open.filter(a=>umur(a)>had()), baru=open.filter(a=>a.status==='Baru');
  $('kpi-now').replaceChildren(
    kpi('info', open.length, 'Aduan terbuka', `${baru.length} belum diambil tindakan (status Baru)`),
    kpi(krit.length?'crit':'', krit.length, 'Kritikal masih terbuka', krit.length?'Semak segera':'Tiada'),
    kpi(lewat.length?'warn':'', lewat.length, `Terbuka melebihi ${had()} hari`, open.length?`${Math.round(lewat.length/open.length*100)}% daripada aduan terbuka`:'—'),
    (()=>{ const tunggu=open.filter(a=>isAlih(a) && !a.b3?.keputusan), alihOpen=open.filter(isAlih).length;
      return kpi(tunggu.length?'warn':'', tunggu.length, 'Menunggu keputusan KEW.PA-10', alihOpen?`Daripada ${alihOpen} aduan aset alih terbuka`:'Tiada aduan aset alih terbuka'); })());
  const y=$('r-tahun').value, m=$('r-bulan').value;
  $('period-title').textContent = m ? `${BULAN[Number(m)-1]} ${y}` : `Tahun ${y}`;
  const inP = ADUAN.filter(a=>a.tarikh && String(a.tarikh).slice(0,4)===y && (!m || String(a.tarikh).slice(5,7)===m));
  const valid = inP.filter(a=>a.status!=='Dibatalkan'), done=valid.filter(a=>a.status==='Selesai');
  const med=median(done.map(umur)), pct = valid.length ? Math.round(done.length/valid.length*1000)/10 : null;
  $('kpi-period').replaceChildren(
    kpi('', inP.length, 'Aduan diterima', inP.length-valid.length?`${inP.length-valid.length} dibatalkan`:'Tiada pembatalan'),
    kpi('ok', done.length, 'Telah selesai', `${valid.length-done.length} masih terbuka`),
    kpi('', pct==null?'—':pct+'%', 'Kadar selesai', 'Selesai ÷ diterima (tolak dibatalkan)'),
    kpi('', med==null?'—':med, 'Median hari selesai', done.length?`Berdasarkan ${done.length} aduan selesai`:'Belum ada aduan selesai'));
  const bk=$('by-kat');
  if (!valid.length) bk.replaceChildren(h('p',{class:'muted',style:'margin:0'},'Tiada aduan dalam tempoh ini.'));
  else {
    const max=Math.max(...KATEGORI.map(k=>valid.filter(a=>String(a.kategoriKod)===k.k).length),1);
    bk.replaceChildren(...KATEGORI.map(k=>{ const all=valid.filter(a=>String(a.kategoriKod)===k.k), o=all.filter(a=>OPEN.has(a.status)).length, d=all.length-o;
      return h('div',{class:'bar-row'}, h('span',null,`${k.k}. ${k.n}`), h('span',{class:'v'},`${all.length} (${o} terbuka)`),
        h('div',{class:'track',role:'img','aria-label':`${all.length} aduan, ${o} terbuka`}, h('div',{class:'seg-done',style:`width:${d/max*100}%`}), h('div',{class:'seg-open',style:`width:${o/max*100}%`}))); }));
  }
  const fasSet=[...new Set([...(TET.fasiliti||[]), ...valid.map(a=>a.fasiliti)].filter(Boolean))];
  const rows=fasSet.map(f=>{ const all=valid.filter(a=>a.fasiliti===f), d=all.filter(a=>a.status==='Selesai'); return {f,n:all.length,o:all.length-d.length,d:d.length,med:median(d.map(umur))}; }).filter(r=>r.n>0).sort((a,b)=>b.o-a.o||b.n-a.n);
  const tbl=$('by-fas');
  if (!rows.length) tbl.replaceChildren(h('tbody',null,h('tr',null,h('td',{class:'muted'},'Tiada aduan dalam tempoh ini.'))));
  else tbl.replaceChildren(
    h('thead',null,h('tr',null,h('th',null,'Fasiliti / unit'),h('th',{class:'num'},'Diterima'),h('th',{class:'num'},'Terbuka'),h('th',{class:'num'},'Selesai'),h('th',{class:'num'},'Median hari'))),
    h('tbody',null,rows.map(r=>h('tr',null,h('td',null,r.f),h('td',{class:'num'},r.n),h('td',{class:'num'},r.o),h('td',{class:'num'},r.d),h('td',{class:'num'},r.med==null?'—':r.med)))));
}

/* ---------- Senarai ---------- */
function filtered(){
  const q=$('l-q').value.trim().toLowerCase(), st=$('l-status').value, k=$('l-kat').value, ka=$('l-aset').value, f=$('l-fas').value, p=$('l-pri').value, y=$('l-tahun').value;
  let list=ADUAN.filter(a=>{
    if (st==='terbuka' ? !OPEN.has(a.status) : (st && a.status!==st)) return false;
    if (k && String(a.kategoriKod)!==k) return false;
    if (ka && a.kategoriAset!==ka) return false;
    if (f && a.fasiliti!==f) return false;
    if (p && a.keutamaan!==p) return false;
    if (y && String(a.tarikh).slice(0,4)!==y) return false;
    if (q && ![a.noAduan,a.lokasi,a.lokasiPerincian,a.noAset,a.jenisAset,a.keterangan,a.jenis,a.fasiliti,a.pelapor,a.emelPengadu].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
  const s=$('l-sort').value;
  if (s==='umur') list=[...list].sort((a,b)=>(OPEN.has(b.status)-OPEN.has(a.status)) || umur(b)-umur(a));
  if (s==='prio') list=[...list].sort((a,b)=>PRIO.indexOf(a.keutamaan)-PRIO.indexOf(b.keutamaan) || umur(b)-umur(a));
  return list;
}
function renderSenarai(){
  const box=$('list'), list=filtered();
  $('list-count').textContent=`(${list.length})`;
  if (!ADUAN.length){ box.replaceChildren(h('div',{class:'empty'}, h('b',null,'Belum ada aduan didaftarkan'), h('span',{class:'muted'},'Aduan yang didaftarkan akan disenaraikan di sini bersama status dan tempoh terbuka.'), bolehTulis()?h('button',{class:'btn primary',type:'button',onclick:()=>show('daftar')},'Daftar aduan pertama'):null)); return; }
  if (!list.length){ box.replaceChildren(h('div',{class:'empty'}, h('b',null,'Tiada aduan sepadan dengan tapisan'), h('span',{class:'muted'},'Tukar status kepada "Semua" atau kosongkan carian.'))); return; }
  box.replaceChildren(...list.map(a=>{ const u=umur(a), late=OPEN.has(a.status)&&u>had();
    return h('button',{class:`row p-${a.keutamaan}`,type:'button',onclick:()=>bukaButiran(a.noAduan)},
      h('div',{class:'c'}, h('span',{class:'tagno'},a.noAduan), h('span',{class:'t2'},fmtD(a.tarikh)), a.kategoriAset?h('span',{class:'chip'+(isAlih(a)?' alih':'')}, isAlih(a)?'Aset alih':'Aset tak alih'):null),
      h('div',{class:'c c-fas'}, h('span',{class:'t1'},a.fasiliti||'—'), h('span',{class:'t2'},lokasiPenuh(a))),
      h('div',{class:'c c-kat'}, h('span',{class:'t1'},isAlih(a)&&a.jenisAset?a.jenisAset:(a.jenis||katName(a.kategoriKod))), h('span',{class:'t2'},a.keterangan||'')),
      h('div',{class:'c c-pri'}, h('span',{class:'pr pr-'+a.keutamaan},a.keutamaan)),
      h('div',{class:'c c-sts'}, h('span',{class:'pill '+stCls(a.status)},a.status)),
      h('div',{class:'age'+(late?' late':'')}, a.status==='Dibatalkan'?'—':u, h('small',null,a.status==='Selesai'?'hari selesai':(a.status==='Dibatalkan'?'':'hari terbuka')))); }));
}
['l-q','l-status','l-kat','l-aset','l-fas','l-pri','l-tahun','l-sort'].forEach(id=>$(id).addEventListener('input',renderSenarai));
['r-bulan','r-tahun'].forEach(id=>$(id).addEventListener('input',renderRingkasan));

/* ---------- CSV ---------- */
const csvCell = v => { let s=v==null?'':String(v); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
$('btn-csv').addEventListener('click', ()=>{
  const list=filtered(); if(!list.length){ toast('Tiada aduan untuk dimuat turun.'); return; }
  const head=['No Aduan','Tarikh Diterima','Tarikh Kerosakan','Fasiliti Pengadu','Lokasi','Perincian Lokasi','Kategori','Jenis Kerosakan','Kategori Aset','Jenis Aset','No Siri Pendaftaran Aset','Pengguna Terakhir','Perihal Kerosakan','Nama dan Jawatan Pengadu','Emel Pengadu','Keutamaan','Status','Dirujuk Kepada','Tarikh Selesai','Hari Terbuka/Selesai',
    'B2 Kos Terdahulu (RM)','B2 Anggaran Kos (RM)','B2 Syor dan Ulasan','B2 Nama dan Jawatan','B2 Tarikh','B3 Keputusan','B3 Ulasan','B3 Nama dan Jawatan','B3 Tarikh'];
  const lines=[head.map(csvCell).join(',')];
  list.forEach(a=>{ const b2=a.b2||{}, b3=a.b3||{}; lines.push([a.noAduan,fmtD(a.tarikh),a.tarikhKerosakan?fmtD(a.tarikhKerosakan):'',a.fasiliti,a.lokasi,a.lokasiPerincian,katName(a.kategoriKod),a.jenis,a.kategoriAset,a.jenisAset,a.noAset,a.penggunaTerakhir,a.keterangan,a.pelapor,a.emelPengadu,a.keutamaan,a.status,a.dirujukKepada,a.tarikhSelesai?fmtD(a.tarikhSelesai):'',a.status==='Dibatalkan'?'':umur(a),
    b2.kosTerdahulu,b2.anggaranKos,b2.syor,b2.namaJawatan,b2.tarikh?fmtD(b2.tarikh):'',b3.keputusan,b3.ulasan,b3.namaJawatan,b3.tarikh?fmtD(b3.tarikh):''].map(csvCell).join(',')); });
  const url=URL.createObjectURL(new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=h('a',{href:url,download:`aduan-kerosakan-${todayStr()}.csv`}); document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
});

/* ---------- Borang daftar ---------- */
function fillSub(){
  const k=$('f-kat').value, kat=KATEGORI.find(x=>x.k===k);
  $('f-sub').replaceChildren(opt('', kat?'Pilih jenis kerosakan':'Pilih kategori dahulu'), ...(kat?kat.s.map(s=>opt(s,s)):[]));
  if (k==='5'){ $('f-sub').value='Lain-lain'; $('sub-wrap').hidden=true; $('ket-hint').textContent='Kategori Lain-lain: terangkan dengan jelas apa yang rosak dan kenapa tidak sesuai dalam kategori lain (minimum 40 aksara).'; }
  else { $('sub-wrap').hidden=false; $('ket-hint').textContent='Minimum 15 aksara.'; }
  coldCheck();
}
function coldCheck(){ const c=$('f-sub').value===COLD; $('cold-note').hidden=!c; if(c) $('p-krit').checked=true; }
$('f-kat').addEventListener('change',()=>{
  fillSub();
  const lalai=ASET_LALAI[$('f-kat').value];
  document.querySelectorAll('input[name="ka"]').forEach(r=>{ r.checked = !!lalai && r.value===lalai; });
  syncAset();
});
$('f-sub').addEventListener('change',coldCheck);
function resetForm(){
  $('form').reset(); $('f-tarikh').value=todayStr(); $('f-tarikh').max=todayStr();
  $('f-tarikh-rosak').value=todayStr(); $('f-tarikh-rosak').max=todayStr();
  fillSub(); fillFasiliti(); fillLokasi(); syncAset(); $('f-err').textContent='';
}
$('f-reset').addEventListener('click', resetForm);
$('form').addEventListener('submit', async e=>{
  e.preventDefault();
  const err=$('f-err'); err.textContent='';
  const d={ tarikh:$('f-tarikh').value, tarikhKerosakan:$('f-tarikh-rosak').value, fasiliti:$('f-fasiliti').value, klinikDesa:$('f-kd').value, fasilitiLain:$('f-fas-lain').value.trim(),
    lokasi:$('f-lokasi').value, lokasiPerincian:$('f-lokasi-detail').value.trim(), kategoriKod:$('f-kat').value, jenis:$('f-sub').value, kategoriAset:kaPilih(),
    jenisAset:$('f-jenis-aset').value.trim(), noAset:$('f-aset').value.trim(), penggunaTerakhir:$('f-pengguna').value.trim(),
    pelapor:$('f-pelapor').value.trim(), emelPengadu:$('f-emel').value.trim(), pautanAsas:asasUrl(), keterangan:$('f-ket').value.trim(), keutamaan:(document.querySelector('input[name="prio"]:checked')||{}).value };
  const alih=d.kategoriAset===ASET_ALIH, miss=[];
  if(!d.tarikh) miss.push('tarikh aduan diterima'); if(!d.tarikhKerosakan) miss.push('tarikh kerosakan');
  if(!d.fasiliti) miss.push('fasiliti pengadu'); if(d.fasiliti===KD_PILIHAN && !d.klinikDesa) miss.push('klinik desa'); if(d.fasiliti===LAIN_PILIHAN && !d.fasilitiLain) miss.push('nama fasiliti/unit');
  if(!d.lokasi) miss.push('lokasi kerosakan'); if(d.lokasi===LOKASI_LAIN && !d.lokasiPerincian) miss.push('perincian lokasi');
  if(!d.kategoriKod) miss.push('kategori'); if(!d.jenis) miss.push('jenis kerosakan'); if(!d.kategoriAset) miss.push('kategori aset');
  if(alih && !d.jenisAset) miss.push('jenis aset'); if(alih && !d.noAset) miss.push('no. siri pendaftaran aset');
  if(!d.pelapor) miss.push('nama dan jawatan pengadu'); if(!d.keutamaan) miss.push('keutamaan');
  if (miss.length){ err.textContent='Lengkapkan: '+miss.join(', ')+'.'; return; }
  if (d.emelPengadu && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.emelPengadu)){ err.textContent='Emel pengadu tidak sah.'; $('f-emel').focus(); return; }
  if (d.tarikh>todayStr()){ err.textContent='Tarikh aduan tidak boleh melebihi hari ini.'; return; }
  if (d.tarikhKerosakan>d.tarikh){ err.textContent='Tarikh kerosakan tidak boleh selepas tarikh aduan diterima.'; return; }
  const min=d.kategoriKod==='5'?40:15; if(d.keterangan.length<min){ err.textContent=`Perihal kerosakan terlalu ringkas (minimum ${min} aksara).`; $('f-ket').focus(); return; }
  const btn=$('f-submit'); btn.disabled=true; btn.textContent='Menyimpan…';
  try{
    const r=await api('daftar',{data:d}); resetForm();
    toast(r.emel==='dihantar' ? `Aduan ${r.noAduan} didaftarkan. Emel pengesahan dihantar kepada ${d.emelPengadu}.`
      : r.emel==='gagal' ? `Aduan ${r.noAduan} didaftarkan, tetapi emel tidak dihantar: ${r.emelRalat}`
      : `Aduan ${r.noAduan} didaftarkan.`);
    await muat(); show('senarai'); bukaButiran(r.noAduan);
  }
  catch(ex){ if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; }
  finally{ btn.disabled=false; btn.textContent='Daftar aduan'; }
});

/* ---------- Butiran (drawer) ---------- */
function closeDrawer(){ openNo=null; $('drawer').hidden=true; $('scrim').hidden=true; }
$('d-close').addEventListener('click',closeDrawer); $('scrim').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && openNo) closeDrawer(); });

async function bukaButiran(no, senyap){
  openNo=no; $('drawer').hidden=false; $('scrim').hidden=false; $('d-no').textContent=no;
  if (!senyap){ $('d-info').replaceChildren(h('p',{class:'muted'},'Memuatkan butiran…')); ['d-kewpa','d-log','d-upd','d-del'].forEach(id=>$(id).replaceChildren()); $('d-close').focus(); }
  try{
    const r=await api('butiran',{noAduan:no});
    if (openNo!==no) return;
    renderButiran(r.aduan, r.log||[]);
  }catch(ex){ if(ex.code!=='UNAUTHORIZED') $('d-info').replaceChildren(h('p',{class:'err'},ex.message)); }
}
function renderButiran(a, log){
  const u=umur(a), late=OPEN.has(a.status)&&u>had();
  const kv=(k,v)=>[h('dt',null,k),h('dd',null,v||'—')];
  $('d-info').replaceChildren(
    h('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px'}, h('span',{class:'pill '+stCls(a.status)},a.status), h('span',{class:'pr pr-'+a.keutamaan},a.keutamaan),
      a.status==='Dibatalkan'?null:h('span',{class:'pill',style:`background:var(--surface);color:${late?'var(--crit)':'var(--muted)'};border:1px solid var(--line)`}, a.status==='Selesai'?`Selesai dalam ${u} hari`:`${u} hari terbuka`)),
    h('dl',{class:'kv'}, kv('Tarikh diterima',fmtD(a.tarikh)), kv('Tarikh kerosakan',a.tarikhKerosakan?fmtD(a.tarikhKerosakan):''), kv('Fasiliti pengadu',a.fasiliti), kv('Lokasi kerosakan',lokasiPenuh(a)),
      kv('Kategori',`${a.kategoriKod}. ${katName(a.kategoriKod)}`), kv('Jenis kerosakan',a.jenis), kv('Kategori aset',a.kategoriAset),
      isAlih(a)?kv('Jenis aset',a.jenisAset):null, kv(isAlih(a)?'No. siri pendaftaran':'No. aset',a.noAset), isAlih(a)?kv('Pengguna terakhir',a.penggunaTerakhir):null,
      kv('Nama dan jawatan pengadu',a.pelapor), kv('Emel pengadu',a.emelPengadu), kv('Dirujuk kepada',a.dirujukKepada), a.tarikhSelesai?kv('Tarikh selesai',fmtD(a.tarikhSelesai)):null),
    h('div',{style:'margin-top:12px'}, h('div',{class:'eyebrow',style:'margin-bottom:6px'},'Perihal kerosakan'), h('div',{class:'desc'},a.keterangan)),
    kotakPengadu(a));
  buildKewpa(a);
  $('d-log').replaceChildren(h('div',{class:'eyebrow',style:'margin-bottom:8px'},'Rekod tindakan'),
    h('ol',{class:'timeline'}, log.map(l=>h('li',null, h('div',null,h('b',null,l.status), l.dirujuk?` · dirujuk kepada ${l.dirujuk}`:''),
      l.catatan?h('div',{style:'white-space:pre-wrap;overflow-wrap:anywhere'},l.catatan):null,
      h('div',{class:'meta'},`Tarikh tindakan ${fmtD(l.tarikh)} · direkod ${fmtDT(l.masa)} oleh ${l.oleh||'—'}`)))));
  buildUpdate(a);
}
/* ---------- Maklumat semakan untuk pengadu ---------- */
const asasUrl = () => `${location.origin}${location.pathname.replace(/index\.html$/,'')}`;
const pautanSemak = a => `${asasUrl()}?no=${encodeURIComponent(a.noAduan)}&kod=${encodeURIComponent(a.kodSemakan)}`;
const mesejPengadu = a => `Aduan kerosakan anda telah didaftarkan.\nNo. aduan: ${a.noAduan}\nKod semakan: ${a.kodSemakan}\nSemak status di: ${pautanSemak(a)}`;
function kotakEmel(a){
  const wrap=h('div',{style:'display:flex;flex-direction:column;gap:6px'});
  const status = a.emelPengadu
    ? (a.emelDihantar ? `Emel pengesahan dihantar kepada ${a.emelPengadu} pada ${fmtDT(a.emelDihantar)}.` : `Emel pengadu: ${a.emelPengadu}. Emel pengesahan belum berjaya dihantar.`)
    : 'Tiada emel pengadu direkodkan.';
  wrap.append(h('span',{style:'font-size:13.5px'},status));
  if (!bolehTulis()) return wrap;
  const inp=h('input',{type:'email',maxlength:'120',placeholder:'nama@moh.gov.my','aria-label':'Emel pengadu'}); inp.value=a.emelPengadu||'';
  const btn=h('button',{class:'btn small',type:'button'}, a.emelDihantar?'Hantar semula emel':'Hantar emel');
  const err=h('span',{class:'err',role:'alert'});
  btn.addEventListener('click', async ()=>{
    err.textContent=''; const e=inp.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)){ err.textContent='Masukkan emel yang sah.'; return; }
    btn.disabled=true; btn.textContent='Menghantar…';
    try{ await api('hantarEmel',{noAduan:a.noAduan, emel:e, pautanAsas:asasUrl()}); toast(`Emel dihantar kepada ${e}.`); await muat(); bukaButiran(a.noAduan,true); }
    catch(ex){ btn.disabled=false; btn.textContent='Hantar emel'; if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; }
  });
  wrap.append(h('div',{class:'form-actions'}, h('div',{style:'flex:1 1 220px;min-width:0'},inp), btn), err);
  return wrap;
}
function kotakPengadu(a){
  const box=h('div',{class:'pengadu-box',style:'margin-top:12px'});
  const jana=h('button',{class:'btn small',type:'button'}, a.kodSemakan?'Jana kod baharu':'Jana kod semakan');
  jana.addEventListener('click', async ()=>{
    jana.disabled=true;
    try{ await api('janaKod',{noAduan:a.noAduan}); toast(a.kodSemakan?'Kod baharu dijana. Kod lama tidak lagi sah.':'Kod semakan dijana.'); await muat(); bukaButiran(a.noAduan,true); }
    catch(ex){ jana.disabled=false; if(ex.code!=='UNAUTHORIZED') toast(ex.message); }
  });
  if (!a.kodSemakan){
    box.append(h('div',{class:'eyebrow'},'Semakan oleh pengadu'), kotakEmel(a), h('span',{class:'muted',style:'font-size:13.5px'},'Aduan ini belum ada kod semakan.'), bolehTulis()?h('div',null,jana):null);
    return box;
  }
  const salin=h('button',{class:'btn small primary',type:'button'},'Salin mesej untuk pengadu');
  salin.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(mesejPengadu(a)); toast('Mesej disalin. Tampal dalam WhatsApp atau emel kepada pengadu.'); }catch(e){ toast('Tidak dapat menyalin. Salin No. aduan dan kod secara manual.'); } });
  box.append(h('div',{class:'eyebrow'},'Semakan oleh pengadu'), kotakEmel(a),
    h('div',{style:'border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:8px'},
      h('span',{class:'muted',style:'font-size:13px'},'Untuk pengadu tanpa emel: berikan No. aduan dan kod semakan, atau salin mesej di bawah.'),
      h('div',{style:'font-size:14px'}, 'Kod semakan: ', h('span',{class:'kod'},a.kodSemakan)),
      h('div',{class:'form-actions'}, salin, bolehTulis()?jana:null)));
  return box;
}

/* ---------- KEW.PA-10 Bahagian II & III ---------- */
function buildKewpa(a){
  const box=$('d-kewpa');
  if (!isAlih(a)){ box.replaceChildren(a.kategoriAset===ASET_TAK_ALIH ? h('p',{class:'note'},'Aset tak alih: KEW.PA-10 tidak terpakai. Rekod tindakan melalui kemas kini status di bawah.') : null); return; }
  const b2=a.b2||{}, b3=a.b3||{};
  const cetak=h('button',{class:'btn small',type:'button'},'Cetak KEW.PA-10'); cetak.addEventListener('click',()=>cetakKewpa(a));
  const status = b3.keputusan==='Diluluskan' ? h('div',{class:'kw-ok'},`Diluluskan oleh Ketua Jabatan pada ${fmtD(b3.tarikh)}.`)
    : b3.keputusan==='Tidak Diluluskan' ? h('div',{class:'kw-warn'},`Tidak diluluskan oleh Ketua Jabatan pada ${fmtD(b3.tarikh)}.`)
    : h('div',{class:'kw-warn'}, b2.namaJawatan ? 'Menunggu keputusan Ketua Jabatan (Bahagian III). Mengikut AM 2.4, penyelenggaraan dibuat selepas kelulusan.' : 'Bahagian II belum diisi oleh Pegawai Aset / Pegawai Teknikal.');
  const head=h('div',{class:'kw-head'}, h('h3',null,'KEW.PA-10'), cetak);
  if (!isAdmin()){
    const kv=(k,v)=>[h('dt',null,k),h('dd',null,v||'—')];
    box.replaceChildren(h('div',{class:'kw-box'}, head, status,
      h('div',{class:'kw-sub'},'Bahagian II · Pegawai Aset / Pegawai Teknikal'),
      h('dl',{class:'kv'}, kv('Kos penyelenggaraan terdahulu',rm(b2.kosTerdahulu)), kv('Anggaran kos penyelenggaraan',rm(b2.anggaranKos)), kv('Syor dan ulasan',b2.syor), kv('Nama dan jawatan',b2.namaJawatan), kv('Tarikh',b2.tarikh?fmtD(b2.tarikh):'')),
      h('div',{class:'kw-sub'},'Bahagian III · Ketua Jabatan'),
      h('dl',{class:'kv'}, kv('Keputusan',b3.keputusan), kv('Ulasan',b3.ulasan), kv('Nama dan jawatan',b3.namaJawatan), kv('Tarikh',b3.tarikh?fmtD(b3.tarikh):''))));
    return;
  }
  const inp=(id,val,attrs)=>{ const el=h('input',Object.assign({id,type:'text'},attrs||{})); el.value=val||''; return el; };
  const kos=inp('k-kos',b2.kosTerdahulu,{inputmode:'decimal',placeholder:'0.00'}), ang=inp('k-ang',b2.anggaranKos,{inputmode:'decimal',placeholder:'0.00'});
  const syor=h('textarea',{id:'k-syor',rows:'2',maxlength:'800'}); syor.value=b2.syor||'';
  const n2=inp('k-n2',b2.namaJawatan,{maxlength:'100',placeholder:'Nama dan jawatan Pegawai Aset / Teknikal'});
  const t2=inp('k-t2',b2.tarikh||todayStr(),{type:'date',max:todayStr(),min:a.tarikh});
  const kep=h('select',{id:'k-kep'}, opt('','Belum diputuskan'), opt('Diluluskan','Diluluskan',b3.keputusan==='Diluluskan'), opt('Tidak Diluluskan','Tidak Diluluskan',b3.keputusan==='Tidak Diluluskan'));
  const ul=h('textarea',{id:'k-ul',rows:'2',maxlength:'500'}); ul.value=b3.ulasan||'';
  const n3=inp('k-n3',b3.namaJawatan,{maxlength:'100',placeholder:'Nama dan jawatan Ketua Jabatan'});
  const t3=inp('k-t3',b3.tarikh||todayStr(),{type:'date',max:todayStr(),min:a.tarikh});
  const err=h('span',{class:'err',role:'alert'}), btn=h('button',{class:'btn primary',type:'button'},'Simpan KEW.PA-10');
  btn.addEventListener('click', async ()=>{
    err.textContent='';
    const wang=v=>v.replace(/[,\sRMrm]/g,'');
    const d={noAduan:a.noAduan, kosTerdahulu:wang(kos.value), anggaranKos:wang(ang.value), syor:syor.value.trim(), b2Nama:n2.value.trim(), b2Tarikh:t2.value,
      keputusan:kep.value, ulasanKJ:ul.value.trim(), b3Nama:n3.value.trim(), b3Tarikh:kep.value?t3.value:''};
    if ([d.kosTerdahulu,d.anggaranKos].some(v=>v!=='' && !(Number(v)>=0))){ err.textContent='Kos mesti nombor RM, contohnya 350.00'; return; }
    if (!d.b2Nama){ err.textContent='Bahagian II: isi nama dan jawatan.'; return; }
    if (d.keputusan && !d.b3Nama){ err.textContent='Bahagian III: isi nama dan jawatan Ketua Jabatan.'; return; }
    btn.disabled=true; btn.textContent='Menyimpan…';
    try{ await api('kewpa',{data:d}); toast('KEW.PA-10 disimpan.'); await muat(); bukaButiran(a.noAduan,true); }
    catch(ex){ if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; btn.disabled=false; btn.textContent='Simpan KEW.PA-10'; }
  });
  box.replaceChildren(h('div',{class:'kw-box'}, head, status,
    h('div',{class:'kw-sub'},'Bahagian II · Pegawai Aset / Pegawai Teknikal'),
    h('div',{class:'two'}, h('label',{class:'f'},'8. Jumlah kos penyelenggaraan terdahulu (RM)',kos), h('label',{class:'f'},'9. Anggaran kos penyelenggaraan (RM)',ang)),
    h('label',{class:'f'},'10. Syor dan ulasan',syor),
    h('div',{class:'two'}, h('label',{class:'f'},'11. Nama dan jawatan',n2), h('label',{class:'f'},'12. Tarikh',t2)),
    h('div',{class:'kw-sub'},'Bahagian III · Ketua Jabatan'),
    h('div',{class:'two'}, h('label',{class:'f'},'Keputusan',kep), h('label',{class:'f'},'Tarikh',t3)),
    h('label',{class:'f'},'Ulasan',ul), h('label',{class:'f'},'Nama dan jawatan',n3),
    h('div',{class:'form-actions'},btn,err)));
}
function cetakKewpa(a){
  const b2=a.b2||{}, b3=a.b3||{};
  const row=(n,l,v)=>h('tr',null,h('td',{class:'n'},n),h('td',{class:'l'},l),h('td',{class:'c'},':'),h('td',{class:'v'},v||' '));
  const lok=[a.fasiliti, lokasiPenuh(a)].filter(Boolean).join(', ');
  $('print-kewpa').replaceChildren(
    h('div',{class:'pk-code'},'KEW.PA-10'),
    h('div',{class:'pk-title'},'BORANG ADUAN KEROSAKAN ASET ALIH'),
    h('div',{class:'pk-sec'},'Bahagian I (Untuk diisi oleh Pengadu)'),
    h('table',{class:'pk-tbl'}, h('tbody',null,
      row('1.','Jenis Aset',a.jenisAset), row('2.','Nombor Siri Pendaftaran Aset/ Komponen',a.noAset), row('3.','Pengguna Terakhir',a.penggunaTerakhir),
      row('4.','Tarikh Kerosakan',a.tarikhKerosakan?fmtD(a.tarikhKerosakan):''), row('5.','Perihal Kerosakan',a.keterangan + (lok?`\n(Lokasi: ${lok})`:'')),
      row('6.','Nama Dan Jawatan',a.pelapor), row('7.','Tarikh',fmtD(a.tarikh)))),
    h('div',{class:'pk-sign'},h('span',null,'Tandatangan Pengadu')),
    h('div',{class:'pk-sec'},'Bahagian II (Untuk diisi oleh Pegawai Aset/ Pegawai Teknikal)'),
    h('table',{class:'pk-tbl'}, h('tbody',null,
      row('8.','Jumlah Kos Penyelenggaraan Terdahulu',rm(b2.kosTerdahulu)), row('9.','Anggaran Kos Penyelenggaraan',rm(b2.anggaranKos)),
      row('10.','Syor Dan Ulasan',b2.syor), row('11.','Nama Dan Jawatan',b2.namaJawatan), row('12.','Tarikh',b2.tarikh?fmtD(b2.tarikh):''))),
    h('div',{class:'pk-sign'},h('span',null,'Tandatangan Pegawai Aset/ Pegawai Teknikal')),
    h('div',{class:'pk-sec'},'Bahagian III (Keputusan Ketua Jabatan)'),
    h('table',{class:'pk-tbl'}, h('tbody',null,
      row('','Keputusan',b3.keputusan||'Diluluskan / Tidak Diluluskan'), row('','Ulasan',b3.ulasan), row('','Nama Dan Jawatan',b3.namaJawatan), row('','Tarikh',b3.tarikh?fmtD(b3.tarikh):''))),
    h('div',{class:'pk-sign'},h('span',null,'Tandatangan Ketua Jabatan')),
    h('div',{class:'pk-foot'},`No. aduan sistem: ${a.noAduan}${a.kodSemakan?` · Kod semakan status: ${a.kodSemakan}`:''} · Dicetak ${fmtDT(new Date().toISOString())}`));
  window.print();
}

function buildUpdate(a){
  const box=$('d-upd'), del=$('d-del'); del.replaceChildren();
  if (!bolehTulis()){ box.replaceChildren(); return; }
  const sSel=h('select',{id:'u-status'}, STATUS.map(s=>opt(s,s,s===a.status)));
  const ruj=h('input',{id:'u-ruj',type:'text',list:'ruj-list',maxlength:'100',placeholder:'Unit / pihak yang menerima rujukan'}); ruj.value=a.dirujukKepada||'';
  const tgl=h('input',{id:'u-tarikh',type:'date',max:todayStr(),min:a.tarikh}); tgl.value=todayStr();
  const cat=h('textarea',{id:'u-catatan',rows:'3',maxlength:'800',placeholder:'Tindakan yang diambil, no. rujukan aduan penyelenggaraan, jangkaan siap'});
  const err=h('span',{class:'err',role:'alert'}), btn=h('button',{class:'btn primary',type:'button'},'Simpan kemas kini');
  btn.addEventListener('click', async ()=>{
    err.textContent='';
    const ns=sSel.value, rj=ruj.value.trim(), tg=tgl.value, ct=cat.value.trim();
    if (!tg){ err.textContent='Masukkan tarikh tindakan.'; return; }
    if (tg<a.tarikh){ err.textContent='Tarikh tindakan tidak boleh sebelum tarikh aduan diterima.'; return; }
    if (ns===a.status && rj===(a.dirujukKepada||'') && !ct){ err.textContent='Tiada perubahan. Tukar status atau tambah catatan.'; return; }
    if ((ns==='Selesai'||ns==='Dibatalkan') && !ct){ err.textContent=`Tambah catatan untuk status ${ns}.`; return; }
    if (ns==='Dirujuk' && !rj){ err.textContent='Nyatakan pihak yang menerima rujukan.'; return; }
    btn.disabled=true; btn.textContent='Menyimpan…';
    try{ await api('kemaskini',{data:{noAduan:a.noAduan,status:ns,dirujukKepada:rj,tarikh:tg,catatan:ct}}); toast('Kemas kini disimpan.'); await muat(); bukaButiran(a.noAduan,true); }
    catch(ex){ if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; btn.disabled=false; btn.textContent='Simpan kemas kini'; }
  });
  box.replaceChildren(h('div',{class:'upd'}, h('h3',null,'Kemas kini status'), h('datalist',{id:'ruj-list'},(TET.rujukan||[]).map(r=>h('option',{value:r}))),
    h('div',{class:'two'}, h('label',{class:'f'},'Status',sSel), h('label',{class:'f'},'Tarikh tindakan',tgl)),
    h('label',{class:'f'},'Dirujuk kepada',ruj), h('label',{class:'f'},'Catatan tindakan',cat), h('div',{class:'form-actions'},btn,err)));
  if (isAdmin()){
    const start=h('button',{class:'btn danger',type:'button'},'Padam aduan ini');
    start.addEventListener('click',()=>{
      const yes=h('button',{class:'btn danger',type:'button'},'Ya, padam'), no=h('button',{class:'btn',type:'button'},'Batal');
      no.addEventListener('click',()=>buildUpdate(a));
      yes.addEventListener('click', async ()=>{ yes.disabled=true; try{ await api('padam',{noAduan:a.noAduan}); closeDrawer(); toast(`Aduan ${a.noAduan} dipadam.`); await muat(); }catch(ex){ yes.disabled=false; if(ex.code!=='UNAUTHORIZED') toast(ex.message); } });
      del.replaceChildren(h('div',{class:'confirm'}, h('span',null,'Padam terus aduan ini dan rekod tindakannya? Untuk aduan tersalah daftar sahaja. Gunakan status Dibatalkan untuk kes lain.'), yes, no));
    });
    del.replaceChildren(start);
  }
}

/* ---------- Pengguna ---------- */
async function muatPengguna(){
  if (!isAdmin()) return;
  try{ const r=await api('senaraiPengguna'); PENGGUNA=r.pengguna||[]; renderPengguna(); }catch(ex){ if(ex.code!=='UNAUTHORIZED') toast(ex.message); }
}
function renderPengguna(){
  const t=$('tbl-pengguna');
  if (!PENGGUNA.length){ t.replaceChildren(h('tbody',null,h('tr',null,h('td',{class:'muted'},'Belum ada pengguna.')))); return; }
  t.replaceChildren(h('thead',null,h('tr',null,h('th',null,'Nama'),h('th',null,'Emel'),h('th',null,'Peranan'),h('th',null,'Fasiliti'),h('th',null,'Status'),h('th',null,'Log masuk terakhir'),h('th',null,''))),
    h('tbody',null,PENGGUNA.map(u=>{
      const ed=h('button',{class:'btn small',type:'button'},'Edit'); ed.addEventListener('click',()=>editPengguna(u));
      const rs=h('button',{class:'btn small',type:'button'},'Set semula kata laluan'); rs.addEventListener('click',()=>setSemula(u.email, rs));
      return h('tr',null,h('td',null,u.nama),h('td',null,u.email),h('td',null,PERANAN_LABEL[u.peranan]||u.peranan),h('td',null,u.fasiliti||'—'),
        h('td',null,u.aktif?(u.tukarKataLaluan?'Aktif · belum tukar kata laluan':'Aktif'):'Tidak aktif'),h('td',null,u.logMasukTerakhir?fmtDT(u.logMasukTerakhir):'—'),
        h('td',null,h('div',{style:'display:flex;gap:6px'},ed,rs)));
    })));
}
function revealPw(email, pw){
  const copy=h('button',{class:'btn small',type:'button'},'Salin');
  copy.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(pw); toast('Disalin.'); }catch(e){ toast('Pilih teks dan salin secara manual.'); } });
  const close=h('button',{class:'btn small',type:'button'},'Sudah disalin, tutup'); close.addEventListener('click',()=>$('pw-reveal').replaceChildren());
  $('pw-reveal').replaceChildren(h('div',{class:'secret-box'}, h('b',null,`Kata laluan sementara untuk ${email}`), h('span',{class:'secret'},pw),
    h('span',{class:'hint'},'Paparan sekali sahaja. Berikan kepada pengguna secara terus (bukan dalam kumpulan WhatsApp). Pengguna perlu menukarnya semasa log masuk pertama.'), h('div',{class:'form-actions'},copy,close)));
  window.scrollTo(0,0);
}
async function setSemula(email, btn){
  btn.disabled=true;
  try{ const r=await api('setSemula',{email}); revealPw(r.email, r.kataLaluanSementara); await muatPengguna(); }catch(ex){ if(ex.code!=='UNAUTHORIZED') toast(ex.message); }
  finally{ btn.disabled=false; }
}
function syncPeranan(){ $('u-fas-wrap').hidden = $('u-peranan').value!=='pentadbir'; }
$('u-peranan').addEventListener('change',syncPeranan);
function resetUForm(){ editEmail=null; $('u-form').reset(); $('u-email').disabled=false; $('u-title').textContent='Tambah pengguna'; $('u-save').textContent='Tambah pengguna'; $('u-cancel').hidden=true; $('u-err').textContent=''; syncPeranan(); }
function editPengguna(u){
  editEmail=u.email; $('u-email').value=u.email; $('u-email').disabled=true; $('u-nama').value=u.nama||''; $('u-peranan').value=u.peranan; $('u-fasiliti').value=u.fasiliti||''; $('u-aktif').checked=!!u.aktif;
  $('u-title').textContent='Edit pengguna'; $('u-save').textContent='Simpan perubahan'; $('u-cancel').hidden=false; syncPeranan(); $('u-nama').focus();
}
$('u-cancel').addEventListener('click',resetUForm);
$('u-form').addEventListener('submit', async e=>{
  e.preventDefault();
  const err=$('u-err'); err.textContent='';
  const d={email:$('u-email').value.trim().toLowerCase(), nama:$('u-nama').value.trim(), peranan:$('u-peranan').value, fasiliti:$('u-fasiliti').value, aktif:$('u-aktif').checked, baru:!editEmail};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)){ err.textContent='Masukkan emel yang sah.'; return; }
  if (!d.nama){ err.textContent='Masukkan nama.'; return; }
  if (d.peranan==='pentadbir' && !d.fasiliti){ err.textContent='Pilih fasiliti untuk pentadbir fasiliti.'; return; }
  if (!editEmail && PENGGUNA.some(u=>u.email.toLowerCase()===d.email)){ err.textContent='Emel ini sudah berdaftar. Gunakan Edit.'; return; }
  const btn=$('u-save'); btn.disabled=true;
  try{ const r=await api('simpanPengguna',{data:d}); PENGGUNA=r.pengguna||PENGGUNA; renderPengguna(); if(r.kataLaluanSementara) revealPw(r.email, r.kataLaluanSementara); else toast('Pengguna dikemas kini.'); resetUForm(); }
  catch(ex){ if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; }
  finally{ btn.disabled=false; }
});

/* ---------- Tetapan ---------- */
function renderTetapan(){
  if (['s-fas','s-kd','s-lok','s-ruj','s-had'].includes(document.activeElement && document.activeElement.id)) return;
  $('s-lok').value=(TET.lokasi||[]).join('\n');
  $('s-fas').value=(TET.fasiliti||[]).join('\n'); $('s-kd').value=(TET.klinikDesa||[]).map(k=>`${k.nama} | ${k.induk}`).join('\n'); $('s-ruj').value=(TET.rujukan||[]).join('\n'); $('s-had').value=had();
}
const lines = s => [...new Set(s.split('\n').map(x=>x.trim()).filter(Boolean))];
$('s-save').addEventListener('click', async ()=>{
  const err=$('s-err'); err.textContent='';
  const n=Number($('s-had').value), fas=lines($('s-fas').value);
  const kd=lines($('s-kd').value).map(l=>{ const [nama,induk]=l.split('|').map(x=>(x||'').trim()); return {nama, induk}; });
  const salahKd=kd.find(k=>!k.nama || !fas.includes(k.induk));
  if (salahKd){ err.textContent=`Semak baris klinik desa "${salahKd.nama||'(kosong)'}": KK induk mesti sama dengan nama dalam senarai fasiliti.`; return; }
  if (!fas.length){ err.textContent='Senarai fasiliti tidak boleh kosong.'; return; }
  const lok=lines($('s-lok').value);
  if (!lok.length){ err.textContent='Senarai lokasi tidak boleh kosong.'; return; }
  if (!Number.isInteger(n)||n<1||n>365){ err.textContent='Had hari mesti nombor bulat antara 1 dan 365.'; return; }
  const b=$('s-save'); b.disabled=true;
  try{ const r=await api('simpanTetapan',{data:{fasiliti:fas, klinikDesa:kd, lokasi:lok, rujukan:lines($('s-ruj').value), hadHari:n}}); TET=r.tetapan; renderAll(); toast('Tetapan disimpan.'); }
  catch(ex){ if(ex.code!=='UNAUTHORIZED') err.textContent=ex.message; }
  finally{ b.disabled=false; }
});

/* ---------- Render ---------- */
function renderAll(){ fillYears($('r-tahun'),false); fillYears($('l-tahun'),true); fillFasiliti(); fillLokasi(); renderRingkasan(); renderSenarai(); renderTetapan(); }

/* ---------- Semak status (pengadu, tanpa log masuk) ---------- */
function showSemak(no, kod){
  closeDrawer(); screen('screen-semak');
  if (no!=null) $('sk-no').value=no; if (kod!=null) $('sk-kod').value=kod;
  $('sk-err').textContent='';
  if ($('sk-no').value && $('sk-kod').value) semak(); else setTimeout(()=>$('sk-no').focus(),0);
}
async function semak(){
  const err=$('sk-err'), out=$('sk-hasil'); err.textContent='';
  const no=$('sk-no').value.trim().toUpperCase(), kod=$('sk-kod').value.trim().toUpperCase();
  $('sk-no').value=no; if (!$('sk-kod').value.includes('@')) $('sk-kod').value=kod;
  if (!/^KRN-\d{4}-\d{4,6}$/.test(no)){ err.textContent='Format No. aduan: KRN-2026-0001.'; out.replaceChildren(); return; }
  const emel=$('sk-kod').value.trim();
  const gunaEmel=emel.includes('@');
  if (gunaEmel ? !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emel) : !/^[A-Z0-9]{6}$/.test(kod)){ err.textContent='Masukkan emel yang sah, atau kod semakan 6 aksara.'; out.replaceChildren(); return; }
  const btn=$('sk-btn'); btn.disabled=true; btn.textContent='Menyemak…';
  try{
    const r=await api('semak',{noAduan:no, kod: gunaEmel ? emel.toLowerCase() : kod});
    const a=r.aduan, kv=(k,v)=>[h('dt',null,k),h('dd',null,v||'—')];
    const ket = a.status==='Selesai' ? `Kerosakan telah selesai dibaiki pada ${fmtD(a.tarikhSelesai)}.`
      : a.status==='Dibatalkan' ? 'Aduan ini telah dibatalkan. Hubungi pentadbir fasiliti untuk maklumat lanjut.'
      : a.status==='Dirujuk' ? `Aduan telah dirujuk${a.dirujukKepada?` kepada ${a.dirujukKepada}`:''} untuk tindakan.`
      : a.status==='Dalam Tindakan' ? 'Kerja pembaikan sedang dijalankan.' : 'Aduan telah diterima dan sedang menunggu tindakan.';
    out.replaceChildren(h('div',{class:'sk-res'},
      h('div',{class:'sk-top'}, h('span',{class:'tagno'},a.noAduan), h('span',{class:'pill '+stCls(a.status)},a.status)),
      h('div',{style:'font-size:15px;font-weight:500'},ket),
      h('dl',{class:'kv'}, kv('Fasiliti',a.fasiliti), kv('Lokasi',a.lokasi), kv('Kerosakan',a.jenisAset||a.jenis), kv('Tarikh aduan diterima',fmtD(a.tarikh)),
        a.kategoriAset==='Aset Alih'?kv('Kelulusan KEW.PA-10',a.keputusanKJ||'Dalam proses'):null, kv('Kemas kini terakhir',fmtD(a.dikemaskini))),
      (r.sejarah||[]).length ? h('div',null, h('div',{class:'eyebrow',style:'margin-bottom:8px'},'Sejarah status'),
        h('ol',{class:'timeline'}, r.sejarah.slice().reverse().map(x=>h('li',null,h('b',null,x.status),h('div',{class:'meta'},fmtD(x.tarikh)))))) : null));
  }catch(ex){ out.replaceChildren(); err.textContent=ex.message; }
  finally{ btn.disabled=false; btn.textContent='Semak status'; }
}
$('sk-form').addEventListener('submit', e=>{ e.preventDefault(); semak(); });
$('btn-ke-semak').addEventListener('click', ()=>showSemak());
$('btn-ke-login').addEventListener('click', ()=>{ $('sk-hasil').replaceChildren(); if (ME) screen('screen-app'); else showLogin(); });

/* ---------- Mula ---------- */
resetForm(); resetUForm();
(async ()=>{
  const q=new URLSearchParams(location.search);
  if (q.get('no') || q.get('kod') || location.hash==='#semak'){ showSemak(q.get('no')||'', q.get('kod')||''); return; }
  if (!configured()){ showLogin(); return; }
  if (!getToken()){ showLogin(); return; }
  try{ const r=await api('saya'); ME=r.user; if (ME.tukarKataLaluan) showTukar(true); else await mulaApp(); }
  catch(ex){ if(ex.code!=='UNAUTHORIZED' && ex.code!=='PASSWORD_CHANGE') showLogin(ex.message); }
})();
})();
