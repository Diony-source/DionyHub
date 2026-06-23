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
        const isOutsideClick =  !e.target.closest('tr') && !e.target.closest('#bulk-actions-container') && !e.target.closest('.btn-action') && !e.target.closest('.tag-filter-btn') && !e.target.closest('.cursor-pointer') && !e.target.closest('#tagModal');
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
                    const actionObj = currentCmdActions[cmdSelectedIndex];
                    
                    // KRİTİK DÜZELTME: Seçilen eylem sadece bir prefix ise (örneğin '>start ' yazdıran rehber tuşu) menüyü kapatma
                    if (actionObj.isPrefix) {
                        actionObj.action();
                    } else {
                        // Gerçek bir eylem ise menüyü kapat ve işlemi çalıştır
                        closeCmdPalette();
                        actionObj.action();
                    }
                }
            }
        });
    }
});

window.addEventListener('resize', () => { setTimeout(refreshAllTerminalFits, 50); });