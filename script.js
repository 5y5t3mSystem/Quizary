/* =========================================================
   QUIZARY — script.js
   Frontend logic: navigation, Apps Script API bridge,
   LocalStorage caching, teacher auth, CRUD, student library.
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIGURATION
   Change APPS_SCRIPT_URL to your deployed Apps Script web app URL.
   Change TEACHER_CREDENTIALS to your desired teacher login.
   (See README.md for full setup instructions.)
--------------------------------------------------------- */
const CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw_lQegXaUKvqJWnREGcDog975sdU2V3YKQ2hdaQ_5F3zUNRyX2qS0ezE5TwGCaJ1LKMA/exec',
  TEACHER_USERNAME: 'teacher',
  TEACHER_PASSWORD: 'quizary123'
};

const STORAGE_KEYS = {
  QUIZZES: 'quizary_quizzes',
  LAST_REFRESH: 'quizary_last_refresh',
  TEACHER_SESSION: 'quizary_teacher_session',
  PREFERENCES: 'quizary_preferences'
};

/* ---------------------------------------------------------
   2. STATE
--------------------------------------------------------- */
const state = {
  quizzes: [],
  isTeacherLoggedIn: false
};

/* ---------------------------------------------------------
   3. UTILITIES
--------------------------------------------------------- */
function safeGetLocal(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    console.warn('Corrupted localStorage for key', key, e);
    localStorage.removeItem(key);
    return null;
  }
}

function safeSetLocal(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
  }catch(e){
    console.warn('Unable to write to localStorage', e);
  }
}

function showToast(message, type){
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icon = type === 'success' ? 'fa-circle-check'
    : type === 'error' ? 'fa-circle-exclamation'
    : 'fa-circle-info';
  toast.innerHTML = '<i class="fa-solid ' + icon + '"></i><span>' + escapeHtml(message) + '</span>';
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = String(str == null ? '' : str);
  return div.innerHTML;
}

function isReasonableUrl(url){
  if(!url) return false;
  return /^https?:\/\/.+/i.test(url.trim()) || url.trim().startsWith('/') || url.trim().endsWith('.html');
}

function formatTimestamp(ts){
  if(!ts) return 'Never';
  const d = new Date(ts);
  if(isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

function generateId(){
  return 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------
   4. NAVIGATION
--------------------------------------------------------- */
function navigateTo(screenKey){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + screenKey);
  if(target) target.classList.add('active');

  if(screenKey === 'student-library'){
    initStudentLibrary();
  }
  if(screenKey === 'teacher-dashboard'){
    initTeacherDashboard();
  }
  if(screenKey === 'teacher-login'){
    document.getElementById('loginError').hidden = true;
    document.getElementById('loginForm').reset();
  }
}

document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if(!navEl) return;
  const key = navEl.getAttribute('data-nav');
  if(key === 'teacher-login' && state.isTeacherLoggedIn){
    navigateTo('teacher-dashboard');
  } else {
    navigateTo(key);
  }
});

/* ---------------------------------------------------------
   5. APPS SCRIPT API BRIDGE
--------------------------------------------------------- */
function isApiConfigured(){
  return CONFIG.APPS_SCRIPT_URL && CONFIG.APPS_SCRIPT_URL.indexOf('PASTE_') === -1;
}

async function apiRequest(action, payload){
  if(!isApiConfigured()){
    throw new Error('Apps Script URL is not configured yet.');
  }
  const options = {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }
  };
  let url = CONFIG.APPS_SCRIPT_URL;
  if(payload){
    options.body = JSON.stringify(Object.assign({ action: action }, payload));
  } else {
    url += (url.indexOf('?') > -1 ? '&' : '?') + 'action=' + encodeURIComponent(action);
  }
  const response = await fetch(url, options);
  if(!response.ok){
    throw new Error('Network response was not OK (status ' + response.status + ')');
  }
  const data = await response.json();
  if(!data || typeof data.success === 'undefined'){
    throw new Error('Malformed response from server.');
  }
  return data;
}

async function fetchQuizzesFromServer(){
  const data = await apiRequest('getQuizzes');
  if(!data.success) throw new Error(data.message || 'Unable to load quizzes.');
  return Array.isArray(data.quizzes) ? data.quizzes : [];
}

async function uploadHtmlQuizFile(file, quizId){
  if(!file) throw new Error('Please select an HTML quiz file.');
  const allowed = /\.(html|htm)$/i.test(String(file.name || '').trim());
  if(!allowed) throw new Error('Please upload an .html or .htm file.');
  if(file.size > 5 * 1024 * 1024){
    throw new Error('The HTML quiz file is too large. Maximum size is 5 MB.');
  }

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Unable to read the HTML file.'));
    reader.readAsDataURL(file);
  });

  const data = await apiRequest('uploadHtmlQuiz', {
    fileName: file.name,
    fileData: base64,
    quizId: quizId
  });

  if(!data.success) throw new Error(data.message || 'Unable to upload HTML quiz.');
  return data;
}

async function addQuizOnServer(quiz){
  const data = await apiRequest('addQuiz', { quiz: quiz });
  if(!data.success) throw new Error(data.message || 'Unable to add quiz.');
  return data;
}

async function updateQuizOnServer(quiz){
  const data = await apiRequest('updateQuiz', { quiz: quiz });
  if(!data.success) throw new Error(data.message || 'Unable to update quiz.');
  return data;
}

async function deleteQuizOnServer(id){
  const data = await apiRequest('deleteQuiz', { id: id });
  if(!data.success) throw new Error(data.message || 'Unable to delete quiz.');
  return data;
}

async function setStatusOnServer(id, status){
  const data = await apiRequest('setStatus', { id: id, status: status });
  if(!data.success) throw new Error(data.message || 'Unable to update status.');
  return data;
}

/* ---------------------------------------------------------
   6. QUIZ DATA LOADING (offline-first)
--------------------------------------------------------- */
function loadCachedQuizzes(){
  const cached = safeGetLocal(STORAGE_KEYS.QUIZZES);
  state.quizzes = Array.isArray(cached) ? cached : [];
  return state.quizzes;
}

async function refreshQuizzesFromServer(showToastOnSuccess){
  try{
    const quizzes = await fetchQuizzesFromServer();
    state.quizzes = quizzes;
    safeSetLocal(STORAGE_KEYS.QUIZZES, quizzes);
    safeSetLocal(STORAGE_KEYS.LAST_REFRESH, Date.now());
    if(showToastOnSuccess){
      showToast('Quiz library updated.', 'success');
    }
    return { ok: true };
  }catch(err){
    console.warn('Refresh failed:', err.message);
    if(showToastOnSuccess){
      showToast('Unable to connect to Quizary data source. Using cached data.', 'error');
    }
    return { ok: false, error: err };
  }
}

/* ---------------------------------------------------------
   7. TEACHER LOGIN / SESSION
--------------------------------------------------------- */
function restoreTeacherSession(){
  const session = safeGetLocal(STORAGE_KEYS.TEACHER_SESSION);
  state.isTeacherLoggedIn = !!(session && session.loggedIn);
}

function loginTeacher(username, password){
  if(username === CONFIG.TEACHER_USERNAME && password === CONFIG.TEACHER_PASSWORD){
    state.isTeacherLoggedIn = true;
    safeSetLocal(STORAGE_KEYS.TEACHER_SESSION, { loggedIn: true, since: Date.now() });
    return true;
  }
  return false;
}

function logoutTeacher(){
  state.isTeacherLoggedIn = false;
  localStorage.removeItem(STORAGE_KEYS.TEACHER_SESSION);
  navigateTo('welcome');
  showToast('Logged out.', 'info');
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmitBtn');

  submitBtn.disabled = true;
  const success = loginTeacher(username, password);
  submitBtn.disabled = false;

  if(success){
    errorEl.hidden = true;
    navigateTo('teacher-dashboard');
  } else {
    errorEl.textContent = 'Invalid username or password.';
    errorEl.hidden = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  if(state.isTeacherLoggedIn && !confirm('Log out of the Teacher Dashboard?')){
    return;
  }
  logoutTeacher();
});

/* Guard: if a session expires or is invalid, kick back to login */
function requireTeacherSession(){
  if(!state.isTeacherLoggedIn){
    navigateTo('teacher-login');
    showToast('Your session has expired. Please log in again.', 'error');
    return false;
  }
  return true;
}

/* ---------------------------------------------------------
   8. TEACHER DASHBOARD
--------------------------------------------------------- */
let teacherInitialized = false;

async function initTeacherDashboard(){
  if(!requireTeacherSession()) return;

  loadCachedQuizzes();
  renderTeacherLastRefresh();
  renderTeacherQuizList();
  populateSubjectFilter('teacherFilterSubject');

  if(!teacherInitialized){
    teacherInitialized = true;
    document.getElementById('teacherSearch').addEventListener('input', renderTeacherQuizList);
    document.getElementById('teacherFilterSubject').addEventListener('change', renderTeacherQuizList);
    document.getElementById('teacherFilterStatus').addEventListener('change', renderTeacherQuizList);
    document.getElementById('teacherRefreshBtn').addEventListener('click', handleTeacherRefreshClick);
    document.getElementById('openAddQuizBtn').addEventListener('click', () => openQuizForm(null));
  }

  const result = await refreshQuizzesFromServer(false);
  if(result.ok){
    renderTeacherLastRefresh();
    renderTeacherQuizList();
    populateSubjectFilter('teacherFilterSubject');
  }
}

async function handleTeacherRefreshClick(){
  const btn = document.getElementById('teacherRefreshBtn');
  if(btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  btn.disabled = true;
  const result = await refreshQuizzesFromServer(true);
  btn.classList.remove('loading');
  btn.disabled = false;
  if(result.ok){
    renderTeacherLastRefresh();
    renderTeacherQuizList();
    populateSubjectFilter('teacherFilterSubject');
  }
}

function renderTeacherLastRefresh(){
  const ts = safeGetLocal(STORAGE_KEYS.LAST_REFRESH);
  document.getElementById('teacherLastRefresh').innerHTML =
    '<i class="fa-solid fa-clock"></i> Last refreshed: ' + escapeHtml(formatTimestamp(ts));
}

function getFilteredQuizzes(source){
  const searchId = source === 'teacher' ? 'teacherSearch' : 'studentSearch';
  const subjectId = source === 'teacher' ? 'teacherFilterSubject' : 'studentFilterSubject';
  const search = (document.getElementById(searchId).value || '').trim().toLowerCase();
  const subject = document.getElementById(subjectId).value;

  let list = state.quizzes.slice();

  if(source === 'teacher'){
    const status = document.getElementById('teacherFilterStatus').value;
    if(status) list = list.filter(q => (q.Status || q.status) === status);
  } else {
    list = list.filter(q => (q.Status || q.status) === 'Active');
    const type = document.getElementById('studentFilterType').value;
    if(type) list = list.filter(q => (q.Type || q.type) === type);
  }

  if(subject){
    list = list.filter(q => (q.Subject || q.subject) === subject);
  }

  if(search){
    list = list.filter(q => {
      const title = (q.Title || q.title || '').toLowerCase();
      const subj = (q.Subject || q.subject || '').toLowerCase();
      const desc = (q.Description || q.description || '').toLowerCase();
      return title.includes(search) || subj.includes(search) || desc.includes(search);
    });
  }

  return list;
}

function populateSubjectFilter(selectId){
  const select = document.getElementById(selectId);
  const currentValue = select.value;
  const subjects = Array.from(new Set(state.quizzes.map(q => q.Subject || q.subject).filter(Boolean))).sort();
  select.innerHTML = '<option value="">All Subjects</option>' +
    subjects.map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('');
  if(subjects.includes(currentValue)) select.value = currentValue;
}

function renderTeacherQuizList(){
  const list = getFilteredQuizzes('teacher');
  const container = document.getElementById('teacherQuizList');
  const emptyState = document.getElementById('teacherEmptyState');

  if(list.length === 0){
    container.innerHTML = '';
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  container.innerHTML = list.map(q => {
    const id = q.ID || q.id;
    const status = q.Status || q.status || 'Inactive';
    const statusClass = status === 'Active' ? 'status-active' : 'status-inactive';
    const statusIcon = status === 'Active' ? 'fa-circle-check' : 'fa-circle-minus';
    return '' +
    '<div class="quiz-card" data-id="' + escapeHtml(id) + '">' +
      '<span class="quiz-card-subject">' + escapeHtml(q.Subject || q.subject || '') + '</span>' +
      '<div class="quiz-card-title">' + escapeHtml(q.Title || q.title || '') + '</div>' +
      '<div class="quiz-card-desc">' + escapeHtml(q.Description || q.description || '') + '</div>' +
      '<div class="quiz-card-meta">' +
        '<span><i class="fa-solid fa-link"></i> ' + escapeHtml(q.Type || q.type || '') + '</span>' +
        '<span class="status-badge ' + statusClass + '"><i class="fa-solid ' + statusIcon + '"></i> ' + escapeHtml(status) + '</span>' +
      '</div>' +
      '<div class="quiz-card-actions">' +
        '<button class="btn btn-secondary" data-action="edit"><i class="fa-solid fa-pen"></i> Edit</button>' +
        '<button class="btn btn-secondary" data-action="toggle-status"><i class="fa-solid fa-toggle-on"></i> ' + (status === 'Active' ? 'Deactivate' : 'Activate') + '</button>' +
        '<button class="btn btn-danger" data-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

document.getElementById('teacherQuizList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const card = e.target.closest('.quiz-card');
  const id = card.getAttribute('data-id');
  const quiz = state.quizzes.find(q => (q.ID || q.id) === id);
  if(!quiz) return;

  const action = btn.getAttribute('data-action');
  if(action === 'edit') openQuizForm(quiz);
  if(action === 'delete') openDeleteConfirm(quiz);
  if(action === 'toggle-status') toggleQuizStatus(quiz);
});

async function toggleQuizStatus(quiz){
  const id = quiz.ID || quiz.id;
  const currentStatus = quiz.Status || quiz.status || 'Inactive';
  const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
  try{
    await setStatusOnServer(id, newStatus);
    quiz.Status = newStatus;
    quiz.status = newStatus;
    safeSetLocal(STORAGE_KEYS.QUIZZES, state.quizzes);
    renderTeacherQuizList();
    showToast('Quiz ' + (newStatus === 'Active' ? 'activated' : 'deactivated') + '.', 'success');
  }catch(err){
    showToast(err.message || 'Unable to update status.', 'error');
  }
}

/* ---------------------------------------------------------
   9. QUIZ FORM (Add / Edit)
--------------------------------------------------------- */
function syncQuizSourceFields(){
  const type = document.getElementById('quizType').value;
  const htmlGroup = document.getElementById('htmlUploadGroup');
  const linkGroup = document.getElementById('externalLinkGroup');
  const fileInput = document.getElementById('quizHtmlFile');
  const linkInput = document.getElementById('quizLink');

  const isHtml = type === 'HTML';
  htmlGroup.hidden = !isHtml;
  linkGroup.hidden = isHtml;
  fileInput.required = isHtml;
  linkInput.required = !isHtml;
}

function openQuizForm(quiz){
  const modal = document.getElementById('quizFormModal');
  const title = document.getElementById('quizFormTitle');
  const errorEl = document.getElementById('quizFormError');
  errorEl.hidden = true;
  document.getElementById('quizForm').reset();

  if(quiz){
    title.innerHTML = '<i class="fa-solid fa-pen"></i> Edit Quiz';
    document.getElementById('quizId').value = quiz.ID || quiz.id || '';
    document.getElementById('quizTitle').value = quiz.Title || quiz.title || '';
    document.getElementById('quizSubject').value = quiz.Subject || quiz.subject || '';
    document.getElementById('quizDescription').value = quiz.Description || quiz.description || '';
    document.getElementById('quizLink').value = quiz.Link || quiz.link || '';
    document.getElementById('quizType').value = quiz.Type || quiz.type || 'HTML';
    document.getElementById('quizStatus').value = quiz.Status || quiz.status || 'Active';
  } else {
    title.innerHTML = '<i class="fa-solid fa-plus"></i> Add Quiz';
    document.getElementById('quizId').value = '';
    document.getElementById('quizStatus').value = 'Active';
    document.getElementById('quizType').value = 'HTML';
  }
  syncQuizSourceFields();
  modal.hidden = false;
}

function closeQuizForm(){
  document.getElementById('quizFormModal').hidden = true;
}

document.getElementById('closeQuizFormBtn').addEventListener('click', closeQuizForm);
document.getElementById('cancelQuizFormBtn').addEventListener('click', closeQuizForm);

let quizFormSubmitting = false;

document.getElementById('quizType').addEventListener('change', syncQuizSourceFields);

document.getElementById('quizForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if(quizFormSubmitting) return;

  const errorEl = document.getElementById('quizFormError');
  errorEl.hidden = true;

  const id = document.getElementById('quizId').value;
  const titleVal = document.getElementById('quizTitle').value.trim();
  const subjectVal = document.getElementById('quizSubject').value.trim();
  const descriptionVal = document.getElementById('quizDescription').value.trim();
  const typeVal = document.getElementById('quizType').value;
  const statusVal = document.getElementById('quizStatus').value;
  const fileInput = document.getElementById('quizHtmlFile');
  const fileVal = fileInput.files[0] || null;
  const linkVal = document.getElementById('quizLink').value.trim();

  if(!titleVal || !subjectVal || !typeVal){
    errorEl.textContent = 'Please fill in all required fields.';
    errorEl.hidden = false;
    return;
  }

  if(typeVal === 'HTML'){
    if(!id && !fileVal){
      errorEl.textContent = 'Please upload the HTML quiz file.';
      errorEl.hidden = false;
      return;
    }
  } else if(!linkVal || !isReasonableUrl(linkVal)){
    errorEl.textContent = 'Please enter a valid external link starting with http:// or https://.';
    errorEl.hidden = false;
    return;
  }

  const submitBtn = document.getElementById('quizFormSubmitBtn');
  quizFormSubmitting = true;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  const quizPayload = {
    ID: id || generateId(),
    Title: titleVal,
    Subject: subjectVal,
    Description: descriptionVal,
    Link: typeVal === 'URL' ? linkVal : '',
    Type: typeVal,
    Status: statusVal
  };

  try{
    if(typeVal === 'HTML' && fileVal){
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
      const upload = await uploadHtmlQuizFile(fileVal, quizPayload.ID);
      quizPayload.Link = upload.link;
      quizPayload.FileId = upload.fileId;
    }

    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    if(id){
      await updateQuizOnServer(quizPayload);
      showToast('Quiz updated successfully.', 'success');
    } else {
      quizPayload.DateAdded = new Date().toISOString();
      await addQuizOnServer(quizPayload);
      showToast('Quiz added successfully.', 'success');
    }

    closeQuizForm();
    await refreshQuizzesFromServer(false);
    renderTeacherLastRefresh();
    renderTeacherQuizList();
    populateSubjectFilter('teacherFilterSubject');
  }catch(err){
    errorEl.textContent = err.message || 'Unable to save quiz. Please try again.';
    errorEl.hidden = false;
  }finally{
    quizFormSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Quiz';
  }
});

/* ---------------------------------------------------------
   10. DELETE CONFIRMATION
--------------------------------------------------------- */
let pendingDeleteId = null;

function openDeleteConfirm(quiz){
  pendingDeleteId = quiz.ID || quiz.id;
  document.getElementById('confirmDeleteModal').hidden = false;
}

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
  pendingDeleteId = null;
  document.getElementById('confirmDeleteModal').hidden = true;
});

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if(!pendingDeleteId) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
  try{
    await deleteQuizOnServer(pendingDeleteId);
    showToast('Quiz deleted.', 'success');
    document.getElementById('confirmDeleteModal').hidden = true;
    await refreshQuizzesFromServer(false);
    renderTeacherLastRefresh();
    renderTeacherQuizList();
    populateSubjectFilter('teacherFilterSubject');
  }catch(err){
    showToast(err.message || 'Unable to delete quiz.', 'error');
  }finally{
    pendingDeleteId = null;
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
  }
});

/* ---------------------------------------------------------
   11. STUDENT LIBRARY
--------------------------------------------------------- */
let studentInitialized = false;

async function initStudentLibrary(){
  loadCachedQuizzes();
  renderStudentLastRefresh();
  renderStudentQuizList();
  populateSubjectFilter('studentFilterSubject');

  if(!studentInitialized){
    studentInitialized = true;
    document.getElementById('studentSearch').addEventListener('input', renderStudentQuizList);
    document.getElementById('studentFilterSubject').addEventListener('change', renderStudentQuizList);
    document.getElementById('studentFilterType').addEventListener('change', renderStudentQuizList);
    document.getElementById('studentRefreshBtn').addEventListener('click', handleStudentRefreshClick);
  }

  const noticeEl = document.getElementById('studentSyncNotice');
  const result = await refreshQuizzesFromServer(false);
  if(result.ok){
    noticeEl.hidden = true;
    renderStudentLastRefresh();
    renderStudentQuizList();
    populateSubjectFilter('studentFilterSubject');
  } else if(state.quizzes.length > 0){
    noticeEl.hidden = false;
    noticeEl.innerHTML = '<i class="fa-solid fa-wifi"></i> Using cached quiz data — could not reach the Quizary server.';
  } else {
    noticeEl.hidden = false;
    noticeEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Unable to load quizzes right now. Please try refreshing.';
  }
}

async function handleStudentRefreshClick(){
  const btn = document.getElementById('studentRefreshBtn');
  if(btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  btn.disabled = true;
  const result = await refreshQuizzesFromServer(true);
  btn.classList.remove('loading');
  btn.disabled = false;
  const noticeEl = document.getElementById('studentSyncNotice');
  if(result.ok){
    noticeEl.hidden = true;
  }
  renderStudentLastRefresh();
  renderStudentQuizList();
  populateSubjectFilter('studentFilterSubject');
}

function renderStudentLastRefresh(){
  const ts = safeGetLocal(STORAGE_KEYS.LAST_REFRESH);
  document.getElementById('studentLastRefresh').innerHTML =
    '<i class="fa-solid fa-clock"></i> Last updated: ' + escapeHtml(formatTimestamp(ts));
}

function renderStudentQuizList(){
  const list = getFilteredQuizzes('student');
  const container = document.getElementById('studentQuizList');
  const emptyState = document.getElementById('studentEmptyState');

  if(list.length === 0){
    container.innerHTML = '';
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  container.innerHTML = list.map(q => {
    const id = q.ID || q.id;
    return '' +
    '<div class="quiz-card" data-id="' + escapeHtml(id) + '">' +
      '<span class="quiz-card-subject">' + escapeHtml(q.Subject || q.subject || '') + '</span>' +
      '<div class="quiz-card-title">' + escapeHtml(q.Title || q.title || '') + '</div>' +
      '<div class="quiz-card-desc">' + escapeHtml(q.Description || q.description || '') + '</div>' +
      '<div class="quiz-card-meta">' +
        '<span><i class="fa-solid fa-link"></i> ' + escapeHtml(q.Type || q.type || '') + '</span>' +
      '</div>' +
      '<div class="quiz-card-actions">' +
        '<button class="btn btn-primary" data-action="start"><i class="fa-solid fa-play"></i> Start Quiz</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

document.getElementById('studentQuizList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="start"]');
  if(!btn) return;
  const card = e.target.closest('.quiz-card');
  const id = card.getAttribute('data-id');
  const quiz = state.quizzes.find(q => (q.ID || q.id) === id);
  if(!quiz) return;
  const link = quiz.Link || quiz.link;
  if(!link){
    showToast('This quiz has no valid link.', 'error');
    return;
  }
  window.open(link, '_blank', 'noopener,noreferrer');
});

/* ---------------------------------------------------------
   12. INITIAL LOAD
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  restoreTeacherSession();
  loadCachedQuizzes();
  syncQuizSourceFields();
  navigateTo('welcome');
});
