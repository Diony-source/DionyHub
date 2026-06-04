let projectToDelete = null;
let currentTagFilter = null;
let draggedRow = null;
let availableTags = [];
let cachedProjects = [];
let globalWorkspace = "C:/DionyHub/apps";

let globalSavedTags = [];

let selectedProjectIds = new Set();
let lastSelectedIdx = -1;
let activeSelectionSource = null; 

const statsHistory = {}; 
const terminalPool = {}; 
let maximizedTerminalId = null;

let cmdSelectedIndex = 0;
let currentCmdActions = [];

let isResizing = false;
const terminalResizeObserver = new ResizeObserver((entries) => {
    requestAnimationFrame(() => {
        for (const entry of entries) {
            const id = entry.target.dataset.termId;
            if (id && terminalPool[id] && !terminalPool[id].minimized) {
                try { terminalPool[id].fitAddon.fit(); } catch(e) {}
            }
        }
    });
});

document.addEventListener("DOMContentLoaded", async () => {
    getOrCreateTerminal("system", "DionyHub System Logs");
    await loadSettings();
    loadProjects();
    connectWebSocket();
    initTagAutocomplete('projTag', 'tagDropdown'); 
    initTagAutocomplete('editProjTag', 'editTagDropdown'); 
    switchView('dashboard');

    const resizer = document.getElementById('horizontal-resizer');
    const terminalPane = document.getElementById('terminal-pane');
    const dashboardView = document.getElementById('dashboard-view');
    const grid = document.getElementById('terminals-grid');
    const tabsContainer = document.getElementById('minimized-tabs-container');

    if (resizer && terminalPane && dashboardView) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'row-resize';
            if (grid) grid.style.transition = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const dashRect = dashboardView.getBoundingClientRect();
            let newHeight = dashRect.bottom - e.clientY;
            
            if (newHeight < 150) newHeight = 150;
            if (newHeight > dashRect.height - 200) newHeight = dashRect.height - 200;
            
            terminalPane.style.height = `${newHeight}px`;
            terminalPane.style.flex = 'none'; 
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                if (grid) grid.style.transition = ''; 
            }
        });
    }

    if (tabsContainer) {
        tabsContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation(); 
            
            const draggingTab = document.querySelector('.dragging-tab');
            if (!draggingTab) return;
            
            const afterElement = getDragAfterElement(tabsContainer, e.clientX);
            if (afterElement == null) {
                tabsContainer.appendChild(draggingTab);
            } else {
                tabsContainer.insertBefore(draggingTab, afterElement);
            }
        });
        
        tabsContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    if (terminalPane) {
        terminalPane.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.target.closest('#minimized-tabs-container')) return; 
            terminalPane.classList.add('ring-2', 'ring-indigo-500/50');
        });
        terminalPane.addEventListener('dragleave', (e) => {
            terminalPane.classList.remove('ring-2', 'ring-indigo-500/50');
        });
        terminalPane.addEventListener('drop', (e) => {
            e.preventDefault();
            terminalPane.classList.remove('ring-2', 'ring-indigo-500/50');
            if (e.target.closest('#minimized-tabs-container')) return;
            
            const minId = e.dataTransfer.getData('application/diony-min-term');
            if (minId && terminalPool[minId] && terminalPool[minId].minimized) {
                restoreTerminal(minId);
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#contextMenu')) hideContextMenu();
        if (e.target.id === 'cmdPalette') closeCmdPalette();
        
        const isOutsideClick =  !e.target.closest('tr') && 
                                !e.target.closest('#bulk-actions-container') && 
                                !e.target.closest('.btn-action') && 
                                !e.target.closest('.tag-filter-btn') && 
                                !e.target.closest('.cursor-pointer') &&
                                !e.target.closest('#tagModal');

       if (isOutsideClick && selectedProjectIds.size > 0) {
           selectedProjectIds.clear();
           activeSelectionSource = null;
           applySelectionStyles();
           updateBulkActionBar(cachedProjects.length);
       }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            toggleCmdPalette();
        }
        if (e.key === 'Escape') {
            closeCmdPalette();
            hideContextMenu();
        }
    });

    const cmdInput = document.getElementById('cmdInput');
    if (cmdInput) {
        cmdInput.addEventListener('input', handleCmdSearch);
        
        cmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (currentCmdActions.length > 0) {
                    cmdSelectedIndex = (cmdSelectedIndex + 1) % currentCmdActions.length;
                    updateCmdSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (currentCmdActions.length > 0) {
                    cmdSelectedIndex = (cmdSelectedIndex - 1 + currentCmdActions.length) % currentCmdActions.length;
                    updateCmdSelection();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (currentCmdActions[cmdSelectedIndex]) {
                    closeCmdPalette();
                    currentCmdActions[cmdSelectedIndex].action();
                }
            }
        });
    }
});

window.addEventListener('resize', () => { setTimeout(refreshAllTerminalFits, 50); });

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
        { label: 'Environment (.env)', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', color: 'text-teal-400', action: () => openEnvModal(pId), disabled: false },
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
        btn.innerHTML = `
            <svg class="w-4 h-4 ${baseColor} ${iconScale} transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path>
            </svg> 
            <span class="${textClass} transition-colors">${item.label}</span>
        `;
        
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
        { name: "Settings > Open Configurations", searchKey: "settingsopenconfigurations", icon: "⚙️", action: () => { switchView('settings'); } },
        { name: "Dashboard > View Projects", searchKey: "dashboardviewprojects", icon: "📊", action: () => { switchView('dashboard'); } },
        { name: "Project > Add New", searchKey: "projectaddnew", icon: "➕", action: () => { openModal(); } },
        { name: "Terminal > Clear All", searchKey: "terminalclearall", icon: "🧹", action: () => { clearAllTerminals(); } }
    ];

    cachedProjects.forEach(p => {
        allActions.push({ name: `Start Project: ${p.name}`, searchKey: `startproject${p.name.toLowerCase()}`, icon: "▶️", action: () => { startProject(p.id, p.name, null); }});
        allActions.push({ name: `Stop Project: ${p.name}`, searchKey: `stopproject${p.name.toLowerCase()}`, icon: "⏹️", action: () => { stopProject(p.id, null); }});
        allActions.push({ name: `Edit Project: ${p.name}`, searchKey: `editproject${p.name.toLowerCase()}`, icon: "✏️", action: () => { openEditModal(p.id); }});
    });

    currentCmdActions = allActions.filter(a => a.searchKey.includes(query)).slice(0, 10);
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
        
        btn.addEventListener('mouseenter', () => {
            cmdSelectedIndex = idx;
            updateCmdSelection();
        });
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeCmdPalette();
            a.action();
        });
        
        resultsDiv.appendChild(btn);
    });
    
    updateCmdSelection();
}

function getOrCreateTerminal(id, name) {
    if (terminalPool[id]) return terminalPool[id];

    const grid = document.getElementById('terminals-grid');
    if (!grid) return null;

    const wrapper = document.createElement('div');
    wrapper.id = `tmux-wrapper-${id}`;
    wrapper.className = "flex flex-col border border-gray-700/50 shadow-2xl rounded-xl overflow-hidden relative group bg-[#0a0d14] ring-1 ring-black/50 transition opacity transform duration-300 scale-95 opacity-0 min-w-0 max-w-full";

    const header = document.createElement('div');
    header.className = "bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2 flex justify-between items-center border-b border-gray-700/50 shadow-sm z-10 shrink-0";
    
    const titleSpan = document.createElement('div');
    titleSpan.className = `text-xs font-bold font-mono tracking-wide flex items-center gap-2.5`;
    const isSystem = id === 'system';
    const dotColor = isSystem ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]';
    const textColor = isSystem ? 'text-indigo-300' : 'text-gray-300';
    
    titleSpan.innerHTML = `<div class="w-2 h-2 rounded-full ${dotColor}"></div><span class="${textColor} drop-shadow-md truncate">${name}</span>`;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = "flex items-center gap-1.5 opacity-40 group-hover:opacity-100 transition-all duration-300";

    const searchInput = document.createElement('input');
    searchInput.type = "text"; 
    searchInput.id = `search-input-${id}`;
    searchInput.className = "hidden bg-[#0f111a] border border-gray-600 text-gray-300 text-xs px-2 py-1 rounded w-32 neon-focus shadow-inner";
    searchInput.placeholder = "Find in logs...";

    const searchBtn = document.createElement('button');
    searchBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>`;
    searchBtn.className = "text-gray-400 hover:text-indigo-400 hover:bg-indigo-500/10 p-1.5 rounded-lg transition-colors";
    searchBtn.title = "Search Logs";
    searchBtn.onclick = () => {
        if (searchInput.classList.contains('hidden')) { 
            searchInput.classList.remove('hidden'); 
            searchInput.focus(); 
        } else { 
            searchInput.classList.add('hidden'); 
            searchInput.value = ''; 
            if (terminalPool[id].searchAddon) terminalPool[id].searchAddon.clearDecorations(); 
        }
    };

    const exportBtn = document.createElement('button');
    exportBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>`;
    exportBtn.className = "text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-1.5 rounded-lg transition-colors";
    exportBtn.title = "Export Logs to .txt";
    exportBtn.onclick = () => exportTerminalLogs(id, name);

    const minBtn = document.createElement('button');
    minBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path></svg>`;
    minBtn.className = "text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 p-1.5 rounded-lg transition-colors";
    minBtn.title = "Minimize Terminal";
    minBtn.onclick = () => minimizeTerminal(id, name);

    const maxBtn = document.createElement('button');
    maxBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    maxBtn.className = "text-gray-400 hover:text-white hover:bg-gray-700/80 p-1.5 rounded-lg transition-colors";
    maxBtn.title = "Toggle Fullscreen";
    maxBtn.onclick = () => toggleMaximizeTerminal(id);
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
    closeBtn.className = "text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 p-1.5 rounded-lg transition-colors";
    closeBtn.title = "Close Terminal";
    closeBtn.onclick = () => closeTerminal(id);
    
    const clearBtn = document.createElement('button');
    clearBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`;
    clearBtn.className = "text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 p-1.5 rounded-lg transition-colors ml-1 border-l border-gray-700 pl-2";
    clearBtn.title = "Clear Logs";
    clearBtn.onclick = () => terminalPool[id].term.clear();

    actionsDiv.appendChild(searchInput); 
    actionsDiv.appendChild(searchBtn); 
    actionsDiv.appendChild(exportBtn); 
    actionsDiv.appendChild(minBtn); 
    actionsDiv.appendChild(maxBtn); 
    actionsDiv.appendChild(closeBtn); 
    actionsDiv.appendChild(clearBtn);
    
    header.appendChild(titleSpan); 
    header.appendChild(actionsDiv);

    const xtermWrapper = document.createElement('div');
    xtermWrapper.className = "flex-1 relative w-full min-w-0 min-h-[150px] overflow-hidden";
    xtermWrapper.dataset.termId = id;

    const termContainer = document.createElement('div');
    termContainer.id = `tmux-term-${id}`;
    termContainer.className = "absolute inset-0 bg-[#0a0d14] p-2 overflow-hidden";
    
    xtermWrapper.appendChild(termContainer);
    wrapper.appendChild(header); 
    wrapper.appendChild(xtermWrapper); 
    grid.appendChild(wrapper);

    terminalResizeObserver.observe(xtermWrapper);

    requestAnimationFrame(() => {
        wrapper.classList.remove('scale-95', 'opacity-0');
        wrapper.classList.add('scale-100', 'opacity-100');
    });

    const term = new Terminal({
        theme: { 
            background: '#0a0d14', foreground: '#e5e7eb', cursor: '#6366f1', selection: '#6366f140', 
            black: '#1f2937', red: '#ef4444', green: '#10b981', yellow: '#f59e0b', blue: '#3b82f6', 
            magenta: '#d946ef', cyan: '#06b6d4', white: '#f9fafb' 
        },
        fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, convertEol: true
    });

    const fitAddon = new FitAddon.FitAddon(); 
    term.loadAddon(fitAddon);
    
    const searchAddon = new SearchAddon.SearchAddon(); 
    term.loadAddon(searchAddon);
    
    term.open(termContainer);

    const termInstance = { 
        term: term, 
        fitAddon: fitAddon, 
        searchAddon: searchAddon, 
        container: wrapper, 
        currentLine: "",
        minimized: false,
        lastStatus: 'stopped'
    };
    terminalPool[id] = termInstance;

    term.attachCustomKeyEventHandler((e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f' && e.type === 'keydown') {
            e.preventDefault(); 
            searchInput.classList.remove('hidden'); 
            searchInput.focus(); 
            return false;
        }
        return true;
    });

    searchInput.addEventListener('input', (e) => { 
        if(e.target.value) {
            searchAddon.findNext(e.target.value, { decorations: true }); 
        }
    });
    
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
            if (e.shiftKey) {
                searchAddon.findPrevious(e.target.value, { decorations: true }); 
            } else {
                searchAddon.findNext(e.target.value, { decorations: true }); 
            }
        }
    });

    if (id !== 'system') {
        term.onData(data => {
            for (let i = 0; i < data.length; i++) {
                const char = data[i]; 
                const code = char.charCodeAt(0);
                
                if (code === 13 || code === 10) { 
                    term.write('\r\n'); 
                    const payload = termInstance.currentLine + '\r\n';
                    
                    fetch('/api/projects/input', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ id: id, data: payload }) 
                    }).catch(err => console.error("Send failed:", err));
                    
                    termInstance.currentLine = ""; 
                } else if (code === 127 || code === 8) { 
                    if (termInstance.currentLine.length > 0) { 
                        termInstance.currentLine = termInstance.currentLine.slice(0, -1); 
                        term.write('\b \b'); 
                    }
                } else { 
                    termInstance.currentLine += char; 
                    term.write(char); 
                }
            }
        });
    }

    if (id === 'system') {
        term.writeln('\x1b[35m=== DionyHub Engine Connected ===\x1b[0m');
    }
    
    updateGridCSS(); 
    return termInstance;
}

function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.min-tab:not(.dragging-tab)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function exportTerminalLogs(id, name) {
    const term = terminalPool[id].term; 
    term.selectAll(); 
    const text = term.getSelection(); 
    term.clearSelection();
    
    if (!text || text.trim() === "") { 
        showToast("Terminal is empty.", "error"); 
        return; 
    }
    
    const blob = new Blob([text], { type: 'text/plain' }); 
    const url = URL.createObjectURL(blob); 
    const a = document.createElement('a');
    
    a.href = url; 
    a.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_logs_${new Date().getTime()}.txt`;
    
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a); 
    URL.revokeObjectURL(url);
    
    showToast(`${name} logs exported successfully!`, "success");
}

function minimizeTerminal(id, name) {
    if (!terminalPool[id]) return;
    if (terminalPool[id].minimized) return; 

    terminalPool[id].minimized = true;
    
    const tabsContainer = document.getElementById('minimized-tabs-container');
    if (!document.getElementById(`min-tab-${id}`)) {
        const tab = document.createElement('div');
        tab.id = `min-tab-${id}`;
        tab.draggable = true;
        tab.className = "min-tab flex items-center gap-1.5 px-3 py-1.5 bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-md cursor-grab active:cursor-grabbing text-xs text-gray-300 font-mono transition-colors shadow-sm group shrink-0 select-none";
        
        const dotColor = id === 'system' ? 'bg-indigo-500' : 'bg-emerald-500';
        
        tab.innerHTML = `
            <div class="w-1.5 h-1.5 rounded-full ${dotColor}"></div>
            <span class="truncate max-w-[120px] font-bold">${name}</span>
            <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                <button type="button" class="hover:text-indigo-400 transition-colors p-0.5 focus:outline-none" onclick="restoreTerminal('${id}'); event.stopPropagation();" title="Restore">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                </button>
                <button type="button" class="hover:text-rose-400 transition-colors p-0.5 focus:outline-none" onclick="closeTerminal('${id}'); event.stopPropagation();" title="Close">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
        
        tab.ondragstart = (e) => {
            e.dataTransfer.setData('application/diony-min-term', id);
            tab.classList.add('opacity-50', 'dragging-tab');
        };
        tab.ondragend = (e) => {
            tab.classList.remove('opacity-50', 'dragging-tab');
        };
        tab.onclick = (e) => {
            if (e.target.closest('button')) return; 
            restoreTerminal(id);
        };
        tabsContainer.appendChild(tab);
    }
    
    updateGridCSS();
}

function restoreTerminal(id) {
    if (!terminalPool[id]) return;
    terminalPool[id].minimized = false;
    
    const tab = document.getElementById(`min-tab-${id}`);
    if (tab) tab.remove();
    
    if (maximizedTerminalId === id) toggleMaximizeTerminal(id); 
    updateGridCSS();
}

function closeTerminal(id) {
    const termInstance = terminalPool[id];
    if (!termInstance) return;

    if (id === 'system') {
        minimizeTerminal(id, "DionyHub System Logs");
        return;
    }

    if (termInstance.lastStatus === 'running') {
        if (!termInstance.minimized) {
            const p = cachedProjects.find(x => (x.id || x.ID) === id);
            const pName = p ? (p.name || p.Name) : id;
            minimizeTerminal(id, pName);
            showToast("Terminal kapatılamadı: Proje şu anda çalışıyor. Sekmeye küçültüldü, tamamen kapatmak için önce durdurun.", "error");
        } else {
            showToast("Terminal tamamen kapatılamadı. Lütfen önce projeyi durdurun.", "error");
        }
        return;
    }

    termInstance.term.dispose(); 
    termInstance.container.remove();
    
    const tab = document.getElementById(`min-tab-${id}`);
    if (tab) tab.remove();
    
    delete terminalPool[id];
    if (maximizedTerminalId === id) maximizedTerminalId = null;
    
    updateGridCSS();
}

function updateGridCSS() {
    const grid = document.getElementById('terminals-grid'); 
    if (!grid) return;
    
    const activeIds = Object.keys(terminalPool).filter(id => !terminalPool[id].minimized); 
    const count = activeIds.length;
    
    grid.style.display = 'flex'; 
    grid.style.flexWrap = 'wrap'; 
    grid.style.alignContent = 'stretch';  
    grid.style.alignItems = 'stretch';
    grid.style.gap = '16px'; 
    grid.style.overflowX = 'hidden'; 
    grid.style.width = '100%';
    grid.style.minWidth = '0';
    
    Object.keys(terminalPool).forEach(id => {
        if (terminalPool[id].minimized) {
            terminalPool[id].container.style.display = 'none';
        }
    });

    if (maximizedTerminalId && terminalPool[maximizedTerminalId] && !terminalPool[maximizedTerminalId].minimized) {
        activeIds.forEach(id => { 
            const wrapper = terminalPool[id].container;
            if (id !== maximizedTerminalId) {
                wrapper.style.display = 'none'; 
            } else {
                wrapper.style.display = 'flex';
                wrapper.style.flex = '1 1 100%';
                wrapper.style.height = 'auto'; 
                wrapper.style.minHeight = '250px';
                wrapper.style.maxWidth = '100%';
            }
        });
    } else {
        activeIds.forEach(id => {
            const wrapper = terminalPool[id].container;
            wrapper.style.display = 'flex';
            wrapper.style.maxWidth = '100%'; 
            
            if (count === 1) { 
                wrapper.style.flex = '1 1 100%';
            } else if (count === 2) { 
                wrapper.style.flex = '1 1 calc(50% - 16px)';
            } else if (count <= 4) { 
                wrapper.style.flex = '1 1 calc(50% - 16px)';
            } else { 
                wrapper.style.flex = '1 1 400px'; 
            }
            
            wrapper.style.height = 'auto'; 
            wrapper.style.minHeight = '200px'; 
        });
    }
}

function refreshAllTerminalFits() { 
    Object.values(terminalPool).forEach(instance => { 
        if (!instance.container.classList.contains('hidden') && instance.container.style.display !== 'none') { 
            try { instance.fitAddon.fit(); } catch(e) {} 
        } 
    }); 
}

function toggleMaximizeTerminal(id) { 
    if (maximizedTerminalId === id) {
        maximizedTerminalId = null; 
    } else {
        maximizedTerminalId = id;
    }
    
    updateGridCSS(); 
    
    if (maximizedTerminalId && !terminalPool[id].minimized) { 
        terminalPool[id].term.focus(); 
    } 
}

function clearAllTerminals() { 
    Object.values(terminalPool).forEach(instance => { 
        instance.term.clear(); 
    }); 
}

function connectWebSocket() {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    
    socket.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            
            if (msg.id === 'metrics') {
                const statsArray = JSON.parse(msg.data);
                if (!statsArray) return; // NİHAİ KORUMA: Backend'den null gelse bile çökmeyecek!
                
                statsArray.forEach(stat => {
                    const badge = document.getElementById('status-' + stat.id);
                    const statsDiv = document.getElementById('stats-' + stat.id);
                    
                    if (!badge) return;

                    let prevStatus = terminalPool[stat.id] ? terminalPool[stat.id].lastStatus : null;
                    if (terminalPool[stat.id]) terminalPool[stat.id].lastStatus = stat.status;

                    if (stat.status === 'running') {
                        badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-colors';
                        badge.innerText = 'Running';
                        
                        if (statsDiv) {
                            const hrs = Math.floor(stat.uptime / 3600); 
                            const mins = Math.floor((stat.uptime % 3600) / 60); 
                            const secs = stat.uptime % 60;
                            
                            const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m` : (mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
                            const sparkHtml = drawSparkline(stat.id, stat.cpu);
                            
                            statsDiv.innerHTML = `
                                <div class="flex flex-col gap-0.5">
                                    <div class="flex gap-2">
                                        <span class="text-indigo-400">CPU: ${stat.cpu.toFixed(1)}%</span>
                                        <span class="text-emerald-400">RAM: ${stat.ram.toFixed(1)} MB</span>
                                    </div>
                                    <span class="text-amber-400 font-bold opacity-80">UP: ${uptimeStr}</span>
                                </div> 
                                ${sparkHtml}
                            `;
                        }
                        
                        if (!terminalPool[stat.id]) { 
                            const p = cachedProjects.find(x => x.id === stat.id || x.ID === stat.id); 
                            if(p) getOrCreateTerminal(p.id || p.ID, p.name || p.Name); 
                        }
                    } else {
                        badge.className = 'px-3 py-1 bg-gray-800/60 text-gray-400 text-xs rounded-full border border-gray-700/50 font-bold transition-colors';
                        badge.innerText = 'Stopped';
                        
                        if (statsDiv) {
                            statsDiv.innerHTML = `<span class="text-gray-600">CPU: --</span><span class="text-gray-600">RAM: --</span>`;
                        }

                        if (prevStatus === 'running' && terminalPool[stat.id]) {
                            const p = cachedProjects.find(x => x.id === stat.id || x.ID === stat.id);
                            if (p && (p.auto_close || p.AutoClose)) {
                                minimizeTerminal(stat.id, p.name || p.Name);
                            }
                        }
                    }
                });
                return; 
            }

            let projName = "Unknown";
            
            if (msg.id === 'system') {
                projName = "DionyHub System Logs";
            } else { 
                const p = cachedProjects.find(x => x.id === msg.id || x.ID === msg.id); 
                projName = p ? (p.name || p.Name) : msg.id; 
            }
            
            const termInstance = getOrCreateTerminal(msg.id, projName);
            
            if (msg.id === 'system') {
                termInstance.term.write('\x1b[36m' + msg.data + '\x1b[0m');
            } else { 
                termInstance.term.write(msg.data); 
            }
            
        } catch (err) {
            if(terminalPool['system']) {
                terminalPool['system'].term.write(e.data);
            }
        }
    };
    
    socket.onclose = () => {
        if (terminalPool['system']) {
            terminalPool['system'].term.writeln('\x1b[31m=== Connection lost. Reconnecting in 3s... ===\x1b[0m');
        }
        setTimeout(connectWebSocket, 3000);
    };
}

// ==========================================
// UTILITIES & UI HELPERS
// ==========================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    while (container.childElementCount >= 3) { 
        container.removeChild(container.firstChild); 
    }

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.3)]' : 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
    
    const icon = type === 'error' 
        ? `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>` 
        : `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;

    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl transform transition-all duration-300 translate-x-full opacity-0 pointer-events-auto ${bgColor} bg-[#11151f]`;
    toast.innerHTML = `${icon} <span class="text-sm font-bold drop-shadow-md">${message}</span>`;
    
    container.appendChild(toast);

    requestAnimationFrame(() => { 
        toast.classList.remove('translate-x-full', 'opacity-0'); 
    });
    
    setTimeout(() => { 
        toast.classList.add('translate-x-full', 'opacity-0'); 
        setTimeout(() => toast.remove(), 300); 
    }, 3000);
}

function formatWorkspacePath(path) {
    const maxLength = 22; 
    let cleanPath = path.replace(/\\/g, '/'); 
    
    if (!cleanPath.endsWith('/')) {
        cleanPath += '/';
    }
    
    if (cleanPath.length <= maxLength) return cleanPath;
    
    const startPart = cleanPath.substring(0, 3); 
    const endPartLength = maxLength - startPart.length - 3; 
    return startPart + '...' + cleanPath.substring(cleanPath.length - endPartLength);
}

function toggleButtonLoading(btn, isLoading, originalContent = '') {
    if (!btn || !(btn instanceof Element)) return originalContent;
    
    if (isLoading) {
        const currentContent = btn.innerHTML;
        btn.disabled = true; 
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        
        btn.innerHTML = `
            <svg class="animate-spin h-4 w-4 mx-auto inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        `;
        return currentContent;
    } else {
        btn.disabled = false; 
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = originalContent; 
        return '';
    }
}

function switchView(viewName) {
    const dashboardView = document.getElementById('dashboard-view'); 
    const settingsView = document.getElementById('settings-view');
    const viewTitle = document.getElementById('view-title'); 
    const addBtn = document.getElementById('header-add-btn');
    const navDashboard = document.getElementById('nav-dashboard'); 
    const navSettings = document.getElementById('nav-settings');

    if (viewName === 'dashboard') {
        dashboardView.classList.remove('hidden'); 
        settingsView.classList.add('hidden');
        viewTitle.innerText = "Active Library"; 
        addBtn.classList.remove('hidden');
        
        if (navDashboard) navDashboard.className = "w-full flex items-center justify-between px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-300 font-medium transition-all shadow-inner";
        if (navSettings) navSettings.className = "w-full flex items-center gap-2 px-4 py-2 text-gray-400 hover:bg-gray-800/50 hover:text-white rounded-lg transition-colors border border-transparent font-medium text-left mt-2 group";
        
        setTimeout(refreshAllTerminalFits, 100);
    } else if (viewName === 'settings') {
        dashboardView.classList.add('hidden'); 
        settingsView.classList.remove('hidden');
        viewTitle.innerText = "System Settings"; 
        addBtn.classList.add('hidden');
        
        if (navDashboard) navDashboard.className = "w-full flex items-center justify-between px-4 py-2 text-gray-400 hover:bg-gray-800/50 hover:text-white rounded-lg transition-colors border border-transparent font-medium";
        if (navSettings) navSettings.className = "w-full flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-300 font-medium transition-all mt-2 shadow-inner";
    }
}

function createProjectRow(p, index, sourceArray) {
    const tr = document.createElement('tr');
    const pId = p.id || p.ID; 
    const pSource = (p.source || p.Source) === 'github' ? 'github' : 'local';
    const isSelected = selectedProjectIds.has(pId);
    
    tr.className = `border-b border-gray-800/60 transition-colors group cursor-pointer ${isSelected ? 'bg-indigo-500/30 shadow-[inset_4px_0_0_rgba(99,102,241,1)]' : 'bg-[#0f111a]/30 hover:bg-gray-800/40'}`;
    tr.setAttribute('draggable', 'true'); 
    tr.dataset.id = pId;

    tr.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.cursor-grab')) return;
       
        if (activeSelectionSource !== null && activeSelectionSource !== pSource && selectedProjectIds.size > 0) {
            selectedProjectIds.clear();
        }
        activeSelectionSource = pSource;

        if (e.ctrlKey || e.metaKey) {
            if (selectedProjectIds.has(pId)) selectedProjectIds.delete(pId);
            else selectedProjectIds.add(pId);
            lastSelectedIdx = index;
        } else if (e.shiftKey && lastSelectedIdx !== -1) {
            e.preventDefault(); 
            document.getSelection().removeAllRanges();
           
            const start = Math.min(lastSelectedIdx, index);
            const end = Math.max(lastSelectedIdx, index);
           
            if (!e.ctrlKey && !e.metaKey) selectedProjectIds.clear();
           
            for (let i = start; i <= end; i++) {
                const iterId = sourceArray[i].id || sourceArray[i].ID;
                if(iterId) selectedProjectIds.add(iterId);
            }
        } else {
            selectedProjectIds.clear();
            selectedProjectIds.add(pId);
            lastSelectedIdx = index;
        }
       
        applySelectionStyles();
        updateBulkActionBar(cachedProjects.length);
    });

    tr.addEventListener('contextmenu', (e) => {
        const status = cachedProjects.find(x => (x.id || x.ID) === pId)?.status || 'stopped';
        showContextMenu(e, pId, p.name || p.Name, status);
    });

    tr.addEventListener('dragstart', handleDragStart); 
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('dragenter', handleDragEnter); 
    tr.addEventListener('dragleave', handleDragLeave);
    tr.addEventListener('drop', handleDrop); 
    tr.addEventListener('dragend', handleDragEnd);
    
    const tagBadge = p.tag ? `<span class="ml-3 inline-flex items-center gap-1 px-2.5 py-0.5 bg-gray-800 text-indigo-300 text-xs font-bold rounded-full border border-indigo-500/30 shadow-sm whitespace-nowrap"><span class="text-indigo-500 opacity-80 font-black">#</span>${p.tag}</span>` : '';
    const autoBadge = p.auto_start ? `<span class="ml-2 text-emerald-400 drop-shadow-md hover:scale-110 transition-transform cursor-help" title="Auto-Start Enabled">⚡</span>` : '';
    const watchdogBadge = p.auto_restart ? `<span class="ml-1 text-amber-400 drop-shadow-md hover:scale-110 transition-transform cursor-help" title="Auto-Restart Enabled">🛡️</span>` : '';
    const safeName = p.name || p.Name || "Unknown";

    tr.innerHTML = `
        <td class="p-4 font-bold text-gray-200 flex items-center gap-4">
            <div class="cursor-grab text-gray-700 hover:text-gray-400 transition-colors" title="Drag to reorder">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
            </div>
            <div class="h-10 w-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50 flex items-center justify-center text-indigo-400 font-black group-hover:border-indigo-500/50 group-hover:shadow-[0_0_15px_rgba(79,70,229,0.2)] transition-all shrink-0 text-lg">${safeName.charAt(0).toUpperCase()}</div>
            <div class="flex flex-col"><div class="flex items-center">${safeName} ${tagBadge} ${autoBadge} ${watchdogBadge}</div></div>
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
                    <button onclick="backupProject('${pId}', this)" class="btn-action bg-gray-800 hover:bg-amber-600 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(245,158,11,0.3)]">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    </button>
                    <button onclick="openEnvModal('${pId}')" class="btn-action bg-gray-800 hover:bg-teal-500 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(20,184,166,0.3)]">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
                    </button>
                    <button onclick="openEditModal('${pId}')" class="btn-action bg-gray-800 hover:bg-indigo-600 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(79,70,229,0.3)]">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </button>
                    <button onclick="openDeleteModal('${pId}')" class="btn-action bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors hover:shadow-[0_0_10px_rgba(225,29,72,0.3)]">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
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
    
    localTbody.innerHTML = '';
    githubTbody.innerHTML = '';

    const filteredProjects = currentTagFilter ? cachedProjects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase()) : cachedProjects;

    updateBulkActionBar(filteredProjects.length);

    if (filteredProjects.length === 0) { 
        tableContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
        return; 
    } else {
        tableContainer.classList.remove('hidden');
        emptyState.classList.add('hidden');
        emptyState.classList.remove('flex');
    }

    const localProjects = filteredProjects.filter(p => (p.source || p.Source) !== 'github');
    const githubProjects = filteredProjects.filter(p => (p.source || p.Source) === 'github');

    if (localProjects.length === 0) {
        localTbody.innerHTML = `<tr onclick="openModal()" class="cursor-pointer hover:bg-gray-800/40 transition-colors group"><td colspan="5" class="p-6 text-center text-gray-500 font-medium text-xs italic group-hover:text-indigo-400 transition-colors">No local projects found. Click here to add one.</td></tr>`;
    } else {
        localProjects.forEach((p, index) => {
            localTbody.appendChild(createProjectRow(p, index, localProjects));
        });
    }

    if (githubProjects.length === 0) {
        githubTbody.innerHTML = `<tr onclick="openModal()" class="cursor-pointer hover:bg-gray-800/40 transition-colors group"><td colspan="5" class="p-6 text-center text-gray-500 font-medium text-xs italic group-hover:text-emerald-400 transition-colors">No GitHub repositories found. Click here to clone one.</td></tr>`;
    } else {
        githubProjects.forEach((p, index) => {
            githubTbody.appendChild(createProjectRow(p, index, githubProjects));
        });
    }

    applySelectionStyles();
}

function updateBulkActionBar(filteredCount) {
    const container = document.getElementById('bulk-actions-container');
    const name = document.getElementById('bulk-tag-name');
    const count = document.getElementById('bulk-project-count');
    
    if (!container || !name || !count) return;

    if (selectedProjectIds.size > 0) {
        name.innerHTML = `<span class="text-indigo-500 font-bold opacity-75">✓</span> Seçilen Ögeler`;
        count.innerText = `${selectedProjectIds.size} proje`;
        container.style.display = '';
        container.classList.remove('hidden');
        container.classList.add('flex');
    } else if (currentTagFilter !== null) {
        name.innerHTML = `<span class="text-indigo-500 font-bold opacity-75">#</span> ${currentTagFilter}`;
        count.innerText = `${filteredCount} proje`;
        container.style.display = '';
        container.classList.remove('hidden');
        container.classList.add('flex');
    } else {
        container.style.display = 'none';
        container.classList.remove('flex');
        container.classList.add('hidden');
    }
}
 
function applySelectionStyles() {
    ['local-project-list', 'github-project-list'].forEach(tbodyId => {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        
        Array.from(tbody.children).forEach(tr => {
            const id = tr.dataset.id;
            if (!id) return; 
            
            if (selectedProjectIds.has(id)) {
                tr.classList.add('bg-indigo-500/30', 'shadow-[inset_4px_0_0_rgba(99,102,241,1)]');
                tr.classList.remove('bg-[#0f111a]/30', 'hover:bg-gray-800/40', 'bg-indigo-500/10', 'bg-indigo-500/20');
            } else {
                tr.classList.remove('bg-indigo-500/30', 'shadow-[inset_4px_0_0_rgba(99,102,241,1)]', 'bg-indigo-500/10', 'bg-indigo-500/20');
                tr.classList.add('bg-[#0f111a]/30', 'hover:bg-gray-800/40');
            }
        });
    });
}

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("API error");
        
        cachedProjects = await response.json();
        renderSidebarTags(cachedProjects);
        renderProjects();
    } catch (e) {
        console.error("Projeler yüklenemedi:", e);
    }
}

function setFilter(tag) {
    currentTagFilter = tag; 
    selectedProjectIds.clear();
    activeSelectionSource = null;
    loadProjects();
    
    document.querySelectorAll('.tag-filter-btn').forEach(btn => { 
        btn.classList.remove('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30'); 
        btn.classList.add('text-gray-400', 'hover:bg-gray-800/50'); 
    });
    
    const activeId = tag === null ? 'btn-filter-all' : `btn-filter-${tag}`; 
    const activeBtn = document.getElementById(activeId);
    
    if (activeBtn) { 
        activeBtn.classList.add('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30'); 
        activeBtn.classList.remove('text-gray-400', 'hover:bg-gray-800/50'); 
    }
}

function renderSidebarTags(projects) {
    projects.sort((a, b) => (a.order || 0) - (b.order || 0)); 
    const dynamicTags = projects.map(p => p.tag).filter(t => t && t.trim() !== '');
    
    availableTags = [...new Set([...dynamicTags, ...globalSavedTags])].sort();
    
    const tagList = document.getElementById('tag-list'); 
    if (!tagList) return;
    
    tagList.innerHTML = `
        <button id="btn-filter-all" onclick="setFilter(null)" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border ${currentTagFilter === null ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'border-transparent text-gray-400 hover:bg-gray-800/50'}">
            All Projects
        </button>
    `;
    
    availableTags.forEach(tag => { 
        const isActive = currentTagFilter === tag; 
        tagList.innerHTML += `
            <div class="flex items-center group relative mt-1">
                <button id="btn-filter-${tag}" onclick="setFilter('${tag}')" class="flex-1 tag-filter-btn text-left px-4 py-1.5 rounded-md text-sm transition-colors border ${isActive ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'border-transparent text-gray-400 hover:bg-gray-800/50'} pr-8 truncate">
                    # ${tag}
                </button>
                <button onclick="openTagModal('${tag}')" class="absolute right-1 opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-indigo-400 transition-all rounded bg-[#11151f] hover:bg-gray-800" title="Manage Tag">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                </button>
            </div>
        `; 
    });
}

function openTagModal(tag = null) {
    document.getElementById('tagModalTitle').innerText = tag ? `Manage: #${tag}` : 'Create New Tag';
    document.getElementById('tagOriginalName').value = tag || '';
    document.getElementById('tagNewName').value = tag || '';
    
    const btnDelete = document.getElementById('btnDeleteTag');
    if (tag) btnDelete.classList.remove('hidden');
    else btnDelete.classList.add('hidden');

    const projectList = document.getElementById('tagProjectList');
    projectList.innerHTML = '';
    
    if (cachedProjects.length === 0) {
        projectList.innerHTML = '<span class="text-xs text-gray-500 italic">No projects available.</span>';
    } else {
        cachedProjects.forEach(p => {
            const isAssigned = p.tag === tag;
            const pId = p.id || p.ID;
            const safeName = p.name || p.Name;
            
            projectList.innerHTML += `
                <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors border border-transparent hover:border-gray-700/50">
                    <div class="relative flex items-center shrink-0">
                        <input type="checkbox" name="tagProjectIds" value="${pId}" class="sr-only peer" ${isAssigned ? 'checked' : ''}>
                        <div class="w-5 h-5 bg-gray-900 border border-gray-600 rounded peer-checked:bg-indigo-500 peer-checked:border-indigo-400 transition-colors flex items-center justify-center">
                            <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                        </div>
                    </div>
                    <span class="text-sm font-bold text-gray-300 select-none">${safeName}</span>
                </label>
            `;
        });
    }
    
    document.getElementById('tagModal').classList.remove('hidden');
    document.getElementById('tagModal').classList.add('flex');
}

function closeTagModal() {
    document.getElementById('tagModal').classList.remove('flex');
    document.getElementById('tagModal').classList.add('hidden');
    document.getElementById('tagForm').reset();
}

async function submitTag(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalHTML = toggleButtonLoading(btn, true);

    const originalTag = document.getElementById('tagOriginalName').value;
    const newTag = document.getElementById('tagNewName').value;
    const checkboxes = document.querySelectorAll('input[name="tagProjectIds"]:checked');
    const projectIds = Array.from(checkboxes).map(cb => cb.value);

    try {
        const res = await fetch('/api/tags/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ original_tag: originalTag, new_tag: newTag, project_ids: projectIds })
        });
        
        if (res.ok) {
            closeTagModal();
            if (currentTagFilter === originalTag) currentTagFilter = newTag || null;
            await loadSettings(); 
            await loadProjects(); 
            showToast("Tag configured successfully", "success");
        } else {
            const err = await res.json();
            showToast(err.error || "Failed to configure tag", "error");
        }
    } catch (err) {
        showToast("Network error", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

async function deleteTag() {
    const originalTag = document.getElementById('tagOriginalName').value;
    if (!originalTag) return;
    
    try {
        const res = await fetch('/api/tags/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ original_tag: originalTag, new_tag: "", project_ids: [] })
        });
        
        if (res.ok) {
            closeTagModal();
            if (currentTagFilter === originalTag) currentTagFilter = null;
            await loadSettings();
            await loadProjects();
            showToast("Tag deleted", "success");
        } else {
            const err = await res.json();
            showToast(err.error || "Failed to delete tag", "error");
        }
    } catch (err) {
        showToast("Network error", "error");
    }
}

function initTagAutocomplete(inputId, dropdownId) {
    const input = document.getElementById(inputId); 
    const dropdown = document.getElementById(dropdownId); 
    if (!input || !dropdown) return;
    
    input.addEventListener('focus', () => update(input.value)); 
    input.addEventListener('input', (e) => update(e.target.value)); 
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));
    
    function update(text) {
        const filtered = availableTags.filter(t => t.toLowerCase().includes(text.toLowerCase()));
        
        if (filtered.length === 0) { 
            dropdown.classList.add('hidden'); 
            return; 
        }
        
        dropdown.innerHTML = '';
        filtered.forEach(tag => {
            const div = document.createElement('div'); 
            div.className = 'px-4 py-2 text-sm text-gray-300 hover:bg-indigo-600 hover:text-white cursor-pointer'; 
            div.textContent = tag;
            div.onmousedown = (e) => { 
                e.preventDefault(); 
                input.value = tag; 
                dropdown.classList.add('hidden'); 
            }; 
            dropdown.appendChild(div);
        }); 
        dropdown.classList.remove('hidden');
    }
}

function toggleWorkspaceMode() {
    const useWs = document.getElementById('useWorkspace').checked;
    const prefix = document.getElementById('workspacePrefix'); 
    const input = document.getElementById('projPath');
    
    if(useWs) {
        prefix.classList.remove('hidden'); 
        input.classList.remove('rounded-l-lg'); 
        input.classList.add('border-l-0');
        
        const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/');
        prefix.title = formattedWs; 
        prefix.innerText = formatWorkspacePath(globalWorkspace); 
        input.placeholder = "folder_name";
    } else {
        prefix.classList.add('hidden'); 
        input.classList.add('rounded-l-lg'); 
        input.classList.remove('border-l-0');
        input.placeholder = "C:/Users/Diony/Desktop/bot";
    }
}

async function browseFolder(inputId, handleWorkspace = true) {
    try {
        const res = await fetch('/api/system/browse'); 
        const data = await res.json();
        
        if (data.path && data.path !== "") {
            document.getElementById(inputId).value = data.path;
            
            if (handleWorkspace) { 
                const wsCheckbox = document.getElementById('useWorkspace'); 
                if (wsCheckbox.checked) { 
                    wsCheckbox.checked = false; 
                    toggleWorkspaceMode(); 
                } 
            }
        }
    } catch (e) { 
        showToast("Failed to open native folder picker.", "error"); 
    }
}

function toggleSourceMode() {
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    const localWrapper = document.getElementById('localFlowWrapper'); 
    const githubWrapper = document.getElementById('githubFlowWrapper');
    const projName = document.getElementById('projName'); 
    const projPath = document.getElementById('projPath'); 
    const repoUrl = document.getElementById('repoUrl');

    if (mode === 'local') {
        localWrapper.classList.remove('hidden'); 
        githubWrapper.classList.add('hidden');
        projName.required = true; 
        projPath.required = true; 
        repoUrl.required = false;
    } else {
        localWrapper.classList.add('hidden'); 
        githubWrapper.classList.remove('hidden');
        projName.required = false; 
        projPath.required = false; 
        repoUrl.required = true;
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            globalWorkspace = settings.workspace || 'C:/DionyHub/apps';
            document.getElementById('setting-workspace').value = globalWorkspace;
            if (settings.global_env) document.getElementById('setting-global-env').value = settings.global_env;
            
            globalSavedTags = settings.saved_tags || [];
            
            toggleWorkspaceMode(); 
        }
    } catch (e) {
        console.error("Settings load error", e);
    }
}

async function saveSettings() {
    const btn = document.getElementById('save-settings-btn'); 
    const originalHTML = toggleButtonLoading(btn, true);
    
    globalWorkspace = document.getElementById('setting-workspace').value;
    const globalEnv = document.getElementById('setting-global-env').value;
    
    try {
        const response = await fetch('/api/settings', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ workspace: globalWorkspace, log_buffer: false, global_env: globalEnv }) 
        });
        
        if (response.ok) { 
            showToast("System settings applied.", "success"); 
            toggleWorkspaceMode(); 
        } else { 
            const err = await response.json(); 
            showToast(err.error, "error"); 
        }
    } catch (e) { 
        showToast("Server error.", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

function openModal() { 
    document.getElementById('addModal').classList.replace('hidden', 'flex'); 
    toggleSourceMode(); 
    toggleWorkspaceMode(); 
}

function closeModal() { 
    document.getElementById('addModal').classList.replace('flex', 'hidden'); 
    document.getElementById('addForm').reset(); 
}

async function submitNewProject(e) {
    e.preventDefault(); 
    const btn = e.target.querySelector('button[type="submit"]'); 
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    const originalHTML = toggleButtonLoading(btn, true, mode === 'github' ? 'Cloning Repo...' : '');
    
    try {
        if (mode === 'local') {
            let finalPath = document.getElementById('projPath').value.trim(); 
            const useWs = document.getElementById('useWorkspace').checked;
            
            if (useWs) { 
                const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/'); 
                finalPath = formattedWs + finalPath; 
            }
            
            const data = { 
                name: document.getElementById('projName').value, 
                path: finalPath, 
                command: document.getElementById('projCmd').value, 
                tag: document.getElementById('projTag').value, 
                interactive: document.getElementById('projInteractive').checked, 
                auto_start: document.getElementById('projAutoStart').checked, 
                auto_restart: document.getElementById('projAutoRestart').checked,
                auto_close: document.getElementById('projAutoClose').checked,
                initial_env: document.getElementById('projInitialEnv').value 
            };
            
            const res = await fetch('/api/projects/add', { method: 'POST', body: JSON.stringify(data) });
            
            if (res.ok) { 
                closeModal(); 
                loadProjects(); 
                showToast("Workspace created!", "success"); 
            } else { 
                const err = await res.json(); 
                showToast(err.error, "error"); 
            }
        } else {
            const data = { 
                repo_url: document.getElementById('repoUrl').value, 
                command: document.getElementById('projCmd').value, 
                tag: document.getElementById('projTag').value, 
                interactive: document.getElementById('projInteractive').checked, 
                auto_start: document.getElementById('projAutoStart').checked, 
                auto_restart: document.getElementById('projAutoRestart').checked,
                auto_close: document.getElementById('projAutoClose').checked,
                initial_env: document.getElementById('projInitialEnv').value 
            };
            
            const res = await fetch('/api/projects/clone', { method: 'POST', body: JSON.stringify(data) });
            
            if (res.ok) { 
                closeModal(); 
                loadProjects(); 
                showToast("Repo cloned!", "success"); 
            } else { 
                const err = await res.json(); 
                showToast(err.error, "error"); 
            }
        }
    } catch (err) { 
        showToast("Connection failed.", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

function openEditModal(id) {
    const project = cachedProjects.find(p => p.id === id || p.ID === id); 
    if (!project) return;
    
    document.getElementById('editProjId').value = project.id || project.ID; 
    document.getElementById('editProjName').value = project.name || project.Name; 
    document.getElementById('editProjPath').value = project.path || project.Path; 
    document.getElementById('editProjCmd').value = project.command || project.Command || ''; 
    document.getElementById('editProjTag').value = project.tag || project.Tag || ''; 
    document.getElementById('editProjInteractive').checked = project.interactive || project.Interactive || false; 
    document.getElementById('editProjAutoStart').checked = project.auto_start || project.AutoStart || false; 
    document.getElementById('editProjAutoRestart').checked = project.auto_restart || project.AutoRestart || false;
    document.getElementById('editProjAutoClose').checked = project.auto_close || project.AutoClose || false;
    
    const modal = document.getElementById('editModal'); 
    modal.classList.remove('hidden'); 
    modal.classList.add('flex');
}

function closeEditModal() { 
    document.getElementById('editModal').classList.add('hidden'); 
}

async function submitEditProject(event) {
    event.preventDefault(); 
    const btn = event.target.querySelector('button[type="submit"]'); 
    const originalHTML = toggleButtonLoading(btn, true);
    
    const updatedProject = { 
        id: document.getElementById('editProjId').value, 
        name: document.getElementById('editProjName').value, 
        path: document.getElementById('editProjPath').value, 
        command: document.getElementById('editProjCmd').value, 
        tag: document.getElementById('editProjTag').value, 
        interactive: document.getElementById('editProjInteractive').checked, 
        auto_start: document.getElementById('editProjAutoStart').checked, 
        auto_restart: document.getElementById('editProjAutoRestart').checked,
        auto_close: document.getElementById('editProjAutoClose').checked
    };
    
    try {
        const response = await fetch('/api/projects/update', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(updatedProject) 
        });
        
        if (response.ok) { 
            closeEditModal(); 
            loadProjects(); 
            showToast("Project updated!", "success"); 
        } else { 
            const err = await response.json(); 
            showToast(err.error, "error"); 
        }
    } catch (e) { 
        showToast("Server error", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

function openDeleteModal(id) { 
    const project = cachedProjects.find(p => p.id === id || p.ID === id);
    const source = project ? (project.source || project.Source || 'local') : 'local';
    
    const checkboxContainer = document.getElementById('deleteFilesContainer');
    const warningText = document.getElementById('deleteLocalWarning');
    const checkbox = document.getElementById('deleteFilesFromDisk');
    
    if (source === 'github') {
        checkboxContainer.classList.remove('hidden');
        warningText.classList.add('hidden');
    } else {
        checkboxContainer.classList.add('hidden');
        warningText.classList.remove('hidden');
        checkbox.checked = false;
    }

    projectToDelete = id; 
    document.getElementById('deleteModal').classList.replace('hidden', 'flex'); 
}

function closeDeleteModal() { 
    document.getElementById('deleteModal').classList.replace('flex', 'hidden'); 
    document.getElementById('deleteFilesFromDisk').checked = false; 
    projectToDelete = null; 
}

async function executeDelete() { 
    const btn = document.getElementById('confirmDeleteBtn'); 
    const originalHTML = toggleButtonLoading(btn, true); 
    const deleteFiles = document.getElementById('deleteFilesFromDisk').checked;
    
    try {
        const res = await fetch(`/api/projects/delete?id=${projectToDelete}&remove_files=${deleteFiles}`, { method: 'DELETE' }); 
        
        if(res.ok) { 
            closeDeleteModal(); 
            selectedProjectIds.delete(projectToDelete);
            loadProjects(); 
            if (deleteFiles) showToast("Files deleted", "success"); 
            else showToast("Project removed", "success"); 
        } else { 
            const data = await res.json(); 
            showToast(data.error, "error"); 
            closeDeleteModal(); 
        }
    } catch (err) { 
        showToast("Failed to delete", "error"); 
        closeDeleteModal(); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
        document.getElementById('deleteFilesFromDisk').checked = false; 
    }
}

function confirmBulkDelete() {
    let idsToProcess = [];
    if (selectedProjectIds.size > 0) idsToProcess = Array.from(selectedProjectIds);
    else if (currentTagFilter) idsToProcess = cachedProjects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase()).map(p => p.id || p.ID);
    
    if (idsToProcess.length === 0) return;

    let hasLocal = false;
    idsToProcess.forEach(id => {
        const p = cachedProjects.find(x => x.id === id || x.ID === id);
        const source = p ? (p.source || p.Source || 'local') : 'local';
        if (source !== 'github') hasLocal = true;
    });

    const checkboxContainer = document.getElementById('bulkDeleteFilesContainer');
    const warningText = document.getElementById('bulkDeleteLocalWarning');
    const checkbox = document.getElementById('bulkDeleteFilesFromDisk');

    if (!hasLocal) {
        checkboxContainer.classList.remove('hidden');
        warningText.classList.add('hidden');
    } else {
        checkboxContainer.classList.add('hidden');
        warningText.classList.remove('hidden');
        checkbox.checked = false;
    }

    const countText = document.getElementById('bulkDeleteCount');
    if(countText) countText.innerText = idsToProcess.length;
    
    const modal = document.getElementById('bulkDeleteModal');
    if(modal) { 
        modal.classList.remove('hidden'); 
        modal.classList.add('flex'); 
    }
}
 
 function closeBulkDeleteModal() { 
     const m = document.getElementById('bulkDeleteModal'); 
     if(m) { 
         m.classList.remove('flex'); 
         m.classList.add('hidden'); 
     }
     const c = document.getElementById('bulkDeleteFilesFromDisk'); 
     if(c) c.checked = false; 
 }
 
 async function executeBulkDelete() {
     let idsToProcess = [];
     if (selectedProjectIds.size > 0) idsToProcess = Array.from(selectedProjectIds);
     else if (currentTagFilter) idsToProcess = cachedProjects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase()).map(p => p.id || p.ID);
     
     if (idsToProcess.length === 0) return;
 
     const deleteFiles = document.getElementById('bulkDeleteFilesFromDisk') ? document.getElementById('bulkDeleteFilesFromDisk').checked : false;
     const btn = document.getElementById('confirmBulkDeleteBtn');
     const originalHTML = toggleButtonLoading(btn, true);
     
     try {
         const res = await fetch('/api/projects/delete-bulk', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ ids: idsToProcess, remove_files: deleteFiles })
         });
         
         if(res.ok) {
             closeBulkDeleteModal();
             selectedProjectIds.clear(); 
             loadProjects();
             showToast("Projeler başarıyla silindi", "success");
         } else {
             const data = await res.json();
             showToast(data.error, "error");
             closeBulkDeleteModal();
         }
     } catch (err) {
         showToast("Bağlantı hatası", "error");
         closeBulkDeleteModal();
     } finally {
         toggleButtonLoading(btn, false, originalHTML);
     }
 }

async function executeBulkAction(action) {
    let idsToProcess = [];
    if (selectedProjectIds.size > 0) {
        idsToProcess = Array.from(selectedProjectIds);
    } else if (currentTagFilter) {
        idsToProcess = cachedProjects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase()).map(p => p.id || p.ID);
    }
    
    if (idsToProcess.length === 0) return;

    const endpoint = action === 'start' ? '/api/projects/start-bulk' : '/api/projects/stop-bulk';
    const actionText = action === 'start' ? 'Başlatılıyor...' : 'Durduruluyor...';
    
    showToast(`${idsToProcess.length} proje ${actionText}`, "success");
    
    try {
        if (action === 'start') {
            idsToProcess.forEach(id => {
                const p = cachedProjects.find(x => (x.id || x.ID) === id);
                if (p) getOrCreateTerminal(id, p.name || p.Name);
            });
        }

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(idsToProcess)
        });
        
        if (res.ok) {
            const data = await res.json();
            showToast(data.message || "İşlem başarılı", "success");
        } else {
            const err = await res.json();
            showToast(err.error || "İşlem başarısız", "error");
        }
    } catch (e) {
        showToast("Bağlantı hatası", "error");
    }
}

function handleDragStart(e) { 
    draggedRow = this; 
    e.dataTransfer.effectAllowed = 'move'; 
    setTimeout(() => this.classList.add('opacity-50'), 0); 
}

function handleDragOver(e) { 
    e.preventDefault(); 
    return false; 
}

function handleDragEnter(e) { 
    if (this !== draggedRow) {
        this.classList.add('border-t-2', 'border-indigo-500'); 
    }
}

function handleDragLeave() { 
    this.classList.remove('border-t-2', 'border-indigo-500'); 
}

function handleDrop(e) {
    e.stopPropagation(); 
    this.classList.remove('border-t-2', 'border-indigo-500');
    
    if (draggedRow.parentNode !== this.parentNode) {
        return false; 
    }

    if (draggedRow !== this) {
        const tbody = this.parentNode; 
        const rows = Array.from(tbody.children);
        const draggedIndex = rows.indexOf(draggedRow); 
        const droppedIndex = rows.indexOf(this);
        
        if (draggedIndex < droppedIndex) {
            tbody.insertBefore(draggedRow, this.nextSibling);
        } else {
            tbody.insertBefore(draggedRow, this); 
        }
        saveNewOrder();
    } 
    return false;
}

function handleDragEnd() { 
    this.classList.remove('opacity-50'); 
    document.querySelectorAll('#local-project-list tr, #github-project-list tr').forEach(r => r.classList.remove('border-t-2', 'border-indigo-500')); 
}

async function saveNewOrder() {
    const localBody = document.getElementById('local-project-list');
    const githubBody = document.getElementById('github-project-list');
    
    const localIDs = localBody ? Array.from(localBody.children).map(tr => tr.dataset.id).filter(id => id) : [];
    const githubIDs = githubBody ? Array.from(githubBody.children).map(tr => tr.dataset.id).filter(id => id) : [];
    
    const newOrderIDs = [...localIDs, ...githubIDs];
    
    try {
        const res = await fetch('/api/projects/reorder', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(newOrderIDs) 
        });
        if(!res.ok) { 
            showToast("Failed to save new order", "error"); 
            loadProjects(); 
        }
    } catch(e) {
        showToast("Network error", "error");
    }
}

async function startProject(id, name, btn) { 
    getOrCreateTerminal(id, name); 
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/start?id=${id}`, { method: 'POST' }); 
        if (!res.ok) { 
            const data = await res.json(); 
            showToast(data.error || "Failed to start", "error"); 
        } else { 
            showToast("Project started", "success"); 
        }
    } catch (e) { 
        showToast("Network error", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

async function restartProject(id, name, btn) {
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        showToast("Restart sequence initiated...", "success");
        await fetch(`/api/projects/stop?id=${id}`, { method: 'POST' });
        await new Promise(resolve => setTimeout(resolve, 1500));
        const res = await fetch(`/api/projects/start?id=${id}`, { method: 'POST' }); 
        if (!res.ok) { 
            const data = await res.json(); 
            showToast(data.error || "Failed to restart", "error"); 
        } else { 
            showToast("Project restarted successfully", "success"); 
            getOrCreateTerminal(id, name); 
        }
    } catch (e) { 
        showToast("Network error during restart", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

async function stopProject(id, btn) { 
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/stop?id=${id}`, { method: 'POST' }); 
        if (!res.ok) { 
            const data = await res.json(); 
            if (!data.error.includes("not currently running")) {
                showToast(data.error || "Failed to stop", "error"); 
            }
        } else { 
            showToast("Project stopped", "success"); 
        }
    } catch (e) { 
        showToast("Network error", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

async function backupProject(id, btn) {
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/backup?id=${id}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, "success"); 
        } else { 
            showToast(data.error || "Backup failed", "error"); 
        }
    } catch (e) { 
        showToast("Network error during backup", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}

let isEnvBlurred = true;
function toggleEnvBlur() {
    const el = document.getElementById('envContent'); 
    const icon = document.getElementById('envEyeIcon');
    isEnvBlurred = !isEnvBlurred;
    
    if (isEnvBlurred) {
        el.classList.add('blur-sm');
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>';
    } else {
        el.classList.remove('blur-sm');
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>';
    }
}

async function openEnvModal(id) {
    const project = cachedProjects.find(p => p.id === id || p.ID === id); 
    if (!project) return;
    
    document.getElementById('envProjId').value = project.id || project.ID;
    const textArea = document.getElementById('envContent'); 
    textArea.value = "Loading...";
    
    isEnvBlurred = false; 
    toggleEnvBlur();
    
    const modal = document.getElementById('envModal');
    modal.classList.remove('hidden'); 
    modal.classList.add('flex');
    
    try {
        const res = await fetch(`/api/projects/env?id=${id}`);
        if (res.ok) { 
            const data = await res.json(); 
            textArea.value = data.content; 
        } else { 
            textArea.value = ""; 
            showToast("Failed to load .env.", "error"); 
        }
    } catch (err) { 
        textArea.value = ""; 
        showToast("Network error", "error"); 
    }
}

function closeEnvModal() { 
    document.getElementById('envModal').classList.add('hidden'); 
    document.getElementById('envForm').reset(); 
}

async function submitEnv(e) {
    e.preventDefault(); 
    const btn = e.target.querySelector('button[type="submit"]'); 
    const originalHTML = toggleButtonLoading(btn, true);
    
    const id = document.getElementById('envProjId').value; 
    const content = document.getElementById('envContent').value;
    
    try {
        const res = await fetch(`/api/projects/env?id=${id}`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ content: content }) 
        });
        if (res.ok) { 
            closeEnvModal(); 
            showToast(".env saved securely!", "success"); 
        } else { 
            const err = await res.json(); 
            showToast(err.error, "error"); 
        }
    } catch (err) { 
        showToast("Server error.", "error"); 
    } finally { 
        toggleButtonLoading(btn, false, originalHTML); 
    }
}