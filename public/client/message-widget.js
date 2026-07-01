(function() {
  // 1. Inject Style sheet
  const styles = `
    /* Floating Action Button (FAB) */
    .petfly-chat-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background-color: #0a4269; /* Compassion Blue */
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      z-index: 10000;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s;
    }
    .petfly-chat-fab:hover {
      transform: scale(1.08);
      background-color: #1a5279;
    }
    .petfly-chat-fab:active {
      transform: scale(0.95);
    }
    .petfly-chat-fab svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }

    /* Badge Counter */
    .petfly-chat-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      background-color: #ba1a1a; /* Error/Alert Red */
      color: white;
      font-size: 11px;
      font-weight: bold;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }

    /* Chat Panel Window */
    .petfly-chat-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 380px;
      height: 520px;
      background-color: #ffffff;
      border: 1px solid #c2c7cf;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(11, 28, 48, 0.12);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
      opacity: 0;
      transform: scale(0.9) translateY(20px);
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .petfly-chat-panel.active {
      opacity: 1;
      transform: scale(1) translateY(0);
      pointer-events: auto;
    }

    /* Header styling */
    .petfly-chat-header {
      background-color: #0a4269;
      color: #ffffff;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #164a71;
    }
    .petfly-chat-header-title {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 700;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .petfly-chat-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .petfly-chat-header-btn {
      background: none;
      border: none;
      color: #ffffff;
      cursor: pointer;
      padding: 4px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s;
    }
    .petfly-chat-header-btn:hover {
      background-color: rgba(255, 255, 255, 0.15);
    }

    /* Content Area */
    .petfly-chat-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    /* Thread list view */
    .petfly-chat-threads {
      flex: 1;
      overflow-y: auto;
      background-color: #f8f9ff;
    }
    .petfly-chat-thread-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid #eff4ff;
      cursor: pointer;
      background-color: #ffffff;
      transition: background-color 0.2s;
    }
    .petfly-chat-thread-item:hover {
      background-color: #e5eeff;
    }
    .petfly-chat-thread-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-cover: cover;
      background-color: #cfe5ff;
      border: 1px solid #c2c7cf;
    }
    .petfly-chat-thread-info {
      flex: 1;
      min-width: 0;
    }
    .petfly-chat-thread-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 2px;
    }
    .petfly-chat-thread-name {
      font-weight: 600;
      color: #0b1c30;
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .petfly-chat-thread-time {
      font-size: 11px;
      color: #72777f;
    }
    .petfly-chat-thread-lastmsg {
      font-size: 13px;
      color: #42474e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .petfly-chat-thread-route {
      font-size: 11px;
      color: #006a63;
      margin-top: 2px;
      font-weight: 500;
    }

    /* Active chat room view */
    .petfly-chat-room {
      display: none;
      flex-direction: column;
      height: 100%;
      background-color: #f8f9ff;
    }
    .petfly-chat-room.active {
      display: flex;
    }
    .petfly-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Message Bubble styling */
    .petfly-chat-msg {
      max-width: 75%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.4;
      position: relative;
      word-wrap: break-word;
    }
    .petfly-chat-msg.client {
      align-self: flex-start;
      background-color: #eff4ff;
      color: #0b1c30;
      border-top-left-radius: 4px;
      border: 1px solid #dce9ff;
    }
    .petfly-chat-msg.admin {
      align-self: flex-end;
      background-color: #0a4269;
      color: #ffffff;
      border-top-right-radius: 4px;
    }
    .petfly-chat-msg-time {
      font-size: 10px;
      color: rgba(0, 0, 0, 0.4);
      margin-top: 4px;
      text-align: right;
    }
    .petfly-chat-msg.admin .petfly-chat-msg-time {
      color: rgba(255, 255, 255, 0.6);
    }

    /* Chat input area */
    .petfly-chat-input-area {
      padding: 12px 16px;
      background-color: #ffffff;
      border-top: 1px solid #c2c7cf;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .petfly-chat-input {
      flex: 1;
      border: 1px solid #c2c7cf;
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 14px;
      outline: none;
      resize: none;
      max-height: 80px;
      font-family: inherit;
      background-color: #f8f9ff;
      transition: border-color 0.2s, background-color 0.2s;
    }
    .petfly-chat-input:focus {
      border-color: #0a4269;
      background-color: #ffffff;
    }
    .petfly-chat-send-btn {
      background-color: #0a4269;
      color: white;
      border: none;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.1s;
    }
    .petfly-chat-send-btn:hover {
      background-color: #006a63; /* Teal accent on hover */
    }
    .petfly-chat-send-btn:active {
      transform: scale(0.9);
    }
    .petfly-chat-send-btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
  `;

  // 2. Append Styles to Head
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  // 3. Create DOM Elements
  // Create Floating Action Button (FAB)
  const fab = document.createElement('div');
  fab.className = 'petfly-chat-fab';
  fab.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
    </svg>
    <div class="petfly-chat-badge" id="petflyChatBadge" style="display: none;">0</div>
  `;
  document.body.appendChild(fab);

  // Create Chat Panel Window
  const panel = document.createElement('div');
  panel.className = 'petfly-chat-panel';
  panel.innerHTML = `
    <div class="petfly-chat-header">
      <div class="petfly-chat-header-title" id="petflyChatHeaderTitle">
        <span>relocation messages</span>
      </div>
      <div class="petfly-chat-header-actions">
        <button class="petfly-chat-header-btn" id="petflyChatBackBtn" style="display: none;" title="Back to list">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
        <button class="petfly-chat-header-btn" id="petflyChatCloseBtn" title="Close chat">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </div>
    <div class="petfly-chat-content">
      <!-- VIEW 1: Threads List -->
      <div class="petfly-chat-threads" id="petflyChatThreads"></div>
      
      <!-- VIEW 2: Active Chat Room -->
      <div class="petfly-chat-room" id="petflyChatRoom">
        <div class="petfly-chat-messages" id="petflyChatMessages"></div>
        <div class="petfly-chat-input-area">
          <textarea class="petfly-chat-input" id="petflyChatInput" rows="1" placeholder="Type a message..."></textarea>
          <button class="petfly-chat-send-btn" id="petflyChatSendBtn">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Cache DOM References
  const badge = document.getElementById('petflyChatBadge');
  const headerTitle = document.getElementById('petflyChatHeaderTitle');
  const backBtn = document.getElementById('petflyChatBackBtn');
  const closeBtn = document.getElementById('petflyChatCloseBtn');
  const threadsContainer = document.getElementById('petflyChatThreads');
  const chatRoom = document.getElementById('petflyChatRoom');
  const messagesContainer = document.getElementById('petflyChatMessages');
  const chatInput = document.getElementById('petflyChatInput');
  const sendBtn = document.getElementById('petflyChatSendBtn');

  // Application State
  let threads = [];
  let activeThreadId = null;
  let isOpen = false;
  let pollingInterval = null;

  // 4. Load Threads and Messages
  async function loadData() {
    try {
      const response = await fetch('/api/messages');
      if (response.ok) {
        threads = await response.json();
        renderThreads();
        if (activeThreadId) {
          renderMessages();
        }
        updateBadge();
      }
    } catch (error) {
      console.error('Error fetching messages from API:', error);
    }
  }

  // Render Thread List View
  function renderThreads() {
    threadsContainer.innerHTML = '';
    if (threads.length === 0) {
      threadsContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: #72777f; font-size: 14px;">No active conversations.</div>';
      return;
    }

    threads.forEach(thread => {
      const lastMsgObj = thread.messages[thread.messages.length - 1];
      const lastMsgText = lastMsgObj ? lastMsgObj.text : 'No messages yet';
      const lastMsgTime = lastMsgObj ? formatTime(lastMsgObj.timestamp) : '';
      
      const item = document.createElement('div');
      item.className = 'petfly-chat-thread-item';
      item.onclick = () => selectThread(thread.id);
      
      item.innerHTML = `
        <img class="petfly-chat-thread-avatar" src="${thread.avatar}" alt="${thread.clientName}">
        <div class="petfly-chat-thread-info">
          <div class="petfly-chat-thread-header">
            <span class="petfly-chat-thread-name">${thread.clientName}</span>
            <span class="petfly-chat-thread-time">${lastMsgTime}</span>
          </div>
          <div class="petfly-chat-thread-lastmsg">${lastMsgText}</div>
          <div class="petfly-chat-thread-route">${thread.ref} • ${thread.route}</div>
        </div>
      `;
      threadsContainer.appendChild(item);
    });
  }

  // Render Messages View
  function renderMessages() {
    const thread = threads.find(t => t.id === activeThreadId);
    if (!thread) return;

    messagesContainer.innerHTML = '';
    thread.messages.forEach(msg => {
      const bubble = document.createElement('div');
      bubble.className = `petfly-chat-msg ${msg.sender}`;
      bubble.innerHTML = `
        <div>${escapeHtml(msg.text)}</div>
        <div class="petfly-chat-msg-time">${formatTime(msg.timestamp)}</div>
      `;
      messagesContainer.appendChild(bubble);
    });
    
    // Smooth scroll to bottom
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 50);
  }

  // Update Badge Counter
  function updateBadge() {
    // Check if we have mock unread messages or count unread threads
    let count = 0;
    threads.forEach(t => {
      // Simple logic: if the last message is from the client, mark as unread for admin
      const last = t.messages[t.messages.length - 1];
      if (last && last.sender === 'client') {
        count++;
      }
    });

    if (count > 0 && !isOpen) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Formatter Helpers
  function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(string) {
    const htmlEscapes = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    };
    return string.replace(/[&<>"']/g, match => htmlEscapes[match]);
  }

  // Navigation Logic
  function selectThread(id) {
    activeThreadId = id;
    const thread = threads.find(t => t.id === id);
    if (!thread) return;

    // Transition Header
    headerTitle.innerHTML = `
      <div style="display:flex; flex-direction:column;">
        <span style="font-weight:700;">${thread.clientName}</span>
        <span style="font-size:11px; font-weight:400; opacity:0.85;">${thread.route}</span>
      </div>
    `;
    backBtn.style.display = 'flex';
    threadsContainer.style.display = 'none';
    chatRoom.className = 'petfly-chat-room active';
    
    renderMessages();
    chatInput.focus();
  }

  function backToList() {
    activeThreadId = null;
    headerTitle.innerHTML = '<span>relocation messages</span>';
    backBtn.style.display = 'none';
    threadsContainer.style.display = 'block';
    chatRoom.className = 'petfly-chat-room';
    loadData(); // refresh list
  }

  function toggleChat(forceOpen = null) {
    isOpen = forceOpen !== null ? forceOpen : !isOpen;
    if (isOpen) {
      panel.classList.add('active');
      loadData();
      // Start polling
      pollingInterval = setInterval(loadData, 3000);
      badge.style.display = 'none';
    } else {
      panel.classList.remove('active');
      clearInterval(pollingInterval);
      updateBadge();
    }
  }

  // Send Message Logic
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !activeThreadId) return;

    chatInput.value = '';
    chatInput.rows = 1;

    // Optimistically update UI
    const tempMessage = {
      id: 'temp-' + Date.now(),
      sender: 'admin',
      text: text,
      timestamp: new Date().toISOString()
    };
    
    const thread = threads.find(t => t.id === activeThreadId);
    if (thread) {
      thread.messages.push(tempMessage);
      renderMessages();
    }

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          text: text,
          sender: 'admin'
        })
      });
      if (response.ok) {
        // Reload actual data
        await loadData();
      }
    } catch (e) {
      console.error('Error sending message:', e);
    }
  }

  // Dynamic Integration: Listen to clicks in CRM
  function openChatForClient(name) {
    toggleChat(true);
    
    // Normalize names to find the matching thread
    const nameLower = name.toLowerCase();
    
    // Find matching thread, e.g. "Smith Family" -> "smith" or "Luo Xiaoming" -> "luo"
    let matchingThread = threads.find(t => 
      t.clientName.toLowerCase().includes(nameLower) || 
      nameLower.includes(t.clientName.toLowerCase().replace(" family", ""))
    );

    if (matchingThread) {
      selectThread(matchingThread.id);
    } else {
      // Create a brand new thread ID dynamically
      const id = nameLower.split(' ')[0].replace(/[^a-z0-9]/g, '');
      const newThread = {
        id: id,
        clientName: name,
        route: "Relocation tracking",
        ref: "#QL-" + Math.floor(10000 + Math.random() * 90000),
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=100",
        messages: []
      };

      // Add to local state and open
      threads.push(newThread);
      renderThreads();
      selectThread(id);
    }
  }

  // 5. Setup UI Event Listeners
  fab.onclick = (e) => {
    e.stopPropagation();
    toggleChat();
  };
  
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    toggleChat(false);
  };
  
  backBtn.onclick = (e) => {
    e.stopPropagation();
    backToList();
  };
  
  sendBtn.onclick = (e) => {
    e.stopPropagation();
    sendMessage();
  };

  chatInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Prevent input box height issues
  chatInput.oninput = () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = (chatInput.scrollHeight) + 'px';
  };

  // Close when clicking outside the panel (but not on FAB or buttons)
  document.addEventListener('click', (e) => {
    if (isOpen && !panel.contains(e.target) && !fab.contains(e.target)) {
      toggleChat(false);
    }
  });

  // Intercept button clicks in CRM
  document.addEventListener('click', function(e) {
    let btn = e.target.closest('button, a, [role="button"], [title="Send Message"]');
    
    // Also support clicking directly on the material icon inside or near a message action
    if (!btn && (e.target.classList.contains('material-symbols-outlined') || e.target.tagName === 'SPAN')) {
      btn = e.target.closest('button, a, [role="button"]') || e.target;
    }

    if (!btn) return;

    let isMessageBtn = false;
    let title = btn.getAttribute('title') || '';
    let text = btn.innerText || btn.textContent || '';
    
    if (title.toLowerCase().includes('message') || title.toLowerCase().includes('chat') || title === 'Send Message') {
      isMessageBtn = true;
    } else if (text.toLowerCase().includes('message') || text.toLowerCase().includes('chat')) {
      isMessageBtn = true;
    } else if (btn.classList.contains('material-symbols-outlined') && btn.textContent.trim() === 'chat') {
      isMessageBtn = true;
    } else if (btn.querySelector('.material-symbols-outlined') && btn.querySelector('.material-symbols-outlined').textContent.trim() === 'chat') {
      isMessageBtn = true;
    }
    
    if (isMessageBtn) {
      e.preventDefault();
      e.stopPropagation();
      
      let clientName = "";
      
      // Look inside parent row
      const row = btn.closest('tr');
      if (row) {
        const nameEl = row.querySelector('h3, td:first-child, .font-label-md');
        if (nameEl) clientName = nameEl.textContent.trim();
      }
      
      // Look inside parent cards/sections
      if (!clientName) {
        const container = btn.closest('.bg-surface-container-lowest, section, div');
        if (container) {
          const nameEl = container.querySelector('h1, h2, h3, .font-headline-xl');
          if (nameEl) clientName = nameEl.textContent.trim();
        }
      }
      
      if (clientName) {
        // Clean up clientName if it has multiple lines (like email/ref info)
        const lines = clientName.split('\n');
        if (lines.length > 0) {
          clientName = lines[0].trim();
        }
        openChatForClient(clientName);
      } else {
        toggleChat(true);
      }
    }
  });

  // 6. Bootstrap Initial Load
  loadData();
})();
