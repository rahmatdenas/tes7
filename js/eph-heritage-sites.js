'use strict';

// ============================================================
// FUNGSI UTILITAS (Penerjemah Tanggal & Presisi Wikidata)
// ============================================================
function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;
  
  // Buang tanda + di depan format ISO Wikidata
  let cleanStr = dateString.replace(/^[+-]/, ''); 
  
  // Ambil potongan bagian tahun, bulan, dan hari
  let yearStr  = cleanStr.substring(0, 4);
  let monthStr = cleanStr.substring(5, 7);
  let dayStr   = cleanStr.substring(8, 10);
  let yearNum  = parseInt(yearStr);

  // Kamus bulan Bahasa Indonesia
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  let prec = parseInt(precision) || 9; // Default ke presisi tahunan (9)

  if (prec === 11) {
    // Presisi Hari (Contoh: 1 Januari 2007)
    return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 10) {
    // Presisi Bulan (Contoh: Januari 2007)
    return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 9) {
    // Presisi Tahun (Contoh: 2007)
    return yearStr;
  } 
  else if (prec === 8) {
    // Presisi Dekade (Contoh: 1980-an)
    return `${yearStr}-an`;
  } 
  else if (prec === 7) {
    // Presisi Abad (Contoh: Abad ke-20)
    let century = Math.ceil(yearNum / 100);
    return `Abad ke-${century}`;
  } 
  else {
    return yearStr;
  }
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
function loadPrimaryData() {

  doPreProcessing();

  populateDesignationTypesData()

    .then(() => {

      // Menjalankan pencarian BERSAMAAN (Paralel)

      return Promise.all([

        populateCoordinatesData().then(populateMapAndIndex), // Jalur 1: Koordinat

        populateImageAndWikipediaData(),                     // Jalur 2: Gambar & Artikel

        populateImportantEventsData()                        // Jalur 3: Peristiwa Penting

      ]);

    })

    .then(() => {

      // KODE BARU: Paksa hitung ulang setelah SEMUA jalur data selesai

      updateFeatureCounts(); 

      enableApp();

    });

}
function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

function populateDesignationTypesData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_0,
    function(result) {
      let qid = result.siteQid.value;
      if (!(qid in Records)) {
        Records[qid] = new Record(false);
      }
      let record = Records[qid];

      if ('siteLabel' in result && result.siteLabel.value) {
        record.title = result.siteLabel.value;
      } else {
        record.title = '[ERROR: No title]';
      }

      let designationQid = result.designationQid.value;
      if ('partOf' in DESIGNATION_TYPES[designationQid]) {
        designationQid = DESIGNATION_TYPES[designationQid].partOf;
      }
      if (!(designationQid in record.designations)) {
        record.designations[designationQid] = new Designation();
      }
      
      if ('p131Label' in result && result.p131Label.value) {
        record.lokasiSpesifik = result.p131Label.value;
      }

      if ('p131Image' in result && result.p131Image.value) {
        record.lokasiImage = extractImageFilename(result.p131Image);
      }

      // LOGIKA TAHUN BERDIRI (P571) & PRESISI
if (!record.tahunBerdiri && result.tahunBerdiriMentah && result.tahunBerdiriMentah.value) {
        let precision = result.tahunPresisi ? result.tahunPresisi.value : 9;
        record.tahunBerdiri = formatWikidataDate(result.tahunBerdiriMentah.value, precision);
        
        // KODE BARU: Simpan string waktu mentah (ISO) untuk keperluan sorting usia
        // (Pastikan baris ini berada DI DALAM kurung kurawal 'if')
        record.rawTahunBerdiri = result.tahunBerdiriMentah.value.replace(/^[+-]/, '');
      }

    },
    function() {
      populateDesignationIndex();
      SparqlValuesClause = 'VALUES ?site {' + Object.keys(Records).map(qid => `wd:${qid}`).join(' ') + '}';
      Object.values(Records).forEach(record => { record.indexTitle = record.title });
    },
  );
}

function populateCoordinatesData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_1,
    function(result) {
      let record = Records[result.siteQid.value];
      let wktBits = result.coord.value.split(/\(|\)| /);
      record.lat = parseFloat(wktBits[2]);
      record.lon = parseFloat(wktBits[1]);
    },
    function() {
      BootstrapDataIsLoaded = true;
    },
  );
}

function populateImageAndWikipediaData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_3,
    function(result) {
      let record = Records[result.siteQid.value];
      
      if ('image' in result) {
        if (!record.imageFilename) {
          record.imageFilename = extractImageFilename(result.image);
        }
      }
      
      if ('wikipediaUrlTitle' in result) {
        record.articleTitle = decodeURIComponent(result.wikipediaUrlTitle.value);
      }

      if (!record.vicinityImages) {
        record.vicinityImages = [];
      }
      if ('vicinityImage' in result) {
        let fotoTambahan = extractImageFilename(result.vicinityImage);
        if (!record.vicinityImages.includes(fotoTambahan)) {
          record.vicinityImages.unshift(fotoTambahan);
        }
      }

      if ('pastImage' in result) {
        if (!record.pastImage) {
          record.pastImage = extractImageFilename(result.pastImage);
        }
      }
    },
  );
}

function populateImportantEventsData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_4,
    function(result) {
      let record = Records[result.siteQid.value];
      
      if ('eventLabel' in result && result.eventLabel.value) {
        let eventObj = {
          label: result.eventLabel.value,
          time: ''
        };

        // Siapkan variabel waktu & baca presisinya masing-masing menggunakan fungsi kalender pintar
        let pt = result.pointInTime ? formatWikidataDate(result.pointInTime.value, result.ptPrecision ? result.ptPrecision.value : 9) : null;
        let st = result.startTime ? formatWikidataDate(result.startTime.value, result.stPrecision ? result.stPrecision.value : 9) : null;
        let et = result.endTime ? formatWikidataDate(result.endTime.value, result.etPrecision ? result.etPrecision.value : 9) : null;

        // Logika pengisian teks waktu di antarmuka
        if (pt) {
          eventObj.time = pt;
        } else if (st && et) {
          eventObj.time = `${st} – ${et}`;
        } else if (st) {
          eventObj.time = `Mulai ${st}`;
        } else if (et) {
          eventObj.time = `Selesai ${et}`;
        }

        // Cek duplikasi agar tak berulang
        let isDuplicate = record.events.some(e => e.label === eventObj.label && e.time === eventObj.time);
        if (!isDuplicate) {
          record.events.push(eventObj);
        }
      }
    }
  );
}

function populateDesignationIndex() {
  DesignationIndex = { all: new DesignationIndexEntry };
  Object.keys(DESIGNATION_TYPES)
    .filter(qid => !('partOf' in DESIGNATION_TYPES[qid]))
    .forEach(qid => {
      DesignationIndex[qid] = new DesignationIndexEntry;
      let orgId = DESIGNATION_TYPES[qid].org;
      if (!(orgId in DesignationIndex)) DesignationIndex[orgId] = new DesignationIndexEntry;
    });

  Object.values(Records).forEach(record => {
    DesignationIndex.all.total++;
    Object.keys(record.designations).forEach(typeQid => {
      let orgId = DESIGNATION_TYPES[typeQid].org;
      DesignationIndex[typeQid].total++;
      DesignationIndex[orgId  ].total++;
    });
  });
}

function populateMapAndIndex() {
  let listIndex = document.getElementById('index-list');
  let mapMarkers = [];
  Object.entries(Records).forEach(entry => {
    let qid = entry[0], record = entry[1];
    if (!record.isCompound && record.lat && record.lon) {
      let mapMarker = L.marker(
        [record.lat, record.lon],
        { icon: L.ExtraMarkers.icon({ icon: '', markerColor : 'orange-dark' }) },
      );
      record.mapMarker = mapMarker;
      mapMarker.bindPopup(record.title, { closeButton: false });
      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;
      mapMarkers.push(mapMarker);
    }
    let li = document.createElement('li');
    li.innerHTML = `<a href="#${qid}">${record.indexTitle}</a>`;
    record.indexLi = li;
    listIndex.appendChild(li);
  });
  Cluster.addLayers(mapMarkers);
  populateDesignationIndexNodes();
  generateFilterSelect();
  processHashChange();
}

function populateDesignationIndexNodes() {
  Object.values(Records).forEach(record => {
    if (record.mapMarker) DesignationIndex.all.mapMarkers.push(record.mapMarker);
    DesignationIndex.all.indexLis.push(record.indexLi);
    
    Object.keys(record.designations).forEach(typeQid => {
      let orgId = DESIGNATION_TYPES[typeQid].org;
      
      // KODE BARU: Memberikan stempel tag wilayah ke setiap record
      record.areaTags.add(typeQid);
      record.areaTags.add(orgId);

      if (record.mapMarker) {
        DesignationIndex[typeQid].mapMarkers.push(record.mapMarker);
        DesignationIndex[orgId  ].mapMarkers.push(record.mapMarker);
      }
      DesignationIndex[typeQid].indexLis.push(record.indexLi);
      DesignationIndex[orgId  ].indexLis.push(record.indexLi);
    });
  });
  
  Object.values(DesignationIndex).forEach(indexItem => {
    indexItem.indexLis = indexItem.indexLis
      .map(li => [li, li.textContent])
      .sort((a, b) => a[1] > b[1] ? 1 : -1)
      .map(item => item[0]);
  });
}

// Variabel State Global
let currentRegionFilter = 'all';
let activeFeatures = new Set(); 
let currentSortMode = 'alphabetical'; // Mode urut bawaan

function generateFilterSelect() {
  let selectRegion = document.getElementById('filter-region');
  let selectSort = document.getElementById('sort-order');
  
  // 1. Bangun Master Dropdown (Wilayah)
  selectRegion.innerHTML = `<option value="all">Semua Wilayah – ${DesignationIndex.all.total}</option>`;
  
  Object.keys(DESIGNATION_TYPES)
    .filter(qid => !('partOf' in DESIGNATION_TYPES[qid]))
    .map(qid => [qid, DESIGNATION_TYPES[qid].order]) 
    .sort((a, b) => a[1] - b[1])
    .map(item => item[0])
    .forEach(qid => {
      let type = DESIGNATION_TYPES[qid];
      let option = document.createElement('option');
      option.value = qid;
      option.textContent = `${type.name} – ${DesignationIndex[qid].total}`;
      selectRegion.appendChild(option);
    });

  updateFeatureCounts();

  // 2. Event Listener Wilayah
  selectRegion.addEventListener('change', function() {
    currentRegionFilter = this.value;
    updateFeatureCounts(); 
    applyIntersectionFilter();
    this.blur();
  });

  // 3. Event Listener Pengurutan (SORTING)
  selectSort.addEventListener('change', function() {
    currentSortMode = this.value;
    applyIntersectionFilter(); // Eksekusi render ulang dengan urutan baru
    this.blur();
  });

  // 4. Event Listener Tombol Fitur Toggle
  let btnAll = document.getElementById('btn-all');
  let featButtons = document.querySelectorAll('.feat-btn:not(#btn-all)');

  btnAll.addEventListener('click', function() {
    activeFeatures.clear();
    btnAll.classList.add('active');
    featButtons.forEach(b => b.classList.remove('active'));
    applyIntersectionFilter();
  });

  featButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      let filterType = this.getAttribute('data-filter');

      if (activeFeatures.has(filterType)) {
        activeFeatures.delete(filterType);
        this.classList.remove('active');
      } else {
        activeFeatures.add(filterType);
        this.classList.add('active');
      }

      if (activeFeatures.size === 0) {
        btnAll.classList.add('active');
      } else {
        btnAll.classList.remove('active');
      }

      applyIntersectionFilter();
    });
  });
}

// Menghitung dinamis (Menghapus countYear karena fiturnya sudah diganti menjadi fungsi urut)
function updateFeatureCounts() {
  let countAll = 0, countImage = 0, countArticle = 0;

  Object.values(Records).forEach(record => {
    let inRegion = (currentRegionFilter === 'all' || record.areaTags.has(currentRegionFilter));
    
    if (inRegion) {
      countAll++;
      if (record.imageFilename) countImage++;
      if (record.articleTitle !== undefined) countArticle++;
    }
  });

  document.getElementById('btn-all').textContent = `Semua (${countAll})`;
  document.getElementById('btn-image').textContent = `Ber-Gambar (${countImage})`;
  document.getElementById('btn-article').textContent = `Ber-Artikel Wikipedia (${countArticle})`;
}

// Fungsi Eksekutor & Algoritma Pengurutan Baru
function applyIntersectionFilter() {
  Cluster.clearLayers();
  let ol = document.getElementById('index-list');
  ol.innerHTML = '';

  let validMarkers = [];
  
  let validRecords = Object.values(Records).filter(record => {
    let matchRegion = (currentRegionFilter === 'all' || record.areaTags.has(currentRegionFilter));
    let matchFeature = true;
    
    // Cek tombol fitur (menghapus pengecekan 'year')
    if (activeFeatures.size > 0) {
      if (activeFeatures.has('image') && !record.imageFilename) matchFeature = false;
      if (activeFeatures.has('article') && record.articleTitle === undefined) matchFeature = false;
    }
    return matchRegion && matchFeature;

  }).sort((a, b) => {
    
    // LOGIKA PENGURUTAN BARU
    if (currentSortMode === 'age') {
      let aHasYear = !!a.rawTahunBerdiri;
      let bHasYear = !!b.rawTahunBerdiri;

      if (aHasYear && bHasYear) {
        // Jika keduanya punya tahun, urutkan dari yang usianya paling tua (angka tahun terkecil)
        return a.rawTahunBerdiri.localeCompare(b.rawTahunBerdiri);
      } else if (aHasYear && !bHasYear) {
        // Jika A punya tahun dan B tidak, A ditaruh di atas
        return -1;
      } else if (!aHasYear && bHasYear) {
        // Jika B punya tahun dan A tidak, B ditaruh di atas
        return 1;
      } else {
        // Jika keduanya tidak punya tahun, urutkan berdasarkan abjad sebagai penentu terakhir
        return a.indexTitle.localeCompare(b.indexTitle);
      }
    } else {
      // Mode default: Urut murni berdasarkan Abjad (A-Z)
      return a.indexTitle.localeCompare(b.indexTitle);
    }
    
  });

  validRecords.forEach(record => {
    if (record.mapMarker) validMarkers.push(record.mapMarker);
    if (record.indexLi) ol.appendChild(record.indexLi);
  });

  if (validMarkers.length > 0) {
    Cluster.addLayers(validMarkers);
    Map.fitBounds(Cluster.getBounds());
  }
}


function activateSite(qid) {
  displayRecordDetails(qid);
  let record = Records[qid];
  if (record.isCompound) {
  }
  else if (record.mapMarker) {
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      },
    );
  }
}

function generateRecordDetails(qid) {
  let record = Records[qid];
  let titleHtml = `<h1>${record.title}</h1>`;
  let figureHtml = generateFigure(record.imageFilename);

  if (record.vicinityImages && record.vicinityImages.length > 0) {
    record.vicinityImages.forEach(imgFilename => {
      figureHtml += generateFigure(imgFilename);
    });
  }

  let articleHtml;
  if (record.articleTitle) {
    articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  }
  else {
    articleHtml = '<div class="article main-text nodata"><p>Situs ini belum memiliki artikel Wikipedia berbahasa Indonesia.</p></div>';
  }

  let designationsHtml = '<h2>Informasi</h2>';

  if (record.pastImage) {
    designationsHtml += generateFigure(record.pastImage);
  }

  designationsHtml += '<ul class="designations">';

  Object.keys(record.designations)
    .map(qid => [qid, DESIGNATION_TYPES[qid].order]) 
    .sort((a, b) => a[1] - b[1])
    .map(item => item[0])
    .forEach(designationQid => {

      let type = DESIGNATION_TYPES[designationQid];

      let infoTahunHtml = '';
      if (record.tahunBerdiri) {
        infoTahunHtml = `<p>Didirikan: ${record.tahunBerdiri}</p>`;
      } else {
        infoTahunHtml = `<p>Didirikan: Data belum tersedia</p>`;
      }

      let teksLokasi = record.lokasiSpesifik || ORGS[type.org];
      let infoLokasiHtml = `<p>Terletak di: ${teksLokasi}</p>`;

      designationsHtml +=
        '<li>' +
          `<h3>${type.name}</h3>` +
          '<div class="org">' +
            `<img src="img/org_logo_${type.org.toLowerCase()}.svg">` + 
          '</div>' +
          infoLokasiHtml + 
          infoTahunHtml +
        '</li>';
        
    });
    
  designationsHtml += '</ul>';

// ====================================================================
  // CETAK HTML PERISTIWA PENTING
  // ====================================================================
  let eventsHtml = '';
  if (record.events && record.events.length > 0) {
    
    // 1. KODE BARU: Kamus Bobot Urutan (Semua huruf kecil agar kebal dari salah ketik Wikidata)
    const EVENT_ORDER = {
      'pembebasan tanah': 1,
      'peletakan batu pertama': 2,
      'konstruksi': 3,
      'dibuka untuk umum': 4,
      'upacara pembukaan': 5,
      'perombakan': 6,
      'renovasi': 6
    };

    // 2. KODE BARU: Urutkan array events sebelum dicetak
    record.events.sort((a, b) => {
      // Ambil bobot berdasarkan label. Jika label tidak ada di kamus, beri bobot 99 (taruh di paling bawah)
      let orderA = EVENT_ORDER[a.label.toLowerCase()] || 99;
      let orderB = EVENT_ORDER[b.label.toLowerCase()] || 99;
      return orderA - orderB;
    });

    // 3. Cetak ke HTML seperti biasa
    eventsHtml += '<h2>Peristiwa Penting</h2><ul class="designations" style="margin-left:-65px"><li>';
    
    record.events.forEach(ev => {
      let timeText = ev.time ? ` (${ev.time})` : ''; 
      eventsHtml += `<p><strong>${ev.label}</strong>${timeText}</p>`;
    });
    
    eventsHtml += '</li></ul>';
  }
  // ====================================================================

  let panelElem = document.createElement('div');
  
  panelElem.innerHTML =
    `<a class="main-wikidata-link" href="https://www.wikidata.org/wiki/${qid}" title="Lihat di Wikidata">` +
    '<img src="img/wikidata_tiny_logo.png" alt="[Lihat item Wikidata]" /></a>' +
    titleHtml +
    figureHtml + 
    articleHtml +
    designationsHtml + 
    eventsHtml;  
  
  record.panelElem = panelElem;

  if (record.articleTitle) displayArticleExtract(record.articleTitle, panelElem.querySelector('.article'));
  queryOsm(qid);
}

function displayArticleExtract(title, elem) {
  loadJsonp(
    'https://id.wikipedia.org/w/api.php',
    {
      action    : 'query',
      format    : 'json',
      prop      : 'extracts',
      exintro   : 1,
      redirects : true,
      titles    : title,
    },
    function(data) {
      elem.innerHTML =
        Object.values(data.query.pages)[0].extract.match(/<p[^]+?<\/p>/g).find(text => text.length > 50) +
        '<p class="wikipedia-link">' +
          `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}">` +
            '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
            '<span>Baca selengkapnya di Wikipedia</span>' +
          '</a>' +
        '</p>';
      elem.classList.remove('loading');
    }
  );
}

function queryOsm(qid) {
  let xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== xhr.DONE) return;
    if (xhr.status === 200) {
      let geoJson = osmtogeojson(JSON.parse(xhr.responseText));
      if (!geoJson || geoJson.features.length === 0) return;
      let shapeLayer = L.geoJSON(
        geoJson,
        {
          style: {
            color   : '#ff3333',
            opacity : 0.7,
            fill    : true,
          },
          filter: feature => feature.geometry.type !== 'Point',
        },
      );
      Records[qid].shapeLayer = shapeLayer;
      shapeLayer.addTo(Map);

      if (window.location.hash.replace('#', '') === qid) {
        Map.fitBounds(shapeLayer.getBounds());
      }
    }
    else {
      console.log('ERROR loading from Overpass API', xhr);
    }
  };
  xhr.open(
    'GET',
    'https://overpass-api.de/api/interpreter?data=' +
    encodeURIComponent(
`[out:json][timeout:25];
(
  way     ["wikidata"="${qid}"];
  relation["wikidata"="${qid}"];
);
out body;
>;
out skel qt;`
    ),
    true,
  );
  xhr.send();
}

// ============================================================
// CLASSES
// ============================================================
class Designation {
  constructor() {
    this.date             = undefined;
    this.declarationData  = undefined;
    this.declarationTitle = undefined;
    this.declarationScan  = undefined;
    this.declarationText  = undefined;
    this.partOfQid        = null;
  }
}

class DesignationIndexEntry {
  constructor() {
    this.total      = 0;
    this.mapMarkers = [];
    this.indexLis   = [];
  }
}

class Record {
  constructor(isCompound) {

    this.isCompound = isCompound;

    this.title = undefined;

    this.imageFilename = '';

    this.articleTitle = undefined;

    this.designations = {};

    this.panelElem = undefined;

    this.indexLi = undefined;

    this.tahunBerdiri = undefined;

    this.rawTahunBerdiri = undefined;

    this.events = [];

    this.areaTags = new Set();

    this.vicinityImages = [];
  }
}

class SimpleRecord extends Record {
  constructor() {
    super(false);
    this.lat        = undefined;
    this.lon        = undefined;
    this.mapMarker  = undefined;
    this.popup      = undefined;
    this.shapeLayer = undefined;
  }
}

class CompoundRecord extends Record {
  constructor() {
    super(true);
    this.parts = []; 
  }
}
