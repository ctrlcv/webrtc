let express = require("express");
let http = require("http");
let app = express();
let cors = require("cors");
let server = http.createServer(app);
let socketio = require("socket.io");

// CORS 설정 추가
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));

// Socket.IO 서버 생성 시 CORS 설정 추가
let io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 8081;

let users = {};
let socketToRoom = {};
const maximum = 2;

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    if (users[data.room]) {
      const length = users[data.room].length;
      if (length === maximum) {
        socket.to(socket.id).emit("room_full");
        return;
      }
      users[data.room].push({ id: socket.id });
    } else {
      users[data.room] = [{ id: socket.id }];
    }
    socketToRoom[socket.id] = data.room;

    socket.join(data.room);
    console.log(`[${socketToRoom[socket.id]}]: ${socket.id} enter`);

    const usersInThisRoom = users[data.room].filter(
      (user) => user.id !== socket.id
    );

    console.log(usersInThisRoom);

    io.sockets.to(socket.id).emit("all_users", usersInThisRoom);
  });

  socket.on("offer", (sdp) => {
    console.log("offer: " + socket.id);
    // 같은 방에 있는 다른 사용자에게만 전송
    const roomID = socketToRoom[socket.id];
    if (users[roomID]) {
      const otherUsers = users[roomID].filter(user => user.id !== socket.id);
      if (otherUsers.length > 0) {
        // 방의 다른 사용자에게만 offer 전송
        otherUsers.forEach(user => {
          io.to(user.id).emit("getOffer", sdp);
        });
      }
    }
  });

  socket.on("answer", (sdp) => {
    console.log("answer: " + socket.id);
    // 같은 방에 있는 다른 사용자에게만 전송
    const roomID = socketToRoom[socket.id];
    if (users[roomID]) {
      const otherUsers = users[roomID].filter(user => user.id !== socket.id);
      if (otherUsers.length > 0) {
        // 방의 다른 사용자에게만 answer 전송
        otherUsers.forEach(user => {
          io.to(user.id).emit("getAnswer", sdp);
        });
      }
    }
  });

  socket.on("candidate", (candidate) => {
    console.log("candidate: " + socket.id);
    // 같은 방에 있는 다른 사용자에게만 전송
    const roomID = socketToRoom[socket.id];
    if (users[roomID]) {
      const otherUsers = users[roomID].filter(user => user.id !== socket.id);
      if (otherUsers.length > 0) {
        // 방의 다른 사용자에게만 candidate 전송
        otherUsers.forEach(user => {
          io.to(user.id).emit("getCandidate", candidate);
        });
      }
    }
  });

  socket.on("disconnect", () => {
    console.log(`[${socketToRoom[socket.id]}]: ${socket.id} exit`);
    const roomID = socketToRoom[socket.id];
    let room = users[roomID];
    if (room) {
      room = room.filter((user) => user.id !== socket.id);
      users[roomID] = room;
      if (room.length === 0) {
        delete users[roomID];
        return;
      }
    }
    socket.broadcast.to(roomID).emit("user_exit", { id: socket.id });
    console.log(users);
  });
});

server.listen(PORT, () => {
  console.log(`-------------------------------------------------------`)
  console.log(` server running on ${PORT}`);
  console.log(`-------------------------------------------------------`)
});