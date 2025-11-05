import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || window.location.origin;
const socket = io(API_URL, {
  transports: ['websocket', 'polling']
});

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [username, setUsername] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  
  const [activeView, setActiveView] = useState('home');
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState([]);
  const [typing, setTyping] = useState(null);
  
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState('text');
  
  const messagesEndRef = useRef(null);
  const typingTimeout = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/servers`)
      .then(res => res.json())
      .then(data => setServers(data))
      .catch(err => console.error('Ошибка загрузки серверов:', err));
  }, []);

  const loadUserData = useCallback(async (userId) => {
    try {
      const [friendsRes, requestsRes, conversationsRes] = await Promise.all([
        fetch(`${API_URL}/api/users/${userId}/friends`),
        fetch(`${API_URL}/api/users/${userId}/friend-requests`),
        fetch(`${API_URL}/api/users/${userId}/conversations`)
      ]);

      setFriends(await friendsRes.json());
      setFriendRequests(await requestsRes.json());
      setConversations(await conversationsRes.json());
    } catch (err) {
      console.error('Ошибка загрузки данных пользователя:', err);
    }
  }, []);

  const loadConversations = useCallback(async (userId) => {
    try {
      const res = await fetch(`${API_URL}/api/users/${userId}/conversations`);
      setConversations(await res.json());
    } catch (err) {
      console.error('Ошибка загрузки бесед:', err);
    }
  }, []);

  useEffect(() => {
    socket.on('user:registered', (user) => {
      setCurrentUser(user);
      loadUserData(user.id);
    });

    socket.on('message:receive', (message) => {
      setMessages(prev => [...prev, message]);
    });

    socket.on('dm:receive', (message) => {
      setDmMessages(prev => [...prev, message]);
    });

    socket.on('users:update', (usersList) => {
      setUsers(usersList);
    });

    socket.on('typing:user', (data) => {
      setTyping(data.username);
      setTimeout(() => setTyping(null), 2000);
    });

    socket.on('friend:request:received', (request) => {
      setFriendRequests(prev => [...prev, request]);
    });

    socket.on('friend:added', (data) => {
      setFriends(prev => [...prev, data.friend]);
    });

    socket.on('channel:created', (data) => {
      setChannels(prev => {
        if (activeServer?.id === data.serverId) {
          return [...prev, data.channel];
        }
        return prev;
      });
    });

    socket.on('channel:deleted', (data) => {
      setChannels(prev => {
        if (activeServer?.id === data.serverId) {
          return prev.filter(ch => ch.id !== data.channelId);
        }
        return prev;
      });
      if (activeChannel?.id === data.channelId) {
        setActiveChannel(null);
      }
    });

    return () => {
      socket.off('user:registered');
      socket.off('message:receive');
      socket.off('dm:receive');
      socket.off('users:update');
      socket.off('typing:user');
      socket.off('friend:request:received');
      socket.off('friend:added');
      socket.off('channel:created');
      socket.off('channel:deleted');
    };
  }, [activeServer, activeChannel, loadUserData]);

  useEffect(() => {
    if (activeServer) {
      fetch(`${API_URL}/api/servers/${activeServer.id}/channels`)
        .then(res => res.json())
        .then(data => {
          setChannels(data);
          if (data.length > 0) {
            setActiveChannel(data[0]);
          }
        })
        .catch(err => console.error('Ошибка загрузки каналов:', err));
      setActiveView('server');
    }
  }, [activeServer]);

  useEffect(() => {
    if (activeChannel) {
      fetch(`${API_URL}/api/channels/${activeChannel.id}/messages`)
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(err => console.error('Ошибка загрузки сообщений:', err));

      socket.emit('channel:join', activeChannel.id);
    }
  }, [activeChannel]);

  useEffect(() => {
    if (activeConversation) {
      fetch(`${API_URL}/api/conversations/${activeConversation.id}/messages`)
        .then(res => res.json())
        .then(data => setDmMessages(data))
        .catch(err => console.error('Ошибка загрузки DM:', err));

      socket.emit('conversation:join', activeConversation.id);
      setActiveView('dm');
    }
  }, [activeConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, dmMessages]);

  useEffect(() => {
    if (searchQuery.length > 0 && currentUser) {
      const timer = setTimeout(() => {
        fetch(`${API_URL}/api/users/search?q=${searchQuery}&userId=${currentUser.id}`)
          .then(res => res.json())
          .then(data => setSearchResults(data))
          .catch(err => console.error('Ошибка поиска:', err));
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, currentUser]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      socket.emit('user:register', { username });
      setIsLoggedIn(true);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    if (activeView === 'dm' && activeConversation) {
      socket.emit('dm:send', {
        text: newMessage,
        conversationId: activeConversation.id
      });
    } else if (activeChannel) {
      socket.emit('message:send', {
        text: newMessage,
        channelId: activeChannel.id
      });
    }
    
    setNewMessage('');
  };

  const handleTyping = () => {
    if (activeView === 'dm' && activeConversation) {
      socket.emit('typing:start', { conversationId: activeConversation.id });
    } else if (activeChannel) {
      socket.emit('typing:start', { channelId: activeChannel.id });
    }
    
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing:stop');
    }, 1000);
  };

  const handleSendFriendRequest = (userId) => {
    socket.emit('friend:request', { userId });
    setShowSearch(false);
    setSearchQuery('');
  };

  const handleAcceptFriend = (userId) => {
    socket.emit('friend:accept', { userId });
    setFriendRequests(prev => prev.filter(req => req.from.id !== userId));
  };

  const handleRejectFriend = (userId) => {
    socket.emit('friend:reject', { userId });
    setFriendRequests(prev => prev.filter(req => req.from.id !== userId));
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!newChannelName.trim() || !activeServer) return;

    try {
      const res = await fetch(`${API_URL}/api/servers/${activeServer.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newChannelName, type: newChannelType })
      });

      if (res.ok) {
        setShowCreateChannel(false);
        setNewChannelName('');
        setNewChannelType('text');
      }
    } catch (err) {
      console.error('Ошибка создания канала:', err);
    }
  };

  const handleDeleteChannel = async (channelId) => {
    if (!window.confirm('Удалить канал?')) return;

    try {
      await fetch(`${API_URL}/api/servers/${activeServer.id}/channels/${channelId}`, {
        method: 'DELETE'
      });
    } catch (err) {
      console.error('Ошибка удаления канала:', err);
    }
  };

  const openDirectMessage = (friend) => {
    const conv = conversations.find(c => c.user.id === friend.id);
    if (conv) {
      setActiveConversation(conv);
      setActiveChannel(null);
    }
  };

  const goToHome = () => {
    setActiveView('home');
    setActiveServer(null);
    setActiveChannel(null);
    setActiveConversation(null);
  };

  if (!isLoggedIn) {
    return (
      <div className="login-screen">
        <div className="login-box">
          <div className="login-logo">💬</div>
          <h1>Добро пожаловать!</h1>
          <p>Введите имя пользователя</p>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Ваше имя..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            <button type="submit">Войти</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="servers-sidebar">
        <div 
          className={`server-icon home ${activeView === 'home' ? 'active' : ''}`}
          onClick={goToHome}
        >
          <span>🏠</span>
        </div>
        <div className="separator"></div>
        {servers.map(server => (
          <div
            key={server.id}
            className={`server-icon ${activeServer?.id === server.id ? 'active' : ''}`}
            onClick={() => setActiveServer(server)}
            title={server.name}
          >
            <span>{server.icon}</span>
          </div>
        ))}
        <div className="server-icon add" title="Добавить сервер">
          <span>+</span>
        </div>
      </div>

      <div className="channels-sidebar">
        {activeView === 'home' ? (
          <>
            <div className="server-header">
              <h3>Личные сообщения</h3>
            </div>
            
            <div className="home-nav">
              <div className="nav-item" onClick={() => setShowSearch(true)}>
                <span className="nav-icon">👥</span>
                <span>Друзья</span>
                {friendRequests.length > 0 && (
                  <span className="badge">{friendRequests.length}</span>
                )}
              </div>
            </div>

            <div className="dm-section">
              <div className="section-title">Личные сообщения</div>
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`dm-item ${activeConversation?.id === conv.id ? 'active' : ''}`}
                  onClick={() => setActiveConversation(conv)}
                >
                  <div className="dm-avatar">{conv.user?.username?.[0]?.toUpperCase() || '?'}</div>
                  <div className="dm-info">
                    <div className="dm-name">{conv.user?.username || 'Неизвестный'}</div>
                    {conv.lastMessage && (
                      <div className="dm-last-message">
                        {conv.lastMessage.text.substring(0, 20)}...
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="server-header">
              <h3>{activeServer?.name}</h3>
              <span className="dropdown">▼</span>
            </div>
            
            <div className="channels-list">
              <div className="channels-header">
                <span>ТЕКСТОВЫЕ КАНАЛЫ</span>
                <button 
                  className="add-channel-btn"
                  onClick={() => setShowCreateChannel(true)}
                  title="Создать канал"
                >
                  +
                </button>
              </div>
              
              {channels.filter(ch => ch.type === 'text').map(channel => (
                <div
                  key={channel.id}
                  className={`channel ${activeChannel?.id === channel.id ? 'active' : ''}`}
                  onClick={() => setActiveChannel(channel)}
                >
                  <span className="channel-icon">#</span>
                  <span className="channel-name">{channel.name}</span>
                  <button
                    className="delete-channel-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChannel(channel.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}

              {channels.filter(ch => ch.type === 'voice').length > 0 && (
                <>
                  <div className="channels-header">
                    <span>ГОЛОСОВЫЕ КАНАЛЫ</span>
                  </div>
                  {channels.filter(ch => ch.type === 'voice').map(channel => (
                    <div
                      key={channel.id}
                      className="channel"
                    >
                      <span className="channel-icon">🔊</span>
                      <span className="channel-name">{channel.name}</span>
                      <button
                        className="delete-channel-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteChannel(channel.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}

        <div className="user-panel">
          <div className="user-info">
            <div className="user-avatar">{currentUser?.username?.[0]?.toUpperCase() || '?'}</div>
            <div className="user-details">
              <div className="user-name">{currentUser?.username || 'Пользователь'}</div>
              <div className="user-status">🟢 В сети</div>
            </div>
          </div>
          <div className="user-controls">
            <button className="icon-btn" title="Микрофон">🎤</button>
            <button className="icon-btn" title="Наушники">🎧</button>
            <button className="icon-btn" title="Настройки">⚙️</button>
          </div>
        </div>
      </div>

      <div className="main-content">
        {activeView === 'home' && !activeConversation ? (
          <div className="home-content">
            <div className="home-welcome">
              <h2>👋 Привет, {currentUser?.username}!</h2>
              <p>Выберите друга для начала общения</p>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-header">
              {activeView === 'dm' && activeConversation ? (
                <>
                  <div className="dm-avatar small">{activeConversation.user?.username?.[0]?.toUpperCase() || '?'}</div>
                  <h3>{activeConversation.user?.username || 'Неизвестный'}</h3>
                </>
              ) : (
                <>
                  <span className="channel-icon">#</span>
                  <h3>{activeChannel?.name || 'канал'}</h3>
                </>
              )}
              <div className="header-icons">
                <button className="icon-btn">🔔</button>
                <button className="icon-btn">📌</button>
                <button className="icon-btn">👥</button>
                <button className="icon-btn">🔍</button>
              </div>
            </div>

            <div className="messages-area">
              {(activeView === 'dm' ? dmMessages : messages).map((msg, index) => (
                <div key={msg.id || index} className="message">
                  <div className="message-avatar">
                    {msg.user?.username?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="message-content">
                    <div className="message-header">
                      <span className="message-author">{msg.user?.username || 'Неизвестный'}</span>
                      <span className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="message-text">{msg.text}</div>
                  </div>
                </div>
              ))}
              {typing && (
                <div className="typing-indicator">
                  <span>{typing} печатает...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="message-input-container">
              <form onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder={`Написать ${activeView === 'dm' ? activeConversation?.user?.username || '' : '#' + (activeChannel?.name || '')}`}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={handleTyping}
                />
                <div className="input-icons">
                  <button type="button" className="icon-btn">➕</button>
                  <button type="button" className="icon-btn">😊</button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>

      <div className="members-sidebar">
        {activeView === 'server' ? (
          <>
            <div className="members-header">
              Участники — {users.length}
            </div>
            <div className="members-list">
              <div className="members-group">
                <div className="group-title">В сети — {users.length}</div>
                {users.map(user => (
                  <div key={user.id} className="member">
                    <div className="member-avatar">
                      {user.username?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="member-name">{user.username}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="members-header">
              Друзья — {friends.length}
            </div>
            <div className="members-list">
              <div className="members-group">
                {friends.map(friend => (
                  <div 
                    key={friend.id} 
                    className="member clickable"
                    onClick={() => openDirectMessage(friend)}
                  >
                    <div className="member-avatar">
                      {friend.username?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="member-name">{friend.username}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {showSearch && (
        <div className="modal-overlay" onClick={() => setShowSearch(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Найти друзей</h3>
              <button className="close-btn" onClick={() => setShowSearch(false)}>×</button>
            </div>
            
            {friendRequests.length > 0 && (
              <div className="friend-requests">
                <h4>Заявки в друзья ({friendRequests.length})</h4>
                {friendRequests.map(request => (
                  <div key={request.id} className="friend-request">
                    <div className="request-user">
                      <div className="member-avatar">
                        {request.from?.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <span>{request.from?.username || 'Неизвестный'}</span>
                    </div>
                    <div className="request-actions">
                      <button 
                        className="btn-accept"
                        onClick={() => handleAcceptFriend(request.from.id)}
                      >
                        ✓
                      </button>
                      <button 
                        className="btn-reject"
                        onClick={() => handleRejectFriend(request.from.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="search-section">
              <input
                type="text"
                placeholder="Поиск по имени..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              
              <div className="search-results">
                {searchResults.map(user => (
                  <div key={user.id} className="search-result">
                    <div className="result-user">
                      <div className="member-avatar">
                        {user.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <span>{user.username}</span>
                    </div>
                    <button 
                      className="btn-add-friend"
                      onClick={() => handleSendFriendRequest(user.id)}
                    >
                      Добавить в друзья
                    </button>
                  </div>
                ))}
                {searchQuery && searchResults.length === 0 && (
                  <div className="no-results">Пользователи не найдены</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateChannel && (
        <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Создать канал</h3>
              <button className="close-btn" onClick={() => setShowCreateChannel(false)}>×</button>
            </div>
            
            <form onSubmit={handleCreateChannel} className="create-channel-form">
              <div className="form-group">
                <label>Название канала</label>
                <input
                  type="text"
                  placeholder="новый-канал"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  autoFocus
                />
              </div>
              
              <div className="form-group">
                <label>Тип канала</label>
                <select 
                  value={newChannelType} 
                  onChange={(e) => setNewChannelType(e.target.value)}
                >
                  <option value="text">💬 Текстовый</option>
                  <option value="voice">🔊 Голосовой</option>
                </select>
              </div>
              
              <div className="form-actions">
                <button type="button" onClick={() => setShowCreateChannel(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;