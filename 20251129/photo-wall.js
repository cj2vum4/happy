
// 開啟 Google Drive 照片資料夾
function openPhotoDrive() {
    window.open('https://drive.google.com/drive/folders/18HUp2xotvu0QLqkhsKh2azipPs6cLBjD?usp=drive_link', '_blank');
}

// 導航到 index.html 對應頁面的函數
function navigateToIndex(pageId) {
    // 清除首頁自動播放
    if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
        isAutoPlaying = false;
    }
    
    // 儲存目標頁面到 localStorage，以便 index.html 可以讀取
    localStorage.setItem('targetPage', pageId);
    
    // 導航到 index.html
    window.location.href = 'index.html';
}


// 照片集功能
const PHOTO_API_URL = 'https://script.google.com/macros/s/AKfycby9Qpy74qVtVsVltvRIo9ggG7J9YMuUm0j0mUBXqSA_xhDDBvufV5PRuLdMb7pNZmhh/exec';
const TIMEOUT_MS = 30000;

// 共用的載入訊息
const PROGRESS_MESSAGES = [
    '正在連接到雲端...',
    '正在驗證權限...',
    '正在搜尋照片...',
    '正在載入照片清單...',
    '正在處理照片資料...',
    '即將完成...'
];

// 依不同資料格式萃取 URL 的共用函數
function getPhotoUrlsFromItems(items) {
    if (!Array.isArray(items)) {
        console.warn('getPhotoUrlsFromItems 接收到的不是陣列', items);
        return [];
    }
    const urls = items.map((item, index) => {
        if (typeof item === 'string') {
            console.log(`項目 ${index + 1} 是字串:`, item);
            return item;
        }
        const url = (item && (item.url || item.src || item.link || item.href || item.webViewLink || item.webContentLink)) || '';
        console.log(`項目 ${index + 1} 是物件，提取的 URL:`, url);
        return url;
    }).filter(url => {
        const isValid = !!url;
        if (!isValid) {
            console.warn('過濾掉空 URL:', url);
        }
        return isValid;
    });
    console.log('getPhotoUrlsFromItems 最終 URL 陣列大小:', urls.length);
    return urls;
}

// 產生代理圖片 URL（處理跨域與縮放）
function buildProxyUrl(photoUrl) {
    return `https://images.weserv.nl/?url=${encodeURIComponent(photoUrl)}`;
}

let loadingProgressInterval = null;

// 啟動載入進度指示器
function startLoadingProgress() {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    let progress = 0;
    const messages = PROGRESS_MESSAGES;
    
    let messageIndex = 0;
    
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
    }
    
    loadingProgressInterval = setInterval(() => {
        progress += Math.random() * 15 + 5; // 每次增加 5-20%
        
        if (progress > 95) {
            progress = 95; // 不要到達 100%，除非真的完成
        }
        
        progressBar.style.width = progress + '%';
        
        // 更新訊息
        if (progress > (messageIndex + 1) * 15 && messageIndex < messages.length - 1) {
            messageIndex++;
            progressText.textContent = messages[messageIndex];
        }
        
        if (progress >= 95) {
            clearInterval(loadingProgressInterval);
            loadingProgressInterval = null;
        }
    }, 1000);
}

// 停止載入進度指示器
function stopLoadingProgress(success = true) {
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }
    
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    if (success) {
        progressBar.style.width = '100%';
        progressText.textContent = '載入完成！';
    }
}

// 載入照片
async function loadPhotos() {
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const photoCarousel = document.getElementById('photo-carousel');
    const emptyState = document.getElementById('empty-state');
    
    console.log('開始載入照片...');
    
    // 顯示載入狀態
    loadingState.classList.remove('hidden');
    errorState.classList.add('hidden');
    photoCarousel.classList.add('hidden');
    emptyState.classList.add('hidden');
    
    // 啟動進度指示器
    startLoadingProgress();
    
    try {
        console.log('正在呼叫 API:', PHOTO_API_URL);
        
        // 設置超時機制（30秒）- Google Apps Script 可能需要較長時間
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('API 請求超時（30秒）')), TIMEOUT_MS);
        });
        
        const fetchPromise = fetch(PHOTO_API_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            }
        });
        
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        
        console.log('API 回應狀態:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // 調試：顯示原始資料
        console.log('API 回傳的原始資料:', data);
        console.log('資料類型:', typeof data);
        console.log('是否為陣列:', Array.isArray(data));
        
        // 檢查是否有錯誤
        if (data.error) {
            console.error('API 回傳錯誤:', data.error);
            throw new Error(data.error);
        }
        
        // 檢查不同的資料格式
        let items = [];
        if (data.items) {
            items = data.items;
            console.log('使用 data.items:', items);
        } else if (Array.isArray(data)) {
            items = data;
            console.log('資料本身是陣列:', items);
        } else if (data.photos) {
            items = data.photos;
            console.log('使用 data.photos:', items);
        } else {
            console.warn('未找到照片資料，嘗試所有可能的屬性:', Object.keys(data));
        }
        
        // 檢查是否有照片資料
        if (!items || !Array.isArray(items) || items.length === 0) {
            console.log('沒有找到照片資料');
            showEmptyState();
            return;
        }
        
        console.log(`找到 ${items.length} 張照片`);
        
        // 將物件陣列轉換成 URL 陣列
        const photoUrls = getPhotoUrlsFromItems(items);
        
        console.log('最終的 URL 陣列:', photoUrls);
        console.log(`成功處理 ${photoUrls.length} 個有效的照片 URL`);
        
        if (photoUrls.length === 0) {
            console.log('沒有有效的照片 URL');
            showEmptyState();
            return;
        }
        
        // 顯示照片
        stopLoadingProgress(true);
        displayPhotos(photoUrls);
        
    } catch (error) {
        console.error('載入照片時發生錯誤:', error);
        console.error('錯誤詳情:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        stopLoadingProgress(false);
        showErrorState();
    }
}

// 輪播相關變數
let currentPhotoIndex = 0;
let totalPhotos = 0;
let autoPlayInterval = null;
let isAutoPlaying = false;
let photoUrls = [];

// 鍵盤導航
function handleKeyNavigation(e) {
    switch(e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            goToPrevPhoto();
            pauseAutoPlay();
            break;
        case 'ArrowRight':
            e.preventDefault();
            goToNextPhoto();
            pauseAutoPlay();
            break;
        case ' ': // 空白鍵
            e.preventDefault();
            toggleAutoPlay();
            break;
        case 'Escape':
            pauseAutoPlay();
            break;
    }
}


// 顯示照片輪播
function displayPhotos(photos) {
    const loadingState = document.getElementById('loading-state');
    const photoCarousel = document.getElementById('photo-carousel');
    const carouselTrack = document.getElementById('carousel-track');
    const carouselLoading = document.getElementById('carousel-loading');
    
    // 儲存照片資料
    photoUrls = photos;
    totalPhotos = photos.length;
    currentPhotoIndex = 0;
    
    // 隱藏載入狀態，顯示輪播
    loadingState.classList.add('hidden');
    photoCarousel.classList.remove('hidden');
    
    // 清空輪播軌道
    carouselTrack.innerHTML = '';
    
    // 創建所有照片元素
    photos.forEach((photoUrl, index) => {
        const photoSlide = document.createElement('div');
        photoSlide.className = 'w-full flex-shrink-0 relative';
        
        // 嘗試使用代理服務載入圖片
        const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(photoUrl)}`;
        
        const img = document.createElement('img');
        img.src = proxyUrl;
        img.alt = `回憶照片 ${index + 1}`;
        img.className = 'w-full h-full object-cover cursor-pointer';
        img.loading = index === 0 ? 'eager' : 'lazy'; // 第一張圖片優先載入
        
        // 載入成功處理
        img.onload = function() {
            console.log(`照片 ${index + 1} 透過代理載入成功`);
            if (index === 0) {
                carouselLoading.classList.add('hidden');
            }
        };
        
        // 載入失敗處理
        img.onerror = function(error) {
            console.error(`照片 ${index + 1} 代理載入失敗:`, proxyUrl, error);
            
            // 創建佔位符
            photoSlide.innerHTML = `
                <div class="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-700 to-gray-800 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" class="bi bi-image text-gray-400 mb-4" viewBox="0 0 16 16">
                        <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>
                        <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/>
                    </svg>
                    <p class="text-gray-300">照片 ${index + 1} 載入失敗</p>
                </div>
            `;
            
            if (index === 0) {
                carouselLoading.classList.add('hidden');
            }
        };
        
        
        photoSlide.appendChild(img);
        carouselTrack.appendChild(photoSlide);
    });
    
    // 初始化輪播控制項
    initializeCarouselControls();
    updateCarouselDisplay();
    
    // 開始自動播放
    startAutoPlay();
}

// 初始化輪播控制項
function initializeCarouselControls() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const autoPlayBtn = document.getElementById('auto-play-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    
    // 左右按鈕事件
    prevBtn.addEventListener('click', () => {
        goToPrevPhoto();
        pauseAutoPlay(); // 用戶操作時暫停自動播放
    });
    
    nextBtn.addEventListener('click', () => {
        goToNextPhoto();
        pauseAutoPlay();
    });
    
    // 自動播放按鈕
    autoPlayBtn.addEventListener('click', toggleAutoPlay);
    
    // 全螢幕按鈕 - 已移除功能
    
    // 新增照片按鈕
    const addPhotoBtn = document.getElementById('add-photo-btn');
    if (addPhotoBtn) {
        addPhotoBtn.addEventListener('click', openPhotoDrive);
    }
    
    // 鍵盤導航
    document.addEventListener('keydown', handleKeyNavigation);
    
    // 觸控滑動
    initializeTouchSwipe();
}

// 更新輪播顯示
function updateCarouselDisplay() {
    const carouselTrack = document.getElementById('carousel-track');
    const photoCounter = document.getElementById('photo-counter');
    const indicators = document.getElementById('photo-indicators');
    
    // 移動輪播軌道
    const translateX = -currentPhotoIndex * 100;
    carouselTrack.style.transform = `translateX(${translateX}%)`;
    
    // 更新計數器
    photoCounter.textContent = `${currentPhotoIndex + 1} / ${totalPhotos}`;
    
    // 更新指示器
    updateIndicators();
}

// 更新指示器
function updateIndicators() {
    const indicators = document.getElementById('photo-indicators');
    indicators.innerHTML = '';
    
    for (let i = 0; i < totalPhotos; i++) {
        const indicator = document.createElement('button');
        indicator.className = `w-2 h-2 rounded-full transition-all duration-300 ${
            i === currentPhotoIndex 
                ? 'bg-pink-400 w-6' 
                : 'bg-gray-600 hover:bg-gray-500'
        }`;
        indicator.addEventListener('click', () => {
            goToPhoto(i);
            pauseAutoPlay();
        });
        indicators.appendChild(indicator);
    }
}

// 跳到指定照片
function goToPhoto(index) {
    if (index >= 0 && index < totalPhotos) {
        currentPhotoIndex = index;
        updateCarouselDisplay();
    }
}

// 上一張照片
function goToPrevPhoto() {
    currentPhotoIndex = currentPhotoIndex === 0 ? totalPhotos - 1 : currentPhotoIndex - 1;
    updateCarouselDisplay();
}

// 下一張照片
function goToNextPhoto() {
    currentPhotoIndex = currentPhotoIndex === totalPhotos - 1 ? 0 : currentPhotoIndex + 1;
    updateCarouselDisplay();
}

// 開始自動播放
function startAutoPlay() {
    if (!isAutoPlaying && totalPhotos > 1) {
        isAutoPlaying = true;
        autoPlayInterval = setInterval(() => {
            goToNextPhoto();
        }, 2000); // 2秒間隔
        
        // 更新按鈕狀態
        updateAutoPlayButton();
    }
}

// 暫停自動播放
function pauseAutoPlay() {
    if (isAutoPlaying) {
        isAutoPlaying = false;
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
        updateAutoPlayButton();
    }
}

// 切換自動播放
function toggleAutoPlay() {
    if (isAutoPlaying) {
        pauseAutoPlay();
    } else {
        startAutoPlay();
    }
}

// 更新自動播放按鈕
function updateAutoPlayButton() {
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const autoPlayText = document.getElementById('auto-play-text');
    
    if (isAutoPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        autoPlayText.textContent = '暫停';
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        autoPlayText.textContent = '自動播放';
    }
}

// 觸控滑動
function initializeTouchSwipe() {
    const carousel = document.getElementById('photo-carousel');
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    
    carousel.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
    }, { passive: true });
    
    carousel.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault(); // 防止頁面滾動
    }, { passive: false });
    
    carousel.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const deltaX = startX - endX;
        const deltaY = startY - endY;
        
        // 檢查是否為水平滑動（而非垂直滾動）
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (deltaX > 0) {
                // 向左滑動，顯示下一張
                goToNextPhoto();
            } else {
                // 向右滑動，顯示上一張
                goToPrevPhoto();
            }
            pauseAutoPlay();
        }
    }, { passive: true });
}

// 狀態顯示函數
function showErrorState() {
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const photoCarousel = document.getElementById('photo-carousel');
    const emptyState = document.getElementById('empty-state');
    
    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');
    photoCarousel.classList.add('hidden');
    emptyState.classList.add('hidden');
}

function showEmptyState() {
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const photoCarousel = document.getElementById('photo-carousel');
    const emptyState = document.getElementById('empty-state');
    
    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');
    photoCarousel.classList.add('hidden');
    emptyState.classList.remove('hidden');
}


// 事件監聽器
document.addEventListener('DOMContentLoaded', function() {
    // 原照片集頁面按鈕事件
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', loadPhotos);
    }
    
    
    // 空狀態新增照片按鈕
    const emptyAddPhotoBtn = document.getElementById('empty-add-photo-btn');
    if (emptyAddPhotoBtn) {
        emptyAddPhotoBtn.addEventListener('click', openPhotoDrive);
    }
    
    
    // 頁面載入時直接載入首頁照片
    loadPhotos();
});

