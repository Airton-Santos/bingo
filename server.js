const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // para testes. Em produção, restrinja para seu domínio
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

const partidaId = "PARTIDA_UNICA";

const partidas = {
  [partidaId]: {
    numeros: [],
    jogadores: {},
    vencidos: {
      quadra: null,
      quina: null,
      cartela: null,
    },
  },
};

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
  if (jaSorteados.length >= 75) return null;
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

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  socket.join(partidaId);

  const partida = partidas[partidaId];

  const cartela = gerarCartela();
  partida.jogadores[socket.id] = { cartela, premiacoes: [] };

  // Envia dados iniciais para o cliente
  socket.emit("dadosIniciais", {
    cartela,
    numerosSorteados: partida.numeros,
    vencidos: partida.vencidos,
    partidaId,
  });

  // Evento para sortear número
  socket.on("sortearNumero", () => {
    if (
      partida.vencidos.quadra &&
      partida.vencidos.quina &&
      partida.vencidos.cartela
    ) {
      io.to(partidaId).emit(
        "mensagem",
        "🎉 O jogo acabou! Todos os bingos foram feitos."
      );
      return;
    }

    const novo = sortearNumero(partida.numeros);
    if (novo === null) {
      io.to(partidaId).emit("mensagem", "Todos os números foram sorteados.");
      return;
    }

    partida.numeros.push(novo);
    io.to(partidaId).emit("novoNumero", novo);

    // Verificar bingo para todos jogadores
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
          io.to(partidaId).emit(
            "mensagem",
            "🎉 O jogo acabou! Todos os tipos de bingo foram feitos."
          );
        }
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
    delete partida.jogadores[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
