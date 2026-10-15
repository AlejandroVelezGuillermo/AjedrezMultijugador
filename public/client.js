const socket = io();

const $ = id => document.getElementById(id);

const menuScreen = $("menuScreen");
const gameScreen = $("gameScreen");
const resultScreen = $("resultScreen");
const boardElement = $("chessBoard");

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ranks = [8, 7, 6, 5, 4, 3, 2, 1];

const pieceSymbols = {
  w: {
    k: "♔",
    q: "♕",
    r: "♖",
    b: "♗",
    n: "♘",
    p: "♙"
  },
  b: {
    k: "♚",
    q: "♛",
    r: "♜",
    b: "♝",
    n: "♞",
    p: "♟"
  }
};

const pieceNames = {
  k: "rey",
  q: "reina",
  r: "torre",
  b: "alfil",
  n: "caballo",
  p: "peón"
};

let myRole = null;
let myColor = null;
let currentRoom = null;
let currentState = null;
let selectedSquare = null;
let legalTargets = new Map();
let localGame = null;
let lastMove = null;
let lastResultRoom = null;

function setMessage(id, message = "", success = false) {
  const element = $(id);

  element.textContent = message;
  element.style.color = success ? "#8ef0c1" : "";
}

function showScreen(screenName) {
  menuScreen.classList.toggle("hidden", screenName !== "menu");
  gameScreen.classList.toggle("hidden", screenName !== "game");
  resultScreen.classList.toggle("hidden", screenName !== "result");
}

function getPlayerName() {
  return $("playerName").value.trim().slice(0, 20) || "Jugador";
}

function normalizeRoomCode() {
  $("roomCode").value = $("roomCode")
    .value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function getChessInstance(fen) {
  if (typeof window.Chess !== "function") {
    return null;
  }

  try {
    return new window.Chess(fen);
  } catch {
    return null;
  }
}

function enterRoom(data) {
  myRole = data.role;
  myColor = data.color;
  currentRoom = data.room.code;
  currentState = data.room;

  selectedSquare = null;
  legalTargets.clear();
  lastMove = null;
  lastResultRoom = null;

  localGame = getChessInstance(data.room.fen);

  $("roomCodeDisplay").textContent = data.room.code;

  $("roomSubtitle").textContent =
    myRole === "spectator"
      ? "Modo espectador · partida en directo"
      : `Juegas con piezas ${myColor === "w" ? "blancas" : "negras"}`;

  setMessage("menuMessage");
  setMessage("gameMessage");

  if (!localGame) {
    setMessage(
      "gameMessage",
      "No se pudo cargar el sistema de movimientos. Revisa tu conexión a internet."
    );
  }

  showScreen("game");
  renderRoom(data.room);
}

function getLegalMoves(square) {
  legalTargets.clear();

  if (
    !localGame ||
    myRole !== "player" ||
    !currentState ||
    currentState.status !== "playing" ||
    currentState.turn !== myColor
  ) {
    return;
  }

  try {
    const moves = localGame.moves({
      square,
      verbose: true
    });

    for (const move of moves) {
      legalTargets.set(
        move.to,
        move.captured ? "capture" : "move"
      );
    }
  } catch {
    setMessage(
      "gameMessage",
      "No pudimos calcular los movimientos posibles de esa pieza."
    );
  }
}

function getBoardPieces(fen) {
  const placement = fen.split(" ")[0].split("/");
  const pieces = {};

  placement.forEach((row, rowIndex) => {
    let fileIndex = 0;

    for (const character of row) {
      if (/\d/.test(character)) {
        fileIndex += Number(character);
        continue;
      }

      const square = files[fileIndex] + (8 - rowIndex);

      pieces[square] = {
        color: character === character.toUpperCase() ? "w" : "b",
        type: character.toLowerCase()
      };

      fileIndex++;
    }
  });

  return pieces;
}

function renderBoard(fen) {
  const pieces = getBoardPieces(fen);

  boardElement.innerHTML = "";

  const displayRanks =
    myColor === "b" ? [...ranks].reverse() : ranks;

  const displayFiles =
    myColor === "b" ? [...files].reverse() : files;

  for (const rank of displayRanks) {
    for (const file of displayFiles) {
      const square = `${file}${rank}`;
      const piece = pieces[square];

      const button = document.createElement("button");

      button.type = "button";
      button.className = "square";

      const isLight =
        (files.indexOf(file) + rank) % 2 !== 0;

      button.classList.add(isLight ? "light" : "dark");
      button.dataset.square = square;

      const pieceDescription = piece
        ? `${piece.color === "w" ? "blanca" : "negra"} ${pieceNames[piece.type]}`
        : "vacía";

      button.setAttribute(
        "aria-label",
        `${square}, ${pieceDescription}`
      );

      if (selectedSquare === square) {
        button.classList.add("selected");
      }

      if (
        lastMove &&
        (lastMove.from === square || lastMove.to === square)
      ) {
        button.classList.add("last-move");
      }

      if (legalTargets.has(square)) {
        button.classList.add(
          legalTargets.get(square) === "capture"
            ? "possible-capture"
            : "possible-move"
        );
      }

      if (piece) {
        const pieceElement = document.createElement("span");

        pieceElement.className =
          `piece ${piece.color === "w" ? "white" : "black"}`;

        pieceElement.textContent =
          pieceSymbols[piece.color][piece.type];

        pieceElement.setAttribute("aria-hidden", "true");

        button.appendChild(pieceElement);
      }

      button.addEventListener("click", () => {
        onSquareClick(square, piece);
      });

      boardElement.appendChild(button);
    }
  }
}

function onSquareClick(square, piece) {
  if (!currentState || currentState.status !== "playing") {
    setMessage("gameMessage", "La partida todavía no está en juego.");
    return;
  }

  if (myRole === "spectator") {
    setMessage(
      "gameMessage",
      "Estás en modo espectador. Puedes observar, pero no mover piezas."
    );
    return;
  }

  if (currentState.turn !== myColor) {
    setMessage(
      "gameMessage",
      "Espera tu turno. El indicador te avisará cuando puedas mover."
    );
    return;
  }

  // Si se seleccionó una pieza y después una casilla legal,
  // se solicita al servidor que realice el movimiento.
  if (selectedSquare && legalTargets.has(square)) {
    const from = selectedSquare;
    const targetType = legalTargets.get(square);

    selectedSquare = null;
    legalTargets.clear();

    setMessage(
      "gameMessage",
      targetType === "capture"
        ? "Enviando captura…"
        : "Enviando movimiento…",
      true
    );

    socket.emit("makeMove", {
      from,
      to: square,
      promotion: "q"
    });

    renderBoard(currentState.fen);
    return;
  }

  // Selección de una pieza propia.
  if (piece && piece.color === myColor) {
    selectedSquare = square;
    getLegalMoves(square);

    if (legalTargets.size > 0) {
      $("boardHint").textContent =
        "Los movimientos legales están resaltados en verde. Selecciona una casilla.";

      setMessage(
        "gameMessage",
        `Pieza seleccionada en ${square.toUpperCase()}. Elige un destino resaltado.`,
        true
      );
    } else {
      $("boardHint").textContent =
        "Esta pieza no tiene movimientos legales disponibles.";

      setMessage(
        "gameMessage",
        "Esta pieza no tiene movimientos legales disponibles."
      );
    }

    renderBoard(currentState.fen);
    return;
  }

  // Si se selecciona otra casilla no válida, se limpia la selección.
  selectedSquare = null;
  legalTargets.clear();

  $("boardHint").textContent =
    "Selecciona una de tus piezas para ver sus movimientos posibles.";

  setMessage("gameMessage", "Selecciona una pieza de tu color.");

  renderBoard(currentState.fen);
}

function updateTurnIndicator(room) {
  const panel = $("turnIndicator");

  panel.classList.remove("my-turn", "waiting-turn");

  const currentPlayer = room.players.find(
    player => player.color === room.turn
  );

  const currentPlayerName = currentPlayer?.name || "Jugador";

  const isMyTurn =
    myRole === "player" &&
    room.status === "playing" &&
    room.turn === myColor;

  if (room.status === "finished") {
    $("turnBadge").textContent = "FINALIZADA";
    $("turnTitle").textContent = "La partida ha terminado";

    $("turnDescription").textContent =
      room.result?.message || "Gracias por jugar.";

    $("turnDot").style.background = "#aab7ca";
    panel.classList.add("waiting-turn");
    return;
  }

  if (myRole === "spectator") {
    $("turnBadge").textContent = "OBSERVANDO";
    $("turnTitle").textContent = `Turno de ${currentPlayerName}`;

    $("turnDescription").textContent =
      "Estás viendo la partida en tiempo real. El tablero se actualizará con cada movimiento.";

    $("turnDot").style.background = "#c0c8ff";
    panel.classList.add("waiting-turn");
    return;
  }

  if (room.status === "waiting") {
    $("turnBadge").textContent = "EN ESPERA";
    $("turnTitle").textContent = "Esperando a otro jugador";

    $("turnDescription").textContent =
      "Comparte el código de la sala. La partida comenzará cuando se una tu rival.";

    $("turnDot").style.background = "#aab7ca";
    panel.classList.add("waiting-turn");
    return;
  }

  if (isMyTurn) {
    $("turnBadge").textContent = "TU TURNO";
    $("turnTitle").textContent = "¡Te toca mover!";

    $("turnDescription").textContent =
      "Selecciona una pieza de tu color. Los movimientos válidos aparecerán resaltados.";

    $("turnDot").style.background = "#58d6a0";
    panel.classList.add("my-turn");
    return;
  }

  $("turnBadge").textContent = "TURNO RIVAL";
  $("turnTitle").textContent = `Turno de ${currentPlayerName}`;

  $("turnDescription").textContent =
    "Tu rival está jugando. Puedes revisar el tablero mientras esperas.";

  $("turnDot").style.background = "#aab7ca";
  panel.classList.add("waiting-turn");
}

function renderRoom(room) {
  currentState = room;
  localGame = getChessInstance(room.fen);

  if (
    selectedSquare &&
    (room.status !== "playing" || room.turn !== myColor)
  ) {
    selectedSquare = null;
    legalTargets.clear();
  }

  const whitePlayer = room.players.find(
    player => player.color === "w"
  );

  const blackPlayer = room.players.find(
    player => player.color === "b"
  );

  $("whiteName").textContent =
    whitePlayer?.name || "Esperando jugador…";

  $("blackName").textContent =
    blackPlayer?.name || "Esperando jugador…";

  $("whiteMeta").textContent =
    myRole === "player" && myColor === "w"
      ? "Tú · piezas blancas"
      : "Piezas blancas";

  $("blackMeta").textContent =
    myRole === "player" && myColor === "b"
      ? "Tú · piezas negras"
      : "Piezas negras";

  $("whiteTurnMark").classList.toggle(
    "active",
    room.status === "playing" && room.turn === "w"
  );

  $("blackTurnMark").classList.toggle(
    "active",
    room.status === "playing" && room.turn === "b"
  );

  $("playersCount").textContent =
    `${room.players.length} de 2 jugadores`;

  $("spectatorsCount").textContent =
    `${room.spectators} ${room.spectators === 1 ? "espectador" : "espectadores"}`;

  updateTurnIndicator(room);
  renderBoard(room.fen);

  if (room.status === "finished" && room.result) {
    showResult(room.result);
  }
}

function showResult(result) {
  if (lastResultRoom === currentRoom) {
    return;
  }

  lastResultRoom = currentRoom;

  const isWinner =
    myRole === "player" &&
    (
      (
        result.type === "forfeit" ||
        result.type === "checkmate"
      ) &&
      result.winnerColor === myColor
    );

  if (result.type === "draw") {
    $("resultIcon").textContent = "🤝";
    $("resultTitle").textContent = "¡Empate!";
    $("resultDescription").textContent = result.message;
  } else if (myRole === "spectator") {
    $("resultIcon").textContent = "♟";
    $("resultTitle").textContent = "Partida finalizada";

    $("resultDescription").textContent =
      result.message ||
      `Ganador: ${result.winnerName || "No disponible"}`;
  } else if (isWinner) {
    $("resultIcon").textContent = "🏆";
    $("resultTitle").textContent = "¡Victoria!";

    $("resultDescription").textContent =
      result.type === "forfeit"
        ? `Has ganado porque ${result.loserName || "tu rival"} salió de la partida.`
        : "Has ganado la partida. ¡Bien jugado!";
  } else {
    $("resultIcon").textContent = "♟";
    $("resultTitle").textContent = "Partida finalizada";

    $("resultDescription").textContent =
      result.message || "La partida ha terminado.";
  }

  showScreen("result");
}

function leaveToMenu() {
  if (currentRoom) {
    socket.emit("leaveRoom");
  }

  myRole = null;
  myColor = null;
  currentRoom = null;
  currentState = null;
  selectedSquare = null;
  legalTargets.clear();
  localGame = null;
  lastMove = null;
  lastResultRoom = null;

  setMessage("menuMessage");
  setMessage("gameMessage");

  showScreen("menu");
}

// Crear una sala nueva.
$("createBtn").addEventListener("click", () => {
  setMessage("menuMessage");

  socket.emit("createRoom", {
    name: getPlayerName()
  });
});

// Entrar como jugador.
$("joinBtn").addEventListener("click", () => {
  normalizeRoomCode();

  const code = $("roomCode").value.trim();

  if (code.length !== 6) {
    setMessage(
      "menuMessage",
      "El código debe tener exactamente 6 caracteres."
    );
    return;
  }

  setMessage("menuMessage");

  socket.emit("joinRoom", {
    name: getPlayerName(),
    code
  });
});

// Entrar como espectador.
$("spectateBtn").addEventListener("click", () => {
  normalizeRoomCode();

  const code = $("roomCode").value.trim();

  if (code.length !== 6) {
    setMessage(
      "menuMessage",
      "El código debe tener exactamente 6 caracteres."
    );
    return;
  }

  setMessage("menuMessage");

  socket.emit("spectateRoom", {
    name: getPlayerName(),
    code
  });
});

// Mantener el código en mayúsculas.
$("roomCode").addEventListener("input", normalizeRoomCode);

// Copiar el código de la sala.
$("copyCodeBtn").addEventListener("click", async () => {
  if (!currentRoom) return;

  try {
    await navigator.clipboard.writeText(currentRoom);

    $("copyCodeBtn").textContent = "✓";

    setMessage(
      "gameMessage",
      "Código copiado. Ya puedes compartirlo con tu amigo.",
      true
    );

    setTimeout(() => {
      $("copyCodeBtn").textContent = "⧉";
    }, 1500);
  } catch {
    setMessage(
      "gameMessage",
      `No se pudo copiar automáticamente. Tu código es: ${currentRoom}`
    );
  }
});

$("backBtn").addEventListener("click", leaveToMenu);
$("leaveBtn").addEventListener("click", leaveToMenu);
$("resultMenuBtn").addEventListener("click", leaveToMenu);

// El servidor confirma que entramos a una sala.
socket.on("roomJoined", data => {
  enterRoom(data);
});

// El servidor informa de cada cambio de la partida.
socket.on("roomState", room => {
  if (!currentRoom || room.code !== currentRoom) {
    return;
  }

  const previousFen = currentState?.fen;

  if (previousFen && previousFen !== room.fen) {
    try {
      const previousGame = getChessInstance(previousFen);
      const updatedGame = getChessInstance(room.fen);

      if (previousGame && updatedGame) {
        const oldHistory = previousGame.history();
        const newHistory = updatedGame.history();

        if (newHistory.length > oldHistory.length) {
          const lastNotation = newHistory[newHistory.length - 1];

          setMessage(
            "gameMessage",
            `Movimiento realizado: ${lastNotation}`,
            true
          );

          const verboseHistory = updatedGame.history({
            verbose: true
          });

          const last = verboseHistory[verboseHistory.length - 1];

          if (last) {
            lastMove = {
              from: last.from,
              to: last.to
            };
          }
        }
      }
    } catch {
      // El estado recibido del servidor sigue siendo la referencia principal.
    }
  }

  renderRoom(room);
});

// Mensajes de error claros para el usuario.
socket.on("appError", message => {
  setMessage(
    currentRoom ? "gameMessage" : "menuMessage",
    message
  );
});

socket.on("leftRoom", () => {
  currentRoom = null;
  currentState = null;
});

// Informar si la conexión se pierde o se recupera.
socket.on("connect", () => {
  if (currentRoom) {
    setMessage(
      "gameMessage",
      "Conexión restablecida. Si el tablero no se actualiza, vuelve a entrar a la sala.",
      true
    );
  } else {
    setMessage("menuMessage");
  }
});

socket.on("disconnect", () => {
  setMessage(
    currentRoom ? "gameMessage" : "menuMessage",
    "Se perdió la conexión. Intentando reconectar…"
  );
});