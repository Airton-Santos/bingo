const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Permitir conexões de qualquer origem
const io = new Server(server, {
  cors: {
    origin: "*", // Pode restringir depois para seu domínio ex: "https://meubingo.com"
    methods: ["GET", "POST"]
  }
});

app.use(cors());

const PORT = process.env.PORT || 3000;

const partidas = {};

function gerarCartela() {
  const cartela = [];
  const intervalos = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75],
  ];

  for (let c = 0; c < 5; c++) {
    const [min, max] = intervalos[c];
    const numeros = new Set();
    while (numeros.size < 5) {
      numeros.add(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    cartela.push([...numeros]);
  }

  cartela[2][2] = "LIVRE";
  return cartela;
}

function sortearNumero(jaSorteados) {
  let n;
  do {
    n = Math.floor(Math.random() * 75) + 1;
  } while (jaSorteados.includes(n));
  return n;
}

function verificarBingo(cartela, numerosSorteados) {
  let acertos = 0;

  for (let col = 0; col < 5; col++) {
    for (let lin = 0; lin < 5; lin++) {
      const val = cartela[col][lin];
      if (val === "LIVRE" || numerosSorteados.includes(val)) {
        acertos++;
      }
    }
  }

  if (acertos === 25) return "cartela";
  if (acertos >= 15) return "quina";
  if (acertos >= 10) return "quadra";
  return null;
}

// Gera um ID de partida aleatório tipo 'A1B2C3'
function gerarIdPartida() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

io.on("connection", (socket) => {
  const partidaId = crypto.randomBytes(3).toString("hex").toUpperCase();
  socket.join(partidaId);

  partidas[partidaId] = {
    numeros: [],
    jogadores: {},
    vencidos: {
      quadra: null,
      quina: null,
      cartela: null,
    },
  };

  const partida = partidas[partidaId];
  const cartela = gerarCartela();

  partida.jogadores[socket.id] = {
    cartela,
    premiacoes: [],
  };

  socket.emit("dadosIniciais", {
    cartela,
    numerosSorteados: [],
    vencidos: partida.vencidos,
    partidaId,
  });

  socket.on("sortearNumero", () => {
    if (
      partida.vencidos.quadra &&
      partida.vencidos.quina &&
      partida.vencidos.cartela
    ) {
      io.to(partidaId).emit("mensagem", "🎉 O jogo acabou! Todos os bingos foram feitos.");
      return;
    }

    const novo = sortearNumero(partida.numeros);
    partida.numeros.push(novo);
    io.to(partidaId).emit("novoNumero", novo);

    for (const [id, jogador] of Object.entries(partida.jogadores)) {
      const premio = verificarBingo(jogador.cartela, partida.numeros);

      if (premio && !jogador.premiacoes.includes(premio)) {
        jogador.premiacoes.push(premio);
        partida.vencidos[premio] = id;

        io.to(partidaId).emit(
          "mensagem",
          `🎉 Jogador ${id.slice(0, 5)} fez ${premio.toUpperCase()}!`
        );

        if (
          partida.vencidos.quadra &&
          partida.vencidos.quina &&
          partida.vencidos.cartela
        ) {
          io.to(partidaId).emit("mensagem", "🎉 O jogo acabou! Todos os tipos de bingo foram feitos.");
        }
      }
    }
  });

  socket.on("disconnect", () => {
    delete partidas[partidaId].jogadores[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});