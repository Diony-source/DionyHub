const obs = new OBSWebSocket();
let isObsConnected = false;

// 🛡️ OBS Crash Detection: Kullanıcının kendi isteğiyle durdurduğu projeleri takip eder
window.manualStopFlags = new Set();

// 🕵️ AĞ DİNLEYİCİSİ V2 (Interceptor): Arayüzdeki "Stop" isteklerinin HER varyasyonunu yakalar
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
        const options = args[1] || {};

        if (url && (url.includes('/stop') || url.includes('/kill'))) {
            // 1. URL Path içinden yakalama (/api/projects/123/stop)
            const match = url.match(/\/projects\/([^\/]+)\/stop/);
            if (match && match[1]) window.manualStopFlags.add(String(match[1]));

            // 2. Query Parametrelerinden yakalama (/api/stop?id=123)
            try {
                const urlObj = new URL(url, window.location.origin);
                const idParam = urlObj.searchParams.get('id');
                if (idParam) window.manualStopFlags.add(String(idParam));
            } catch(e) {}

            // 3. 🚀 ASIL DÜZELTME: JSON Body (Gövde) içinden yakalama
            if (options.body && typeof options.body === 'string') {
                try {
                    const bodyObj = JSON.parse(options.body);
                    if (bodyObj.id) window.manualStopFlags.add(String(bodyObj.id));
                    if (bodyObj.ID) window.manualStopFlags.add(String(bodyObj.ID));
                    if (bodyObj.project_id) window.manualStopFlags.add(String(bodyObj.project_id));
                    
                    // Bulk Stop (Toplu durdurma) destekleri
                    if (Array.isArray(bodyObj.ids)) bodyObj.ids.forEach(id => window.manualStopFlags.add(String(id)));
                    if (Array.isArray(bodyObj.project_ids)) bodyObj.project_ids.forEach(id => window.manualStopFlags.add(String(id)));
                } catch(e) {}
            }
        }
    } catch (err) {
        console.error("OBS Fetch Interceptor Error:", err);
    }
    
    return originalFetch.apply(this, args);
};

// 💉 MONKEY PATCHING: Garanti olsun diye arayüzdeki (UI) fonksiyonları doğrudan kancalarız
setTimeout(() => {
    if (typeof window.stopProject === 'function') {
        const originalStop = window.stopProject;
        window.stopProject = function(id, ...args) {
            if(id) window.manualStopFlags.add(String(id));
            return originalStop.apply(this, [id, ...args]);
        };
    }
    if (typeof window.executeBulkAction === 'function') {
        const originalBulk = window.executeBulkAction;
        window.executeBulkAction = function(action, ...args) {
            if(action === 'stop' && typeof selectedProjectIds !== 'undefined') {
                selectedProjectIds.forEach(id => window.manualStopFlags.add(String(id)));
            }
            return originalBulk.apply(this, [action, ...args]);
        };
    }
}, 1000);

// --- OBS BAĞLANTI VE ARAYÜZ YÖNETİMİ ---

async function toggleOBSConnection(btn) {
    if (!btn) return;

    // EĞER ZATEN BAĞLIYSA: BAĞLANTIYI KES
    if (isObsConnected) {
        try {
            await obs.disconnect();
            isObsConnected = false;
            updateObsUI(btn, false);
            if (typeof showToast === 'function') showToast("OBS bağlantısı isteğiniz üzerine kesildi.", "success");
        } catch (e) {
            console.error("OBS Disconnect Error:", e);
        }
        return;
    }

    // EĞER BAĞLI DEĞİLSE: BAĞLAN
    const ip = document.getElementById('obs-ip').value.trim() || '127.0.0.1';
    const port = document.getElementById('obs-port').value.trim() || '4455';
    const password = document.getElementById('obs-password').value || '';
    
    btn.disabled = true;
    const originalText = btn.innerText;
    btn.innerText = "Bağlanıyor...";

    try {
        await obs.connect(`ws://${ip}:${port}`, password, { rpcVersion: 1 });
        isObsConnected = true;
        updateObsUI(btn, true);
        if (typeof showToast === 'function') showToast("OBS bağlantısı başarıyla kuruldu!", "success");
        
        // 🛡️ OTOMATİK YAYINCI ZIRHI: Bağlandığı an gizlilik modunu aç!
        if (typeof isPrivacyMode !== 'undefined' && !isPrivacyMode) {
            if (typeof togglePrivacyMode === 'function') togglePrivacyMode();
            if (typeof showToast === 'function') showToast("Yayıncı Zırhı otomatik olarak AKTİF edildi.", "success");
        }

    } catch (error) {
        isObsConnected = false;
        updateObsUI(btn, false);
        if (typeof showToast === 'function') {
            showToast("OBS Bağlantı Hatası: Lütfen bilgilerinizi kontrol edin.", "error");
        }
    } finally {
        btn.disabled = false;
        if (!isObsConnected) {
            btn.innerText = originalText;
        }
    }
}

function updateObsUI(btn, connected) {
    const indicator = document.getElementById('obs-status-indicator');
    if (connected) {
        if (indicator) indicator.className = "w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] transition-colors duration-300";
        if (btn) {
            btn.className = "btn-action bg-rose-600 hover:bg-rose-500 text-white px-5 py-2 rounded-lg shadow-[0_0_15px_rgba(225,29,72,0.4)] text-xs font-bold transition-colors border border-rose-500/50";
            btn.innerText = "Bağlantıyı Kes";
        }
    } else {
        if (indicator) indicator.className = "w-2.5 h-2.5 bg-rose-500 rounded-full shadow-[0_0_8px_rgba(225,29,72,0.8)] transition-colors duration-300";
        if (btn) {
            btn.className = "btn-action bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg shadow-sm text-xs font-bold transition-colors border border-blue-500/50";
            btn.innerText = "OBS'e Bağlan";
        }
    }
}

obs.on('ConnectionClosed', () => {
    if (isObsConnected) {
        if (typeof showToast === 'function') showToast("OBS bağlantısı koptu veya OBS kapatıldı!", "error");
    }
    isObsConnected = false;
    const btn = document.getElementById('obs-toggle-btn');
    if (btn) updateObsUI(btn, false);
});

async function triggerObsEmergencyScene(projectName) {
    if (!isObsConnected) return;
    
    const fallbackScene = document.getElementById('obs-fallback-scene').value.trim();
    if (!fallbackScene) {
        console.warn("OBS Acil Durum Sahnesi ayarlanmamış.");
        return;
    }
    
    try {
        await obs.call('SetCurrentProgramScene', { sceneName: fallbackScene });
        if (typeof showToast === 'function') showToast(`⚠️ KRİTİK ÇÖKME: ${projectName} çöktü! Sahne Değiştirildi.`, "error");
    } catch (e) {
        console.error("OBS sahne değiştirme başarısız:", e);
        if (typeof showToast === 'function') showToast("OBS sahnesi değiştirilemedi. Lütfen sahne adının doğruluğunu kontrol edin.", "error");
    }
}