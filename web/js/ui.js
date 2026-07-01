function drawSparkline(id, cpuVal) {
    if(!statsHistory[id]) statsHistory[id] = Array(20).fill(0); 
    statsHistory[id].push(cpuVal);
    if(statsHistory[id].length > 20) statsHistory[id].shift();
    
    let barsHtml = statsHistory[id].map((val, idx) => {
        let heightPercent = Math.max(5, Math.min(100, val)); 
        let opacity = 0.2 + (idx / 20) * 0.8; 
        let colorClass = val > 80 ? 'bg-rose-500' : (val > 50 ? 'bg-amber-400' : 'bg-indigo-500');
        return `<div class="w-1 ${colorClass} rounded-t-sm spark-bar" style="height: ${heightPercent}%; opacity: ${opacity};"></div>`;
    }).join('');
    
    return `<div class="flex items-end gap-[2px] h-6 w-32 ml-3 border-b border-gray-700/50 pb-px">${barsHtml}</div>`;
}

function showContextMenu(e, pId, pName, status) {
    e.preventDefault(); closeCmdPalette(); 
    const menu = document.getElementById('contextMenu'); if (!menu) return;
    menu.innerHTML = ''; 
    const isRunning = status === 'running';

    const items = [
        { label: 'Start Project', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z', color: 'text-emerald-400', action: () => startProject(pId, pName, null), disabled: isRunning },
        { label: 'Restart Project', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', color: 'text-blue-400', action: () => restartProject(pId, pName, null), disabled: !isRunning },
        { label: 'Stop Project', icon: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10h6v4H9z', color: 'text-rose-400', action: () => stopProject(pId, null), disabled: !isRunning },
        { label: 'divider' },
        { label: 'Open in VS Code', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', color: 'text-blue-400', action: () => openInVSCode(pId, null), disabled: false },
        { label: 'Edit Project', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'text-gray-400', action: () => openEditModal(pId), disabled: false },
        { label: 'Environment (.env)', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', color: 'text-teal-400', action: () => openEditModal(pId), disabled: false },
        { label: 'Export Backup', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4', color: 'text-amber-400', action: () => backupProject(pId, null), disabled: false },
        { label: 'divider' },
        { label: 'Delete', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', color: 'text-rose-500', action: () => openDeleteModal(pId), disabled: false },
    ];

    items.forEach(item => {
        if (item.label === 'divider') { const divider = document.createElement('div'); divider.className = 'h-px bg-gray-700/50 my-1 mx-2'; menu.appendChild(divider); return; }
        const btn = document.createElement('button');
        const baseColor = item.disabled ? 'text-gray-600' : item.color; const hoverClass = item.disabled ? 'cursor-not-allowed' : 'hover:bg-gray-700/50 group'; const textClass = item.disabled ? 'text-gray-600' : 'group-hover:text-white text-gray-300'; const iconScale = item.disabled ? '' : 'group-hover:scale-110';
        btn.className = `w-full text-left px-4 py-2 transition-colors flex items-center gap-3 ${hoverClass}`;
        btn.innerHTML = `<svg class="w-4 h-4 ${baseColor} ${iconScale} transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path></svg><span class="${textClass} transition-colors">${item.label}</span>`;
        btn.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (item.disabled) return; hideContextMenu(); item.action(); });
        menu.appendChild(btn);
    });

    menu.style.display = 'flex'; menu.style.flexDirection = 'column'; menu.style.pointerEvents = 'auto'; void menu.offsetWidth; 
    menu.style.left = `${e.pageX}px`; menu.style.top = `${e.pageY}px`; menu.classList.remove('scale-95', 'opacity-0'); menu.classList.add('scale-100', 'opacity-100');
}

function hideContextMenu() { const menu = document.getElementById('contextMenu'); if (!menu) return; menu.style.display = 'none'; menu.classList.remove('scale-100', 'opacity-100'); menu.classList.add('scale-95', 'opacity-0'); }

function toggleCmdPalette() {
    const pal = document.getElementById('cmdPalette'); const box = document.getElementById('cmdPaletteBox'); const input = document.getElementById('cmdInput');
    if (!pal || !box || !input) return; hideContextMenu(); 
    if (pal.classList.contains('hidden')) {
        pal.classList.replace('hidden', 'flex'); input.value = ''; handleCmdSearch({target: {value: ''}}); 
        requestAnimationFrame(() => { pal.classList.remove('opacity-0'); box.classList.remove('scale-95'); input.focus(); });
    } else { closeCmdPalette(); }
}

function closeCmdPalette() {
    const pal = document.getElementById('cmdPalette'); const box = document.getElementById('cmdPaletteBox'); if (!pal || !box) return;
    pal.classList.add('opacity-0'); box.classList.add('scale-95'); setTimeout(() => pal.classList.replace('flex', 'hidden'), 200);
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container'); if (!container) return;
    while (container.childElementCount >= 3) { container.removeChild(container.firstChild); }
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.3)]' : 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
    const icon = type === 'error' ? `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>` : `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl transform transition-all duration-300 translate-x-full opacity-0 pointer-events-auto ${bgColor} bg-[#11151f]`;
    toast.innerHTML = `${icon} <span class="text-sm font-bold drop-shadow-md">${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.classList.remove('translate-x-full', 'opacity-0'); });
    setTimeout(() => { toast.classList.add('translate-x-full', 'opacity-0'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function formatWorkspacePath(path) {
    const maxLength = 22; let cleanPath = path.replace(/\\/g, '/'); if (!cleanPath.endsWith('/')) cleanPath += '/';
    if (cleanPath.length <= maxLength) return cleanPath;
    const startPart = cleanPath.substring(0, 3); const endPartLength = maxLength - startPart.length - 3; 
    return startPart + '...' + cleanPath.substring(cleanPath.length - endPartLength);
}

function toggleButtonLoading(btn, isLoading, originalContent = '') {
    if (!btn || !(btn instanceof Element)) return originalContent;
    if (isLoading) {
        const currentContent = btn.innerHTML; btn.disabled = true; btn.classList.add('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
        return currentContent;
    } else {
        btn.disabled = false; btn.classList.remove('opacity-75', 'cursor-not-allowed'); btn.innerHTML = originalContent; return '';
    }
}

function switchView(viewName) {
    const dashboardView = document.getElementById('dashboard-view'); const settingsView = document.getElementById('settings-view'); const viewTitle = document.getElementById('view-title'); const addBtn = document.getElementById('header-add-btn'); const navDashboard = document.getElementById('nav-dashboard'); const navSettings = document.getElementById('nav-settings');
    if (viewName === 'dashboard') {
        dashboardView.classList.remove('hidden'); settingsView.classList.add('hidden'); viewTitle.innerText = "Active Library"; addBtn.classList.remove('hidden');
        if (navDashboard) navDashboard.className = "w-full flex items-center justify-between px-4 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 font-bold transition-all shadow-[inset_3px_0_0_#6366f1] group";
        if (navSettings) navSettings.className = "w-full flex items-center gap-3 px-4 py-2.5 text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 rounded-xl transition-all border border-transparent font-semibold text-left mt-6 group";
        setTimeout(refreshAllTerminalFits, 100);
    } else if (viewName === 'settings') {
        dashboardView.classList.add('hidden'); settingsView.classList.remove('hidden'); viewTitle.innerText = "System Settings"; addBtn.classList.add('hidden');
        if (navDashboard) navDashboard.className = "w-full flex items-center justify-between px-4 py-2.5 text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 rounded-xl transition-all border border-transparent font-semibold group";
        if (navSettings) navSettings.className = "w-full flex items-center gap-3 px-4 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 font-bold transition-all mt-6 shadow-[inset_3px_0_0_#6366f1] group";
    }
}

function renderWorkspaceSettings() {
    const container = document.getElementById('workspace-settings-list');
    if (!container) return;
    container.innerHTML = '';
    
    if (typeof globalWorkspaces === 'undefined') return;

    globalWorkspaces.forEach((ws, idx) => {
        const isActive = ws === globalWorkspace;
        const isMain = idx === 0;
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-3 rounded-xl border transition-all ${isActive ? 'bg-indigo-500/10 border-indigo-500/40 shadow-[inset_4px_0_0_#6366f1]' : 'bg-[#0a0d14] border-gray-700/50 hover:border-gray-600'}`;
        
        const folderName = isMain ? "Main Workspace (Hub)" : (ws.split('/').pop() || ws);
        
        div.innerHTML = `
            <div class="flex flex-col min-w-0 flex-1 cursor-pointer" onclick="switchWorkspace('${ws}')">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-bold ${isActive ? 'text-indigo-300' : 'text-gray-300'} truncate">${folderName}</span>
                    ${isActive ? '<span class="text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded uppercase tracking-wider font-black shadow-sm">Active</span>' : ''}
                    ${isMain && !isActive ? '<span class="text-[9px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-black shadow-sm border border-gray-700">Main Hub</span>' : ''}
                </div>
                <span class="text-[11px] font-mono text-gray-500 truncate mt-1" title="${ws}">${ws}</span>
            </div>
            ${!isMain && !isActive ? `<button onclick="confirmRemoveWorkspace('${ws}', event)" class="p-2 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors ml-4 shrink-0" title="Workspace'i Sil"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>` : ''}
        `;
        container.appendChild(div);
    });
}

// 🛡️ YENİ VİZYON: SİLME ONAY EKRANI (İzolasyon ve Clear Mantığına Uygun Düzeltildi)
function confirmRemoveWorkspace(ws, event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    
    showConfirmModal(
        "Workspace'i Sil / Temizle",
        `<b class="text-white">${ws}</b> adlı çalışma alanını listeden kaldırmak istediğinize emin misiniz?<br><br><span class="text-amber-400/80 text-xs font-medium leading-relaxed">Not: Yalnızca bu çalışma alanına ait profil kayıtları temizlenir. Eğer aynı projeyi daha önce 'Main Workspace' veya başka bir alana eklediyseniz oradaki kayıtlar silinmez. Yerel fiziksel dosyalarınız diskinizde tamamen güvendedir.</span>`,
        "Evet, Temizle",
        "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.4)]",
        `<svg class="w-6 h-6 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
        () => removeWorkspace(ws)
    );
}

function removeWorkspace(ws) {
    if (ws === globalWorkspace) return; 
    globalWorkspaces = globalWorkspaces.filter(w => w !== ws);
    saveSettings(); 
    
    const overlay = document.getElementById('workspaceSwitcherOverlay');
    if (overlay && overlay.classList.contains('flex')) { renderWorkspaceSwitcher(); }
    
    const settingsView = document.getElementById('settings-view');
    if (settingsView && !settingsView.classList.contains('hidden')) { renderWorkspaceSettings(); }
}

// 💻 YENİ VİZYON: SIFIR SARSINTI (ZERO LAYOUT SHIFT) VE BÜYÜK KARTLAR
function renderWorkspaceSwitcher() {
    const grid = document.getElementById('workspaceSwitcherGrid');
    if (!grid || typeof globalWorkspaces === 'undefined') return;
    grid.innerHTML = '';

    globalWorkspaces.forEach((ws, idx) => {
        const isActive = ws === globalWorkspace;
        const isMain = idx === 0;
        const folderName = ws.split('/').pop() || ws;
        const displayName = isMain ? "Main Workspace" : `Workspace ${idx + 1}`;
        const iconSvg = isMain 
            ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>'
            : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>';

        const card = document.createElement('div');
        // KARTLAR BÜYÜTÜLDÜ (w-60 h-40), Zıplama mesafesi ayarlandı
        card.className = `flex flex-col items-center justify-start pt-5 px-4 rounded-2xl border-2 transition-all transform hover:-translate-y-3 hover:shadow-[0_20px_40px_rgba(0,0,0,0.6)] duration-300 group cursor-pointer w-60 h-40 relative shrink-0 ${isActive ? 'bg-[#1a1f2e] border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'bg-[#11151f] border-gray-700/50 hover:border-gray-500'}`;
        
        const deleteBtnHtml = !isMain && !isActive ? `
            <div onclick="confirmRemoveWorkspace('${ws}', event)" class="absolute top-3 right-3 p-2 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 z-20 cursor-pointer shadow-sm" title="Workspace'i Sil">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
            </div>
        ` : '';

        card.innerHTML = `
            ${deleteBtnHtml}
            ${isActive ? '<div class="absolute top-4 left-4 w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,1)]"></div>' : ''}
            <div class="w-14 h-14 rounded-xl flex items-center justify-center mb-4 border border-gray-700/50 overflow-hidden relative ${isActive ? 'bg-indigo-500/20 text-indigo-400' : 'bg-gray-900 text-gray-500 group-hover:text-gray-300'} transition-colors">
                <svg class="w-7 h-7 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">${iconSvg}</svg>
            </div>
            <span class="text-sm font-bold tracking-wide truncate w-full text-center ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'} transition-colors">${displayName}</span>
            <span class="text-xs text-gray-500 truncate w-full text-center opacity-70 group-hover:opacity-100 mt-1" title="${ws}">${isMain ? 'Global / Hub' : folderName}</span>
        `;
        
        card.onclick = (e) => { 
            if (!e.target.closest('.z-20')) { switchWorkspace(ws); }
        };
        grid.appendChild(card);
    });

    const addBtn = document.createElement('div');
    addBtn.className = `flex flex-col items-center justify-start pt-5 px-4 rounded-2xl border-2 border-dashed border-gray-600 hover:border-indigo-500 bg-transparent hover:bg-indigo-500/5 transition-all transform hover:-translate-y-3 hover:shadow-[0_20px_40px_rgba(0,0,0,0.6)] duration-300 group cursor-pointer w-48 h-40 relative shrink-0`;
    addBtn.innerHTML = `
        <div class="w-14 h-14 rounded-xl flex items-center justify-center bg-gray-800 text-gray-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors shadow-inner mb-4">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
        </div>
        <span class="text-xs font-bold text-gray-500 group-hover:text-indigo-400 transition-colors uppercase tracking-wider text-center">New<br>Workspace</span>
    `;
    addBtn.onclick = () => { if (typeof addNewWorkspace === 'function') addNewWorkspace(); };
    grid.appendChild(addBtn);
}

function toggleWorkspaceSwitcher() {
    const overlay = document.getElementById('workspaceSwitcherOverlay');
    const bar = document.getElementById('workspaceSwitcherBar');
    if (!overlay || !bar) return;
    
    if (overlay.classList.contains('flex')) {
        closeWorkspaceSwitcher();
    } else { 
        hideContextMenu(); closeCmdPalette();
        renderWorkspaceSwitcher(); 
        overlay.classList.replace('hidden', 'flex');
        requestAnimationFrame(() => { 
            overlay.classList.remove('opacity-0'); 
            bar.classList.remove('translate-y-full');
        });
    }
}

function closeWorkspaceSwitcher() {
    const overlay = document.getElementById('workspaceSwitcherOverlay');
    const bar = document.getElementById('workspaceSwitcherBar');
    if (!overlay || !bar) return;
    
    overlay.classList.add('opacity-0');
    bar.classList.add('translate-y-full');
    setTimeout(() => { overlay.classList.replace('flex', 'hidden'); }, 300);
}

function cycleWorkspace(direction) {
    if (typeof globalWorkspaces === 'undefined' || globalWorkspaces.length <= 1) return;
    let currentIndex = globalWorkspaces.indexOf(globalWorkspace);
    if (currentIndex === -1) currentIndex = 0;
    
    let nextIndex = currentIndex + direction;
    if (nextIndex >= globalWorkspaces.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = globalWorkspaces.length - 1;
    
    switchWorkspace(globalWorkspaces[nextIndex]);
}

function cycleWorkspace(direction) {
    if (typeof globalWorkspaces === 'undefined' || globalWorkspaces.length <= 1) return;
    let currentIndex = globalWorkspaces.indexOf(globalWorkspace);
    if (currentIndex === -1) currentIndex = 0;
    
    let nextIndex = currentIndex + direction;
    if (nextIndex >= globalWorkspaces.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = globalWorkspaces.length - 1;
    
    switchWorkspace(globalWorkspaces[nextIndex]);
}

function createProjectRow(p, index, sourceArray) {
    const tr = document.createElement('tr');
    const pId = p.id || p.ID; const pSource = (p.source || p.Source) === 'github' ? 'github' : 'local';
    const isSelected = selectedProjectIds.has(pId);
    tr.className = `border-b border-gray-800/60 transition-colors group cursor-pointer ${isSelected ? 'bg-indigo-500/30 shadow-[inset_4px_0_0_rgba(99,102,241,1)]' : 'bg-[#0f111a]/30 hover:bg-gray-800/40'}`;
    tr.setAttribute('draggable', 'true'); tr.dataset.id = pId;

    tr.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.cursor-grab')) return;
        if (activeSelectionSource !== null && activeSelectionSource !== pSource && selectedProjectIds.size > 0) selectedProjectIds.clear();
        activeSelectionSource = pSource;
        if (e.ctrlKey || e.metaKey) {
            if (selectedProjectIds.has(pId)) selectedProjectIds.delete(pId); else selectedProjectIds.add(pId);
            lastSelectedIdx = index;
        } else if (e.shiftKey && lastSelectedIdx !== -1) {
            e.preventDefault(); document.getSelection().removeAllRanges();
            const start = Math.min(lastSelectedIdx, index); const end = Math.max(lastSelectedIdx, index);
            if (!e.ctrlKey && !e.metaKey) selectedProjectIds.clear();
            for (let i = start; i <= end; i++) { const iterId = sourceArray[i].id || sourceArray[i].ID; if(iterId) selectedProjectIds.add(iterId); }
        } else {
            selectedProjectIds.clear(); selectedProjectIds.add(pId); lastSelectedIdx = index;
        }
        applySelectionStyles(); updateBulkActionBar(cachedProjects.length);
    });

    tr.addEventListener('contextmenu', (e) => { const status = cachedProjects.find(x => (x.id || x.ID) === pId)?.status || 'stopped'; showContextMenu(e, pId, p.name || p.Name, status); });
    tr.addEventListener('dragstart', handleDragStart); tr.addEventListener('dragover', handleDragOver); tr.addEventListener('dragenter', handleDragEnter); tr.addEventListener('dragleave', handleDragLeave); tr.addEventListener('drop', handleDrop); tr.addEventListener('dragend', handleDragEnd);
    
    let tagBadges = '';
    if (p.tag && p.tag.trim() !== '') {
        tagBadges = p.tag.split(',').map(t => `<span class="ml-2 inline-flex items-center gap-1 px-2.5 py-0.5 bg-gray-800 text-indigo-300 text-xs font-bold rounded-full border border-indigo-500/30 shadow-sm whitespace-nowrap"><span class="text-indigo-500 opacity-80 font-black">#</span>${t.trim()}</span>`).join('');
    }
    
    const autoBadge = p.auto_start ? `<span class="ml-2 text-emerald-400 drop-shadow-md hover:scale-110 transition-transform cursor-help" title="Auto-Start Enabled">⚡</span>` : '';
    const watchdogBadge = p.auto_restart ? `<span class="ml-1 text-amber-400 drop-shadow-md hover:scale-110 transition-transform cursor-help" title="Auto-Restart Enabled">🛡️</span>` : '';
    const safeName = p.name || p.Name || "Unknown";

    tr.innerHTML = `
        <td class="p-4 font-bold text-gray-200 flex items-center gap-4">
            <div class="cursor-grab text-gray-700 hover:text-gray-400 transition-colors" title="Drag to reorder"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg></div>
            <div class="h-10 w-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50 flex items-center justify-center text-indigo-400 font-black group-hover:border-indigo-500/50 group-hover:shadow-[0_0_15px_rgba(79,70,229,0.2)] transition-all shrink-0 text-lg">${safeName.charAt(0).toUpperCase()}</div>
            <div class="flex flex-col"><div class="flex items-center">${safeName} ${tagBadges} ${autoBadge} ${watchdogBadge}</div></div>
        </td>
        <td class="p-4 text-sm text-gray-500 font-mono text-xs truncate max-w-xs group-hover:text-gray-400 transition-colors" title="${p.path}">${p.path}</td>
        <td class="p-4"><span id="status-${pId}" class="px-3 py-1 bg-gray-800/60 text-gray-500 text-xs rounded-full border border-gray-700/50 font-bold transition-all">Loading...</span></td>
        <td class="p-4 w-48"><div id="stats-${pId}" class="text-xs text-gray-500 font-mono flex flex-row items-center gap-3"><span>CPU: --</span><span>RAM: --</span></div></td>
        <td class="p-4">
            <div class="flex items-center justify-end gap-3 whitespace-nowrap opacity-40 group-hover:opacity-100 transition-opacity duration-300">
                <div class="flex items-center gap-2 border-r border-gray-800/60 pr-3">
                    <button onclick="startProject('${pId}', '${safeName}', this)" class="btn-action w-16 bg-emerald-600/90 hover:bg-emerald-500 text-white py-1.5 rounded-lg shadow-[0_0_10px_rgba(16,185,129,0.2)] text-xs font-bold text-center transition-colors">Start</button>
                    <button onclick="restartProject('${pId}', '${safeName}', this)" class="btn-action w-16 bg-blue-600/90 hover:bg-blue-500 text-white py-1.5 rounded-lg shadow-[0_0_10px_rgba(59,130,246,0.2)] text-xs font-bold text-center transition-colors">Restart</button>
                    <button onclick="stopProject('${pId}', this)" class="btn-action w-16 bg-rose-600/90 hover:bg-rose-500 text-white py-1.5 rounded-lg shadow-[0_0_10px_rgba(225,29,72,0.2)] text-xs font-bold text-center transition-colors">Stop</button>
                </div>
                <div class="flex items-center gap-1.5">
                    <button onclick="openInVSCode('${pId}', this)" class="btn-action bg-gray-800 hover:bg-blue-500 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(59,130,246,0.3)]" title="VS Code'da Aç"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg></button>
                    <button onclick="backupProject('${pId}', this)" class="btn-action bg-gray-800 hover:bg-amber-600 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(245,158,11,0.3)]"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>
                    <button onclick="openEditModal('${pId}')" class="btn-action bg-gray-800 hover:bg-teal-500 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(20,184,166,0.3)]"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg></button>
                    <button onclick="openEditModal('${pId}')" class="btn-action bg-gray-800 hover:bg-indigo-600 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(79,70,229,0.3)]"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="openDeleteModal('${pId}')" class="btn-action bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(225,29,72,0.3)]"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </div>
        </td>
    `;
    return tr;
}

function renderProjects() {
    const localTbody = document.getElementById('local-project-list');
    const githubTbody = document.getElementById('github-project-list');
    const tableContainer = document.getElementById('split-tables-container');
    const emptyState = document.getElementById('global-empty-state');
    if (!localTbody || !githubTbody) return;
    
    localTbody.innerHTML = ''; githubTbody.innerHTML = '';
    
    const filteredProjects = currentTagFilter ? cachedProjects.filter(p => {
        if (!p.tag) return false;
        return p.tag.split(',').map(t => t.trim().toLowerCase()).includes(currentTagFilter.toLowerCase());
    }) : cachedProjects;

    updateBulkActionBar(filteredProjects.length);

    if (filteredProjects.length === 0) { 
        tableContainer.classList.add('hidden'); emptyState.classList.remove('hidden'); emptyState.classList.add('flex'); return; 
    } else {
        tableContainer.classList.remove('hidden'); emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
    }

    const localProjects = filteredProjects.filter(p => (p.source || p.Source) !== 'github');
    const githubProjects = filteredProjects.filter(p => (p.source || p.Source) === 'github');

    if (localProjects.length === 0) localTbody.innerHTML = `<tr onclick="openModal()" class="cursor-pointer hover:bg-gray-800/40 transition-colors group"><td colspan="5" class="p-6 text-center text-gray-500 font-medium text-xs italic group-hover:text-indigo-400 transition-colors">No local projects found. Click here to add one.</td></tr>`;
    else localProjects.forEach((p, index) => { localTbody.appendChild(createProjectRow(p, index, localProjects)); });

    if (githubProjects.length === 0) githubTbody.innerHTML = `<tr onclick="openModal()" class="cursor-pointer hover:bg-gray-800/40 transition-colors group"><td colspan="5" class="p-6 text-center text-gray-500 font-medium text-xs italic group-hover:text-emerald-400 transition-colors">No GitHub repositories found. Click here to clone one.</td></tr>`;
    else githubProjects.forEach((p, index) => { githubTbody.appendChild(createProjectRow(p, index, githubProjects)); });
    applySelectionStyles();
}

function updateBulkActionBar(filteredCount) {
    const container = document.getElementById('bulk-actions-container'); const name = document.getElementById('bulk-tag-name'); const count = document.getElementById('bulk-project-count');
    if (!container || !name || !count) return;
    if (selectedProjectIds.size > 0) {
        name.innerHTML = `<span class="text-indigo-500 font-bold opacity-75">✓</span> Seçilen Ögeler`; count.innerText = `${selectedProjectIds.size} proje`; container.style.display = ''; container.classList.remove('hidden'); container.classList.add('flex');
    } else if (currentTagFilter !== null) {
        name.innerHTML = `<span class="text-indigo-500 font-bold opacity-75">#</span> ${currentTagFilter}`; count.innerText = `${filteredCount} proje`; container.style.display = ''; container.classList.remove('hidden'); container.classList.add('flex');
    } else {
        container.style.display = 'none'; container.classList.remove('flex'); container.classList.add('hidden');
    }
}
 
function applySelectionStyles() {
    ['local-project-list', 'github-project-list'].forEach(tbodyId => {
        const tbody = document.getElementById(tbodyId); if (!tbody) return;
        Array.from(tbody.children).forEach(tr => {
            const id = tr.dataset.id; if (!id) return; 
            if (selectedProjectIds.has(id)) { tr.classList.add('bg-indigo-500/30', 'shadow-[inset_4px_0_0_rgba(99,102,241,1)]'); tr.classList.remove('bg-[#0f111a]/30', 'hover:bg-gray-800/40', 'bg-indigo-500/10', 'bg-indigo-500/20'); } 
            else { tr.classList.remove('bg-indigo-500/30', 'shadow-[inset_4px_0_0_rgba(99,102,241,1)]', 'bg-indigo-500/10', 'bg-indigo-500/20'); tr.classList.add('bg-[#0f111a]/30', 'hover:bg-gray-800/40'); }
        });
    });
}

function setFilter(tag) {
    currentTagFilter = tag; selectedProjectIds.clear(); activeSelectionSource = null; loadProjects();
    document.querySelectorAll('.tag-filter-btn').forEach(btn => { btn.className = "flex-1 tag-filter-btn text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 border border-transparent flex items-center gap-2 text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 pr-8 truncate group/btn"; });
    const activeBtn = document.getElementById(tag === null ? 'btn-filter-all' : `btn-filter-${tag}`); 
    if (activeBtn) activeBtn.className = "flex-1 tag-filter-btn text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 border border-indigo-500/20 flex items-center gap-2 bg-indigo-500/10 text-indigo-300 shadow-[inset_3px_0_0_#6366f1] pr-8 truncate group/btn";
}

function renderSidebarTags(projects) {
    projects.sort((a, b) => (a.order || 0) - (b.order || 0)); 
    let allTags = [];
    projects.forEach(p => {
        if (p.tag) p.tag.split(',').forEach(t => { if(t.trim()) allTags.push(t.trim()); });
    });
    availableTags = [...new Set([...allTags, ...globalSavedTags])].sort();

    const tagList = document.getElementById('tag-list'); if (!tagList) return;
    
    tagList.innerHTML = `<button id="btn-filter-all" onclick="setFilter(null)" class="flex-1 tag-filter-btn text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 border flex items-center gap-2 w-full ${currentTagFilter === null ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300 shadow-[inset_3px_0_0_#6366f1]' : 'border-transparent text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'} mb-2 group/btn"><svg class="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg><span class="font-semibold tracking-wide">All Projects</span></button>`;
    
    availableTags.forEach(tag => { 
        const isActive = currentTagFilter === tag; 
        tagList.innerHTML += `<div class="flex items-center group relative mb-1"><button id="btn-filter-${tag}" onclick="setFilter('${tag}')" class="flex-1 tag-filter-btn text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 border flex items-center gap-2 ${isActive ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300 shadow-[inset_3px_0_0_#6366f1]' : 'border-transparent text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'} pr-8 truncate group/btn"><span class="text-indigo-500/50 font-black text-lg leading-none group-hover/btn:text-indigo-400 transition-colors">#</span> <span class="font-semibold tracking-wide">${tag}</span></button><button onclick="openTagModal('${tag}')" class="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-indigo-400 transition-all rounded-md bg-[#11151f] border border-gray-700 hover:bg-gray-800 hover:scale-110 shadow-lg z-10" title="Manage Tag"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button></div>`; 
    });
}

function openTagModal(tag = null) {
    document.getElementById('tagModalTitle').innerText = tag ? `Manage: #${tag}` : 'Create New Tag';
    document.getElementById('tagOriginalName').value = tag || ''; document.getElementById('tagNewName').value = tag || '';
    const btnDelete = document.getElementById('btnDeleteTag'); if (tag) btnDelete.classList.remove('hidden'); else btnDelete.classList.add('hidden');
    const projectList = document.getElementById('tagProjectList'); projectList.innerHTML = '';
    
    if (cachedProjects.length === 0) projectList.innerHTML = '<span class="text-xs text-gray-500 italic">No projects available.</span>';
    else {
        cachedProjects.forEach(p => {
            const isAssigned = p.tag && p.tag.split(',').map(t => t.trim()).includes(tag);
            const pId = p.id || p.ID; const safeName = p.name || p.Name;
            projectList.innerHTML += `<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors border border-transparent hover:border-gray-700/50"><div class="relative flex items-center shrink-0"><input type="checkbox" name="tagProjectIds" value="${pId}" class="sr-only peer" ${isAssigned ? 'checked' : ''}><div class="w-5 h-5 bg-gray-900 border border-gray-600 rounded peer-checked:bg-indigo-500 peer-checked:border-indigo-400 transition-colors flex items-center justify-center"><svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div></div><span class="text-sm font-bold text-gray-300 select-none">${safeName}</span></label>`;
        });
    }
    document.getElementById('tagModal').classList.remove('hidden'); document.getElementById('tagModal').classList.add('flex');
}

function closeTagModal() { document.getElementById('tagModal').classList.remove('flex'); document.getElementById('tagModal').classList.add('hidden'); document.getElementById('tagForm').reset(); }

function initTagAutocomplete(inputId, dropdownId) {
    const input = document.getElementById(inputId); const dropdown = document.getElementById(dropdownId); if (!input || !dropdown) return;
    input.addEventListener('focus', () => update(input.value)); 
    input.addEventListener('input', (e) => update(e.target.value)); 
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));
    
    function update(text) {
        const parts = text.split(',');
        const currentWord = parts[parts.length - 1].trim();
        
        if (currentWord === "") { dropdown.classList.add('hidden'); return; }
        
        const filtered = availableTags.filter(t => t.toLowerCase().includes(currentWord.toLowerCase()));
        if (filtered.length === 0) { dropdown.classList.add('hidden'); return; }
        
        dropdown.innerHTML = '';
        filtered.forEach(tag => {
            const div = document.createElement('div'); div.className = 'px-4 py-2 text-sm text-gray-300 hover:bg-indigo-600 hover:text-white cursor-pointer'; div.textContent = tag;
            div.onmousedown = (e) => { 
                e.preventDefault(); 
                parts[parts.length - 1] = " " + tag; 
                input.value = parts.join(',').trim(); 
                dropdown.classList.add('hidden'); 
            }; 
            dropdown.appendChild(div);
        }); 
        dropdown.classList.remove('hidden');
    }
}

function toggleWorkspaceMode() {
    const useWs = document.getElementById('useWorkspace').checked; const prefix = document.getElementById('workspacePrefix'); const input = document.getElementById('projPath');
    if(useWs) {
        prefix.classList.remove('hidden'); input.classList.remove('rounded-l-lg'); input.classList.add('border-l-0');
        const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/');
        prefix.title = formattedWs; prefix.innerText = formatWorkspacePath(globalWorkspace); input.placeholder = "folder_name";
    } else {
        prefix.classList.add('hidden'); input.classList.add('rounded-l-lg'); input.classList.remove('border-l-0'); input.placeholder = "C:/Users/Diony/Desktop/bot";
    }
}

function toggleSourceMode() {
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    const localWrapper = document.getElementById('localFlowWrapper'); const githubWrapper = document.getElementById('githubFlowWrapper');
    const projName = document.getElementById('projName'); const projPath = document.getElementById('projPath'); const repoUrl = document.getElementById('repoUrl');
	const projCmd = document.getElementById('projCmd');

    if (mode === 'local') {
        localWrapper.classList.remove('hidden'); githubWrapper.classList.add('hidden'); 
		projName.required = true; projPath.required = true; repoUrl.required = false;
		if (projCmd) {
			projCmd.required = true;
			projCmd.placeholder = "go run main.go";
		}
    } else {
        localWrapper.classList.add('hidden'); githubWrapper.classList.remove('hidden'); 
		projName.required = false; projPath.required = false; repoUrl.required = true;
		if (projCmd) {
			projCmd.required = false;
			projCmd.placeholder = "go run main.go (Boş bırakırsanız dedektif otomatik bulur)";
		}
    }
}

function toggleAddEnvMode(clickedType) {
    const globalCb = document.getElementById('addEnvGlobal'); const customCb = document.getElementById('addEnvCustom');
    if (clickedType === 'global' && globalCb && globalCb.checked) { if(customCb) customCb.checked = false; } 
    else if (clickedType === 'custom' && customCb && customCb.checked) { if(globalCb) globalCb.checked = false; }
    
    const globalPreview = document.getElementById('addEnvGlobalPreview'); const customWrapper = document.getElementById('addEnvCustomWrapper'); const noneWarning = document.getElementById('addEnvNoneWarning');
    if (globalPreview) globalPreview.classList.add('hidden'); if (customWrapper) customWrapper.classList.add('hidden'); if (noneWarning) { noneWarning.classList.add('hidden'); noneWarning.classList.remove('flex'); }
    
    if (globalCb && globalCb.checked) { if (globalPreview) { globalPreview.classList.remove('hidden'); globalPreview.innerText = globalEnvText || "No Global Environment Variables configured in Settings."; } } 
    else if (customCb && customCb.checked) { if (customWrapper) { customWrapper.classList.remove('hidden'); } } 
    else { if (noneWarning) { noneWarning.classList.remove('hidden'); noneWarning.classList.add('flex'); } }
}

function openModal() { 
    document.getElementById('addModal').classList.replace('hidden', 'flex'); toggleSourceMode(); toggleWorkspaceMode(); 
    const globalCb = document.getElementById('addEnvGlobal'); const customCb = document.getElementById('addEnvCustom');
    if (globalCb) globalCb.checked = false; if (customCb) customCb.checked = false; 
    toggleAddEnvMode();
}

function closeModal() { document.getElementById('addModal').classList.replace('flex', 'hidden'); document.getElementById('addForm').reset(); }

function toggleEditEnvMode(clickedType) {
    const globalCb = document.getElementById('editEnvGlobal'); const customCb = document.getElementById('editEnvCustom');
    if (clickedType === 'global' && globalCb && globalCb.checked) { if(customCb) customCb.checked = false; } 
    else if (clickedType === 'custom' && customCb && customCb.checked) { if(globalCb) globalCb.checked = false; }
    
    const globalPreview = document.getElementById('editEnvGlobalPreview'); const customWrapper = document.getElementById('editEnvCustomWrapper'); const noneWarning = document.getElementById('editEnvNoneWarning');
    if (globalPreview) globalPreview.classList.add('hidden'); if (customWrapper) { customWrapper.classList.add('hidden'); customWrapper.classList.remove('flex'); } if (noneWarning) { noneWarning.classList.add('hidden'); noneWarning.classList.remove('flex'); }
    
    if (globalCb && globalCb.checked) { if (globalPreview) { globalPreview.classList.remove('hidden'); globalPreview.innerText = globalEnvText || "No Global Environment Variables configured in Settings."; } } 
    else if (customCb && customCb.checked) { if (customWrapper) { customWrapper.classList.remove('hidden'); customWrapper.classList.add('flex'); } } 
    else { if (noneWarning) { noneWarning.classList.remove('hidden'); noneWarning.classList.add('flex'); } }
}

function openEditModal(id) {
    const project = cachedProjects.find(p => p.id === id || p.ID === id); if (!project) return;
    document.getElementById('editProjId').value = project.id || project.ID; 
    document.getElementById('editProjName').value = project.name || project.Name; 
    document.getElementById('editProjPath').value = project.path || project.Path; 
    document.getElementById('editProjCmd').value = project.command || project.Command || ''; 
    document.getElementById('editProjTag').value = project.tag || project.Tag || ''; 
    document.getElementById('editProjInteractive').checked = project.interactive || project.Interactive || false; 
    document.getElementById('editProjAutoStart').checked = project.auto_start || project.AutoStart || false; 
    document.getElementById('editProjAutoRestart').checked = project.auto_restart || project.AutoRestart || false;
    document.getElementById('editProjAutoClose').checked = project.auto_close || project.AutoClose || false;
    document.getElementById('editProjClearOnStart').checked = project.clear_on_start || project.ClearOnStart || false;
    
    const textArea = document.getElementById('editProjInitialEnv');
    if (textArea) textArea.value = "Loading...";

    fetch(`/api/projects/env?id=${id}`)
        .then(res => { if (res.ok) return res.json(); throw new Error("Failed"); })
        .then(data => {
            if (textArea) textArea.value = data.content;
            const globalCb = document.getElementById('editEnvGlobal'); const customCb = document.getElementById('editEnvCustom');
            if (data.content.trim() === "") { if(globalCb) globalCb.checked = false; if(customCb) customCb.checked = false; } 
            else if (data.content.trim() === globalEnvText.trim() && globalEnvText.trim() !== "") { if(globalCb) globalCb.checked = true; if(customCb) customCb.checked = false; } 
            else { if(globalCb) globalCb.checked = false; if(customCb) customCb.checked = true; }
            toggleEditEnvMode();
        })
        .catch(err => {
            if (textArea) textArea.value = "";
            const globalCb = document.getElementById('editEnvGlobal'); const customCb = document.getElementById('editEnvCustom');
            if(globalCb) globalCb.checked = false; if(customCb) customCb.checked = false;
            toggleEditEnvMode();
        });

    const modal = document.getElementById('editModal'); modal.classList.remove('hidden'); modal.classList.add('flex');
}

function closeEditModal() { document.getElementById('editModal').classList.remove('flex'); document.getElementById('editModal').classList.add('hidden'); }
function openEnvModal(id) { openEditModal(id); }
function closeEnvModal() { closeEditModal(); }

function openDeleteModal(id) { 
    const project = cachedProjects.find(p => p.id === id || p.ID === id); const source = project ? (project.source || project.Source || 'local') : 'local'; const tag = project ? (project.tag || project.Tag) : null;
    const checkboxContainer = document.getElementById('deleteFilesContainer'); const warningText = document.getElementById('deleteLocalWarning'); const checkbox = document.getElementById('deleteFilesFromDisk');
    
    if (checkboxContainer && warningText && checkbox) {
        if (source === 'github') { checkboxContainer.classList.remove('hidden'); warningText.classList.add('hidden'); } 
        else { checkboxContainer.classList.add('hidden'); warningText.classList.remove('hidden'); checkbox.checked = false; }
    }

    const tagContainer = document.getElementById('deleteTagContainer'); const tagCheckbox = document.getElementById('deleteOrphanedTag'); const tagNameSpan = document.getElementById('orphanTagName');
    tagToOrphan = null;
    if (tagContainer && tagCheckbox && tagNameSpan) {
        if (tag) {
            const remaining = cachedProjects.filter(p => (p.tag === tag || p.Tag === tag) && (p.id !== id && p.ID !== id));
            if (remaining.length === 0) { tagToOrphan = tag; tagNameSpan.innerText = `#${tag}`; tagContainer.classList.remove('hidden'); tagCheckbox.checked = false; } 
            else { tagContainer.classList.add('hidden'); tagCheckbox.checked = false; }
        } else { tagContainer.classList.add('hidden'); tagCheckbox.checked = false; }
    }
    projectToDelete = id; document.getElementById('deleteModal').classList.replace('hidden', 'flex'); 
}

function closeDeleteModal() { 
    document.getElementById('deleteModal').classList.replace('flex', 'hidden'); 
    const diskCb = document.getElementById('deleteFilesFromDisk'); if (diskCb) diskCb.checked = false; 
    const tagCb = document.getElementById('deleteOrphanedTag'); if (tagCb) tagCb.checked = false;
    tagToOrphan = null; projectToDelete = null; 
}

function confirmBulkDelete() {
    let idsToProcess = [];
    if (selectedProjectIds.size > 0) idsToProcess = Array.from(selectedProjectIds);
    else if (currentTagFilter) idsToProcess = cachedProjects.filter(p => p.tag && p.tag.split(',').map(t => t.trim().toLowerCase()).includes(currentTagFilter.toLowerCase())).map(p => p.id || p.ID);
    if (idsToProcess.length === 0) return;

    let hasLocal = false; const processSet = new Set(idsToProcess); const tagCounts = {}; const tagDeletes = {}; 
    cachedProjects.forEach(p => {
        const pId = p.id || p.ID; const source = p.source || p.Source || 'local'; const pTagsStr = p.tag || p.Tag;
        if (processSet.has(pId) && source !== 'github') hasLocal = true;
        if (pTagsStr) { 
            pTagsStr.split(',').forEach(t => {
                const cleanT = t.trim();
                if(cleanT) {
                    tagCounts[cleanT] = (tagCounts[cleanT] || 0) + 1; 
                    if (processSet.has(pId)) { tagDeletes[cleanT] = (tagDeletes[cleanT] || 0) + 1; } 
                }
            });
        }
    });

    const checkboxContainer = document.getElementById('bulkDeleteFilesContainer'); const warningText = document.getElementById('bulkDeleteLocalWarning'); const checkbox = document.getElementById('bulkDeleteFilesFromDisk');
    if (checkboxContainer && warningText && checkbox) {
        if (!hasLocal) { checkboxContainer.classList.remove('hidden'); warningText.classList.add('hidden'); } 
        else { checkboxContainer.classList.add('hidden'); warningText.classList.remove('hidden'); checkbox.checked = false; }
    }

    tagsToOrphanBulk = [];
    for (const t in tagDeletes) { if (tagCounts[t] === tagDeletes[t]) { tagsToOrphanBulk.push(t); } }

    const tagContainer = document.getElementById('bulkDeleteTagContainer'); const tagCheckbox = document.getElementById('bulkDeleteOrphanedTags'); const tagNameSpan = document.getElementById('bulkOrphanTagNames');
    if (tagContainer && tagCheckbox && tagNameSpan) {
        if (tagsToOrphanBulk.length > 0) { tagNameSpan.innerText = tagsToOrphanBulk.map(t => `#${t}`).join(', '); tagContainer.classList.remove('hidden'); tagCheckbox.checked = false; } 
        else { tagContainer.classList.add('hidden'); tagCheckbox.checked = false; }
    }

    const countText = document.getElementById('bulkDeleteCount'); if(countText) countText.innerText = idsToProcess.length;
    const modal = document.getElementById('bulkDeleteModal'); if(modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
}
 
function closeBulkDeleteModal() { 
    const m = document.getElementById('bulkDeleteModal'); if(m) { m.classList.remove('flex'); m.classList.add('hidden'); }
    const c = document.getElementById('bulkDeleteFilesFromDisk'); if(c) c.checked = false; 
    const t = document.getElementById('bulkDeleteOrphanedTags'); if(t) t.checked = false; tagsToOrphanBulk = [];
}

function handleDragStart(e) { draggedRow = this; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => this.classList.add('opacity-50'), 0); }
function handleDragOver(e) { e.preventDefault(); return false; }
function handleDragEnter(e) { if (this !== draggedRow) { this.classList.add('border-t-2', 'border-indigo-500'); } }
function handleDragLeave() { this.classList.remove('border-t-2', 'border-indigo-500'); }
function handleDrop(e) {
    e.stopPropagation(); this.classList.remove('border-t-2', 'border-indigo-500');
    if (draggedRow.parentNode !== this.parentNode) { return false; }
    if (draggedRow !== this) {
        const tbody = this.parentNode; const rows = Array.from(tbody.children); const draggedIndex = rows.indexOf(draggedRow); const droppedIndex = rows.indexOf(this);
        if (draggedIndex < droppedIndex) { tbody.insertBefore(draggedRow, this.nextSibling); } 
        else { tbody.insertBefore(draggedRow, this); }
        saveNewOrder();
    } 
    return false;
}
function handleDragEnd() { this.classList.remove('opacity-50'); document.querySelectorAll('#local-project-list tr, #github-project-list tr').forEach(r => r.classList.remove('border-t-2', 'border-indigo-500')); }


function showPortConflictModal(port, pName, pid, projectId, safeName, btn) {
    let modal = document.getElementById('portConflictModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'portConflictModal';
        modal.className = 'fixed inset-0 z-[999] flex items-center justify-center bg-[#0f111a]/80 backdrop-blur-md transition-opacity opacity-0';
        modal.innerHTML = `
        <div class="bg-[#11151f] border border-gray-700 rounded-2xl shadow-2xl p-6 w-[450px] transform scale-95 transition-transform duration-300" id="portConflictBox">
            <div class="flex items-center gap-4 mb-4">
                <div class="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-500 shrink-0">
                    <svg class="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                </div>
                <div>
                    <h3 class="text-lg font-bold text-white">Port Çakışması Tespit Edildi</h3>
                    <p class="text-xs text-gray-400 mt-1">Sistem bir pürüz yakaladı, ancak çözümü basit.</p>
                </div>
            </div>
            <div class="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl mb-6 shadow-inner">
                <p class="text-sm text-gray-300 leading-relaxed">
                    Başlatmak istediğin projenin ihtiyacı olan <span class="font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">Port <span id="conflictPort"></span></span> şu anda başka bir program tarafından işgal ediliyor.
                </p>
                <div class="mt-4 flex items-center gap-3 text-xs font-mono text-gray-400 bg-[#0a0c10] px-4 py-3 rounded-lg border border-gray-800 shadow-md">
                    <span class="text-indigo-400 font-bold uppercase tracking-wider">Suçlu İşlem:</span> 
                    <span id="conflictProcess" class="text-gray-200 font-bold"></span>
                </div>
            </div>
            <div class="flex items-center justify-end gap-3">
                <button id="btnCancelConflict" class="px-5 py-2.5 text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-700">İptal Et</button>
                <button id="btnKillAndStart" class="px-5 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-lg shadow-[0_0_15px_rgba(217,119,6,0.3)] hover:shadow-[0_0_20px_rgba(245,158,11,0.5)] transition-all flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> 
                    İşlemi Öldür ve Başlat
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        
        document.getElementById('btnCancelConflict').addEventListener('click', () => {
            modal.classList.replace('opacity-100', 'opacity-0');
            document.getElementById('portConflictBox').classList.replace('scale-100', 'scale-95');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        });
    }
    
    document.getElementById('conflictPort').innerText = port;
    document.getElementById('conflictProcess').innerText = `${pName} (PID: ${pid})`;
    
    const killBtn = document.getElementById('btnKillAndStart');
    killBtn.onclick = () => {
        modal.classList.replace('opacity-100', 'opacity-0');
        document.getElementById('portConflictBox').classList.replace('scale-100', 'scale-95');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
        startProject(projectId, safeName, btn, true);
    };
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.replace('opacity-0', 'opacity-100');
        document.getElementById('portConflictBox').classList.replace('scale-95', 'scale-100');
    });
}

function showMissingDependencyModal(binary) {
    let modal = document.getElementById('dependencyModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dependencyModal';
        modal.className = 'fixed inset-0 z-[999] flex items-center justify-center bg-[#0f111a]/80 backdrop-blur-md transition-opacity opacity-0';
        modal.innerHTML = `
        <div class="bg-[#11151f] border border-gray-700 rounded-2xl shadow-2xl p-6 w-[450px] transform scale-95 transition-transform duration-300" id="dependencyBox">
            <div class="flex items-center gap-4 mb-4">
                <div class="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-rose-500 shrink-0">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                </div>
                <div>
                    <h3 class="text-lg font-bold text-white">Eksik Bağımlılık (Dependency)</h3>
                    <p class="text-xs text-gray-400 mt-1">Sisteminizde bu projeyi çalıştıracak motor yok.</p>
                </div>
            </div>
            <div class="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl mb-6 shadow-inner">
                <p class="text-sm text-gray-300 leading-relaxed">
                    Projeyi başlatmak için <span class="font-bold text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded" id="depBinary"></span> komutuna ihtiyaç var, ancak bu yazılım bilgisayarınızda yüklü değil veya PATH ortam değişkenine eklenmemiş.
                </p>
                <p class="text-xs text-gray-500 mt-3 italic">Lütfen ilgili yazılımı kurup DionyHub'ı (sunucuyu) yeniden başlatın.</p>
            </div>
            <div class="flex items-center justify-end">
                <button id="btnCloseDependency" class="px-5 py-2.5 text-sm font-bold text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">Anladım</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        
        document.getElementById('btnCloseDependency').addEventListener('click', () => {
            modal.classList.replace('opacity-100', 'opacity-0');
            document.getElementById('dependencyBox').classList.replace('scale-100', 'scale-95');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        });
    }
    
    document.getElementById('depBinary').innerText = binary;
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.replace('opacity-0', 'opacity-100');
        document.getElementById('dependencyBox').classList.replace('scale-95', 'scale-100');
    });
}

function showBrowserLimitationModal(folderName) {
    let modal = document.getElementById('browserLimitModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'browserLimitModal';
        modal.className = 'fixed inset-0 z-[1050] flex items-center justify-center bg-[#0a0c10]/90 backdrop-blur-md transition-opacity opacity-0';
        modal.innerHTML = `
        <div class="bg-[#11151f] border border-gray-700 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] p-8 w-[550px] transform scale-95 transition-transform duration-300 relative overflow-hidden" id="browserLimitBox">
            <div class="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div class="flex items-start gap-5 mb-6 relative z-10">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <div>
                    <h3 class="text-xl font-black text-white tracking-wide">Tarayıcı Güvenlik Kalkanı</h3>
                    <p class="text-sm text-gray-400 mt-1.5 leading-relaxed">Web standartları gereği, tarayıcılar sürüklenen dosyaların bilgisayardaki <span class="text-indigo-300 font-mono text-xs bg-indigo-500/10 px-1.5 py-0.5 rounded">C:/.../</span> tam adresini okuyamazlar.</p>
                </div>
            </div>
            
            <div class="bg-[#0a0c10] border border-gray-800 p-5 rounded-2xl mb-6 relative z-10">
                <p class="text-sm text-gray-300 leading-relaxed mb-4">
                    Bu kısıtlamayı tamamen ortadan kaldırmak ve kusursuz bir deneyim sunmak için <strong class="text-white">DionyHub Masaüstü Uygulaması</strong> geliştirilmektedir.
                </p>
                <div class="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-xl">
                    <div class="flex items-center gap-3">
                        <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                        <div class="flex flex-col">
                            <span class="text-xs font-bold text-indigo-300">DionyHub Desktop</span>
                            <span class="text-[10px] text-gray-500 uppercase tracking-wider">Windows, Mac, Linux</span>
                        </div>
                    </div>
                    <span class="text-xs font-black bg-indigo-500 text-white px-2 py-1 rounded-md shadow-lg rotate-3 cursor-default">YAKINDA</span>
                </div>
            </div>

            <div class="flex items-center justify-between relative z-10">
                <button id="btnCancelLimit" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-white transition-colors">İptal Et</button>
                <button id="btnContinueBrowser" class="px-6 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 rounded-xl shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_25px_rgba(99,102,241,0.5)] transition-all flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    Klasörü Manuel Seç
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        
        document.getElementById('btnCancelLimit').addEventListener('click', () => {
            modal.classList.replace('opacity-100', 'opacity-0');
            document.getElementById('browserLimitBox').classList.replace('scale-100', 'scale-95');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        });
    }
    
    const continueBtn = document.getElementById('btnContinueBrowser');
    continueBtn.onclick = () => {
        modal.classList.replace('opacity-100', 'opacity-0');
        document.getElementById('browserLimitBox').classList.replace('scale-100', 'scale-95');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
        
        openModal();
        document.querySelector('input[name="sourceMode"][value="local"]').checked = true;
        toggleSourceMode();
        document.getElementById('projName').value = folderName;
        
        browseFolder('projPath', true);
    };
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.replace('opacity-0', 'opacity-100');
        document.getElementById('browserLimitBox').classList.replace('scale-95', 'scale-100');
    });
}

function initGlobalDragAndDrop() {
    let overlay = document.getElementById('dragOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dragOverlay';
        overlay.className = 'fixed inset-0 z-[1000] hidden bg-[#0a0c10]/80 backdrop-blur-sm flex items-center justify-center pointer-events-none transition-all duration-300 opacity-0';
        overlay.innerHTML = `
            <div class="bg-[#11151f] p-12 rounded-3xl shadow-[0_0_80px_rgba(99,102,241,0.3)] flex flex-col items-center border-2 border-dashed border-indigo-500/70 transform scale-110 transition-transform duration-300" id="dragOverlayBox">
                <div class="w-24 h-24 mb-6 rounded-full bg-indigo-500/20 flex items-center justify-center animate-bounce shadow-[0_0_30px_rgba(99,102,241,0.5)]">
                    <svg class="w-12 h-12 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                </div>
                <h2 class="text-3xl font-black text-white mb-3 tracking-wide drop-shadow-md">Projeyi Buraya Bırak</h2>
                <p class="text-indigo-300/80 font-bold text-lg text-center">GitHub Linki veya Klasör Sürükleyebilirsiniz</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('text/uri-list')) {
            dragCounter++;
            if (dragCounter === 1) {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                overlay.style.pointerEvents = 'auto';
                requestAnimationFrame(() => {
                    overlay.classList.remove('opacity-0');
                    document.getElementById('dragOverlayBox').classList.replace('scale-110', 'scale-100');
                });
            }
        }
    });

    window.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideOverlay();
        }
    });

    window.addEventListener('drop', (e) => {
        dragCounter = 0;
        hideOverlay();

        const textData = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (textData && (textData.includes('github.com') || textData.includes('gitlab.com'))) {
            openModal();
            document.querySelector('input[name="sourceMode"][value="github"]').checked = true;
            toggleSourceMode();
            document.getElementById('repoUrl').value = textData.trim();
            document.getElementById('projCmd').value = '';
            document.getElementById('projTag').value = '';
            showToast("GitHub URL başarıyla yakalandı!", "success");
            return;
        }

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            const cleanName = file.name.replace(/[^a-zA-Z0-9_-]/g, ' ');
            const formattedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
            showBrowserLimitationModal(formattedName);
        }
    });

    function hideOverlay() {
        overlay.classList.add('opacity-0');
        document.getElementById('dragOverlayBox').classList.replace('scale-100', 'scale-110');
        overlay.style.pointerEvents = 'none';
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const pathInput = document.getElementById('projPath');
    let detectTimeout;
    if (pathInput) {
        pathInput.addEventListener('input', (e) => {
            clearTimeout(detectTimeout);
            detectTimeout = setTimeout(() => triggerSmartDetection(e.target.value, false), 600);
        });
    }
    initGlobalDragAndDrop();
});

function handleCmdSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    let allActions = [];

    if (query === '') {
        currentCmdActions = [
            { name: "Tüm Aksiyonları Listele", desc: "Sistemdeki tüm komutları ve yetenekleri gör", shortcut: ">", icon: "⚡", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>'; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "Çalışma Alanı Değiştir", desc: "Kayıtlı klasörleriniz (Workspace) arasında geçiş yapın", shortcut: ">workspace", icon: "📁", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>workspace '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "VS Code'da Aç", desc: "Kod editöründe açmak için bir proje seç", shortcut: ">code", icon: "💻", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>code '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "Projeyi Başlat", desc: "Sistemde duran bir projeyi hızlıca çalıştır", shortcut: ">start", icon: "🚀", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>start '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "Projeyi Durdur", desc: "Çalışan bir süreci anında sonlandır", shortcut: ">stop", icon: "🛑", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>stop '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "Projeyi Sil", desc: "Projeyi sistemden kalıcı olarak sil", shortcut: ">delete", icon: "🗑️", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>delete '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "Tag ile Filtrele", desc: "Tüm etiketleri gör ve projeleri filtrele", shortcut: ">tag", icon: "🏷️", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>tag '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
            { name: "Yeni Proje Ekle", desc: "Local klasör veya Github reposu klonla", shortcut: "Add", icon: "➕", action: () => { openModal(); } },
            { name: "Acil Kapatma", desc: "Çalışan tüm projeleri tek tuşla öldür", shortcut: "Kill All", icon: "💀", action: () => { 
                showConfirmModal(
                    "Sistemi Durdur (Kill All)",
                    "Çalışan <b class='text-white'>TÜM</b> projeleri ve süreçleri anında durdurmak istediğinize emin misiniz?",
                    "Hepsini Durdur",
                    "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.4)]",
                    `<svg class="w-6 h-6 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
                    () => { cachedProjects.filter(p => p.status === 'running').forEach(p => stopProject(p.id || p.ID, null)); showToast("Tüm süreçler sonlandırılıyor...", "success"); }
                );
            } },
            { name: "Sistemi Temizle", desc: "Tüm terminal geçmişini sil ve rahatlat", shortcut: "Clear", icon: "🧹", action: () => { 
                showConfirmModal(
                    "Logları Temizle",
                    "Tüm sekmelerdeki terminal geçmişlerini kalıcı olarak silmek istediğinize emin misiniz?",
                    "Geçmişi Sil",
                    "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]",
                    `<svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
                    () => { clearAllTerminals(); showToast("Terminal bellekleri temizlendi.", "success"); }
                );
            } },
            { name: "Dashboard'u Aç", desc: "Aktif projeler listesine geri dön", shortcut: "View", icon: "📊", action: () => { switchView('dashboard'); } },
            { name: "Ayarları Aç", desc: "Sistem ve global env ayarlarını yapılandır", shortcut: "Config", icon: "⚙️", action: () => { switchView('settings'); } },
            { name: "Tüm Filtreleri Kaldır", desc: "Aktif tag filtrelemesini sıfırlar", shortcut: "Reset", icon: "🌐", action: () => { setFilter(null); } }
        ];

        // CMD Kısayollarını ekle (Fotoğraftaki vizyon)
        if (typeof globalWorkspaces !== 'undefined') {
            globalWorkspaces.forEach((ws, idx) => {
                if (idx < 9) {
                    const folderName = ws.split('/').pop() || ws;
                    currentCmdActions.push({ 
                        name: `${idx + 1}. Çalışma Alanına Geç (${folderName})`, 
                        desc: ws, 
                        shortcut: `Ctrl+${idx + 1}`, 
                        icon: "📁", 
                        action: () => switchWorkspace(ws) 
                    });
                }
            });
        }

        cmdSelectedIndex = 0;
        renderCmdResults();
        return;
    }

    const generalCommands = [
        { name: "Yeni Proje Ekle", desc: "Local klasör veya Github reposu klonla", shortcut: "Add", icon: "➕", searchKey: "projectaddnewcreate", action: () => { openModal(); } },
        { name: "Acil Kapatma", desc: "Çalışan tüm projeleri durdurur", shortcut: "Kill All", icon: "💀", searchKey: "terminalkillallprocesses", action: () => { 
            showConfirmModal(
                "Sistemi Durdur (Kill All)",
                "Çalışan <b class='text-white'>TÜM</b> projeleri ve süreçleri anında durdurmak istediğinize emin misiniz?",
                "Hepsini Durdur",
                "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.4)]",
                `<svg class="w-6 h-6 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
                () => { cachedProjects.filter(p => p.status === 'running').forEach(p => stopProject(p.id || p.ID, null)); showToast("Tüm süreçler sonlandırılıyor...", "success"); }
            );
        } },
        { name: "Terminal Loglarını Temizle", desc: "Tüm sekmelerdeki geçmişi siler", shortcut: "Clear", icon: "🧹", searchKey: "terminalclearalllogs", action: () => { 
            showConfirmModal(
                "Logları Temizle",
                "Tüm sekmelerdeki terminal geçmişlerini kalıcı olarak silmek istediğinize emin misiniz?",
                "Geçmişi Sil",
                "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]",
                `<svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
                () => { clearAllTerminals(); showToast("Terminal bellekleri temizlendi.", "success"); }
            );
        } },
        { name: "Dashboard'u Aç", desc: "Aktif projeler listesine geri dön", shortcut: "View", icon: "📊", searchKey: "globalopendashboardviewprojects", action: () => { switchView('dashboard'); } },
        { name: "Ayarları Aç", desc: "Sistem ve global env ayarlarını yapılandır", shortcut: "Config", icon: "⚙️", searchKey: "globalopensettingsconfigurations", action: () => { switchView('settings'); } },
        { name: "Tüm Filtreleri Kaldır", desc: "Aktif tag filtrelemesini sıfırlar", shortcut: "Reset", icon: "🌐", searchKey: "filtershowallprojectsclear", action: () => { setFilter(null); } }
    ];

    if (query.startsWith('>')) {
        if (query.startsWith('>workspace') || query.startsWith('>work')) {
            const target = query.replace('>workspace', '').replace('>work', '').trim();
            if (typeof globalWorkspaces !== 'undefined') {
                globalWorkspaces.forEach((ws, idx) => {
                    const folderName = ws.split('/').pop() || ws;
                    if (target === '' || folderName.toLowerCase().includes(target) || ws.toLowerCase().includes(target)) {
                        const isActive = ws === globalWorkspace;
                        allActions.push({ name: `Geçiş Yap: ${folderName} ${isActive ? '(Aktif)' : ''}`, desc: ws, shortcut: idx < 9 ? `Ctrl+${idx+1}` : "Switch", icon: "📁", action: () => switchWorkspace(ws) });
                    }
                });
            }
        }
        else if (query.startsWith('>start')) {
            const target = query.replace('>start', '').trim();
            cachedProjects.filter(p => p.status !== 'running').forEach(p => {
                const safeName = p.name || p.Name;
                if (target === '' || safeName.toLowerCase().includes(target)) {
                    allActions.push({ name: `Başlat: ${safeName}`, desc: p.path || p.Path, shortcut: "Start", icon: "▶️", action: () => startProject(p.id || p.ID, safeName, null) });
                }
            });
        }
        else if (query.startsWith('>stop')) {
            const target = query.replace('>stop', '').trim();
            cachedProjects.filter(p => p.status === 'running').forEach(p => {
                const safeName = p.name || p.Name;
                if (target === '' || safeName.toLowerCase().includes(target)) {
                    allActions.push({ name: `Durdur: ${safeName}`, desc: "Aktif süreci sonlandır", shortcut: "Stop", icon: "⏹️", action: () => stopProject(p.id || p.ID, null) });
                }
            });
        }
        else if (query.startsWith('>code')) {
            const target = query.replace('>code', '').trim();
            cachedProjects.forEach(p => {
                const safeName = p.name || p.Name;
                if (target === '' || safeName.toLowerCase().includes(target)) {
                    allActions.push({ name: `VS Code'da Aç: ${safeName}`, desc: p.path || p.Path, shortcut: "Code", icon: "💻", action: () => openInVSCode(p.id || p.ID, null) });
                }
            });
        }
        else if (query.startsWith('>delete')) {
            const target = query.replace('>delete', '').trim();
            cachedProjects.forEach(p => {
                const safeName = p.name || p.Name;
                if (target === '' || safeName.toLowerCase().includes(target)) {
                    allActions.push({ name: `Sil: ${safeName}`, desc: "Projeyi sistemden kaldır", shortcut: "Delete", icon: "🗑️", action: () => openDeleteModal(p.id || p.ID) });
                }
            });
        }
        else if (query.startsWith('>tag')) {
            const target = query.replace('>tag', '').trim();
            if (typeof availableTags !== 'undefined') {
                availableTags.forEach(tag => {
                    if (target === '' || tag.toLowerCase().includes(target)) {
                        allActions.push({ name: `Filtre: #${tag}`, desc: "Bu etikete sahip projeleri listele", shortcut: "Tag", icon: "🏷️", action: () => setFilter(tag) });
                    }
                });
            }
            if (target === '') {
                allActions.push({ name: "Tüm Filtreleri Kaldır", desc: "Tüm projeleri göster", shortcut: "Reset", icon: "🌐", action: () => setFilter(null) });
            }
        }
        else {
            const cmdQuery = query.substring(1).trim();
            const prefixCommands = [
                { name: "Çalışma Alanı Değiştir", desc: "Kayıtlı klasörleriniz arasında geçiş yapın", shortcut: ">workspace", searchKey: "workspace switch folder", icon: "📁", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>workspace '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
                { name: "Projeyi Başlat", desc: "Sistemde duran bir projeyi çalıştır", shortcut: ">start", searchKey: "start", icon: "🚀", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>start '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
                { name: "Projeyi Durdur", desc: "Çalışan bir süreci sonlandır", shortcut: ">stop", searchKey: "stop", icon: "🛑", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>stop '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
                { name: "VS Code'da Aç", desc: "Projeyi kod editöründe aç", shortcut: ">code", searchKey: "code vscode", icon: "💻", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>code '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
                { name: "Projeyi Sil", desc: "Projeyi sistemden kalıcı olarak sil", shortcut: ">delete", searchKey: "delete", icon: "🗑️", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>delete '; inp.dispatchEvent(new Event('input')); inp.focus(); } },
                { name: "Tag ile Filtrele", desc: "Projeleri etiketlerine göre listele", shortcut: ">tag", searchKey: "tag", icon: "🏷️", isPrefix: true, action: () => { const inp = document.getElementById('cmdInput'); inp.value = '>tag '; inp.dispatchEvent(new Event('input')); inp.focus(); } }
            ];
            const combined = [...prefixCommands, ...generalCommands];
            combined.forEach(c => {
                if (c.searchKey.includes(cmdQuery.replace(/\s+/g, '')) || c.name.toLowerCase().includes(cmdQuery)) {
                    allActions.push(c);
                }
            });
        }
    } 
    else {
        cachedProjects.forEach(p => {
            const safeName = (p.name || p.Name);
            const pId = p.id || p.ID;
            const isRunning = p.status === 'running';

            if (safeName.toLowerCase().includes(query)) {
                allActions.push({ 
                    name: `Odaklan: ${safeName}`, 
                    desc: p.path || p.Path, 
                    shortcut: "Focus", 
                    icon: "🎯", 
                    action: () => {
                        const row = document.querySelector(`tr[data-id="${pId}"]`);
                        if (row) {
                            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            row.classList.remove('bg-[#0f111a]/30', 'hover:bg-gray-800/40');
                            row.classList.add('bg-indigo-500/30', 'shadow-[inset_4px_0_0_rgba(99,102,241,1)]');
                            setTimeout(() => {
                                row.classList.remove('bg-indigo-500/30', 'shadow-[inset_4px_0_0_rgba(99,102,241,1)]');
                                row.classList.add('bg-[#0f111a]/30', 'hover:bg-gray-800/40');
                            }, 2000);
                        } else {
                            setFilter(null);
                            setTimeout(() => {
                                const newRow = document.querySelector(`tr[data-id="${pId}"]`);
                                if(newRow) {
                                    newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    newRow.classList.add('bg-indigo-500/30');
                                    setTimeout(() => newRow.classList.remove('bg-indigo-500/30'), 2000);
                                }
                            }, 300);
                        }
                    }
                });

                if (!isRunning) {
                    allActions.push({ name: `Başlat: ${safeName}`, desc: "Projeyi ayağa kaldır", shortcut: "Start", icon: "▶️", action: () => startProject(pId, safeName, null) });
                } else {
                    allActions.push({ name: `Durdur: ${safeName}`, desc: "Çalışan projeyi durdur", shortcut: "Stop", icon: "⏹️", action: () => stopProject(pId, null) });
                    allActions.push({ name: `Yeniden Başlat: ${safeName}`, desc: "Projeyi kapatıp tekrar aç", shortcut: "Restart", icon: "🔄", action: () => restartProject(pId, safeName, null) });
                    allActions.push({ name: `Terminali Aç: ${safeName}`, desc: "Logları tam ekranda görüntüle", shortcut: "Logs", icon: "📟", action: () => restoreTerminal(pId) });
                }
                
                allActions.push({ name: `VS Code'da Aç: ${safeName}`, desc: "Projeyi kod editöründe anında aç", shortcut: "Code", icon: "💻", action: () => openInVSCode(pId, null) });
                
                allActions.push({ name: `Düzenle: ${safeName}`, desc: "Proje ayarlarını ve .env dosyasını aç", shortcut: "Edit", icon: "✏️", action: () => openEditModal(pId) });
                allActions.push({ name: `Sil: ${safeName}`, desc: "Projeyi sistemden kalıcı olarak sil", shortcut: "Delete", icon: "🗑️", action: () => openDeleteModal(pId) });
            }
        });
        
        generalCommands.forEach(c => {
            if (c.searchKey.includes(query.replace(/\s+/g, '')) || c.name.toLowerCase().includes(query)) {
                allActions.push(c);
            }
        });
    }

    currentCmdActions = allActions.slice(0, 15);
    cmdSelectedIndex = 0;
    renderCmdResults();
}

function renderCmdResults() {
    const resultsDiv = document.getElementById('cmdResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '';
    
    if (currentCmdActions.length === 0) {
        resultsDiv.innerHTML = `<div class="px-4 py-6 text-gray-500 text-[13px] font-mono tracking-wide text-center">Sonuç bulunamadı...</div>`;
        return;
    }
    
    currentCmdActions.forEach((a, idx) => {
        const btn = document.createElement('button');
        const isActive = idx === cmdSelectedIndex;
        
        btn.className = `cmd-item w-full text-left px-4 py-2.5 rounded-lg flex items-center gap-3 transition-colors group ${isActive ? 'bg-indigo-500/20 text-white' : 'text-gray-300 hover:bg-gray-800'}`;
        
        btn.innerHTML = `
            <div class="w-8 h-8 flex items-center justify-center mr-4 text-xl drop-shadow-md cmd-icon transition-transform ${isActive ? 'scale-110' : 'opacity-80'}">${a.icon}</div>
            <div class="flex flex-col flex-1 min-w-0">
                <span class="text-[14px] font-bold tracking-wide truncate font-sans ${isActive ? 'text-white' : 'text-gray-200'}">${a.name}</span>
                ${a.desc ? `<span class="text-[11px] truncate mt-0.5 font-mono ${isActive ? 'text-indigo-300' : 'text-gray-500'} opacity-90">${a.desc}</span>` : ''}
            </div>
            ${a.shortcut ? `<kbd class="ml-auto text-[10px] px-2 py-0.5 rounded border transition-colors ${isActive ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm' : 'bg-[#0f111a] border-gray-700 text-gray-500'} font-bold font-mono tracking-wider hidden md:block shrink-0">${a.shortcut}</kbd>` : ''}
        `;
        
        btn.addEventListener('mouseenter', () => { cmdSelectedIndex = idx; updateCmdSelection(); });
        
        btn.addEventListener('click', (e) => { 
            e.preventDefault(); 
            e.stopPropagation(); 
            if (a.isPrefix) {
                a.action();
            } else {
                closeCmdPalette(); 
                a.action(); 
            }
        });
        
        resultsDiv.appendChild(btn);
    });
    updateCmdSelection();
}

function updateCmdSelection() {
    const resultsDiv = document.getElementById('cmdResults');
    if (!resultsDiv) return;
    const allBtns = resultsDiv.querySelectorAll('.cmd-item');
    allBtns.forEach((btn, idx) => {
        const iconSpan = btn.querySelector('.cmd-icon');
        if (idx === cmdSelectedIndex) {
            btn.classList.add('bg-indigo-500/20', 'shadow-[inset_3px_0_0_#6366f1]');
            btn.classList.remove('hover:bg-gray-800/40');
            
            btn.querySelector('.font-sans').classList.replace('text-gray-200', 'text-white');
            const desc = btn.querySelector('.font-mono:not(kbd)');
            if (desc) desc.classList.replace('text-gray-500', 'text-indigo-300');
            
            const kbd = btn.querySelector('kbd');
            if (kbd) {
                kbd.classList.replace('bg-[#0f111a]', 'bg-indigo-600');
                kbd.classList.replace('border-gray-700', 'border-indigo-400');
                kbd.classList.replace('text-gray-500', 'text-white');
                kbd.classList.add('shadow-sm');
            }

            if (iconSpan) {
                iconSpan.classList.add('scale-110');
                iconSpan.classList.remove('opacity-80');
            }
            btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            btn.classList.remove('bg-indigo-500/20', 'shadow-[inset_3px_0_0_#6366f1]');
            btn.classList.add('hover:bg-gray-800/40');
            
            btn.querySelector('.font-sans').classList.replace('text-white', 'text-gray-200');
            const desc = btn.querySelector('.font-mono:not(kbd)');
            if (desc) desc.classList.replace('text-indigo-300', 'text-gray-500');

            const kbd = btn.querySelector('kbd');
            if (kbd) {
                kbd.classList.replace('bg-indigo-600', 'bg-[#0f111a]');
                kbd.classList.replace('border-indigo-400', 'border-gray-700');
                kbd.classList.replace('text-white', 'text-gray-500');
                kbd.classList.remove('shadow-sm');
            }

            if (iconSpan) {
                iconSpan.classList.remove('scale-110');
                iconSpan.classList.add('opacity-80');
            }
        }
    });
}

function showConfirmModal(title, message, btnText, btnClass, iconHtml, onConfirm) {
    let modal = document.getElementById('customConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'customConfirmModal';
        modal.className = 'fixed inset-0 z-[4000] flex items-center justify-center bg-[#0a0c10]/80 backdrop-blur-md transition-opacity opacity-0';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#11151f] border border-gray-700 rounded-2xl shadow-2xl p-6 w-[420px] transform scale-95 transition-transform duration-200" id="customConfirmBox">
            <div class="flex items-start gap-4 mb-2">
                <div class="w-12 h-12 rounded-full bg-gray-800/50 border border-gray-700 flex items-center justify-center shrink-0 shadow-inner">
                    ${iconHtml}
                </div>
                <div class="pt-1">
                    <h3 class="text-lg font-black text-white tracking-wide">${title}</h3>
                    <p class="text-sm text-gray-400 mt-2 leading-relaxed">${message}</p>
                </div>
            </div>
            <div class="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-800/60">
                <button id="btnCancelConfirm" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-white transition-colors">İptal</button>
                <button id="btnExecuteConfirm" class="px-5 py-2 text-sm font-bold text-white rounded-xl transition-all ${btnClass}">${btnText}</button>
            </div>
        </div>
    `;

    const close = () => {
        modal.classList.replace('opacity-100', 'opacity-0');
        document.getElementById('customConfirmBox').classList.replace('scale-100', 'scale-95');
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    document.getElementById('btnCancelConfirm').onclick = close;
    document.getElementById('btnExecuteConfirm').onclick = () => {
        close();
        onConfirm();
    };

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.replace('opacity-0', 'opacity-100');
        document.getElementById('customConfirmBox').classList.replace('scale-95', 'scale-100');
    });
}