let projects = [];

async function fetchProjects() {
    try {
        const res = await fetch('/api/projects');
        const rawData = await res.json();
        
        if (Array.isArray(rawData)) {
            projects = rawData;
        } else if (rawData && Array.isArray(rawData.data)) {
            projects = rawData.data;
        } else if (rawData && Array.isArray(rawData.projects)) {
            projects = rawData.projects;
        } else if (typeof rawData === 'object') {
            projects = Object.values(rawData);
        } else {
            projects = [];
        }
        
        renderHUD();
    } catch (e) {
        console.error("HUD Fetch Error:", e);
        const container = document.getElementById('hud-container');
        if (container) {
            container.innerHTML = `<div class="text-rose-400 font-black text-xs p-3 bg-rose-500/10 border-l-4 border-rose-500 rounded-lg hud-item">Ağ Hatası: Bağlantı Koptu</div>`;
        }
    }
}

function renderHUD() {
    const container = document.getElementById('hud-container');
    if (!container) return;
    
    const activeProjects = projects.filter(p => p.status === 'running' || p.Status === 'running');
    
    // Üst Başlık (Puslu beyaz gölge silindi, net renkler kullanıldı)
    let htmlContent = `
        <div class="px-2 mb-2 flex items-center gap-2.5">
            <div class="w-2.5 h-2.5 rounded-full transition-colors duration-300 ${activeProjects.length > 0 ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-gray-500 shadow-[0_0_8px_#6b7280]'}"></div>
            <span class="text-xs text-indigo-300 font-black uppercase tracking-[0.2em] hud-text">DionyHUD</span>
        </div>
    `;

    if (activeProjects.length === 0) {
        htmlContent += `
            <div class="hud-item border-gray-600 flex items-center gap-3 px-5 py-3 rounded-lg min-w-[220px] opacity-80">
                <span class="text-gray-300 text-xs font-bold tracking-wider">Sistem beklemede...</span>
            </div>
        `;
    } else {
        activeProjects.forEach(p => {
            const safeName = p.name || p.Name || "Unknown";
            htmlContent += `
                <div class="hud-item border-[#34d399] flex items-center justify-between gap-8 px-5 py-3 rounded-lg mb-2 min-w-[220px]">
                    <span class="text-white text-[13px] font-black tracking-wide hud-text truncate max-w-[240px]">${safeName}</span>
                    <span class="text-emerald-400 text-[11px] font-black uppercase tracking-widest hud-text">UP</span>
                </div>
            `;
        });
    }

    container.innerHTML = htmlContent;
}

function connectWS() {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            
            if (msg.action === 'reload') {
                fetchProjects();
            } 
            else if (msg.id === 'metrics') {
                const stats = JSON.parse(msg.data);
                let needsRender = false;
                
                stats.forEach(stat => {
                    const p = projects.find(x => String(x.id || x.ID) === String(stat.id));
                    if (p && p.status !== stat.status) {
                        p.status = stat.status;
                        needsRender = true;
                    }
                });
                
                if (needsRender) renderHUD();
            }
        } catch(err) {}
    };

    ws.onclose = () => setTimeout(connectWS, 3000);
    ws.onerror = () => ws.close();
}

fetchProjects().then(connectWS);