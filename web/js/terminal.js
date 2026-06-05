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
            searchInput.classList.remove('hidden'); searchInput.focus(); 
        } else { 
            searchInput.classList.add('hidden'); searchInput.value = ''; 
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
        term: term, fitAddon: fitAddon, searchAddon: searchAddon, container: wrapper, 
        currentLine: "", minimized: false, lastStatus: 'stopped'
    };
    terminalPool[id] = termInstance;

    fetch(`/api/projects/logs?id=${id}`)
        .then(res => {
            if(res.ok) return res.json();
            return { logs: "" };
        })
        .then(data => {
            if (data && data.logs) {
                term.write(data.logs);
            }
        })
        .catch(err => console.error("Failed to fetch historical logs:", err));

    term.attachCustomKeyEventHandler((e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f' && e.type === 'keydown') {
            e.preventDefault(); searchInput.classList.remove('hidden'); searchInput.focus(); return false;
        }
        return true;
    });

    searchInput.addEventListener('input', (e) => { 
        if(e.target.value) searchAddon.findNext(e.target.value, { decorations: true }); 
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
            if (e.shiftKey) searchAddon.findPrevious(e.target.value, { decorations: true }); 
            else searchAddon.findNext(e.target.value, { decorations: true }); 
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
                    fetch('/api/projects/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, data: payload }) }).catch(err => console.error(err));
                    termInstance.currentLine = ""; 
                } else if (code === 127 || code === 8) { 
                    if (termInstance.currentLine.length > 0) { 
                        termInstance.currentLine = termInstance.currentLine.slice(0, -1); term.write('\b \b'); 
                    }
                } else { 
                    termInstance.currentLine += char; term.write(char); 
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

function exportTerminalLogs(id, name) {
    const term = terminalPool[id].term; 
    term.selectAll(); 
    const text = term.getSelection(); 
    term.clearSelection();
    if (!text || text.trim() === "") { showToast("Terminal is empty.", "error"); return; }
    
    const blob = new Blob([text], { type: 'text/plain' }); 
    const url = URL.createObjectURL(blob); 
    const a = document.createElement('a');
    a.href = url; a.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_logs_${new Date().getTime()}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
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
            <div class="w-1.5 h-1.5 rounded-full ${dotColor}"></div><span class="truncate max-w-[120px] font-bold">${name}</span>
            <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                <button type="button" class="hover:text-indigo-400 transition-colors p-0.5 focus:outline-none" onclick="restoreTerminal('${id}'); event.stopPropagation();" title="Restore"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg></button>
                <button type="button" class="hover:text-rose-400 transition-colors p-0.5 focus:outline-none" onclick="closeTerminal('${id}'); event.stopPropagation();" title="Close"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>`;
        tab.ondragstart = (e) => { e.dataTransfer.setData('application/diony-min-term', id); tab.classList.add('opacity-50', 'dragging-tab'); };
        tab.ondragend = (e) => { tab.classList.remove('opacity-50', 'dragging-tab'); };
        tab.onclick = (e) => { if (e.target.closest('button')) return; restoreTerminal(id); };
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
    if (id === 'system') { minimizeTerminal(id, "DionyHub System Logs"); return; }
    if (termInstance.lastStatus === 'running') {
        if (!termInstance.minimized) {
            const p = cachedProjects.find(x => (x.id || x.ID) === id);
            const pName = p ? (p.name || p.Name) : id;
            minimizeTerminal(id, pName);
            showToast("Terminal kapatılamadı: Proje şu anda çalışıyor. Sekmeye küçültüldü.", "error");
        } else showToast("Terminal tamamen kapatılamadı. Lütfen önce projeyi durdurun.", "error");
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
    grid.style.display = 'flex'; grid.style.flexWrap = 'wrap'; grid.style.alignContent = 'stretch'; grid.style.alignItems = 'stretch'; grid.style.gap = '16px'; grid.style.overflowX = 'hidden'; grid.style.width = '100%'; grid.style.minWidth = '0';
    Object.keys(terminalPool).forEach(id => { if (terminalPool[id].minimized) terminalPool[id].container.style.display = 'none'; });

    if (maximizedTerminalId && terminalPool[maximizedTerminalId] && !terminalPool[maximizedTerminalId].minimized) {
        activeIds.forEach(id => { 
            const wrapper = terminalPool[id].container;
            if (id !== maximizedTerminalId) wrapper.style.display = 'none'; 
            else { wrapper.style.display = 'flex'; wrapper.style.flex = '1 1 100%'; wrapper.style.height = 'auto'; wrapper.style.minHeight = '250px'; wrapper.style.maxWidth = '100%'; }
        });
    } else {
        activeIds.forEach(id => {
            const wrapper = terminalPool[id].container;
            wrapper.style.display = 'flex'; wrapper.style.maxWidth = '100%'; 
            if (count === 1) wrapper.style.flex = '1 1 100%';
            else if (count <= 4) wrapper.style.flex = '1 1 calc(50% - 16px)';
            else wrapper.style.flex = '1 1 400px'; 
            wrapper.style.height = 'auto'; wrapper.style.minHeight = '200px'; 
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
    if (maximizedTerminalId === id) maximizedTerminalId = null; else maximizedTerminalId = id;
    updateGridCSS(); 
    if (maximizedTerminalId && !terminalPool[id].minimized) terminalPool[id].term.focus(); 
}

function clearAllTerminals() { 
    Object.values(terminalPool).forEach(instance => { instance.term.clear(); }); 
}