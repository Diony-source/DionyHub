async function loadProjects() {
    try {
        const response = await fetch('/api/projects'); if (!response.ok) throw new Error("API error");
        cachedProjects = await response.json(); renderSidebarTags(cachedProjects); renderProjects();
    } catch (e) { console.error("Projeler yüklenemedi:", e); }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            globalWorkspace = settings.workspace || 'C:/DionyHub/apps';
            document.getElementById('setting-workspace').value = globalWorkspace;
            if (settings.global_env) { document.getElementById('setting-global-env').value = settings.global_env; globalEnvText = settings.global_env; } else globalEnvText = "";
            globalSavedTags = settings.saved_tags || [];
            toggleWorkspaceMode(); 
        }
    } catch (e) { console.error("Settings load error", e); }
}

async function saveSettings() {
    const btn = document.getElementById('save-settings-btn'); const originalHTML = toggleButtonLoading(btn, true);
    globalWorkspace = document.getElementById('setting-workspace').value;
    const globalEnv = document.getElementById('setting-global-env').value; globalEnvText = globalEnv; 
    try {
        const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: globalWorkspace, log_buffer: false, global_env: globalEnv }) });
        if (response.ok) { showToast("System settings applied.", "success"); toggleWorkspaceMode(); } 
        else { const err = await response.json(); showToast(err.error, "error"); }
    } catch (e) { showToast("Server error.", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function triggerSmartDetection(fullPath, isEdit = false) {
    if (!fullPath) return;

    const useWsCb = document.getElementById('useWorkspace');
    if (useWsCb && useWsCb.checked && !isEdit) {
        const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/');
        fullPath = formattedWs + fullPath;
    }

    showToast("Dedektif klasörü analiz ediyor...", "success");

    try {
        const res = await fetch(`/api/projects/detect?path=${encodeURIComponent(fullPath)}`);
        if (res.ok) {
            const data = await res.json();
            
            if (data.detected) {
                const cmdInputId = isEdit ? 'editProjCmd' : 'projCmd';
                const tagInputId = isEdit ? 'editProjTag' : 'projTag';

                const cmdInput = document.getElementById(cmdInputId);
                const tagInput = document.getElementById(tagInputId);

                if (cmdInput && cmdInput.value.trim() === "") cmdInput.value = data.command;
                if (tagInput && tagInput.value.trim() === "") tagInput.value = data.language;

                if (data.has_env && !isEdit) {
                    const customCb = document.getElementById('addEnvCustom');
                    if (customCb && !customCb.checked) {
                        customCb.checked = true;
                        if (typeof toggleAddEnvMode === 'function') toggleAddEnvMode('custom');
                    }
                    showToast(`Dedektif: ${data.language} projesi ve .env dosyası algıladı!`, "success");
                } else {
                    showToast(`Dedektif: ${data.language} projesi algıladı!`, "success");
                }
            } else {
                showToast("Dedektif: Bu klasörde tanıdık bir proje bulunamadı.", "error");
            }
        }
    } catch (err) {
        console.error("Smart detective failed to scan path:", err);
        showToast("Dedektif motoru klasörü tararken hata verdi.", "error");
    }
}

async function browseFolder(inputId, handleWorkspace = true) {
    try {
        const res = await fetch('/api/system/browse'); const data = await res.json();
        if (data.path && data.path !== "") {
            document.getElementById(inputId).value = data.path;
            if (handleWorkspace) { const wsCheckbox = document.getElementById('useWorkspace'); if (wsCheckbox.checked) { wsCheckbox.checked = false; toggleWorkspaceMode(); } }
            
            if (inputId === 'projPath' || inputId === 'editProjPath') {
                triggerSmartDetection(data.path, inputId === 'editProjPath');
            }
        }
    } catch (e) { showToast("Failed to open native folder picker.", "error"); }
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
});

async function submitNewProject(e) {
    e.preventDefault(); 
    const btn = e.target.querySelector('button[type="submit"]'); 
    const sourceMode = document.querySelector('input[name="sourceMode"]:checked').value;
    const originalHTML = toggleButtonLoading(btn, true, sourceMode === 'github' ? 'Cloning Repo...' : '');
    
    const globalCb = document.getElementById('addEnvGlobal'); const customCb = document.getElementById('addEnvCustom');
    let finalEnv = ""; let createEnv = true;
    
    if (globalCb && globalCb.checked) { finalEnv = globalEnvText; } else if (customCb && customCb.checked) { finalEnv = document.getElementById('projInitialEnv').value; } else { finalEnv = ""; createEnv = false; }
    const clearOnStart = document.getElementById('projClearOnStart') ? document.getElementById('projClearOnStart').checked : false;

    try {
        if (sourceMode === 'local') {
            let finalPath = document.getElementById('projPath').value.trim(); const useWs = document.getElementById('useWorkspace').checked;
            if (useWs) { const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/'); finalPath = formattedWs + finalPath; }
            
            const data = { 
                name: document.getElementById('projName').value, path: finalPath, command: document.getElementById('projCmd').value, tag: document.getElementById('projTag').value, 
                interactive: document.getElementById('projInteractive').checked, auto_start: document.getElementById('projAutoStart').checked, auto_restart: document.getElementById('projAutoRestart').checked, auto_close: document.getElementById('projAutoClose').checked, clear_on_start: clearOnStart, initial_env: finalEnv, create_env: createEnv
            };
            const res = await fetch('/api/projects/add', { method: 'POST', body: JSON.stringify(data) });
            if (res.ok) { closeModal(); loadProjects(); showToast("Workspace created!", "success"); } else { const err = await res.json(); showToast(err.error, "error"); }
        } else {
            const data = { 
                repo_url: document.getElementById('repoUrl').value, command: document.getElementById('projCmd').value, tag: document.getElementById('projTag').value, 
                interactive: document.getElementById('projInteractive').checked, auto_start: document.getElementById('projAutoStart').checked, auto_restart: document.getElementById('projAutoRestart').checked, auto_close: document.getElementById('projAutoClose').checked, clear_on_start: clearOnStart, initial_env: finalEnv, create_env: createEnv
            };
            const res = await fetch('/api/projects/clone', { method: 'POST', body: JSON.stringify(data) });
            if (res.ok) { closeModal(); loadProjects(); showToast("Repo cloned!", "success"); } else { const err = await res.json(); showToast(err.error, "error"); }
        }
    } catch (err) { showToast("Connection failed.", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function submitEditProject(event) {
    event.preventDefault(); 
    const btn = event.target.querySelector('button[type="submit"]'); const originalHTML = toggleButtonLoading(btn, true);
    const globalCb = document.getElementById('editEnvGlobal'); const customCb = document.getElementById('editEnvCustom');

    let finalEnv = ""; let createEnv = true; let deleteEnv = false;

    if (globalCb && globalCb.checked) { finalEnv = globalEnvText; } 
    else if (customCb && customCb.checked) { finalEnv = document.getElementById('editProjInitialEnv').value; } 
    else { finalEnv = ""; createEnv = false; deleteEnv = true; }

    const updatedProject = { 
        id: document.getElementById('editProjId').value, name: document.getElementById('editProjName').value, path: document.getElementById('editProjPath').value, command: document.getElementById('editProjCmd').value, 
        tag: document.getElementById('editProjTag').value, interactive: document.getElementById('editProjInteractive').checked, auto_start: document.getElementById('editProjAutoStart').checked, auto_restart: document.getElementById('editProjAutoRestart').checked, 
        auto_close: document.getElementById('editProjAutoClose').checked, clear_on_start: document.getElementById('editProjClearOnStart').checked, initial_env: finalEnv, create_env: createEnv, delete_env: deleteEnv
    };
    
    try {
        const response = await fetch('/api/projects/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedProject) });
        if (response.ok) { closeEditModal(); loadProjects(); showToast("Project settings & environment updated successfully!", "success"); } 
        else { const err = await response.json(); showToast(err.error, "error"); }
    } catch (e) { showToast("Server error", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function executeDelete() { 
    const btn = document.getElementById('confirmDeleteBtn'); const originalHTML = toggleButtonLoading(btn, true); 
    const diskCb = document.getElementById('deleteFilesFromDisk'); const deleteFiles = diskCb ? diskCb.checked : false;
    const deleteTagCheckbox = document.getElementById('deleteOrphanedTag'); const tagContainer = document.getElementById('deleteTagContainer'); const shouldDeleteTag = deleteTagCheckbox && tagContainer && !tagContainer.classList.contains('hidden') && deleteTagCheckbox.checked;
    
    try {
        const res = await fetch(`/api/projects/delete?id=${projectToDelete}&remove_files=${deleteFiles}`, { method: 'DELETE' }); 
        if(res.ok) { 
            if (shouldDeleteTag && tagToOrphan) {
                await fetch('/api/tags/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ original_tag: tagToOrphan, new_tag: "", project_ids: [] }) });
                if (currentTagFilter === tagToOrphan) currentTagFilter = null; await loadSettings();
            }
            closeDeleteModal(); selectedProjectIds.delete(projectToDelete); loadProjects(); 
            if (deleteFiles) showToast("Files deleted", "success"); else showToast("Project removed", "success"); 
        } else { const data = await res.json(); showToast(data.error, "error"); closeDeleteModal(); }
    } catch (err) { showToast("Failed to delete", "error"); closeDeleteModal(); } finally { 
        toggleButtonLoading(btn, false, originalHTML); if (diskCb) diskCb.checked = false; if (deleteTagCheckbox) deleteTagCheckbox.checked = false;
    }
}

async function executeBulkDelete() {
    let idsToProcess = [];
    if (selectedProjectIds.size > 0) idsToProcess = Array.from(selectedProjectIds);
    else if (currentTagFilter) idsToProcess = cachedProjects.filter(p => p.tag && p.tag.split(',').map(t => t.trim().toLowerCase()).includes(currentTagFilter.toLowerCase())).map(p => p.id || p.ID);
    if (idsToProcess.length === 0) return;

    const diskCb = document.getElementById('bulkDeleteFilesFromDisk'); const deleteFiles = diskCb ? diskCb.checked : false;
    const tagCheckbox = document.getElementById('bulkDeleteOrphanedTags'); const tagContainer = document.getElementById('bulkDeleteTagContainer'); const shouldDeleteTags = tagCheckbox && tagContainer && !tagContainer.classList.contains('hidden') && tagCheckbox.checked;

    const btn = document.getElementById('confirmBulkDeleteBtn'); const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch('/api/projects/delete-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToProcess, remove_files: deleteFiles }) });
        if(res.ok) {
            if (shouldDeleteTags && tagsToOrphanBulk.length > 0) {
                for (const t of tagsToOrphanBulk) { await fetch('/api/tags/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ original_tag: t, new_tag: "", project_ids: [] }) }); if (currentTagFilter === t) currentTagFilter = null; }
                await loadSettings();
            }
            closeBulkDeleteModal(); selectedProjectIds.clear(); loadProjects(); showToast("Projeler başarıyla silindi", "success");
        } else { const data = await res.json(); showToast(data.error, "error"); closeBulkDeleteModal(); }
    } catch (err) { showToast("Bağlantı hatası", "error"); closeBulkDeleteModal(); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function executeBulkAction(action) {
    let idsToProcess = [];
    if (selectedProjectIds.size > 0) { idsToProcess = Array.from(selectedProjectIds); } 
    else if (currentTagFilter) { idsToProcess = cachedProjects.filter(p => p.tag && p.tag.split(',').map(t => t.trim().toLowerCase()).includes(currentTagFilter.toLowerCase())).map(p => p.id || p.ID); }
    if (idsToProcess.length === 0) return;

    const endpoint = action === 'start' ? '/api/projects/start-bulk' : '/api/projects/stop-bulk';
    const actionText = action === 'start' ? 'Başlatılıyor...' : 'Durduruluyor...';
    showToast(`${idsToProcess.length} proje ${actionText}`, "success");
    
    try {
        if (action === 'start') { idsToProcess.forEach(id => { const p = cachedProjects.find(x => (x.id || x.ID) === id); if (p) getOrCreateTerminal(id, p.name || p.Name); }); }
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(idsToProcess) });
        if (res.ok) { const data = await res.json(); showToast(data.message || "İşlem başarılı", "success"); } 
        else { const err = await res.json(); showToast(err.error || "İşlem başarısız", "error"); }
    } catch (e) { showToast("Bağlantı hatası", "error"); }
}

async function saveNewOrder() {
    const localBody = document.getElementById('local-project-list'); const githubBody = document.getElementById('github-project-list');
    const localIDs = localBody ? Array.from(localBody.children).map(tr => tr.dataset.id).filter(id => id) : [];
    const githubIDs = githubBody ? Array.from(githubBody.children).map(tr => tr.dataset.id).filter(id => id) : [];
    const newOrderIDs = [...localIDs, ...githubIDs];
    try {
        const res = await fetch('/api/projects/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newOrderIDs) });
        if(!res.ok) { showToast("Failed to save new order", "error"); loadProjects(); }
    } catch(e) { showToast("Network error", "error"); }
}

// --- GÜNCELLENDİ: PRE-FLIGHT (424) VE PORT (409) YAKALAYICISI EKLENDİ ---
async function startProject(id, name, btn, force = false) { 
    getOrCreateTerminal(id, name); 
    const originalHTML = toggleButtonLoading(btn, true);
    
    try {
        const url = force ? `/api/projects/start?id=${id}&force=true` : `/api/projects/start?id=${id}`;
        const res = await fetch(url, { method: 'POST' }); 
        
        if (!res.ok) { 
            const data = await res.json(); 
            if (res.status === 409 && data.error === "port_conflict") {
                if (typeof showPortConflictModal === 'function') {
                    showPortConflictModal(data.port, data.process_name, data.pid, id, name, btn);
                } else {
                    showToast(`Port ${data.port} çakışması!`, "error");
                }
            } else if (res.status === 424 && data.error === "missing_dependency") {
                if (typeof showMissingDependencyModal === 'function') {
                    showMissingDependencyModal(data.binary);
                } else {
                    showToast(`Sistemde '${data.binary}' yüklü değil!`, "error");
                }
            } else {
                showToast(data.error || "Failed to start", "error"); 
            }
        } 
        else { showToast("Project started", "success"); }
    } catch (e) { 
        showToast("Network error", "error"); 
    } finally { 
        if (!force) toggleButtonLoading(btn, false, originalHTML); 
    }
}

async function restartProject(id, name, btn) {
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        showToast("Restart sequence initiated...", "success"); await fetch(`/api/projects/stop?id=${id}`, { method: 'POST' });
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const res = await fetch(`/api/projects/start?id=${id}`, { method: 'POST' }); 
        if (!res.ok) { 
            const data = await res.json();
            if (res.status === 424 && data.error === "missing_dependency") {
                if (typeof showMissingDependencyModal === 'function') showMissingDependencyModal(data.binary);
            } else {
                showToast(data.error || "Failed to restart", "error"); 
            }
        } else { 
            showToast("Project restarted successfully", "success"); 
            getOrCreateTerminal(id, name); 
        }
    } catch (e) { showToast("Network error during restart", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function stopProject(id, btn) { 
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/stop?id=${id}`, { method: 'POST' }); 
        if (!res.ok) { const data = await res.json(); if (!data.error.includes("not currently running")) { showToast(data.error || "Failed to stop", "error"); } } 
        else { showToast("Project stopped", "success"); }
    } catch (e) { showToast("Network error", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function backupProject(id, btn) {
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/backup?id=${id}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) { showToast(data.message, "success"); } else { showToast(data.error || "Backup failed", "error"); }
    } catch (e) { showToast("Network error during backup", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function submitTag(e) {
    e.preventDefault(); const btn = e.target.querySelector('button[type="submit"]'); const originalHTML = toggleButtonLoading(btn, true);
    const originalTag = document.getElementById('tagOriginalName').value; const newTag = document.getElementById('tagNewName').value;
    const projectIds = Array.from(document.querySelectorAll('input[name="tagProjectIds"]:checked')).map(cb => cb.value);

    try {
        const res = await fetch('/api/tags/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ original_tag: originalTag, new_tag: newTag, project_ids: projectIds }) });
        if (res.ok) { closeTagModal(); if (currentTagFilter === originalTag) currentTagFilter = newTag || null; await loadSettings(); await loadProjects(); showToast("Tag configured successfully", "success"); } 
        else { const err = await res.json(); showToast(err.error || "Failed to configure tag", "error"); }
    } catch (err) { showToast("Network error", "error"); } finally { toggleButtonLoading(btn, false, originalHTML); }
}

async function deleteTag() {
    const originalTag = document.getElementById('tagOriginalName').value; if (!originalTag) return;
    try {
        const res = await fetch('/api/tags/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ original_tag: originalTag, new_tag: "", project_ids: [] }) });
        if (res.ok) { closeTagModal(); if (currentTagFilter === originalTag) currentTagFilter = null; await loadSettings(); await loadProjects(); showToast("Tag deleted", "success"); } 
        else { const err = await res.json(); showToast(err.error || "Failed to delete tag", "error"); }
    } catch (err) { showToast("Network error", "error"); }
}