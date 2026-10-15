import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static("public"));

function createCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || "Jugador")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20) || "Jugador";
}

function getRoomState(room) {
  return {
    code: room.code,
    fen: room.game.fen(),
    turn: room.game.turn(),
    players: room.players.map(player => ({
      name: player.name,
      color: player.color
    })),
    spectators: room.spectators.size,
    status: room.result
      ? "finished"
      : room.players.length < 2
        ? "waiting"
        : "playing",
    result: room.result,
    history: room.game.history()
  };
}

function publishRoom(room) {
  io.to(room.code).emit("roomState", getRoomState(room));
}

function sendError(socket, message) {
  socket.emit("appError", message);
}

function removeFromRoom(socket, disconnected = false) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);

  socket.data.roomCode = null;
  socket.data.role = null;
  socket.leave(code);

  if (!room) return;

  const playerIndex = room.players.findIndex(
    player => player.id === socket.id
  );

  if (playerIndex !== -1) {
    const [leaver] = room.players.splice(playerIndex, 1);

    if (!room.result && room.players.length === 1) {
      const winner = room.players[0];

      room.result = {
        type: "forfeit",
        winnerName: winner.name,
        loserName: leaver.name,
        winnerColor: winner.color,
        message: `${leaver.name} salió de la partida.`
      };
    }

    if (room.players.length === 0 && room.spectators.size === 0) {
      rooms.delete(code);
      if (!disconnected) socket.emit("leftRoom");
      return;
    }

    publishRoom(room);
  } else {
    room.spectators.delete(socket.id);

    if (room.players.length === 0 && room.spectators.size === 0) {
      rooms.delete(code);
    } else {
      publishRoom(room);
    }
  }

  if (!disconnected) socket.emit("leftRoom");
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}) => {
    removeFromRoom(socket);

    const code = createCode();

    const room = {
      code,
      game: new Chess(),
      players: [
        {
          id: socket.id,
          name: cleanName(name),
          color: "w"
        }
      ],
      spectators: new Set(),
      result: null
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = "player";

    socket.emit("roomJoined", {
      role: "player",
      color: "w",
      room: getRoomState(room)
    });

    publishRoom(room);
  });

  socket.on("joinRoom", ({ code, name } = {}) => {
    const normalized = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalized);

    if (!room) {
      return sendError(
        socket,
        "No encontramos esa sala. Revisa el código e inténtalo otra vez."
      );
    }

    if (room.result) {
      return sendError(
        socket,
        "Esta partida ya terminó. Puedes entrar como espectador."
      );
    }

    if (room.players.length >= 2) {
      return sendError(
        socket,
        "La sala ya tiene dos jugadores. Puedes entrar como espectador."
      );
    }

    removeFromRoom(socket);

    const color = room.players[0]?.color === "w" ? "b" : "w";

    room.players.push({
      id: socket.id,
      name: cleanName(name),
      color
    });

    socket.join(normalized);
    socket.data.roomCode = normalized;
    socket.data.role = "player";

    socket.emit("roomJoined", {
      role: "player",
      color,
      room: getRoomState(room)
    });

    publishRoom(room);
  });

  socket.on("spectateRoom", ({ code, name } = {}) => {
    const normalized = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalized);

    if (!room) {
      return sendError(
        socket,
        "No encontramos esa sala. Revisa el código e inténtalo otra vez."
      );
    }

    removeFromRoom(socket);

    room.spectators.add(socket.id);

    socket.join(normalized);
    socket.data.roomCode = normalized;
    socket.data.role = "spectator";
    socket.data.name = cleanName(name);

    socket.emit("roomJoined", {
      role: "spectator",
      color: null,
      room: getRoomState(room)
    });

    publishRoom(room);
  });

  socket.on("makeMove", ({ from, to, promotion } = {}) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || socket.data.role !== "player") {
      return sendError(
        socket,
        "Solo los jugadores de la sala pueden mover piezas."
      );
    }

    if (room.result) {
      return sendError(socket, "La partida ya terminó.");
    }

    const player = room.players.find(
      item => item.id === socket.id
    );

    if (!player) {
      return sendError(
        socket,
        "No pudimos identificar tu lugar en esta partida."
      );
    }

    if (player.color !== room.game.turn()) {
      return sendError(socket, "Todavía no es tu turno.");
    }

    try {
      const move = room.game.move({
        from,
        to,
        promotion: promotion || "q"
      });

      if (!move) {
        return sendError(socket, "Ese movimiento no es válido.");
      }

      if (room.game.isCheckmate()) {
        const winnerColor =
          room.game.turn() === "w" ? "b" : "w";

        const winner = room.players.find(
          item => item.color === winnerColor
        );

        const loser = room.players.find(
          item => item.color !== winnerColor
        );

        room.result = {
          type: "checkmate",
          winnerName: winner?.name || "Ganador",
          loserName: loser?.name || "Oponente",
          winnerColor,
          message: "Jaque mate."
        };
      } else if (room.game.isDraw()) {
        room.result = {
          type: "draw",
          message: "La partida terminó en tablas."
        };
      }

      publishRoom(room);
    } catch {
      sendError(
        socket,
        "No se pudo realizar ese movimiento. Inténtalo de nuevo."
      );
    }
  });

  socket.on("leaveRoom", () => {
    removeFromRoom(socket);
  });

  socket.on("disconnect", () => {
    removeFromRoom(socket, true);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ChessArena listo en http://localhost:${PORT}`);
});