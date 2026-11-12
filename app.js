    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
    import { firebaseConfig } from "./firebase-config.js";
    import {
      getDatabase,
      ref,
      push,
      set,
      update,
      onValue,
      onDisconnect,
      runTransaction,
      serverTimestamp,
      remove
    } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
    import * as Y from "https://esm.sh/yjs@13.6.27";

    let app;
    let db;
    let notebookStartupStage = 'not started';
    let clientId = sessionStorage.getItem('orgcollab-client-id');
    if (!clientId) {
      clientId = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('orgcollab-client-id', clientId);
    }

    // --- App State ---
    let notebookToken = '';
    let nickname = '';
    let userColor = '#58a6ff';
    let notes = [];
    let activeNoteId = null;
    let presenceList = [];
    let viewMode = 'edit'; // 'edit' | 'split' | 'preview'
    const deletedNoteIds = new Set();
    let isEditing = false;
    let editingTimeout = null;
    let saveTimeout = null;
    let titleSaveTimeout = null;
    let heartbeatInterval = null;
    let unsubNotes = null;
    let unsubPresence = null;
    let unsubConnection = null;
    let unsubNoteContent = null;
    let activeNoteDoc = null;
    let activeNoteText = null;
    let activeNoteDocObserver = null;
    let activeNoteIdForDoc = null;
    let myPresenceRef = null;
    let collapsedSections = new Set();
    const REMOTE_UPDATE = {};

    const USER_COLORS = ['#58a6ff', '#3fb950', '#d2a8ff', '#ffa657', '#ff7b72', '#79c0ff'];

    // --- DOM Elements ---
    const tokenGate = document.getElementById('token-gate');
    const tokenForm = document.getElementById('token-form');
    const tokenInput = document.getElementById('token-input');
    const nicknameInput = document.getElementById('nickname-input');
    const joinBtn = document.getElementById('join-btn');
    const gateError = document.getElementById('gate-error');
    const appShell = document.getElementById('app-shell');

    const sidebar = document.getElementById('sidebar');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const notebookBadge = document.getElementById('notebook-badge');
    const switchTokenBtn = document.getElementById('switch-token-btn');
    const newNoteBtn = document.getElementById('new-note-btn');
    const emptyNewNoteBtn = document.getElementById('empty-new-note-btn');
    const notesListEl = document.getElementById('notes-list');
    const onlineCountEl = document.getElementById('online-count');
    const onlineUsersListEl = document.getElementById('online-users-list');
    const myNicknameBadge = document.getElementById('my-nickname-badge');

    const noteTitleInput = document.getElementById('note-title-input');
    const noteEditor = document.getElementById('note-editor');
    const notePresenceEl = document.getElementById('note-presence');
    const mobileNotePresenceEl = document.getElementById('mobile-note-presence');
    const syncStatusEl = document.getElementById('sync-status');
    const emptyStateEl = document.getElementById('empty-state');
    const workspaceEl = document.getElementById('workspace');
    const editorPane = document.getElementById('editor-pane');
    const splitDivider = document.getElementById('split-divider');
    const previewPane = document.getElementById('preview-pane');
    const orgPreviewContent = document.getElementById('org-preview-content');
    const modeBtns = document.querySelectorAll('.mode-btn');
    const toastEl = document.getElementById('toast');
    const toastQueue = [];

    // --- Helpers ---
    function showToast(msg) {
      if (!toastEl.classList.contains('hidden')) {
        toastQueue.push(msg);
        return;
      }

      displayToast(msg);
    }

    function displayToast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      setTimeout(() => {
        const nextMessage = toastQueue.shift();
        if (nextMessage) {
          displayToast(nextMessage);
        } else {
          toastEl.classList.add('hidden');
        }
      }, 2500);
    }

    function generateRandomNickname() {
      const num = Math.floor(10 + Math.random() * 90);
      return `anon-${num}`;
    }

    function sanitizeToken(raw) {
      return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 80);
    }

    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // --- Initialize Firebase without user authentication ---
    function initFirebase() {
      const requiredConfig = ['apiKey', 'databaseURL', 'projectId', 'appId'];
      const missingConfig = requiredConfig.some((key) =>
        !firebaseConfig[key] ||
        (typeof firebaseConfig[key] === 'string' && firebaseConfig[key].startsWith('YOUR_'))
      );
      if (missingConfig) {
        throw new Error('Add your Firebase web app settings to firebase-config.js first.');
      }
      try {
        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
      } catch (err) {
        console.error('Firebase initialization error:', err);
        throw new Error(`Failed to initialize Firebase: ${err.message}`);
      }
    }

    // --- Token Gate Submission ---
    function openNotebook() {
      const rawToken = tokenInput.value;
      if (!rawToken.trim()) {
        tokenInput.focus();
        return;
      }

      notebookToken = sanitizeToken(rawToken);
      if (!/[a-z0-9]/.test(notebookToken)) {
        gateError.textContent = 'Enter a token containing at least one letter or number.';
        gateError.classList.remove('hidden');
        return;
      }
      nickname = nicknameInput.value.trim() || generateRandomNickname();
      userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

      try {
        if (!db) initFirebase();
      } catch (err) {
        gateError.textContent = err.message;
        gateError.classList.remove('hidden');
        return;
      }

      gateError.classList.add('hidden');
      tokenGate.classList.add('hidden');
      appShell.classList.remove('hidden');
      notebookBadge.textContent = notebookToken;
      myNicknameBadge.textContent = nickname;

      try {
        startNotebookSession();
      } catch (err) {
        console.error(`Notebook startup error while ${notebookStartupStage}:`, err);
        appShell.classList.add('hidden');
        tokenGate.classList.remove('hidden');
        gateError.textContent = `Could not open notebook while ${notebookStartupStage}: ${err.message}`;
        gateError.classList.remove('hidden');
      }
    }

    tokenForm.addEventListener('submit', (event) => {
      event.preventDefault();
      openNotebook();
    });
    joinBtn.addEventListener('click', openNotebook);

    switchTokenBtn.addEventListener('click', () => {
      cleanupSession();
      appShell.classList.add('hidden');
      tokenGate.classList.remove('hidden');
      tokenInput.focus();
    });

    const linkedToken = new URLSearchParams(window.location.search).get('token');
    if (linkedToken?.trim()) {
      tokenInput.value = linkedToken;
      openNotebook();
    }

    // --- Mobile Sidebar Toggle ---
    function toggleSidebar(open) {
      if (open) {
        sidebar.classList.remove('-translate-x-full');
        sidebarBackdrop.classList.remove('hidden');
      } else {
        sidebar.classList.add('-translate-x-full');
        sidebarBackdrop.classList.add('hidden');
      }
    }
    mobileMenuBtn.addEventListener('click', () => toggleSidebar(true));
    sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));

    // --- Session & Realtime Database Listeners ---
    function cleanupSession() {
      if (unsubNotes) unsubNotes();
      if (unsubPresence) unsubPresence();
      if (unsubConnection) unsubConnection();
      if (unsubNoteContent) unsubNoteContent();
      unsubNotes = null;
      unsubPresence = null;
      unsubConnection = null;
      unsubNoteContent = null;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      if (activeNoteDoc && activeNoteIdForDoc) {
        void persistSharedState(activeNoteIdForDoc, activeNoteDoc);
      }
      if (titleSaveTimeout && activeNoteId) {
        void persistNoteTitle(activeNoteId, noteTitleInput.value.trim() || 'Untitled Note');
      }
      clearTimeout(saveTimeout);
      saveTimeout = null;
      clearTimeout(titleSaveTimeout);
      titleSaveTimeout = null;
      clearTimeout(editingTimeout);
      if (activeNoteDoc && activeNoteDocObserver) {
        activeNoteDoc.off('update', activeNoteDocObserver);
        activeNoteDoc.destroy();
      }
      if (myPresenceRef) {
        onDisconnect(myPresenceRef).cancel().catch((err) => console.error('Presence cleanup error:', err));
        remove(myPresenceRef).catch((err) => console.error('Presence cleanup error:', err));
      }
      notes = [];
      deletedNoteIds.clear();
      presenceList = [];
      activeNoteId = null;
      activeNoteIdForDoc = null;
      activeNoteDoc = null;
      activeNoteText = null;
      activeNoteDocObserver = null;
      myPresenceRef = null;
      isEditing = false;
      noteTitleInput.value = '';
      noteEditor.value = '';
      noteEditor.disabled = true;
      renderNotesList();
      renderPresence();
      renderPreview();
      updateWorkspaceVisibility();
    }

    function startNotebookSession() {
      notebookStartupStage = 'creating the notes reference';
      const notesRef = ref(db, `notebooks/${notebookToken}/notes`);
      notebookStartupStage = 'creating the presence reference';
      const presenceRef = ref(db, `notebooks/${notebookToken}/presence`);
      notebookStartupStage = 'creating your presence reference';
      myPresenceRef = ref(db, `notebooks/${notebookToken}/presence/${clientId}`);
      let knownNotes = null;
      let knownPresence = null;

      notebookStartupStage = 'subscribing to notes';
      unsubNotes = onValue(notesRef, (snapshot) => {
        const allNotes = [];
        snapshot.forEach((noteSnapshot) => {
          allNotes.push({ id: noteSnapshot.key, ...noteSnapshot.val() });
        });
        const currentNotes = new Map(allNotes.map((note) => [note.id, note]));
        if (knownNotes) {
          for (const [id, note] of currentNotes) {
            if (!knownNotes.has(id)) {
              showToast(`New note created: ${note.title || 'Untitled Note'}`);
            }
          }
          for (const [id, note] of knownNotes) {
            if (!currentNotes.has(id)) {
              showToast(`Note deleted: ${note.title || 'Untitled Note'}`);
            }
          }
        }
        knownNotes = currentNotes;
        allNotes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        notes = allNotes;

        if (!activeNoteId && notes.length > 0) {
          selectNote(notes[0].id);
        } else if (activeNoteId) {
          const current = notes.find(n => n.id === activeNoteId);
          if (current) {
            if (document.activeElement !== noteTitleInput && noteTitleInput.value !== current.title) {
              noteTitleInput.value = current.title || '';
            }
          } else {
            activeNoteId = notes.length > 0 ? notes[0].id : null;
            if (activeNoteId) selectNote(activeNoteId);
          }
        }
        renderNotesList();
        updateWorkspaceVisibility();
      }, (err) => {
        console.error('Notes listener error:', err);
        showToast('Sync error: ' + err.message);
      });

      notebookStartupStage = 'subscribing to presence';
      unsubPresence = onValue(presenceRef, (snapshot) => {
        const now = Date.now();
        const activeUsersById = new Map();
        snapshot.forEach((userSnapshot) => {
          const data = userSnapshot.val();
          if (now - (data.lastSeen || 0) < 30000) {
            activeUsersById.set(userSnapshot.key, data);
          }
        });
        if (knownPresence) {
          for (const [id, user] of activeUsersById) {
            if (id !== clientId && !knownPresence.has(id)) {
              showToast(`${user.nickname || 'Someone'} joined the token room.`);
            }
          }
          for (const [id, user] of knownPresence) {
            if (id !== clientId && !activeUsersById.has(id)) {
              showToast(`${user.nickname || 'Someone'} left the token room.`);
            }
          }
        }
        knownPresence = activeUsersById;
        presenceList = [...activeUsersById.values()];
        renderPresence();
        renderNotesList();
      }, (err) => {
        console.error('Presence listener error:', err);
        showToast('Presence error: ' + err.message);
      });

      const connectedRef = ref(db, '.info/connected');
      notebookStartupStage = 'subscribing to connection status';
      unsubConnection = onValue(connectedRef, async (snapshot) => {
        if (snapshot.val() !== true) {
          syncStatusEl.textContent = 'offline';
          return;
        }
        try {
          await onDisconnect(myPresenceRef).remove();
          await sendHeartbeat();
          syncStatusEl.textContent = 'synced';
          if (!heartbeatInterval) heartbeatInterval = setInterval(sendHeartbeat, 10000);
        } catch (err) {
          console.error('Presence connection error:', err);
          showToast('Could not register presence: ' + err.message);
        }
      }, (err) => {
        console.error('Connection listener error:', err);
        showToast('Connection error: ' + err.message);
      });
      notebookStartupStage = 'waiting for Firebase';
    }

    async function sendHeartbeat() {
      if (!db || !notebookToken || !myPresenceRef) return;
      try {
        await set(myPresenceRef, {
          userId: clientId,
          nickname,
          color: userColor,
          activeNoteId: activeNoteId || null,
          isEditing,
          lastSeen: serverTimestamp()
        });
      } catch (err) {
        console.error('Heartbeat error:', err);
        showToast('Presence sync failed: ' + err.message);
      }
    }

    // --- Note CRUD ---
    async function createNewNote(customTitle = 'Untitled Note') {
      try {
        const noteRef = push(ref(db, `notebooks/${notebookToken}/notes`));
        const noteId = noteRef.key;
        const title = customTitle.trim() || 'Untitled Note';
        const initialContent = `* ${title}
Welcome! This note is a hands-on guide to the syntax supported in the preview. Edit the examples or replace this guide with your own notes.

** 1. Headings
Start a line with one, two, or three stars followed by a space. For example: =* Heading=, =** Subheading=, and =*** Section heading=.
*** This is a third-level heading
Click any heading in Preview to collapse or expand the content beneath it.

** 2. Tasks
Add TODO or DONE immediately after the heading stars to make a task. Click its status badge in Preview to switch between TODO and DONE.
*** TODO Try clicking this status
*** DONE This task is complete

** 3. Lists
Start a line with a hyphen or plus sign followed by a space. Leading spaces are allowed.
- First item
+ Another item

** 4. Inline code and tags
Surround text with equals signs or tildes to show inline code: =const answer = 42= or ~print("hello")~.
Write a tag with # followed by letters, numbers, underscores, or hyphens, like #example or #quick_note.

** 5. Links to other notes
Put a note title inside double square brackets, like [[Another Note]]. In Preview, click the link to open that note or create it.

** 6. Paragraphs
Ordinary lines become paragraphs. Put a blank line between paragraphs to add space.
This is one paragraph.

This is another paragraph, separated by an empty line.

That's the full syntax guide. Try editing these examples, then make this note your own.
`;
        const initialDoc = new Y.Doc();
        initialDoc.getText('content').insert(0, initialContent);
        const encodedState = encodeBytes(Y.encodeStateAsUpdate(initialDoc));
        initialDoc.destroy();

        await update(ref(db), {
          [`notebooks/${notebookToken}/notes/${noteId}`]: {
            title,
            updatedAt: serverTimestamp(),
            updatedBy: nickname
          },
          [`notebooks/${notebookToken}/noteContent/${noteId}`]: encodedState
        });
        const newNote = { id: noteId, title, updatedAt: Date.now(), updatedBy: nickname };
        notes = [newNote, ...notes.filter((note) => note.id !== noteId)];
        selectNote(noteId);
        toggleSidebar(false);
        noteTitleInput.focus();
      } catch (err) {
        console.error('Create note error:', err);
        showToast('Could not create note: ' + err.message);
      }
    }

    newNoteBtn.addEventListener('click', () => createNewNote());
    emptyNewNoteBtn.addEventListener('click', () => createNewNote());

    async function deleteNote(note) {
      if (deletedNoteIds.has(note.id)) return;
      const title = note.title || 'Untitled Note';
      if (!window.confirm(`Delete "${title}" from this token room? This removes it for everyone and cannot be undone.`)) {
        return;
      }

      deletedNoteIds.add(note.id);
      renderNotesList();
      if (note.id === activeNoteId) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        clearTimeout(titleSaveTimeout);
        titleSaveTimeout = null;
        clearTimeout(editingTimeout);
        editingTimeout = null;
        if (unsubNoteContent) unsubNoteContent();
        unsubNoteContent = null;
        if (activeNoteDoc && activeNoteDocObserver) {
          activeNoteDoc.off('update', activeNoteDocObserver);
          activeNoteDoc.destroy();
        }
        activeNoteId = null;
        activeNoteIdForDoc = null;
        activeNoteDoc = null;
        activeNoteText = null;
        activeNoteDocObserver = null;
        noteTitleInput.value = '';
        noteEditor.value = '';
        noteEditor.disabled = true;
        isEditing = false;
        updateWorkspaceVisibility();
        sendHeartbeat();
      }

      try {
        await update(ref(db), {
          [`notebooks/${notebookToken}/notes/${note.id}`]: null,
          [`notebooks/${notebookToken}/noteContent/${note.id}`]: null
        });
      } catch (err) {
        deletedNoteIds.delete(note.id);
        console.error('Delete note error:', err);
        showToast('Could not delete note: ' + err.message);
        if (note.id === activeNoteId || (!activeNoteId && notes.some((item) => item.id === note.id))) {
          selectNote(note.id);
        }
      }
    }

    function selectNote(noteId) {
      if (activeNoteIdForDoc && activeNoteDoc) {
        clearTimeout(saveTimeout);
        void persistSharedState(activeNoteIdForDoc, activeNoteDoc);
      }
      if (titleSaveTimeout && activeNoteId) {
        clearTimeout(titleSaveTimeout);
        void persistNoteTitle(activeNoteId, noteTitleInput.value.trim() || 'Untitled Note');
        titleSaveTimeout = null;
      }
      if (unsubNoteContent) unsubNoteContent();
      if (activeNoteDoc && activeNoteDocObserver) {
        activeNoteDoc.off('update', activeNoteDocObserver);
        activeNoteDoc.destroy();
      }

      activeNoteId = noteId;
      activeNoteIdForDoc = noteId;
      noteEditor.disabled = true;
      activeNoteDoc = new Y.Doc();
      activeNoteText = activeNoteDoc.getText('content');
      activeNoteText.observe(() => {
        const nextContent = activeNoteText.toString();
        if (noteEditor.value !== nextContent) {
          const previousContent = noteEditor.value;
          let prefix = 0;
          while (prefix < previousContent.length && prefix < nextContent.length &&
            previousContent[prefix] === nextContent[prefix]) prefix++;
          const selectionStart = noteEditor.selectionStart;
          const selectionEnd = noteEditor.selectionEnd;
          const delta = nextContent.length - previousContent.length;
          const adjustPosition = (position) => position <= prefix
            ? position
            : Math.max(prefix, position + delta);
          noteEditor.value = nextContent;
          noteEditor.setSelectionRange(
            adjustPosition(selectionStart),
            adjustPosition(selectionEnd)
          );
        }
        renderPreview();
      });
      activeNoteDocObserver = (_updateBytes, origin) => {
        if (origin === REMOTE_UPDATE) return;
        scheduleContentSave();
      };
      activeNoteDoc.on('update', activeNoteDocObserver);

      const note = notes.find(n => n.id === noteId);
      if (note) {
        noteTitleInput.value = note.title || '';
        if (note.content && activeNoteText.length === 0) {
          activeNoteText.insert(0, note.content);
        }
      }

      const contentRef = ref(db, `notebooks/${notebookToken}/noteContent/${noteId}`);
      unsubNoteContent = onValue(contentRef, (snapshot) => {
        const state = snapshot.val();
        if (state) {
          try {
            Y.applyUpdate(activeNoteDoc, decodeBytes(state), REMOTE_UPDATE);
          } catch (err) {
            console.error('Invalid shared note state:', err);
            showToast('Could not read shared note content.');
          }
        }
        noteEditor.disabled = false;
      }, (err) => {
        console.error('Note content listener error:', err);
        showToast('Note sync error: ' + err.message);
      });

      renderNotesList();
      renderPresence();
      updateWorkspaceVisibility();
      sendHeartbeat();
      toggleSidebar(false);
    }

    function updateWorkspaceVisibility() {
      if (notes.length === 0 || !activeNoteId) {
        emptyStateEl.classList.remove('hidden');
        workspaceEl.classList.add('hidden');
        noteTitleInput.disabled = true;
        noteEditor.disabled = true;
      } else {
        emptyStateEl.classList.add('hidden');
        workspaceEl.classList.remove('hidden');
        noteTitleInput.disabled = false;
      }
    }

    function encodeBytes(bytes) {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    }

    function decodeBytes(encoded) {
      const binary = atob(encoded);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }

    async function persistSharedState(noteId, doc) {
      if (!noteId || !doc || !db || deletedNoteIds.has(noteId)) return;
      const updateBytes = Y.encodeStateAsUpdate(doc);
      const sessionToken = notebookToken;
      const sessionNickname = nickname;
      const contentRef = ref(db, `notebooks/${sessionToken}/noteContent/${noteId}`);
      let saved = false;
      try {
        await runTransaction(contentRef, (currentState) => {
          if (!currentState) return encodeBytes(updateBytes);
          return encodeBytes(Y.mergeUpdates([decodeBytes(currentState), updateBytes]));
        }, { applyLocally: false });
        if (deletedNoteIds.has(noteId)) return;
        await update(ref(db, `notebooks/${sessionToken}/notes/${noteId}`), {
          updatedAt: serverTimestamp(),
          updatedBy: sessionNickname
        });
        saved = true;
      } catch (err) {
        console.error('Note content sync error:', err);
        if (noteId === activeNoteId) syncStatusEl.textContent = 'error';
        showToast('Could not sync note content: ' + err.message);
      } finally {
        if (saved && noteId === activeNoteId && !saveTimeout) syncStatusEl.textContent = 'synced';
      }
    }

    async function persistNoteTitle(noteId, title) {
      if (deletedNoteIds.has(noteId)) return;
      const sessionToken = notebookToken;
      const sessionNickname = nickname;
      try {
        await update(ref(db, `notebooks/${sessionToken}/notes/${noteId}`), {
          title,
          updatedAt: serverTimestamp(),
          updatedBy: sessionNickname
        });
        if (noteId === activeNoteId && !saveTimeout) syncStatusEl.textContent = 'synced';
      } catch (err) {
        console.error('Title save error:', err);
        if (noteId === activeNoteId) syncStatusEl.textContent = 'error';
        showToast('Could not save note title: ' + err.message);
      }
    }

    function scheduleContentSave() {
      const noteId = activeNoteIdForDoc;
      const doc = activeNoteDoc;
      if (!noteId || !doc || deletedNoteIds.has(noteId)) return;
      syncStatusEl.textContent = 'saving...';
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        void persistSharedState(noteId, doc);
      }, 300);
    }

    function scheduleSave() {
      if (!activeNoteId || !db || !activeNoteText || deletedNoteIds.has(activeNoteId)) return;
      const previousContent = activeNoteText.toString();
      const nextContent = noteEditor.value;
      if (previousContent !== nextContent) {
        let prefix = 0;
        while (prefix < previousContent.length && prefix < nextContent.length &&
          previousContent[prefix] === nextContent[prefix]) prefix++;
        let suffix = 0;
        while (suffix < previousContent.length - prefix && suffix < nextContent.length - prefix &&
          previousContent[previousContent.length - 1 - suffix] === nextContent[nextContent.length - 1 - suffix]) suffix++;
        activeNoteDoc.transact(() => {
          if (previousContent.length - prefix - suffix > 0) {
            activeNoteText.delete(prefix, previousContent.length - prefix - suffix);
          }
          const insertedText = nextContent.slice(prefix, nextContent.length - suffix);
          if (insertedText) activeNoteText.insert(prefix, insertedText);
        });
      }

      syncStatusEl.textContent = 'saving...';
      isEditing = true;
      clearTimeout(editingTimeout);
      editingTimeout = setTimeout(() => {
        isEditing = false;
        sendHeartbeat();
      }, 2000);

      clearTimeout(titleSaveTimeout);
      const noteId = activeNoteId;
      const title = noteTitleInput.value.trim() || 'Untitled Note';
      titleSaveTimeout = setTimeout(async () => {
        titleSaveTimeout = null;
        await persistNoteTitle(noteId, title);
      }, 300);

      sendHeartbeat();
    }

    noteTitleInput.addEventListener('input', scheduleSave);
    noteEditor.addEventListener('input', () => {
      scheduleSave();
      if (viewMode === 'split' || viewMode === 'preview') {
        renderPreview();
      }
    });

    // --- View Mode Switching ---
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.mode;
        modeBtns.forEach(b => {
          if (b.dataset.mode === viewMode) {
            b.classList.add('text-textMain', 'bg-surfaceHover');
            b.classList.remove('text-textMuted');
          } else {
            b.classList.remove('text-textMain', 'bg-surfaceHover');
            b.classList.add('text-textMuted');
          }
        });

        if (viewMode === 'edit') {
          editorPane.classList.remove('hidden');
          splitDivider.classList.add('hidden');
          previewPane.classList.add('hidden');
        } else if (viewMode === 'split') {
          editorPane.classList.remove('hidden');
          splitDivider.classList.remove('hidden');
          previewPane.classList.remove('hidden');
          renderPreview();
        } else if (viewMode === 'preview') {
          editorPane.classList.add('hidden');
          splitDivider.classList.add('hidden');
          previewPane.classList.remove('hidden');
          renderPreview();
        }
      });
    });

    // --- Render Sidebar Notes ---
    function renderNotesList() {
      notesListEl.innerHTML = '';
      notes.forEach((note) => {
        const isActive = note.id === activeNoteId;
        const viewers = presenceList.filter(u => u.activeNoteId === note.id && u.userId !== clientId);

        const row = document.createElement('div');
        row.className = 'group flex items-center gap-1';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `min-w-0 flex-1 text-left px-2.5 py-2 rounded-lg text-sm font-mono flex items-center justify-between gap-2 transition-colors ${
          isActive
            ? 'bg-surfaceHover text-textMain border border-border/60'
            : 'text-textMuted hover:text-textMain hover:bg-surfaceHover/50'
        }`;
        btn.onclick = () => selectNote(note.id);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'truncate';
        titleSpan.textContent = note.title || 'Untitled Note';
        btn.appendChild(titleSpan);

        if (viewers.length > 0) {
          const dotsWrap = document.createElement('div');
          dotsWrap.className = 'flex items-center -space-x-1 shrink-0';
          viewers.slice(0, 3).forEach(v => {
            const dot = document.createElement('span');
            dot.className = 'w-2 h-2 rounded-full ring-1 ring-surface';
            dot.style.backgroundColor = v.color || '#58a6ff';
            dot.title = `${v.nickname} (${v.isEditing ? 'editing' : 'viewing'})`;
            dotsWrap.appendChild(dot);
          });
          btn.appendChild(dotsWrap);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'w-7 h-7 shrink-0 inline-flex items-center justify-center rounded text-textMuted/70 hover:text-todo hover:bg-surfaceHover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-todo disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
        deleteBtn.title = `Delete ${note.title || 'Untitled Note'}`;
        deleteBtn.setAttribute('aria-label', `Delete ${note.title || 'Untitled Note'}`);
        deleteBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h16M10 11v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>';
        deleteBtn.disabled = deletedNoteIds.has(note.id);
        deleteBtn.onclick = (event) => {
          event.stopPropagation();
          void deleteNote(note);
        };
        row.appendChild(btn);
        row.appendChild(deleteBtn);
        notesListEl.appendChild(row);
      });
    }

    // --- Render Presence ---
    function renderPresence() {
      onlineCountEl.textContent = presenceList.length;
      onlineUsersListEl.innerHTML = '';

      presenceList.forEach((u) => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono bg-surface border border-border text-textMain';
        const dot = document.createElement('span');
        dot.className = 'w-1.5 h-1.5 rounded-full';
        dot.style.backgroundColor = u.color || '#58a6ff';
        chip.appendChild(dot);

        const name = document.createElement('span');
        name.textContent = u.userId === clientId ? `${u.nickname} (you)` : u.nickname;
        chip.appendChild(name);
        onlineUsersListEl.appendChild(chip);
      });

      // Active note presence
      const noteUsers = presenceList.filter(u => u.activeNoteId === activeNoteId && u.userId !== clientId);
      if (noteUsers.length === 0) {
        notePresenceEl.innerHTML = '';
        mobileNotePresenceEl.classList.add('hidden');
      } else {
        const editingUsers = noteUsers.filter(u => u.isEditing);
        let text = '';
        if (editingUsers.length > 0) {
          text = `${editingUsers.map(u => u.nickname).join(', ')} editing...`;
        } else {
          text = `${noteUsers.map(u => u.nickname).join(', ')} viewing`;
        }
        notePresenceEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-accent pulse-dot"></span><span>${escapeHtml(text)}</span>`;
        mobileNotePresenceEl.textContent = text;
        mobileNotePresenceEl.classList.remove('hidden');
      }
    }

    // --- Org-Mode Parser & Interactive Preview ---
    function formatInlineOrg(text) {
      let html = escapeHtml(text);
      // Inline code =code= or ~code~
      html = html.replace(/([=~])([^=~]+)\1/g, '<code class="org-code">$2</code>');
      // Tags #tag
      html = html.replace(/(^|\s)(#[a-zA-Z0-9_-]+)/g, '$1<span class="org-tag">$2</span>');
      // Wiki links [[note-title]]
      html = html.replace(/\[\[([^\]]+)\]\]/g, '<span class="org-link" data-link="$1">[[$1]]</span>');
      return html;
    }

    function renderPreview() {
      const lines = noteEditor.value.split('\n');
      let html = '';
      let skipLevel = null;

      lines.forEach((line, idx) => {
        const headingMatch = line.match(/^(\*{1,3})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          if (skipLevel !== null && level <= skipLevel) {
            skipLevel = null;
          }
          if (skipLevel !== null) return;

          const isCollapsed = collapsedSections.has(idx);
          const headingClass = level === 1 ? 'org-h1' : level === 2 ? 'org-h2' : 'org-h3';
          let content = headingMatch[2];

          // Check for TODO / DONE
          let statusBadge = '';
          if (content.startsWith('TODO ')) {
            statusBadge = `<span class="org-todo" data-line="${idx}" data-status="TODO">TODO</span>`;
            content = content.slice(5);
          } else if (content.startsWith('DONE ')) {
            statusBadge = `<span class="org-done" data-line="${idx}" data-status="DONE">DONE</span>`;
            content = content.slice(5);
          }

          const arrow = isCollapsed ? '▸' : '▾';
          html += `<div class="${headingClass}" data-heading-line="${idx}">
            <span class="text-textMuted text-xs">${arrow}</span>
            ${statusBadge}
            <span>${formatInlineOrg(content)}</span>
          </div>`;

          if (isCollapsed) {
            skipLevel = level;
          }
          return;
        }

        if (skipLevel !== null) return;

        // Bullet list
        const bulletMatch = line.match(/^\s*[-+]\s+(.*)$/);
        if (bulletMatch) {
          html += `<div class="org-bullet text-textMain/90">${formatInlineOrg(bulletMatch[1])}</div>`;
          return;
        }

        // Empty line
        if (line.trim() === '') {
          html += `<div class="h-3"></div>`;
          return;
        }

        // Normal paragraph
        html += `<p class="text-textMain/90 my-1">${formatInlineOrg(line)}</p>`;
      });

      orgPreviewContent.innerHTML = html || '<p class="text-textMuted italic">Empty note...</p>';

      // Attach interactive listeners in preview
      orgPreviewContent.querySelectorAll('[data-status]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const lineIdx = parseInt(el.dataset.line, 10);
          const currentStatus = el.dataset.status;
          const nextStatus = currentStatus === 'TODO' ? 'DONE' : 'TODO';
          const linesArr = noteEditor.value.split('\n');
          linesArr[lineIdx] = linesArr[lineIdx].replace(currentStatus, nextStatus);
          noteEditor.value = linesArr.join('\n');
          renderPreview();
          scheduleSave();
        });
      });

      orgPreviewContent.querySelectorAll('[data-heading-line]').forEach(el => {
        el.addEventListener('click', () => {
          const lineIdx = parseInt(el.dataset.headingLine, 10);
          if (collapsedSections.has(lineIdx)) {
            collapsedSections.delete(lineIdx);
          } else {
            collapsedSections.add(lineIdx);
          }
          renderPreview();
        });
      });

      orgPreviewContent.querySelectorAll('[data-link]').forEach(el => {
        el.addEventListener('click', () => {
          const targetTitle = el.dataset.link.trim();
          const existing = notes.find(n => (n.title || '').toLowerCase() === targetTitle.toLowerCase());
          if (existing) {
            selectNote(existing.id);
          } else {
            createNewNote(targetTitle);
          }
        });
      });
    }

    window.orgCollabAppReady = true;
