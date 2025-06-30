const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;
const partidaId = "PARTIDA_UNICA";

const partidas = {
  [partidaId]: {
    numeros: [],
    jogadores: {}, // socketId: { cartela, nome, premiacoes: [] }
    vencidos: {
      quadra: null,
      quina: null,
      cartela: null,
    },
    jogoFinalizado: false,
    sorteioAtivo: false,
    sorteioInterval: null,
    cooldownAtivo: false,
    cooldownTimeout: null,
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

function emitirGanhadores() {
  const partida = partidas[partidaId];
  const ganhadores = {};
  for (const tipo of ["quadra", "quina", "cartela"]) {
    const socketId = partida.vencidos[tipo];
    if (socketId) {
      const jogador = partida.jogadores[socketId];
      ganhadores[tipo] = jogador ? jogador.nome : "Desconhecido";
    }
  }
  io.to(partidaId).emit("fimDeJogo", ganhadores);
}

function checarFimDeJogo() {
  const partida = partidas[partidaId];
  const numJogadores = Object.keys(partida.jogadores).length;

  if (numJogadores === 1) {
    const algumPremio = partida.vencidos.quadra || partida.vencidos.quina || partida.vencidos.cartela;
    if (algumPremio) {
      partida.jogoFinalizado = true;
      io.to(partidaId).emit("mensagem", "🎉 Jogo acabou! Um jogador fez um prêmio.");
      emitirGanhadores();
      pararSorteio();
      return true;
    }
  } else {
    if (partida.vencidos.quadra && partida.vencidos.quina && partida.vencidos.cartela) {
      partida.jogoFinalizado = true;
      io.to(partidaId).emit("mensagem", "🎉 O jogo acabou! Todos os prêmios foram conquistados.");
      emitirGanhadores();
      pararSorteio();
      return true;
    }
  }

  return false;
}

// Função para iniciar sorteio automático
function startSorteio() {
  const partida = partidas[partidaId];
  if (partida.sorteioAtivo) return; // já ativo

  partida.sorteioAtivo = true;
  partida.sorteioInterval = setInterval(() => {
    if (partida.jogoFinalizado) {
      pararSorteio();
      return;
    }
    if (checarFimDeJogo()) return;

    const novo = sortearNumero(partida.numeros);
    if (novo === null) {
      partida.jogoFinalizado = true;
      io.to(partidaId).emit("mensagem", "Todos os números foram sorteados.");
      emitirGanhadores();
      pararSorteio();
      return;
    }

    partida.numeros.push(novo);
    io.to(partidaId).emit("novoNumero", novo);

    for (const [id, jogador] of Object.entries(partida.jogadores)) {
      const premio = verificarBingo(jogador.cartela, partida.numeros);
      if (premio && !jogador.premiacoes.includes(premio)) {
        jogador.premiacoes.push(premio);
        partida.vencidos[premio] = id;

        io.to(partidaId).emit(
          "mensagem",
          `🎉 Jogador ${jogador.nome} fez ${premio.toUpperCase()}!`
        );

        if (checarFimDeJogo()) return;
      }
    }
  }, 10000);
}

function pararSorteio() {
  const partida = partidas[partidaId];
  if (partida.sorteioInterval) {
    clearInterval(partida.sorteioInterval);
    partida.sorteioInterval = null;
    partida.sorteioAtivo = false;
  }

  partida.cooldownAtivo = true;

  io.to(partidaId).emit("mensagem", "⏳ Nova partida em 5 minutos...");
  io.to(partidaId).emit("cooldownIniciado", 5 * 60); // 5 minutos em segundos

  partida.cooldownTimeout = setTimeout(() => {
    // Resetar tudo após o cooldown
    partida.numeros = [];
    partida.jogadores = {};
    partida.vencidos = { quadra: null, quina: null, cartela: null };
    partida.jogoFinalizado = false;
    partida.cooldownAtivo = false;
    partida.cooldownTimeout = null;

    io.to(partidaId).emit("mensagem", "✅ Nova partida liberada!");
    io.to(partidaId).emit("liberarParticipacao");
  }, 5 * 60 * 1000); // 5 minutos
}

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  socket.join(partidaId);

  const partida = partidas[partidaId];

  socket.on("participar", (nome) => {
    if (partida.cooldownAtivo) {
      socket.emit("mensagem", "Aguarde o início da próxima rodada. Cooldown em andamento.");
      return;
    }

    if (partida.jogoFinalizado) {
      socket.emit("mensagem", "Jogo já finalizado, aguarde próxima partida.");
      return;
    }

    if (partida.jogadores[socket.id]) {
      socket.emit("mensagem", "Você já está participando da partida.");
      return;
    }

    const cartela = gerarCartela();
    partida.jogadores[socket.id] = { cartela, nome, premiacoes: [] };

    socket.emit("dadosIniciais", {
      cartela,
      numerosSorteados: partida.numeros,
      vencidos: partida.vencidos,
      partidaId,
      nomeJogador: nome,
    });

    io.to(partidaId).emit("mensagem", `Jogador ${nome} entrou no jogo!`);

    // ADICIONADO: envia o número atualizado de jogadores
    io.to(partidaId).emit("atualizarNumeroJogadores", Object.keys(partida.jogadores).length);

    // Se for o primeiro jogador, inicia o sorteio
    if (Object.keys(partida.jogadores).length === 1) {
      io.to(partidaId).emit("mensagem", "🎉 Sorteio iniciado!");
      startSorteio();
    }
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
    delete partida.jogadores[socket.id];

    // ADICIONADO: envia o número atualizado de jogadores após desconexão
    io.to(partidaId).emit("atualizarNumeroJogadores", Object.keys(partida.jogadores).length);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
