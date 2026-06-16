/* E:\Web POS\app.js */

// Global App State
let state = {
  products: [],
  members: [],
  sales: [],
  cart: [],
  customSounds: [], // สำหรับจัดเก็บข้อมูลเสียงแจ้งเตือนที่ผู้ใช้อัปโหลด
  settings: {
    shopName: 'ระบบร้านค้า เจ้นก',
    shopDesc: 'ภาพรวมยอดขายวันนี้และกิจกรรมล่าสุดในร้านค้า เจ้นก',
    shopAddress: '',
    shopPhone: '',
    shopContact: '',
    soundType: 'cash-register'
  }
};

// Google Apps Script API Endpoint URL
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwNinWUyhlgzW_vP7p1Tc8yLOLJ0jwOXh4RR5sLp5W6_9akCoa7niMx2sZwY3cmkeYNqg/exec';

// Chart references
let todaySalesChartRef = null;
let monthlySalesChartRef = null;

// Safe SweetAlert2 Fallback (handles offline or blocked CDNs)
if (typeof Swal === 'undefined') {
  window.Swal = {
    fire: function(options) {
      const title = options.title || '';
      const text = options.text || (options.html ? options.html.replace(/<[^>]*>/g, '') : '');
      const icon = options.icon ? `[${options.icon.toUpperCase()}] ` : '';
      
      if (options.showCancelButton) {
        const result = confirm(`${icon}${title}\n${text}`);
        return Promise.resolve({ isConfirmed: result });
      } else {
        alert(`${icon}${title}\n${text}`);
        return Promise.resolve({ isConfirmed: true });
      }
    },
    showLoading: function() {
      console.log("Loading started...");
    },
    close: function() {
      console.log("Loading closed.");
    }
  };
}

// Safe Chart.js Fallback (handles offline or blocked CDNs)
if (typeof Chart === 'undefined') {
  window.Chart = class MockChart {
    constructor(ctx, config) {
      console.warn("Chart.js is not loaded. Cannot render chart on:", ctx);
      this.ctx = ctx;
      this.config = config;
      
      try {
        const context = ctx.getContext('2d');
        if (context) {
          const width = ctx.width || ctx.clientWidth || 300;
          const height = ctx.height || ctx.clientHeight || 150;
          context.clearRect(0, 0, width, height);
          context.fillStyle = '#E64A19';
          context.font = '14px Prompt, sans-serif';
          context.textAlign = 'center';
          context.fillText('ไม่สามารถแสดงกราฟได้ (ไม่มีสัญญาณอินเทอร์เน็ตหรือโหลด CDN ไม่สำเร็จ)', width / 2, height / 2);
        }
      } catch (e) {
        // Suppress canvas errors
      }
    }
    destroy() {}
    update() {}
  };
}

// IndexedDB Database Manager for Custom Sounds
const DB_NAME = 'NokPOSDatabase';
const DB_VERSION = 1;
const STORE_NAME = 'custom_sounds';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function saveCustomSoundToDB(sound) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(sound);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

function getCustomSoundsFromDB() {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

function deleteCustomSoundFromDB(id) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

// Bulletproof document ready check
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function initApp() {
  // 1. Setup navigation event listeners first to guarantee UI remains responsive/navigable
  try {
    setupNavigation();
  } catch (e) {
    console.error("Failed to setup navigation:", e);
  }

  // Setup sidebar collapse toggles
  try {
    setupSidebarToggle();
  } catch (e) {
    console.error("Failed to setup sidebar toggles:", e);
  }

  // 2. Initialize data, date inputs, and dashboard content safely
  try {
    // Load state from localstorage
    loadStateFromLocalStorage();

    // Load custom sounds from IndexedDB and update select/list UI
    getCustomSoundsFromDB().then(sounds => {
      state.customSounds = Array.isArray(sounds) ? sounds : [];
      refreshSoundSelectOptions();
      renderCustomSoundsList();
    }).catch(err => {
      console.error("Failed to load custom sounds from IndexedDB:", err);
    });

    // Set default datetime pickers
    setCurrentDateTime('payment-datetime');
    setCurrentDateTime('member-datetime');

    // Set default dashboard chart date
    const dashboardChartDate = document.getElementById('dashboard-chart-date');
    if (dashboardChartDate) {
      dashboardChartDate.value = getLocalDateTimeString().split('T')[0];
    }

    // Load QR Code if exists
    loadQRCode();

    // Populate Year filter dynamically
    populateYearFilter();

    // Setup input keypress / change event listeners
    setupSearchAndInputs();

    // Render dashboard figures and chart
    updateDashboard();

    // Render tables & Quick Catalog
    renderProductTable();
    renderMemberTable();
    renderQuickCatalog();
  } catch (err) {
    console.error("Error during POS initialization:", err);
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการโหลดระบบ',
      text: 'ระบบพบข้อผิดพลาดขณะโหลดข้อมูล แต่คุณยังสามารถสลับเมนูด้านซ้ายเพื่อทำงานต่อได้ปกติ: ' + err.message
    });
  }
}

// State Management - Local Storage
function loadStateFromLocalStorage() {
  try {
    const localProducts = localStorage.getItem('nok_pos_v2_products');
    const localMembers = localStorage.getItem('nok_pos_v2_members');
    const localSales = localStorage.getItem('nok_pos_v2_sales');

    const currentDateStr = getLocalDateTimeString().split('T')[0]; // YYYY-MM-DD

    // 1. Products Load
    if (localProducts) {
      const parsed = JSON.parse(localProducts);
      state.products = Array.isArray(parsed) ? parsed : [];
    } else {
      // Default initial mock products
      state.products = [
        { id: 'p1', barcode: '8850999111222', name: 'น้ำดื่มตราสิงห์ 600มล.', description: 'น้ำเปล่าสะอาดเย็นชื่นใจ', price: 10, stock: 50, createdAt: new Date().toISOString() },
        { id: 'p2', barcode: '8850999333444', name: 'เลย์ มันฝรั่งแผ่นเรียบรสคลาสสิก 50ก.', description: 'มันฝรั่งทอดกรอบแผ่นเรียบ', price: 20, stock: 30, createdAt: new Date().toISOString() },
        { id: 'p3', barcode: '8850999555666', name: 'โออิชิ รสต้นตำรับ 500มล.', description: 'ชาเขียวพร้อมดื่มสกัดจากใบชาเขียวธรรมชาติ', price: 25, stock: 25, createdAt: new Date().toISOString() },
        { id: 'p4', barcode: '8850888222111', name: 'โค้ก ออริจินัล 325มล.', description: 'เครื่องดื่มน้ำอัดลมเพิ่มความสดชื่น', price: 15, stock: 40, createdAt: new Date().toISOString() },
        { id: 'p5', barcode: '8850123456789', name: 'บะหมี่กึ่งสำเร็จรูปมาม่า รสต้มยำกุ้ง', description: 'มาม่าเส้นเหนียวนุ่มน้ำซุปเข้มข้น', price: 8, stock: 100, createdAt: new Date().toISOString() }
      ];
      saveStateToLocalStorage('nok_pos_v2_products', state.products);
    }

    // 2. Members Load
    if (localMembers) {
      const parsed = JSON.parse(localMembers);
      state.members = Array.isArray(parsed) ? parsed : [];
    } else {
      // Default initial mock members
      state.members = [
        { id: 'm1', firstName: 'สมชาย', lastName: 'รักเรียน', debt: 120, dateTime: `${currentDateStr}T09:30`, createdAt: new Date().toISOString() },
        { id: 'm2', firstName: 'สมหญิง', lastName: 'ใจดี', debt: 75, dateTime: `${currentDateStr}T14:15`, createdAt: new Date().toISOString() },
        { id: 'm3', firstName: 'มานะ', lastName: 'ขยันยิ่ง', debt: 320, dateTime: `${currentDateStr}T11:00`, createdAt: new Date().toISOString() }
      ];
      saveStateToLocalStorage('nok_pos_v2_members', state.members);
    }

    // 3. Sales Load
    if (localSales) {
      const parsed = JSON.parse(localSales);
      state.sales = Array.isArray(parsed) ? parsed : [];
    } else {
      // Default initial mock sales
      state.sales = [
        {
          id: 's1',
          items: [{ id: 'p1', name: 'น้ำดื่มตราสิงห์ 600มล.', price: 10, qty: 2 }, { id: 'p2', name: 'เลย์ มันฝรั่งแผ่นเรียบรสคลาสสิก 50ก.', price: 20, qty: 1 }],
          total: 40,
          paid: 50,
          change: 10,
          dateTime: `${currentDateStr}T09:15`
        },
        {
          id: 's2',
          items: [{ id: 'p3', name: 'โออิชิ รสต้นตำรับ 500มล.', price: 25, qty: 2 }, { id: 'p4', name: 'โค้ก ออริจินัล 325มล.', price: 15, qty: 2 }],
          total: 80,
          paid: 100,
          change: 20,
          dateTime: `${currentDateStr}T11:45`
        },
        {
          id: 's3',
          items: [{ id: 'p5', name: 'บะหมี่กึ่งสำเร็จรูปมาม่า รสต้มยำกุ้ง', price: 8, qty: 10 }, { id: 'p1', name: 'น้ำดื่มตราสิงห์ 600มล.', price: 10, qty: 5 }],
          total: 130,
          paid: 500,
          change: 370,
          dateTime: `${currentDateStr}T13:20`
        }
      ];
      saveStateToLocalStorage('nok_pos_v2_sales', state.sales);
    }

    // 4. Settings Load
    const localSettings = localStorage.getItem('nok_pos_v2_settings');
    if (localSettings) {
      const parsed = JSON.parse(localSettings);
      state.settings = { ...state.settings, ...parsed };
    }
    applySettingsToDOM();

  } catch (err) {
    console.error("LocalStorage load failed, fallback to defaults.", err);
  }
}

function saveStateToLocalStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to write to LocalStorage:", e);
  }
}

// Navigation Controls
function setupNavigation() {
  const menuItems = document.querySelectorAll('.sidebar .menu-item');
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const pageId = item.getAttribute('data-page');
      navigateToPage(pageId);
    });
  });
}

function navigateToPage(pageId) {
  // Update sidebar active menu item styling
  document.querySelectorAll('.sidebar .menu-item').forEach(item => {
    if (item.getAttribute('data-page') === pageId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Switch visible page view
  document.querySelectorAll('.page-view').forEach(view => {
    if (view.id === pageId) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  // Safe page-specific load updates
  try {
    if (pageId === 'home-page') {
      updateDashboard();
    } else if (pageId === 'payment-page') {
      setTimeout(() => {
        const barcodeInput = document.getElementById('scan-barcode-input');
        if (barcodeInput) barcodeInput.focus();
      }, 100);
      renderCart();
      renderQuickCatalog();
    } else if (pageId === 'add-product-page') {
      renderProductTable();
    } else if (pageId === 'member-page') {
      renderMemberTable();
    } else if (pageId === 'report-page') {
      loadReportData();
    } else if (pageId === 'settings-page') {
      applySettingsToDOM();
    }
  } catch (err) {
    console.error("Error switching page views:", err);
  }

  // On mobile/tablet screen sizes, automatically collapse the sidebar after clicking a menu item
  if (window.innerWidth <= 1024) {
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarEl) {
      sidebarEl.classList.add('collapsed');
      localStorage.setItem('nok_pos_sidebar_collapsed', 'true');
    }
  }
}

// Populate Year options dynamically (current year - 10 to current year + 5)
function populateYearFilter() {
  const yearSelect = document.getElementById('filter-year');
  if (!yearSelect) return;
  
  yearSelect.innerHTML = '';
  
  const currentYearAD = new Date().getFullYear();
  const currentYearBE = currentYearAD + 543;
  
  // Dynamic range: 10 years back and 5 years ahead
  const startYear = currentYearBE - 10;
  const endYear = currentYearBE + 5;
  
  for (let beYear = startYear; beYear <= endYear; beYear++) {
    const option = document.createElement('option');
    option.value = beYear;
    option.textContent = `พ.ศ. ${beYear}`;
    if (beYear === currentYearBE) {
      option.selected = true;
    }
    yearSelect.appendChild(option);
  }
}

// Utility: Local Date-Time ISO formatter
function getLocalDateTimeString(date = new Date()) {
  try {
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
    return localISOTime;
  } catch (e) {
    return "";
  }
}

// Robust barcode cleaning function to handle formatting differences (e.g. spaces, decimals, scientific notation)
function cleanBarcode(barcode) {
  if (barcode === undefined || barcode === null) return '';
  let str = String(barcode).trim();
  
  // Handle scientific notation (e.g. 8.85099e+12)
  if (/^\d+\.?\d*e\+\d+$/i.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && Number.isSafeInteger(num)) {
      str = String(num);
    }
  }
  
  // Handle decimal numbers (e.g. 8850999111222.0 or 8850999111222.00)
  if (str.includes('.')) {
    const parts = str.split('.');
    if (/^0+$/.test(parts[1])) {
      str = parts[0];
    }
  }
  
  return str;
}

function setCurrentDateTime(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.value = getLocalDateTimeString();
  }
}

// Setup inputs, search suggestions, barcodes
function setupSearchAndInputs() {
  const barcodeInput = document.getElementById('scan-barcode-input');
  const barcodeSuggestionsBox = document.getElementById('barcode-suggestions');
  
  if (barcodeInput) {
    barcodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (barcodeSuggestionsBox) barcodeSuggestionsBox.style.display = 'none';
        handleBarcodeScanTrigger();
      }
    });

    if (barcodeSuggestionsBox) {
      // Show suggestions on typing
      barcodeInput.addEventListener('input', () => {
        showBarcodeSuggestions(barcodeInput.value);
      });

      // Show suggestions on focus
      barcodeInput.addEventListener('focus', () => {
        showBarcodeSuggestions(barcodeInput.value);
      });

      // Close barcode suggestions when clicking outside
      document.addEventListener('click', (e) => {
        if (e.target !== barcodeInput && !barcodeSuggestionsBox.contains(e.target)) {
          barcodeSuggestionsBox.style.display = 'none';
        }
      });
    }
  }

  const searchInput = document.getElementById('search-pay-product');
  const suggestionsBox = document.getElementById('search-suggestions');
  
  if (searchInput && suggestionsBox) {
    // Show suggestions on typing
    searchInput.addEventListener('input', () => {
      showSuggestions(searchInput.value);
    });

    // Show all items when focusing on the search field for user convenience
    searchInput.addEventListener('focus', () => {
      showSuggestions(searchInput.value);
    });

    // CRITICAL FIX: Use .contains check so clicking child elements within the dropdown doesn't hide it instantly before clicking fires
    document.addEventListener('click', (e) => {
      if (e.target !== searchInput && !suggestionsBox.contains(e.target)) {
        suggestionsBox.style.display = 'none';
      }
    });
  }
}

// Renders the dropdown list for the search-pay-product field
function showSuggestions(val) {
  const suggestionsBox = document.getElementById('search-suggestions');
  if (!suggestionsBox) return;

  const query = val.toLowerCase().trim();
  suggestionsBox.innerHTML = '';

  // CRITICAL FIX: Clean barcode defensively to prevent matching issues on numeric types loaded from Sheets
  const filtered = query.length === 0 
    ? state.products.slice(0, 10) 
    : state.products.filter(p => {
        const nameStr = String(p.name || '').toLowerCase();
        const barcodeStr = cleanBarcode(p.barcode);
        const queryCleaned = cleanBarcode(query);
        return nameStr.includes(query) || (queryCleaned && barcodeStr.includes(queryCleaned)) || barcodeStr.includes(query);
      });

  if (filtered.length === 0) {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.style.color = 'var(--text-muted)';
    div.textContent = 'ไม่พบสินค้าในคลัง';
    suggestionsBox.appendChild(div);
  } else {
    filtered.forEach(p => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      
      const barcodeText = String(p.barcode || '');
      const priceVal = parseFloat(p.price) || 0;
      const stockVal = parseInt(p.stock) || 0;

      div.innerHTML = `
        <div>
          <div class="item-name" style="font-weight: 600; color: #3E2723;">${p.name || ''}</div>
          <div class="item-barcode" style="font-size: 11px; color: var(--text-muted);"><i class="fa-solid fa-barcode"></i> ${barcodeText}</div>
        </div>
        <div>
          <span style="font-weight: 700; color: #E64A19;">${priceVal.toFixed(2)} ฿</span>
          <span class="badge ${stockVal > 0 ? 'badge-success' : 'badge-danger'}" style="margin-left: 8px;">คงเหลือ ${stockVal}</span>
        </div>
      `;
      
      div.addEventListener('click', () => {
        if (stockVal <= 0) {
          Swal.fire({
            icon: 'warning',
            title: 'สินค้าหมดคลัง',
            text: `ขออภัย "${p.name}" ไม่มีสินค้าในสต็อกในขณะนี้`,
            confirmButtonColor: '#0288D1'
          });
          return;
        }
        addToCart(p);
        const input = document.getElementById('search-pay-product');
        if (input) input.value = '';
        suggestionsBox.style.display = 'none';
      });
      suggestionsBox.appendChild(div);
    });
  }

  suggestionsBox.style.display = 'block';
}

function showBarcodeSuggestions(val) {
  const suggestionsBox = document.getElementById('barcode-suggestions');
  if (!suggestionsBox) return;

  const query = val.toLowerCase().trim();
  suggestionsBox.innerHTML = '';

  const filtered = query.length === 0 
    ? state.products.slice(0, 10) 
    : state.products.filter(p => {
        const nameStr = String(p.name || '').toLowerCase();
        const barcodeStr = cleanBarcode(p.barcode);
        const queryCleaned = cleanBarcode(query);
        return nameStr.includes(query) || (queryCleaned && barcodeStr.includes(queryCleaned)) || barcodeStr.includes(query);
      });

  if (filtered.length === 0) {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.style.color = 'var(--text-muted)';
    div.textContent = 'ไม่พบสินค้าในคลัง';
    suggestionsBox.appendChild(div);
  } else {
    filtered.forEach(p => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      
      const barcodeText = String(p.barcode || '');
      const priceVal = parseFloat(p.price) || 0;
      const stockVal = parseInt(p.stock) || 0;

      div.innerHTML = `
        <div>
          <div class="item-name" style="font-weight: 600; color: #3E2723;">${p.name || ''}</div>
          <div class="item-barcode" style="font-size: 11px; color: var(--text-muted);"><i class="fa-solid fa-barcode"></i> ${barcodeText}</div>
        </div>
        <div>
          <span style="font-weight: 700; color: #E64A19;">${priceVal.toFixed(2)} ฿</span>
          <span class="badge ${stockVal > 0 ? 'badge-success' : 'badge-danger'}" style="margin-left: 8px;">คงเหลือ ${stockVal}</span>
        </div>
      `;
      
      div.addEventListener('click', () => {
        const barcodeInput = document.getElementById('scan-barcode-input');
        if (barcodeInput) {
          barcodeInput.value = barcodeText;
          suggestionsBox.style.display = 'none';
          handleBarcodeScanTrigger();
        }
      });
      suggestionsBox.appendChild(div);
    });
  }

  suggestionsBox.style.display = 'block';
}

// -------------------------------------------------------------
// 1. HOME & DASHBOARD LOGIC
// -------------------------------------------------------------
function updateDashboard() {
  const todayDateStr = getLocalDateTimeString().split('T')[0];
  
  // Calculate Today's Sales safely
  const todaySales = state.sales.filter(sale => sale.dateTime && sale.dateTime.split('T')[0] === todayDateStr);
  const totalTodayRevenue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  
  // Calculate Total Member Debt
  const totalDebt = state.members.reduce((sum, m) => sum + (m.debt || 0), 0);
  
  // Update UI Elements
  document.getElementById('dash-today-sales').textContent = `${totalTodayRevenue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
  document.getElementById('dash-total-debt').textContent = `${totalDebt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
  document.getElementById('dash-product-count').textContent = `${state.products.length} รายการ`;

  // Set default dashboard chart date if not set
  const dateInput = document.getElementById('dashboard-chart-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = todayDateStr;
  }

  // Draw dashboard sales chart
  updateHourlySalesChart();
}

function renderTodaySalesChart(todaySales, selectedDateStr = null) {
  const ctx = document.getElementById('todaySalesChart');
  if (!ctx) return;

  // Format date for display in label
  let displayDate = 'วันนี้';
  if (selectedDateStr) {
    const todayStr = getLocalDateTimeString().split('T')[0];
    if (selectedDateStr !== todayStr) {
      try {
        const d = new Date(selectedDateStr);
        displayDate = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) {
        displayDate = selectedDateStr;
      }
    }
  }

  const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
  const data = Array(hours.length).fill(0);

  todaySales.forEach(sale => {
    if (sale.dateTime && sale.dateTime.includes('T')) {
      const saleTime = sale.dateTime.split('T')[1]; // HH:MM
      if (saleTime) {
        const saleHour = parseInt(saleTime.split(':')[0]);
        const mappedIndex = saleHour - 8;
        if (mappedIndex >= 0 && mappedIndex < hours.length) {
          data[mappedIndex] += (sale.total || 0);
        }
      }
    }
  });

  if (todaySalesChartRef) {
    try {
      todaySalesChartRef.destroy();
    } catch (e) {
      console.warn("Error destroying previous chart instance:", e);
    }
  }

  // Recreate canvas element to avoid "Canvas is already in use" errors in Chart.js
  const parent = ctx.parentElement;
  const newCanvas = document.createElement('canvas');
  newCanvas.id = ctx.id;
  parent.innerHTML = '';
  parent.appendChild(newCanvas);

  todaySalesChartRef = new Chart(newCanvas, {
    type: 'bar',
    data: {
      labels: hours,
      datasets: [{
        label: `ยอดขายวันที่ ${displayDate} (บาท)`,
        data: data,
        backgroundColor: 'rgba(255, 112, 67, 0.75)',
        borderColor: '#FF7043',
        borderWidth: 2,
        borderRadius: 8,
        barPercentage: 0.6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => value + ' ฿'
          },
          grid: { color: '#FFF3E0' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

// -------------------------------------------------------------
// 2. PRODUCT MANAGEMENT LOGIC
// -------------------------------------------------------------
function generateRandomBarcode() {
  let barcode = '885'; // Thai Barcode Prefix
  for (let i = 0; i < 10; i++) {
    barcode += Math.floor(Math.random() * 10);
  }
  document.getElementById('prod-barcode').value = barcode;
}

function handleProductSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('product-id').value;
  const name = document.getElementById('prod-name').value.trim();
  const barcode = document.getElementById('prod-barcode').value.trim();
  const description = document.getElementById('prod-desc').value.trim();
  const price = parseFloat(document.getElementById('prod-price').value) || 0;
  const stock = parseInt(document.getElementById('prod-stock').value) || 0;

  // CRITICAL FIX: Clean and compare barcodes defensively, and check IDs safely
  const duplicate = state.products.find(p => cleanBarcode(p.barcode) === cleanBarcode(barcode) && String(p.id) !== String(id));
  if (duplicate) {
    Swal.fire({
      icon: 'error',
      title: 'บาร์โค้ดซ้ำกัน',
      text: `บาร์โค้ด "${barcode}" ถูกใช้งานแล้วในระบบ สำหรับสินค้า: ${duplicate.name}`,
      confirmButtonColor: '#EC407A'
    });
    return;
  }

  if (id) {
    const idx = state.products.findIndex(p => String(p.id) === String(id));
    if (idx !== -1) {
      state.products[idx] = {
        ...state.products[idx],
        name,
        barcode,
        description,
        price,
        stock
      };
      Swal.fire({
        icon: 'success',
        title: 'แก้ไขข้อมูลสำเร็จ',
        text: `อัปเดตข้อมูลของ "${name}" เรียบร้อยแล้ว`,
        timer: 1500,
        showConfirmButton: false
      });
    }
  } else {
    const newProd = {
      id: 'prod_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name,
      barcode,
      description,
      price,
      stock,
      createdAt: new Date().toISOString()
    };
    state.products.push(newProd);
    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ',
      text: `เพิ่มสินค้าใหม่ "${name}" เข้าสู่คลังเรียบร้อยแล้ว`,
      timer: 1500,
      showConfirmButton: false
    });
  }

  saveStateToLocalStorage('nok_pos_v2_products', state.products);
  resetProductForm();
  renderProductTable();
  renderQuickCatalog();
  updateDashboard();
}

function editProduct(id) {
  const p = state.products.find(prod => String(prod.id) === String(id));
  if (!p) return;

  document.getElementById('product-id').value = p.id;
  document.getElementById('prod-name').value = p.name || '';
  document.getElementById('prod-barcode').value = cleanBarcode(p.barcode);
  document.getElementById('prod-desc').value = p.description || '';
  document.getElementById('prod-price').value = p.price || 0;
  document.getElementById('prod-stock').value = p.stock || 0;

  const submitBtn = document.querySelector('#product-form button[type="submit"]');
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> อัปเดตข้อมูลสินค้า';
  
  document.getElementById('product-form').scrollIntoView({ behavior: 'smooth' });
}

function deleteProduct(id) {
  const p = state.products.find(prod => String(prod.id) === String(id));
  if (!p) return;

  Swal.fire({
    title: 'ต้องการลบสินค้านี้ใช่หรือไม่?',
    text: `ลบ "${p.name}" จะทำให้ข้อมูลหายถาวรจากหน่วยความจำภายใน`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ใช่, ต้องการลบ!',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      state.products = state.products.filter(prod => String(prod.id) !== String(id));
      saveStateToLocalStorage('nok_pos_v2_products', state.products);
      renderProductTable();
      renderQuickCatalog();
      updateDashboard();
      Swal.fire({
        title: 'ลบสำเร็จ!',
        text: 'สินค้าถูกลบออกจากคลังแล้ว',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

// Clear form
function resetProductForm() {
  document.getElementById('product-id').value = '';
  document.getElementById('product-form').reset();
  
  const submitBtn = document.querySelector('#product-form button[type="submit"]');
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> บันทึกสินค้า';
}

function renderProductTable() {
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;

  // Reset check-all and bulk delete button state
  const selectAllCheckbox = document.getElementById('select-all-products');
  if (selectAllCheckbox) selectAllCheckbox.checked = false;
  
  const btnBulkDelete = document.getElementById('btn-bulk-delete');
  if (btnBulkDelete) btnBulkDelete.style.display = 'none';

  tbody.innerHTML = '';
  const searchVal = document.getElementById('search-product-list').value.toLowerCase().trim();

  // CRITICAL FIX: Clean and compare barcodes defensively on filters
  const filtered = state.products.filter(p => {
    const nameStr = String(p.name || '').toLowerCase();
    const barcodeStr = cleanBarcode(p.barcode);
    const descStr = String(p.description || '').toLowerCase();
    const cleanedSearch = cleanBarcode(searchVal);
    return nameStr.includes(searchVal) || 
           barcodeStr.includes(searchVal) || 
           (cleanedSearch && barcodeStr.includes(cleanedSearch)) ||
           descStr.includes(searchVal);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">ไม่พบรายการสินค้าที่ค้นหา</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    
    let stockBadgeClass = 'badge-success';
    const stock = parseInt(p.stock) || 0;
    if (stock === 0) stockBadgeClass = 'badge-danger';
    else if (stock <= 5) stockBadgeClass = 'badge-warning';

    const barcodeStr = cleanBarcode(p.barcode);
    const priceVal = parseFloat(p.price) || 0;

    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" class="product-checkbox" data-id="${p.id}" onchange="updateBulkDeleteButtonState()">
      </td>
      <td style="font-family: monospace; font-weight: 600;">${barcodeStr}</td>
      <td style="font-weight: 600;">${p.name || ''}</td>
      <td style="color: var(--text-muted); font-size: 13px;">${p.description || '-'}</td>
      <td style="font-weight: 700; color: #E64A19;">${priceVal.toFixed(2)} ฿</td>
      <td>
        <span class="badge ${stockBadgeClass}">
          ${stock === 0 ? 'หมดสต็อก' : stock + ' ชิ้น'}
        </span>
      </td>
      <td>
        <button class="btn btn-yellow btn-icon-only" onclick="editProduct('${p.id}')" title="แก้ไข">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-pink btn-icon-only" onclick="deleteProduct('${p.id}')" title="ลบ">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Bulk Selection and Deletion Logic
function toggleSelectAllProducts(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.product-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = masterCheckbox.checked;
  });
  updateBulkDeleteButtonState();
}

function updateBulkDeleteButtonState() {
  const checkboxes = document.querySelectorAll('.product-checkbox');
  const checkedBoxes = Array.from(checkboxes).filter(cb => cb.checked);
  const count = checkedBoxes.length;

  const btnBulkDelete = document.getElementById('btn-bulk-delete');
  const countSpan = document.getElementById('selected-products-count');
  const selectAllCheckbox = document.getElementById('select-all-products');

  if (btnBulkDelete && countSpan) {
    if (count > 0) {
      btnBulkDelete.style.display = 'inline-flex';
      btnBulkDelete.style.alignItems = 'center';
      countSpan.textContent = count;
    } else {
      btnBulkDelete.style.display = 'none';
    }
  }

  if (selectAllCheckbox) {
    if (checkboxes.length > 0 && count === checkboxes.length) {
      selectAllCheckbox.checked = true;
    } else {
      selectAllCheckbox.checked = false;
    }
  }
}

function deleteSelectedProducts() {
  const checkboxes = document.querySelectorAll('.product-checkbox');
  const checkedBoxes = Array.from(checkboxes).filter(cb => cb.checked);
  const idsToDelete = checkedBoxes.map(cb => cb.getAttribute('data-id'));

  if (idsToDelete.length === 0) return;

  Swal.fire({
    title: `ต้องการลบสินค้าที่เลือกทั้งหมด ${idsToDelete.length} รายการใช่หรือไม่?`,
    text: 'การลบนี้จะทำให้ข้อมูลหายถาวรจากหน่วยความจำภายใน',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ใช่, ต้องการลบทั้งหมด!',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      // Filter out products that have IDs in the deletion list
      state.products = state.products.filter(prod => !idsToDelete.includes(String(prod.id)));
      saveStateToLocalStorage('nok_pos_v2_products', state.products);
      
      renderProductTable();
      renderQuickCatalog();
      updateDashboard();

      Swal.fire({
        title: 'ลบสำเร็จ!',
        text: `ลบสินค้าทั้งหมด ${idsToDelete.length} รายการออกแล้ว`,
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

// Excel File Operations: Download Template and Import
function downloadExcelTemplate() {
  try {
    // Define headers in Thai
    const headers = [["บาร์โค้ด", "ชื่อสินค้า", "คำอธิบาย", "ราคาต่อหน่วย", "จำนวนคงเหลือ"]];
    const sampleData = [
      ["8850002010114", "น้ำอัดลมรสโคล่า", "กระป๋อง 325 มล.", 15.00, 24],
      ["8850100701048", "บะหมี่กึ่งสำเร็จรูป", "รสต้มยำกุ้ง 60 กรัม", 8.00, 30],
      ["1001", "ส้มสายน้ำผึ้ง", "กิโลกรัมละ", 80.00, 10]
    ];
    
    const wsData = headers.concat(sampleData);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // Set standard column widths
    ws['!cols'] = [
      { wch: 18 }, // Barcode
      { wch: 25 }, // Name
      { wch: 30 }, // Description
      { wch: 15 }, // Price
      { wch: 15 }  // Stock
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, "คลังสินค้า");
    XLSX.writeFile(wb, "nok_pos_product_template.xlsx");
    
    Swal.fire({
      icon: 'success',
      title: 'ดาวน์โหลดเทมเพลตสำเร็จ',
      text: 'ดาวน์โหลดไฟล์ nok_pos_product_template.xlsx เรียบร้อยแล้ว',
      timer: 2000,
      showConfirmButton: false
    });
  } catch (err) {
    console.error("Failed to generate Excel template:", err);
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: 'ไม่สามารถสร้างเทมเพลต Excel ได้: ' + err.message
    });
  }
}

function triggerExcelImport() {
  const fileInput = document.getElementById('excel-import-input');
  if (fileInput) fileInput.click();
}

function importProductsFromExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  Swal.fire({
    title: 'กำลังนำเข้าข้อมูลสินค้า...',
    text: 'กรุณารอสักครู่ขณะระบบตรวจสอบไฟล์ Excel',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length <= 1) {
        throw new Error("ไม่พบข้อมูลสินค้าในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลตามเทมเพลตแล้ว");
      }
      
      const headers = jsonData[0];
      
      // Dynamic column mapping helper
      const findHeaderIndex = (namesList) => {
        return headers.findIndex(h => {
          if (!h) return false;
          const cleanH = String(h).trim().toLowerCase();
          return namesList.some(name => cleanH.includes(name.toLowerCase()));
        });
      };
      
      const colBarcodeIdx = findHeaderIndex(['บาร์โค้ด', 'บาร์โคด', 'barcode']);
      const colNameIdx = findHeaderIndex(['ชื่อสินค้า', 'ชื่อ', 'name']);
      const colDescIdx = findHeaderIndex(['คำอธิบาย', 'รายละเอียด', 'description', 'desc']);
      const colPriceIdx = findHeaderIndex(['ราคาต่อหน่วย', 'ราคา', 'price']);
      const colStockIdx = findHeaderIndex(['จำนวนคงเหลือ', 'คงเหลือ', 'จำนวน', 'stock', 'qty']);
      
      if (colNameIdx === -1 || colBarcodeIdx === -1 || colPriceIdx === -1 || colStockIdx === -1) {
        throw new Error("โครงสร้างไฟล์ไม่ถูกต้อง กรุณาใช้คอลัมน์: บาร์โค้ด, ชื่อสินค้า, ราคาต่อหน่วย, จำนวนคงเหลือ");
      }
      
      let importCount = 0;
      let updateCount = 0;
      
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        
        const barcodeRaw = String(row[colBarcodeIdx] !== undefined ? row[colBarcodeIdx] : '').trim();
        const nameRaw = String(row[colNameIdx] !== undefined ? row[colNameIdx] : '').trim();
        const descRaw = colDescIdx !== -1 && row[colDescIdx] !== undefined ? String(row[colDescIdx]).trim() : '';
        const priceRaw = parseFloat(row[colPriceIdx]);
        const stockRaw = parseInt(row[colStockIdx]);
        
        if (!barcodeRaw && !nameRaw) continue;
        
        if (!barcodeRaw || !nameRaw || isNaN(priceRaw) || isNaN(stockRaw)) {
          console.warn(`Row ${i + 1} skipped due to invalid data`, row);
          continue;
        }
        
        const cleanBc = cleanBarcode(barcodeRaw);
        const existingIdx = state.products.findIndex(p => cleanBarcode(p.barcode) === cleanBc);
        
        if (existingIdx !== -1) {
          // Update existing product
          state.products[existingIdx].name = nameRaw;
          state.products[existingIdx].description = descRaw;
          state.products[existingIdx].price = Math.max(0, priceRaw);
          state.products[existingIdx].stock = Math.max(0, stockRaw);
          updateCount++;
        } else {
          // Add new product
          const newProduct = {
            id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: nameRaw,
            description: descRaw,
            price: Math.max(0, priceRaw),
            stock: Math.max(0, stockRaw),
            barcode: cleanBc,
            createdAt: new Date().toISOString()
          };
          state.products.push(newProduct);
          importCount++;
        }
      }
      
      // Save changes
      saveStateToLocalStorage('nok_pos_v2_products', state.products);
      
      // Re-render UI
      renderProductTable();
      renderQuickCatalog();
      updateDashboard();
      
      Swal.fire({
        icon: 'success',
        title: 'นำเข้าสำเร็จ!',
        text: `นำเข้าสินค้าใหม่สำเร็จ ${importCount} รายการ และอัปเดตข้อมูลสินค้าเดิม ${updateCount} รายการเรียบร้อยแล้ว`,
        confirmButtonColor: '#0288D1'
      });
      
    } catch (error) {
      console.error(error);
      Swal.fire({
        icon: 'error',
        title: 'การนำเข้าล้มเหลว',
        text: error.message
      });
    } finally {
      event.target.value = '';
    }
  };
  
  reader.onerror = function() {
    Swal.fire({
      icon: 'error',
      title: 'การอ่านไฟล์ล้มเหลว',
      text: 'ไม่สามารถอ่านไฟล์ได้สำเร็จ'
    });
    event.target.value = '';
  };
  
  reader.readAsArrayBuffer(file);
}


// -------------------------------------------------------------
// 3. PAYMENT (POS RETAIL SCREEN) LOGIC
// -------------------------------------------------------------
function handleBarcodeScanTrigger() {
  const inputEl = document.getElementById('scan-barcode-input');
  const barcode = cleanBarcode(inputEl.value);
  
  if (barcode.length === 0) return;

  // CRITICAL FIX: Clean and match barcode defensively to handle numeric/string spreadsheet mismatches
  const product = state.products.find(p => cleanBarcode(p.barcode) === barcode);
  
  if (product) {
    const stockVal = parseInt(product.stock) || 0;
    if (stockVal <= 0) {
      Swal.fire({
        icon: 'warning',
        title: 'สินค้าหมดคลัง',
        text: `ขออภัย "${product.name}" ไม่มีสินค้าในสต็อกในขณะนี้`,
        confirmButtonColor: '#0288D1'
      });
    } else {
      addToCart(product);
    }
  } else {
    Swal.fire({
      icon: 'error',
      title: 'ไม่พบสินค้า',
      text: `ไม่พบสินค้าที่มีบาร์โค้ด "${barcode}" กรุณาตรวจสอบหรือเพิ่มสินค้าในระบบก่อน`,
      confirmButtonColor: '#EC407A'
    });
  }

  inputEl.value = '';
  inputEl.focus();
}

function addToCart(product) {
  const existing = state.cart.find(item => String(item.id) === String(product.id));
  const stock = parseInt(product.stock) || 0;
  
  if (existing) {
    if (existing.qty >= stock) {
      Swal.fire({
        icon: 'warning',
        title: 'เกินขีดจำกัดจำนวนสินค้า',
        text: `ไม่สามารถระบุจำนวนสินค้าได้มากกว่ายอดคงคลังที่มีอยู่ (${stock} ชิ้น)`,
        confirmButtonColor: '#0288D1'
      });
      return;
    }
    existing.qty += 1;
  } else {
    state.cart.push({
      id: product.id,
      name: product.name,
      price: parseFloat(product.price) || 0,
      qty: 1
    });
  }

  renderCart();
  calculateChange();
}

function updateCartQty(id, change) {
  const item = state.cart.find(i => String(i.id) === String(id));
  if (!item) return;

  const product = state.products.find(p => String(p.id) === String(id));
  if (!product) return;

  const newQty = item.qty + change;
  const stock = parseInt(product.stock) || 0;

  if (newQty <= 0) {
    removeFromCart(id);
    return;
  }

  if (newQty > stock) {
    Swal.fire({
      icon: 'warning',
      title: 'สินค้าไม่เพียงพอ',
      text: `สินค้าในคลังไม่พอ มีจำนวนจำกัดอยู่ที่ ${stock} ชิ้น`,
      confirmButtonColor: '#0288D1'
    });
    return;
  }

  item.qty = newQty;
  renderCart();
  calculateChange();
}

function removeFromCart(id) {
  state.cart = state.cart.filter(item => String(item.id) !== String(id));
  renderCart();
  calculateChange();
}

function clearCart() {
  if (state.cart.length === 0) return;

  Swal.fire({
    title: 'ต้องการล้างรายการสินค้าหรือไม่?',
    text: 'การทำรายการลบนี้จะนำสินค้าทุกชิ้นออกจากตะกร้าชั่วคราว',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ล้างตะกร้า',
    cancelButtonText: 'กลับไปทำรายการ'
  }).then((result) => {
    if (result.isConfirmed) {
      state.cart = [];
      renderCart();
      calculateChange();
    }
  });
}

function renderCart() {
  const tbody = document.getElementById('cart-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (state.cart.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">
          ไม่มีสินค้าในตะกร้า เริ่มต้นค้นหาด้านบนหรือยิงบาร์โค้ดเพื่อซื้อสินค้า
        </td>
      </tr>
    `;
    document.getElementById('summary-subtotal').textContent = '0.00 ฿';
    document.getElementById('summary-total').textContent = '0.00 ฿';
    return;
  }

  let subtotal = 0;
  state.cart.forEach(item => {
    const itemTotal = (item.price || 0) * (item.qty || 0);
    subtotal += itemTotal;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600;">${item.name || ''}</td>
      <td style="color:#FF7043;">${(item.price || 0).toFixed(2)} ฿</td>
      <td>
        <div class="quantity-control">
          <button class="btn-qty" onclick="updateCartQty('${item.id}', -1)">-</button>
          <span>${item.qty || 0}</span>
          <button class="btn-qty" onclick="updateCartQty('${item.id}', 1)">+</button>
        </div>
      </td>
      <td style="font-weight: 700; color:#E64A19;">${itemTotal.toFixed(2)} ฿</td>
      <td>
        <button class="btn btn-pink btn-icon-only" style="width:28px; height:28px;" onclick="removeFromCart('${item.id}')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('summary-subtotal').textContent = `${subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
  document.getElementById('summary-total').textContent = `${subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
}

// Cash helpers
function addQuickCash(amount) {
  const cashInput = document.getElementById('payment-cash');
  let currentVal = parseFloat(cashInput.value) || 0;
  cashInput.value = (currentVal + amount).toFixed(2);
  calculateChange();
}

function setExactCash() {
  const total = getCartTotal();
  document.getElementById('payment-cash').value = total.toFixed(2);
  calculateChange();
}

function clearCashInput() {
  document.getElementById('payment-cash').value = '';
  calculateChange();
}

function getCartTotal() {
  return state.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0);
}

function calculateChange() {
  const total = getCartTotal();
  const paid = parseFloat(document.getElementById('payment-cash').value) || 0;
  
  const changeValue = document.getElementById('payment-change');
  if (!changeValue) return;

  if (state.cart.length === 0) {
    changeValue.textContent = '0.00 ฿';
    changeValue.style.color = '#1B5E20';
    return;
  }

  const change = paid - total;
  
  if (change < 0) {
    changeValue.textContent = `ขาดอีก ${Math.abs(change).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
    changeValue.style.color = '#D81B60';
  } else {
    changeValue.textContent = `${change.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
    changeValue.style.color = '#1B5E20';
  }
}

function processPayment() {
  if (state.cart.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ตะกร้าว่างเปล่า',
      text: 'กรุณาใส่สินค้าก่อนทำรายการชำระเงิน',
      confirmButtonColor: '#0288D1'
    });
    return;
  }

  const total = getCartTotal();
  const paid = parseFloat(document.getElementById('payment-cash').value);
  const paymentTime = document.getElementById('payment-datetime').value;

  if (isNaN(paid) || paid < total) {
    Swal.fire({
      icon: 'error',
      title: 'จำนวนเงินไม่ถูกต้อง',
      text: 'ยอดเงินจ่ายไม่เพียงพอ หรือยังไม่ได้ระบุจำนวนเงินสดรับที่เหมาะสม',
      confirmButtonColor: '#EC407A'
    });
    return;
  }

  const change = paid - total;

  // 1. Deduct Stock Locally
  state.cart.forEach(cartItem => {
    const p = state.products.find(prod => String(prod.id) === String(cartItem.id));
    if (p) {
      const stock = parseInt(p.stock) || 0;
      p.stock = Math.max(0, stock - cartItem.qty);
    }
  });

  // 2. Save Sale Record
  const newSale = {
    id: 'sale_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    items: [...state.cart],
    total: total,
    paid: paid,
    change: change,
    dateTime: paymentTime || getLocalDateTimeString()
  };

  state.sales.push(newSale);

  // 3. Save state to localstorage
  saveStateToLocalStorage('nok_pos_v2_products', state.products);
  saveStateToLocalStorage('nok_pos_v2_sales', state.sales);

  // 4. Fire automated sheets background sync
  silentSyncToGoogleSheets();

  // Play sound alert
  if (state.settings && state.settings.soundType) {
    playSound(state.settings.soundType);
  }

  // 5. Success Alerts
  Swal.fire({
    title: 'ชำระเงินสำเร็จ!',
    html: `
      <div style="text-align: left; padding: 0 10px;">
        <p><b>ยอดชำระ:</b> ${total.toFixed(2)} บาท</p>
        <p><b>รับเงิน:</b> ${paid.toFixed(2)} บาท</p>
        <p><b>เงินทอน:</b> ${change.toFixed(2)} บาท</p>
      </div>
    `,
    icon: 'success',
    confirmButtonColor: '#0288D1'
  }).then(() => {
    state.cart = [];
    document.getElementById('payment-cash').value = '';
    setCurrentDateTime('payment-datetime');
    renderCart();
    renderQuickCatalog();
    calculateChange();
    updateDashboard();
  });
}

function silentSyncToGoogleSheets() {
  saveDataToAppsScript('Products', state.products, () => {}, () => {});
  saveDataToAppsScript('Sales', state.sales, () => {}, () => {});
}

// Render the quick clickable catalog grid
function renderQuickCatalog() {
  const grid = document.getElementById('quick-catalog-grid');
  const countBadge = document.getElementById('catalog-count-badge');
  if (!grid) return;

  grid.innerHTML = '';
  
  if (!state.products || state.products.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
        ไม่มีสินค้าคงคลังในขณะนี้ <br>
        กรุณาไปที่แท็บ <a href="#" onclick="navigateToPage('add-product-page')" style="color:#0288D1; font-weight:600; text-decoration:underline;">"เพิ่มสินค้า"</a> หรือกดเรียกดูข้อมูลจาก Google Sheets
      </div>
    `;
    if (countBadge) countBadge.textContent = '0 สินค้า';
    return;
  }

  if (countBadge) countBadge.textContent = `${state.products.length} สินค้า`;

  state.products.forEach(p => {
    const btn = document.createElement('div');
    btn.className = 'catalog-item-btn';
    
    let stockBadgeClass = 'badge-success';
    const stock = parseInt(p.stock) || 0;
    if (stock === 0) stockBadgeClass = 'badge-danger';
    else if (stock <= 5) stockBadgeClass = 'badge-warning';

    const priceVal = parseFloat(p.price) || 0;

    btn.innerHTML = `
      <div class="catalog-item-name" title="${p.name || ''}" style="font-size:12px; font-weight:600; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name || ''}</div>
      <div class="catalog-item-price" style="font-weight:700; color:#E64A19; font-size:12px;">${priceVal.toFixed(2)} ฿</div>
      <div class="catalog-item-stock badge ${stockBadgeClass}" style="font-size:9px; padding:2px 4px; margin-top:2px;">คงเหลือ ${stock}</div>
    `;

    btn.addEventListener('click', () => {
      if (stock <= 0) {
        Swal.fire({
          icon: 'warning',
          title: 'สินค้าหมดคลัง',
          text: `ขออภัย "${p.name}" ไม่มีสินค้าในสต็อกในขณะนี้`,
          confirmButtonColor: '#0288D1'
        });
        return;
      }
      addToCart(p);
    });

    grid.appendChild(btn);
  });
}

// -------------------------------------------------------------
// 4. MEMBERS (DEBT LEDGER) LOGIC
// -------------------------------------------------------------
function handleMemberSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('member-id').value;
  const firstName = document.getElementById('member-firstname').value.trim();
  const lastName = document.getElementById('member-lastname').value.trim();
  const debt = parseFloat(document.getElementById('member-debt').value) || 0;
  const dateTime = document.getElementById('member-datetime').value;

  if (id) {
    const idx = state.members.findIndex(m => String(m.id) === String(id));
    if (idx !== -1) {
      state.members[idx] = {
        ...state.members[idx],
        firstName,
        lastName,
        debt,
        dateTime
      };
      Swal.fire({
        icon: 'success',
        title: 'แก้ไขสมาชิกสำเร็จ',
        text: `อัปเดตข้อมูลของ "${firstName} ${lastName}" เรียบร้อยแล้ว`,
        timer: 1500,
        showConfirmButton: false
      });
    }
  } else {
    const newMember = {
      id: 'member_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      firstName,
      lastName,
      debt,
      dateTime: dateTime || getLocalDateTimeString(),
      createdAt: new Date().toISOString()
    };
    state.members.push(newMember);
    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ',
      text: `เพิ่มรายชื่อสมาชิกค้างชำระ "${firstName} ${lastName}" เข้าสู่ระบบแล้ว`,
      timer: 1500,
      showConfirmButton: false
    });
  }

  saveStateToLocalStorage('nok_pos_v2_members', state.members);
  resetMemberForm();
  renderMemberTable();
  updateDashboard();
}

function editMember(id) {
  const m = state.members.find(member => String(member.id) === String(id));
  if (!m) return;

  document.getElementById('member-id').value = m.id;
  document.getElementById('member-firstname').value = m.firstName || '';
  document.getElementById('member-lastname').value = m.lastName || '';
  document.getElementById('member-debt').value = m.debt || 0;
  document.getElementById('member-datetime').value = m.dateTime || getLocalDateTimeString();

  const submitBtn = document.querySelector('#member-form button[type="submit"]');
  submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> อัปเดตข้อมูลสมาชิก';
  
  document.getElementById('member-form').scrollIntoView({ behavior: 'smooth' });
}

function deleteMember(id) {
  const m = state.members.find(member => String(member.id) === String(id));
  if (!m) return;

  Swal.fire({
    title: 'ยืนยันการลบสมาชิกใช่หรือไม่?',
    text: `ลบชื่อคุณ "${m.firstName} ${m.lastName}" ออกจากบัญชีค้างชำระเงินถาวร`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ลบสมาชิก',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      state.members = state.members.filter(member => String(member.id) !== String(id));
      saveStateToLocalStorage('nok_pos_v2_members', state.members);
      renderMemberTable();
      updateDashboard();
      Swal.fire({
        title: 'ลบเรียบร้อย!',
        text: 'ข้อมูลสมาชิกและหนี้ค้างชำระถูกนำออกจากระบบแล้ว',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

function payDebt(id) {
  const m = state.members.find(member => String(member.id) === String(id));
  if (!m) return;

  const currentDebt = m.debt || 0;

  Swal.fire({
    title: 'ชำระคืนเงินกู้ / คืนหนี้',
    text: `ระบุจำนวนเงินชำระคืนหนี้ของคุณ "${m.firstName} ${m.lastName}" (หนี้ทั้งหมด: ${currentDebt} ฿)`,
    input: 'number',
    inputAttributes: {
      min: 0,
      max: currentDebt,
      step: '0.01'
    },
    inputValue: currentDebt.toFixed(2),
    showCancelButton: true,
    confirmButtonColor: '#0288D1',
    cancelButtonColor: '#EC407A',
    confirmButtonText: 'ชำระคืนหนี้',
    cancelButtonText: 'ยกเลิก',
    inputValidator: (value) => {
      if (!value || isNaN(value) || parseFloat(value) <= 0) {
        return 'กรุณากรอกจำนวนเงินชำระที่ถูกต้อง';
      }
      if (parseFloat(value) > currentDebt) {
        return 'ไม่สามารถชำระเงินเกินกว่ายอดค้างจริงได้';
      }
    }
  }).then((result) => {
    if (result.isConfirmed) {
      const payAmount = parseFloat(result.value);
      m.debt = Math.max(0, currentDebt - payAmount);
      m.dateTime = getLocalDateTimeString();

      saveStateToLocalStorage('nok_pos_v2_members', state.members);
      renderMemberTable();
      updateDashboard();

      Swal.fire({
        icon: 'success',
        title: 'ชำระคืนหนี้สำเร็จ!',
        text: `หักล้างยอดค้างชำระจำนวน ${payAmount} บาทเรียบร้อย หนี้คงเหลือ: ${m.debt} บาท`,
        confirmButtonColor: '#0288D1'
      });
      
      silentSyncToGoogleSheets();
    }
  });
}

function resetMemberForm() {
  document.getElementById('member-id').value = '';
  document.getElementById('member-form').reset();
  setCurrentDateTime('member-datetime');
  
  const submitBtn = document.querySelector('#member-form button[type="submit"]');
  submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> บันทึกสมาชิกค้างเงิน';
}

function renderMemberTable() {
  const tbody = document.getElementById('members-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const searchVal = document.getElementById('search-member-list').value.toLowerCase().trim();

  const filtered = state.members.filter(m => 
    (m.firstName && m.firstName.toLowerCase().includes(searchVal)) ||
    (m.lastName && m.lastName.toLowerCase().includes(searchVal))
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">ไม่พบข้อมูลสมาชิกค้างเงิน</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(m => {
    const tr = document.createElement('tr');
    
    const dt = new Date(m.dateTime);
    const dateFormatted = isNaN(dt.getTime()) ? '-' : `${dt.toLocaleDateString('th-TH')} ${dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
    const debt = m.debt || 0;

    tr.innerHTML = `
      <td style="font-weight: 600;">${m.firstName || ''} ${m.lastName || ''}</td>
      <td style="font-weight: 700; color: #D81B60; font-size: 16px;">${debt.toFixed(2)} ฿</td>
      <td style="font-size: 13px; color: var(--text-muted);">${dateFormatted}</td>
      <td>
        <button class="btn btn-blue" style="padding: 6px 12px; font-size:12px;" onclick="payDebt('${m.id}')" title="ชำระคืนหนี้">
          <i class="fa-solid fa-receipt"></i> ชำระหนี้
        </button>
        <button class="btn btn-yellow btn-icon-only" style="width:30px; height:30px; padding:0;" onclick="editMember('${m.id}')" title="แก้ไข">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-pink btn-icon-only" style="width:30px; height:30px; padding:0;" onclick="deleteMember('${m.id}')" title="ลบ">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// 5. SALES REPORTS LOGIC
// -------------------------------------------------------------
function resetReportFilter() {
  populateYearFilter();
  const filterMonth = document.getElementById('filter-month');
  if (filterMonth) filterMonth.value = 'all';
  loadReportData();
}

function loadReportData() {
  const yearSelect = document.getElementById('filter-year');
  const monthSelect = document.getElementById('filter-month');
  if (!yearSelect || !monthSelect) return;

  const selectedBEYear = parseInt(yearSelect.value) || new Date().getFullYear() + 543;
  const selectedMonth = monthSelect.value;

  const selectedADYear = selectedBEYear - 543;

  const filteredSales = state.sales.filter(sale => {
    if (!sale.dateTime) return false;
    const saleDate = new Date(sale.dateTime);
    if (isNaN(saleDate.getTime())) return false;
    
    const saleYearAD = saleDate.getFullYear();
    const saleMonth = saleDate.getMonth();
    
    const yearMatch = saleYearAD === selectedADYear;
    const monthMatch = selectedMonth === 'all' || saleMonth === parseInt(selectedMonth);
    
    return yearMatch && monthMatch;
  });

  const totalRevenue = filteredSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const totalBills = filteredSales.length;

  const totalMembersDebt = state.members.reduce((sum, m) => sum + (m.debt || 0), 0);
  const activeDebtCount = state.members.filter(m => (m.debt || 0) > 0).length;

  document.getElementById('report-total-revenue').textContent = `${totalRevenue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
  document.getElementById('report-total-bills').textContent = `${totalBills} บิล`;
  document.getElementById('report-active-debt-members').textContent = `${activeDebtCount} คน`;
  document.getElementById('report-total-debt-amount').textContent = `${totalMembersDebt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;

  // Draw reports monthly chart
  renderMonthlySalesChart(filteredSales, selectedBEYear, selectedMonth);

  // Render Top 5 best sellers
  renderBestSellers(filteredSales);

  // Render sales transactions table
  renderTransactionsTable(filteredSales);
}

function renderMonthlySalesChart(filteredSales, beYear, month) {
  const ctx = document.getElementById('monthlySalesBarChart');
  if (!ctx) return;

  let labels = [];
  let data = [];
  
  if (month === 'all') {
    labels = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    data = Array(12).fill(0);
    
    filteredSales.forEach(sale => {
      if (sale.dateTime) {
        const d = new Date(sale.dateTime);
        if (!isNaN(d.getTime())) {
          data[d.getMonth()] += (sale.total || 0);
        }
      }
    });
  } else {
    const adYear = beYear - 543;
    const daysInMonth = new Date(adYear, parseInt(month) + 1, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      labels.push(day.toString());
      data.push(0);
    }
    
    filteredSales.forEach(sale => {
      if (sale.dateTime) {
        const d = new Date(sale.dateTime);
        if (!isNaN(d.getTime())) {
          const dayIdx = d.getDate() - 1;
          if (dayIdx >= 0 && dayIdx < data.length) {
            data[dayIdx] += (sale.total || 0);
          }
        }
      }
    });
  }

  if (monthlySalesChartRef) {
    try {
      monthlySalesChartRef.destroy();
    } catch (e) {
      console.warn("Error destroying previous monthly chart instance:", e);
    }
  }

  // Recreate canvas to prevent "Canvas is already in use" Chart.js crash
  const parent = ctx.parentElement;
  const newCanvas = document.createElement('canvas');
  newCanvas.id = ctx.id;
  parent.innerHTML = '';
  parent.appendChild(newCanvas);

  const filterMonthEl = document.getElementById('filter-month');
  let selectedMonthText = '';
  if (filterMonthEl && filterMonthEl.options && filterMonthEl.selectedIndex >= 0) {
    selectedMonthText = filterMonthEl.options[filterMonthEl.selectedIndex].text;
  }

  const chartTitle = month === 'all' 
    ? `ยอดขายรายเดือนประจำปี พ.ศ. ${beYear}`
    : `ยอดขายรายวันประจำเดือน ${selectedMonthText} พ.ศ. ${beYear}`;

  monthlySalesChartRef = new Chart(newCanvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'ยอดขายรวม (บาท)',
        data: data,
        borderColor: '#FF7043',
        backgroundColor: 'rgba(255, 112, 67, 0.15)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#FF5722',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: chartTitle,
          font: { family: 'Prompt', size: 14, weight: '600' },
          color: '#3E2723'
        },
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => value + ' ฿'
          },
          grid: { color: '#FFF3E0' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderBestSellers(sales) {
  const tbody = document.getElementById('best-sellers-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const prodTotals = {};

  sales.forEach(sale => {
    if (sale.items && Array.isArray(sale.items)) {
      sale.items.forEach(item => {
        if (item.name) {
          prodTotals[item.name] = (prodTotals[item.name] || 0) + (item.qty || 0);
        }
      });
    }
  });

  const sorted = Object.keys(prodTotals).map(name => ({
    name: name,
    qty: prodTotals[name]
  })).sort((a, b) => b.qty - a.qty).slice(0, 5);

  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align: center; color: var(--text-muted); padding: 20px;">ไม่มีข้อมูลการขายในช่วงนี้</td>
      </tr>
    `;
    return;
  }

  sorted.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600;">${item.name}</td>
      <td style="text-align: right; font-weight: 700; color: #0288D1;">${item.qty} ชิ้น</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTransactionsTable(sales) {
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const sortedSales = [...sales].reverse();

  if (sortedSales.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">ไม่พบรายการธุรกรรมในช่วงนี้</td>
      </tr>
    `;
    return;
  }

  sortedSales.forEach(sale => {
    const tr = document.createElement('tr');

    const dt = new Date(sale.dateTime);
    const dateStr = isNaN(dt.getTime()) 
      ? '-' 
      : `${dt.toLocaleDateString('th-TH')} ${dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;

    let itemsSummary = '';
    if (sale.items && Array.isArray(sale.items)) {
      itemsSummary = sale.items.map(item => `${item.name || ''} (${item.qty || 0} ชิ้น)`).join(', ');
    } else {
      itemsSummary = '-';
    }

    const total = sale.total || 0;
    const paid = sale.paid || 0;
    const change = sale.change || 0;

    tr.innerHTML = `
      <td style="font-family: monospace; font-size: 12px; color: var(--text-muted);">${sale.id || ''}</td>
      <td style="font-size:13px;">${dateStr}</td>
      <td style="font-size:13px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemsSummary}">
        ${itemsSummary}
      </td>
      <td style="font-weight:700; color: #E64A19;">${total.toFixed(2)} ฿</td>
      <td style="color: #0288D1;">${paid.toFixed(2)} ฿</td>
      <td style="color: #2E7D32;">${change.toFixed(2)} ฿</td>
      <td>
        <button class="btn btn-yellow btn-icon-only" style="width:30px; height:30px; padding:0; margin-right:4px;" onclick="editTransaction('${sale.id}')" title="แก้ไขบิล">
          <i class="fa-solid fa-pen" style="font-size:11px;"></i>
        </button>
        <button class="btn btn-pink btn-icon-only" style="width:30px; height:30px; padding:0;" onclick="deleteTransaction('${sale.id}')" title="ยกเลิก/ลบบิล">
          <i class="fa-solid fa-trash-can" style="font-size:11px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function editTransaction(id) {
  const sale = state.sales.find(s => String(s.id) === String(id));
  if (!sale) return;

  const total = sale.total || 0;
  
  // Format dateTime for datetime-local input (YYYY-MM-DDTHH:MM)
  let dtStr = '';
  if (sale.dateTime) {
    const d = new Date(sale.dateTime);
    if (!isNaN(d.getTime())) {
      const tzOffset = d.getTimezoneOffset() * 60000;
      dtStr = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
    }
  }
  if (!dtStr) {
    dtStr = getLocalDateTimeString();
  }

  Swal.fire({
    title: 'แก้ไขข้อมูลบิลขาย',
    html: `
      <div style="text-align: left;">
        <p style="margin-bottom: 8px;"><b>เลขที่รายการ:</b> ${sale.id}</p>
        <p style="margin-bottom: 16px;"><b>ยอดสุทธิ:</b> <span style="color: #E64A19; font-weight: 700;">${total.toFixed(2)} ฿</span></p>
        
        <div class="form-group" style="margin-bottom: 14px;">
          <label class="form-label" for="edit-sale-datetime">วันที่และเวลาชำระเงิน</label>
          <input class="form-input" type="datetime-local" id="edit-sale-datetime" value="${dtStr}">
        </div>
        
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label" for="edit-sale-paid">จำนวนเงินที่จ่าย (บาท)</label>
          <input class="form-input" type="number" id="edit-sale-paid" min="${total}" step="0.01" value="${sale.paid || 0}">
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonColor: '#0288D1',
    cancelButtonColor: '#EC407A',
    confirmButtonText: 'บันทึกการแก้ไข',
    cancelButtonText: 'ยกเลิก',
    preConfirm: () => {
      const newDateTime = document.getElementById('edit-sale-datetime').value;
      const newPaid = parseFloat(document.getElementById('edit-sale-paid').value);
      
      if (!newDateTime) {
        Swal.showValidationMessage('กรุณาระบุวันที่และเวลา');
        return false;
      }
      if (isNaN(newPaid) || newPaid < total) {
        Swal.showValidationMessage(`จำนวนเงินจ่ายไม่เพียงพอ (ขั้นต่ำ ${total.toFixed(2)} บาท)`);
        return false;
      }
      
      return { newDateTime, newPaid };
    }
  }).then((result) => {
    if (result.isConfirmed) {
      const { newDateTime, newPaid } = result.value;
      
      sale.dateTime = newDateTime;
      sale.paid = newPaid;
      sale.change = newPaid - total;
      
      // Save changes
      saveStateToLocalStorage('nok_pos_v2_sales', state.sales);
      
      // Sync in background
      silentSyncToGoogleSheets();
      
      // Refresh views
      loadReportData();
      updateDashboard();
      
      Swal.fire({
        icon: 'success',
        title: 'แก้ไขบิลสำเร็จ!',
        text: 'ข้อมูลบิลได้รับการอัปเดตและบันทึกเรียบร้อย',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

function deleteTransaction(id) {
  const sale = state.sales.find(s => String(s.id) === String(id));
  if (!sale) return;

  Swal.fire({
    title: 'ยืนยันการยกเลิก/ลบบิล?',
    html: `
      <div style="text-align: left; font-size: 14px;">
        <p>คุณต้องการยกเลิกบิลเลขที่ <b>${sale.id}</b> ใช่หรือไม่?</p>
        <p style="color: #EC407A; font-weight: 600; margin-top: 8px;">* ระบบจะทำการคืนสินค้าในบิลนี้เข้าสต็อกให้โดยอัตโนมัติ</p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ใช่, ลบและคืนสต็อก!',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      // Revert stock
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const product = state.products.find(p => String(p.id) === String(item.id));
          if (product) {
            product.stock = (parseInt(product.stock) || 0) + (parseInt(item.qty) || 0);
          }
        });
      }
      
      // Remove sale
      state.sales = state.sales.filter(s => String(s.id) !== String(id));
      
      // Save updated states
      saveStateToLocalStorage('nok_pos_v2_products', state.products);
      saveStateToLocalStorage('nok_pos_v2_sales', state.sales);
      
      // Sync in background
      silentSyncToGoogleSheets();
      
      // Refresh views
      loadReportData();
      updateDashboard();
      renderProductTable();
      renderQuickCatalog();
      
      Swal.fire({
        icon: 'success',
        title: 'ยกเลิกบิลสำเร็จ!',
        text: 'ลบบิลและทำการคืนสินค้าเข้าคลังเรียบร้อยแล้ว',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

// -------------------------------------------------------------
// 6. GOOGLE SHEET INTEGRATION VIA FETCH (POST) & JSONP (GET)
// -------------------------------------------------------------

function callAppsScriptJSONP(params, successCallback, errorCallback) {
  const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
  
  window[callbackName] = function(response) {
    delete window[callbackName];
    const scriptTag = document.getElementById(scriptId);
    if (scriptTag) scriptTag.remove();
    successCallback(response);
  };
  
  const scriptId = 'jsonp_script_' + Date.now();
  const script = document.createElement('script');
  script.id = scriptId;
  
  try {
    const url = new URL(GAS_URL);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    url.searchParams.append('callback', callbackName);
    
    script.src = url.toString();
    script.onerror = function() {
      delete window[callbackName];
      const scriptTag = document.getElementById(scriptId);
      if (scriptTag) scriptTag.remove();
      errorCallback(new Error('การเชื่อมต่อสเปรดชีตล้มเหลว กรุณาตรวจสอบ:\n1. คุณเปิดใช้งาน Ad Blocker หรือ Browser Shield (เช่น Brave Shield, uBlock) หรือไม่ (กรุณาปิดชั่วคราวแล้วลองอีกครั้ง)\n2. การตั้งค่า Deploy Web App ใน Google Sheets ได้เปิดสิทธิ์เข้าถึงแบบ "Anyone" (ทุกคน) แล้วหรือยัง'));
    };
    
    document.body.appendChild(script);
  } catch (e) {
    delete window[callbackName];
    errorCallback(new Error('ที่อยู่ URL ของ Google Apps Script ไม่ถูกต้อง: ' + e.message));
  }
}

function loadFromGoogleSheet(sheetName) {
  Swal.fire({
    title: `กำลังโหลดข้อมูล ${sheetName}...`,
    html: 'กำลังเชื่อมต่อเพื่อเรียกดูข้อมูลดิบจากสเปรดชีต Google Sheets',
    timerProgressBar: true,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  const url = `${GAS_URL}?action=load&sheetName=${sheetName}`;

  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error("HTTP error " + res.status);
      return res.json();
    })
    .then(response => {
      if (response && response.success) {
        handleLoadResponse(sheetName, response);
      } else {
        throw new Error(response ? response.error : 'ไม่สามารถดึงข้อมูลได้');
      }
    })
    .catch(err => {
      console.warn("Fetch GET failed, attempting JSONP fallback...", err);
      
      const params = {
        action: 'load',
        sheetName: sheetName
      };

      callAppsScriptJSONP(params, (response) => {
        if (response && response.success) {
          handleLoadResponse(sheetName, response);
        } else {
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
            text: response ? response.error : 'ไม่พบการตอบรับจาก Apps Script',
            confirmButtonColor: '#EC407A'
          });
        }
      }, (jsonpErr) => {
        Swal.fire({
          icon: 'error',
          title: 'การเชื่อมต่อผิดพลาด',
          text: jsonpErr.message,
          confirmButtonColor: '#EC407A'
        });
      });
    });
}

function handleLoadResponse(sheetName, response) {
  if (sheetName === 'Products') {
    state.products = Array.isArray(response.data) ? response.data : [];
    saveStateToLocalStorage('nok_pos_v2_products', state.products);
    renderProductTable();
    renderQuickCatalog();
  } else if (sheetName === 'Members') {
    state.members = Array.isArray(response.data) ? response.data : [];
    saveStateToLocalStorage('nok_pos_v2_members', state.members);
    renderMemberTable();
  } else if (sheetName === 'Sales') {
    state.sales = Array.isArray(response.data) ? response.data : [];
    saveStateToLocalStorage('nok_pos_v2_sales', state.sales);
    loadReportData();
  }

  updateDashboard();

  Swal.fire({
    icon: 'success',
    title: 'โหลดข้อมูลสำเร็จ!',
    text: `ดึงข้อมูลจาก Google Sheets จำนวน ${response.count || 0} รายการ เรียบร้อยแล้ว`,
    confirmButtonColor: '#0288D1'
  });
}

function saveToGoogleSheet(sheetName) {
  let dataToSave = [];
  
  if (sheetName === 'Products') {
    dataToSave = state.products;
  } else if (sheetName === 'Members') {
    dataToSave = state.members;
  } else if (sheetName === 'Sales') {
    dataToSave = state.sales;
  }

  Swal.fire({
    title: `กำลังบันทึกข้อมูล ${sheetName}...`,
    html: `กำลังจัดเตรียมข้อมูลจำนวน ${dataToSave.length} รายการ เพื่ออัปโหลดไปยัง Google Sheet`,
    timerProgressBar: true,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  saveDataToAppsScript(sheetName, dataToSave, (response) => {
    if (response && response.success) {
      Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ!',
        text: `บันทึกรายการข้อมูลทั้งหมดลงใน Google Sheets สำเร็จ`,
        confirmButtonColor: '#0288D1'
      });
    } else {
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาดในการอัปโหลด',
        text: response ? response.error : 'ไม่สามารถเขียนข้อมูลได้',
        confirmButtonColor: '#EC407A'
      });
    }
  }, (err) => {
    Swal.fire({
      icon: 'error',
      title: 'เครือข่ายผิดพลาด',
      text: err.message,
      confirmButtonColor: '#EC407A'
    });
  });
}

// Dual-mode save: Uses CORS POST fetch first, falls back to no-cors POST (for large payloads), and finally JSONP GET.
function saveDataToAppsScript(sheetName, data, successCallback, errorCallback) {
  const payload = {
    action: 'save',
    sheetName: sheetName,
    data: data
  };

  fetch(GAS_URL, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8' // Crucial to prevent preflight OPTIONS failures in Apps Script
    },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) throw new Error("HTTP error " + res.status);
    return res.json();
  })
  .then(response => {
    if (response && response.success) {
      successCallback(response);
    } else {
      console.warn("POST returned success=false, trying no-cors fallback...", response);
      saveDataToAppsScriptNoCors(sheetName, data, successCallback, errorCallback);
    }
  })
  .catch(err => {
    console.warn("CORS POST fetch failed, attempting no-cors fallback...", err);
    saveDataToAppsScriptNoCors(sheetName, data, successCallback, errorCallback);
  });
}

function saveDataToAppsScriptNoCors(sheetName, data, successCallback, errorCallback) {
  const payload = {
    action: 'save',
    sheetName: sheetName,
    data: data
  };

  fetch(GAS_URL, {
    method: 'POST',
    mode: 'no-cors', // Bypasses CORS redirect errors and handles large payloads
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  })
  .then(() => {
    // Under no-cors mode, the response is opaque, but we assume success if no error was thrown
    successCallback({ success: true, message: 'บันทึกข้อมูลเรียบร้อย (no-cors)' });
  })
  .catch(err => {
    console.warn("no-cors POST failed too, falling back to JSONP...", err);
    saveDataToAppsScriptJSONP(sheetName, data, successCallback, errorCallback);
  });
}

function saveDataToAppsScriptJSONP(sheetName, data, successCallback, errorCallback) {
  const params = {
    action: 'save',
    sheetName: sheetName,
    data: JSON.stringify(data)
  };
  callAppsScriptJSONP(params, successCallback, errorCallback);
}

// =============================================================
// NEW FEATURES: COLLAPSIBLE SIDEBAR, SETTINGS & SOUND EFFECTS
// =============================================================

function setupSidebarToggle() {
  const sidebarEl = document.querySelector('.sidebar');
  const closeBtn = document.getElementById('sidebar-toggle-close');
  const openBtn = document.getElementById('sidebar-toggle-open');
  const overlayEl = document.getElementById('sidebar-overlay');

  // Load and apply persistent sidebar state
  const collapsedSaved = localStorage.getItem('nok_pos_sidebar_collapsed');
  if (collapsedSaved === 'true' && sidebarEl) {
    sidebarEl.classList.add('collapsed');
  }

  if (closeBtn && sidebarEl) {
    closeBtn.addEventListener('click', () => {
      sidebarEl.classList.add('collapsed');
      localStorage.setItem('nok_pos_sidebar_collapsed', 'true');
    });
  }

  if (openBtn && sidebarEl) {
    openBtn.addEventListener('click', () => {
      sidebarEl.classList.remove('collapsed');
      localStorage.setItem('nok_pos_sidebar_collapsed', 'false');
    });
  }

  // Close sidebar when clicking backdrop overlay (on mobile/tablet)
  if (overlayEl && sidebarEl) {
    overlayEl.addEventListener('click', () => {
      sidebarEl.classList.add('collapsed');
      localStorage.setItem('nok_pos_sidebar_collapsed', 'true');
    });
  }
}

function applySettingsToDOM() {
  const shopName = state.settings.shopName || 'ระบบร้านค้า เจ้นก';
  const shopDesc = state.settings.shopDesc || 'ภาพรวมยอดขายวันนี้และกิจกรรมล่าสุดในร้านค้า เจ้นก';
  const shopPhone = state.settings.shopPhone || '';
  const shopContact = state.settings.shopContact || '';
  const shopAddress = state.settings.shopAddress || '';

  // Document title
  document.title = shopName + ' - POS';

  // Sidebar title
  const sidebarTitleEl = document.getElementById('sidebar-shop-name');
  if (sidebarTitleEl) sidebarTitleEl.textContent = shopName;

  // Sidebar footer description
  const sidebarFooterDesc = document.getElementById('sidebar-footer-desc');
  if (sidebarFooterDesc) {
    const displayFooterName = shopName.replace('ระบบร้านค้า ', '');
    sidebarFooterDesc.textContent = 'ระบบ POS ร้าน' + displayFooterName;
  }

  // Home-page shop description
  const homeShopDesc = document.getElementById('home-shop-desc');
  if (homeShopDesc) homeShopDesc.textContent = shopDesc;

  // Welcome announcement title
  const homeWelcomeTitle = document.getElementById('home-welcome-title');
  if (homeWelcomeTitle) homeWelcomeTitle.textContent = 'ยินดีต้อนรับสู่' + shopName + '!';

  // Update Home Page Contact Info
  const homeInfoAddress = document.getElementById('home-info-address');
  const homeInfoPhone = document.getElementById('home-info-phone');
  const homeInfoContact = document.getElementById('home-info-contact');

  if (homeInfoAddress) homeInfoAddress.textContent = shopAddress || 'ไม่ได้ระบุที่อยู่';
  if (homeInfoPhone) homeInfoPhone.textContent = shopPhone || 'ไม่ได้ระบุเบอร์โทรศัพท์';
  if (homeInfoContact) homeInfoContact.textContent = shopContact || 'ไม่ได้ระบุข้อมูลติดต่อ';

  // Populate settings page inputs if they are in DOM
  const settingsShopNameInput = document.getElementById('settings-shop-name');
  const settingsShopDescInput = document.getElementById('settings-shop-desc');
  const settingsShopPhoneInput = document.getElementById('settings-shop-phone');
  const settingsShopContactInput = document.getElementById('settings-shop-contact');
  const settingsShopAddressInput = document.getElementById('settings-shop-address');
  const settingsSoundSelect = document.getElementById('settings-sound-select');

  if (settingsShopNameInput) settingsShopNameInput.value = shopName;
  if (settingsShopDescInput) settingsShopDescInput.value = shopDesc;
  if (settingsShopPhoneInput) settingsShopPhoneInput.value = shopPhone;
  if (settingsShopContactInput) settingsShopContactInput.value = shopContact;
  if (settingsShopAddressInput) settingsShopAddressInput.value = shopAddress;
  if (settingsSoundSelect) settingsSoundSelect.value = state.settings.soundType || 'cash-register';
}

function handleSettingsSubmit(e) {
  e.preventDefault();

  const shopName = document.getElementById('settings-shop-name').value.trim();
  const shopDesc = document.getElementById('settings-shop-desc').value.trim();
  const shopPhone = document.getElementById('settings-shop-phone').value.trim();
  const shopContact = document.getElementById('settings-shop-contact').value.trim();
  const shopAddress = document.getElementById('settings-shop-address').value.trim();
  const soundType = document.getElementById('settings-sound-select').value;

  state.settings = {
    shopName,
    shopDesc,
    shopPhone,
    shopContact,
    shopAddress,
    soundType
  };

  saveStateToLocalStorage('nok_pos_v2_settings', state.settings);
  applySettingsToDOM();

  Swal.fire({
    icon: 'success',
    title: 'บันทึกการตั้งค่าสำเร็จ',
    text: 'ระบบได้รับการอัปเดตข้อมูลการตั้งค่าใหม่เรียบร้อยแล้ว',
    timer: 1500,
    showConfirmButton: false
  });
}

function playSound(type) {
  try {
    // If it's a custom sound, play it using HTML5 Audio element directly
    if (type && type.startsWith('custom_sound_')) {
      const customSound = state.customSounds.find(s => s.id === type);
      if (customSound && customSound.data) {
        const audio = new Audio(customSound.data);
        audio.play().catch(err => console.error("Error playing custom sound:", err));
      }
      return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;

    if (type === 'cash-register') {
      // 1. Clink metallic sound (50ms noise burst)
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
      
      const bufferSize = audioCtx.sampleRate * 0.05;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = audioCtx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.08, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.005, now + 0.05);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      noiseNode.start(now);

      // 2. High chime (dual sine wave frequencies)
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const bellGain = audioCtx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1500, now);
      osc1.frequency.exponentialRampToValueAtTime(1200, now + 0.4);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1800, now);
      osc2.frequency.exponentialRampToValueAtTime(1500, now + 0.4);

      bellGain.gain.setValueAtTime(0, now);
      bellGain.gain.linearRampToValueAtTime(0.15, now + 0.02);
      bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc1.connect(bellGain);
      osc2.connect(bellGain);
      bellGain.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.6);
      osc2.stop(now + 0.6);

    } else if (type === 'chime') {
      // Pleasant chime (E5 -> B5)
      const playTone = (freq, start, duration) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        
        gainNode.gain.setValueAtTime(0.12, start);
        gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start(start);
        osc.stop(start + duration);
      };
      
      playTone(659.25, now, 0.4); // E5
      playTone(987.77, now + 0.12, 0.5); // B5

    } else if (type === 'beep') {
      // Clean short beep
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      
      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now);
      osc.stop(now + 0.08);

    } else if (type === 'loud-bell') {
      // Additive synthesis for a rich, louder brass bell
      const frequencies = [350, 440, 550, 700, 880, 1100, 1400, 1760];
      const gains = [0.2, 0.2, 0.15, 0.12, 0.08, 0.06, 0.04, 0.02];
      const decays = [1.8, 1.5, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2];

      frequencies.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = (i === 0 || i === 1) ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(gains[i], now + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + decays[i]);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start(now);
        osc.stop(now + decays[i]);
      });
    }
  } catch (e) {
    console.error("Audio playback error:", e);
  }
}

function testSelectedSound() {
  const select = document.getElementById('settings-sound-select');
  if (select) {
    playSound(select.value);
  }
}

// -------------------------------------------------------------
// NEW FEATURES: QR CODE PAYMENT UPLOAD & HOURLY CHART DATE SELECTOR
// -------------------------------------------------------------

function updateHourlySalesChart() {
  const dateInput = document.getElementById('dashboard-chart-date');
  const selectedDateStr = dateInput ? dateInput.value : getLocalDateTimeString().split('T')[0];
  
  const filteredSales = state.sales.filter(sale => sale.dateTime && sale.dateTime.split('T')[0] === selectedDateStr);
  
  renderTodaySalesChart(filteredSales, selectedDateStr);
}

function triggerQRCodeUpload() {
  const fileInput = document.getElementById('qrcode-upload-input');
  if (fileInput) fileInput.click();
}

function uploadQRCode(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 400;
      
      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
      
      try {
        localStorage.setItem('nok_pos_v2_qrcode', compressedBase64);
        loadQRCode();
        Swal.fire({
          icon: 'success',
          title: 'อัปโหลด QR Code สำเร็จ',
          text: 'บันทึกรูปภาพรับเงินเรียบร้อยแล้ว',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (err) {
        console.error("Storage error:", err);
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาดในการบันทึก',
          text: 'ไม่สามารถบันทึกรูปภาพได้เนื่องจากขนาดใหญ่เกินไป หรือหน่วยความจำเต็ม'
        });
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeQRCode() {
  Swal.fire({
    title: 'ต้องการลบรูปภาพ QR Code หรือไม่?',
    text: 'การลบนี้จะนำรูปภาพ QR Code ออกจากหน้าแรก',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ลบรูปภาพ',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.removeItem('nok_pos_v2_qrcode');
      loadQRCode();
      Swal.fire({
        icon: 'success',
        title: 'ลบรูปภาพสำเร็จ',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

function loadQRCode() {
  const imgEl = document.getElementById('qrcode-img');
  const placeholderEl = document.getElementById('qrcode-placeholder');
  const deleteBtn = document.getElementById('btn-qrcode-delete');

  if (!imgEl || !placeholderEl || !deleteBtn) return;

  const savedQRCode = localStorage.getItem('nok_pos_v2_qrcode');
  if (savedQRCode) {
    imgEl.src = savedQRCode;
    imgEl.style.display = 'block';
    placeholderEl.style.display = 'none';
    deleteBtn.style.display = 'inline-flex';
    
    // Change button text to edit/change
    const uploadBtn = document.querySelector('.qrcode-actions button.btn-blue');
    if (uploadBtn) {
      uploadBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> แก้ไข / เปลี่ยนรูปภาพ';
    }
  } else {
    imgEl.src = '';
    imgEl.style.display = 'none';
    placeholderEl.style.display = 'flex';
    deleteBtn.style.display = 'none';
    
    // Restore original text
    const uploadBtn = document.querySelector('.qrcode-actions button.btn-blue');
    if (uploadBtn) {
      uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i> อัปโหลด QR Code';
    }
  }
}

function loadGrocerySampleProducts() {
  const sampleGrocery = [
    // Drinks (1-20)
    { name: "น้ำดื่มตราสิงห์ 600มล.", price: 10, barcode: "8850999111001", description: "น้ำดื่มสะอาดชื่นใจ" },
    { name: "น้ำดื่มตราสิงห์ 1.5ลิตร", price: 20, barcode: "8850999111002", description: "น้ำดื่มขวดใหญ่จุใจ" },
    { name: "น้ำแร่มิเนเร่ 500มล.", price: 12, barcode: "8850999111003", description: "น้ำแร่ธรรมชาติแท้" },
    { name: "โค้ก ออริจินัล 325มล.", price: 15, barcode: "8850888222001", description: "น้ำอัดลมรสซ่าสดชื่น" },
    { name: "โค้ก ไม่มีน้ำตาล 325มล.", price: 15, barcode: "8850888222002", description: "น้ำอัดลมทางเลือกสุขภาพ" },
    { name: "เป๊ปซี่ 430มล.", price: 16, barcode: "8850888222003", description: "น้ำซ่าเย็นชื่นใจ" },
    { name: "สไปรท์ 325มล.", price: 15, barcode: "8850888222004", description: "น้ำหวานรสเลมอนไลม์" },
    { name: "แฟนต้าน้ำแดง 325มล.", price: 15, barcode: "8850888222005", description: "น้ำแดงกลิ่นสตรอเบอร์รี่" },
    { name: "แฟนต้าน้ำส้ม 325มล.", price: 15, barcode: "8850888222006", description: "น้ำอัดลมรสส้มซ่า" },
    { name: "ชาเขียวโออิชิ รสต้นตำรับ 500มล.", price: 25, barcode: "8850999555001", description: "ชาเขียวสกัดจากใบชาธรรมชาติ" },
    { name: "ชาเขียวโออิชิ รสเกนไมฉา 500มล.", price: 25, barcode: "8850999555002", description: "ชาเขียวผสมข้าวคั่วญี่ปุ่น" },
    { name: "ชาเขียวโออิชิ รสน้ำผึ้งมะนาว 500มล.", price: 25, barcode: "8850999555003", description: "ชาเขียวรสหวานอมเปรี้ยว" },
    { name: "ชาเขียวอิชิตัน รสจมูกข้าว 500มล.", price: 20, barcode: "8850999555004", description: "ชาเขียวกลิ่นหอมจมูกข้าว" },
    { name: "เครื่องดื่มสปอนเซอร์ 325มล.", price: 12, barcode: "8850025111001", description: "เกลือแร่คืนความสดชื่น" },
    { name: "เครื่องดื่มชูกำลัง เอ็ม-150 150มล.", price: 12, barcode: "8850025111002", description: "เพิ่มพลังและสมาธิสำหรับวันทำงาน" },
    { name: "เครื่องดื่มชูกำลัง คาราบาวแดง 150มล.", price: 10, barcode: "8850025111003", description: "นักสู้ผู้ยิ่งใหญ่ ร่างกายกระชุ่มกระชวย" },
    { name: "นมสดพาสเจอร์ไรส์โฟร์โมสต์ รสจืด 225มล.", price: 13, barcode: "8850188333001", description: "นมโคสดแท้คุณภาพ" },
    { name: "นมจืดโฟร์โมสต์ รสหวาน 225มล.", price: 13, barcode: "8850188333002", description: "รสชาติหวานกลมกล่อม" },
    { name: "นมช็อกโกแลตโฟร์โมสต์ 225มล.", price: 13, barcode: "8850188333003", description: "รสช็อกโกแลตเข้มข้นถูกใจเด็กๆ" },
    { name: "นมเปรี้ยวดัชมิลล์ รสผลไม้รวม 180มล.", price: 12, barcode: "8850188333004", description: "นมเปรี้ยวพร้อมดื่มโยเกิร์ต" },

    // Snacks (21-40)
    { name: "เลย์ รสคลาสสิก 50ก.", price: 20, barcode: "8850999333001", description: "มันฝรั่งแผ่นเรียบรสยอดนิยม" },
    { name: "เลย์ รสโนริสาหร่าย 50ก.", price: 20, barcode: "8850999333002", description: "มันฝรั่งแผ่นหยักคลุกเคล้าสาหร่าย" },
    { name: "เลย์ รสบาบีคิว 50ก.", price: 20, barcode: "8850999333003", description: "รสบาบีคิวรมควันหอมกรุ่น" },
    { name: "ข้าวเกรียบกุ้งฮานามิ 60ก.", price: 20, barcode: "8850999333004", description: "ข้าวเกรียบรวยเพื่อนกรอบอร่อย" },
    { name: "มันฝรั่งทอดกรอบปาปริก้า 60ก.", price: 20, barcode: "8850999333005", description: "รสมันฝรั่งคลุกผงปาปริก้าเข้มข้น" },
    { name: "ถั่วลิสงอบเกลือโก๋แก่ 80ก.", price: 25, barcode: "8850999333006", description: "ถั่วอบกรอบเคี้ยวมัน" },
    { name: "ปลาหมึกอบทรงเครื่องเบนโตะ 20ก.", price: 20, barcode: "8850999333007", description: "รสเผ็ดหวานแซ่บถึงใจ" },
    { name: "ทาโร่ รสเข้มข้น 30ก.", price: 20, barcode: "8850999333008", description: "เส้นปลาอบปรุงรสไม่ใช้น้ำมัน" },
    { name: "เวเฟอร์ทิวลี่ สอดไส้ช็อกโกแลต", price: 5, barcode: "8850999333009", description: "เวเฟอร์กรอบเคลือบช็อกโกแลตหวานมัน" },
    { name: "ยูโร่เค้ก รสคัสตาร์ด 17ก.", price: 6, barcode: "8850999333010", description: "พัฟเค้กสอดไส้ครีมคัสตาร์ดนุ่มละมุน" },
    { name: "เยลลี่ปีโป้ ถ้วยรวมรส", price: 10, barcode: "8850999333011", description: "เยลลี่กลิ่นผลไม้หลากหลายรส" },
    { name: "ขนมปังขาไก่ 150ก.", price: 15, barcode: "8850999333012", description: "ขนมปังขาไก่กรอบเค็มมันมัน" },
    { name: "ขนมปังแซนวิชโอรีโอ 28ก.", price: 8, barcode: "8850999333013", description: "คุกกี้ช็อกโกแลตสอดไส้ครีมขาว" },
    { name: "สาหร่ายเถ้าแก่น้อย รสเผ็ด 15ก.", price: 15, barcode: "8850999333014", description: "สาหร่ายทอดกรอบรสชาติจัดจ้าน" },
    { name: "ป๊อกกี้ รสช็อกโกแลต 45ก.", price: 20, barcode: "8850999333015", description: "ขนมปังแท่งเคลือบช็อกโกแลตกลมกล่อม" },
    { name: "ป๊อกกี้ รสสตรอเบอร์รี่ 45ก.", price: 20, barcode: "8850999333016", description: "ขนมปังแท่งรสผลไม้หวานอมเปรี้ยว" },
    { name: "โคลอน รสครีม 45ก.", price: 20, barcode: "8850999333017", description: "ขนมปังม้วนสอดไส้ครีม" },
    { name: "โดโซะ ข้าวหอมมะลิอบกรอบ", price: 10, barcode: "8850999333018", description: "ข้าวอบกรอบรสชีสเค็มมันลงตัว" },
    { name: "ถั่วลันเตาอบกรอบกรีนนัท", price: 15, barcode: "8850999333019", description: "รสเกลือดั้งเดิมธรรมชาติ" },
    { name: "ลูกอมฮอลล์ รสน้ำผึ้งมะนาว", price: 10, barcode: "8850999333020", description: "ลูกอมช่วยลดอาการเจ็บคอ" },

    // Seasoning & Kitchen (41-60)
    { name: "น้ำปลาทิพรส 700มล.", price: 32, barcode: "8850222444001", description: "น้ำปลาแท้จากปลาไส้ตัน" },
    { name: "ซีอิ๊วขาวเด็กสมบูรณ์ สูตร 1 700มล.", price: 45, barcode: "8850222444002", description: "ซีอิ๊วหมักธรรมชาติคุณภาพดี" },
    { name: "ซอสหอยนางรมตราแม่ครัว 600มล.", price: 55, barcode: "8850222444003", description: "ซอสหอยนางรมเข้มข้นช่วยเพิ่มรสอร่อย" },
    { name: "ซอสมะเขือเทศโรซ่า 300ก.", price: 22, barcode: "8850222444004", description: "ซอสผลิตจากมะเขือเทศแท้ 100%" },
    { name: "ซอสพริกศรีราชา เผ็ดกลาง 300ก.", price: 25, barcode: "8850222444005", description: "รสเผ็ดเปรี้ยวลงตัว" },
    { name: "น้ำตาลทรายมิตรผล 1กก.", price: 28, barcode: "8850222444006", description: "น้ำตาลทรายบริสุทธิ์สะอาดขาวใส" },
    { name: "เกลือป่นปรุงทิพย์ 500ก.", price: 10, barcode: "8850222444007", description: "เกลือไอโอดีนละเอียดสะอาดพรีเมียม" },
    { name: "ผงชูรสอายิโนะโมะโต๊ะ 85ก.", price: 15, barcode: "8850222444008", description: "ช่วยทำให้อาหารกลมกล่อมกลมกลืน" },
    { name: "รสดีหมู ผงปรุงรส 75ก.", price: 18, barcode: "8850222444009", description: "ผงปรุงรสสำเร็จรูปสำหรับเมนูหมู" },
    { name: "น้ำมันพืชตราองุ่น 1ลิตร", price: 55, barcode: "8850222444010", description: "น้ำมันถั่วเหลืองผ่านการกรองใสสะอาด" },
    { name: "น้ำมันปาล์มตรามรกต 1ลิตร", price: 48, barcode: "8850222444011", description: "น้ำมันพืชปาล์มสำหรับทอดกรอบนาน" },
    { name: "น้ำส้มสายชูกลั่น ตราอสร 700มล.", price: 15, barcode: "8850222444012", description: "น้ำส้มสายชูสะอาดใสได้มาตรฐาน" },
    { name: "น้ำพริกเผาไทยแม่ประนอม 114ก.", price: 35, barcode: "8850222444013", description: "ปรุงรสอาหารแกง ต้มยำ หรือทาขนมปัง" },
    { name: "ซอสปรุงรสฝาเขียวภูเขาทอง 600มล.", price: 38, barcode: "8850222444014", description: "ซอสปรุงรสเข้มข้นปรุงได้หลากหลาย" },
    { name: "กะทิกล่องชาวเกาะ 250มล.", price: 20, barcode: "8850222444015", description: "กะทิแท้คั้นสดสะอาดสะดวกปรุง" },
    { name: "ซอสแม็กกี้ปรุงอาหาร 200มล.", price: 32, barcode: "8850222444016", description: "เหยาะปรุงรสไข่ดาวหรือผัดผัก" },
    { name: "น้ำจิ้มสุกี้พันท้ายนรสิงห์ 330ก.", price: 42, barcode: "8850222444017", description: "สูตรกวางตุ้งยอดขายอันดับหนึ่ง" },
    { name: "น้ำจิ้มไก่แม่ประนอม 390ก.", price: 35, barcode: "8850222444018", description: "จิ้มไก่ทอด ของทอดรสชาติหวานเปรี้ยว" },
    { name: "แป้งทอดกรอบโกกิ 150ก.", price: 15, barcode: "8850222444019", description: "แป้งปรุงสำเร็จทอดกรอบนุ่มยาวนาน" },
    { name: "กะปิแท้ตรากุ้งไทย 100ก.", price: 25, barcode: "8850222444020", description: "กะปิหอมกลมกล่อมผลิตจากเคยแท้" },

    // Household & Cleaners (61-80)
    { name: "น้ำยาล้างจานซันไลต์ เลมอน 500มล.", price: 15, barcode: "8850333555001", description: "ขจัดคราบมันหมดจดกลิ่นมะนาว" },
    { name: "ผงซักฟอกบรีสเอกเซล 800ก.", price: 85, barcode: "8850333555002", description: "พลังขจัดคราบซักสะอาดสะอาดหมดจด" },
    { name: "น้ำยาปรับผ้านุ่มดาวน์นี่ กลิ่นดอกไม้ 540มล.", price: 65, barcode: "8850333555003", description: "ผ้านุ่มหอมยาวนานสไตล์พรีเมียม" },
    { name: "น้ำยาปรับผ้านุ่มคอมฟอร์ท รสผ้านุ่ม 580มล.", price: 20, barcode: "8850333555004", description: "ลดกลิ่นอับชื้นกลิ่นหอมชื่นใจ" },
    { name: "สบู่ก้อนลักส์ กลิ่นซอฟท์โรส 105ก.", price: 18, barcode: "8850333555005", description: "ผิวนุ่มหอมกลิ่นกุหลาบ" },
    { name: "สบู่ก้อนโพรเทคส์ สูตรโปรคลีน 100ก.", price: 18, barcode: "8850333555006", description: "ชำระล้างแบคทีเรียเพื่อสุขภาพผิวดี" },
    { name: "ครีมอาบน้ำโชกุบุสซึ สูตรส้ม 500มล.", price: 115, barcode: "8850333555007", description: "ผิวสว่างใสเปล่งปลั่งมีชีวิตชีวา" },
    { name: "แชมพูซันซิล สีชมพู ผมมีน้ำหนัก 320มล.", price: 79, barcode: "8850333555008", description: "บำรุงเส้นผมให้เรียบลื่นจัดทรงง่าย" },
    { name: "แชมพูเคลียร์ สูตรไอซ์คูลเมนทอล 320มล.", price: 99, barcode: "8850333555009", description: "เย็นสบายหัวขจัดรังแคอย่างเห็นผล" },
    { name: "ยาสีฟันคอลเกต รสยอดนิยม 150ก.", price: 49, barcode: "8850333555010", description: "ปกป้องฟันผุ ลมหายใจหอมสดชื่น" },
    { name: "แปรงสีฟันซิสเท็มมา หัวแปรงขนาดกลาง", price: 35, barcode: "8850333555011", description: "ขนแปรงนุ่มพิเศษเข้าซอกซอนลึก" },
    { name: "น้ำยาล้างห้องน้ำเป็ดโปร 900มล.", price: 65, barcode: "8850333555012", description: "ขจัดคราบฝังลึกและฆ่าเชื้อแบคทีเรีย" },
    { name: "น้ำยาถูพื้นสปาคลีน กลิ่นลาเวนเดอร์ 800มล.", price: 35, barcode: "8850333555013", description: "แห้งไวไม่เหนียวเท้าหอมกลิ่นดอกไม้" },
    { name: "สก็อตช์-ไบรต์ ใยขัดพร้อมฟองน้ำ", price: 15, barcode: "8850333555014", description: "ล้างจานทำความสะอาดขัดขัดถูถู" },
    { name: "กระดาษทิชชู่เซลล็อกซ์แพลตตินัม (ม้วน)", price: 12, barcode: "8850333555015", description: "กระดาษทิชชู่เนื้อเหนียวนุ่มอุ้มน้ำดี" },
    { name: "ทิชชู่เปียกดีนี่ 20แผ่น", price: 29, barcode: "8850333555016", description: "สูตรอ่อนโยนสำหรับผิวบอบบาง" },
    { name: "แป้งเด็กแคร์ สูตรไฮโป-อัลเลอร์เจนิก", price: 20, barcode: "8850333555017", description: "ป้องกันผดผื่นให้สัมผัสแห้งสบาย" },
    { name: "ยากันยุงชนิดขดตราห้าห่วง", price: 15, barcode: "8850333555018", description: "ยากันยุงประสิทธิภาพสูง" },
    { name: "สเปรย์ฉีดกันยุงซอฟเฟล กลิ่นตะไคร้", price: 45, barcode: "8850333555019", description: "ฉีดผิวป้องกันยุงลายยาวนาน 7 ชั่วโมง" },
    { name: "ถุงขยะสีดำขนาด 24x30 นิ้ว (10ชิ้น)", price: 20, barcode: "8850333555020", description: "ถุงขยะเนื้อเหนียวทนทานไร้กลิ่น" },

    // Canned Food, Dried & Pantry (81-100)
    { name: "ปลากระป๋องสามแม่ครัว 155ก.", price: 18, barcode: "8850444666001", description: "ปลาแมคเคอเรลในซอสมะเขือเทศเข้มข้น" },
    { name: "ปลากระป๋องโรซ่า 155ก.", price: 18, barcode: "8850444666002", description: "ปลาซาร์ดีนเนื้อแน่นพรีเมียมในซอส" },
    { name: "หอยลายอบปรุงรสปุ้มปุ้ย 40ก.", price: 28, barcode: "8850444666003", description: "หอยลายรสเผ็ดหวานทานเล่นเป็นกับแกล้ม" },
    { name: "ข้าวสารหอมมะลิแท้คัดพิเศษ 1กก.", price: 45, barcode: "8850444666004", description: "ข้าวสารนุ่มหอมอร่อยจากชาวนาไทย" },
    { name: "วุ้นเส้นตราช้างคู่ 40ก.", price: 10, barcode: "8850444666005", description: "วุ้นเส้นถั่วเขียวแท้เหนียวนุ่มไม่เละ" },
    { name: "ไข่ไก่สดเบอร์ 3 (แพ็ค 10ฟอง)", price: 48, barcode: "8850444666006", description: "ไข่ไก่สดสะอาดคุณภาพดีราคาถูก" },
    { name: "บะหมี่กึ่งสำเร็จรูปมาม่า รสต้มยำกุ้ง", price: 8, barcode: "8850123456001", description: "รสยอดนิยมเส้นเหนียวนุ่มแซ่บซี๊ด" },
    { name: "บะหมี่กึ่งสำเร็จรูปมาม่า รสหมูสับ", price: 8, barcode: "8850123456002", description: "น้ำซุปหอมหวานกลิ่นหมูสับเน้นๆ" },
    { name: "บะหมี่กึ่งสำเร็จรูปไวไว รสปรุงสำเร็จ", price: 8, barcode: "8850123456003", description: "เส้นเหนียวไม่พองตัวเร็วซุปดั้งเดิม" },
    { name: "ยำยำช้างน้อย รสบาร์บีคิว (ห่อเล็ก)", price: 6, barcode: "8850123456004", description: "บดเคี้ยวกรุบกรอบทานดิบปรุงรสอร่อย" },
    { name: "โจ๊กกึ่งสำเร็จรูปคนอร์คัพรสหมู", price: 16, barcode: "8850123456005", description: "โจ๊กข้าวหอมมะลิเนื้อข้นเนียนนุ่ม" },
    { name: "ยาพาราเซตามอลซาร่า 10เม็ด", price: 15, barcode: "8850555777001", description: "ยาสามัญประจำบ้านบรรเทาปวดและลดไข้" },
    { name: "ยาดมตราโป๊ยเซียน ทูอินวัน", price: 12, barcode: "8850555777002", description: "ใช้ดมและทาบรรเทาอาการคัดจมูกวิงเวียน" },
    { name: "ยาอมแก้ไอโบตัน ชนิดแผ่น", price: 10, barcode: "8850555777003", description: "ช่วยให้ชุ่มคอชื่นใจแก้เจ็บคอ" },
    { name: "พลาสเตอร์ปิดแผลพรีเมียมเทนโซพลาสต์", price: 10, barcode: "8850555777004", description: "ปกป้องแผลอย่างปลอดภัย ยืดหยุ่นได้ดี" },
    { name: "เกลือแร่โอรีโอดี-ผงละลายน้ำ", price: 8, barcode: "8850555777005", description: "ช่วยชดเชยน้ำและเกลือแร่เมื่อสูญเสีย" },
    { name: "ผ้าอนามัยลอรีเอะ ซอฟท์แอนด์เซฟ (4ชิ้น)", price: 15, barcode: "8850555777006", description: "ซึมซับแห้งสบายเพื่อความมั่นใจทุกวัน" },
    { name: "มีดโกนหนวดยิลเล็ตต์ด้ามเหลือง", price: 12, barcode: "8850555777007", description: "ใบมีดโกนสองใบโกนได้เรียบเนียนเกลี้ยงเกลา" },
    { name: "ไฟแช็กตรายูนิคัส", price: 10, barcode: "8850555777008", description: "จุดติดไฟง่าย ทนทานได้มาตรฐาน" },
    { name: "ถ่านไฟฉายพานาโซนิคสีดำ AA (4ก้อน)", price: 38, barcode: "8850555777009", description: "พลังแรงทนทานเหมาะสำหรับเครื่องใช้ไฟฟ้า" }
  ];

  let addedCount = 0;
  sampleGrocery.forEach(sample => {
    const cleanBc = cleanBarcode(sample.barcode);
    const exists = state.products.some(p => cleanBarcode(p.barcode) === cleanBc);
    if (!exists) {
      const newProd = {
        id: 'prod_sample_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: sample.name,
        description: sample.description,
        price: sample.price,
        stock: 50, // default stock
        barcode: cleanBc,
        createdAt: new Date().toISOString()
      };
      state.products.push(newProd);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    saveStateToLocalStorage('nok_pos_v2_products', state.products);
    renderProductTable();
    renderQuickCatalog();
    updateDashboard();

    Swal.fire({
      icon: 'success',
      title: 'นำเข้าสินค้าสำเร็จ!',
      text: `เพิ่มสินค้าตัวอย่างร้านชำเรียบร้อยแล้ว จำนวน ${addedCount} รายการ`,
      confirmButtonColor: '#0288D1'
    });
  } else {
    Swal.fire({
      icon: 'info',
      title: 'ไม่มีการนำเข้าเพิ่มเติม',
      text: 'สินค้าตัวอย่างทั้งหมดมีอยู่ในระบบเรียบร้อยแล้ว',
      confirmButtonColor: '#FFB300'
    });
  }
}

// -------------------------------------------------------------
// CUSTOM NOTIFICATION SOUND MANAGEMENT
// -------------------------------------------------------------

function triggerSoundUpload() {
  const fileInput = document.getElementById('sound-upload-input');
  if (fileInput) fileInput.click();
}

function uploadCustomSound(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Max 1MB
  if (file.size > 1024 * 1024) {
    Swal.fire({
      icon: 'error',
      title: 'ไฟล์เสียงมีขนาดใหญ่เกินไป',
      text: 'กรุณาเลือกไฟล์เสียงที่มีขนาดไม่เกิน 1 MB เพื่อประสิทธิภาพในการบันทึกและใช้งาน',
      confirmButtonColor: '#EC407A'
    });
    event.target.value = '';
    return;
  }

  Swal.fire({
    title: 'ตั้งชื่อเสียงแจ้งเตือน',
    input: 'text',
    inputLabel: 'ตั้งชื่อสำหรับเรียกเสียงแจ้งเตือนนี้',
    inputPlaceholder: 'เช่น เสียงระดิ่งทอง, เสียงปิ๊งๆ',
    showCancelButton: true,
    confirmButtonColor: '#0288D1',
    cancelButtonColor: '#EC407A',
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก',
    inputValidator: (value) => {
      if (!value || !value.trim()) {
        return 'กรุณาระบุชื่อเสียงแจ้งเตือน';
      }
    }
  }).then((result) => {
    if (result.isConfirmed) {
      const soundName = result.value.trim();
      const reader = new FileReader();
      reader.onload = function(e) {
        const base64Data = e.target.result;
        const soundId = 'custom_sound_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const soundObj = {
          id: soundId,
          name: soundName,
          data: base64Data
        };

        saveCustomSoundToDB(soundObj).then(() => {
          state.customSounds.push(soundObj);
          
          // Refresh options and list
          refreshSoundSelectOptions();
          renderCustomSoundsList();
          
          // Select and play newly added sound
          const select = document.getElementById('settings-sound-select');
          if (select) {
            select.value = soundId;
          }
          playSound(soundId);
          
          Swal.fire({
            icon: 'success',
            title: 'เพิ่มเสียงแจ้งเตือนสำเร็จ',
            text: `เสียง "${soundName}" พร้อมใช้งานในระบบแล้ว`,
            timer: 1500,
            showConfirmButton: false
          });
        }).catch(err => {
          console.error("IndexedDB save error:", err);
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถบันทึกเสียงลงในฐานข้อมูลได้: ' + err.message
          });
        });
      };
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  });
}

function deleteCustomSound(id) {
  const sound = state.customSounds.find(s => s.id === id);
  if (!sound) return;

  Swal.fire({
    title: 'ต้องการลบเสียงนี้ใช่หรือไม่?',
    text: `ลบเสียง "${sound.name}" ออกจากระบบถาวร`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#EC407A',
    cancelButtonColor: '#0288D1',
    confirmButtonText: 'ใช่, ต้องการลบ!',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      deleteCustomSoundFromDB(id).then(() => {
        state.customSounds = state.customSounds.filter(s => s.id !== id);
        
        // If deleted sound was currently selected, reset to default 'cash-register'
        if (state.settings.soundType === id) {
          state.settings.soundType = 'cash-register';
          saveStateToLocalStorage('nok_pos_v2_settings', state.settings);
        }
        
        refreshSoundSelectOptions();
        renderCustomSoundsList();
        
        Swal.fire({
          icon: 'success',
          title: 'ลบเสียงแจ้งเตือนสำเร็จ',
          timer: 1500,
          showConfirmButton: false
        });
      }).catch(err => {
        console.error("IndexedDB delete error:", err);
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถลบข้อมูลเสียงได้: ' + err.message
        });
      });
    }
  });
}

function refreshSoundSelectOptions() {
  const select = document.getElementById('settings-sound-select');
  if (!select) return;

  // Preserve the current selected sound type (either standard or custom)
  const currentSelectedValue = state.settings.soundType || 'cash-register';

  // Clear current options and rebuild
  select.innerHTML = `
    <option value="cash-register">เสียงเครื่องคิดเงิน (Cash Register)</option>
    <option value="chime">เสียงกระดิ่งใส (Chime)</option>
    <option value="beep">เสียงติ๊ดสั้น (Beep)</option>
    <option value="loud-bell">เสียงกระดิ่งดัง (Loud Bell)</option>
    <option value="none">ปิดเสียง (No Sound)</option>
  `;

  // Append custom sounds
  state.customSounds.forEach(sound => {
    const opt = document.createElement('option');
    opt.value = sound.id;
    opt.textContent = `เสียงที่อัปโหลด: ${sound.name}`;
    select.appendChild(opt);
  });

  // Re-set selection value
  select.value = currentSelectedValue;
}

function renderCustomSoundsList() {
  const listContainer = document.getElementById('custom-sounds-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  if (state.customSounds.length === 0) {
    listContainer.innerHTML = `
      <div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 6px 0;">ยังไม่มีเสียงเพิ่มเติมที่อัปโหลด</div>
    `;
    return;
  }

  state.customSounds.forEach(sound => {
    const item = document.createElement('div');
    item.className = 'custom-sound-item';
    item.innerHTML = `
      <span style="font-weight: 500; font-size: 13px; color: var(--text-main);"><i class="fa-solid fa-music" style="margin-right: 6px; color: var(--text-muted);"></i>${sound.name}</span>
      <div style="display: flex; gap: 4px;">
        <button class="btn btn-yellow btn-icon-only" style="width: 28px; height: 28px; font-size: 12px;" onclick="playCustomSound('${sound.id}')" title="ทดสอบฟังเสียง">
          <i class="fa-solid fa-play"></i>
        </button>
        <button class="btn btn-pink btn-icon-only" style="width: 28px; height: 28px; font-size: 12px;" onclick="deleteCustomSound('${sound.id}')" title="ลบเสียงนี้">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    listContainer.appendChild(item);
  });
}

function playCustomSound(id) {
  playSound(id);
}
