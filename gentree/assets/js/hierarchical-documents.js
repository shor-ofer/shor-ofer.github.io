/*
 * Hierarchical Document Structure Support for person.html
 * This enhances the existing document display to support nested categories
 * specifically for Chava Carmi's articles structure.
 */

// Global counter to ensure unique category IDs
let categoryIdCounter = 0;

// Helper function to remove Hebrew nikud (vowel points) for search
function removeNikud(text) {
  if (!text) return '';
  // Remove Hebrew nikud characters (U+0591 to U+05C7)
  return text.replace(/[\u0591-\u05C7]/g, '');
}

// Function to render hierarchical document structure
function renderHierarchicalDocuments(documentStructure, person) {
  const lang = langManager.currentLang;
  const str = strings[lang];
  
  // Reset counter for each render
  categoryIdCounter = 0;
  
  let html = '';
  
  // Render the root category (כתבות / Articles)
  html += renderCategory(documentStructure, person, 0);
  
  return html;
}

// Recursive function to render a category and its contents
function renderCategory(category, person, level) {
  if (!category) return '';
  
  const lang = langManager.currentLang;
  const str = strings[lang];
  const categoryTitle = lang === 'he' ? category.title : (category.titleEn || category.title);
  
  // Use counter to ensure unique IDs even for duplicate category names
  const categoryId = `category-${sanitizeCategoryId(categoryTitle)}-${level}-${categoryIdCounter++}`;
  const isExpanded = level === 0; // Only expand top level by default
  
  // Collect all article URLs in this category (including nested)
  const allUrls = collectCategoryUrls(category, person);
  const urlsData = JSON.stringify(allUrls);
  
  // Enable folder downloads only on staging/localhost, not production
  const enableFolderDownloads = window.location.hostname.includes('staging') || 
                                 window.location.hostname.includes('localhost') ||
                                 window.location.hostname.includes('127.0.0.1');
  const showDownload = enableFolderDownloads && level > 0 && allUrls.length > 0;
  
  let html = '';
  
  // Add category header
  html += `
    <div class="hierarchical-category level-${level}" data-category-level="${level}" data-category-urls='${urlsData.replace(/'/g, "&#39;")}'>
      <div class="category-header ${isExpanded ? 'expanded' : ''}" onclick="toggleHierarchicalCategory('${categoryId}')">
        <span class="category-toggle">${isExpanded ? '▼' : '▶'}</span>
        <span class="category-icon">📁</span>
        <span class="category-title">${categoryTitle}</span>
        ${level > 0 ? `<span class="category-count">(${countArticles(category)})</span>` : ''}
        ${showDownload ? `
          <button class="category-download-btn" onclick="downloadHierarchicalCategory('${categoryId}', '${categoryTitle.replace(/'/g, "\\'")}'); event.stopPropagation();" title="${str.downloadFolder}">
            <span class="download-icon">⬇️</span>
          </button>
        ` : ''}
      </div>
      <div class="category-contents" id="${categoryId}" style="display: ${isExpanded ? 'block' : 'none'};">
  `;
  
  // Render children categories
  if (category.children && category.children.length > 0) {
    category.children.forEach(child => {
      html += renderCategory(child, person, level + 1);
    });
  }
  
  // Render articles in this category
  if (category.articles && category.articles.length > 0) {
    category.articles.forEach(article => {
      html += renderArticle(article, person);
    });
  }
  
  html += `
      </div>
    </div>
  `;
  
  return html;
}

// Render an individual article with its versions
function renderArticle(article, person) {
  const lang = langManager.currentLang;
  const str = strings[lang];
  const articleTitle = lang === 'he' ? article.title : (article.titleEn || article.title);
  const articleId = `article-${article.title.replace(/[^a-z0-9א-ת]/gi, '-')}`;
  
  // Prepare searchable data (remove nikud for better search matching)
  const searchData = {
    title: removeNikud(articleTitle.toLowerCase()),
    publication: removeNikud((article.publication || '').toLowerCase()),
    date: removeNikud((article.date || '').toLowerCase())
  };
  
  // Get transcription URL if available for content search
  const transcriptionVersion = article.versions?.find(v => v.type === 'transcription');
  const transcriptionUrl = transcriptionVersion ? resolveUrl(transcriptionVersion.url, person.id) : '';
  
  let html = `
    <div class="article-item hierarchical-article" 
         data-article-title="${searchData.title}"
         data-article-publication="${searchData.publication}"
         data-article-date="${searchData.date}"
         data-article-content=""
         data-transcription-url="${transcriptionUrl}"
         data-article-id="${articleId}">
      <div class="article-header">
        <div class="article-icon">📄</div>
        <div class="article-info">
          <div class="article-title">${articleTitle}</div>
  `;
  
  // Add publication and date info
  if (article.publication || article.date) {
    html += '<div class="article-meta">';
    if (article.publication) {
      html += `<span>פורסם ב${article.publication}</span>`;
    }
    if (article.date) {
      html += `<span>• ${article.date}</span>`;
    }
    html += '</div>';
  }
  
  html += `
        </div>
      </div>
      <div class="article-versions">
  `;
  
  // Render versions (original and transcription)
  if (article.versions && article.versions.length > 0) {
    // Sort versions to always show original first, then transcription
    const sortedVersions = [...article.versions].sort((a, b) => {
      const order = { 'original': 0, 'transcription': 1, 'external': 2 };
      return (order[a.type] || 99) - (order[b.type] || 99);
    });
    
    sortedVersions.forEach(version => {
      const versionTitle = lang === 'he' ? version.title : (version.titleEn || version.title);
      const versionIcon = version.type === 'original' ? '📄' : '📝';
      const versionClass = version.type === 'original' ? 'version-original' : 'version-transcription';
      
      // Check if this is an external link
      if (version.type === 'external' || version.fileType === 'external') {
        // For external links, open directly in new tab
        html += `
          <button class="article-version-btn ${versionClass}" onclick="window.open('${resolveUrl(version.url, person.id)}', '_blank'); event.stopPropagation();">
            <span class="version-icon">🔗</span>
            <span class="version-label">${versionTitle}</span>
          </button>
        `;
      } else {
        // Build viewer URL for internal documents
        const viewerUrl = `document-viewer.html?url=${encodeURIComponent(resolveUrl(version.url, person.id))}&title=${encodeURIComponent(articleTitle + ' - ' + versionTitle)}&type=${encodeURIComponent(version.fileType || 'pdf')}&personId=${person.id}&lang=${lang}`;
        
        html += `
          <button class="article-version-btn ${versionClass}" onclick="openArticleVersion('${viewerUrl}'); event.stopPropagation();">
            <span class="version-icon">${versionIcon}</span>
            <span class="version-label">${versionTitle}</span>
          </button>
        `;
      }
    });
  }
  
  html += `
      </div>
    </div>
  `;
  
  return html;
}

// Count total articles in a category (including nested)
function countArticles(category) {
  let count = 0;
  
  if (category.articles) {
    count += category.articles.length;
  }
  
  if (category.children) {
    category.children.forEach(child => {
      count += countArticles(child);
    });
  }
  
  return count;
}

// Toggle hierarchical category expansion
function toggleHierarchicalCategory(categoryId) {
  const contents = document.getElementById(categoryId);
  const header = document.querySelector(`[onclick*="${categoryId}"]`);
  const toggle = header.querySelector('.category-toggle');
  
  const isCurrentlyOpen = contents.style.display !== 'none';
  
  if (!isCurrentlyOpen) {
    // Close all sibling categories at the same level (accordion behavior)
    const categoryDiv = contents.parentElement; // The .hierarchical-category div
    const currentLevel = categoryDiv.getAttribute('data-category-level');
    const parentContainer = categoryDiv.parentElement; // The parent .category-contents
    
    if (parentContainer && parentContainer.classList.contains('category-contents')) {
      // Find direct sibling categories at the same level
      const siblings = Array.from(parentContainer.children).filter(child => 
        child.classList.contains('hierarchical-category') && 
        child !== categoryDiv &&
        child.getAttribute('data-category-level') === currentLevel
      );
      
      siblings.forEach(sibling => {
        const siblingContents = sibling.querySelector(':scope > .category-contents');
        const siblingHeader = sibling.querySelector(':scope > .category-header');
        const siblingToggle = siblingHeader?.querySelector('.category-toggle');
        
        if (siblingContents && siblingContents.style.display !== 'none') {
          siblingContents.style.display = 'none';
          if (siblingToggle) siblingToggle.textContent = '▶';
          if (siblingHeader) siblingHeader.classList.remove('expanded');
        }
      });
    }
    
    // Open current category
    contents.style.display = 'block';
    toggle.textContent = '▼';
    header.classList.add('expanded');
  } else {
    // Close current category
    contents.style.display = 'none';
    toggle.textContent = '▶';
    header.classList.remove('expanded');
  }
}

// Open article version in viewer
function openArticleVersion(viewerUrl) {
  // Save scroll position before navigating
  sessionStorage.setItem('personPageScrollY', window.scrollY.toString());
  window.location.href = viewerUrl;
}

// Sanitize category ID
function sanitizeCategoryId(text) {
  return text.replace(/[^a-z0-9א-ת]/gi, '-').toLowerCase();
}

// Collect all article URLs from a category (including nested)
function collectCategoryUrls(category, person) {
  const urls = [];
  
  // Add articles from this category
  if (category.articles && category.articles.length > 0) {
    category.articles.forEach(article => {
      if (article.versions && article.versions.length > 0) {
        article.versions.forEach(version => {
          urls.push({
            url: resolveUrl(version.url, person.id),
            title: article.title,
            type: version.type
          });
        });
      }
    });
  }
  
  // Recursively add from children
  if (category.children && category.children.length > 0) {
    category.children.forEach(child => {
      const childUrls = collectCategoryUrls(child, person);
      urls.push(...childUrls);
    });
  }
  
  return urls;
}

// Download entire hierarchical category as ZIP
async function downloadHierarchicalCategory(categoryId, categoryName) {
  const categoryElement = document.querySelector(`[data-category-urls]`);
  if (!categoryElement) return;
  
  // Find the specific category by walking up from the categoryId element
  const contentsDiv = document.getElementById(categoryId);
  if (!contentsDiv) return;
  
  const categoryDiv = contentsDiv.parentElement;
  const urlsDataStr = categoryDiv.getAttribute('data-category-urls');
  if (!urlsDataStr) return;
  
  const urlsData = JSON.parse(urlsDataStr.replace(/&#39;/g, "'"));
  
  const currentLang = langManager.getLang();
  const str = strings[currentLang];
  
  if (urlsData.length === 0) {
    alert(currentLang === 'he' ? 'אין קבצים להורדה בתיקייה זו' : 'No files to download in this folder');
    return;
  }
  
  // Confirm download
  const message = `${str.confirmDownload}\n\n${categoryName}: ${urlsData.length} ${currentLang === 'he' ? 'קבצים' : 'files'}`;
  if (!confirm(message)) {
    return;
  }
  
  // Check if JSZip is loaded
  if (typeof JSZip === 'undefined') {
    alert(currentLang === 'he' ? 'ספריית ZIP לא נטענה. אנא רענן את הדף ונסה שוב' : 'ZIP library not loaded. Please refresh the page and try again.');
    return;
  }
  
  const zip = new JSZip();
  
  // Find the download button and show progress
  const downloadBtn = categoryDiv.querySelector('.category-download-btn');
  const originalHTML = downloadBtn ? downloadBtn.innerHTML : '';
  if (downloadBtn) {
    downloadBtn.disabled = true;
  }
  
  try {
    let successCount = 0;
    let failCount = 0;
    
    // Download each file and add to ZIP
    for (let i = 0; i < urlsData.length; i++) {
      const doc = urlsData[i];
      const url = doc.url;
      const filename = doc.title + getFileExtensionForHierarchical(url);
      
      try {
        const response = await fetch(url);
        if (response.ok) {
          const blob = await response.blob();
          zip.file(filename, blob);
          successCount++;
        } else {
          console.warn(`Failed to download: ${url}`);
          failCount++;
        }
      } catch (error) {
        console.error(`Error downloading ${url}:`, error);
        failCount++;
      }
      
      // Update progress
      if (downloadBtn) {
        downloadBtn.innerHTML = `${Math.round((i + 1) / urlsData.length * 100)}%`;
      }
    }
    
    if (successCount === 0) {
      alert(str.downloadFailed);
      if (downloadBtn) {
        downloadBtn.innerHTML = originalHTML;
        downloadBtn.disabled = false;
      }
      return;
    }
    
    // Generate ZIP file
    if (downloadBtn) {
      downloadBtn.innerHTML = str.creatingZip || 'יוצר ZIP...';
    }
    const zipBlob = await zip.generateAsync({type: 'blob'});
    
    // Download the ZIP file
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `${sanitizeFilenameForHierarchical(categoryName)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    
    // Show success
    if (downloadBtn) {
      downloadBtn.innerHTML = '✓';
      setTimeout(() => {
        downloadBtn.innerHTML = originalHTML;
        downloadBtn.disabled = false;
      }, 2000);
    }
    
    if (failCount > 0) {
      console.warn(`${failCount} files failed to download`);
    }
    
  } catch (error) {
    console.error('Error creating ZIP:', error);
    alert(currentLang === 'he' ? 'שגיאה ביצירת קובץ ZIP' : 'Error creating ZIP file');
    if (downloadBtn) {
      downloadBtn.innerHTML = originalHTML;
      downloadBtn.disabled = false;
    }
  }
}

// Helper function to get file extension from URL
function getFileExtensionForHierarchical(url) {
  const match = url.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1]}` : '.pdf';
}

// Helper function to sanitize filename for download
function sanitizeFilenameForHierarchical(filename) {
  return filename.replace(/[^a-z0-9א-ת\-_]/gi, '-').replace(/-+/g, '-');
}

// Search function for hierarchical documents
function filterHierarchicalArticles() {
  const searchInput = document.getElementById('hierarchicalDocumentSearch');
  if (!searchInput) return;
  
  const searchTerm = removeNikud(searchInput.value.toLowerCase().trim());
  const articles = document.querySelectorAll('.hierarchical-article');
  const categories = document.querySelectorAll('.hierarchical-category');
  
  // If no search term, show all
  if (!searchTerm) {
    articles.forEach(article => {
      article.style.display = 'flex';
    });
    categories.forEach(category => {
      category.style.display = 'block';
    });
    return;
  }
  
  // Track which categories have visible articles
  const categoriesWithMatches = new Set();
  
  // Filter articles
  articles.forEach(article => {
    const title = article.getAttribute('data-article-title') || '';
    const publication = article.getAttribute('data-article-publication') || '';
    const date = article.getAttribute('data-article-date') || '';
    const content = article.getAttribute('data-article-content') || '';
    
    const matches = title.includes(searchTerm) || 
                   publication.includes(searchTerm) || 
                   date.includes(searchTerm) ||
                   content.includes(searchTerm);
    
    article.style.display = matches ? 'flex' : 'none';
    
    // If article matches, mark its parent categories as having matches
    if (matches) {
      let parent = article.parentElement;
      while (parent) {
        if (parent.classList && parent.classList.contains('hierarchical-category')) {
          categoriesWithMatches.add(parent);
        }
        parent = parent.parentElement;
      }
    }
  });
  
  // Show/hide categories based on whether they have matching articles
  categories.forEach(category => {
    const hasMatches = categoriesWithMatches.has(category);
    const level = parseInt(category.getAttribute('data-category-level') || '0');
    
    // Always show root level (level 0)
    // For other levels, only show if they have matches
    if (level === 0 || hasMatches) {
      category.style.display = 'block';
      
      // Expand categories with matches
      if (hasMatches && level > 0) {
        const categoryId = category.querySelector('.category-contents')?.id;
        if (categoryId) {
          const contents = document.getElementById(categoryId);
          const header = category.querySelector('.category-header');
          const toggle = header?.querySelector('.category-toggle');
          
          if (contents && header && toggle) {
            contents.style.display = 'block';
            toggle.textContent = '▼';
            header.classList.add('expanded');
          }
        }
      }
    } else {
      category.style.display = 'none';
    }
  });
}

// Load transcription content for full-text search
async function loadTranscriptionContent(articleElement) {
  const transcriptionUrl = articleElement.getAttribute('data-transcription-url');
  if (!transcriptionUrl) return;
  
  try {
    const response = await fetch(transcriptionUrl);
    if (!response.ok) return;
    
    const blob = await response.blob();
    const fileType = transcriptionUrl.toLowerCase().split('.').pop();
    
    let textContent = '';
    
    if (fileType === 'docx') {
      // Use mammoth to extract text from .docx
      if (window.mammoth) {
        const arrayBuffer = await blob.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        textContent = result.value;
      }
    } else if (fileType === 'txt') {
      textContent = await blob.text();
    } else if (fileType === 'pdf') {
      // For PDF, we'd need pdf.js, skip for now
      return;
    }
    
    // Remove nikud and store for search
    const searchableContent = removeNikud(textContent.toLowerCase());
    articleElement.setAttribute('data-article-content', searchableContent);
  } catch (error) {
    console.log('Could not load transcription for search:', transcriptionUrl);
  }
}

// Load all transcription content for searchability
async function loadAllTranscriptionContent() {
  const articles = document.querySelectorAll('.hierarchical-article[data-transcription-url]');
  
  // Load in batches to avoid overwhelming the browser
  const batchSize = 5;
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = Array.from(articles).slice(i, i + batchSize);
    await Promise.all(batch.map(article => loadTranscriptionContent(article)));
  }
  
  console.log(`Loaded ${articles.length} transcriptions for search`);
}

// Export functions to global scope
window.renderHierarchicalDocuments = renderHierarchicalDocuments;
window.toggleHierarchicalCategory = toggleHierarchicalCategory;
window.openArticleVersion = openArticleVersion;
window.downloadHierarchicalCategory = downloadHierarchicalCategory; // Available on staging/local only
window.loadAllTranscriptionContent = loadAllTranscriptionContent;
window.filterHierarchicalArticles = filterHierarchicalArticles;
