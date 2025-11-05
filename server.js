const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Настройка CORS для продакшена
const allowedOrigins = [
  'http://localhost:3000',
  process.env.CLIENT_URL,
  process.env.RENDER_EXTERNAL_URL
].filter(Boolean);

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
  credentials: true
}));

app.use(express.json());

// Serve static files в продакшене
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// Хранилище данных
const servers = {
  '1': {
    id: '1',
    name: 'Мой сервер',
    icon: '🎮',
    ownerId: null,
    channels: {
      '1': { id: '1', name: 'общий', type: 'text' },
      '2': { id: '2', name: 'голосовой', type: 'voice' },
      '3': { id: '3', name: 'мемы', type: 'text' }
    }
  },
  '2': {
    id: '2',
    name: 'Геймеры',
    icon: '🎯',
    ownerId: null,
    channels: {
      '4': { id: '4', name: 'флуд', type: 'text' },
      '5': { id: '5', name: 'игры', type: 'text' }
    }
  }
};

const messages = {};
const dmMessages = {};
const users = new Map();
const allUsers = new Map();
const friendRequests = new Map();
const friends = new Map();
const directMessages = new Map();
const conversations = new Map();

// REST API - Серверы
app.get('/api/servers', (req, res) => {
  res.json(Object.values(servers));
});

app.get('/api/servers/:serverId/channels', (req, res) => {
  const server = servers[req.params.serverId];
  res.json(server ? Object.values(server.channels) : []);
});

app.post('/api/servers/:serverId/channels', (req, res) => {
  const { name, type } = req.body;
  const server = servers[req.params.serverId];
  
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const channelId = uuidv4();
  const newChannel = {
    id: channelId,
    name: name,
    type: type || 'text'
  };

  server.channels[channelId] = newChannel;
  io.emit('channel:created', { serverId: server.id, channel: newChannel });
  
  res.json(newChannel);
});

app.delete('/api/servers/:serverId/channels/:channelId', (req, res) => {
  const server = servers[req.params.serverId];
  
  if (!server || !server.channels[req.params.channelId]) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  delete server.channels[req.params.channelId];
  io.emit('channel:deleted', { 
    serverId: server.id, 
    channelId: req.params.channelId 
  });
  
  res.json({ success: true });
});

app.get('/api/channels/:channelId/messages', (req, res) => {
  res.json(messages[req.params.channelId] || []);
});

app.get('/api/users/search', (req, res) => {
  const query = req.query.q?.toLowerCase() || '';
  const currentUserId = req.query.userId;
  
  if (!query) {
    return res.json([]);
  }

  const results = Array.from(allUsers.values())
    .filter(user => 
      user.id !== currentUserId && 
      user.username.toLowerCase().includes(query)
    )
    .slice(0, 20);
  
  res.json(results);
});

app.get('/api/users/online', (req, res) => {
  res.json(Array.from(users.values()));
});

app.get('/api/users/:userId/friends', (req, res) => {
  const userFriends = friends.get(req.params.userId) || [];
  const friendsData = userFriends
    .map(friendId => allUsers.get(friendId))
    .filter(Boolean);
  res.json(friendsData);
});

app.get('/api/users/:userId/friend-requests', (req, res) => {
  const requests = friendRequests.get(req.params.userId) || [];
  res.json(requests);
});

app.get('/api/users/:userId/conversations', (req, res) => {
  const userConversations = directMessages.get(req.params.userId) || [];
  const conversationsData = userConversations.map(convId => {
    const conv = conversations.get(convId);
    if (!conv) return null;
    
    const otherUserId = conv.user1 === req.params.userId ? conv.user2 : conv.user1;
    const otherUser = allUsers.get(otherUserId);
    
    return {
      id: convId,
      user: otherUser,
      lastMessage: (dmMessages[convId] || []).slice(-1)[0]
    };
  }).filter(Boolean);
  
  res.json(conversationsData);
});

app.get('/api/conversations/:conversationId/messages', (req, res) => {
  res.json(dmMessages[req.params.conversationId] || []);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    users: users.size,
    conversations: conversations.size,
    timestamp: new Date().toISOString()
  });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  socket.on('user:register', (userData) => {
    const user = {
      id: userData.id || uuidv4(),
      socketId: socket.id,
      username: userData.username || `User${Math.floor(Math.random() * 1000)}`,
      avatar: `https://ui-avatars.com/api/?name=${userData.username}&background=random`,
      status: 'online'
    };
    
    users.set(socket.id, user);
    allUsers.set(user.id, user);
    socket.userId = user.id;
    
    socket.emit('user:registered', user);
    io.emit('users:update', Array.from(users.values()));
  });

  socket.on('channel:join', (channelId) => {
    socket.join(channelId);
  });

  socket.on('message:send', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const message = {
      id: uuidv4(),
      text: data.text,
      channelId: data.channelId,
      user: user,
      timestamp: new Date().toISOString()
    };

    if (!messages[data.channelId]) {
      messages[data.channelId] = [];
    }
    messages[data.channelId].push(message);
    io.to(data.channelId).emit('message:receive', message);
  });

  socket.on('friend:request', (data) => {
    const sender = users.get(socket.id);
    if (!sender) return;

    const request = {
      id: uuidv4(),
      from: sender,
      to: data.userId,
      timestamp: new Date().toISOString()
    };

    if (!friendRequests.has(data.userId)) {
      friendRequests.set(data.userId, []);
    }
    friendRequests.get(data.userId).push(request);

    const recipientSocket = Array.from(users.entries())
      .find(([_, user]) => user.id === data.userId)?.[0];
    
    if (recipientSocket) {
      io.to(recipientSocket).emit('friend:request:received', request);
    }

    socket.emit('friend:request:sent', { userId: data.userId });
  });

  socket.on('friend:accept', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const requests = friendRequests.get(user.id) || [];
    const requestIndex = requests.findIndex(r => r.from.id === data.userId);
    if (requestIndex > -1) {
      requests.splice(requestIndex, 1);
    }

    if (!friends.has(user.id)) {
      friends.set(user.id, []);
    }
    if (!friends.has(data.userId)) {
      friends.set(data.userId, []);
    }
    
    friends.get(user.id).push(data.userId);
    friends.get(data.userId).push(user.id);

    const conversationId = uuidv4();
    conversations.set(conversationId, {
      id: conversationId,
      user1: user.id,
      user2: data.userId
    });

    if (!directMessages.has(user.id)) {
      directMessages.set(user.id, []);
    }
    if (!directMessages.has(data.userId)) {
      directMessages.set(data.userId, []);
    }

    directMessages.get(user.id).push(conversationId);
    directMessages.get(data.userId).push(conversationId);

    socket.emit('friend:added', { 
      friend: allUsers.get(data.userId),
      conversationId 
    });

    const friendSocket = Array.from(users.entries())
      .find(([_, u]) => u.id === data.userId)?.[0];
    
    if (friendSocket) {
      io.to(friendSocket).emit('friend:added', { 
        friend: user,
        conversationId 
      });
    }
  });

  socket.on('friend:reject', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const requests = friendRequests.get(user.id) || [];
    const requestIndex = requests.findIndex(r => r.from.id === data.userId);
    if (requestIndex > -1) {
      requests.splice(requestIndex, 1);
    }

    socket.emit('friend:request:rejected', { userId: data.userId });
  });

  socket.on('conversation:join', (conversationId) => {
    socket.join(conversationId);
  });

  socket.on('dm:send', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const message = {
      id: uuidv4(),
      text: data.text,
      conversationId: data.conversationId,
      user: user,
      timestamp: new Date().toISOString()
    };

    if (!dmMessages[data.conversationId]) {
      dmMessages[data.conversationId] = [];
    }
    dmMessages[data.conversationId].push(message);
    io.to(data.conversationId).emit('dm:receive', message);
  });

  socket.on('typing:start', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    if (data.channelId) {
      socket.to(data.channelId).emit('typing:user', {
        username: user.username,
        channelId: data.channelId
      });
    } else if (data.conversationId) {
      socket.to(data.conversationId).emit('typing:user', {
        username: user.username,
        conversationId: data.conversationId
      });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      allUsers.delete(user.id);
    }
    users.delete(socket.id);
    io.emit('users:update', Array.from(users.values()));
    console.log('Пользователь отключился:', socket.id);
  });
});

// Serve React app в продакшене
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📝 Режим: ${process.env.NODE_ENV || 'development'}`);
});