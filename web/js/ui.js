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
    e.preventDefault();
    closeCmdPalette(); 
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    menu.innerHTML = ''; 

    const isRunning = status === 'running';

    const items = [
        { label: 'Start Project', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z', color: 'text-emerald-400', action: () => startProject(pId, pName, null), disabled: isRunning },
        { label: 'Restart Project', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', color: 'text-blue-400', action: () => restartProject(pId, pName, null), disabled: !isRunning },
        { label: 'Stop Project', icon: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10h6v4H9z', color: 'text-rose-400', action: () => stopProject(pId, null), disabled: !isRunning },
        { label: 'divider' },
        { label: 'Edit Project', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'text-gray-400', action: () => openEditModal(pId), disabled: false },
        { label: 'Environment (.env)', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', color: 'text-teal-400', action: () => openEditModal(pId), disabled: false },
        { label: 'Export Backup', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4', color: 'text-amber-400', action: () => backupProject(pId, null), disabled: false },
        { label: 'divider' },
        { label: 'Delete', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', color: 'text-rose-500', action: () => openDeleteModal(pId), disabled: false },
    ];

    items.forEach(item => {
        if (item.label === 'divider') {
            const divider = document.createElement('div');
            divider.className = 'h-px bg-gray-700/50 my-1 mx-2';
            menu.appendChild(divider);
            return;
        }
        const btn = document.createElement('button');
        const baseColor = item.disabled ? 'text-gray-600' : item.color;
        const hoverClass = item.disabled ? 'cursor-not-allowed' : 'hover:bg-gray-700/50 group';
        const textClass = item.disabled ? 'text-gray-600' : 'group-hover:text-white text-gray-300';
        const iconScale = item.disabled ? '' : 'group-hover:scale-110';
        
        btn.className = `w-full text-left px-4 py-2 transition-colors flex items-center gap-3 ${hoverClass}`;
        btn.innerHTML = `<svg class="w-4 h-4 ${baseColor} ${iconScale} transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path></svg><span class="${textClass} transition-colors">${item.label}</span>`;
        
        btn.addEventListener('mousedown', (ev) => { 
            ev.preventDefault();
            ev.stopPropagation();
            if (item.disabled) return;
            hideContextMenu(); 
            item.action(); 
        });
        menu.appendChild(btn);
    });

    menu.style.display = 'flex';
    menu.style.flexDirection = 'column';
    menu.style.pointerEvents = 'auto';
    void menu.offsetWidth; 
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    menu.classList.remove('scale-95', 'opacity-0');
    menu.classList.add('scale-100', 'opacity-100');
}

function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    menu.style.display = 'none';
    menu.classList.remove('scale-100', 'opacity-100');
    menu.classList.add('scale-95', 'opacity-0');
}

function toggleCmdPalette() {
    const pal = document.getElementById('cmdPalette');
    const box = document.getElementById('cmdPaletteBox');
    const input = document.getElementById('cmdInput');
    if (!pal || !box || !input) return;
    hideContextMenu(); 
    if (pal.classList.contains('hidden')) {
        pal.classList.replace('hidden', 'flex');
        input.value = '';
        handleCmdSearch({target: {value: ''}}); 
        requestAnimationFrame(() => {
            pal.classList.remove('opacity-0');
            box.classList.remove('scale-95');
            input.focus();
        });
    } else {
        closeCmdPalette();
    }
}

function closeCmdPalette() {
    const pal = document.getElementById('cmdPalette');
    const box = document.getElementById('cmdPaletteBox');
    if (!pal || !box) return;
    pal.classList.add('opacity-0');
    box.classList.add('scale-95');
    setTimeout(() => pal.classList.replace('flex', 'hidden'), 200);
}

function handleCmdSearch(e) {
    const query = e.target.value.toLowerCase().replace(/\s+/g, '');
    
    const allActions = [
        { name: "Global > Open Dashboard", searchKey: "globalopendashboardviewprojects", icon: "📊", action: () => { switchView('dashboard'); } },
        { name: "Global > Open Settings", searchKey: "globalopensettingsconfigurations", icon: "⚙️", action: () => { switchView('settings'); } },
        { name: "Project > Add New", searchKey: "projectaddnewcreate", icon: "➕", action: () => { openModal(); } },
        { name: "Terminal > Clear All Logs", searchKey: "terminalclearalllogs", icon: "🧹", action: () => { clearAllTerminals(); } },
        { name: "Filter > Show All Projects", searchKey: "filtershowallprojectsclear", icon: "🌐", action: () => { setFilter(null); } }
    ];

    availableTags.forEach(tag => {
        allActions.push({ name: `Filter by Tag: #${tag}`, searchKey: `filtertag${tag.toLowerCase()}`, icon: "🏷️", action: () => { setFilter(tag); }});
    });

    cachedProjects.forEach(p => {
        const pId = p.id || p.ID;
        const safeName = p.name || p.Name;
        const isRunning = p.status === 'running';

        allActions.push({ name: `Start: ${safeName}`, searchKey: `startprojectrun${safeName.toLowerCase()}`, icon: "▶️", action: () => { startProject(pId, safeName, null); }});
        
        if (isRunning) {
            allActions.push({ name: `Stop: ${safeName}`, searchKey: `stopprojectkill${safeName.toLowerCase()}`, icon: "⏹️", action: () => { stopProject(pId, null); }});
            allActions.push({ name: `Restart: ${safeName}`, searchKey: `restartprojectreboot${safeName.toLowerCase()}`, icon: "🔄", action: () => { restartProject(pId, safeName, null); }});
            allActions.push({ name: `Focus Terminal: ${safeName}`, searchKey: `focusterminalviewlogs${safeName.toLowerCase()}`, icon: "📟", action: () => { restoreTerminal(pId); }});
            allActions.push({ name: `Export Logs: ${safeName}`, searchKey: `exportlogsdownload${safeName.toLowerCase()}`, icon: "💾", action: () => { exportTerminalLogs(pId, safeName); }});
        }
        
        allActions.push({ name: `Edit Config & Env: ${safeName}`, searchKey: `editprojectconfigenv${safeName.toLowerCase()}`, icon: "✏️", action: () => { openEditModal(pId); }});
        allActions.push({ name: `Delete: ${safeName}`, searchKey: `deleteprojectremove${safeName.toLowerCase()}`, icon: "🗑️", action: () => { openDeleteModal(pId); }});
    });

    currentCmdActions = allActions.filter(a => a.searchKey.includes(query)).slice(0, 12);
    cmdSelectedIndex = 0;
    renderCmdResults();
}

function updateCmdSelection() {
    const resultsDiv = document.getElementById('cmdResults');
    if (!resultsDiv) return;
    const allBtns = resultsDiv.querySelectorAll('.cmd-item');
    allBtns.forEach((btn, idx) => {
        const iconSpan = btn.querySelector('.cmd-icon');
        if (idx === cmdSelectedIndex) {
            btn.classList.add('bg-indigo-500/20', 'text-white');
            btn.classList.remove('text-gray-300', 'hover:bg-gray-800');
            if (iconSpan) iconSpan.classList.add('scale-110');
            btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            btn.classList.remove('bg-indigo-500/20', 'text-white');
            btn.classList.add('text-gray-300', 'hover:bg-gray-800');
            if (iconSpan) iconSpan.classList.remove('scale-110');
        }
    });
}

function renderCmdResults() {
    const resultsDiv = document.getElementById('cmdResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '';
    if (currentCmdActions.length === 0) {
        resultsDiv.innerHTML = `<div class="px-4 py-3 text-gray-500 text-sm text-center font-bold">No matching commands found.</div>`;
        return;
    }
    currentCmdActions.forEach((a, idx) => {
        const btn = document.createElement('button');
        const isActive = idx === cmdSelectedIndex;
        btn.className = `cmd-item w-full text-left px-4 py-2.5 rounded-lg flex items-center gap-3 transition-colors group ${isActive ? 'bg-indigo-500/20 text-white' : 'text-gray-300 hover:bg-gray-800'}`;
        btn.innerHTML = `<span class="cmd-icon text-lg opacity-70 transition-transform ${isActive ? 'scale-110' : ''}">${a.icon}</span> <span class="font-mono text-sm font-bold tracking-wide">${a.name}</span>`;
        btn.addEventListener('mouseenter', () => { cmdSelectedIndex = idx; updateCmdSelection(); });
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeCmdPalette(); a.action(); });
        resultsDiv.appendChild(btn);
    });
    updateCmdSelection();
}

function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.min-tab:not(.dragging-tab)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
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
    const maxLength = 22; let cleanPath = path.replace(/\\/g, '/'); 
    if (!cleanPath.endsWith('/')) cleanPath += '/';
    if (cleanPath.length <= maxLength) return cleanPath;
    const startPart = cleanPath.substring(0, 3); const endPartLength = maxLength - startPart.length - 3; 
    return startPart + '...' + cleanPath.substring(cleanPath.length - endPartLength);
}

function toggleButtonLoading(btn, isLoading, originalContent = '') {
    if (!btn || !(btn instanceof Element)) return originalContent;
    if (isLoading) {
        const currentContent = btn.innerHTML;
        btn.disabled = true; btn.classList.add('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
        return currentContent;
    } else {
        btn.disabled = false; btn.classList.remove('opacity-75', 'cursor-not-allowed'); btn.innerHTML = originalContent; 
        return '';
    }
}

function switchView(viewName) {
    const dashboardView = document.getElementById('dashboard-view'); const settingsView = document.getElementById('settings-view');
    const viewTitle = document.getElementById('view-title'); const addBtn = document.getElementById('header-add-btn');
    const navDashboard = document.getElementById('nav-dashboard'); const navSettings = document.getElementById('nav-settings');
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


// --- 🚨 ŞEFKATLİ PORT DEDEKTİFİ MODALI 🚨 ---
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

// --- 🚀 UÇUŞ ÖNCESİ EKSİK DONANIM UYARI MODALI (PRE-FLIGHT CHECK) ---
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