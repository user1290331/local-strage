// LocalStorage Manager Extension - localStorage 값 편집기
import { renderExtensionTemplateAsync } from "../../../extensions.js";
import { POPUP_RESULT, POPUP_TYPE, Popup } from "../../../popup.js";

const extensionName = "SillyTavern-LocalStorageManager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 현재 선택된 키
let selectedKey = null;
// 편집 모드 ('tree' | 'raw')
let editMode = 'tree';
// 검색 필터
let searchFilter = '';
// JSON 에디터 상태
let jsonEditorData = null;
// 카테고리 접힘 상태 저장
let collapsedCategories = new Set();

/**
 * localStorage 키 목록 가져오기
 */
function getLocalStorageKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        keys.push(localStorage.key(i));
    }
    return keys.sort();
}

/**
 * localStorage 값 가져오기
 */
function getLocalStorageValue(key) {
    try {
        const value = localStorage.getItem(key);
        return JSON.parse(value);
    } catch (e) {
        return localStorage.getItem(key);
    }
}

/**
 * localStorage 값 설정
 */
function setLocalStorageValue(key, value) {
    try {
        if (typeof value === 'object') {
            localStorage.setItem(key, JSON.stringify(value));
        } else {
            localStorage.setItem(key, value);
        }
        return true;
    } catch (e) {
        console.error('[LocalStorage Manager] 저장 실패:', e);
        return false;
    }
}

/**
 * 값의 타입에 따른 아이콘 반환
 */
function getTypeIcon(value) {
    if (value === null) return '⊘';
    if (Array.isArray(value)) return '[]';
    switch (typeof value) {
        case 'object': return '{}';
        case 'string': return '"';
        case 'number': return '#';
        case 'boolean': return '◉';
        default: return '?';
    }
}

/**
 * 값의 타입 반환
 */
function getValueType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/**
 * JSON 트리 HTML 생성 (재귀)
 */
function renderJsonTree(data, path = '', depth = 0) {
    if (data === null || data === undefined) {
        return `<span class="lsm-value lsm-null" data-path="${path}">null</span>`;
    }

    const type = getValueType(data);
    
    if (type === 'object' || type === 'array') {
        const isArray = type === 'array';
        const entries = isArray ? data.map((v, i) => [i, v]) : Object.entries(data);
        const bracket = isArray ? ['[', ']'] : ['{', '}'];
        
        if (entries.length === 0) {
            return `<span class="lsm-bracket">${bracket[0]}${bracket[1]}</span>`;
        }
        
        let html = `<span class="lsm-collapsible" data-path="${path}">`;
        html += `<span class="lsm-toggle">▼</span>`;
        html += `<span class="lsm-bracket">${bracket[0]}</span>`;
        html += `<span class="lsm-count">${entries.length} items</span>`;
        html += `</span>`;
        html += `<div class="lsm-tree-content" data-path="${path}">`;
        
        entries.forEach(([key, value], index) => {
            const newPath = path ? `${path}.${key}` : String(key);
            const comma = index < entries.length - 1 ? ',' : '';
            
            html += `<div class="lsm-tree-row" data-depth="${depth + 1}">`;
            html += `<span class="lsm-key" data-path="${newPath}">${isArray ? `[${key}]` : `"${key}"`}</span>`;
            html += `<span class="lsm-colon">:</span>`;
            html += renderJsonTree(value, newPath, depth + 1);
            html += `<span class="lsm-comma">${comma}</span>`;
            html += `<span class="lsm-actions">`;
            html += `<button class="lsm-edit-btn" data-path="${newPath}" title="편집">✏️</button>`;
            html += `<button class="lsm-delete-btn" data-path="${newPath}" title="삭제">🗑️</button>`;
            html += `</span>`;
            html += `</div>`;
        });
        
        html += `</div>`;
        html += `<span class="lsm-bracket">${bracket[1]}</span>`;
        
        // 객체/배열에 항목 추가 버튼
        html += `<button class="lsm-add-btn" data-path="${path}" data-type="${type}" title="항목 추가">➕</button>`;
        
        return html;
    }
    
    // 프리미티브 값
    let valueClass = `lsm-value lsm-${type}`;
    let displayValue = type === 'string' ? `"${escapeHtml(String(data))}"` : String(data);
    
    return `<span class="${valueClass}" data-path="${path}" data-raw="${escapeHtml(JSON.stringify(data))}">${displayValue}</span>`;
}

/**
 * HTML 이스케이프
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 경로로 값 가져오기
 */
function getValueByPath(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * 경로로 값 설정
 */
function setValueByPath(obj, path, value) {
    if (!path) return value;
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return obj;
}

/**
 * 경로로 값 삭제
 */
function deleteValueByPath(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined) return obj;
        current = current[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    if (Array.isArray(current)) {
        current.splice(parseInt(lastKey), 1);
    } else {
        delete current[lastKey];
    }
    return obj;
}

/**
 * 키를 카테고리로 그룹화
 */
function groupKeysByCategory(keys) {
    const groups = {};
    const standalone = [];
    
    // 구분자 패턴: _, -, .
    const separators = /[_\-\.]/;
    
    keys.forEach(key => {
        const match = key.match(separators);
        if (match) {
            const separatorIndex = key.indexOf(match[0]);
            const prefix = key.substring(0, separatorIndex);
            const suffix = key.substring(separatorIndex + 1);
            
            // 접두사가 2글자 이상이고, 같은 접두사를 가진 키가 2개 이상인 경우만 그룹화
            if (prefix.length >= 2) {
                if (!groups[prefix]) {
                    groups[prefix] = [];
                }
                groups[prefix].push({ key, suffix, fullKey: key });
            } else {
                standalone.push(key);
            }
        } else {
            standalone.push(key);
        }
    });
    
    // 그룹이 1개만 있으면 standalone으로 이동
    Object.keys(groups).forEach(prefix => {
        if (groups[prefix].length < 2) {
            groups[prefix].forEach(item => standalone.push(item.fullKey));
            delete groups[prefix];
        }
    });
    
    return { groups, standalone: standalone.sort() };
}

/**
 * 키 목록 렌더링
 */
function renderKeyList() {
    const container = document.getElementById('lsm-key-list');
    if (!container) return;
    
    const keys = getLocalStorageKeys();
    const filteredKeys = searchFilter 
        ? keys.filter(k => k.toLowerCase().includes(searchFilter.toLowerCase()))
        : keys;
    
    const { groups, standalone } = groupKeysByCategory(filteredKeys);
    
    let html = '';
    
    // 그룹화된 키들 렌더링
    Object.keys(groups).sort().forEach(prefix => {
        const items = groups[prefix];
        const isCollapsed = collapsedCategories.has(prefix);
        html += `
            <div class="lsm-category ${isCollapsed ? 'collapsed' : ''}" data-prefix="${escapeHtml(prefix)}">
                <div class="lsm-category-header">
                    <span class="lsm-category-toggle">${isCollapsed ? '▶' : '▼'}</span>
                    <span class="lsm-category-name">${escapeHtml(prefix)}</span>
                    <span class="lsm-category-count">${items.length}</span>
                </div>
                <div class="lsm-category-items">
        `;
        
        items.forEach(item => {
            const isSelected = item.fullKey === selectedKey;
            const value = localStorage.getItem(item.fullKey);
            let typeIcon = '"';
            try {
                const parsed = JSON.parse(value);
                typeIcon = getTypeIcon(parsed);
            } catch {}
            
            html += `
                <div class="lsm-key-item ${isSelected ? 'selected' : ''}" data-key="${escapeHtml(item.fullKey)}">
                    <span class="lsm-type-badge">${typeIcon}</span>
                    <span class="lsm-key-name" title="${escapeHtml(item.fullKey)}">${escapeHtml(item.suffix)}</span>
                    <span class="lsm-key-size">${formatBytes(value?.length || 0)}</span>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    // 단독 키들 렌더링
    standalone.forEach(key => {
        const isSelected = key === selectedKey;
        const value = localStorage.getItem(key);
        let typeIcon = '"';
        try {
            const parsed = JSON.parse(value);
            typeIcon = getTypeIcon(parsed);
        } catch {}
        
        html += `
            <div class="lsm-key-item ${isSelected ? 'selected' : ''}" data-key="${escapeHtml(key)}">
                <span class="lsm-type-badge">${typeIcon}</span>
                <span class="lsm-key-name" title="${escapeHtml(key)}">${escapeHtml(key)}</span>
                <span class="lsm-key-size">${formatBytes(value?.length || 0)}</span>
            </div>
        `;
    });
    
    container.innerHTML = html || '<div class="lsm-empty">항목이 없습니다</div>';
    
    // 카테고리 접기/펼치기 이벤트
    container.querySelectorAll('.lsm-category-header').forEach(header => {
        header.addEventListener('click', () => {
            const category = header.closest('.lsm-category');
            const prefix = category.dataset.prefix;
            const toggle = header.querySelector('.lsm-category-toggle');
            
            if (category.classList.contains('collapsed')) {
                category.classList.remove('collapsed');
                collapsedCategories.delete(prefix);
                toggle.textContent = '▼';
            } else {
                category.classList.add('collapsed');
                collapsedCategories.add(prefix);
                toggle.textContent = '▶';
            }
        });
    });
    
    // 키 선택 이벤트 바인딩
    container.querySelectorAll('.lsm-key-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedKey = item.dataset.key;
            renderKeyList();
            renderEditor();
            updateEditorTitle();
        });
    });
}

/**
 * 에디터 렌더링
 */
function renderEditor() {
    const container = document.getElementById('lsm-editor-content');
    if (!container) return;
    
    if (!selectedKey) {
        container.innerHTML = '<div class="lsm-empty">좌측에서 키를 선택하세요</div>';
        return;
    }
    
    const value = getLocalStorageValue(selectedKey);
    jsonEditorData = typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
    
    if (editMode === 'tree' && typeof value === 'object' && value !== null) {
        container.innerHTML = `
            <div class="lsm-tree-view">
                ${renderJsonTree(value)}
            </div>
        `;
        bindTreeEvents(container);
    } else {
        const rawValue = typeof value === 'object' 
            ? JSON.stringify(value, null, 2) 
            : String(value ?? '');
        container.innerHTML = `
            <textarea id="lsm-raw-editor" class="lsm-raw-editor" spellcheck="false">${escapeHtml(rawValue)}</textarea>
        `;
    }
}

/**
 * 트리 이벤트 바인딩
 */
function bindTreeEvents(container) {
    // 접기/펼치기
    container.querySelectorAll('.lsm-collapsible').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const path = el.dataset.path;
            const content = container.querySelector(`.lsm-tree-content[data-path="${path}"]`);
            const toggle = el.querySelector('.lsm-toggle');
            if (content) {
                content.classList.toggle('collapsed');
                toggle.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
            }
        });
    });
    
    // 편집 버튼
    container.querySelectorAll('.lsm-edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = btn.dataset.path;
            await editValueAtPath(path);
        });
    });
    
    // 삭제 버튼
    container.querySelectorAll('.lsm-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = btn.dataset.path;
            await deleteValueAtPath(path);
        });
    });
    
    // 추가 버튼
    container.querySelectorAll('.lsm-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = btn.dataset.path;
            const type = btn.dataset.type;
            await addValueAtPath(path, type);
        });
    });
}

/**
 * 경로의 값 편집
 */
async function editValueAtPath(path) {
    const currentValue = getValueByPath(jsonEditorData, path);
    const currentType = getValueType(currentValue);
    
    const popup = new Popup(`
        <div class="lsm-edit-popup">
            <h3>값 편집</h3>
            <div class="lsm-edit-field">
                <label>경로: <code>${path}</code></label>
            </div>
            <div class="lsm-edit-field">
                <label>타입:</label>
                <select id="lsm-edit-type">
                    <option value="string" ${currentType === 'string' ? 'selected' : ''}>문자열</option>
                    <option value="number" ${currentType === 'number' ? 'selected' : ''}>숫자</option>
                    <option value="boolean" ${currentType === 'boolean' ? 'selected' : ''}>불리언</option>
                    <option value="null" ${currentType === 'null' ? 'selected' : ''}>null</option>
                    <option value="object" ${currentType === 'object' ? 'selected' : ''}>객체</option>
                    <option value="array" ${currentType === 'array' ? 'selected' : ''}>배열</option>
                </select>
            </div>
            <div class="lsm-edit-field">
                <label>값:</label>
                <textarea id="lsm-edit-value" rows="5">${escapeHtml(JSON.stringify(currentValue, null, 2))}</textarea>
            </div>
        </div>
    `, POPUP_TYPE.CONFIRM);
    
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const typeSelect = document.getElementById('lsm-edit-type');
        const valueInput = document.getElementById('lsm-edit-value');
        
        let newValue;
        try {
            const rawValue = valueInput.value;
            const selectedType = typeSelect.value;
            
            switch (selectedType) {
                case 'string':
                    newValue = JSON.parse(rawValue);
                    if (typeof newValue !== 'string') newValue = String(rawValue);
                    break;
                case 'number':
                    newValue = Number(JSON.parse(rawValue));
                    break;
                case 'boolean':
                    newValue = JSON.parse(rawValue) === true;
                    break;
                case 'null':
                    newValue = null;
                    break;
                default:
                    newValue = JSON.parse(rawValue);
            }
            
            jsonEditorData = setValueByPath(jsonEditorData, path, newValue);
            setLocalStorageValue(selectedKey, jsonEditorData);
            renderEditor();
        } catch (e) {
            toastr.error('잘못된 JSON 형식입니다: ' + e.message);
        }
    }
}

/**
 * 경로의 값 삭제
 */
async function deleteValueAtPath(path) {
    const popup = new Popup(`
        <div class="lsm-confirm-popup">
            <h3>삭제 확인</h3>
            <p>경로 <code>${path}</code>의 값을 삭제하시겠습니까?</p>
        </div>
    `, POPUP_TYPE.CONFIRM);
    
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        jsonEditorData = deleteValueByPath(jsonEditorData, path);
        setLocalStorageValue(selectedKey, jsonEditorData);
        renderEditor();
        toastr.success('삭제되었습니다');
    }
}

/**
 * 경로에 값 추가
 */
async function addValueAtPath(path, parentType) {
    const isArray = parentType === 'array';
    
    const popup = new Popup(`
        <div class="lsm-edit-popup">
            <h3>항목 추가</h3>
            ${!isArray ? `
            <div class="lsm-edit-field">
                <label>키:</label>
                <input type="text" id="lsm-add-key" placeholder="새 키 이름" />
            </div>
            ` : ''}
            <div class="lsm-edit-field">
                <label>타입:</label>
                <select id="lsm-add-type">
                    <option value="string">문자열</option>
                    <option value="number">숫자</option>
                    <option value="boolean">불리언</option>
                    <option value="null">null</option>
                    <option value="object">객체</option>
                    <option value="array">배열</option>
                </select>
            </div>
            <div class="lsm-edit-field">
                <label>값:</label>
                <textarea id="lsm-add-value" rows="3">""</textarea>
            </div>
        </div>
    `, POPUP_TYPE.CONFIRM);
    
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        try {
            const typeSelect = document.getElementById('lsm-add-type');
            const valueInput = document.getElementById('lsm-add-value');
            const keyInput = document.getElementById('lsm-add-key');
            
            let newValue = JSON.parse(valueInput.value);
            const parent = path ? getValueByPath(jsonEditorData, path) : jsonEditorData;
            
            if (isArray) {
                parent.push(newValue);
            } else {
                const newKey = keyInput?.value?.trim();
                if (!newKey) {
                    toastr.error('키를 입력하세요');
                    return;
                }
                parent[newKey] = newValue;
            }
            
            setLocalStorageValue(selectedKey, jsonEditorData);
            renderEditor();
            toastr.success('추가되었습니다');
        } catch (e) {
            toastr.error('잘못된 JSON 형식입니다: ' + e.message);
        }
    }
}

/**
 * 바이트 포맷
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * 새 키 생성
 */
async function createNewKey() {
    const popup = new Popup(`
        <div class="lsm-edit-popup">
            <h3>새 localStorage 항목 생성</h3>
            <div class="lsm-edit-field">
                <label>키:</label>
                <input type="text" id="lsm-new-key" placeholder="키 이름" />
            </div>
            <div class="lsm-edit-field">
                <label>초기 값:</label>
                <textarea id="lsm-new-value" rows="3">{}</textarea>
            </div>
        </div>
    `, POPUP_TYPE.CONFIRM);
    
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const keyInput = document.getElementById('lsm-new-key');
        const valueInput = document.getElementById('lsm-new-value');
        
        const newKey = keyInput?.value?.trim();
        if (!newKey) {
            toastr.error('키를 입력하세요');
            return;
        }
        
        if (localStorage.getItem(newKey) !== null) {
            toastr.error('이미 존재하는 키입니다');
            return;
        }
        
        try {
            const value = JSON.parse(valueInput.value);
            setLocalStorageValue(newKey, value);
            selectedKey = newKey;
            renderKeyList();
            renderEditor();
            updateEditorTitle();
            toastr.success('생성되었습니다');
        } catch (e) {
            // JSON이 아닌 경우 문자열로 저장
            localStorage.setItem(newKey, valueInput.value);
            selectedKey = newKey;
            renderKeyList();
            renderEditor();
            updateEditorTitle();
            toastr.success('생성되었습니다');
        }
    }
}

/**
 * 키 삭제
 */
async function deleteSelectedKey() {
    if (!selectedKey) {
        toastr.warning('삭제할 키를 선택하세요');
        return;
    }
    
    const popup = new Popup(`
        <div class="lsm-confirm-popup">
            <h3>삭제 확인</h3>
            <p>키 <code>${selectedKey}</code>를 삭제하시겠습니까?</p>
            <p class="lsm-warning">⚠️ 이 작업은 되돌릴 수 없습니다!</p>
        </div>
    `, POPUP_TYPE.CONFIRM);
    
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        localStorage.removeItem(selectedKey);
        selectedKey = null;
        renderKeyList();
        renderEditor();
        updateEditorTitle();
        toastr.success('삭제되었습니다');
    }
}

/**
 * Raw 에디터 저장
 */
function saveRawEditor() {
    const textarea = document.getElementById('lsm-raw-editor');
    if (!textarea || !selectedKey) return;
    
    try {
        const value = JSON.parse(textarea.value);
        setLocalStorageValue(selectedKey, value);
        jsonEditorData = value;
        toastr.success('저장되었습니다');
    } catch (e) {
        // JSON이 아닌 경우 문자열로 저장
        localStorage.setItem(selectedKey, textarea.value);
        toastr.success('문자열로 저장되었습니다');
    }
}

/**
 * 키 값 복사
 */
function copySelectedValue() {
    if (!selectedKey) {
        toastr.warning('복사할 키를 선택하세요');
        return;
    }
    
    const value = localStorage.getItem(selectedKey);
    navigator.clipboard.writeText(value).then(() => {
        toastr.success('클립보드에 복사되었습니다');
    }).catch(err => {
        toastr.error('복사 실패: ' + err);
    });
}

/**
 * 전체 내보내기
 */
function exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        try {
            data[key] = JSON.parse(localStorage.getItem(key));
        } catch {
            data[key] = localStorage.getItem(key);
        }
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `localStorage_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('내보내기 완료');
}

/**
 * 가져오기
 */
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            const popup = new Popup(`
                <div class="lsm-confirm-popup">
                    <h3>가져오기 확인</h3>
                    <p>${Object.keys(data).length}개의 키를 가져옵니다.</p>
                    <p>기존 키가 있으면 덮어씁니다. 계속하시겠습니까?</p>
                </div>
            `, POPUP_TYPE.CONFIRM);
            
            const result = await popup.show();
            if (result === POPUP_RESULT.AFFIRMATIVE) {
                for (const [key, value] of Object.entries(data)) {
                    setLocalStorageValue(key, value);
                }
                renderKeyList();
                toastr.success('가져오기 완료');
            }
        } catch (e) {
            toastr.error('가져오기 실패: ' + e.message);
        }
    };
    input.click();
}

/**
 * 메인 패널 열기
 */
async function openManagerPanel() {
    const html = `
        <div class="lsm-container">
            <div class="lsm-header">
                <h2>🗄️ LocalStorage Manager</h2>
                <div class="lsm-header-actions">
                    <button id="lsm-export-btn" class="menu_button" title="전체 내보내기">📤 내보내기</button>
                    <button id="lsm-import-btn" class="menu_button" title="가져오기">📥 가져오기</button>
                    <button id="lsm-clear-all-btn" class="menu_button lsm-danger-btn" title="전체 삭제">🗑️ 전체 삭제</button>
                </div>
            </div>
            
            <div class="lsm-main">
                <div class="lsm-sidebar">
                    <div class="lsm-search">
                        <input type="text" id="lsm-search" placeholder="🔍 키 검색..." />
                    </div>
                    <div class="lsm-key-actions">
                        <button id="lsm-new-btn" class="menu_button">➕ 새 항목</button>
                        <button id="lsm-delete-btn" class="menu_button" title="선택 항목 삭제">🗑️</button>
                    </div>
                    <div id="lsm-key-list" class="lsm-key-list"></div>
                    <div class="lsm-stats">
                        <span id="lsm-total-keys">0</span>개 항목 | 
                        <span id="lsm-total-size">0 B</span>
                    </div>
                </div>
                
                <div class="lsm-editor">
                    <div class="lsm-editor-header">
                        <div class="lsm-editor-title">
                            <span id="lsm-current-key" class="lsm-editor-title-empty">좌측에서 키를 선택하세요</span>
                        </div>
                        <div class="lsm-editor-tabs">
                            <button id="lsm-tree-tab" class="lsm-tab active">🌳 트리</button>
                            <button id="lsm-raw-tab" class="lsm-tab">📝 Raw</button>
                        </div>
                        <div class="lsm-editor-actions">
                            <button id="lsm-copy-btn" class="menu_button" title="값 복사">📋</button>
                            <button id="lsm-save-btn" class="menu_button" title="저장 (Raw 모드)">💾 저장</button>
                        </div>
                    </div>
                    <div id="lsm-editor-content" class="lsm-editor-content">
                        <div class="lsm-empty">좌측에서 키를 선택하세요</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', { large: true, wide: true });
    
    // 팝업이 열린 후 이벤트 바인딩
    setTimeout(() => {
        // 검색
        document.getElementById('lsm-search')?.addEventListener('input', (e) => {
            searchFilter = e.target.value;
            renderKeyList();
        });
        
        // 버튼들
        document.getElementById('lsm-new-btn')?.addEventListener('click', createNewKey);
        document.getElementById('lsm-delete-btn')?.addEventListener('click', deleteSelectedKey);
        document.getElementById('lsm-copy-btn')?.addEventListener('click', copySelectedValue);
        document.getElementById('lsm-save-btn')?.addEventListener('click', saveRawEditor);
        document.getElementById('lsm-export-btn')?.addEventListener('click', exportAll);
        document.getElementById('lsm-import-btn')?.addEventListener('click', importData);
        document.getElementById('lsm-clear-all-btn')?.addEventListener('click', clearAllData);
        
        // 탭 전환
        document.getElementById('lsm-tree-tab')?.addEventListener('click', () => {
            editMode = 'tree';
            document.getElementById('lsm-tree-tab').classList.add('active');
            document.getElementById('lsm-raw-tab').classList.remove('active');
            renderEditor();
        });
        document.getElementById('lsm-raw-tab')?.addEventListener('click', () => {
            editMode = 'raw';
            document.getElementById('lsm-raw-tab').classList.add('active');
            document.getElementById('lsm-tree-tab').classList.remove('active');
            renderEditor();
        });
        
        // 초기 렌더링
        renderKeyList();
        updateStats();
        updateEditorTitle();
    }, 100);
    
    await popup.show();
}

/**
 * 에디터 제목 업데이트
 */
function updateEditorTitle() {
    const titleEl = document.getElementById('lsm-current-key');
    if (!titleEl) return;
    
    if (selectedKey) {
        titleEl.textContent = selectedKey;
        titleEl.className = 'lsm-editor-title-full';
    } else {
        titleEl.textContent = '좌측에서 키를 선택하세요';
        titleEl.className = 'lsm-editor-title-empty';
    }
}

/**
 * 통계 업데이트
 */
function updateStats() {
    const totalKeys = localStorage.length;
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        totalSize += (localStorage.getItem(key) || '').length;
    }
    
    const totalKeysEl = document.getElementById('lsm-total-keys');
    const totalSizeEl = document.getElementById('lsm-total-size');
    if (totalKeysEl) totalKeysEl.textContent = totalKeys;
    if (totalSizeEl) totalSizeEl.textContent = formatBytes(totalSize);
}

/**
 * 확장 설정 패널 HTML
 */
async function renderSettings() {
    const settingsContainer = document.getElementById('lsm_settings');
    if (!settingsContainer) return;
    
    settingsContainer.innerHTML = `
        <div class="lsm-settings">
            <p>localStorage에 저장된 데이터를 편집할 수 있는 에디터입니다.</p>
            <button id="lsm-open-manager" class="menu_button">
                🗄️ LocalStorage Manager 열기
            </button>
        </div>
    `;
    
    document.getElementById('lsm-open-manager')?.addEventListener('click', openManagerPanel);
}

/**
 * 전체 삭제
 */
async function clearAllData() {
    const totalKeys = localStorage.length;
    
    const popup = new Popup(`
        <div class="lsm-confirm-popup">
            <h3>⚠️ 전체 삭제</h3>
            <p><strong>${totalKeys}개</strong>의 모든 localStorage 항목을 삭제합니다.</p>
            <p class="lsm-warning">⚠️ 이 작업은 되돌릴 수 없습니다! 모든 확장 프로그램 설정이 초기화될 수 있습니다.</p>
            <p>계속하시려면 아래에 <code>DELETE</code>를 입력하세요:</p>
            <input type="text" id="lsm-confirm-delete" placeholder="DELETE 입력" style="width:100%;padding:8px;margin-top:8px;" />
        </div>
    `, POPUP_TYPE.CONFIRM);
    
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const confirmInput = document.getElementById('lsm-confirm-delete');
        if (confirmInput?.value === 'DELETE') {
            localStorage.clear();
            selectedKey = null;
            collapsedCategories.clear();
            renderKeyList();
            renderEditor();
            updateEditorTitle();
            updateStats();
            toastr.success('모든 항목이 삭제되었습니다');
        } else {
            toastr.warning('확인 텍스트가 일치하지 않습니다');
        }
    }
}

// jQuery 준비
jQuery(async () => {
    // 설정 패널 생성
    const settingsHtml = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>LocalStorage Manager</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
            </div>
            <div class="inline-drawer-content" id="lsm_settings">
            </div>
        </div>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    await renderSettings();
    
    // 마법봉 메뉴에 추가
    const wandButton = `
        <div id="lsm-wand-btn" class="list-group-item flex-container flexGap5" title="LocalStorage Manager">
            <i class="fa-solid fa-database"></i>
            <span>LocalStorage Manager</span>
        </div>
    `;
    $('#extensionsMenu').append(wandButton);
    $('#lsm-wand-btn').on('click', () => {
        $('#extensionsMenuButton').trigger('click'); // 메뉴 닫기
        openManagerPanel();
    });
    
    console.log('[LocalStorage Manager] 확장 로드 완료');
});
