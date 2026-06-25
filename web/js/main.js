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

    // --- YENİ VİZYON: AKILLI ODAK DESTEKLİ KISAYOL HARİTASI ---
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

        // 1. Komut Paleti (VS Code: Ctrl+P veya Ctrl+K)
        if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) {
            e.preventDefault(); e.stopPropagation();
            toggleCmdPalette();
        }

        // 2. Ayarlar (VS Code: Ctrl+,)
        if (mod && e.key === ',') {
            e.preventDefault(); e.stopPropagation();
            switchView('settings');
            if (typeof showToast === 'function') showToast("Ayarlar Açıldı (Kısayol)", "success");
        }

        // 3. Explorer / Dashboard (VS Code: Ctrl+Shift+E)
        if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
            e.preventDefault(); e.stopPropagation();
            switchView('dashboard');
            if (typeof showToast === 'function') showToast("Kütüphane Açıldı (Kısayol)", "success");
        }

        // 4. AKILLI TERMINAL TAM EKRAN (Odak Tespitli)
        if (mod && (e.key === '`' || e.code === 'Backquote' || e.key === 'é' || e.key === '"' || e.key === '~')) {
            e.preventDefault(); e.stopPropagation();
            
            let targetId = 'system';
            
            // ADIM 1: İmleç (Focus) şu an bir terminalin içindeyse o terminali bul
            if (isXterm) {
                let parent = activeEl;
                let found = false;
                // DOM ağacında yukarı çıkarak içinde bulunduğumuz terminalin ID'sini tespit ediyoruz
                while (parent && parent !== document.body) {
                    if (parent.id && typeof terminalPool !== 'undefined') {
                        for (let pId in terminalPool) {
                            if (parent.id.includes(pId)) {
                                targetId = pId;
                                found = true;
                                break;
                            }
                        }
                    }
                    if (found) break;
                    parent = parent.parentElement;
                }
            } 
            // ADIM 2: İmleç terminalde değil ama tabloda 1 tane proje MAVİ olarak seçiliyse onu bul
            else if (typeof selectedProjectIds !== 'undefined' && selectedProjectIds.size === 1) {
                targetId = Array.from(selectedProjectIds)[0];
            }

            // Hangi terminali bulduysak (veya bulamadıysak System) onu tam ekran yap
            if (typeof toggleMaximizeTerminal === 'function') toggleMaximizeTerminal(targetId);
        }

        // 5. Seçili Projeleri Yeniden Başlat (VS Code: Ctrl+Shift+R)
        if (mod && e.shiftKey && e.key.toLowerCase() === 'r') {
            e.preventDefault(); e.stopPropagation();
            if (selectedProjectIds.size > 0) {
                Array.from(selectedProjectIds).forEach(id => {
                    const p = cachedProjects.find(x => (x.id || x.ID) === id);
                    if (p) restartProject(id, p.name || p.Name, null);
                });
            } else {
                if (typeof showToast === 'function') showToast("Yeniden başlatmak için tablodan bir proje seçin", "error");
            }
        }

        // 6. Terminal Temizle (VS Code: Ctrl+L)
        if (mod && e.key.toLowerCase() === 'l') {
            e.preventDefault(); e.stopPropagation();
            if (typeof clearAllTerminals === 'function') clearAllTerminals();
            if (typeof showToast === 'function') showToast("Terminaller temizlendi (Kısayol)", "success");
        }

        // Escape
        if (e.key === 'Escape') {
            closeCmdPalette();
            hideContextMenu();
            const modals = ['addModal', 'editModal', 'deleteModal', 'bulkDeleteModal', 'tagModal', 'customConfirmModal'];
            modals.forEach(m => {
                const el = document.getElementById(m);
                if (el && !el.classList.contains('hidden') && el.style.display !== 'none') {
                    if (m === 'customConfirmModal') {
                        const cancelBtn = document.getElementById('btnCancelConfirm');
                        if (cancelBtn) cancelBtn.click();
                    } else {
                        el.classList.add('hidden');
                        el.classList.remove('flex');
                    }
                }
            });
        }
    }, { capture: true }); 

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
                    if (actionObj.isPrefix) {
                        actionObj.action();
                    } else {
                        closeCmdPalette();
                        actionObj.action();
                    }
                }
            }
        });
    }
});

window.addEventListener('resize', () => { setTimeout(refreshAllTerminalFits, 50); });