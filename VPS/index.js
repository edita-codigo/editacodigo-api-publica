// index.js (CommonJS + @whiskeysockets/baileys)
// API EditaCódigo PÚBLICA — versão simplificada do Bailes:
// captura tudo (menos enquete), só envia texto, sem grupos.

const crypto = require("crypto");
global.crypto = crypto.webcrypto || crypto;

const axios   = require("axios");
const express = require("express");
const fs      = require("fs");
const path    = require("path");
const https   = require("https");
const dotenv  = require("dotenv");
const qrcode  = require("qrcode-terminal");

dotenv.config();

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const PORTA             = process.env.PORTA;
const WEBHOOK_FUNCOES   = process.env.WEBHOOK_FUNCOES;
const WEBHOOK_MENSAGENS = process.env.WEBHOOK_MENSAGENS;
const WEBHOOK_VALIDATE  = process.env.WEBHOOK_VALIDATE;
const TOKEN             = process.env.TOKEN;

console.log("\n=== VARIÁVEIS DE AMBIENTE (API PÚBLICA) ===");
console.log("PORTA:", PORTA);
console.log("TOKEN:", TOKEN ? "✓ Configurado" : "✗ NÃO CONFIGURADO");
console.log("WEBHOOK_FUNCOES:", WEBHOOK_FUNCOES ? "✓ " + WEBHOOK_FUNCOES : "✗ NÃO CONFIGURADO");
console.log("WEBHOOK_MENSAGENS:", WEBHOOK_MENSAGENS ? "✓ " + WEBHOOK_MENSAGENS : "✗ NÃO CONFIGURADO");
console.log("WEBHOOK_VALIDATE:", WEBHOOK_VALIDATE ? "✓ " + WEBHOOK_VALIDATE : "✗ NÃO CONFIGURADO");
console.log("=============================\n");

const instancias = {};
let funcoes = null;
let ultimaTentativaCarregar = null;

function toSafeJSON(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    const cache = new Set();
    const json = JSON.stringify(value, (key, val) => {
      if (typeof val === "object" && val !== null) {
        if (cache.has(val)) return undefined;
        cache.add(val);
      }
      if (typeof val === "function") return undefined;
      return val;
    });
    return JSON.parse(json);
  } catch (err) {
    return { info: "Resultado não serializável", tipo: typeof value, erro: err.message };
  }
}

async function enviarWebhookMensagem(dados) {
  try {
    await axios.post(WEBHOOK_MENSAGENS, dados, { timeout: 5000 });
    console.log("📤 Webhook enviado:", dados.action || dados.tipo);
  } catch (err) {
    console.error("❌ Erro ao enviar webhook:", err.message);
  }
}

// Cron de validação a cada 60s
setInterval(async () => {
  try {
    const usuariosAtivos = Object.keys(instancias);
    await axios.post(WEBHOOK_VALIDATE, { token: TOKEN, usuarios: usuariosAtivos }, { timeout: 5000 });
    console.log("🔄 Token validado");
  } catch (e) {
    console.error("❌ Falha validação token:", e.message);
  }
}, 60_000);

// ═══════════════════════════════════════════════════════
// 📥 CARREGAR FUNÇÕES REMOTAS (index.php retorna JS)
// ═══════════════════════════════════════════════════════

async function loadRemote() {
  try {
    console.log("\n🔄 Carregando funções remotas...");
    console.log("📍 URL:", WEBHOOK_FUNCOES);

    ultimaTentativaCarregar = new Date();

    const { data: jsCode, status } = await axios.post(
      WEBHOOK_FUNCOES,
      { token: TOKEN },
      { timeout: 10000 }
    );

    console.log("✅ Resposta recebida (Status:", status + ")");

    if (!jsCode || typeof jsCode !== "string" || jsCode.length === 0) {
      console.warn("⚠ Resposta inválida ou vazia");
      return false;
    }

    console.log("📝 Tamanho do código:", jsCode.length, "bytes");
    console.log("🔨 Compilando módulo...");

    const module = { exports: {} };

    // Injeta: qrcode, axios e WEBHOOK_MENSAGENS como closure nas funções remotas
    const injector = new Function(
      "module", "exports", "require",
      "qrcode", "axios", "WEBHOOK_MENSAGENS",
      jsCode
    );

    injector(module, module.exports, require, qrcode, axios, WEBHOOK_MENSAGENS);

    funcoes = module.exports;

    const funcoesCarregadas = Object.keys(funcoes);
    console.log("\n✅ MÓDULO CARREGADO COM SUCESSO!");
    console.log("📊 Funções carregadas:", funcoesCarregadas.length);
    console.log("\n📋 FUNÇÕES DISPONÍVEIS:");
    funcoesCarregadas.forEach((nome, i) => {
      console.log(`   ${i + 1}. ${nome} (${typeof funcoes[nome]})`);
    });
    console.log("\n");

    return true;
  } catch (err) {
    console.error("\n❌ ERRO AO CARREGAR FUNÇÕES REMOTAS:", err.message);
    if (err.response) {
      console.error("Status HTTP:", err.response.status);
      console.error("Dados:", err.response.data?.substring?.(0, 300) || err.response.data);
    }
    return false;
  }
}

let intervaloRecarregar = null;

async function iniciarTentativasRecarregar() {
  console.log("⏰ Tentando recarregar a cada 30 segundos...");
  if (intervaloRecarregar) clearInterval(intervaloRecarregar);
  intervaloRecarregar = setInterval(async () => {
    if (!funcoes) {
      const sucesso = await loadRemote();
      if (sucesso && intervaloRecarregar) {
        clearInterval(intervaloRecarregar);
        intervaloRecarregar = null;
        await recuperarSessoesAtivas(); // sessões só recuperadas quando funções estiverem prontas
      }
    }
  }, 30_000);
}

// ═══════════════════════════════════════════════════════
// 🔄 RECUPERAR SESSÕES ATIVAS AO INICIAR
// ═══════════════════════════════════════════════════════

async function recuperarSessoesAtivas() {
  try {
    const CAMINHO_SESSOES = path.join(process.cwd(), "sessions");

    console.log("\n🔍 Verificando sessões ativas...\n");

    if (!fs.existsSync(CAMINHO_SESSOES)) {
      console.log("ℹ️  Pasta de sessões não existe ainda\n");
      return;
    }

    const sessoes = fs.readdirSync(CAMINHO_SESSOES, { withFileTypes: true })
      .filter(f => f.isDirectory())
      .map(f => f.name);

    if (sessoes.length === 0) {
      console.log("ℹ️  Nenhuma sessão salva encontrada\n");
      return;
    }

    console.log(`📱 Encontradas ${sessoes.length} sessão(ões): ${sessoes.join(", ")}\n`);

    for (const usuario of sessoes) {
      try {
        console.log(`⏳ Recuperando: ${usuario}`);
        if (funcoes && funcoes.abrirInstancia) {
          const resultado = await funcoes.abrirInstancia(instancias, usuario, enviarWebhookMensagem);
          console.log(`   Resultado: ${resultado.status}`);
        }
      } catch (err) {
        console.error(`❌ Erro ao recuperar ${usuario}:`, err.message);
      }
    }

    const conectadas = Object.values(instancias).filter(i => i.isConnected).length;
    console.log(`\n✅ RECUPERAÇÃO CONCLUÍDA: ${conectadas}/${sessoes.length} sessões ativas\n`);
  } catch (err) {
    console.error("❌ Erro ao recuperar sessões:", err.message);
  }
}

// ═══════════════════════════════════════════════════════
// 🚀 INICIALIZAR SERVIDOR
// ═══════════════════════════════════════════════════════

async function start() {
  const sucesso = await loadRemote();

  if (!sucesso) {
    console.warn("⚠ Funções remotas não carregadas. Servidor iniciará mesmo assim.");
    await iniciarTentativasRecarregar();
  } else {
    await recuperarSessoesAtivas();
  }

  // ── ROTAS ──────────────────────────────────────────────

  app.get("/status", (req, res) => {
    return res.json({
      status: "online",
      servidor: "EditaCódigo API - Pública (Baileys)",
      porta: PORTA,
      funcoes_carregadas: funcoes ? true : false,
      instancias_ativas: Object.keys(instancias).length,
      ultima_tentativa: ultimaTentativaCarregar
    });
  });

  app.post("/recarregar-funcoes", async (req, res) => {
    console.log("🔄 Recarregando funções...");
    const sucesso = await loadRemote();
    if (sucesso) {
      return res.json({ status: "✅ Funções recarregadas com sucesso!" });
    } else {
      return res.status(503).json({ error: "❌ Falha ao carregar funções" });
    }
  });

  app.post("/", async (req, res) => {
    const { action, usuario, message, token } = req.body;

    if (!token || token !== TOKEN) {
      return res.status(401).json({ error: "❌ Chave de API inválida ou não enviada" });
    }

    if (!action) {
      return res.status(400).json({ error: "❌ Ação não definida" });
    }

    if (!funcoes) {
      return res.status(503).json({
        error: "❌ Funções remotas ainda não carregadas",
        info: "Use POST /recarregar-funcoes ou aguarde",
        ultima_tentativa: ultimaTentativaCarregar
      });
    }

    try {
      switch (action) {

        case "AbrirInstancia":
        case "AbrirInstanciaTerminal": {
          const out = await funcoes.abrirInstancia(instancias, usuario, enviarWebhookMensagem);
          return res.json({ status: "✅ Instância aberta", details: toSafeJSON(out) });
        }

        case "GerarQrcode": {
          const out = funcoes.gerarQrcode(instancias, usuario);
          return res.json(toSafeJSON(out));
        }

        case "RegenerarQrcode": {
          const out = await funcoes.recarregarSessao(instancias, usuario, enviarWebhookMensagem);
          return res.json({ status: "✅ QR code regenerado", details: toSafeJSON(out) });
        }

        case "EnviarMsg": {
          const telefone = message?.telefone;
          const msg      = message?.msg;
          if (!telefone || !msg) {
            return res.status(400).json({ error: "❗ Telefone e msg obrigatórios" });
          }
          const out = await funcoes.enviarMensagem(instancias, usuario, telefone, msg);
          return res.json(toSafeJSON(out));
        }

        case "DestruirInstancia": {
          await funcoes.destruirInstanciaDefinitivamente(instancias, usuario);
          return res.json({ status: "✅ Instância destruída definitivamente" });
        }

        case "FecharInstancia": {
          const out = funcoes.fecharInstancia(instancias, usuario);
          return res.json(toSafeJSON(out));
        }

        case "StatusInstancias": {
          const status = {};
          for (const [user, inst] of Object.entries(instancias)) {
            status[user] = {
              status: inst.status,
              isConnected: inst.isConnected,
              tentativasReconexao: inst.tentativasReconexao,
              criadoEm: inst.criadoEm,
              ultimaConexaoSucesso: inst.ultimaConexaoSucesso
            };
          }
          return res.json({ status, total: Object.keys(instancias).length });
        }

        case "BuscarContatos": {
          const out = await funcoes.buscarContatos(instancias, usuario);
          return res.json(toSafeJSON(out));
        }

        case "BuscarChats": {
          const limite = message?.limite || 20;
          const out = await funcoes.buscarChats(instancias, usuario, limite);
          return res.json(toSafeJSON(out));
        }

        case "GetConversationContacts": {
          const out = await funcoes.extrairContatosConversas(instancias, usuario);
          return res.json(toSafeJSON(out));
        }

        case "GetProfilePic": {
          const instancia = instancias[usuario];
          if (!instancia?.isConnected) return res.json({ error: '❌ Instância não conectada' });
          const telefone = (message?.telefone || '').replace(/[^0-9]/g, '');
          if (!telefone) return res.json({ error: 'Telefone não informado' });
          try {
            const jid = telefone + '@s.whatsapp.net';
            const url = await instancia.sock.profilePictureUrl(jid, 'image');
            return res.json({ sucesso: true, foto: url || '' });
          } catch (e) {
            return res.json({ sucesso: false, foto: '', erro: e.message });
          }
        }

        default:
          return res.status(400).json({ error: "❌ Ação não reconhecida ou não disponível na versão pública: " + action });
      }
    } catch (e) {
      console.error(`❌ Erro em ${action}:`, e);
      return res.status(500).json({ error: e.message || e.toString() });
    }
  });

  const opts = {
    cert: fs.readFileSync("./ssl/cert.pem"),
    key:  fs.readFileSync("./ssl/key.pem")
  };

  https.createServer(opts, app).listen(PORTA, () => {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🟢 API Pública (Baileys) rodando na porta ${PORTA}`);
    console.log(`📍 https://seu-dominio.com:${PORTA}`);
    console.log(`📊 GET  /status              — Status`);
    console.log(`🔄 POST /recarregar-funcoes  — Recarregar funções`);
    console.log(`${"=".repeat(50)}\n`);
  });
}

start();
