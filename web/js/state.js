let projectToDelete = null;
let currentTagFilter = null;
let draggedRow = null;
let availableTags = [];
let cachedProjects = [];

let globalWorkspace = "C:/DionyHub/apps";
let globalSavedTags = [];
let globalEnvText = ""; 

let selectedProjectIds = new Set();
let lastSelectedIdx = -1;
let activeSelectionSource = null; 

let tagToOrphan = null;
let tagsToOrphanBulk = [];

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