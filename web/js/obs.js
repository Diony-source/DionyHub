const obs = new OBSWebSocket();
let isObsConnected = false;

async function connectOBS(btn) {
    if (!btn) return;
    const ip = document.getElementById('obs-ip').value.trim() || 'localhost';
    const port = document.getElementById('obs-port').value.trim() || '4455';
    const password = document.getElementById('obs-password').value || '';
    
    const originalText = toggleButtonLoading(btn, true);

    try {
        await obs.connect(`ws://${ip}:${port}`, password, { rpcVersion: 1 });
        isObsConnected = true;
        showToast("OBS bağlantısı başarıyla kuruldu!", "success");
        
        const indicator = document.getElementById('obs-status-indicator');
        if(indicator) {
            indicator.className = "w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] transition-colors duration-300";
        }
    } catch (error) {
        isObsConnected = false;
        showToast("OBS Bağlantı Hatası: " + (error.message || "Bilinmeyen hata"), "error");
        
        const indicator = document.getElementById('obs-status-indicator');
        if(indicator) {
            indicator.className = "w-2.5 h-2.5 bg-rose-500 rounded-full shadow-[0_0_8px_rgba(225,29,72,0.8)] transition-colors duration-300";
        }
    } finally {
        toggleButtonLoading(btn, false, originalText);
    }
}

obs.on('ConnectionClosed', () => {
    if (isObsConnected) {
        showToast("OBS bağlantısı koptu!", "error");
    }
    isObsConnected = false;
    const indicator = document.getElementById('obs-status-indicator');
    if(indicator) {
        indicator.classList.replace('bg-emerald-500', 'bg-rose-500');
        indicator.classList.replace('shadow-[0_0_8px_rgba(16,185,129,0.8)]', 'shadow-[0_0_8px_rgba(225,29,72,0.8)]');
    }
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
        showToast(`⚠️ KRİTİK: ${projectName} çöktü! OBS Sahnesi Değiştirildi: ${fallbackScene}`, "error");
    } catch (e) {
        console.error("OBS sahne değiştirme başarısız:", e);
        showToast("OBS sahnesi değiştirilemedi. Sahne adını kontrol edin.", "error");
    }
}