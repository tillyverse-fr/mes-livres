'use strict';
/* Ma bibliothèque de livres anciens — appli 100 % locale (IndexedDB), sans serveur. */

// ---------- Petits outils ----------
const $app = document.getElementById('app');
const THEMES_BASE = ['Paris', 'Histoire', 'Plans et cartes', 'Photographies', 'Art', 'Littérature', 'Autre'];
const STATUTS = [['maison', 'À la maison'], ['vente', 'À vendre'], ['vendu', 'Vendu']];
const ETATS = [['Bon', 'bon'], ['Moyen', 'moyen'], ['Abîmé', 'abime']];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const euro = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateFr = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };
const libStatut = s => (STATUTS.find(x => x[0] === s) || STATUTS[0])[1];

function toast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function modal(html) { const m = document.getElementById('modal'); m.innerHTML = '<div class="boite">' + html + '</div>'; m.hidden = false; }
function fermerModal() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; }

// ---------- Base de données (IndexedDB) ----------
let _db;
function ouvrirBase() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, ko) => {
    const r = indexedDB.open('collection-livres', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('livres', { keyPath: 'id' });   // fiches (avec une petite miniature)
      d.createObjectStore('photos', { keyPath: 'id' });   // toutes les photos, par livre
      d.createObjectStore('meta', { keyPath: 'cle' });    // réglages
    };
    r.onsuccess = () => { _db = r.result; ok(_db); };
    r.onerror = () => ko(r.error);
  });
}
async function dbOp(store, mode, fn) {
  const d = await ouvrirBase();
  return new Promise((ok, ko) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => ok(req ? req.result : undefined);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  });
}
const dbGet = (s, k) => dbOp(s, 'readonly', o => o.get(k));
const dbAll = s => dbOp(s, 'readonly', o => o.getAll());
const dbPut = (s, v) => dbOp(s, 'readwrite', o => o.put(v));
const dbDel = (s, k) => dbOp(s, 'readwrite', o => o.delete(k));
const getMeta = async cle => { const r = await dbGet('meta', cle); return r ? r.valeur : undefined; };
const setMeta = (cle, valeur) => dbPut('meta', { cle, valeur });

let LIVRES = [];
let THEMES_PERSO = [];
async function chargerLivres() {
  LIVRES = await dbAll('livres');
  THEMES_PERSO = (await getMeta('themes')) || [];
}
const tousThemes = () => {
  const vus = new Set(THEMES_BASE), plus = [];
  THEMES_PERSO.concat(LIVRES.map(l => l.theme)).forEach(t => { if (t && !vus.has(t)) { vus.add(t); plus.push(t); } });
  return THEMES_BASE.slice(0, -1).concat(plus, ['Autre']);
};

// ---------- Photos ----------
function lireImage(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}
async function redimensionner(src, largMax, qualite) {
  const img = await lireImage(src);
  const k = Math.min(1, largMax / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', qualite);
}
async function compresserFichier(fichier) {
  const url = URL.createObjectURL(fichier);
  try { return await redimensionner(url, 1200, 0.7); } finally { URL.revokeObjectURL(url); }
}

// ---------- Sauvegarde d'une fiche ----------
async function enregistrerLivre(livre, photos) {
  const thumb = await redimensionner(photos[0], 180, 0.6);
  const fiche = Object.assign({}, livre, { thumb });
  await dbPut('photos', { id: livre.id, liste: photos });
  await dbPut('livres', fiche);
  const i = LIVRES.findIndex(l => l.id === livre.id);
  if (i >= 0) LIVRES[i] = fiche; else LIVRES.push(fiche);
}
async function supprimerLivre(id) {
  await dbDel('livres', id); await dbDel('photos', id);
  LIVRES = LIVRES.filter(l => l.id !== id);
}

// ---------- Doublons ----------
function trouverDoublon(d, sauf) {
  const isbn = String(d.isbn || '').replace(/\D/g, '');
  const t = norm(d.titre), a = norm(d.auteur);
  return LIVRES.find(l => {
    if (l.id === sauf) return false;
    if (isbn && String(l.isbn || '').replace(/\D/g, '') === isbn) return true;
    if (!t || norm(l.titre) !== t) return false;
    const a2 = norm(l.auteur);
    return !a || !a2 || a === a2;
  });
}

// ---------- Recherche de livres sur internet ----------
async function recupJson(url) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}
const nettoyerIsbn = s => String(s || '').replace(/[^0-9Xx]/g, '');
function deOpenLibrary(d) {
  const an = String(d.first_publish_year || d.publish_date || '').match(/\d{4}/);
  const isbns = (d.isbn || []).filter(Boolean);
  return {
    titre: d.title || '', auteur: (d.author_name || []).join(', '), editeur: (d.publisher || [])[0] || '',
    annee: an ? an[0] : '', isbn: isbns.find(x => x.length === 13) || isbns[0] || '',
    coverUrl: d.cover_i ? 'https://covers.openlibrary.org/b/id/' + d.cover_i + '-M.jpg' : ''
  };
}
function deGoogle(it) {
  const v = it.volumeInfo || {};
  const an = String(v.publishedDate || '').match(/\d{4}/);
  const ids = v.industryIdentifiers || [];
  const id = (ids.find(x => x.type === 'ISBN_13') || ids[0] || {}).identifier || '';
  const img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
  return {
    titre: [v.title, v.subtitle].filter(Boolean).join(' : '), auteur: (v.authors || []).join(', '), editeur: v.publisher || '',
    annee: an ? an[0] : '', isbn: id, coverUrl: img ? img.replace('http://', 'https://').replace('&edge=curl', '') : ''
  };
}
async function chercherMots(q) {
  const ol = recupJson('https://openlibrary.org/search.json?limit=12&fields=title,author_name,first_publish_year,publisher,isbn,cover_i&q=' + encodeURIComponent(q))
    .then(j => (j.docs || []).map(deOpenLibrary));
  const gb = recupJson('https://www.googleapis.com/books/v1/volumes?maxResults=12&printType=books&q=' + encodeURIComponent(q))
    .then(j => (j.items || []).map(deGoogle));
  const [a, b] = await Promise.allSettled([ol, gb]);
  if (a.status === 'rejected' && b.status === 'rejected') throw new Error('reseau');
  const tout = [].concat(a.value || [], b.value || []).filter(r => r.titre);
  const vus = new Set();
  return tout.filter(r => { const k = norm(r.titre) + '|' + norm(r.auteur); if (vus.has(k)) return false; vus.add(k); return true; }).slice(0, 14);
}
async function chercherIsbn(isbn) {
  let ok = false;
  try {
    const j = await recupJson('https://www.googleapis.com/books/v1/volumes?maxResults=1&q=isbn:' + isbn);
    ok = true;
    if (j.items && j.items[0]) { const r = deGoogle(j.items[0]); r.isbn = isbn; if (r.titre) return r; }
  } catch (e) { /* on essaie l'autre source */ }
  try {
    const j = await recupJson('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN:' + isbn);
    ok = true;
    const d = j['ISBN:' + isbn];
    if (d) {
      const an = String(d.publish_date || '').match(/\d{4}/);
      return {
        titre: [d.title, d.subtitle].filter(Boolean).join(' : '), auteur: (d.authors || []).map(a => a.name).join(', '),
        editeur: ((d.publishers || [])[0] || {}).name || '', annee: an ? an[0] : '', isbn,
        coverUrl: (d.cover && (d.cover.medium || d.cover.large)) || ''
      };
    }
  } catch (e) { /* ignoré */ }
  if (!ok) throw new Error('reseau');
  return null;
}
async function chargerCouverture(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.blob();
    const data = await compresserFichier(b);
    const img = await lireImage(data);
    return img.naturalWidth > 60 ? data : null;
  } catch (e) { return null; }
}

// ---------- Navigation ----------
let quitter = null;      // fonction de nettoyage de l'écran courant (ex. arrêter la caméra)
let F = null;            // état du formulaire en cours
let filtres = { texte: '', statut: 'tous', theme: '' };

function route() {
  if (quitter) { const q = quitter; quitter = null; q(); }
  fermerModal();
  const h = (location.hash || '#/').slice(1);
  const parts = h.split('/').filter(Boolean);
  const [p, arg] = [parts[0] || '', parts[1]];
  document.querySelectorAll('#tabs a').forEach(a => {
    const t = a.dataset.tab;
    a.classList.toggle('on', (t === 'accueil' && (p === '' || p === 'livre')) || (t === 'ajouter' && ['ajouter', 'scan', 'chercher', 'formulaire'].includes(p)) || (t === 'collection' && ['collection', 'impression'].includes(p)));
  });
  window.scrollTo(0, 0);
  if (p === '') return vueAccueil();
  if (p === 'ajouter') return vueAjouter();
  if (p === 'scan') return vueScan();
  if (p === 'chercher') return vueChercher();
  if (p === 'formulaire') return F ? vueFormulaire() : (location.hash = '#/ajouter');
  if (p === 'livre') return vueFiche(arg);
  if (p === 'collection') return vueCollection();
  if (p === 'impression') return vueImpression();
  vueAccueil();
}

// ---------- ACCUEIL ----------
async function rappelSauvegarde() {
  const d = await getMeta('derniereSauvegarde');
  if (!LIVRES.length) return '';
  const jours = d ? (Date.now() - new Date(d)) / 864e5 : 999;
  if (jours < 30) return '';
  return '<div class="bandeau">⚠️ Pensez à sauvegarder votre collection.' + (d ? ' Dernière sauvegarde : ' + dateFr(d) + '.' : ' Vous ne l\'avez pas encore fait.') +
    '<a class="btn primaire" style="margin:10px 0 0" href="#/collection">Sauvegarder maintenant</a></div>';
}

async function vueAccueil() {
  const rappel = await rappelSauvegarde();
  $app.innerHTML = '<h1>Ma bibliothèque</h1>' + rappel +
    '<a class="btn primaire gros" href="#/ajouter">＋ Ajouter un livre</a>' +
    '<input type="search" id="q" placeholder="Chercher (titre, auteur, thème)" value="' + esc(filtres.texte) + '" aria-label="Chercher">' +
    '<div class="choix" style="margin:12px 0" id="fstat"></div>' +
    '<select id="fthe" aria-label="Thème" style="margin-bottom:14px"></select>' +
    '<div id="liste"></div>';
  const q = document.getElementById('q');
  q.oninput = () => { filtres.texte = q.value; dessinerListe(); };
  document.getElementById('fstat').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    filtres.statut = b.dataset.s; dessinerFiltres(); dessinerListe();
  };
  document.getElementById('fthe').onchange = e => { filtres.theme = e.target.value; dessinerListe(); };
  dessinerFiltres(); dessinerListe();
}
function dessinerFiltres() {
  const f = document.getElementById('fstat');
  f.innerHTML = [['tous', 'Tous']].concat(STATUTS).map(([k, l]) => '<button data-s="' + k + '" class="' + (filtres.statut === k ? 'on' : '') + '">' + l + '</button>').join('');
  const s = document.getElementById('fthe');
  s.innerHTML = '<option value="">Tous les thèmes</option>' + tousThemes().filter(t => LIVRES.some(l => l.theme === t)).map(t => '<option' + (filtres.theme === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
}
function dessinerListe() {
  const el = document.getElementById('liste'); if (!el) return;
  const mots = norm(filtres.texte).split(' ').filter(Boolean);
  const res = LIVRES.filter(l =>
    (filtres.statut === 'tous' || l.statut === filtres.statut) &&
    (!filtres.theme || l.theme === filtres.theme) &&
    mots.every(m => norm([l.titre, l.auteur, l.theme, l.editeur].join(' ')).includes(m))
  ).sort((a, b) => norm(a.titre).localeCompare(norm(b.titre)));
  if (!res.length) {
    el.innerHTML = '<div class="vide">' + (LIVRES.length ? 'Aucun livre ne correspond.' : 'Votre collection est vide.<br>Touchez « Ajouter un livre » pour commencer.') + '</div>';
    return;
  }
  el.innerHTML = '<p class="muted small">' + res.length + ' livre' + (res.length > 1 ? 's' : '') + '</p>' + res.map(l =>
    '<a class="livre" href="#/livre/' + l.id + '"><img class="mini" alt="" src="' + l.thumb + '"><div class="infos"><div class="t">' + esc(l.titre) + '</div>' +
    (l.auteur ? '<div>' + esc(l.auteur) + '</div>' : '') + (l.annee ? '<div class="muted">' + esc(l.annee) + '</div>' : '') +
    '<span class="badge ' + l.statut + '">' + libStatut(l.statut) + '</span></div></a>').join('');
}

// ---------- AJOUTER ----------
function vueAjouter() {
  $app.innerHTML = '<h1>Ajouter un livre</h1><p class="muted">Choisissez comment vous voulez faire :</p>' +
    '<a class="btn primaire gros" href="#/scan">📷 Scanner le code-barres</a>' +
    '<a class="btn primaire gros" href="#/chercher">🔎 Chercher par titre ou auteur</a>' +
    '<a class="btn primaire gros" href="#/formulaire" id="manuel">✍️ Je remplis moi-même</a>' +
    '<p class="muted small" style="margin-top:14px">Les très vieux livres n\'ont souvent pas de code-barres : « Je remplis moi-même » est fait pour eux.</p>';
  document.getElementById('manuel').onclick = () => { F = nouveauFormulaire({}, []); };
}

function nouveauFormulaire(data, photos) {
  return {
    id: null, photos: photos.slice(), plus: false, skipDup: false,
    d: Object.assign({ titre: '', auteur: '', editeur: '', annee: '', isbn: '', theme: '', etat: '', prixAchat: '', note: '', statut: 'maison', prixVise: '', prixVendu: '', dateVente: '', valeur: '', originale: false, dedicace: false, rangement: '' }, data)
  };
}

// Un livre trouvé (scan ou recherche) : on vérifie les doublons puis on ouvre la fiche pré-remplie
async function proposerLivre(data) {
  const suite = async () => {
    fermerModal();
    $app.innerHTML = '<div class="attente">Un instant…</div>';
    const photo = await chargerCouverture(data.coverUrl);
    delete data.coverUrl;
    F = nouveauFormulaire(data, photo ? [photo] : []);
    F.skipDup = true;
    location.hash = '#/formulaire';
  };
  const dup = trouverDoublon(data);
  if (dup) modalDoublon(dup, suite); else suite();
}
function modalDoublon(dup, ajouterQuandMeme) {
  modal('<h2 style="margin-top:0">Vous avez déjà ce livre</h2>' +
    '<div class="livre"><img class="mini" alt="" src="' + dup.thumb + '"><div class="infos"><div class="t">' + esc(dup.titre) + '</div><div>' + esc(dup.auteur) + '</div><div class="muted">' + esc(dup.annee) + '</div></div></div>' +
    '<a class="btn primaire" href="#/livre/' + dup.id + '">Voir la fiche</a><button id="quandMeme">L\'ajouter quand même</button>');
  document.getElementById('quandMeme').onclick = ajouterQuandMeme;
}

// ----- Scanner -----
function vueScan() {
  $app.innerHTML = '<h1>Scanner le code-barres</h1><p>Placez le code-barres du livre (au dos) dans le cadre.</p>' +
    '<div class="cadre"><div id="lecteur"></div></div><div id="msgscan"></div><button id="annuler">Annuler</button>' +
    '<a class="btn" href="#/formulaire" id="manuel2">Pas de code-barres ? Je remplis moi-même</a>';
  document.getElementById('manuel2').onclick = () => { F = nouveauFormulaire({}, []); };
  document.getElementById('annuler').onclick = () => { location.hash = '#/ajouter'; };
  const msg = document.getElementById('msgscan');
  if (typeof Html5Qrcode === 'undefined') { msg.innerHTML = '<div class="erreur">Le lecteur n\'est pas disponible. Vous pouvez remplir la fiche vous-même.</div>'; return; }
  const scanner = new Html5Qrcode('lecteur', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A], verbose: false });
  let actif = true, demarre = false, trouve = false;
  quitter = () => {
    actif = false;
    if (demarre) scanner.stop().then(() => scanner.clear()).catch(() => {});
  };
  scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 280, height: 150 } }, async texte => {
    if (trouve || !actif) return;
    trouve = true;
    const isbn = nettoyerIsbn(texte);
    try { await scanner.stop(); demarre = false; } catch (e) { /* ignoré */ }
    msg.innerHTML = '<div class="attente">Code lu. Recherche du livre…</div>';
    if (!navigator.onLine) { msg.innerHTML = '<div class="info">Pas de connexion internet pour le moment. Vous pouvez remplir la fiche vous-même.</div>'; return; }
    try {
      const r = await chercherIsbn(isbn);
      if (!actif) return;
      if (r) return proposerLivre(r);
      msg.innerHTML = '<div class="info">Pas trouvé, vous pouvez le remplir vous-même.</div><a class="btn primaire" href="#/formulaire" id="m3">Remplir moi-même</a>';
      document.getElementById('m3').onclick = () => { F = nouveauFormulaire({ isbn }, []); };
    } catch (e) {
      msg.innerHTML = '<div class="info">Impossible de joindre internet. Vous pouvez remplir la fiche vous-même.</div><a class="btn primaire" href="#/formulaire" id="m3">Remplir moi-même</a>';
      document.getElementById('m3').onclick = () => { F = nouveauFormulaire({ isbn }, []); };
    }
  }, () => {}).then(() => { demarre = true; if (!actif) quitter(); })
    .catch(() => { msg.innerHTML = '<div class="erreur">La caméra ne peut pas s\'ouvrir. Vérifiez que vous avez autorisé la caméra pour ce site (Réglages de l\'iPhone &gt; Safari &gt; Appareil photo). Vous pouvez aussi remplir la fiche vous-même.</div>'; });
}

// ----- Recherche par titre / auteur -----
function vueChercher() {
  $app.innerHTML = '<h1>Chercher un livre</h1><label for="mots" style="margin-top:0">Quelques mots du titre ou de l\'auteur</label>' +
    '<input type="search" id="mots" placeholder="Ex. : Paris Haussmann" enterkeyhint="search">' +
    '<button class="primaire" id="go" style="margin-top:12px">Chercher</button><div id="resultats"></div>' +
    '<a class="btn" href="#/formulaire" id="manuel2">Je remplis moi-même</a>';
  document.getElementById('manuel2').onclick = () => { F = nouveauFormulaire({}, []); };
  const mots = document.getElementById('mots'), out = document.getElementById('resultats');
  let RES = [];
  const lancer = async () => {
    const q = mots.value.trim(); if (!q) return;
    mots.blur();
    if (!navigator.onLine) { out.innerHTML = '<div class="info">Pas de connexion internet pour le moment. La recherche ne marche pas sans internet, mais vous pouvez remplir la fiche vous-même.</div>'; return; }
    out.innerHTML = '<div class="attente">Recherche en cours…</div>';
    try {
      RES = await chercherMots(q);
      if (!RES.length) { out.innerHTML = '<div class="info">Pas trouvé, vous pouvez le remplir vous-même.</div>'; return; }
      out.innerHTML = '<p class="muted" style="margin-top:14px">Touchez le bon livre :</p>' + RES.map((r, i) =>
        '<button class="res" data-i="' + i + '">' + (r.coverUrl ? '<img alt="" loading="lazy" src="' + esc(r.coverUrl) + '">' : '<div class="sans"></div>') +
        '<div><div class="t">' + esc(r.titre) + '</div><div>' + esc(r.auteur) + '</div><div class="muted">' + esc(r.annee) + '</div></div></button>').join('') +
        '<p class="muted small">Ce n\'est pas le bon ? Essayez d\'autres mots, ou remplissez vous-même.</p>';
    } catch (e) {
      out.innerHTML = '<div class="info">Impossible de joindre internet. Vous pouvez remplir la fiche vous-même.</div>';
    }
  };
  document.getElementById('go').onclick = lancer;
  mots.onkeydown = e => { if (e.key === 'Enter') lancer(); };
  out.onclick = e => { const b = e.target.closest('.res'); if (b) proposerLivre(Object.assign({}, RES[+b.dataset.i])); };
  mots.focus();
}

// ---------- FORMULAIRE ----------
function lireChamp(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }
function collecter() {
  if (!document.getElementById('f_titre')) return;
  const d = F.d;
  d.titre = lireChamp('f_titre'); d.auteur = lireChamp('f_auteur'); d.editeur = lireChamp('f_editeur'); d.annee = lireChamp('f_annee').replace(/\D/g, '').slice(0, 4);
  d.prixAchat = lireChamp('f_achat'); d.note = lireChamp('f_note');
  d.prixVise = lireChamp('f_vise'); d.prixVendu = lireChamp('f_vendu'); d.dateVente = lireChamp('f_date');
  d.valeur = lireChamp('f_valeur'); d.rangement = lireChamp('f_range');
  F.plus = document.getElementById('f_plus').open;
}
function redessiner() { const y = window.scrollY; collecter(); vueFormulaire(); window.scrollTo(0, y); }

function vueFormulaire() {
  const d = F.d, th = tousThemes();
  if (d.theme && !th.includes(d.theme)) th.splice(th.length - 1, 0, d.theme);
  $app.innerHTML = '<h1>' + (F.id ? 'Modifier le livre' : 'Fiche du livre') + '</h1><div id="erreurs"></div>' +
    '<h3>Photos <span class="muted small">(la 1re = la couverture)</span></h3>' +
    '<div class="photos">' + F.photos.map((p, i) => '<div class="photo"><img alt="" src="' + p + '"><button class="x" data-act="suppPhoto" data-i="' + i + '" aria-label="Retirer cette photo">✕</button>' +
      (i === 0 ? '<div class="cov">Couverture</div>' : '<button class="cov" data-act="couv" data-i="' + i + '">★ Couverture</button>') + '</div>').join('') + '</div>' +
    '<div class="row"><button class="primaire" data-act="photo">📷 Prendre une photo</button><button data-act="galerie">🖼️ Galerie</button></div>' +
    '<input type="file" id="fileCam" accept="image/*" capture="environment" hidden><input type="file" id="fileGal" accept="image/*" multiple hidden>' +
    '<label for="f_titre">Titre *</label><input type="text" id="f_titre" value="' + esc(d.titre) + '" autocomplete="off">' +
    '<label for="f_auteur">Auteur</label><input type="text" id="f_auteur" value="' + esc(d.auteur) + '" autocomplete="off">' +
    '<label for="f_editeur">Éditeur</label><input type="text" id="f_editeur" value="' + esc(d.editeur) + '" autocomplete="off">' +
    '<label for="f_annee">Année d\'édition</label><input type="text" id="f_annee" inputmode="numeric" maxlength="4" value="' + esc(d.annee) + '">' +
    '<label>Thème</label><div class="choix">' + th.map(t => '<button data-act="theme" data-v="' + esc(t) + '" class="' + (d.theme === t ? 'on' : '') + '">' + esc(t) + '</button>').join('') +
    '<button data-act="nouveauTheme">＋ Un autre thème</button></div>' +
    '<label>État</label><div class="choix trois">' + ETATS.map(([e, c]) => '<button data-act="etat" data-v="' + e + '" class="' + c + ' ' + (d.etat === e ? 'on' : '') + '">' + e + '</button>').join('') + '</div>' +
    '<label for="f_achat">Prix d\'achat (€)</label><input type="text" id="f_achat" inputmode="decimal" value="' + esc(d.prixAchat) + '">' +
    '<label for="f_note">Note</label><textarea id="f_note">' + esc(d.note) + '</textarea>' +
    '<label>Statut</label><div class="choix trois">' + STATUTS.map(([k, l]) => '<button data-act="statut" data-v="' + k + '" class="' + (d.statut === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
    (d.statut === 'vente' ? '<label for="f_vise">Prix de vente visé (€)</label><input type="text" id="f_vise" inputmode="decimal" value="' + esc(d.prixVise) + '">' : '') +
    (d.statut === 'vendu' ? '<label for="f_vendu">Prix vendu (€)</label><input type="text" id="f_vendu" inputmode="decimal" value="' + esc(d.prixVendu) + '"><label for="f_date">Date de la vente</label><input type="date" id="f_date" value="' + esc(d.dateVente) + '">' : '') +
    '<details id="f_plus"' + (F.plus ? ' open' : '') + '><summary>Plus d\'infos</summary>' +
    '<label for="f_valeur">Valeur estimée (€)</label><input type="text" id="f_valeur" inputmode="decimal" value="' + esc(d.valeur) + '">' +
    '<label>Édition originale ?</label><div class="choix"><button data-act="oui" data-k="originale" class="' + (d.originale ? 'on' : '') + '">Oui</button><button data-act="non" data-k="originale" class="' + (!d.originale ? 'on' : '') + '">Non</button></div>' +
    '<label>Dédicace ?</label><div class="choix"><button data-act="oui" data-k="dedicace" class="' + (d.dedicace ? 'on' : '') + '">Oui</button><button data-act="non" data-k="dedicace" class="' + (!d.dedicace ? 'on' : '') + '">Non</button></div>' +
    '<label for="f_range">Rangement (où il se trouve)</label><input type="text" id="f_range" value="' + esc(d.rangement) + '" style="margin-bottom:14px"></details>' +
    '<button class="primaire gros" data-act="enregistrer">✔ Enregistrer</button><button data-act="annulerForm">Annuler</button>';
  const trait = async (files) => {
    for (const f of files) { try { F.photos.push(await compresserFichier(f)); } catch (e) { toast('Cette photo n\'a pas pu être lue.'); } }
    redessiner();
  };
  document.getElementById('fileCam').onchange = e => trait([...e.target.files]);
  document.getElementById('fileGal').onchange = e => trait([...e.target.files]);
}

function erreurForm(txt) {
  document.getElementById('erreurs').innerHTML = '<div class="erreur">' + txt + '</div>';
  window.scrollTo(0, 0);
}
async function validerEtEnregistrer() {
  collecter();
  const d = F.d, pb = [];
  if (!d.titre) pb.push('Le titre est nécessaire.');
  if (!F.photos.length) pb.push('Ajoutez au moins une photo (la couverture).');
  if (pb.length) return erreurForm(pb.join('<br>'));
  if (!F.id && !F.skipDup) {
    const dup = trouverDoublon(d);
    if (dup) return modalDoublon(dup, () => { F.skipDup = true; fermerModal(); validerEtEnregistrer(); });
  }
  if (d.statut === 'vendu' && !d.dateVente) d.dateVente = aujourdhui();
  const livre = {
    id: F.id || nouvelId(), titre: d.titre, auteur: d.auteur, editeur: d.editeur, annee: d.annee, isbn: d.isbn || '',
    theme: d.theme, etat: d.etat, prixAchat: num(d.prixAchat), note: d.note, statut: d.statut,
    prixVise: d.statut === 'vente' ? num(d.prixVise) : (d.statut === 'vendu' ? num(d.prixVise) : null),
    prixVendu: d.statut === 'vendu' ? num(d.prixVendu) : null, dateVente: d.statut === 'vendu' ? d.dateVente : '',
    valeur: num(d.valeur), originale: !!d.originale, dedicace: !!d.dedicace, rangement: d.rangement,
    creeLe: d.creeLe || new Date().toISOString()
  };
  try {
    await enregistrerLivre(livre, F.photos);
  } catch (e) {
    return erreurForm('L\'enregistrement n\'a pas marché (le téléphone est peut-être plein). Essayez de faire de la place puis recommencez.');
  }
  F = null;
  toast('Livre enregistré ✔');
  location.hash = '#/livre/' + livre.id;
}

// ---------- FICHE LIVRE ----------
let photoVue = 0;
async function vueFiche(id) {
  const l = LIVRES.find(x => x.id === id);
  if (!l) { location.hash = '#/'; return; }
  const p = (await dbGet('photos', id)) || { liste: [l.thumb] };
  const liste = p.liste;
  photoVue = 0;
  const ligne = (t, v) => v || v === 0 ? '<dt>' + t + '</dt><dd>' + esc(v) + '</dd>' : '';
  $app.innerHTML = '<a class="lien" href="#/">← Retour à la liste</a><h1>' + esc(l.titre) + '</h1>' +
    '<img class="grande" id="grande" alt="Photo du livre" src="' + liste[0] + '">' +
    (liste.length > 1 ? '<div class="vignettes">' + liste.map((s, i) => '<img data-i="' + i + '" class="' + (i === 0 ? 'on' : '') + '" alt="" src="' + s + '">').join('') + '</div>' : '') +
    '<span class="badge ' + l.statut + '">' + libStatut(l.statut) + '</span>' +
    '<dl>' + ligne('Auteur', l.auteur) + ligne('Éditeur', l.editeur) + ligne('Année d\'édition', l.annee) + ligne('Thème', l.theme) + ligne('État', l.etat) +
    ligne('ISBN', l.isbn) + ligne('Prix d\'achat', l.prixAchat != null ? euro(l.prixAchat) : '') +
    (l.statut === 'vente' ? ligne('Prix de vente visé', l.prixVise != null ? euro(l.prixVise) : '') : '') +
    (l.statut === 'vendu' ? ligne('Prix vendu', l.prixVendu != null ? euro(l.prixVendu) : '') + ligne('Date de la vente', dateFr(l.dateVente)) : '') +
    ligne('Valeur estimée', l.valeur != null ? euro(l.valeur) : '') + ligne('Édition originale', l.originale ? 'Oui' : '') + ligne('Dédicace', l.dedicace ? 'Oui' : '') +
    ligne('Rangement', l.rangement) + ligne('Note', l.note) + '</dl>' +
    '<button class="primaire gros" id="modif">✏️ Modifier</button><button class="danger" id="suppr">🗑️ Supprimer</button>';
  const vign = $app.querySelector('.vignettes');
  if (vign) vign.onclick = e => {
    const i = e.target.dataset.i; if (i == null) return;
    document.getElementById('grande').src = liste[i];
    vign.querySelectorAll('img').forEach((im, k) => im.classList.toggle('on', k === +i));
  };
  document.getElementById('modif').onclick = () => {
    F = { id: l.id, photos: liste.slice(), plus: !!(l.valeur != null || l.originale || l.dedicace || l.rangement), skipDup: true,
      d: Object.assign({}, l, { prixAchat: l.prixAchat == null ? '' : String(l.prixAchat).replace('.', ','), prixVise: l.prixVise == null ? '' : String(l.prixVise).replace('.', ','),
        prixVendu: l.prixVendu == null ? '' : String(l.prixVendu).replace('.', ','), valeur: l.valeur == null ? '' : String(l.valeur).replace('.', ',') }) };
    location.hash = '#/formulaire';
  };
  document.getElementById('suppr').onclick = () => {
    modal('<h2 style="margin-top:0">Supprimer ce livre ?</h2><p><b>' + esc(l.titre) + '</b><br>Cette fiche et ses photos seront effacées définitivement.</p>' +
      '<button class="danger" id="oui">Oui, supprimer</button><button class="primaire" id="non">Non, le garder</button>');
    document.getElementById('non').onclick = fermerModal;
    document.getElementById('oui').onclick = async () => { await supprimerLivre(l.id); fermerModal(); toast('Livre supprimé'); location.hash = '#/'; };
  };
}

// ---------- MA COLLECTION ----------
function calculStats() {
  const s = { n: LIVRES.length, depense: 0, aVendre: 0, nbVendus: 0, ventes: 0, gain: 0, valeur: 0 };
  LIVRES.forEach(l => {
    s.depense += l.prixAchat || 0;
    if (l.statut === 'vente') s.aVendre++;
    if (l.statut === 'vendu') { s.nbVendus++; s.ventes += l.prixVendu || 0; s.gain += (l.prixVendu || 0) - (l.prixAchat || 0); }
    else s.valeur += l.valeur || 0;
  });
  return s;
}
async function vueCollection() {
  const s = calculStats(), d = await getMeta('derniereSauvegarde');
  const jours = d ? (Date.now() - new Date(d)) / 864e5 : 999;
  const ligne = (t, v) => '<div class="stat"><span>' + t + '</span><b>' + v + '</b></div>';
  $app.innerHTML = '<h1>Ma collection</h1>' +
    ligne('Nombre de livres', s.n) + ligne('Total dépensé', euro(s.depense)) + ligne('Livres à vendre', s.aVendre) +
    ligne('Livres vendus', s.nbVendus) + ligne('Total des ventes', euro(s.ventes)) + ligne('Gain total', euro(s.gain)) +
    ligne('Valeur estimée (livres gardés)', euro(s.valeur)) +
    '<h2>Sauvegarde</h2>' + (jours >= 30 ? '<div class="bandeau">⚠️ Pensez à sauvegarder votre collection.</div>' : '') +
    '<p>' + (d ? 'Dernière sauvegarde : <b>' + dateFr(d) + '</b>' : '<b>Pas encore de sauvegarde.</b>') + '</p>' +
    '<button class="primaire gros" data-act="sauver">💾 Sauvegarder ma collection</button>' +
    '<p class="muted small">Le fichier peut être envoyé dans « Fichiers » (iCloud), par e-mail ou par AirDrop. Faites-le une fois par mois.</p>' +
    '<button data-act="restaurer">📂 Restaurer une sauvegarde</button><input type="file" id="fileRest" accept=".json,application/json" hidden>' +
    '<h2>Liste pour papiers et assurance</h2>' +
    '<button data-act="csv">📄 Liste pour Excel (CSV)</button><a class="btn" href="#/impression">🖨️ Liste imprimable (PDF)</a>' +
    '<h2>Aide</h2><button data-act="guide">📱 Comment installer l\'appli sur l\'iPhone</button>';
  document.getElementById('fileRest').onchange = e => { if (e.target.files[0]) restaurer(e.target.files[0]); e.target.value = ''; };
}

async function toutesLesDonnees() {
  const photos = {};
  (await dbAll('photos')).forEach(p => { photos[p.id] = p.liste; });
  return LIVRES.map(l => { const c = Object.assign({}, l); delete c.thumb; c.photos = photos[l.id] || []; return c; });
}
async function donnerFichier(blob, nom, type, titre) {
  const f = new File([blob], nom, { type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: titre }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return true;
}
async function sauvegarder() {
  if (!LIVRES.length) return toast('Il n\'y a encore rien à sauvegarder.');
  toast('Préparation du fichier…', 8000);
  const livres = await toutesLesDonnees();
  const parts = ['{"application":"collection-livres","version":1,"date":' + JSON.stringify(new Date().toISOString()) + ',"livres":['];
  livres.forEach((l, i) => parts.push((i ? ',' : '') + JSON.stringify(l)));
  parts.push(']}');
  const blob = new Blob(parts, { type: 'application/json' });
  const fait = await donnerFichier(blob, 'sauvegarde-livres-' + aujourdhui() + '.json', 'application/json', 'Sauvegarde de ma collection');
  if (fait) { await setMeta('derniereSauvegarde', new Date().toISOString()); toast('Sauvegarde faite ✔'); vueCollection(); }
}
async function restaurer(fichier) {
  try {
    const j = JSON.parse(await fichier.text());
    if (!j || j.application !== 'collection-livres' || !Array.isArray(j.livres)) throw new Error('format');
    modal('<h2 style="margin-top:0">Restaurer cette sauvegarde ?</h2><p>Elle contient <b>' + j.livres.length + ' livre' + (j.livres.length > 1 ? 's' : '') + '</b>' + (j.date ? ' (faite le ' + dateFr(j.date) + ')' : '') + '.<br>Les livres seront ajoutés à votre collection. Aucun livre actuel n\'est effacé.</p>' +
      '<button class="primaire" id="oui">Oui, restaurer</button><button id="non">Annuler</button>');
    document.getElementById('non').onclick = fermerModal;
    document.getElementById('oui').onclick = async () => {
      fermerModal(); toast('Restauration en cours…', 10000);
      for (const l of j.livres) {
        if (!l.id || !l.photos || !l.photos.length) continue;
        const p = l.photos; delete l.photos;
        await enregistrerLivre(l, p);
      }
      await chargerLivres();
      toast('Collection restaurée ✔'); vueCollection();
    };
  } catch (e) {
    modal('<h2 style="margin-top:0">Fichier non reconnu</h2><p>Ce fichier n\'est pas une sauvegarde de cette appli.</p><button class="primaire" id="ok">D\'accord</button>');
    document.getElementById('ok').onclick = fermerModal;
  }
}
async function exportCsv() {
  const cols = ['Titre', 'Auteur', 'Éditeur', 'Année', 'ISBN', 'Thème', 'État', 'Statut', 'Prix d\'achat', 'Prix de vente visé', 'Prix vendu', 'Date de vente', 'Valeur estimée', 'Édition originale', 'Dédicace', 'Rangement', 'Note', 'Date d\'ajout'];
  const c = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const m = v => v == null ? '' : String(v).replace('.', ',');
  const lignes = [cols.map(c).join(';')].concat(LIVRES.slice().sort((a, b) => norm(a.titre).localeCompare(norm(b.titre))).map(l =>
    [l.titre, l.auteur, l.editeur, l.annee, l.isbn, l.theme, l.etat, libStatut(l.statut), m(l.prixAchat), m(l.prixVise), m(l.prixVendu), l.dateVente, m(l.valeur),
      l.originale ? 'Oui' : 'Non', l.dedicace ? 'Oui' : 'Non', l.rangement, l.note, (l.creeLe || '').slice(0, 10)].map(c).join(';')));
  const blob = new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv' });
  await donnerFichier(blob, 'liste-livres-' + aujourdhui() + '.csv', 'text/csv', 'Liste de ma collection');
}

// ---------- Liste imprimable ----------
function vueImpression() {
  const s = calculStats();
  const l = LIVRES.slice().sort((a, b) => norm(a.titre).localeCompare(norm(b.titre)));
  $app.innerHTML = '<div class="noprint"><a class="lien" href="#/collection">← Retour</a><button class="primaire gros" data-act="imprimer">🖨️ Imprimer / Enregistrer en PDF</button>' +
    '<p class="muted small">Dans la fenêtre qui s\'ouvre, choisissez « Imprimer » ou « Enregistrer dans Fichiers » (PDF).</p></div>' +
    '<h1>Ma collection de livres anciens</h1><p>Liste établie le ' + dateFr(new Date().toISOString()) + ' — ' + s.n + ' livre' + (s.n > 1 ? 's' : '') + ' — valeur estimée : ' + euro(s.valeur) + ' — total dépensé : ' + euro(s.depense) + '</p>' +
    '<table class="table"><thead><tr><th></th><th>Titre</th><th>Auteur</th><th>Éditeur / année</th><th>État</th><th>Statut</th><th>Achat</th><th>Valeur</th></tr></thead><tbody>' +
    l.map(b => '<tr><td><img alt="" src="' + b.thumb + '"></td><td><b>' + esc(b.titre) + '</b>' + (b.originale ? '<br>Édition originale' : '') + (b.dedicace ? '<br>Dédicacé' : '') + '</td><td>' + esc(b.auteur) + '</td><td>' + esc(b.editeur) + ' ' + esc(b.annee) +
      '</td><td>' + esc(b.etat) + '</td><td>' + libStatut(b.statut) + '</td><td>' + (b.prixAchat != null ? euro(b.prixAchat) : '') + '</td><td>' + (b.valeur != null ? euro(b.valeur) : '') + '</td></tr>').join('') + '</tbody></table>';
}

// ---------- Guide d'installation ----------
const SVG_PARTAGE = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="8" width="48" height="48" rx="12" fill="#e8f0fb"/><path d="M32 40V16M22 26l10-10 10 10M20 32v14a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3V32" fill="none" stroke="#1a73e8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_ECRAN = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="10" width="44" height="44" rx="10" fill="#fff" stroke="#555" stroke-width="3"/><path d="M32 22v20M22 32h20" stroke="#555" stroke-width="4" stroke-linecap="round"/></svg>';
const SVG_AJOUTER = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="4" y="16" width="56" height="32" rx="16" fill="#1a73e8"/><text x="32" y="38" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" font-family="Arial">Ajouter</text></svg>';
function estInstallee() { return window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
function guideInstallation(premiere) {
  modal('<h2 style="margin-top:0">Mettre l\'appli sur votre iPhone</h2>' +
    '<p>Ainsi elle s\'ouvre comme une vraie appli, fonctionne sans internet et <b>garde vos livres</b>.</p>' +
    '<div class="etape"><div class="n">1</div><div>Touchez le bouton <b>Partager</b> en bas de Safari (le carré avec une flèche).</div>' + SVG_PARTAGE + '</div>' +
    '<div class="etape"><div class="n">2</div><div>Faites défiler et touchez <b>« Sur l\'écran d\'accueil »</b>.</div>' + SVG_ECRAN + '</div>' +
    '<div class="etape"><div class="n">3</div><div>Touchez <b>« Ajouter »</b> en haut à droite. C\'est fini !</div>' + SVG_AJOUTER + '</div>' +
    '<button class="primaire gros" id="vu">J\'ai compris</button>' + (premiere ? '<button class="lien" id="plusTard">Me le rappeler plus tard</button>' : ''));
  document.getElementById('vu').onclick = async () => { fermerModal(); await setMeta('guideVu', true); };
  const pt = document.getElementById('plusTard'); if (pt) pt.onclick = fermerModal;
}

// ---------- Clics (boutons du formulaire et divers) ----------
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (F && document.getElementById('f_titre')) {
    const d = F.d;
    if (a === 'photo') return document.getElementById('fileCam').click();
    if (a === 'galerie') return document.getElementById('fileGal').click();
    if (a === 'suppPhoto') { collecter(); F.photos.splice(+b.dataset.i, 1); return redessiner(); }
    if (a === 'couv') { collecter(); const [p] = F.photos.splice(+b.dataset.i, 1); F.photos.unshift(p); return redessiner(); }
    if (a === 'theme') { collecter(); d.theme = d.theme === b.dataset.v ? '' : b.dataset.v; return redessiner(); }
    if (a === 'nouveauTheme') {
      collecter();
      modal('<h2 style="margin-top:0">Nouveau thème</h2><input type="text" id="nt" placeholder="Ex. : Cuisine, Voyages…"><button class="primaire" id="ntok" style="margin-top:12px">Ajouter ce thème</button><button id="ntno">Annuler</button>');
      document.getElementById('ntno').onclick = fermerModal;
      document.getElementById('ntok').onclick = async () => {
        const v = document.getElementById('nt').value.trim(); if (!v) return;
        if (!tousThemes().some(t => norm(t) === norm(v))) { THEMES_PERSO.push(v); await setMeta('themes', THEMES_PERSO); }
        d.theme = tousThemes().find(t => norm(t) === norm(v)); fermerModal(); redessiner();
      };
      return;
    }
    if (a === 'etat') { collecter(); d.etat = d.etat === b.dataset.v ? '' : b.dataset.v; return redessiner(); }
    if (a === 'statut') { collecter(); d.statut = b.dataset.v; if (d.statut === 'vendu' && !d.dateVente) d.dateVente = aujourdhui(); return redessiner(); }
    if (a === 'oui' || a === 'non') { collecter(); d[b.dataset.k] = a === 'oui'; F.plus = true; return redessiner(); }
    if (a === 'enregistrer') return validerEtEnregistrer();
    if (a === 'annulerForm') { const id = F.id; F = null; location.hash = id ? '#/livre/' + id : '#/ajouter'; return; }
  }
  if (a === 'sauver') return sauvegarder();
  if (a === 'restaurer') return document.getElementById('fileRest').click();
  if (a === 'csv') return exportCsv();
  if (a === 'imprimer') return window.print();
  if (a === 'guide') return guideInstallation(false);
});

// ---------- Démarrage ----------
async function demarrer() {
  try {
    await ouvrirBase();
    await chargerLivres();
  } catch (e) {
    $app.innerHTML = '<h1>Oups</h1><div class="erreur">Le stockage de l\'appli n\'est pas disponible (navigation privée ?). Ouvrez l\'appli dans Safari normalement.</div>';
    return;
  }
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { /* ignoré */ } }
  window.addEventListener('hashchange', route);
  route();
  if (!estInstallee() && !(await getMeta('guideVu'))) guideInstallation(true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
demarrer();
