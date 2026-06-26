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
            e.preventDefault(); e.stopPropagation(); 
            const draggingTab = document.querySelector('.dragging-tab');
            if (!draggingTab) return;
            const afterElement = getDragAfterElement(tabsContainer, e.clientX);
            if (afterElement == null) { tabsContainer.appendChild(draggingTab); } 
            else { tabsContainer.insertBefore(draggingTab, afterElement); }
        });
        tabsContainer.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    if (terminalPane) {
        terminalPane.addEventListener('dragover', (e) => { e.preventDefault(); if (e.target.closest('#minimized-tabs-container')) return; terminalPane.classList.add('ring-2', 'ring-indigo-500/50'); });
        terminalPane.addEventListener('dragleave', (e) => { terminalPane.classList.remove('ring-2', 'ring-indigo-500/50'); });
        terminalPane.addEventListener('drop', (e) => { e.preventDefault(); terminalPane.classList.remove('ring-2', 'ring-indigo-500/50'); if (e.target.closest('#minimized-tabs-container')) return; const minId = e.dataTransfer.getData('application/diony-min-term'); if (minId && terminalPool[minId] && terminalPool[minId].minimized) { restoreTerminal(minId); } });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#contextMenu')) hideContextMenu();
        if (e.target.id === 'cmdPalette') closeCmdPalette();
        const isOutsideClick =  !e.target.closest('tr') && !e.target.closest('#bulk-actions-container') && !e.target.closest('.btn-action') && !e.target.closest('.tag-filter-btn') && !e.target.closest('.cursor-pointer') && !e.target.closest('#tagModal');
       if (isOutsideClick && selectedProjectIds.size > 0) { selectedProjectIds.clear(); activeSelectionSource = null; applySelectionStyles(); updateBulkActionBar(cachedProjects.length); }
    });

    document.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const mod = isMac ? e.metaKey : e.ctrlKey;

        const activeEl = document.activeElement;
        const activeTag = activeEl ? activeEl.tagName : '';
        const isXterm = activeEl && (activeEl.classList.contains('xterm-helper-textarea') || activeEl.closest('.xterm') !== null);
        const isCmdInput = activeEl && activeEl.id === 'cmdInput';

        const isFormTyping = !isXterm && !isCmdInput && (activeTag === 'INPUT' || activeTag === 'TEXTAREA');

        if (isFormTyping) {
            if (e.key === 'Escape') activeEl.blur(); 
            return; 
        }

        // --- YENİ VİZYON: MAC/WIN WORKSPACE KAYDIRMA (Ctrl+Alt+Sol/Sağ) ---
        if (mod && e.altKey && e.key === 'ArrowRight') {
            e.preventDefault(); e.stopPropagation();
            if (typeof cycleWorkspace === 'function') cycleWorkspace(1);
        }
        if (mod && e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault(); e.stopPropagation();
            if (typeof cycleWorkspace === 'function') cycleWorkspace(-1);
        }

        // --- YENİ VİZYON: WINDOWS TASK VIEW HİSSİYATI (Alt+W) ---
        if (e.altKey && e.code === 'KeyW') {
            e.preventDefault(); e.stopPropagation();
            if (typeof toggleWorkspaceSwitcher === 'function') toggleWorkspaceSwitcher();
        }

        if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) { e.preventDefault(); e.stopPropagation(); toggleCmdPalette(); }
        if (mod && e.key === ',') { e.preventDefault(); e.stopPropagation(); switchView('settings'); }
        if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); e.stopPropagation(); switchView('dashboard'); }

        if (mod && (e.key === '`' || e.code === 'Backquote' || e.key === 'é' || e.key === '"' || e.key === '~')) {
            e.preventDefault(); e.stopPropagation();
            let targetId = 'system';
            if (isXterm) {
                let parent = activeEl; let found = false;
                while (parent && parent !== document.body) {
                    if (parent.id && typeof terminalPool !== 'undefined') { for (let pId in terminalPool) { if (parent.id.includes(pId)) { targetId = pId; found = true; break; } } }
                    if (found) break; parent = parent.parentElement;
                }
            } else if (typeof selectedProjectIds !== 'undefined' && selectedProjectIds.size === 1) { targetId = Array.from(selectedProjectIds)[0]; }
            if (typeof toggleMaximizeTerminal === 'function') toggleMaximizeTerminal(targetId);
        }

        if (mod && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); e.stopPropagation(); if (selectedProjectIds.size > 0) { Array.from(selectedProjectIds).forEach(id => { const p = cachedProjects.find(x => (x.id || x.ID) === id); if (p) restartProject(id, p.name || p.Name, null); }); } }
        if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); e.stopPropagation(); if (typeof clearAllTerminals === 'function') clearAllTerminals(); }

        if (e.key === 'Escape') {
            closeCmdPalette(); hideContextMenu();
            if (typeof closeWorkspaceSwitcher === 'function') closeWorkspaceSwitcher();
            const modals = ['addModal', 'editModal', 'deleteModal', 'bulkDeleteModal', 'tagModal', 'customConfirmModal'];
            modals.forEach(m => { const el = document.getElementById(m); if (el && !el.classList.contains('hidden') && el.style.display !== 'none') { if (m === 'customConfirmModal') { const cancelBtn = document.getElementById('btnCancelConfirm'); if (cancelBtn) cancelBtn.click(); } else { el.classList.add('hidden'); el.classList.remove('flex'); } } });
        }
    }, { capture: true }); 

    const cmdInput = document.getElementById('cmdInput');
    if (cmdInput) {
        cmdInput.addEventListener('input', handleCmdSearch);
        cmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (currentCmdActions.length > 0) { cmdSelectedIndex = (cmdSelectedIndex + 1) % currentCmdActions.length; updateCmdSelection(); } } 
            else if (e.key === 'ArrowUp') { e.preventDefault(); if (currentCmdActions.length > 0) { cmdSelectedIndex = (cmdSelectedIndex - 1 + currentCmdActions.length) % currentCmdActions.length; updateCmdSelection(); } } 
            else if (e.key === 'Enter') { e.preventDefault(); if (currentCmdActions[cmdSelectedIndex]) { const actionObj = currentCmdActions[cmdSelectedIndex]; if (actionObj.isPrefix) { actionObj.action(); } else { closeCmdPalette(); actionObj.action(); } } }
        });
    }
});

window.addEventListener('resize', () => { setTimeout(refreshAllTerminalFits, 50); });