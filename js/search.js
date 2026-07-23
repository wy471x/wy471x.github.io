(function() {
  'use strict';

  let searchData = [];
  let searchModal, searchInput, searchResults, searchBtn, searchClose, langToggle;
  let selectedIndex = -1;
  let isDataLoaded = false;
  let currentLang = 'all';

  function init() {
    searchModal = document.getElementById('search-modal');
    searchInput = document.getElementById('search-input');
    searchResults = document.getElementById('search-results');
    searchBtn = document.getElementById('search-btn');
    searchClose = document.getElementById('search-close');
    langToggle = document.getElementById('search-lang-toggle');

    if (!searchModal || !searchInput || !searchResults) return;

    bindEvents();
  }

  function bindEvents() {
    searchBtn.addEventListener('click', openSearch);

    searchClose.addEventListener('click', closeSearch);
    searchModal.addEventListener('click', function(e) {
      if (e.target === searchModal) closeSearch();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === '/' && !isSearchOpen()) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (e.key === 'Escape' && isSearchOpen()) {
        closeSearch();
        return;
      }

      if (!isSearchOpen()) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateResults(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateResults(-1);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        const selected = searchResults.querySelectorAll('.search-result-item')[selectedIndex];
        if (selected) {
          window.location.href = selected.getAttribute('href');
        }
      }
    });

    langToggle.addEventListener('click', toggleLang);

    searchInput.addEventListener('input', debounce(performSearch, 200));
  }

  function openSearch() {
    searchModal.classList.add('active');
    searchModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showEmptyState();
    setTimeout(() => searchInput.focus(), 100);
    if (!isDataLoaded) {
      loadSearchData();
    }
  }

  function closeSearch() {
    if (document.activeElement === searchInput) {
      searchInput.blur();
    }
    searchModal.classList.remove('active');
    searchModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    searchInput.value = '';
    searchResults.innerHTML = '';
    selectedIndex = -1;
  }

  function isSearchOpen() {
    return searchModal.classList.contains('active');
  }

  function loadSearchData() {
    fetch('/search.json')
      .then(response => response.json())
      .then(data => {
        searchData = data;
        isDataLoaded = true;
      })
      .catch(err => {
        console.error('Failed to load search data:', err);
        showError();
      });
  }

  function performSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      showEmptyState();
      return;
    }
    if (!isDataLoaded) {
      searchResults.innerHTML = '<div class="search-loading">' + (currentLang === 'zh' ? '加载中...' : 'Loading...') + '</div>';
      return;
    }

    const results = searchData.filter(post => {
      if (currentLang !== 'all' && post.lang !== currentLang) return false;
      return post.title.toLowerCase().includes(query) ||
             post.summary.toLowerCase().includes(query) ||
             post.content.toLowerCase().includes(query) ||
             post.categories.some(cat => cat.toLowerCase().includes(query));
    });

    displayResults(results, query);
  }

  function showEmptyState() {
    var hint = currentLang === 'zh' ? '输入关键词搜索文章...' : 'Type to search articles...';
    searchResults.innerHTML = '<div class="search-empty-state">' + hint + '</div>';
  }

  function displayResults(results, query) {
    selectedIndex = -1;
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">' + (currentLang === 'zh' ? '未找到结果' : 'No results found') + '</div>';
      return;
    }

    const html = results.slice(0, 10).map((post, index) => {
      const highlightedTitle = highlightText(post.title, query);
      const highlightedSummary = highlightText(post.summary || post.content, query);
      const category = post.categories[0] || '';

      return `
        <a href="${post.url}" class="search-result-item" data-index="${index}" role="option">
          <div class="search-result-content">
            <div class="search-result-title">${highlightedTitle}</div>
            <div class="search-result-summary">${highlightedSummary}</div>
          </div>
          <div class="search-result-meta">
            ${category ? `<span class="search-result-category">${category}</span>` : ''}
            <span class="search-result-date">${post.date}</span>
          </div>
        </a>
      `;
    }).join('');

    searchResults.innerHTML = html;

    searchResults.querySelectorAll('.search-result-item').forEach((item, index) => {
      item.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelection();
      });
    });
  }

  function highlightText(text, query) {
    if (!text) return '';
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toggleLang() {
    if (currentLang === 'all') {
      currentLang = 'zh';
    } else if (currentLang === 'zh') {
      currentLang = 'en';
    } else {
      currentLang = 'all';
    }
    updateLangToggle();
    performSearch();
  }

  function updateLangToggle() {
    var label = langToggle.querySelector('.lang-label');
    if (currentLang === 'all') {
      label.textContent = 'All';
      searchInput.placeholder = 'Search articles...';
    } else if (currentLang === 'zh') {
      label.textContent = '中';
      searchInput.placeholder = '搜索文章...';
    } else {
      label.textContent = 'EN';
      searchInput.placeholder = 'Search articles...';
    }
  }

  function navigateResults(direction) {
    const items = searchResults.querySelectorAll('.search-result-item');
    if (items.length === 0) return;
    selectedIndex += direction;
    if (selectedIndex < 0) {
      selectedIndex = items.length - 1;
    } else if (selectedIndex >= items.length) {
      selectedIndex = 0;
    }
    updateSelection();
    items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function updateSelection() {
    const items = searchResults.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
      } else {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      }
    });
  }

  function showError() {
    searchResults.innerHTML = '<div class="search-error">Failed to load search data</div>';
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => { clearTimeout(timeout); func(...args); };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
